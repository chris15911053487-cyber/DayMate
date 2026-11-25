# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

DayMate：面向公开用户（ToC）的语音日历 + 个人小助手。H5/PWA 先行，后期扩展 App（Capacitor）和微信小程序（Taro）。

- 需求原文：`docs/电子日历 APP的需求描述.md`
- **技术方案与里程碑**：`docs/技术方案.md`（架构、数据模型、接口清单、分期 P1/P2/P3、M0–M6 里程碑）。实现与方案不一致时，同步改方案文档。
- 当前进度：M0–M4 已完成；下一步 M5 个性化。**各里程碑结果和待办清单在 `docs/进度与待办.md`**，完成一个里程碑或发现新的遗留问题时同步更新它。
- 语音、主题、推送等做法参考姊妹项目 `~/Documents/AI/Claude/online-report`（方案第 6.2 节列了要移植的文件）。

## 常用命令

```bash
npm install
npm run dev:deps                                   # Docker 起 PostgreSQL（127.0.0.1:5432）+ Mailpit
SMTP_HOST=localhost SMTP_PORT=1025 npm run dev     # 后端 :3100 + 前端 :5173（Vite 把 /api 代理到 3100）
npm run build
npm run typecheck                                  # 全部工作区类型检查
npm test                                           # 全部单测 + 接口测试
npm run lint:colors -w @daymate/web                # 禁止写死颜色，必须通过
npm run db:generate                                # 改了 apps/server/src/db/schema.ts 后生成迁移 SQL
cd apps/server && npm run eval [-- 关键词]          # 一句话解析评测集（真实模型，读根目录 .env）；改提示词或换模型前后都跑
npm run test:e2e                                   # Playwright（需前后端 + Mailpit 在跑；后端加 RATE_LIMIT=off 避免注册限流）
E2E_BASE_URL=https://localhost npm run test:e2e    # 测 Docker 部署版

# 单个测试
cd apps/server && npx vitest run test/auth.test.ts -t "注销"
cd apps/web && npx vitest run src/theme/themes.test.ts
npx playwright test -g "注册表单"

# 部署（本机）
docker compose up -d --build                       # app + db + caddy(HTTPS) + backup；打开 https://localhost
docker compose --profile dev up -d mailpit         # 测试邮件网页 http://localhost:8025
```

- 后端开发端口是 3100（不是 3000）：本机 online-report 的容器占着 3000。镜像里固定 3000。
- 接口测试连真实数据库 `daymate_test`（`apps/server/test/global-setup.ts` 自动建库并迁移），先 `npm run dev:deps`。按文件串行跑。
- Playwright 用本机 Chrome（`channel: 'chrome'`），不用下载浏览器。
- 本机 shell 设了 http_proxy，curl 本地服务要加 `--noproxy '*'`，跑 Playwright 时加 `NO_PROXY='*'`。

## 架构

npm workspaces 单仓库：

- `packages/shared`：zod 校验规则、类型、主题 id 列表。**直接导出 TS 源码**（`exports` 指向 `src/index.ts`）：Vite 和 tsx 直接吃源码；后端构建时由 tsup 打进产物（`noExternal`），所以运行镜像里不需要这个包。
- `apps/server`：Fastify 5 + Drizzle ORM + PostgreSQL 17（pgvector 镜像）。
- `apps/web`：React 19 + Vite + Tailwind 4 + React Router 7。

### 后端要点

- `/api` 前缀：`app.ts` 的 `rewriteUrl` 去掉 `/api` 后再匹配，**路由本身不写 `/api`**。其他地址都改写到内部前缀 `/__web`：静态文件按名字命中，其余 GET 页面回退 `index.html`。所以页面地址可以和接口同名（页面 `/me` 和接口 `GET /api/me` 互不影响），不带 `/api` 的地址永远碰不到接口。健康检查是 `/api/health`。
- `buildApp(opts)` 不传 `auth` 时只有健康检查（外壳测试用）；`auth: AuthDeps` 注入 db、mailer、jwt 密钥等，测试用 `test/helpers.ts` 的 `setupTestApp()`，它会收集邮件并可关掉限流。
- 错误：抛 `HttpError(status, code, 中文提示)`，统一转成 `{ error, code, detail? }`。请求体用 `lib/validate.ts` 的 `parse(schema, body)`，校验规则来自 shared，前后端提示一致。
- 迁移：drizzle-kit 生成到 `apps/server/drizzle/`，启动时自动执行。
- 后台任务跑在 app 进程内（`src/jobs/`），目前是每小时的清理任务：删除冷静期已过的注销账号、过期会话和令牌。
- 时间：库里一律 `timestamptz`，按用户时区（`users.timezone`）显示和计算。**不沿用** online-report 的"北京时间墙钟"约定。
- 主键：应用侧生成 UUID v7（`lib/uuid.ts`）。

