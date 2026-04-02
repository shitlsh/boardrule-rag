# boardrule-rag — Web (`apps/web`)

Next.js 14（App Router）管理端：游戏元数据、规则书上传、任务与提取状态轮询。仅通过环境变量 **`RULE_ENGINE_URL`** 调用 `services/rule_engine`，无其他 AI 后端。

## 环境变量

复制示例并填写：

```bash
cp .env.example .env
```

| 变量 | 说明 |
|------|------|
| `RULE_ENGINE_URL` | 规则引擎根地址，如 `http://127.0.0.1:8000` |
| `DATABASE_URL` | Prisma 连接串；本地 SQLite 示例见 `.env.example` |

数据库 URL 同时用于 **`prisma.config.ts`**（Prisma ORM 7）。客户端生成到 `generated/prisma/`（`postinstall` / `build` 时生成）。

## 常用命令

```bash
npm install
npx prisma migrate dev   # 首次或 schema 变更后
npm run dev               # 默认 http://localhost:3000
```

## 与规则引擎的衔接

- **上传 / 任务**：`POST /api/tasks`（multipart：`gameId`、`file`，可选 `terminologyContext`）→ 调用规则引擎 `POST /extract`。
- **轮询**：任务详情 `GET /api/tasks/[taskId]` 会同步规则引擎任务状态并写回导出文件路径。
- **问答**：`POST /api/chat` 代理规则引擎 `POST /chat`；**需先**对该 `game_id` 在引擎侧执行 `POST /build-index`（见仓库根目录 **QUICKSTART.md** 与 `services/rule_engine/eval/README.md`）。当前 Web **不会**在提取完成后自动建索引。

## 存储

上传与导出的规则/快读/问题默认在 `apps/web/storage/`（见 `.gitignore`），路径写入 `Game` 表。

更完整的本地启动说明见仓库根目录 **[../QUICKSTART.md](../QUICKSTART.md)**。
