# 待办事项

> 说明：标注 **【已完成】** 的条目仅作历史记录保留；标注 **【暂缓】** 的条目经过分析确认无法在不引入外部依赖或不破坏现有行为的前提下修复。

---

## rule_engine（后端服务）

### 一、内存 Job Store —— 重启即丢失

**文件**：`api/routers/extract.py:59–60`

**现状**：所有抽取任务（`ExtractJob`）存储在进程级 `_jobs: dict` 中，重启后全部丢失。HF Space 在以下情况会重启：
- 长时间无请求（冷启动）
- 手动重启 / 新版本部署
- OOM

**实际影响**：前端轮询 `GET /extract/{job_id}` 时收到 404，用户无法看到抽取结果，也无法从断点续跑。**目前没有 TTL 驱逐机制**，内存会随任务数量持续增长（理论上每个 job 的 result 含完整 markdown，几十 KB 级别）。

**为什么没做**：需要引入持久化存储（Redis / 数据库 / HF Dataset），或改用 HF 提供的持久化目录（`/data`）。属于较大的架构决策，改动涉及 job 的读写两端，需要配套的序列化方案（dataclass → JSON），且要考虑并发安全（目前用 `Lock`，Redis 方案需要分布式锁或乐观写）。

**建议方案**（按复杂度从低到高）：

1. **快速方案（推荐先做）**：把 completed/failed 的 job result 序列化到 HF Space 的 `/data/<job_id>.json`（持久卷），轮询时先查内存再查磁盘。单进程、无额外依赖，能解决重启丢失问题。
2. **中期方案**：引入 SQLite（`/data/jobs.db`），用 `aiosqlite` 异步读写，替代内存 dict。
3. **长期方案**：如果横向扩展（多个 Space 实例），需要 Redis 或托管数据库。

**可以做的时机**：HF Space 持久卷（`/data`）已经在用（index 文件存在那里），方案 1 随时可做，不影响现有接口。

---

### 二、chat.py worker 线程 600 秒无取消机制

**文件**：`api/routers/chat.py:299`

**现状**：`_chat_stream_impl` 在独立 daemon 线程运行，主协程通过 `t.join(timeout=600)` 等待。如果上游 LLM 挂起，客户端断开连接后该线程仍会占用 600 秒（10 分钟），期间 `queue.Queue` 满（如果有上限）或线程泄漏。

**实际影响**：并发请求较少时基本无感（HF 单机资源有限，并发本就不高）。若出现上游 LLM 连接挂起（非超时），可能累积僵尸线程直到进程重启。

**为什么没做**：Python 标准线程无法强制中断；正确的取消方案是：
- 改用 `concurrent.futures.Future` + 检查 cancel 标志位（需要 LlamaIndex 流式回调配合），或
- 在线程内部读 `cancel_event: threading.Event`，在每次 `sq.put()` 前检查。

改动涉及流式生成器的内部循环，风险不低。

**建议**：先在 LLM 客户端侧设置合理的 `timeout`（OpenRouter / Gemini 等均支持），让请求在 LLM 层面超时而非无限等待，这是成本最低的缓解手段，无需改线程逻辑。

**可以做的时机**：LLM client timeout 配置（各 provider 的 `timeout` 参数）随时可加；线程取消机制建议等到有明确的超时问题复现时再做。

---

### 三、`_condense_question` 调用 LlamaIndex 私有 API

**文件**：`api/routers/chat.py:155`

**现状**：多轮对话时调用 `chat_engine._condense_question(...)` —— 前缀 `_` 是 LlamaIndex 的私有方法，未来 minor 版本可能改名或签名变化。

**实际影响**：目前无问题，但如果 `llama-index-core` 升级后该方法被移除或重命名，chat 多轮对话会直接 500。

**为什么没做**：替代方案需要手动实现问题改写（直接调 LLM + prompt），或改用 LlamaIndex 公开的 `chat_engine.chat()` 方法（但那个是同步阻塞 + 非流式）。需要一定重构量，且需要测试多轮对话的效果。

**可以做的时机**：升级 LlamaIndex 版本之前，或者当 `_condense_question` 实际出现问题时。建议在 `pyproject.toml` 对 `llama-index-core` 的版本上限加 pin（如 `<0.13`），防止静默升级。

---

### 四、`chapter_extract.py` lambda 闭包变量捕获

