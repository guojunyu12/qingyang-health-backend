# M02 整合说明

M02 来源：Mat11-oo/qingyang-health-m02，固定提交 e12407a93db524cd0cd470f0abbddb3a9c779f44。已将健康档案、饮水、体重、今日看板及 7/30 天个人大屏接入 M01 邮箱账号。

## 本地启动

沿用当前后端 `.env.local`，不复制队友的数据库、密码或测试账号。

```sh
npm ci
npm run migrate
npm run dev
# 上传和通知等 M01 异步功能需要在另一个终端运行：
npm run worker
```

本地 API：http://127.0.0.1:3002/api/v1。前端独立仓库在 http://127.0.0.1:3001，通过 Next rewrite 代理 API，不需要浏览器跨域 Cookie。

配置字段沿用 `.env.example`：PORT=3002、APP_ORIGIN=http://127.0.0.1:3001、MySQL 的 DB_HOST/PORT/NAME/USER/PASSWORD、Redis 和 SMTP/认证密钥。不新增 M02 私有密码、连接池、会话或 CSRF。前端可通过服务端变量 API_INTERNAL_URL 指定 API，默认 http://127.0.0.1:3002；不要设置原交付的 NEXT_PUBLIC_M02_DEV_API。

## 数据库

沿用统一 QY-MYSQL-1.1.0 / V004。M02 只写 health_profiles（14列）、water_records（10列）、weight_records（10列）；三表已在 V001，**本次无新迁移**，不得重复执行 V001 或队友建库脚本。线上空库/升级仍使用 db/releases 的统一 SQL。2026-10-20 已只读确认当前开发库存在三表和 V001–V004 记录。

## 真实接入

入口 `src/modules/health/integration.ts` 注册到 main.ts 的现有路由链。真实 IdentityService.session() 确定 userId，Origin 由 main 检查，写入额外校验 session CSRF；现有 idempotent() 提供用户行锁、租约及 SQL 原子事务，sqlTx() 映射公共端口。不会从请求体接收身份。

所有十个操作见 contracts/openapi/M02.yaml。共享类型 contracts/shared_types.ts；前端仓库 contracts/shared_types.ts 是同版公开契约快照，后续统一同步。

## 未到位的其他模块

`src/common/ports.ts` 的 modulePorts 支持注册 points、pointsQuery、nutrition、training、companion、activities。注册真实端口后聚合自动使用这些端口；查询复用传入的一致性快照 tx。

未注册时返回 availability 能力标志；对应热量、营养已知量、积分、训练、心情统计、预约计数为 null，前端显示 — 并说明未接入。M02 自己的饮水/体重仍返回真实记录；有能力但尚无记录才按记录口径返回 0 或缺测。

饮水奖励以 rewardsAvailable 表示端口是否注册：false 时仅保存饮水，不写 M05 任意表，不补记或承诺未来发奖。端口注册后，当日奖励与水记录在同一 SQL 事务执行；奖励失败全部回滚，历史补录不发奖励。生产仍保留原有 M05 PointsPort、HTTPS、可信代理启动检查。

## 验证

```sh
npm run typecheck
npm run build
DB_NAME=qingyang_auth_test npm test
```

只允许使用 `_test` 结尾的隔离测试库跑数据库集成。新增 health.integration.test.ts 覆盖真实 HTTP 邮箱会话/CSRF、档案版本冲突、饮水重复重放/不同 body 冲突、双账号隔离、输入边界、每日上限并发、历史补录、积分失败同事务回滚、体重与 30 天大屏。health-http.test.ts 验证 M01 错误码及异常隐私。

完整 H5 实测时，先停止占用3002的普通 API，再在后端运行下列专用测试入口：

```sh
AUTH_NO_LISTEN=1 DB_NAME=qingyang_auth_test node --import tsx tests/support/live-health-api.ts
```

然后在前端仓库运行 `QY_LIVE_E2E=1 npx playwright test tests/e2e/health-live.spec.ts --workers=1`。测试入口只接受隔离测试库，验证码经注入发件器保存于忽略的 `.local/m02-e2e-code`，不会向外发邮件；它不被生产入口引用。测试完成后关闭专用入口，恢复普通 `npm run dev`。不要把测试 API 当作实际使用服务。

## 2026-10-21 团队交接补充

- [十个接口的调用、请求头、错误与端口说明](M02/API_GUIDE.md)
- [M02三表、独立开发/整合库与连接方式](M02/DATABASE.md)
- [本轮交接补充记录](integration/M02_合并记录_2026-10-21_交接补充.md)

本轮保留当前已整合业务代码，修正OpenAPI中的实际Cookie名称及全部写操作必需幂等头，并补齐动态出生年份说明。SMTP未配置的本机尚不能启动普通API；此前历史验收不等于本机已完成邮箱登录验收。