### 账号与会话（M1）

- 访问令牌：JWT，30 分钟，前端**只放内存**。刷新令牌：`<会话id>.<随机串>`，库里只存哈希（`user_sessions`）。网页端放在 HttpOnly + SameSite=Strict 的 Cookie `dm_rt` 里，路径 `/api/auth`；App 端用 `client: 'app'` 时放在响应体。
- 每次刷新都换新令牌。已经换掉的旧令牌再被用：30 秒内返回 409 `REFRESH_RACE`（多标签页并发，客户端重试）；超过 30 秒就作废整个会话（视为泄露）。
- `app.authenticate` 每次请求都查一下会话是否还有效，所以踢设备、改密码、注销立即生效。
- 前端 `api/client.ts`：遇到 401 自动刷新并重试一次；多标签页用 `navigator.locks` 排队。登录状态在 `auth/store.ts`（`useAuth()`），路由守卫在 `auth/guards.tsx`。
- 邮件：配了 `SMTP_HOST` 就走 SMTP，没配就打印到日志。本机用 Mailpit：Docker 里填 `mailpit`，本机 dev 填 `localhost`。

### 日历、待办、记录（M2）

- 时区和重复规则都在 shared（`time.ts`、`recurrence.ts`，基于 Intl，无第三方库，前后端共用）。日期一律用"日期键" `'YYYY-MM-DD'`，墙上时间用 `'HH:mm'`。
- 日程：带时间的存 `start_at/end_at`（timestamptz），全天的存 `start_date/end_date`（含结束那天）。`timezone` 列记录创建时用户的时区，带时间的重复日程按这个时区展开墙上时间。
- `GET /events?from&to` 的日期按**用户当前时区**解释，返回展开后的场次（`Occurrence`，重复日程的 key 是 `id:日期`）。展开逻辑是纯函数 `modules/calendar/occurrences.ts`，有单测。
- 前端表单里的时间都是用户时区的墙上时间，服务端用 `inputToColumns` 换算；前端显示用 `utils/datetime.ts` 的 `useTz()`（用户设置的时区，不用设备时区）。
- 删除一律软删除，30 天内可以用 `POST /:kind/:id/restore` 撤销（前端删除后弹"撤销"提示），清理任务删除超过 30 天的。
- 日历本颜色只能选 5 个语义色名（primary/accent/success/warning/danger），类名映射在 `components/calendar/colors.ts`。
- 前端数据用 TanStack Query（`api/queries.ts`）。修改成功后按 `AFFECTS` 表让相关列表失效；切换账号会清空缓存，时区变了全部重新取。

### 语音与 AI（M3）

- 链路：`voice/VoiceButton`（按住录音；轻点 = 打字）→ `voice/recorder.ts`（移植自 online-report：16k 单声道、裁静音、WAV）→ `POST /api/speech/recognize`（`asr/baidu.ts`）→ `voice/AssistantSheet` → `POST /api/assistant/parse` → 可编辑卡片（`voice/DraftCard`）→ `POST /api/assistant/commit`。
- 外部服务都是可注入的接口：`AppDeps.asr`（`asr/index.ts`）、`AppDeps.llm`（`ai/llm.ts`，OpenAI 兼容的 Chat Completions，只用 fetch，强制 json_object）。没配置时：语音返回 503，解析直接退回"存成记录"。测试里用假的 asr / llm（见 `test/assistant.test.ts`）。
- 提示词在 `modules/assistant/prompt.ts`：**系统提示词必须固定不变**（前缀缓存）；当前时间、四周日期对照表、输入方式、原话都放用户消息。模型只输出墙上时间，时区换算在服务端。
- 解析流程（`modules/assistant/parse.ts`）：先修正常见格式问题（`normalizeItem`），再逐项校验；全部不合格就把问题交回模型重试一次；还不行或模型出错，就把原话存成记录草稿（`fallback: true`），用户说的话不能丢。提问是两次调用：先解析出日期范围，查库后再回答。
- 改提示词后跑 `npm run eval`（`eval/cases.json`，固定"现在"为 2026-11-24 周二 22:30），不要让通过率下降。
- 额度：`usage_daily` 按用户时区的日期计，`QUOTA_ASR_PER_DAY` / `QUOTA_AI_PER_DAY`（默认各 100）。`voice_logs` 只存文字（90 天），`ai_calls` 只存用量和耗时（180 天）。
- 真实语音端到端测试：`VOICE_WAV=… npm run test:e2e`，用 macOS `say -v Tingting` 生成语音再转 16k wav；Chrome 假麦克风参数见 `e2e/voice.spec.ts`。

### 提醒与推送（M4）

