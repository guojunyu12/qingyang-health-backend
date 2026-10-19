# 邮箱验证码登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本地交付真实邮箱验证码注册登录、登录页、会话恢复和退出，并在 MySQL 8.4 验证迁移。

**Architecture:** 前端仓库保持 Next.js；独立 `server/` 仓库新增 NestJS API，使用 mysql2 单连接池、Redis限流、Nodemailer SMTP。前端同站 `/api/v1` 转发后端，凭据只使用 HttpOnly Cookie。

**Tech Stack:** Next.js、React、TypeScript、NestJS、mysql2/promise、MySQL 8.4、Redis、Nodemailer。

**Spec:** `docs/superpowers/specs/2026-10-19-email-auth-design.md`；后端副本 `server/docs/email-auth-design.md`。

## Global Constraints

- 不改已冻结 V001，SHA-256 保持 `64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56`。
- 邮箱验证码6位，300秒有效，60秒重发，最多5次错误；UTC存储、上海业务日。
- 真实SMTP配置从被忽略的服务端环境加载，禁止NEXT_PUBLIC_和秘密入库。
- 不实现M02–M06业务；不越权写积分表，不宣称未接PointsPort的团队整合完成。
- 前后端各使用 `codex/m01-email-auth` 功能分支，交付记录双方commit与schema版本。

## Review Focus

- 邮件发送失败或超时后，挑战不可被用于登录；旧挑战已失效也必须明确提示重发。
- 两个首次登录挑战并发命中同邮箱，仅创建一个用户；验证码错误次数不可回滚。
- 多个浏览器请求同时401只能刷新一次；旧刷新凭据重放撤销本设备会话。
- 账号切换清空演示缓存；业务仍标记演示，不能把已有seed当作该账号真实历史。
- 代理后的Origin/IP信任边界明确，非法returnTo、CSRF或额外字段被拒绝。

## Task 1：数据库与后端运行基础

**Files:** 后端 `package.json`、锁文件、`tsconfig.json`、`src/main.ts`、`src/app.module.ts`、`src/common/config.ts`、`src/common/database.ts`、`scripts/migrate.ts`、`db/migrations/V002__email_identity.sql`、`db/proposals/M01/CR-email-identity.md`、`tests/migrations.test.ts`。

- [ ] 先写迁移测试：空库V001→V002通过，现有空账号V001库升级通过，已有手机号账号时拒绝猜测转换，重复迁移不重跑，修改过校验值的迁移拒绝。
- [ ] 建立NestJS TypeScript入口，环境校验与统一错误/meta包装。配置显式读取后端私有环境文件，迁移使用独立管理凭据，运行服务使用应用账号。
- [ ] 迁移历史表记录版本、校验和、时间；MySQL DDL失败停止后续执行，不声称事务可自动回滚DDL。V002调整users和auth_challenges邮箱字段/索引/约束，增加挑战投递状态与必要会话访问凭据字段。
- [ ] 实现参数化连接池；每次取连接设置UTC，日期按字符串处理。事务接口不暴露commit给业务模块。
- [ ] 运行MySQL实机迁移测试及后端typecheck/build；在当前本地库执行核验后的迁移，记录真实结果。

## Task 2：认证与SMTP

**Files:** 后端 `src/modules/identity/{controller,service,crypto,mailer,limiter,session,dto}.ts`、`tests/auth.integration.test.ts`、`contracts/openapi/M01.yaml`。

**Interfaces:** `sendEmailCode(email, origin, ip)` 返回challenge元信息；`login(challengeId,code,deviceId)` 返回账号与只供Cookie层使用的凭据；`currentUser`、`csrf`、`refresh`、`logout`。邮件发送器通过可注入端口测试，生产必须真实SMTP。

- [ ] 先写失败用例：格式与额外字段、大小写规范化、错码5次、过期、消费/重发失效、SMTP失败、Redis故障关闭发送、邮箱/IP限流。
- [ ] 实现邮箱AES-GCM加密和独立HMAC查找，验证码摘要绑定challenge；随机密钥写入被忽略配置，不输出到日志。
- [ ] Redis原子限流：邮箱60秒一次、每小时5次，IP每小时20次；只信任明确配置的代理，默认不信任客户端X-Forwarded-For。SMTP外呼在事务外，发送状态变更后才允许使用挑战。
- [ ] 先写并发测试，再实现挑战锁、错误计数提交、账号唯一约束冲突回读、角色/会话/刷新凭据原子创建。M05开户仅预留明确端口，不加入假实现冒充整合验收。
- [ ] 实现15分钟访问凭据、7天会话及刷新上限；随机凭据仅存摘要。轮换锁序固定session→token；被消费token重放撤销该会话。短窗口重试方案若未完成，必须明确失败恢复行为，不能缓存明文凭据或绕过重放检查。
- [ ] 配置Cookie、Origin/CSRF检查、无敏感信息日志；H5响应不返回token。logout撤销会话并清Cookie。
- [ ] 跑认证集成测试，覆盖CSRF、重放、双用户隔离、并发登录和限流；更新完整认证OpenAPI。

## Task 3：登录页与客户端

**Files:** 前端 `src/app/login/page.tsx`、`src/features/auth/login.tsx`、`src/components/auth-provider.tsx`、`src/components/account-summary.tsx`、`src/lib/api/client.ts`、`src/app/layout.tsx`、`src/components/health-provider.tsx`、`src/features/profile/profile.tsx`、`next.config.ts`、`src/app/globals.css`、`tests/auth-client.test.ts`。

- [ ] 修改代码前阅读当前安装Next.js的rewrites及相关页面文档。
- [ ] 先写请求器测试：204不解析JSON、401刷新单飞、刷新失败退出、错误fields透传、不循环刷新。
- [ ] 建立同站API代理及统一客户端，运行时从环境配置后端地址，不向浏览器暴露秘密。
- [ ] 实现浅紫登录页、邮箱变更清除challenge、验证码输入、倒计时、防重复提交及role=alert错误；returnTo只接受注册的本站业务路径。
- [ ] AuthProvider负责GET/me恢复、未登录导航、退出和缓存清理。退出后禁止先展示旧用户内容；登录页不展示业务侧导航。
- [ ] 账号摘要作为独立组件接入“我的”，保留其他模块演示标记。健康本地状态按登录切换清理，避免显示旧账号记录。
- [ ] 前端单元测试、类型检查、构建通过；原演示E2E需显式认证夹具或独立测试模式，不在正式入口绕过认证。

## Task 4：完整联调与交付

**Files:** 前端 `tests/e2e/auth.spec.ts`；后端 `docs/HANDOFF-M01-email-auth.md`；双方README和配置示例。

- [ ] 浏览器测试使用注入邮件捕获适配器及独立测试库，不能从生产接口暴露验证码；覆盖注册、已有账号登录、错误保留、刷新恢复、退出、手机宽度无溢出及returnTo校验。
- [ ] 用真实163 SMTP发送验证码到用户明确授权的测试邮箱，报告SMTP接受与用户收件确认的区别；不自动读取私人收件箱。
- [ ] 各仓库运行必要测试，检查V001 SHA与秘密扫描，独立review认证、事务和缓存边界，修复后复验。
- [ ] 提交并推送前后端功能分支，不自动合并main或替换线上发布；交付文档记录迁移、启动步骤、已通过/未运行测试、SMTP真实状态、M05端口缺项与后续整合要求。
