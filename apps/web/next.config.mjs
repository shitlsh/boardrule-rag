/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Native SQLite driver (better-sqlite3) must not be bundled into the server build.
    serverComponentsExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3"],
  },
};

export default nextConfig;
