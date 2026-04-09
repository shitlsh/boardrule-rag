# 桌游规则助手（uni-app）

C 端「桌游规则问答」客户端，基于 **uni-app 3 + Vue 3 + Vite**。默认发布 **H5**（浏览器 / 微信内置浏览器）；**微信小程序**为可选构建，与 H5 共用业务代码。

业务 API 由 monorepo 内的 Next.js BFF 提供：[apps/web](../web/README.md)。

## 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev:h5` | H5 开发（Vite；默认监听 `0.0.0.0` 便于局域网调试） |
| `npm run build:h5` | 生产静态资源 → `dist/build/h5` |
| `npm run dev:mp-weixin` | 微信小程序开发 |
| `npm run build:mp-weixin` | 小程序包 → `dist/build/mp-weixin`（用微信开发者工具导入） |
| `npm run type-check` | `vue-tsc` 类型检查 |

## 环境变量

通过 Vite 注入，见根目录下 `.env.development` / `.env.production`（生产文件通常 gitignore，需在构建环境配置）。

| 变量 | 含义 |
|------|------|
| `VITE_BFF_BASE_URL` | Next BFF 根地址，**无尾部斜杠**。本地一般为 `http://localhost:3000`；**双域名部署**时为 API 项目完整 URL（如 `https://api.example.com`）。 |

本地开发时，BFF 侧需设置 `MINIAPP_ALLOWED_ORIGIN` 为 H5 页面的 **完整 origin**（含协议与端口），否则浏览器会拦截跨域请求。详见下文「本地调试」。

## 本地调试（最短路径）

1. 按仓库根目录 [QUICKSTART.md](../../QUICKSTART.md) 启动数据库、rule_engine 与 **apps/web**（默认 `http://localhost:3000`）。
2. 在本目录执行 `npm install` 与 `npm run dev:h5`，终端会打印本地与局域网访问地址（端口以实际为准，常见 `5173`）。
3. 在 `apps/web/.env.local` 中设置：  
   `MINIAPP_ALLOWED_ORIGIN=http://localhost:<H5端口>`  
   用手机访问电脑时，改为 `http://<电脑局域网IP>:<H5端口>`，并同步修改 `MINIAPP_ALLOWED_ORIGIN`。
4. `.env.development` 中 `VITE_BFF_BASE_URL` 指向本机或局域网 BFF；手机访问时需填电脑的局域网 IP，而非 `localhost`。

更多步骤（微信开发者工具、小程序上传、生产部署、双 **Vercel** 项目等）见 **[DEVELOPMENT.md](./DEVELOPMENT.md)**。

## 与 BFF 的约定

- 鉴权：请求头 `Authorization: Bearer <miniapp JWT>`（见 `src/api/bff.ts`、`src/utils/auth.ts`）。
- H5：匿名会话由 `POST /api/h5-auth` 签发 JWT；微信小程序由 `POST /api/wx-login`（`code` → openid）签发。
- 聊天限次：BFF 按 **每 IP** 与 **全站 C 端每日总量**（系统设置 → C 端对话限额；与 JWT `sub` 无关）。同一公网 IP 共享每 IP 额度。

## 生产构建（H5）

```bash
npm ci
npm run build:h5
```

产物目录：`dist/build/h5`。可部署到任意静态托管；若与 API **不同源**，构建时注入的 `VITE_BFF_BASE_URL` 须为线上 API 根地址，并在 API 环境配置 `MINIAPP_ALLOWED_ORIGIN` 为 H5 站点 origin。

本目录下的 [vercel.json](./vercel.json) 供 **Vercel** 将本包作为**静态站点**项目时的构建参考（与 `apps/web` 分离为两个 Vercel 项目时使用）。
