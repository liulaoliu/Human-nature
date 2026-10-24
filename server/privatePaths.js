/**
 * dev server 绝不允许当静态文件吐出去的本机私密文件。
 *
 * Vite 的 `server.fs.deny` 一旦手写，就会**整体替换**默认的 `.env*` / `*.pem` 列表；
 * 这里把默认项连同项目自己的 `config.local.json` 一起列全，避免再漏。
 */
export const PRIVATE_FS_DENY = [
  '.env',
  '.env.*',
  '*.{crt,pem}',
  '**/.env',
  '**/.env.*',
  '**/*.{crt,pem}',
  '**/*.key',
  '**/config.local.json',
  '**/data/**',
]
