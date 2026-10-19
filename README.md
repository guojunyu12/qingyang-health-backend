# 轻养健康后端 · M01

NestJS + TypeScript、MySQL 8.4/mysql2、Redis/BullMQ、163 SMTP、本地私有图片存储。

- [启动、功能和团队交接](docs/HANDOFF-M01.md)
- [线上建表与已有库升级](db/releases/建表与升级说明.md)
- [完整空库安装SQL](db/releases/QY-MYSQL-1.1.0_full_install.sql)
- [M01专属12表参考SQL](db/releases/M01_12_tables_reference.sql)
- [接口定义](contracts/openapi/M01.yaml)
- [前端仓库](https://github.com/guojunyu12/qingyang-health-frontend)

复制 `.env.example` 为忽略的 `.env.local` 并填写配置。`npm ci` 后执行 `npm run migrate`、`npm run dev` 和另一终端的 `npm run worker`。不要将真实密码、邮箱授权码、私有媒体或数据库数据提交Git。

本轮支持邮箱认证、资料/头像、站内通知、幂等/事务/Outbox与媒体校验。Web Push按用户决定待配置，视频转码及其他模块整合前置见交付说明，不能将尚未配置的能力报为上线完成。

测试：`npm test`运行单元测试，数据库集成需显式使用库名以`_test`结尾的独立测试库，例如 `DB_NAME=qingyang_auth_test npm test`；开发库不会自动跑集成用例。`npm run typecheck`、`npm run build`用于静态验证。

此仓库根目录对应原规范 `server/`；后端代码放 `src/`，公共契约 `contracts/`，数据库 `db/`。M01统一依赖锁与迁移；M02–M06只改自己的模块，经PR整合。V001冻结，后续只增量迁移。
