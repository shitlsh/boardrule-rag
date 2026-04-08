/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3"],

  /**
   * CORS headers for miniapp (UniApp WeChat mini-program).
   *
   * uni.request is a native HTTP call, not a browser fetch, so CORS headers are
   * not strictly required during development. They are needed when the BFF is
   * deployed to an HTTPS domain and called from H5 builds or WebView contexts.
   *
   * Set MINIAPP_ALLOWED_ORIGIN in .env.local to restrict to a specific origin
   * in production (e.g. https://your-domain.com). Defaults to "*".
   */
  async headers() {
    const allowedOrigin = process.env.MINIAPP_ALLOWED_ORIGIN ?? "*";
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: allowedOrigin },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type,Authorization" },
        ],
      },
    ];
  },
};

export default nextConfig;
