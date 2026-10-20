# M02 整合契约变更（无 DDL）

日期：2026-10-20。执行依据：用户授权将 M02 合入现有 M01 前后端。

保持数据库 QY-MYSQL-1.1.0 / V004，不更改冻结 V001，不新增表或迁移。

API 增补：Dashboard/Overview 添加 availability（nutrition/training/points/rewards/companion/activities）；饮水创建结果添加 rewardsAvailable。未接入模块的聚合数值允许 null，避免将未知数据伪装成0；共享 TypeScript 和 OpenAPI 已同步。前端已同步显示 — 和状态提示。原交付 QY1.0 的聚合类型不是可直接复用的当前版本。

M02 前端与后端本次需配套升级；其他新消费者必须先判断 availability。缺少积分端口时只保存饮水、不写积分；不提供延迟发奖承诺，生产保持已有 M05 必须注册的启动限制。不存在需要执行的 SQL 草案。
