# 规则抽取流程说明（Extract → Index → Chat）

本文描述 **当前实现** 下的端到端数据流：从 Web/API 上传与选页，到 LangGraph 节点、轮询结果，再到建索引与对话检索。实现代码以 `graphs/`、`api/routers/extract.py`、`ingestion/index_builder.py`、`ingestion/rulebook_query.py` 为准。

---

## 1. 总览图（系统边界）

```mermaid
flowchart TB
  subgraph web [apps/web]
    UI[游戏页: 上传 PDF/图 / Gstone]
    Pick[缩略图: 目录页 / 排除页]
    Poll[轮询任务 / syncTaskFromRuleEngine]
  end

  subgraph engine [services/rule_engine]
    EP[POST /extract/pages 光栅化]
    EX[POST /extract 启动图]
    G[LangGraph 六节点]
    BI[POST /build-index]
    CH[POST /chat]
  end

  subgraph storage [存储与索引]
    Disk[exports: rules.md 等]
    Idx[BM25 + Vector manifest / pgvector]
  end

  UI --> EP
  Pick --> EX
  EP --> EX
  EX --> G
  Poll --> Disk
  Disk --> BI
  BI --> Idx
  CH --> Idx
```

---

## 2. LangGraph 拓扑（抽取管线）

图为 **线性**：无按复杂度分支跳过节点；`complexity` / `needs_batching` 只影响 **分批策略**（`batch_splitter`）。

```mermaid
flowchart LR
  START([START])
  T[toc_analyzer]
  R[route_by_complexity]
  B[batch_splitter]
  C[chapter_extract]
  M[merge_and_refine]
  Q[quickstart_and_questions]
  END([END])

  START --> T --> R --> B --> C --> M --> Q --> END
```

---

## 3. 业务步骤（Mermaid）

下列图为与实现一致的顺序；细节见各节点与 `extract.py`。

### 3.1 准备、入口校验与 LangGraph 执行

```mermaid
flowchart TB
  subgraph prep [准备]
    s1[用户上传 PDF 或多图]
    s2[缩略图标记目录页与排除页]
    s3["POST /extract/pages 光栅化 PNG"]
    s4["POST /extract page_job_id 等"]
    s1 --> s2 --> s3 --> s4
  end

  subgraph gate [入口校验]
    v{"每页 TOC 与 body 均有 path?"}
    bad[HTTP 400]
    ok[构建 ExtractionState]
    s4 --> v
    v -->|否| bad
    v -->|是| ok
  end

  subgraph lg [LangGraph 顺序执行]
    n5["toc_analyzer Flash 目录图 JSON"]
    n6["route_by_complexity needs_batching"]
    n7["batch_splitter vision_batches"]
    n8["chapter_extract Pro 按批 vision"]
    n9["merge_and_refine 合并与精修"]
    n10["quickstart_and_questions"]
    ok --> n5 --> n6 --> n7 --> n8 --> n9 --> n10
  end
```

说明：未在 UI 选目录页时，引擎可将 **第 1 页** 默认作为目录（见 `extract.py`）。**`chapter_extract` 节点内部**：若某批输出含 `NEED_MORE_CONTEXT`，会在上限内 **合并相邻图片批次** 再次调用 Pro（非图中的独立节点）。

### 3.2 merge 对 NEED_MORE_CONTEXT 的分支（逻辑在 `merge_and_refine` 内）

```mermaid
flowchart TB
  chunks[各批 chapter_outputs]
  check{"仍含 NEED_MORE_CONTEXT?"}
  rawJoin[拼接 merged_markdown 无 Pro 精修]
  noStruct[structured_chapters 为空]
  proMerge[Pro merge_refine.md 精修]
  withStruct[structured_chapters 由 MD 解析]
  chunks --> check
  check -->|是| rawJoin --> noStruct
  check -->|否| proMerge --> withStruct
```

### 3.3 轮询、落盘、建索引与聊天

```mermaid
flowchart LR
  poll["GET /extract/job_id"]
  disk["sync 写入 exports rules.md"]
  fail["completed 且无 merged_markdown 则失败"]
  bi["POST /build-index"]
  chat["POST /chat"]
  idx[(BM25 + Vector)]

  poll --> disk
  poll --> fail
  disk --> bi --> idx
  idx --> chat
```

---

## 4. 与 Index / Chat 的衔接（Mermaid）

```mermaid
flowchart LR
  subgraph sources [抽取产物]
    md[磁盘 merged_markdown]
    sc[structured_chapters 可选]
  end

  md --> mdt[merged_markdown_to_documents 切块]
  mdt --> emb[向量 + BM25 持久化]
  emb --> idx2[(每 game 索引)]

  idx2 --> rq[rulebook_query 检索]
  rq --> ans[Gemini 合成回答]

  sc -.->|当前 Web 建索引未使用| unused[不进入 build-index]
```

**结论**：只要 **`merged_markdown` 质量与页码标记** 满足 `node_builders` 的解析假设，即满足 **index + chat**；`structured_chapters` 为增强/调试用途，非当前 Web 建索引主路径。

### 4.1 页码锚点格式（`merged_markdown` → 向量元数据）

建索引时 `ingestion/node_builders.py` 按 **HTML 注释** 切分章节，并把页码写进每个 chunk 的 metadata（供引用与检索过滤）：

- **推荐写法**（与正则一致）：
  - 单页：`<!-- pages: 12 -->`
  - 连续页：`<!-- pages: 3-7 -->`（可用连字符 `-` 或 en dash `–`）
- **锚点之后**的第一段正文会继承该页码范围，直到下一个 `<!-- pages: ... -->`。
- **第一个锚点之前**的序言若无锚点，会记为 `unknown`（仍可被切块索引，但页码引用较弱）。
- **不推荐**：`[p.12]`、纯 Markdown 标题当页码、`Page 12` 等 **不会** 被当前解析器识别；若模型输出成这类格式，应在合并阶段统一为上面的注释形式，否则向量化仍能进行，但 **metadata 里的页码字段会不准**。

Web 游戏详情页「规则预览」中请用 **「完整源码」** 标签查看是否仍含上述注释（格式化视图会按 Markdown 渲染，HTML 注释不显示）。

---

## 5. 配置与环境（与抽取相关）

- **Gemini 凭证与模型**：由 **`apps/web`** 在调用规则引擎时通过请求头 **`X-Boardrule-Ai-Config`** 传入（在 Web **`/models`** 配置）；规则引擎 `.env` 不再配置 `GOOGLE_API_KEY`。  
- **`DATABASE_URL`**：LangGraph **PostgresSaver** 必需。  
- **`VISION_BATCH_PAGES`** / **`COMPLEXITY_THRESHOLD_PAGES`** / **`GEMINI_PRO_MAX_OUTPUT_TOKENS`** 等：见 `.env.example` 与 `README.md`。  

---

## 6. 相关文件

| 用途 | 路径 |
|------|------|
| 图定义 | `graphs/extraction_graph.py` |
| 状态 | `graphs/state.py` |
| HTTP 与校验 | `api/routers/extract.py` |
| 节点 | `graphs/nodes/*.py` |
| 索引构建 | `ingestion/index_builder.py`、 `ingestion/node_builders.py` |
| 聊天 | `api/routers/chat.py`、`ingestion/rulebook_query.py` |
| Prompt | `prompts/*.md` |

更详细的 API 与运行方式见同目录 **[README.md](./README.md)**。