**文件**：`graphs/nodes/chapter_extract.py:101–112`

**现状**：`_call` 闭包在 `for i, ...` 循环内定义，捕获了 `parts`、`_mot`、`llm_warns` 等循环变量。因为 `_call` 立即在同一循环迭代中执行（`retry(_call, ...)`），实际上不会产生变量错位的问题。

**实际影响**：**当前无 bug**，属于代码可读性风险。若未来有人把 `_call` 改成延迟执行（如放入线程池），就会出现经典的 Python 闭包陷阱。

**建议**：用 default 参数绑定 `lambda parts=parts, _mot=_mot: ...`，或把 `_call` 改成显式参数的内嵌函数，一行改动，零风险。**可以随时做。**

---

### 五、无请求级别 Correlation ID

**文件**：全局（middleware + 各 router）

**现状**：日志中没有 per-request 的唯一 ID，并发请求的日志行无法区分是哪个 game_id、哪次调用产生的。

**实际影响**：单并发时无影响；一旦出现多个用户同时抽取或聊天，日志调试困难。

**为什么没做**：需要 FastAPI middleware 生成 `request_id`（UUID）并写入 `contextvars.ContextVar`，再在各处日志调用中附加。改动面广（所有 logger 调用都要改），收益在并发量小时有限。

**可以做的时机**：并发量增加后或出现难以排查的并发日志问题时。

---

### 六、`extract.py` 大 PDF 全量加载到内存

**文件**：`api/routers/extract.py:222–226`（`_download_to_temp` 函数）

**现状**：`r.content` 把整个 PDF 读入内存再写文件。对于 HF Space 的内存限制，大型规则书（100+ 页，10–50 MB）存在 OOM 风险。

**实际影响**：小型规则书（< 10 MB）无问题。大型规则书（> 20 MB）可能触发 HF 的内存限制。

**建议修复**：把 `p.write_bytes(r.content)` 改为流式写入：
```python
with httpx.stream("GET", url, ...) as r, open(p, "wb") as f:
    for chunk in r.iter_bytes(chunk_size=1 << 20):
        f.write(chunk)
```
**改动极小，零风险，可以随时做。**

---

### 七、`extract.py` resume 路径两次加锁之间的 TOCTOU

**文件**：`api/routers/extract.py:488–500`

**现状**：resume 路径先在第一个 `with _jobs_lock` 读 job，释放锁后再在第二个 `with _jobs_lock` 写 job。两次加锁之间有窗口，理论上另一个线程可以删除 job。

**实际影响**：**当前无实际 bug**，因为代码中没有删除 `_jobs` 中条目的路径（只有写入，没有 `del _jobs[jid]`）。只要不加删除逻辑就不会触发。

**可以做的时机**：如果将来加入 TTL 驱逐（上面第一条），必须同时修复这个 TOCTOU，否则驱逐线程和 resume 路径会产生竞态。

---

## miniapp（微信小程序）

### 八、WeChat SSE error 事件 throw 不被捕获

**文件**：`pages/chat/index.vue`（WeChat SSE 路径）

**现状**：WeChat 原生 SSE 模拟中，`error` 事件回调里抛出的异常不会被外层 `await` 捕获（WeChat 的回调机制不是 Promise 链），导致助手气泡永远停在加载状态。

**实际影响**：用户看到加载圈不消失，必须手动关闭对话。网络中断、LLM 超时等场景会复现。

**为什么没做**：需要深入了解 WeChat 小程序的 SSE 替代实现（`wx.request` 的 chunked 流），改动涉及前端 SSE 状态机，需要在微信开发者工具中测试。**属于前端 bug，应优先处理。**

**可以做的时机**：随时，但需要微信开发者工具环境和测试账号。

---

### 九、JWT 未校验 exp（token 永久有效）

**文件**：`miniapp/utils/auth.ts:122–128`

**现状**：存储的 JWT 只检查是否存在，不校验 `exp` 字段，过期 token 会一直被复用。

**实际影响**：服务端如果不做二次校验，存在安全漏洞（token 被盗后无法失效）。如果服务端有校验，则只是前端体验问题（用户会在下次请求时被踢回登录）。

**可以做的时机**：安全审查或出现 token 相关用户投诉时。

---

### 十、`getOrFetchUserId` 无并发保护

**文件**：`miniapp/utils/auth.ts:122–163`

