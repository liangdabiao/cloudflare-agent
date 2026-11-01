import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// @cloudflare/vite-plugin 会自动：
// 1. 读取 wrangler.jsonc 中的 main（src/server.ts）作为 Worker 入口
// 2. 将 index.html 引用的 src/client.tsx 作为前端客户端入口
// 3. dev 模式下同时启动 Vite 开发服务器与 Worker 运行时（workerd）
export default defineConfig({
  plugins: [cloudflare()],
});
