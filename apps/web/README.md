# boardrule-rag — Web (`apps/web`)

Next.js（App Router）管理端：游戏元数据、规则书上传、任务与提取状态轮询。通过 **`RULE_ENGINE_URL`** 调用 `services/rule_engine`；**Gemini** 在 **`/models`** 配置后由 BFF 以请求头 **`X-Boardrule-Ai-Config`** 传给规则引擎。

## 环境变量

复制示例并填写：

```bash
cp .env.example .env
```

| 变量 | 说明 |
|------|------|
| `RULE_ENGINE_URL` | 规则引擎根地址（无尾部斜杠），如 `http://127.0.0.1:8000` |
| `DATABASE_URL` | Prisma 连接串：**Supabase 本地**（`postgres`@`54322`，见 `supabase status`）或托管项目 |
| `AI_CONFIG_SECRET` | **必填**：用于加密保存在数据库中的 Gemini API Key（AES-256-GCM）。未设置则无法在 **`/models`** 保存凭证 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 建议配置；桶 **`rulebook-raw`**（上传）与 **`game-exports`**（导出）由迁移创建；大文件可 **pre-sign 直传**；未设置时使用本地 `storage/` |
| `SUPABASE_STORAGE_BUCKET_RAW` | 可选；覆盖默认 `rulebook-raw` |
| `SUPABASE_STORAGE_BUCKET_EXPORTS` | 可选；覆盖默认 `game-exports` |

数据库 URL 同时用于 **`prisma.config.ts`**（Prisma ORM 7）。客户端生成到 `generated/prisma/`（`postinstall` / `build` 时生成）。

更完整的本地启动与 AI Gateway 说明见仓库根目录 **[../QUICKSTART.md](../QUICKSTART.md)**。

## 常用命令

```bash
npm install
npx prisma migrate dev   # 首次或 schema 变更后
npm run dev               # 默认 http://localhost:3000
```

## 规则书流程（步骤一 / 二）

- **步骤一**：来源三选一 — **PDF**、**多图**、**集石 URL**（`POST /api/games/[gameId]/rule-image-preview` 拉取图片 URL 列表）。点「确认并分页」后调用 `POST /api/games/[gameId]/upload`（或直传 Storage 后 JSON `finalize`），由规则引擎 `POST /extract/pages` 生成分页缩略图 URL（存 `Game.pagePreviewJson`）。
- **步骤二**：在缩略图上 **点选目录页 / 排除页**，再 `POST /api/games/[gameId]/extract`。

## 与规则引擎的衔接

- **上传 / 任务**：`POST /api/tasks`（multipart：`gameId`、`file`，可选 `terminologyContext`）→ 调用规则引擎 `POST /extract`（附带 **`X-Boardrule-Ai-Config`**）。
- **轮询**：任务详情 `GET /api/tasks/[taskId]` 会同步规则引擎任务状态并写回导出文件路径。
- **问答**：`POST /api/chat` 代理规则引擎 `POST /chat`；**需先**对该 `game_id` 在引擎侧执行 `POST /build-index`（见仓库根目录 **QUICKSTART.md** 与 `services/rule_engine/eval/README.md`）。当前 Web **不会**在提取完成后自动建索引。

## 存储

`Game` 表只保存 **对象键 / 相对路径**（如 `games/<id>/exports/rules.md`），不保存正文。若配置了 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`，**uploads** 走 raw 桶、**exports** 走 exports 桶；提取完成后会尝试 **删除 raw 桶**该游戏下的 uploads。否则使用 `apps/web/storage/`（见 `.gitignore`）。