- **所有主动推送只调 `modules/notify/notify.ts` 的 `notify()`**：先写站内消息（`notifications`），再按用户设置和免打扰发 Web Push、邮件，结果记在 `notification_deliveries`。不要另写发送逻辑。免打扰只拦早报、复盘、建议，不拦日程提醒。
- 提醒是队列（`reminders` 表）：日程、待办的增删改都要调 `modules/reminders/schedule.ts` 的 `syncEventReminders` / `syncTaskReminders` 重排（已在日历、待办、助手的路由里调用，新增修改入口也要调）。重复日程只排下一场，发完由调度器排下一场；唯一索引（日程 + 场次 + 提前量）防止重复。
- 后台任务 `jobs/scheduler.ts`：每 30 秒 `runReminderTick`（`FOR UPDATE SKIP LOCKED` 取到期提醒；晚了 30 分钟以上算"错过"，只写站内不推送），每分钟 `runBriefTick`（到了用户设定时间、3 小时内、7 天内用过才生成）。两个函数都接收 `now`，测试里直接传时间。
- **原生 SQL 里不能直接放 Date**（postgres-js 会报错），要 `${d.toISOString()}::timestamptz`；Drizzle 的 `lt(col, date)` 这类写法没问题。
- 早报 / 复盘：`modules/briefs/generate.ts`，系统提示词固定，数据和【现在】的时间放用户消息；模型不可用时 `ruleBrief` 兜底（`model: 'rule'`）。
- Web Push：`push/index.ts`（web-push 4.x 是纯 ESM，用 `import * as webpush`），VAPID 密钥在 `.env`。前端 `public/sw.js` 只处理推送和点通知，不缓存页面；`push/device.ts` 判断这台设备能不能订阅（微信、非 HTTPS、iPhone 没添加到主屏幕、权限被拒都会给出原因）。
- 页内提醒：`layout/LiveNotifications.tsx` 每分钟取一次未读数，变多了就弹出最新一条。

### 主题系统

- 12 套预设主题。id 和分组（经典 / 个性）在 `packages/shared/src/theme.ts`，token 在 `apps/web/src/theme/themes.css`，用 `[data-theme='id']` 切换，任意元素都可以局部套用（样张页 `/styles` 就是这么做的）。
- 颜色 token 是 RGB 三元组；`styles.css` 的 `@theme inline` 把它们映射成语义类（`bg-primary`、`text-muted`、`rounded-card`、`font-display` …），并清空了 Tailwind 默认调色板。纹理背景、卡片边框和阴影、标题字体、文字发光也是 token；组件类 `.card`、`.display`、`.app-surface`、`.timeline-rail` 会消费这些 token。
- 文件开头有一个 `:root, [data-theme]` 默认块，负责重置非颜色 token，防止外层主题的效果漏进嵌套主题。新增 token 要先在默认块给值，再按需在各主题里覆盖。
- **组件里禁止写死颜色**（十六进制色值、`rgb()` 字面量、`bg-slate-100` 这类原始调色板类名），`lint:colors` 会检查。`src/theme/` 目录不检查。
- `src/theme/themes.test.ts` 按 WCAG 公式检查每套主题的对比度（正文 ≥7、次要文字 ≥4.5、按钮文字 ≥4.5 …），新增或修改主题必须通过。
- `index.html` 里有一段内联脚本，在 React 启动前从 localStorage 读出 `daymate.theme` 并套上，避免闪烁。所以 helmet 的 CSP 目前是关着的，M6 改成按 hash 放行。

### 前端约定

- 表单校验直接用 shared 的 zod 规则（`pages/auth/form.ts` 的 `fieldErrors` / `useFormState`）。用户改了某个字段就清掉该字段的错误；用 `fieldForCode` 把服务端错误码（如 `USERNAME_TAKEN`）映射回对应的输入框。
- 通用组件在 `src/ui/`（`Button`、`TextField`、`Alert`、`Modal`）。界面要同时适配手机和电脑：手机是底部导航，中间是大语音按钮；电脑（`lg` 及以上）是左侧导航。
- `src/sample.ts` 和 `SampleTodayView` 只给主题样张页 `/styles` 用；真实首页是 `pages/TodayPage.tsx`。

## 部署

- `deploy/Dockerfile`：三阶段构建。build 阶段 `npm ci` 后构建 web 和 server；prod-deps 阶段只装 server 的生产依赖；运行镜像里放 `dist/`、`drizzle/`、`public/`（前端产物）。`NPM_REGISTRY` 默认用 npmmirror。
- `docker-compose.yml`：app（不对外暴露端口）、db（只绑 127.0.0.1:5432）、caddy（80/443，设了 `APP_DOMAIN` 就自动申请证书）、backup（每天 3 点 pg_dump，保留 14 天）、mailpit（dev profile）。
- 生产环境必须设置 `JWT_SECRET`，否则启动失败。本机 `.env` 已被 git 忽略；数据卷是用密码 `daymate` 初始化的，改 `POSTGRES_PASSWORD` 前要先在数据库里改密码。
