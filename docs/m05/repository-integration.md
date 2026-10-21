# M05 仓库接入

原独立交付包的四个进程已按仓库边界拆分：本仓库保留 `src/m05/` 双 API 与 Worker、`contracts/` 公共端口、`db/m05/` 初始化工具，以及 `db/migrations/V002__m05_messages.sql`。H5 页面在 `qingyang-health-frontend/src/m05/`，运营后台页面在 `qingyang-health-admin/src/m05/`。三个进程使用同一个 `DB_NAME`、会话密钥和 API 地址。不要把原 `.runtime`、测试账号数据或本地密钥提交或合并到正式库。

V001 SHA-256 为 `64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56`，没有改动。V002_M05 新增两张运营消息表，并使公共通知类型支持 `operations_message`。这仍是独立开发迁移；M01 整合前应分配全局版本并确认 CHECK/DTO 与其他组增量兼容。目标库先备份，不能把半份 DDL 标记为完成。

独立模式使用固定 A/B/管理员开发身份；生产必须换成 M01 身份、权限、会话与 CSRF 适配。M02/M03/M04 的饮水、记餐、训练奖励需要在同一 SQL 事务调用 M05 积分端口。兑换需要接入真实幂等且可查询结果的供应商；结果未知时订单保持待处理。素材需要替换为平台 MediaPort。Outbox 消费权必须在整合时统一，避免本地 Worker 与全局 Dispatcher 同时确认同一事件。

本次只交付站内通知，不交付短信或设备推送。原独立包的全链路自测结果保存在 `review.json`，迁移和事件所有权详见 `handoff.json`。这些是接入依据，不能替代与 M01–M04 的正式集成测试。
