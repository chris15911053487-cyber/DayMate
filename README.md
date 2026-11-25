# DayMate

会听你说话的日历和个人小助手：语音录入日程、记录当天的事、AI 总结和建议、到点提醒、主题可 DIY。

- 需求：[docs/电子日历 APP的需求描述.md](docs/电子日历%20APP的需求描述.md)
- 技术方案与里程碑：[docs/技术方案.md](docs/技术方案.md)
- 进度、测试结果与待办：[docs/进度与待办.md](docs/进度与待办.md)

当前进度：**M4 提醒与推送已完成**（到点提醒、站内消息中心、浏览器推送、邮件、AI 早报与晚间复盘、免打扰）。之前完成：M0 骨架与 12 套主题（`/styles`）、M1 账号、M2 日历与记录、M3 语音 + AI。

浏览器推送要在 `.env` 配 `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`（`npx web-push generate-vapid-keys` 生成一次，之后别换）。语音需要 HTTPS（或 localhost）才能用麦克风；`.env` 里配 `BAIDU_ASR_*` 和 `AI_*`（目前沿用 online-report 的百度语音和 DeepSeek）。

## 目录

```
apps/web         H5 / PWA 前端（React + Vite + Tailwind）
apps/server      后端（Fastify + Drizzle + PostgreSQL）
packages/shared  前后端共用的类型和校验规则
deploy/          Dockerfile、Caddyfile、备份脚本
```

## 一键部署（Docker）

```bash
cp .env.example .env          # 至少改 POSTGRES_PASSWORD；有域名就填 APP_DOMAIN
docker compose up -d --build
```

打开 `https://localhost`（本地证书浏览器会提示不安全，点继续）。服务：

| 服务 | 说明 |
|---|---|
| app | 前后端，启动时自动执行数据库迁移 |
| db | PostgreSQL 17（含 pgvector），只绑本机 127.0.0.1:5432 |
| caddy | 对外 80/443，自动 HTTPS |
| backup | 每天 3 点 pg_dump，保留 14 天（卷 `daymate_backups`） |

健康检查：`curl -k https://localhost/api/health`

测试邮件：`docker compose --profile dev up -d mailpit` 后打开 http://localhost:8025 查看验证邮件、找回密码邮件（`.env` 里 `SMTP_HOST=mailpit`）。

## 本地开发

```bash
npm install
npm run dev:deps              # Docker 起数据库（和 Mailpit）
SMTP_HOST=localhost SMTP_PORT=1025 npm run dev   # 后端 :3100 + 前端 :5173（Vite 把 /api 转给后端）
# 反复跑端到端测试时后端再加 RATE_LIMIT=off（仅开发有效），否则会碰到注册限流
```

开发时打开 `http://localhost:5173`；主题样张在 `/styles`。如果 Docker 版的 app 也在跑，先 `docker compose stop app caddy`，避免端口和数据库迁移冲突。

## 常用命令

```bash
npm run typecheck                    # 全部类型检查
npm test                             # 单元测试 + 接口测试（接口测试用 daymate_test 库，需先 npm run dev:deps）
npm run test:e2e                     # 浏览器端到端测试（需前后端和 Mailpit 在跑；E2E_BASE_URL=https://localhost 测 Docker 版）
npm run lint:colors -w @daymate/web  # 检查是否写死颜色（必须通过）
npm run db:generate                  # 改了 apps/server/src/db/schema.ts 后生成迁移
cd apps/server && npm run eval       # 一句话解析评测集（真实大模型，40 条）
VOICE_WAV=语音.wav npm run test:e2e   # 带上真实语音全链路测试（Chrome 假麦克风播放这段 16k wav）
```

## 约定

- 组件里只用主题语义色（`bg-primary`、`text-muted` …），不写死颜色；主题 token 在 `apps/web/src/theme/themes.css`。
- 前端请求一律走 `/api/...`，后端路由不写 `/api` 前缀（由 `rewriteUrl` 去掉）。
- 错误响应格式：`{ error, code, detail? }`。
- 密钥只放 `.env`，只提交 `.env.example`。
