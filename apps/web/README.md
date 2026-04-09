# boardrule-rag — Web (`apps/web`)

Next.js（App Router）管理端：游戏元数据、规则书上传、任务与提取状态轮询。通过 **`RULE_ENGINE_URL`** 调用 `services/rule_engine`；**Gemini** 在 **`/models`** 配置后由 BFF 以请求头 **`X-Boardrule-Ai-Config`** 传给规则引擎。

## 环境变量

复制示例并填写：

```bash
cp .env.example .env
```

仓库根目录提供了 **`scripts/env-sync.sh`**：在保留你本地已配置键的前提下，按最新 **`.env.example`** 同步结构并补全新增变量（会先备份到 `env-backup/`）。在仓库根执行：

```bash
./scripts/env-sync.sh           # 默认即本目录 apps/web
./scripts/env-sync.sh --all     # 同时同步 rule_engine 的 .env
```

详见根目录 [README.md](../../README.md#syncing-env-with-envexample)。

| 变量 | 说明 |
|------|------|
| `RULE_ENGINE_URL` | 规则引擎根地址（无尾部斜杠），如 `http://127.0.0.1:8000` |
| `DATABASE_URL` | Prisma 连接串：**Supabase 本地**（`postgres`@`54322`，见 `supabase status`）或托管项目 |
| `AI_CONFIG_SECRET` | **必填**：用于加密保存在数据库中的 Gemini API Key（AES-256-GCM）。未设置则无法在 **`/models`** 保存凭证 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 建议配置；桶 **`rulebook-raw`**（上传）与 **`game-exports`**（导出）由迁移创建；大文件可 **pre-sign 直传**；未设置时使用本地 `storage/` |
| `SUPABASE_STORAGE_BUCKET_RAW` | 可选；覆盖默认 `rulebook-raw` |
| `SUPABASE_STORAGE_BUCKET_EXPORTS` | 可选；覆盖默认 `game-exports` |
| `AI_CONFIG_SECRET` | **必填**；32 字节十六进制字符串，用于 AES-256-GCM 加密存储 AI Gateway API Key 和微信 AppSecret。生成方式：`openssl rand -hex 32` |

数据库 URL 同时用于 **`prisma.config.ts`**（Prisma ORM 7）。**业务表**在 PostgreSQL 的 **`app`** schema（`Game` / `Task` / `AppSettings` / `RateLimit`）；`public` 与引擎共用时可放 LangGraph、向量表等。客户端生成到 `generated/prisma/`（`postinstall` / `build` 时生成）。

更完整的本地启动与 AI Gateway 说明见仓库根目录 **[../QUICKSTART.md](../QUICKSTART.md)**。

## 常用命令

```bash
npm install
npx prisma migrate dev   # 改 schema 后生成并应用迁移；全新库也可用 migrate deploy
npm run dev               # 默认 http://localhost:3000
```

不要用 **`prisma db push`** 代替迁移：它只改库结构、**不写 `_prisma_migrations`**，会和 Migrate 历史脱节并引发 P3005/drift。需要原型阶段可本机临时执行 `npx prisma db push`，**不要**放进 npm scripts。

### Supabase `config.toml` 里的 `[api].schemas`

只影响 **PostgREST**（`http://127.0.0.1:54321` 的自动 REST）和 **Studio 里对哪些 schema 建 API/展示**，**不会**替你执行 `supabase/migrations` 或 Prisma 迁移。  
`next_auth` 若库里早就有该 schema（例如装过 Auth 相关迁移），即使暂不重启，只要没改 PostgREST 配置或没打到缺失的 schema，往往不会暴露问题；**`app`** 若在配置里写了但库里尚未 `CREATE SCHEMA app`，PostgREST 一加载配置就会报错（见仓库根 `supabase/config.toml` 注释）。

### `db push` 之后 `migrate dev` / `migrate deploy` 报 P3005、drift

`db push` 只把结构推到数据库，**不写** `_prisma_migrations` 历史。之后 Migrate 会认为「库非空却没有任何已应用迁移」。本地可任选：

- **保留当前结构、只补历史记录**（结构与迁移文件一致时）：  
  `npx prisma migrate resolve --applied 20260411120000_consolidated_app_and_next_auth`

### `migrate deploy` / `migrate reset` 一直 P3005（Supabase 共用库 + `schemas = ["app"]`）

Prisma 在 **multi-schema** 下对「是否空库」的判断容易与共用库冲突；**仅删迁移表、DROP `app` 后，`migrate deploy` 仍可能 P3005**。可靠做法：

```bash
npm run db:reset-app-schema   # 删 public._prisma_migrations + DROP SCHEMA app（不预建空 app）
npm run db:apply-migration    # 执行 migration.sql + migrate resolve --applied
```

`db:apply-migration` 等价于手工跑迁移 SQL 再登记历史，不依赖 `deploy` 的首次校验。**之后**新增迁移可再试 `npx prisma migrate dev` / `deploy`。

## 规则书流程（步骤一 / 二）

- **步骤一**：来源三选一 — **PDF**、**多图**、**集石 URL**（`POST /api/games/[gameId]/rule-image-preview` 拉取图片 URL 列表）。点「确认并分页」后调用 `POST /api/games/[gameId]/upload`（或直传 Storage 后 JSON `finalize`），由规则引擎 `POST /extract/pages` 生成分页缩略图 URL（存 `Game.pagePreviewJson`）。
- **步骤二**：在缩略图上 **点选目录页 / 排除页**，再 `POST /api/games/[gameId]/extract`。

## 与规则引擎的衔接

- **上传 / 任务**：`POST /api/tasks`（multipart：`gameId`、`file`，可选 `terminologyContext`）→ 调用规则引擎 `POST /extract`（附带 **`X-Boardrule-Ai-Config`**）。
- **轮询**：任务详情 `GET /api/tasks/[taskId]` 会同步规则引擎任务状态并写回导出文件路径。
- **问答**：`POST /api/chat` 代理规则引擎 `POST /chat`；**需先**对该 `game_id` 完成向量索引（游戏详情 **建立索引**，引擎侧为 `POST /build-index/start` + 轮询，见 **QUICKSTART.md**）。

## 微信小程序 & 每日限流

`POST /api/chat` 支持按微信用户（openid）的每日对话次数限制：

| 路由 | 说明 |
|------|------|
| `POST /api/wx-login` | 接收小程序 `uni.login()` 返回的 `code`，调用微信 `jscode2session` 换取 openid，返回 `{ userId }` |
| `GET /api/settings/wechat` | 读取微信配置公开信息（AppID、hasSecret、secretLast4、dailyChatLimit） |
| `PATCH /api/settings/wechat` | 更新 `{ appId?, appSecret?, dailyChatLimit? }`；AppSecret 加密后存入 `AppSettings.wechatConfigJson` |

**限流逻辑**（`lib/rate-limit.ts`）：

- 请求携带 `x-user-id` header（值为 openid）时触发检查；无此 header 则跳过（本地直接调用不受影响）
- 每次请求对 `RateLimit` 表做 upsert（key 格式：`wx:{openid}:{YYYY-MM-DD}`），超过 `dailyChatLimit` 则返回 **429**
- `dailyChatLimit = 0` 表示不限制
- DB 异常时 fail open（请求照常通过），不影响正常使用

**配置入口**：系统设置页（`/settings`）→「微信小程序」卡片，填写 AppID / AppSecret 并设置每日限额。

## 存储

`Game` 表只保存 **对象键 / 相对路径**（如 `games/<id>/exports/rules.md`），不保存正文。若配置了 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`，**uploads** 走 raw 桶、**exports** 走 exports 桶；提取完成后会尝试 **删除 raw 桶**该游戏下的 uploads。否则使用 `apps/web/storage/`（见 `.gitignore`）。
