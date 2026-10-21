# 轻养健康后端

对应前端：https://github.com/guojunyu12/qingyang-health-frontend

## 当前状态

统一 MySQL 基线、模块分工规范和邮箱认证设计仍由 M01 维护。本分支接入了可独立运行的 M05 NestJS 服务、积分、活动预约、基础社区、数字权益、站内通知、素材及 Worker。M01 正式账号、邮箱验证码和其他业务模块尚未接入。

## 技术与目录约定

- NestJS + TypeScript、mysql2/promise、MySQL 8.4、Redis/BullMQ。
- 此仓库根目录对应原协作规范中的 `server/`；M05 代码在 `src/m05/`，数据库在 `db/`，公共接口在 `contracts/`。
- 原规范中的前端 `src/features/` 指前端仓库；后端 `server/src/` 在此仓库对应 `src/`。
- M01 维护公共底座、依赖锁、迁移和整合；其他组仅修改其模块并提交 PR。

## 数据库

`db/migrations/V001__baseline.sql` 为冻结基线，共44张业务表。SHA-256：

`64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56`

只在新建空开发库执行一次，不重复运行或改写。`db/migrations/V002__m05_messages.sql` 是 M05 本地兼容增量；整合时由 M01 分配全局迁移编号，校验并合入。V001 保留原手机号字段，邮箱迁移尚待实施。每人使用自己的开发库，不合并各自测试数据。

## 配置

M01 配置模板仍在 `.env.example`。独立运行 M05 时，将 `.env.m05.example` 复制为被 Git 忽略的 `.env`，填写自己的 MySQL、随机会话密钥与开发令牌。真实 SMTP 授权码、数据库密码、兑换码密钥和个人环境文件不入库。

## M05 本地运行

需要 Node.js 22.12+、MySQL 8.4；两个 API 进程连接同一个数据库。首次使用空开发库运行：

```sh
pnpm install
pnpm run db:init
pnpm run db:m05
pnpm run db:seed
pnpm run db:seed:points
pnpm run build
pnpm run start:h5       # 端口 3100
pnpm run start:admin    # 另一个终端，端口 3101
```

可选的测试活动和 TEST-ONLY 数字权益分别运行 `pnpm run db:seed:activities`、`pnpm run db:seed:rewards`。后者必须显式开启 `ENABLE_DEV_REWARDS=true` 并稳定保存 `REWARD_CODE_KEY`。正式环境禁用开发身份、测试时钟和测试供应商。站内通知不代表设备送达；M05 不提供短信功能。

M05 数据库与接口交接说明见 [整合清单](docs/m05/repository-integration.md) 和 [原阶段交接报告](docs/m05/handoff.json)。原 V001 校验和保持不变。

## 团队规范

`docs/contracts/` 保存收到的 QY-MYSQL-1.0.0 分工与字段字典；`docs/email-auth-design.md` 记录邮箱认证变更方案。原工作包仍记载手机号认证，执行邮箱实现时须更新契约版本并同步六组。

默认主分支 `main`；开发分支 `codex/m01-主题`、`codex/m02-主题` 等，PR 合并。跨仓库接口变更在交付单记录双方 commit、契约版本及迁移号。
