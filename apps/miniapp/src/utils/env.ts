/**
 * BFF 基础 URL。
 *
 * 开发时：在微信开发者工具中关闭「校验合法域名」，可使用本地地址。
 * 生产时：改为已备案的 HTTPS 域名并在微信后台配置合法域名白名单。
 *
 * 通过 Vite 环境变量注入，在 .env.development / .env.production 中配置：
 *   VITE_BFF_BASE_URL=http://localhost:3000
 */
export const BFF_BASE_URL: string =
  (import.meta.env.VITE_BFF_BASE_URL as string | undefined) ?? 'http://localhost:3000'