**现状**：多个并发的 UI 事件可能同时触发 `getOrFetchUserId`，导致多个 `wx.login` 请求并发执行，可能返回重复的 userId。

**实际影响**：概率性 bug，仅在极短时间内多次触发登录逻辑时出现（如快速切换页面）。

**建议**：用 Promise singleton 模式（`let _pending: Promise<string> | null`）包装，确保同时只有一个 login 请求在飞。**改动 5 行，风险极低，可以随时做。**

---

### 十一、`visibleSuggestions` computed 内有 `Math.random()`

**文件**：`pages/chat/index.vue:261–267`

**现状**：`computed` 属性内调用 `Math.random()` 是副作用，Vue 每次重新计算时结果不同，可能导致建议词频繁闪烁。

**实际影响**：用户体验问题，不影响功能正确性。

**建议**：把随机选择移到 `onMounted` 或用户主动刷新时执行，`visibleSuggestions` 只是 `ref`。**可以随时做。**

---

### 十二、`pages/chat/index.vue` 单文件 1068 行

**现状**：整个聊天页逻辑都在一个文件里，且有 `@ts-nocheck` 绕过 TypeScript 检查。

**实际影响**：不影响功能，但维护成本高，TypeScript 保护形同虚设。

**建议**：这是技术债重构，在需要修改聊天页时顺手拆分，不建议单独安排时间做。

---

## web（Next.js H5 前端）

### 十三、`/api/h5-auth` 无速率限制

**现状**：H5 鉴权接口没有 IP 级别的速率限制，可被暴力枚举。

**建议**：在 Vercel/Cloudflare 层加 WAF 规则，或在 Next.js 中用 `upstash/ratelimit` 等库。属于安全加固，**建议在公开上线前完成**。

---

### 十四、500 响应暴露原始异常信息

**现状**：HTTP 500 的响应体包含原始异常字符串，可能泄露内部实现细节（文件路径、依赖版本等）。

**建议**：统一用 `{ error: "Internal server error" }` 返回，异常详情只写服务端日志。

---

### 十五、`lib/ai-crypto.ts` SHA-256 key derivation

**现状**：用 SHA-256 做密钥派生，计算速度太快，不适合抵御离线暴力破解。

**建议**：改为 PBKDF2 或 scrypt（WebCrypto API 原生支持）。属于安全加固。

---

## 已完成（供参考）

| 时间 | 内容 |
|------|------|
| 第一阶段 | `utils/retry.py` 用 tenacity 重写，指数退避 + jitter |
| 第一阶段 | `openrouter_client.py` / `dashscope_client.py` 返回类型统一为 `(str, bool)` |
| 第一阶段 | `utils/providers/` 新建 LlmProvider Protocol + GeminiProvider + OpenAICompatProvider |
| 第一阶段 | `utils/llm_generate.py` 从 1126 行精简到 ~555 行 |
| 第二阶段 | `ingestion/index_builder.py` 新增 `build_embedding_model()` 工厂函数，不再写全局 `Settings.embed_model` |
| 第二阶段 | `load_vector_index()` / `build_and_persist_index()` / `load_hybrid_reranked_nodes()` 接收显式 `embed_model` 参数 |
| 第二阶段 | `rulebook_query.build_rulebook_query_engine()` 移除 `Settings.llm` 全局写入 |
| 第三阶段 | `api/routers/chat.py` `t_build_begin` 初始化提前，消除 `UnboundLocalError` 风险 |
| 第三阶段 | `api/routers/extract.py` 裸 `assert` 替换为 `if … raise` |
| 第三阶段 | `api/main.py` header 解析失败改为 `WARNING` 日志 |
| 第三阶段 | `utils/prompt_context.py` Jinja2 `Environment` 改为模块级单例 |

## 搁置（有原因）

| 条目 | 原因 |
|------|------|
| `rulebook_query.py` Bedrock `api_key` 模式的 `os.environ` 写入 | `BedrockConverse` (LlamaIndex) 没有 Bearer token 的构造函数参数，boto3 在 Session 创建时读取环境变量，save/restore try/finally 是唯一支持的方式，无法在不改 LlamaIndex 源码的前提下消除 |
| CORS wildcard / 500 信息泄露 | web 子项目需要单独确认当前 CORS 配置和错误处理的实际代码，之前的分析是基于 review 描述而非直接读代码，风险不确定 |
