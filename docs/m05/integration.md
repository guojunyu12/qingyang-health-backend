# 第⑦阶段：独立验收与整合交付

本阶段交付 M05 可独立运行的 H5 前端、H5 API、运营后台前端、后台 API 与同一 MySQL。第①—⑥阶段已人工通过；第⑦阶段开发和自测完成后仍需人工检查。**不开发短信功能**。通知验收范围是站内收件箱，设备推送也不计入本阶段通过条件。

## 本机启动和人工验收

使用 Node.js 22.12+、MySQL 8.4、仓库锁文件中的依赖。在 `m05` 目录准备 `.env`（参见 `.env.example`），保证两端使用同一 DB_NAME、SESSION_SECRET 和 REWARD_CODE_KEY。首次安装与启动顺序：

```sh
npm ci
./tools/m05 db:start       # 本机便携 MySQL，另一个终端保持运行
./tools/m05 db:init        # V001、开发用户、初始积分规则
./tools/m05 db:phase6      # V002_M05，已有库幂等校验
./tools/m05 db:activities  # 可选独立活动夹具
./tools/m05 db:rewards     # 可选 TEST-ONLY 权益；需 ENABLE_DEV_REWARDS=true
./tools/m05 build
./tools/m05 start          # 保持运行；H5 3000，后台 3001，API 3100/3101
```

当前电脑的数据库和服务已在运行，前六阶段已有数据保留。可直接检查下表：

| 检查内容 | 入口 |
| --- | --- |
| A/B 用户页面与会话 | http://127.0.0.1:3000/profile |
| 积分任务和真实流水 | http://127.0.0.1:3000/points |
| 活动发现、预约、取消 | http://127.0.0.1:3000/activities |
| 权益目录、本人兑换 | http://127.0.0.1:3000/rewards |
| 个人站内通知 | http://127.0.0.1:3000/messages |
| 后台业务概览 | http://127.0.0.1:3001/overview |
| 内容、订单、预约、消息、素材管理 | 后台左侧导航 |
| 真实运行状态、全部接口、46 表、阶段 | http://127.0.0.1:3001/engineering |

建议从后台概览核对八项统计，再用 A 完成签到、预约、兑换并在后台查看对应记录；用 B 检查账号隔离。测试权益仅发 `TEST-ONLY` 兑换码，不对应真实商品。后台消息选择 A/B、预览后发送；H5 分账号查看已读状态。素材在后台上传并校验后，选为活动或权益图片，H5 页面应显示安全副本。`design/phase-07/e2e-checks.json` 记录了隔离库的全链路及重启验收，`review.json` 汇总本阶段证据。

## 交付结构和基线

| 路径 | 交付 |
| --- | --- |
| `web/frontend`、`web/backend` | H5 Next.js 页面、同源代理、独立 NestJS API 入口 |
| `server/frontend`、`server/backend` | 后台 Next.js 页面、API 入口、积分/预约/社区/权益/通知/素材服务与 Worker |
| `db/V001__baseline.sql` | 原 44 业务表，SHA-256 `64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56`，保持原样 |
| `db/V002__m05_messages.sql` | 仅本地兼容增量：两张 M05 消息表和 `operations_message` 通知类型 |
| `db/schema-map.json` | 46 张业务表的字段、负责人映射；另有 `schema_migrations` |
| `contracts/shared.ts` | 原 `QY-MYSQL-1.0.0` 公共类型，不改写 |
| `contracts/phase-03-runtime.json` 至 `phase-07-runtime.json` | 各阶段已实现的 HTTP 形状和边界 |
| `design/phase-02` 至 `phase-07` | 测试报告、人工验收入口和历史证据 |

`design/phase-07/handoff.json` 是整合负责人可读取的结构化清单。固定开发用户：A `a0000000-0000-4000-8000-000000000001`、B `...0002`、管理员 `...0003`。这些 ID、开发会话、测试供应商文件、当前本地库数据和 `.runtime` 不进入正式数据迁移；合并的是业务代码、接口映射和经批准的增量迁移。

## 供整合负责人的接入顺序

1. 锁定 `QY-MYSQL-1.0.0` 与 V001 的 SHA。先在目标库备份；由 M01 为 `V002_M05` 分配全局迁移编号，合入两张表及通知类型 CHECK/DTO。MySQL DDL 隐式提交，迁移失败时核查残留结构并从备份恢复，不把半份迁移标为完成。
2. 接 M01 的 IdentityPort、账号摘要、UserAdministrationPort、会话、权限与 CSRF。生产模式禁用开发身份/时钟/供应商/本地消息与素材。`/api/v1/health` 仅代表数据库和基线可用；认证、履约与消息能力需分别做集成探测。
3. 保持公共 SqlTx 与 User 锁序、统一幂等键和 UTC 事务时间。M02/M03/M04 的饮水、餐、训练来源须在**同一事务**调用 M05 `awardInTransaction`；不要通过异步 HTTP 回补积分。签到由 M05 自身管理。M06 无 M05 的直接数据依赖。
4. 接入真实数字权益供应商前，确认发放请求稳定幂等、可按订单查询最终结果。`unknown` 订单保持 pending，不强制退款；最终失败才一次性返分和库存。加密密钥由服务端统一安全保存，密钥更换需迁移历史兑换码；后台查询不得返回兑换码。
5. 统一 Outbox 消费所有权。`points.redemption.requested.v1` 由权益 Worker 消费；`points.redemption.finished.v1`、`activity.booking.confirmed.v1`、`activity.booking.canceled.v1`、`activity.slot.canceled.v1`、`m05.message.campaign.requested.v1` 由通知 Worker 消费；`media.validate.requested.v1` 由素材 Worker 消费。同一个事件只可有一个负责标记 `published` 的消费者。若使用 M01 全局 Dispatcher，先替换/注册对应消费者，避免与本地 Worker 竞争。
6. 用 M01 MediaPort 取代本地文件适配器，保留 `assetId`、用途、ready 校验、最多 300 秒读取 URL 与发布可见性规则。M05 独立版只管理活动封面和权益图片；头像、训练视频等用途由相应模块承接。
7. 消息当前只承诺写入站内收件箱、本人已读和逐人结果。**短信不在系统整合范围**。若平台日后另设设备推送，应单独引入订阅、回执、失败语义和集成测试，不能把本地站内成功显示为设备送达。
8. 在单一集成测试库按 `T42/T43` 重跑账号隔离、来源发奖、末席预约、权益扣分/退款、消息重试、素材可见性和多进程重启；核对 46 张业务表及原 V001 SHA。六个开发库的数据不相互合并。

## 已验证的恢复行为与范围

第⑦阶段隔离库测试在任务排队后重建 H5/API 和后台/API 实例，确认兑换 Worker、通知 Worker 在重启后继续处理；重复签到和重放完成通知未复制账本/消息。再次重启后本人兑换码、预约状态、A/B 已读隔离持续存在。图片上传完成请求后重启，校验 Worker 继续生成安全 WebP，已发布活动经签名 URL 能公开读取。

当前开发库的 A 余额 50、B 余额 15，历史四单仍为已发放 2、已退款 1、持续未知 1；第⑦阶段隔离库测试没有改动这些账务。运营概览的八项指标来自实时 MySQL 快照；人工验收时的数值可能随测试操作变化。

本地四服务启动脚本只启动 M05 H5、后台及两端 API；MySQL 单独运行。真实 M01 登录、M02/M03/M04 正式来源、正式媒体存储、真实权益供应商和正式推送端口需要整合负责人与各模块共同验收。短信已明确排除。
