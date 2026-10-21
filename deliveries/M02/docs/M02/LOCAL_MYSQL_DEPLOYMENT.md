# M02 本地 MySQL 部署与团队整合交接

验证日期：2026-10-20（Asia/Shanghai）。契约：QY-MYSQL-1.0.0。Schema：V001。

## 部署结果

| 项目 | 实际状态 |
| --- | --- |
| 源码仓库 | https://github.com/Mat11-oo/qingyang-health-m02 |
| 部署前源码提交 | 55024bb7caea4d6d4fdb52fb835b55a2d18a4587 |
| 前端原始基线 | 7edf70467eb36d537702430881a5d5a153001ecc，仍待 M01 确认为团队共同起点 |
| 数据库 | MySQL Community Server 8.4.11 / InnoDB |
| 本地连接 | 127.0.0.1:3308，开发库 qingyang_dev_m02 |
| 数据目录 | 项目内 .local/m02-mysql/，不进入 GitHub |
| 后端 | NestJS + TypeScript，本地 API http://127.0.0.1:4002 |
| 初始化策略 | 恢复已有实例；保留开发库，不对其重跑 V001 |
| 结构检查 | 44 张表、58 个外键、254 个 CHECK；M02 三表为 InnoDB / utf8mb4_0900_ai_ci |
| 基线比对 | 与本次按冻结 V001 创建的新测试库比较，所有表的列类型、空值、默认值、extra、排序规则及生成表达式无差异 |
| 时间 | MySQL 默认 +00:00；事务连接设置 UTC；业务日为 Asia/Shanghai |
| 记录保护 | 部署前后开发库三张健康表的记录数量一致；没有执行重置、删除或导入历史数据 |
| 网络范围 | MySQL 和 API 仅监听本机回环地址；不是公开线上服务 |

V001 SHA-256：`64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56`。冻结 SQL、公共类型、字段名和 10 个业务接口均未修改。`contracts/schema_manifest.json` 为团队发布基线文件，其中 `applied` 不作为每台电脑的迁移执行记录，本次不改公共 manifest。

## 在本机恢复已有 MySQL 实例

本机已经下载 MySQL 8.4.11 的 macOS ARM64 独立发行包。先确认 3308 没有其他实例监听；已运行时不要重复启动。以下命令在项目根目录执行，路径含空格也应保留双引号：

```sh
M02_PROJECT_ROOT="$PWD"
"$M02_PROJECT_ROOT/.local/m02-downloads/mysql-8.4.11-macos15-arm64/bin/mysqld" \
  --no-defaults \
  --basedir="$M02_PROJECT_ROOT/.local/m02-downloads/mysql-8.4.11-macos15-arm64" \
  --datadir="$M02_PROJECT_ROOT/.local/m02-mysql" \
  --bind-address=127.0.0.1 --port=3308 \
  --socket=/tmp/qingyang-m02-mysql.sock \
  --pid-file="$M02_PROJECT_ROOT/.local/m02-mysql/server.pid" \
  --log-error="$M02_PROJECT_ROOT/.local/m02-mysql/server.log" \
  --mysqlx=OFF --default-time-zone=+00:00 --daemonize
```

该命令只用于本机已有、已初始化的数据目录，不包含 `--initialize`。没有安装系统服务或开机自启；电脑重启后需重新启动。本机发行包与数据目录不随源码分发。队友应使用适合自己系统的 MySQL 8.4，不能直接复制 macOS 程序或本机数据目录。

## 队友独立运行

1. 拉取仓库后运行 `node tools/m02-dev/setup.mjs`，安装锁定依赖，生成被 Git 忽略的 `.env.api` 和 `.env.local`；已有配置不会被覆盖。
2. 启动自己的 MySQL 8.4，将 `.env.api` 配置为自己的数据库地址、端口和账号。该联调工具仅允许 `qingyang_dev_m02` 或 `qingyang_m02_test_小写后缀` 库名，不连接其他成员的开发库。
3. 仅当选定开发库不存在或完全为空时，执行 `npm --prefix tools/m02-dev run start -- --init`。已有 V001 时执行 `npm --prefix tools/m02-dev run start`；不要重复初始化。
4. 如需页面联调，另开终端运行 `npm run dev`，访问 http://127.0.0.1:3001/dashboard，选择明确标记的测试账号。

