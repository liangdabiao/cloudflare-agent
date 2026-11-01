/**
 * Slack 凭据通过 `wrangler secret put` 注入（不是 vars，原因见 wrangler.jsonc 注释），
 * 因此 wrangler types 生成的 Env 不包含这三个字段 —— 用接口合并补齐
 * （全局 Env 与 Cloudflare.Env 两个声明都要合并到）。
 */
interface Env {
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
  SLACK_SIGNING_SECRET: string;
}

declare namespace Cloudflare {
  interface Env {
    SLACK_CLIENT_ID: string;
    SLACK_CLIENT_SECRET: string;
    SLACK_SIGNING_SECRET: string;
  }
}
