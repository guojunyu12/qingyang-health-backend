# M02 交付单

交付日期：2026-10-19。模块：健康记录与个人看板。

## 版本与范围

| 项目 | 内容 |
| --- | --- |
| 契约 | QY-MYSQL-1.0.0 |
| 前端仓库 | https://github.com/guojunyu12/qingyang-health-frontend |
| 本地起始 commit | 7edf70467eb36d537702430881a5d5a153001ecc（待 M01 确认为团队共同起点） |
| 本组 commit | 见公开仓库 main 的发布提交；同一提交包含前后端源码 |
| 已核实应用源码 commit | 55024bb7caea4d6d4fdb52fb835b55a2d18a4587；2026-10-20 本地部署文档更新以包含本行的后续提交为准 |
| 数据库 | MySQL Community Server 8.4.11 / InnoDB |
| V001 SHA-256 | 64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56 |
| 写入业务表 | health_profiles、water_records、weight_records |
| 接口 | GET /me/dashboard、GET/PUT /me/health-profile、GET /me/health/overview、GET/POST/DELETE /me/water-records、GET/POST/DELETE /me/weight-records（DELETE 带 /{id}） |
| 共享契约 | 附件 SQL、共享类型原样保存；未改字段、未新增表、未创建 V002 |

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 本地三份附件校验 | 通过；00 与 M02 的公共规则、SQL、类型、fixture 一致；M02 三表列与 01 中文字典一致 |
| npm run typecheck | 通过 |
| npm test | 通过：3 个测试文件，20 项测试 |
| npm run build | 通过：原有全部页面可构建 |
| MySQL 空库 V001 | 通过：44 张表，原 SHA-256，外键与 CHECK 正常启用 |
| 真实 MySQL 场景 | 通过：11 组，见 tools/m02-dev/mysql-acceptance.ts |
| 专用 Playwright 浏览器闭环 | 通过：1 条完整流程用例，真实 API / MySQL；手机 360px 与桌面 1440px 无页面横向溢出 |
| React 与页面复核 | 已检查 hooks、失败输入、会话切换、缺测图表与表单标签；截图见 screenshots/ |
| 完整六人包一致性 | 未运行：尚未取得完整六份工作包和统一检查脚本 |
| 原全站 localStorage 演示 E2E | 未作为改造后 M02 的验收；其健康页种子数据断言需要由 M01 更新 |
| 真实 M01/M03/M04/M05/M06 联调 | 未完成：实际底座与各组实现尚未提供给本工作区 |

MySQL 11 组场景：44 表建库；空状态；并发档案首建/旧版本冲突；同 key 重放与不同 body 冲突；主动两杯与奖励去重；5750 ml 并发上限；软删除/本人重复删除/跨账号隔离/不重复奖励；同时间称重排序与删除回退；历史补录与均值；积分失败同事务回滚；一致性快照与游标筛选隔离。

浏览器流程：创建用户自选目标 → 连续两杯饮水 → 刷新仍在 → 服务端提交后丢失响应 → 原 key 重试不重复保存 → 记录体重 → 删除饮水 → 切换账号无前一用户数据 → 30 天缺测网格 → 手机/桌面布局 → 弹层 Escape 恢复焦点。未出现未处理页面异常。

## 真实服务与测试适配器

| 能力 | 当前状态 |
| --- | --- |
| M02 repository / service / HTTP / Nest 模块 | 已实现；真实 mysql2 连接执行 MySQL 8.4 SQL；模块只写 M02 三表 |
| M02 前端页面与面板 | 已实现；通过注入的统一客户端接口取数，不读写演示健康 localStorage |
| MySQL UnitOfWork、幂等命令执行 | tools/m02-dev 中有显式联调实现，真实事务/租约/用户行锁；正式替换为 M01 实现 |
| 身份与 CSRF | 仅回环测试账号 Cookie 与 CSRF；不是正式用户登录，生产入口被禁用 |
| PointsPort / PointsQueryPort | 显式测试适配器：测试奖励确实与饮水同 MySQL 事务执行；不代表 M05 模块交付完成 |
| Nutrition / Training / Companion / Activities QueryPort | 显式空测试适配器，不生成用户历史，正式由各组注入 |
| 全局 app-shell、provider、M05 profile 页面 | 沿用原工程；仍有演示昵称/徽标或表单，需各负责人统一装配 |

测试适配器若处于 production 配置会拒绝启动；正式 createHealthModule 需要显式传 real，并注入实际底座与全部真实端口。该声明不是团队联调已经通过的证明。

## 交接接口与依赖

HealthProfilePanel props：open:boolean、onClose():void、onSaved():void，组件自己查询/保存并调用统一失效。M05 引用组件，不复制档案数据。

HealthQueryPort：HealthRepository 实现 profile(tx,userId)、days(tx,userId,startDate,endDate)，Nest token 为 M02.HealthQueryPort。聚合服务所有端口复用传入 tx。

