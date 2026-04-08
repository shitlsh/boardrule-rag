# 微信小程序开发调试指南

本文档面向第一次开发微信小程序的开发者，完整说明如何在本地调试并最终发布这个基于 UniApp 的桌游规则助手小程序。

---

## 目录

1. [前置条件](#1-前置条件)
2. [项目结构说明](#2-项目结构说明)
   - [微信登录与每日限流](#微信登录与每日限流)
3. [第一步：确认 BFF（后台服务）已启动](#3-第一步确认-bff后台服务已启动)
4. [第二步：注册微信小程序账号（申请 AppID）](#4-第二步注册微信小程序账号申请-appid)
5. [第三步：安装微信开发者工具](#5-第三步安装微信开发者工具)
6. [第四步：编译小程序代码](#6-第四步编译小程序代码)
7. [第五步：在微信开发者工具中导入并调试](#7-第五步在微信开发者工具中导入并调试)
8. [第六步：真机预览（手机扫码）](#8-第六步真机预览手机扫码)
9. [环境变量说明](#9-环境变量说明)
10. [常见问题排查](#10-常见问题排查)
11. [生产部署（上线）](#11-生产部署上线)

---

## 1. 前置条件

在开始之前，请确认本机已安装：

| 工具 | 版本要求 | 安装方式 |
|---|---|---|
| Node.js | >= 20.19 | https://nodejs.org |
| npm | >= 10（随 Node.js 附带） | — |
| 微信开发者工具 | 最新稳定版 | 见第 5 步 |

此外，整个后端服务栈（数据库 + rule_engine + Next.js BFF）需已按照根目录 `QUICKSTART.md` 完成配置并能正常运行。

---

## 2. 项目结构说明

```
apps/miniapp/
├── src/
│   ├── api/bff.ts          # 调用 Next.js BFF 的 HTTP 封装（含 x-user-id header）
│   ├── store/chat.ts       # Pinia 状态管理（含本地持久化）
│   ├── types/index.ts      # TypeScript 类型定义
│   ├── utils/
│   │   ├── env.ts          # BFF 地址配置
│   │   └── auth.ts         # 微信登录 & openid 缓存（getOrFetchUserId）
│   ├── pages/
│   │   ├── index/          # 游戏列表页（小程序首页）
│   │   └── chat/           # 规则问答对话页
│   ├── wxcomponents/
│   │   └── towxml/         # Markdown 渲染原生组件（已内置，无需额外配置）
│   ├── manifest.json       # 小程序基本信息（AppID 在这里填写）
│   └── pages.json          # 页面路由配置
├── .env.development        # 开发环境 BFF 地址
├── .env.production         # 生产环境 BFF 地址
└── package.json
```

**数据流向：**

```
微信小程序 (UniApp)
    ↓  uni.login() → code
POST /api/wx-login  ──→  微信 jscode2session API
    ↓  openid (userId) 缓存到 storage
    ↓  后续请求携带 x-user-id: {openid}
Next.js BFF (apps/web，运行在你的电脑或服务器上)
    ↓  检查每日限额（RateLimit 表）
    ↓  内部 HTTP
rule_engine (Python FastAPI)
    ↓
Gemini AI + pgvector
```

---

## 微信登录与每日限流

小程序在进入对话页（`onShow`）时会自动执行以下流程，用于限制每位用户每天的提问次数：

### 登录流程

1. `utils/auth.ts` 的 `getOrFetchUserId()` 先检查本地 storage（key: `wx_user_id`）
2. 若无缓存，调用 `uni.login()` 获取临时 `code`
3. 向 `POST /api/wx-login` 发送 `{ code }`，BFF 调用微信 `jscode2session` 换取 **openid**
4. openid 缓存到本地 storage，后续请求无需重新登录

### 限流机制

- 每次发送消息时，`sendChatMessage` 会在请求头中附加 `x-user-id: {openid}`
- BFF 读取此 header，在 `RateLimit` 表中对当天的计数做 upsert
- 达到每日上限时，BFF 返回 **HTTP 429**，小程序在对话中展示：`⏰ 今日提问次数（N 次）已用完，明天再来吧`

### 对本地开发的影响

**不影响。** 如果 `uni.login()` 失败或 BFF 未配置微信 AppID/AppSecret，`getOrFetchUserId()` 返回 `null`，请求不带 `x-user-id` header，BFF 直接跳过限流。

### 管理限额

在 Next.js 管理后台 **系统设置 → 微信小程序**：

- 填写 AppID 和 AppSecret（AppSecret 加密存储，不明文保存）
- 设置「每日对话次数上限」（默认 20，填 0 表示不限制）

---

## 3. 第一步：确认 BFF（后台服务）已启动

小程序本身不包含任何 AI 逻辑，所有数据来自 Next.js BFF。开始调试前，请确认以下服务都在运行：

### 3.1 启动 Supabase（本地数据库）

```bash
# 在项目根目录执行
supabase start
```

### 3.2 启动 rule_engine（Python AI 服务）

```bash
cd services/rule_engine
uv run uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

### 3.3 启动 Next.js BFF

```bash
cd apps/web
npm run dev
# 默认运行在 http://localhost:3000
```

### 3.4 验证 BFF 可访问

在浏览器访问 http://localhost:3000/api/games，如果返回 JSON 数组（即使是空数组 `[]`）则说明 BFF 正常运行。

> **注意：** 如果你在非本机（例如局域网内的另一台设备）进行真机调试，需要将 `http://localhost:3000` 替换为本机的局域网 IP，例如 `http://192.168.1.100:3000`。查看本机 IP 的方法：
> - macOS: `ifconfig | grep "inet " | grep -v 127.0.0.1`
> - Windows: `ipconfig` 查看 IPv4 地址

---

## 4. 第二步：注册微信小程序账号（申请 AppID）

微信小程序需要一个专属的 **AppID** 才能在真机上预览和发布。

### 4.1 注册步骤

1. 打开 https://mp.weixin.qq.com
2. 点击右上角「立即注册」→ 选择「小程序」
3. 填写邮箱、设置密码，按引导完成注册（需要绑定微信扫码验证）
4. 注册成功后，登录微信公众平台
5. 进入「开发」→「开发管理」→「开发设置」，找到 **AppID**（形如 `wx1234567890abcdef`）

### 4.2 填写 AppID 到项目

编辑 `src/manifest.json`，将 `mp-weixin.appid` 的值替换为你的 AppID：

```json
{
  "mp-weixin": {
    "appid": "wx你的AppID",
    ...
  }
}
```

> **开发阶段可以先不填 AppID：** 微信开发者工具支持「测试号」模式，不填 AppID 也能在模拟器中运行，但无法真机预览。建议尽早申请，避免后期再补。

---

## 5. 第三步：安装微信开发者工具

1. 前往官方下载页：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
2. 选择「稳定版」，下载对应操作系统的安装包（macOS / Windows）
3. 安装完成后，**用微信扫码登录**

---

## 6. 第四步：编译小程序代码

UniApp 需要先将 Vue 代码编译成微信小程序格式（`.wxml` / `.wxss` / `.js`），编译产物在 `dist/dev/mp-weixin/` 目录。

### 6.1 安装依赖（首次）

```bash
cd apps/miniapp
npm install
```

### 6.2 启动开发模式（监听文件变化，自动重新编译）

```bash
npm run dev:mp-weixin
```

编译成功后会看到类似输出：

```
[vite] build started...
[vite] ✓ built in 3.2s
```

编译产物位于：`apps/miniapp/dist/dev/mp-weixin/`

> **保持此终端运行**：修改源码后会自动重新编译，微信开发者工具会检测到变化并刷新。

---

## 7. 第五步：在微信开发者工具中导入并调试

### 7.1 导入项目

1. 打开微信开发者工具
2. 点击左上角「+」→「导入项目」
3. 填写以下信息：
   - **项目目录**：选择 `apps/miniapp/dist/dev/mp-weixin/`（注意：是编译**产物**目录，不是源码目录）
   - **AppID**：填写你的 AppID，或选择「测试号」
4. 点击「导入」

### 7.2 关闭域名校验（开发必须）

微信小程序默认只允许请求已备案的 HTTPS 域名。开发阶段本地服务是 HTTP，需要暂时关闭校验：

1. 在微信开发者工具顶部菜单：**「详情」**（右上角）→「本地设置」
2. 勾选 ✅ **「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**

> 这个选项只在开发阶段生效，不会影响正式发布的小程序。

### 7.3 配置 BFF 地址

编辑 `apps/miniapp/.env.development`，确认 BFF 地址正确：

```env
# 如果在本机调试（模拟器）
VITE_BFF_BASE_URL=http://localhost:3000

# 如果要在真机上调试（手机和电脑在同一局域网）
# VITE_BFF_BASE_URL=http://192.168.x.x:3000
```

修改 `.env.development` 后需要**重新执行** `npm run dev:mp-weixin` 使配置生效。

### 7.4 调试界面说明

微信开发者工具主界面分为三区：

```
┌─────────────────────────────────────────────┐
│  模拟器（左）  │  编辑器（中）  │  调试器（右）  │
└─────────────────────────────────────────────┘
```

- **模拟器**：实时预览小程序 UI，可选手机型号
- **调试器 → Console**：查看 `console.log` 输出和错误信息
- **调试器 → Network**：查看网络请求，用于确认 BFF 调用是否成功

---

## 8. 第六步：真机预览（手机扫码）

在模拟器中验证功能后，可以在真实手机上预览：

1. 点击顶部工具栏「预览」按钮
2. 微信开发者工具会生成一个二维码
3. 用**注册小程序时绑定的微信账号**扫码（或在微信公众平台 → 开发 → 开发管理 → 开发者列表，添加体验者微信号）
4. 手机微信会自动打开小程序

> **真机调试时的网络要求：** 手机和电脑必须在同一局域网（同一 Wi-Fi）。BFF 地址需改为电脑的局域网 IP（如 `http://192.168.1.100:3000`），不能用 `localhost`。

---

## 9. 环境变量说明

### miniapp 环境变量

| 文件 | 变量 | 说明 |
|---|---|---|
| `.env.development` | `VITE_BFF_BASE_URL` | 开发环境 BFF 地址，用于 `npm run dev:mp-weixin` |
| `.env.production` | `VITE_BFF_BASE_URL` | 生产环境 BFF 地址，用于 `npm run build:mp-weixin` |

### BFF（apps/web）相关

在 `apps/web/.env` 或 `apps/web/.env.local` 中，可选配置：

| 变量 | 说明 | 默认值 |
|---|---|---|
| `MINIAPP_ALLOWED_ORIGIN` | 允许小程序跨域访问的来源（H5/WebView 场景） | `*`（全部允许） |

> 微信小程序原生请求（`uni.request`）不经过浏览器，**不受 CORS 限制**，无需配置此变量也能正常工作。仅当你同时提供 H5 版本时才需要收窄此配置。

---

## 10. 常见问题排查

### ❌ 模拟器显示「加载游戏列表...」一直转圈

**原因**：小程序无法访问 BFF。

**排查步骤**：
1. 调试器 → Network，看是否有请求发出，以及状态码
2. 确认 Next.js BFF 正在运行（浏览器访问 http://localhost:3000/api/games 应返回 JSON）
3. 确认已勾选「不校验合法域名」（见第 7.2 步）
4. 确认 `.env.development` 中的 `VITE_BFF_BASE_URL` 地址正确

### ❌ 游戏列表为空（显示「暂无可用游戏」）

**原因**：后台没有已建索引的游戏。

**处理方法**：
1. 打开 Next.js 管理后台 http://localhost:3000
2. 创建一个游戏，上传规则书，完成「提取规则」和「建立索引」两个步骤
3. 刷新小程序（在模拟器中点击右上角「⟳」重新加载）

### ❌ `Cannot read properties of undefined (reading 'index')`

**原因**：towxml 解析 Markdown 时遇到异常内容。

**处理方法**：检查 BFF 返回的 `quickStart` 字段内容是否为合法字符串（不是 `null` 或 `undefined`）。可在「调试器 → Console」中添加 `console.log` 排查。

### ❌ 真机上无法加载，提示「request:fail」

**原因**：真机无法访问 `localhost`。

**处理方法**：
1. 查看电脑局域网 IP（macOS: `ifconfig | grep "inet "`）
2. 修改 `.env.development`：`VITE_BFF_BASE_URL=http://192.168.x.x:3000`
3. 重新执行 `npm run dev:mp-weixin`
4. 确保手机和电脑在同一 Wi-Fi 网络

### ❌ 编译报错 `Cannot find module`

**处理方法**：
```bash
cd apps/miniapp
rm -rf node_modules
npm install
npm run dev:mp-weixin
```

### ❌ 对话框出现「⏰ 今日提问次数已用完」

**原因**：该微信账号当天已达到每日限额。

**排查步骤**：
1. 打开 Next.js 管理后台 → **系统设置 → 微信小程序**
2. 将「每日对话次数上限」调大或设为 `0`（不限制）后保存
3. 若想立即重置计数，可在数据库中删除对应 `RateLimit` 行（key 格式：`wx:{openid}:{YYYY-MM-DD}`）

> 开发调试时建议直接将限额设为 `0` 避免干扰。

### ❌ 微信登录失败（控制台报 `/api/wx-login` 返回 503）

**原因**：BFF 中未配置微信 AppID / AppSecret。

**处理方法**：
1. 打开 Next.js 管理后台 → **系统设置 → 微信小程序**
2. 填写 AppID 和 AppSecret 后保存
3. 确认 `apps/web/.env` 中已设置 `AI_CONFIG_SECRET`（32 字节十六进制，用于加密存储 AppSecret）

---

## 11. 生产部署（上线）

> 上线需要小程序通过微信审核，且 BFF 服务器必须有公网 HTTPS 域名。

### 11.1 部署 BFF 到公网服务器

将 `apps/web`（Next.js）部署到有公网 IP 的服务器（推荐 Vercel、Railway、或自建 VPS），获得 HTTPS 域名，例如 `https://api.yourdomain.com`。

### 11.2 配置小程序生产环境地址

编辑 `apps/miniapp/.env.production`：

```env
VITE_BFF_BASE_URL=https://api.yourdomain.com
```

### 11.3 编译生产包

```bash
cd apps/miniapp
npm run build:mp-weixin
```

产物在 `apps/miniapp/dist/build/mp-weixin/`。

### 11.4 配置微信公众平台合法域名

1. 登录 https://mp.weixin.qq.com
2. 进入「开发」→「开发管理」→「开发设置」→「服务器域名」
3. 在 **request 合法域名** 中添加你的 BFF 域名（必须 HTTPS）：
   ```
   https://api.yourdomain.com
   ```
4. 保存，等待生效（通常几分钟内）

### 11.5 在微信开发者工具中上传代码

1. 用微信开发者工具导入 `dist/build/mp-weixin/`
2. 点击右上角「上传」
3. 填写版本号和说明
4. 上传成功后，登录 https://mp.weixin.qq.com → 版本管理，提交审核

### 11.6 BFF 跨域配置（生产环境，H5 场景）

如果你同时发布 H5 版本，在 `apps/web/.env.local` 中设置：

```env
MINIAPP_ALLOWED_ORIGIN=https://api.yourdomain.com
```

微信小程序原生（非 H5）不需要此配置。

---

## 快速命令参考

```bash
# 在 apps/miniapp/ 目录下执行

# 安装依赖
npm install

# 开发模式（监听变化，自动编译）
npm run dev:mp-weixin

# 生产构建
npm run build:mp-weixin

# TypeScript 类型检查
npm run type-check
```
