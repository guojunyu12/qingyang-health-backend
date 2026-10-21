# 轻养健康 · M02 健康记录与个人看板

本仓库公开交付 M02 前后端源码。前端沿用原项目的浅紫配色、圆角卡片、插画及响应式布局，后端采用 NestJS + TypeScript，数据写入 MySQL 8.4。

契约：**QY-MYSQL-1.0.0**。范围：健康档案、饮水、体重、今日看板、个人健康大屏，共 3 张归属表、10 个接口。

2026-10-20 已恢复本地 MySQL 8.4.11 与 M02 API，保留已有开发库；新测试库的 11 组 MySQL 验收及五个真实 HTTP 查询通过。队友启动、环境配置和正式装配边界见 [本地 MySQL 部署与整合交接](docs/M02/LOCAL_MYSQL_DEPLOYMENT.md)。这是本地联调部署，正式六组联调仍待完成。

## 快速启动

需要 Node.js **22.9+**、MySQL **8.4** 和可用的本地开发库账号。

```sh
git clone https://github.com/Mat11-oo/qingyang-health-m02.git
cd qingyang-health-m02
node tools/m02-dev/setup.mjs
```

安装程序只安装依赖、建立本地依赖链接并生成不含密码的环境示例副本；不会覆盖已有环境文件，也不会初始化数据库。根据自己的 MySQL 服务修改 `.env.api` 中的地址、端口、账号、密码。

首次初始化明确选定的 **空** 开发库并启动 API：

```sh
npm --prefix tools/m02-dev run start -- --init
```

后续启动 API 不再加 `--init`：

```sh
npm --prefix tools/m02-dev run start
```

另开一个终端启动前端：

```sh
npm run dev
```

访问 [今日看板](http://127.0.0.1:3001/dashboard)，在顶部选择测试账号 A 或 B。API 默认 `http://127.0.0.1:4002`，MySQL 联调默认端口 `3308`，均可通过环境文件调整。

## 已交付功能

- 健康档案：主动设置目标、可选身体信息和营养目标、完整保存、版本冲突提示。
- 饮水：默认快捷 250 ml、手动输入、近 30 天补录、独立记录列表、日累计录入上限、确认后软删除。
- 体重：近 30 天补录、同日多次测量、最新测量展示、删除后回退、当前目标与实际测量分开。
- 今日看板：按上海日期查看个人事实；无目标、无测量与未知营养不填演示值。
- 个人大屏：连续 7/30 天日期、分类覆盖率、正确的均值分母、图表点选和缺测展示。
- 健康档案面板与 HealthQueryPort 可交给其他组引用；所有聚合查询共享同一只读快照。

完整的手动验收步骤见 **[ACCEPTANCE.md](ACCEPTANCE.md)**；接口定义见 [M02 OpenAPI](contracts/openapi/M02.yaml)。

请求头、业务错误码、动态参数边界、十个接口的本地调用及幂等重试示例见 [接口调用与团队接入说明](docs/M02/API_GUIDE.md)。正式 Cookie/CSRF 与 `/api/v1/meta/contract` 由 M01 确认和装配。

## 目录

```text
src/features/dashboard/       今日看板
src/features/overview/        个人健康大屏
src/features/health/          档案面板、饮水/体重录入和模块适配接口
server/src/modules/health/    Nest 模块、业务服务、校验、mapper、HealthQueryPort
contracts/                   原样公共类型、版本登记、M02 OpenAPI
db/                         冻结 V001、夹具注册与本组提案
tools/m02-dev/              明确标记的本地联调装配
config/                     不含凭据的环境示例
docs/M02/                   原始要求、交接单、实现说明与截图
```

前端与后端在同一仓库，保留 00 文档要求的相对路径。原前端 `.gitignore` 曾忽略 `server/`；本公开仓库已纳入后端源码，仅忽略其依赖和本地配置。

## 真实实现与待团队联调项

**M02 业务记录真实写入 MySQL。** 本地账号、事务/幂等装配和积分端口属于显式联调适配器，其他组的饮食、训练、情绪和活动查询返回明确空数据，不虚构健康历史。

生产接入仍需 M01 的真实身份/客户端/事务/幂等底座，以及 M03/M04/M05/M06 的真实端口。测试适配器在生产环境拒绝启动；本次发布是公开源码交付，不是线上健康服务发布。

其他组原始前端页面保留为原项目演示，本组未替它们实现真实后端。“我的”页由 M05 引入 `HealthProfilePanel`，不能把其旧演示表单当作 M02 档案入口。

SQL V001 SHA-256：`64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56`。不改基线、不导入 localStorage 演示健康历史、不合并各成员开发库数据。

## 来源

原前端：[guojunyu12/qingyang-health-frontend](https://github.com/guojunyu12/qingyang-health-frontend)，起始 commit `7edf70467eb36d537702430881a5d5a153001ecc`。本仓库保留来源与原始页面结构，没有为原项目代码重新声明许可证。

工作依据：[00 总契约](docs/M02/references/00_六人分工与MySQL总契约.md)、[01 中文字段字典](docs/M02/references/01_数据库中文字段字典.md)、[M02 工作包](docs/M02/references/M02_健康记录与个人看板_Agent工作包.md)。