| 环境变量 | 示例 / 用途 |
| --- | --- |
| M02_TEST_ADAPTERS | 1，显式启用本地测试适配器 |
| M02_DB_HOST | 127.0.0.1 |
| M02_DB_PORT | 3308，可改为队友自己的 MySQL 端口 |
| M02_DB_NAME | qingyang_dev_m02；从环境读取 |
| M02_DB_USER / M02_DB_PASSWORD | 只在自己的 .env.api 中填写；不上传 |
| M02_API_PORT | 4002 |
| M02_FRONTEND_ORIGIN | http://127.0.0.1:3001 |
| NEXT_PUBLIC_M02_DEV_API | http://127.0.0.1:4002，置于 .env.local，仅供开发 |

数据库的地址、端口、库名和凭据由环境配置；当前代码的默认库名只属于 M02。`root` 空密码仅为本次独立回环测试实例的既有配置，不作为团队或生产账号方案。

## 本次实际验收

| 验证 | 结果 |
| --- | --- |
| python3 tools/check_m02_contract.py | 通过：校验值、00/M02 公共契约、类型、SQL、fixture 一致；M02 三表列与 01 字典一致 |
| 新空测试库 | qingyang_m02_test_20261020_deploy_01，原样 V001 成功建库；未使用开发库进行破坏性验收 |
| 既有 MySQL 验收脚本 | 11/11 通过：空态、版本并发、幂等、两杯独立记录、6000 ml 并发边界、软删除/奖励去重、称重排序、历史补录/均值、同事务回滚、一致性快照/游标 |
| 真实 HTTP 未登录查询 | GET /api/v1/me/health-profile 返回 401 |
| 真实 HTTP 登录后查询 | 档案、今日看板、30 天大屏、饮水列表、体重列表均返回 200，包含 data/meta 及 Asia/Shanghai；大屏有连续 30 个日期点 |
| 前端浏览器验收 | 本次未重跑；历史结果见 HANDOFF.md，本次不将 API 检查写成浏览器验收 |
| 正式六组联调 | 尚未完成；本地积分和身份仍是显式测试适配器 |

复跑数据库验收时选择新的空测试库后缀，不能对已有测试库重复执行 V001：

```sh
M02_DB_NAME=qingyang_m02_test_20261020_recheck_01 npm --prefix tools/m02-dev run test:mysql
```

上例使用前确认该库不存在；复跑时换一个新后缀，只能用小写英文、数字或下划线。自定义 MySQL 地址、端口、账号时也需通过环境提供给验收命令；`test:mysql` 不自动加载 `.env.api`。数据库验收会产生明确测试事实，只留在新测试库内；不合并进开发库或整合库。

## 交给 M01 / M05 的整合边界

- M01 在单独的整合环境数据库原样应用 V001，后续由统一流程管理迁移；不导入各成员开发库的数据。
- 合入 `server/src/modules/health/`，由 M01 注入真实身份、CSRF、UnitOfWork、幂等命令执行和各组 QueryPort；使用 `createHealthModule(realDependencies, realCommandExecutor, 'real')`。统一全局前缀时的第四参数见本目录 README。
- 前端由 M01 调用 `installHealthRuntime` 注入统一客户端、失效入口和账号切换通知；M05 在“我的”页引用 HealthProfilePanel，注入真实 PointsPort / PointsQueryPort。
- 联调工具里的本地 Cookie 登录、积分测试适配器及跨组空查询不能作为正式实现发布。它们在生产配置下拒绝启动。
- 队友电脑上的 `127.0.0.1` 指向队友自己；GitHub 提供源码、契约、配置示例和操作说明，不提供远程连接本机数据库的能力。

修改范围：仅补充 M02 部署与交接文档及源码文件校验清单；无 DDL 变更、无新增依赖、无接口版本变更。本次提交编号以包含本文件的 GitHub 提交为准，部署前应用源码编号已在上表固定。
