# 轻养健康后端

对应前端：https://github.com/guojunyu12/qingyang-health-frontend

## 当前状态

这是后端协作起点，当前交付统一 MySQL 基线、模块分工规范、邮箱认证设计和无秘密的配置模板。NestJS 服务、邮箱验证码接口、Worker 和业务模块尚未实现；当前没有可运行的后端启动命令。

## 技术与目录约定

- NestJS + TypeScript、mysql2/promise、MySQL 8.4、Redis/BullMQ。
- 此仓库根目录对应原协作规范中的 `server/`；后端代码后续放 `src/`，数据库放 `db/`，公共接口放 `contracts/`。
- 原规范中的前端 `src/features/` 指前端仓库；后端 `server/src/` 在此仓库对应 `src/`。
- M01 维护公共底座、依赖锁、迁移和整合；其他组仅修改其模块并提交 PR。

## 数据库

`db/migrations/V001__baseline.sql` 为冻结基线，共44张业务表。SHA-256：

`64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56`

只在新建空开发库执行一次，不重复运行或改写；后续由 M01 分配增量迁移。V001 保留原手机号字段，邮箱迁移尚待实施。每人使用自己的开发库，不合并各自测试数据。

## 配置

复制 `.env.example` 为被 Git 忽略的 `.env.local` 后在本机填写。真实SMTP授权码、数据库密码和个人环境文件不入库。配置模板不是已实现配置加载器。

## 团队规范

`docs/contracts/` 保存收到的 QY-MYSQL-1.0.0 分工与字段字典；`docs/email-auth-design.md` 记录邮箱认证变更方案。原工作包仍记载手机号认证，执行邮箱实现时须更新契约版本并同步六组。

默认主分支 `main`；开发分支 `codex/m01-主题`、`codex/m02-主题` 等，PR 合并。跨仓库接口变更在交付单记录双方 commit、契约版本及迁移号。