新增依赖仅在 tools/m02-dev/package.json 与对应锁文件：NestJS common/core/platform-express、mysql2、reflect-metadata、rxjs、tsx、@types/express；prettier 仅用于整理格式。原前端根 package.json 和锁文件未修改。正式依赖版本由 M01 按联调工具锁文件统一审阅装配。

## 待团队接入事项

1. M01 确认源码起点与双仓库路径映射，提供真实身份、统一客户端、事务、CSRF、幂等与缓存刷新；生产 schema 版本从迁移历史读取。
2. M05 接入真实同事务 PointsPort、查询端口，并在“我的”页嵌入 HealthProfilePanel。
3. M03/M04/M06 及 M05 活动查询端口接入后，验证真实饮食/训练/心情写入在今日页和大屏一致展示。
4. M01 更新原全站演示 E2E 与全局演示昵称/徽标，执行完整六包校验和正式双账号端到端验收。

装配差异登记：db/proposals/M02/CR-M02-20261019-001.md。启动、变量与正式注入示例见本目录 README.md。

## 本地运行状态与交付

本次独立 MySQL 监听 127.0.0.1:3308，API 监听 127.0.0.1:4002，前端监听 127.0.0.1:3001。运行服务仅在本地。公开源码仓库为 https://github.com/Mat11-oo/qingyang-health-m02，GitHub 源码交付不等于线上 API 部署。

本地数据位于 .local/，不进入交付包；其中账号 A 的健康数值来自明确标记的自动化测试操作。ZIP 显式包含被前端 .gitignore 忽略的 server/src/modules/health/，并内含 M02_FILE_CHECKSUMS.json。

## 后续 M02 体验优化

本轮补录、删除确认、档案分组、图表交互与弹层焦点改动及其验证范围，详见 [本轮优化记录](本轮优化记录.md)。历史验收记录与本轮检查分别列示。

## 公开源码交付

前后端同仓库，保留 src/、server/、contracts/、db/ 路径。新增无凭据配置示例、依赖安装入口、根 README 和 ACCEPTANCE.md。发布前已在干净副本完成依赖安装、前端构建、后端启动和未登录响应人工检查。本轮未新增自动化测试，历史测试结果单独保留。

## 2026-10-20 本地部署复核

已恢复现有 MySQL 8.4.11 实例和 M02 NestJS API，仅监听本机 127.0.0.1:3308 / 4002。开发库 qingyang_dev_m02 保留，不重复执行 V001；44 表、58 个外键、254 个 CHECK 已核实，所有表列定义与按冻结 V001 创建的新测试库比对无差异。开发库健康记录数量在操作前后保持一致。

本次在新的 qingyang_m02_test_20261020_deploy_01 库重跑已有 MySQL 验收，11/11 通过；真实 HTTP 检查确认未登录返回 401，登录后档案、今日、大屏、饮水列表和体重列表返回契约 envelope，大屏日期网格为 30 天。本次未新增测试、未重跑浏览器验收；正式 M01/M05 与其他组联调仍未完成。

队友可复现的启动命令、配置变量、数据库与源码交付边界、正式端口装配见 [LOCAL_MYSQL_DEPLOYMENT.md](LOCAL_MYSQL_DEPLOYMENT.md)。本地数据库程序、数据、密码、Cookie、.env 配置不上传 GitHub；整合时使用独立整合库，不汇总成员本地数据。

## 2026-10-20 接口交接信息补充

补充范围：M02 OpenAPI、生成器与说明文档。十个业务路由、业务服务、公共 shared_types 和冻结 V001 均不变。

- 十个接口均声明 X-Client-Platform:h5；写请求保留 CSRF，POST 保留 UUID v4 幂等键，补充请求、成功和错误响应示例。
- 明确出生年份动态上界、30×24 小时补录边界、体重最多 366 个日期、游标筛选绑定、完整 PUT 的清空语义、软删除和奖励资格规则。
- 增加 VERSION_CONFLICT、IDEMPOTENCY_CONFLICT、REQUEST_IN_PROGRESS、WATER_DAILY_LIMIT 等错误码的触发条件和处理方式；示例是文档构造数据，不是用户数据或验收截图。
- 新增 [API_GUIDE.md](API_GUIDE.md)，提供十个业务接口及同 key 重试的本地调用方式。Cookie 文件和令牌只留在本地临时变量，不随源码提交。
- 正式 Cookie 名称、CSRF 获取和刷新、限流及 GET /api/v1/meta/contract 仍由 M01 提供；本仓库的测试 /dev/session 不作为正式登录接口，也不计入十个业务接口。

验证结果：OpenAPI 重复生成结果一致；10 条路径/方法与 Nest 路由逐项一致；75 项参数、请求和响应示例通过模式校验；三个请求示例通过实际 DTO 校验，出生年份的当前年/下一年边界检查通过；六段终端示例的 zsh 语法检查通过，未执行其写请求。契约校验与原有 20 项单元测试通过。本次不重跑浏览器或 MySQL 业务验收，不将文档更新写成正式六组联调通过。
