# M02｜健康记录与个人看板 · Agent独立工作包

**契约：QY-MYSQL-1.0.0｜数据库：MySQL 8.4｜Schema：V001｜本组业务表：3张**

本文件可单独交给本组Agent：已包含任务、共同规则、全库表归属、本组接口、公共类型和完整44表SQL。原PRD/前端源代码有助核对UI；没有源码时不要声称已经完成前端改造。

**V001 SHA-256：`64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56`**。所有组必须完全一致。

## 给本组Agent的启动指令

你负责轻养健康项目的 **M02 健康记录与个人看板**。先完整读取本文件，确认代码目录、公共契约和你唯一负责的数据表。先输出一份理解核对：本组功能、允许修改的文件/表、调用的公共端口、首个交付切片、仍缺的实际运行信息。随后在自己的模块目录推进实施。

不要另建一套用户表、积分表、HTTP规范或本地数据真相。执行附录SQL初始化你自己的空开发库；已部署V001不得重复执行或改写。发现真实代码与契约不一致，先形成差异清单，在不受影响的模块继续；跨组字段变更提交变更单，由M01统一合入。

本组完成前后端、DTO、自己的接口片段和有效验收。不得把仅有mock或供应商未配置的功能报为真实完成。按本组边界提交源码和HANDOFF，不修改其他人的模块文件、根依赖锁文件或公共schema。

## 本组目标

完成健康档案、饮水、体重、今日看板和个人健康大屏的前后端闭环，拥有 3 张健康表和本组 10 个接口。所有图表读取真实事实与同一份业务口径，跨模块汇总通过共享 QueryPort 完成；不建立第二套用户健康总表，不把缺测或未知目标填成演示值。

## 先交付这些内容

- 先交 HealthQueryPort、无档案/无记录的明确返回，以及可用于联调的饮水和体重列表。
- 先完成 HealthProfilePanel，约定由 M05 嵌入“我的”布局；组件自己查询和保存档案，复用公共缓存失效。
- 与 M05 打通首次饮水记录和同事务奖励，再把同一记录显示到今日页，形成第一条可验证链路。
- 在其他 QueryPort 尚未完成时，用显式测试桩完成 7/30 天日期网格、缺测显示和图表布局；依赖接入后替换适配器，不改统计签名。

## 完整工作清单

- 接入今日页、日期切换、饮水快捷操作、体重弹层和个人大屏的真实数据，覆盖移动端与桌面；个人大屏只展示当前登录用户。
- 实现健康档案查询和完整保存，首次 version=0 创建、后续按 version 条件更新；清晰区分可选信息与用户必须主动设置的目标。
- 独立交付 HealthProfilePanel，并通过既定组件接口供 M05 引用；当前体重只读测量记录，不在档案中维护另一份可写 currentWeight。
- 实现饮水新增和列表：每次都是独立记录，默认快捷量 250 ml；在用户锁内校验当日有效累计及录入上限，通过 PointsPort 同事务处理首次奖励。
- 实现体重新增与历史查询，保留同日多次测量；同时间戳以 id 稳定排序，今日体重与历史最近体重使用各自的明确查询口径。
- 实现饮水、体重软删除与重复删除语义；全部列表、汇总和奖励事实检查排除 deleted_at，删除不重置已经获得的日任务资格。
- 实现记录时间转换和历史补录，拒绝无时区时间和越界录入，统一维护 UTC recorded_at 与上海 business_date；补录历史不补发当日积分。
- 实现 HealthQueryPort，以及 dashboard/overview 在同一个只读一致性快照中调用各组 QueryPort 的装配；每个端口复用传入 SqlTx，不各自开连接。
- 实现摄入、消耗、饮水、体重、情绪、任务与预约的统计映射；缺目标时返回空依赖项，未知营养保留完整度标记，均值按该类实际有记录天数计算。
- 完善保存中、失败保留输入、重复操作、空状态与图表缺测表现；提交成功后调用统一缓存失效，让本页、个人大屏和积分任务同步。
- 交付覆盖上海午夜、历史补录、记录删除、相同测量时间、多个数据源同时更新的 fixture 与验证；不新增定时写入日汇总事实表或本组运营后台。

## 使用的输入与依赖

- 依赖 M01 的身份上下文、UnitOfWork、统一请求客户端、UTC/业务日期、幂等和缓存失效能力。
- 依赖 M05 的 PointsPort 实现饮水原子奖励，依赖 PointsQueryPort 与 ActivitiesQueryPort 展示相关汇总。
- 依赖 M03 NutritionQueryPort、M04 TrainingQueryPort、M06 CompanionQueryPort，汇总时共同使用同一 readSnapshot。
- 向 M05 输出 HealthProfilePanel；“我的”布局、账号摘要和积分展示分别由对应负责人装配，不由本组直接修改其主文件。
- 所有 QueryPort 的类型与字段以 shared_types.ts 为准；无依赖时只能使用显式测试适配器，不能生成假用户历史。

## 交给团队的输出

- 健康档案、饮水、体重、今日与个人大屏源码，以及本组 10 个 API 的 OpenAPI 片段、DTO 和 mapper。
- HealthProfilePanel、HealthQueryPort 与跨模块同一快照的看板汇总实现。
- 记录日期、缺测/完整度、目标为空、均值分母和删除同步的可复现测试数据及结果。
- 与 M01/M03/M04/M05/M06 的集成说明，标明哪些查询使用了真实适配器、哪些仍是测试桩。
- 符合统一模板的交付单与需要其他组配合的组件、字段或迁移提案。

## 本组必须通过的验收

- 新用户进入今日与个人大屏时无虚构体重、热量目标、心情或历史曲线；档案未创建返回空状态，真实累计仍可展示。
- 两个首次档案 PUT 均用 version=0 并发提交时只有一个创建成功；旧 version 更新返回 VERSION_CONFLICT，不静默覆盖。
- 当日已有 5750 ml 时并发新增两次 250 ml，最多一次成功，最终有效累计不超过 6000 ml。
- 用户主动连续喝两杯产生两条饮水记录；同一操作网络重试只产生一条，首次饮水日奖励最多一次。
- 同日称重多次后展示最新有效记录；删除最新记录后回退到剩余最近一次，同时间戳排序稳定。
- 重复删除本人记录返回一致结果，其他用户通过 UUID 不能删除或查看该记录。
- 历史补录保存到选中的上海日期且不发当日奖励；上海午夜附近 recorded_at 与 business_date 保持一致。
- 删除饮水后再新增不会再次领取同日奖励，饮水记录、积分原账和看板统计分别遵守既定事实与奖励规则。
- 近 7/30 天始终返回连续日期点；没有测量的体重和心情为 null，不连接出伪造测量值。
- 仅两天有饮水记录时均值按两天计算；完全没有记录时平均值为 null，不能按全周期将缺测视为零后稀释均值。
- 部分营养未知时正确返回已知量和完整度，不用固定比例补齐；无目标时剩余预算、进度等依赖目标项为空。
- 饮食、训练或心情完成真实写入后，今日和个人大屏显示相同已提交事实；切换账号清缓存后看不到上一用户数据。

## 本组边界与注意事项

- 健康目标必须由用户设置，不能擅自把默认 55 kg、1800 kcal 或某个减重目标存成真实配置。
- 饮水上限是本版录入边界，不能在产品中包装成适合所有人的健康推荐。
- 本组只写 3 张健康表，积分、餐记录、训练和情绪通过负责人端口读取或调用，不能直接修它们的数据库。
- 不增加公开用户健康大屏、IoT 接入或日汇总事实表；历史页面展示的目标明确使用当前目标口径。
- 均值分母、缺测处理、补录奖励和删除不重置资格的规则不可由图表实现者自行改变。

## 全团队表归属

| 工作包 | 业务表数 | HTTP接口数 | 写入表 |
| --- | --- | --- | --- |
| M01 账号与公共底座 | 12 | 17 | `users`、`auth_challenges`、`user_sessions`、`refresh_tokens`、`media_assets`、`notification_subscriptions`、`notifications`、`notification_deliveries`、`idempotency_requests`、`outbox_events`、`user_roles`、`audit_logs` |
| M02 健康记录与个人看板 | 3 | 10 | `health_profiles`、`water_records`、`weight_records` |
| M03 饮食识别与附近餐饮 | 6 | 14 | `foods`、`recognition_jobs`、`meals`、`meal_items`、`restaurants`、`restaurant_favorites` |
| M04 训练计划与提醒 | 7 | 15 | `training_courses`、`training_plan_templates`、`training_template_items`、`training_plans`、`training_plan_items`、`workout_sessions`、`training_reminders` |
| M05 积分兑换与活动预约 | 13 | 33 | `point_accounts`、`point_task_definitions`、`point_task_awards`、`point_ledger`、`point_rewards`、`point_redemptions`、`activities`、`activity_slots`、`activity_bookings`、`booking_events`、`community_profiles`、`user_blocks`、`community_reports` |
| M06 情绪记录与AI陪伴 | 3 | 11 | `mood_records`、`companion_sessions`、`companion_messages` |

<!-- BEGIN_COMMON_CONTRACT -->
## 共同执行的项目基线

契约编号：**QY-MYSQL-1.0.0**。编制日期：2026-10-19。适用对象：六名成员及各自使用的编码 Agent。

本包以轻养当前 H5、2026-10-18 的 PRD 与接口设计为输入，将数据库明确改为 **MySQL 8.4 / InnoDB**。这是本次制定的开发基线，不代表线上已经存在后端，也不代表尚待产品确认的运营规则已经获批。原 PostgreSQL 文档仅作需求追溯；不得执行其中的 PostgreSQL 类型、部分索引或函数。

### 1. 六个人如何独立开发后整合

1. **同一份前端源码、同一初始 Git commit、同一数据库版本。** 部署网址用于确认页面，不能代替源码。M01 在建项时填写project_baseline.json的仓库地址与起始commit，并同步schema_manifest.json的codeBaseCommit；更新CHECKSUMS.json中这两个文件的SHA-256后统一发布，V001内容和SHA保持不变。六个人从同一commit建功能分支；本次未收到源码仓库，不虚构commit。
2. 每个人使用自己的本地数据库，例如 `qingyang_dev_m01` 至 `qingyang_dev_m06`，结构都由同一个 `V001__baseline.sql` 初始化。一个成员的测试数据不影响别人。
3. 最后合并的是业务代码、接口片段、测试夹具与经审核的增量迁移。**不把六个开发库的数据导出再拼成一个库，也不让六人直接修改同一共享库的结构。**
4. 一张表有且只有一个业务负责人。其他组调用该组公开的内部服务；数据查询通过约定的只读端口或查询视图，不绕过负责人直接写表。
5. M01 统一维护数据库基线、迁移顺序、公共类型、全局请求客户端、应用装配和依赖锁文件。各业务组独立提交自己模块目录；M01 的集成责任不替代业务组完成自己的前后端与验证。
6. 本包中的六份任务 Markdown 均嵌入相同的完整 SQL 基线。只给某个 Agent 一份对应 Markdown，也能了解全库；未来修改后必须重新发布同一版本的六份文件，不能手改某一份 SQL 附录。

### 2. 实现与目录基线

保留现有 **Next.js + React + TypeScript** 前端。为让各组能直接实施，本包默认后端统一为 **NestJS + TypeScript 的模块化单体**，数据库访问采用同一个 `mysql2/promise` 连接池封装。API 与 Worker 可分进程，但共用同一业务代码库和 MySQL 数据库。该选项是本次实施默认值，非已安装依赖声明。若实际仓库已有统一后端，M01 通过一次架构变更映射到既有框架；六组不得自行选择六种框架。

前端保留原 `src/` 路径，不为分工搬迁整个前端。后端新增 `server/`；公共契约放 `contracts/`；SQL 放 `db/`。路径若与实际源码不一致，由 M01 一次性发布对照表，所有组沿用。

| 目录 / 文件 | 修改负责人 | 协作方式 |
| --- | --- | --- |
| `src/lib/api/client.ts`、公共生成类型、全局 `health-provider.tsx` | M01 | 其他组提出需求，不各复制一套请求器或登录态 |
| 根依赖及锁文件、`server/package.json`、根模块装配、环境示例 | M01 | 业务组在交付单列新增依赖，由 M01 统一安装锁版本 |
| `src/features/dashboard/`、`overview/`、`health/` | M02 | 健康档案弹层组件由 M02 交付给 M05 引入 |
| `src/features/nutrition/` | M03 | 同一组完成饮食与附近餐饮，避免同文件争用 |
| `src/features/training/` | M04 | 计时、课程、计划与提醒同组维护 |
| `src/features/profile/`、`points/`、`activities/`、`community/` | M05 | “我的”页由 M05 装配；账号卡与档案组件分别引用 M01/M02 输出 |
| `src/features/companion/` | M06 | 情绪与聊天同组维护 |
| `server/src/common/`、`server/src/modules/identity/`、`uploads/`、`notifications/` | M01 | 基础设施与公共权限，不承包各模块运营业务 |
| `server/src/modules/health/` | M02 | 档案、水、体重、汇总查询 |
| `server/src/modules/nutrition/`、`restaurants/` | M03 | 食物、识别、餐记录、商家 |
| `server/src/modules/training/` | M04 | 训练业务和提醒业务规则 |
| `server/src/modules/points/`、`activities/`、`community/` | M05 | 账务、活动、社区业务 |
| `server/src/modules/companion/` | M06 | 情绪、聊天、模型适配 |
| `contracts/openapi/M0X.yaml` | 对应 M0X | 各组提交自身接口片段，M01 合并发布，不共同改一个大 YAML |
| `db/migrations/`、`contracts/schema_manifest.json`、公共类型 | M01 | 只能由统一发布流程更新 |
| `db/proposals/M0X/`、`db/seeds/M0X/`、模块测试 | 对应 M0X | 各组独立目录；提案不会自动执行 |

前端出现跨组组件时，以**组件接口**交付，不让多人同时编辑 `profile.tsx`。默认 `HealthProfilePanel` 的 props 为 `open:boolean`、`onClose():void`、`onSaved():void`；它自己查询/保存档案，调用统一缓存失效方法。M01 的 `AccountSummary` 从统一会话数据读取账号，M05 仅负责排版。

### 3. MySQL 必须一致的规则

| 项目 | 唯一口径 |
| --- | --- |
| 数据库 | MySQL 8.4，InnoDB；不以 MariaDB、SQLite 或 PostgreSQL 替代验收 |
| 数据库名 | 每人本地各一库，整合环境单独一库；代码从环境读取，不硬编码其他人的库名 |
| 主键 / 外键 | 全部业务 ID 使用应用生成的小写 UUID v4；`CHAR(36) CHARACTER SET ascii COLLATE ascii_bin`；不可自行改 BIGINT / 自增 / BINARY(16) |
| 表 / 列 | `snake_case`；保持附录中的名字，不加个人前缀、不重命名同义表 |
| API 字段 | `camelCase`，UUID 返回 string；库字段到 API 的映射集中在 DTO/mapper |
| 用户文本 | `utf8mb4` + `utf8mb4_0900_ai_ci`；状态、机器编码和幂等键使用区分大小写的 ASCII 列 |
| 时间 | `DATETIME(3)` 保存 UTC。每条数据库连接设 `time_zone='+00:00'`；应用读写都按 UTC 转换。不能只设置建表连接就认为连接池全部生效 |
| 业务日期 | `business_date DATE` 按 `Asia/Shanghai` 计算；一笔操作由服务端取得一次 `operationNow`，该事务各模块使用同一时间。重试返回原已提交结果 |
| 日期输入 | 时间戳必须带时区；API 为 `...Z` ISO8601，日期为 `YYYY-MM-DD`；日期值不可被驱动转换成错误时区的 JS Date |
| 精度 | 体重/份量/营养用 DECIMAL，积分和时长用整数；API 返回 number，由 mapper 显式转换，不能把驱动的 decimal 字符串泄露成另一套协议 |
| 布尔 | 库中 0/1，API true/false；不能把 2 当 true 写入；DDL 提供相应 CHECK |
| 结构化内容 | MySQL JSON；禁止 `jsonb`、`text[]`、`smallint[]`。JSON 类型 CHECK 只检查形状，字段和数组元素仍由 DTO 校验 |
| 空值 | 无测量 / 无目标 / 未知营养是 null；没发生的累计可为 0。不从演示数据补值 |
| 软删除 | 表有 `deleted_at` 就必须在普通查询排除；水、体重、餐记录、聊天会话使用其字段。软删不释放已经领取的奖励或已经确认的识别任务 |
| 并发版本 | 有 `version` 的资源修改必须携带 version 并条件更新；过期返回409。不存在的健康档案/社区档案/训练提醒GET均data:null，首次PUT用version=0，建成后为1；两个首次创建只允许一个成功；未设置提醒的表单默认值只在UI本地，不生成假id |
| 外键 | 先创建所有表，再添加 FK，解决 users ↔ media 等环；默认 RESTRICT。不得关闭 foreign_key_checks 绕过问题 |
| 条件唯一 | 活动训练、活动计划、生成中的聊天用可空 STORED guard + 唯一键；非活动历史 guard=null。不得改成 `(user_id,status)` 唯一 |
| 数据来源 | `V001__baseline.sql` 是建库事实源；manifest及MD附录从同一份生成。既有环境只应用新增迁移，不重复跑V001 |

MySQL 的 DATETIME 不自动保存或转换时区，所以“UTC存储”是驱动、连接与业务代码共同执行的约定。MySQL 的普通唯一索引允许多个 NULL，可用于上述条件唯一设计。[MySQL 日期类型](https://dev.mysql.com/doc/refman/8.4/en/datetime.html)；[MySQL 唯一索引](https://dev.mysql.com/doc/refman/8.4/en/create-index.html)。

### 4. 公共 HTTP 契约

- 基础地址 `/api/v1`。H5 使用同站反向代理、Secure/HttpOnly Cookie；写请求携带 `X-CSRF-Token`。真实用户 ID 只从服务端身份读取，普通业务 Body 不允许 `userId/role/balance/delta`。
- JSON 键 `camelCase`，未声明字段返回422；通用头为 `X-Client-Platform:h5`，POST命令带 `Idempotency-Key`。同一次用户操作重试复用该key，主动再做一次操作生成新key。
- 普通成功：`{data:...,meta:{requestId,serverTime,timezone:'Asia/Shanghai'}}`。异步创建202，资源创建201，常规查询/修改200；204不得带JSON；SSE不套envelope。
- 普通列表：`data:{items:[],nextCursor:null}`，limit默认20、1—100；排序同值时必须以id作为第二排序键。附近搜索limit≤50。
- 默认游标基于 `(created_at,id)` 倒序；餐、水、体重基于 `(recorded_at,id)` 倒序；场次基于 `(start_at,id)` 正序；聊天会话基于 `(COALESCE(last_message_at,created_at),id)` 倒序。游标封装排序键及筛选摘要；筛选变化不能复用。参照本组接口表的特殊顺序。
- 错误：`{error:{code,message,fields?,retryAfterSeconds?},meta:{requestId,serverTime}}`。401处理登录、403权限/CSRF、404资源不存在或不属于本人、409业务/版本冲突、422参数、429限流、502/503供应商不可用。
- 统一至少包含 `VERSION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`REQUEST_IN_PROGRESS`、`ASSET_IN_USE`、`RECOGNITION_ALREADY_USED`、`WORKOUT_IN_PROGRESS`、`GENERATION_IN_PROGRESS`、`ACTIVITY_FULL`、`BOOKING_CLOSED`、`BOOKING_TIME_CONFLICT`、`CANCELLATION_CLOSED`、`INSUFFICIENT_POINTS`、`OUT_OF_STOCK`、`REWARD_CHANGED`。
- 输入DTO与输出DTO分开：前端不能回传模型confidence、只读status、库存、价格、奖励金额；模型不得构造真实业务写入请求。
- `GET /meta/contract` 为本次新增联调接口，返回契约号、已应用schema版本、V001校验值和timezone。schema版本从迁移历史读取，不能写死成比实际更高的版本；该接口不返回连接信息。
- 原生App、注销/导入等后续能力不在六组首轮H5验收中。保留现有原稿的后续扩展说明，不假称已实现。

### 5. 内部服务与事务边界

普通单用户命令由公共 `UnitOfWork.runForUser(userId, fn)` 创建唯一事务，并先 `SELECT id FROM users WHERE id=? FOR UPDATE`。需要引用其他用户的新关系（例如屏蔽）、处理其他用户账号的后台命令使用 `runForUsers(actorUserId, referencedUserIds, fn)`：先汇总全部用户ID、去重升序、逐个主键取锁，再进入幂等行和业务资源；ctx.userId始终是操作者。不能先锁操作者后再临时追加逆序目标用户锁。首次账号创建属于M01的专门引导事务，创建用户后再调用M05开户。业务组拿到同一个 `SqlTx` 和 `CommandContext`。该对象只提供参数化query/execute，业务组不能自行commit、不能新开一个连接完成同一业务的一半。

跨模块同步读通过注入的 QueryPort；普通模块只能写自己的表。M05的PointsPort与M01的OutboxPort是例外调用方式：**调用方传同一tx，真正的跨表写入由表负责人实现。** 这是同一个后端进程内的方法调用，不经HTTP，不做分布式事务。公共UnitOfWork另提供严格限用途的`runSystem(scope,fn)`，用于auth_bootstrap、idempotency_claim、outbox_claim、delivery_claim、provider_job短事务；幂等/队列领取不得在持锁后调用runForUser。模型消费者按业务资源固定顺序更新，聊天领取/写回为session→message，不反向锁用户；新的用户通知由通知服务另起runForUser处理。runSystem不是普通业务绕开用户锁的通用入口。

| 公共输出 | 实现方 | 使用者 / 契约 |
| --- | --- | --- |
| 身份、UTC时钟、业务日、幂等、SqlTx、UnitOfWork | M01 | 全组；只信任服务端身份和时间 |
| `PointsPort.ensureAccountInTransaction(tx,{userId})` | M05 | M01首次建账号同事务创建0积分账户；不赠送演示320分 |
| `PointsPort.awardInTransaction(tx,ctx,input)` | M05 | M02饮水、M03记餐、M04完成训练；返回awards/account |
| `OutboxPort.enqueueInTransaction(tx,event)` | M01 | 各组创建异步任务/通知；仅写必要ID与schemaVersion |
| `MediaPort.assertReady(tx,input)` 与 `createReadUrl(input)` | M01 | M03识别、M04课程、M05活动/奖励、M01头像；检查用途、归属和ready状态 |
| 健康/饮食/训练/积分/情绪/活动的只读QueryPort | 各表负责人 | M02聚合看板；接口在共享类型文件固定，不直接导入他组repository |
| 公共前端刷新 `invalidateHealth(date)` 等 | M01提供实现，各组调用 | 保存后刷新业务列表、dashboard、overview、积分与任务；退出登录清空用户缓存 |

`MediaPort`是进程内可信端口，不能从HTTP Body直接透传actorUserId/access。`owner`必须验证actor等于asset.user_id且用途为avatar/meal_photo；管理员也不能绕过他人餐照归属。`admin_material`由M01检查当前admin角色且用途只能为四类运营素材。`public_display`只用于业务模块已经验证可公开的头像安全缩略图或已发布内容素材，绝不允许meal_photo；业务模块先检查用户可见性/屏蔽或内容发布状态。`assertReady`复用传入tx，只进行数据库校验，不发网络请求。`createReadUrl`在业务/只读快照事务之外调用，M01重新读取并授权，只签safe_object_key，默认及最大有效期300秒，并返回readUrlExpiresAt，不输出原始对象键。签名URL可在事务结束后补入响应，不改变统计事实。识别Worker先从数据库任务复核userId，再用owner模式；不单独信任事件payload。

**饮水、记餐、训练发奖输入仅有事件类型和已存在的业务记录ID。** M05重新查询来源记录的user、状态、日期；workout还校验course与reward_eligible。不信任调用者传来的积分额度或scope。签到是明确例外：`{type:'checkin'}`不带sourceId，以已认证用户与服务端当前业务日创建唯一award，`source_id=NULL`，账本business_id仍引用award.id；不得补造签到记录ID或各组另建签到表。当前日首次饮水、记餐、有效训练与其奖励、账户、账本在同一MySQL事务提交；任何一步失败全部回滚。

统一奖励code：`daily_checkin`、`daily_water`、`daily_meal`、`course_workout`。暂定开发额度依次10/5/10/20；前三项按日、最后按课程/日。`scope_key`由M05生成，普通日任务空字符串、训练课程ID。以上额度与80%训练门槛是便于联调的工作配置；正式上线时由项目负责人确认版本，所有组使用同一配置。

补录过去30天允许保存，但不发日任务积分。删除记录不删除award或原账本，不恢复可领奖资格；异常奖励由M05增加补偿流水，不改原流水。`rule_version`不进入任务唯一键，避免改规则后同日再领一次。

通用业务事务锁顺序为：**用户行 → 本请求幂等行（如有）→ 本业务资源 → 积分账户 → 积分商品库存 → 派生记录/outbox**；同类多行按UUID升序。积分兑换固定账户先于商品。所有修改指定库存或名额的事务使用正常FOR UPDATE，不能用SKIP LOCKED把“正在处理”误判为“不存在”。

活动普通路径进一步固定为 `users → activities → activity_slots → activity_bookings`（幂等行仍位于users之后）。主办方整场取消可以先锁操作者自己的users行，再走 `activities → activity_slots → bookings`，持有活动/场次后禁止再申请参与者用户行、积分账户或用户专属互斥；这样不与普通路径形成反向等待。通知只写outbox，提交后再建立带参与者user_id外键的通知记录。场次已取消必须阻止所有新预约。并发冲突/死锁只重试完整事务，最多3次且复用幂等key，不重试其中半条SQL。[MySQL 锁定读取](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)。

禁止在数据库事务中等待LLM、短信、地图、推送或权益履约。需要调用外部服务时，先写业务状态和outbox并提交，Worker再执行。

### 6. 幂等、异步与失败恢复

普通幂等作用域为 `(principal_key,method,request_path,idempotency_key)`；同key不同bodyHash返回409。同key已成功返回原业务结果；业务唯一约束继续提供24小时缓存之外的去重。

公共实现先在只操作幂等表的短事务中建立/领取租约并提交，不在这个短事务中取用户锁。随后业务事务先锁用户、再锁本幂等记录，核验locked_by、lease_version、locked_until与bodyHash（库列body_hash），执行业务并将响应和completed状态同事务提交。接管也只在幂等短事务中确认是否已经完成，提交后才进入users→幂等→业务的顺序；绝不能一条路径users→幂等、另一条幂等→users。若请求中断，已提交业务一定有同事务completed结果；失败回滚后只按当前lease_version更新失败状态，避免旧执行者覆盖新执行者。

领取幂等时processing必须同时填locked_by/locked_until、清空response_status/response_body；成功completed必须清空两个锁字段并填2xx response_status；最终failed必须清锁并填4xx/5xx response_status。失败不能提交部分业务事实。Outbox processing必须填两锁且published_at为空；published必须清两锁、填写published_at；pending/failed必须两锁和published_at均为空。状态、租约和结果字段须在同一次条件UPDATE中修改，具体CHECK见SQL。

登录/刷新凭据不走普通response_body重放；验证码挑战的消费、首次用户建立和会话建立须原子。刷新已消费token的重放撤销对应会话；客户端刷新仅单飞一次，其他请求共享结果。短信、登录和刷新有专用短窗口重试处理，不把长期token、验证码或Cookie明文放幂等响应。

outbox是至少一次派发。M01用短事务领取、保存lease_version/locked_until后提交，再访问队列；确认更新必须匹配lease_version。发布后崩溃可能重复派发，所以每个消费者根据业务ID、状态和版本去重。后台扫描还需接管过期processing记录，而不是只扫描pending。

事件payload必须符合共享`OutboxPayloadMap`逐项白名单，不能用任意JSON代替。以下字段名冻结：识别用jobId，文件用assetId，聊天用assistantMessageId/sessionId，提醒用reminderId/reminderVersion/scheduledAt，预约通知用bookingEventId区分首次/重约/取消。消费者从这些ID读数据库；不用payload中的用户身份绕过资源归属校验。具体生成方、消费方及eventKey见事件注册表。

模型Worker在短事务中领取queued任务并保存run_token、lease_until；网络调用在事务外。快照、续租与最终成功都只允许 `status=running/generating AND run_token=本次token AND lease_until>nowUtc` 的CAS更新。用户取消后迟到结果不得覆盖canceled，过期执行者也不能自我续租。外部供应商若没有幂等请求能力，网络结果不明时不能保证“收费调用绝对只一次”；本基线不自动重发不明结果的模型调用，租约到期由回收器以旧token与过期条件转failed并清lease，保留可恢复状态，用户明确发起新操作后再试。

数据库保存消息内容快照、状态与最终结果；Redis只存短期SSE事件，不承担聊天历史的唯一持久化。SSE按sequence去重恢复，过期返回410再GET消息，不重新POST。

### 7. 跨页数据的唯一来源

| 页面字段 | 真实来源 / 计算 |
| --- | --- |
| 今日饮水 | `water_records` 当日未删amount_ml之和；当天操作的6000ml上限在用户锁内检查 |
| 当日体重 | `weight_records` 当日未删记录按recorded_at,id最后一条；缺测null，不自动借用昨日值 |
| 当前档案体重 | 全部日期未删weight_records最新测量；目标体重来自health_profiles，二者分开 |
| 一餐摄入 | 未删meals关联meal_items的营养快照；不保存另一个可写totals事实表 |
| 当日运动 | completed workout_sessions 的active_duration_seconds及估算消耗；paused不累计 |
| 心情 | 用户主动提交mood_records；不能从聊天推断后偷偷覆盖 |
| 积分 | point_accounts余额；point_ledger为不可随意改删的账本，两者同事务维护 |
| 剩余名额 | activity_slots.capacity - booked_count；名额由事务维护，前端不计算后回写 |
| 看板、大屏 | 上述QueryPort聚合；不另造一套用户表、日汇总事实或演示缓存 |

M02以同一个只读一致性快照调用所有汇总QueryPort；每个端口使用同一tx查询，不自行开连接。饮食营养任意一项未知时，consumedG可合计已知部分但complete=false。日平均仅以该类有记录天数为分母；7/30天图表始终返回所有日期，缺体重/心情为null。

未建立health_profiles的用户可记录健康行为；target、progress、剩余额度等依赖目标的字段返回null并提示设置目标，不塞入55kg/1800kcal等示例。健康档案PUT需完整用户选择；GET返回 `{data:null,...}` 表示尚无档案。

开发期间可用明确标记的fixture，但真实模式无数据必须显示空状态。同一个Query缓存key包含userId与筛选条件；账号切换要清空，防止看到上个用户数据。缓存刷新是展示一致性，不能替代数据库事务。

### 8. 模块独立运行与公共桩

首个公共交付不是全做完M01，而是可启动API、统一鉴权上下文、SqlTx/UnitOfWork、空状态DTO、MySQL V001和各组内部接口。M05同步交付0余额开户与原子发奖内核。

每组把未完成依赖做成**符合本包接口的可注入桩**，仅在本地或staging的显式测试配置使用。桩可以提供固定fixture以调试UI，但不能冒充积分事务、实际占座或真实模型结果通过整合验收。生产配置若仍启用mock或缺少真实adapter，启动/发布检查失败并提示缺项。

本地测试数据由表负责人提供版本化seed。M03供食物目录；M04供课程/计划模板；M05供奖励规则与明确测试活动。各组使用固定UUID注册表，不分别生成含义相同但ID不同的课程/任务；不向真实用户seed健康记录、320积分或模拟预约。第三方地图数据是否落库由实际授权决定；不持久化不允许缓存的内容。

### 9. 数据库变更和合并办法

V001冻结后不再改字节。新增需求由对应表负责人提交 `db/proposals/M0X/CR-日期-序号.md`，写：原因、旧字段/新字段、SQL、受影响API、消费组、存量数据处理、回退办法和验证。提案阶段不得先在公共库改表。

M01合并前完成：核对受影响组接口 → 分配唯一顺序迁移V002/V003 → 验证空库从头可建、旧版可升级 → 更新schema/接口版本和校验清单 → 同步发布六份任务包。业务组自己的提案名用模块前缀，不各自抢同一个V002编号。

MySQL DDL会发生隐式提交，不能认为把整段migration包在BEGIN/ROLLBACK即可原子撤销。迁移先在独立库验证；失败时停止后续发布，按已记录步骤前向修复或恢复备份。删除/改名字段采用“先新增兼容字段→双读/迁移→切换→另版删除”的渐进方式；不把DROP或reset当作合并冲突解决方案。

在代码评审中检查表和文件归属；不要把通用数据库账号可以写全库误当成权限已隔离。本设计的业务所有权首先是代码/评审约束，真正的数据一致性再由FK、唯一键、CHECK与事务保证。关键账务写入口集中于M05。

### 10. 每组提交时统一交付

每组提交：本模块源码、所属OpenAPI片段、DTO/mapper、模块seed、运行说明、验收结果、依赖清单、未接服务清单以及schema变更提案（若有）。使用 `HANDOFF_TEMPLATE.md` 列明契约版本、Git commit、涉及表/文件、已通过/未运行的用例。

取得完整协作包后运行 `python tools/check_contract.py`，检查版本文件、六份MD的公共规则、SQL和类型附录是否一致。只拿到单份MD时，先将附录原样保存为SQL/类型文件、核对本MD给出的V001 SHA-256，并按嵌入的交接单字段工作；不需要另外五份MD才能开始。本脚本需要完整包，未取得时在交接单注明“完整包一致性检查未运行”，不能伪称通过；M01整合前必须执行完整检查。包一致性检查不替代MySQL实机或业务验证，M01还需验证空库建表、事务边界、各组路由重复、公共类型和真实前端闭环。

首轮端到端演示：两个不同账号 → 其中一个手动记录一餐 → 日记/今日/大屏显示同一结果 → 首次奖励只记一次 → 刷新/重新登录仍存在 → 另一个账号看不到。下一轮加入训练恢复与积分，再接AI、餐饮、预约、提醒和数字权益；功能未接真实服务时明确标记，不以演示替代验收。

### 11. 不能由各Agent自行决定的业务口径

开发工作配置暂定：签到10分、饮水5分、饮食10分、训练20分/课程/日；训练门槛80%；禁止已确认预约时间重叠；参与者默认hidden；新账户余额0；人工历史补录不发积分；删除记录不重置奖励资格。正式运营额度、供应商、权益履约、取消时限等由负责人统一确认、配置和发布，各组不单独改。

本期H5包括个人健康可视化；没有将健身房监控、设备实时采集、摄像头动作纠正、原生App、会员支付、外卖交易、实物物流或私信匹配加入工作包。涉及健康的数值是记录/用户目标/估算，不把模型输出包装成测量或诊断。

### 12. 官方依据与原资料追溯

- 原《健康App-前后端接口与数据库设计.md》V1.0：§1现状、§3公共接口、§4—12业务表和接口、§13事务、§14前端改造、§15验收。本包对其PostgreSQL设计做MySQL落地并补齐实施缺口。
- 原《轻养健康App-PRD.html》V1.0：§3范围、§3.1跨页规则、§5场景、§7识别时序与待确认事项。原HTML使用相对路径依赖原型/流程图文件，本次两附件没有这些关联文件；本包依据可读正文，不假称已核对所有外链原型。
- [MySQL 8.4 CREATE INDEX](https://dev.mysql.com/doc/refman/8.4/en/create-index.html)：唯一索引、可空键。
- [MySQL 8.4 CHECK](https://dev.mysql.com/doc/refman/8.4/en/create-table-check-constraints.html)：静态检查与确定性函数限制；近30天/当前年由服务端判断。
- [MySQL 8.4 日期类型](https://dev.mysql.com/doc/refman/8.4/en/datetime.html)：DATETIME精度与时区行为。
- [MySQL 8.4 Locking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)：FOR UPDATE、队列场景的SKIP LOCKED。
- [MySQL 8.4 隐式提交](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)：DDL迁移不是普通DML事务。
<!-- END_COMMON_CONTRACT -->

## 本组HTTP接口清单

所有路径均在`/api/v1`下；原文参数描述经本包补充后，以公共类型与本表明确规则为准。

| 方法 / 路径 | 请求 | 返回 / 行为 | 来源 |
| --- | --- | --- | --- |
| `GET /me/dashboard` | Query：`date?:date`，默认当前业务日；`timezone?:'Asia/Shanghai'` | DashboardDto，见共享类型；无档案时target/预算/progress均null。 | 原文独立接口 |
| `GET /me/health-profile` | 无 | HealthProfileDto&#124;null；不存在时data:null，不默认写目标。 | 原文独立接口 |
| `PUT /me/health-profile` | HealthProfileInput；完整PUT，省略可选项置null；首建version=0，后续带当前version。 | HealthProfileDto；首次落version1，版本冲突409。 | 原文独立接口 |
| `GET /me/health/overview` | Query：`range?:7或30=7`，`endDate?:date=今天` | OverviewDto，见共享类型；7/30连续日期、缺测null、分类覆盖率。 | 原文独立接口 |
| `GET /me/water-records` | Query：`date:date` + 分页 | 单次饮水记录列表 | 原文独立接口 |
| `POST /me/water-records` | Body：`amountMl:int(1–1000),recordedAt?:ISO,source?:'manual'=manual` | `{record,todaySummary,awards:[]}`；日累计上限 6000 ml 为录入边界，不是健康建议 | 原文独立接口 |
| `DELETE /me/water-records/{id}` | Path：uuid | 204；只允许删除本人记录，重算汇总，不因此允许重新刷同日奖励 | 原文独立接口 |
| `GET /me/weight-records` | `startDate,endDate`（含端点，最多 366 天）+ 分页 | 测量记录列表 | 原文独立接口 |
| `POST /me/weight-records` | `weightKg:number(20–350),recordedAt?:ISO,source?:'manual'` | `{id,weightKg,recordedAt,businessDate}` | 原文独立接口 |
| `DELETE /me/weight-records/{id}` | uuid | 204；当日显示剩余记录中的最新值 | 原文独立接口 |

## 本组实施详则

## 6. M02 必须实现的业务验证

### 6.1 档案

- 没有档案时 `GET /me/health-profile` 返回 envelope 内 `data:null`。前端展示待设置目标。`PUT` 首次创建传 version=0，库内写 version=1；首次并发由 user_id 唯一约束保护，后一请求返回 409 VERSION_CONFLICT，不覆盖前一次。
- 更新必须传现有 version，执行 `UPDATE ... SET version=version+1 WHERE user_id=? AND version=?`。零行时区分“不存在”或版本冲突；不能无条件 upsert 覆盖。
- 身高可空，targetWeight/waterTarget/calorieTarget/goalType 必填，三项营养目标可空；完整 PUT 对未给的可选字段按统一 DTO 规范置 null，不能各端保留/清空行为不同。
- birthYear 动态上界由服务端按**当前上海年份**校验；SQL 只设 1900–9999 静态存储边界，不使用 `CHECK YEAR(NOW())`。包括入参精度、DTO 白名单在内的验证均发生于写库前，避免数据库自动四舍五入接受不符合约定的小数。
- 没有档案时 targetMl、targetKg、baseTargetKcal、targetG 等字段为 null，water.progress 为 null；依赖目标的 effectiveTargetKcal、remainingKcal 为 null。真实饮水累计、饮食累计、训练消耗仍按事实返回。无记录的累计可为 0，未知目标不能伪装为 0 或自动填示例值。
- 当前体重只来自 weight_records。不得在 users、health_profiles 等处冗余维护一份 current_weight；历史页面目标标注为“当前目标”。

### 6.2 记录、删除与统计

- recordedAt 接受带明确时区的 ISO 8601，服务端转 UTC。允许区间为当前时刻之前 30 天到当前时刻；未传时用服务端当前时间。business_date 只能服务端按 Asia/Shanghai 计算，拒收前端自填派生日期。
- 同一天多次饮水、称重均是合法独立事件，不在 `(user_id,business_date)` 上加唯一约束。每次饮水 1–1000 ml；有效日累计不能超过 6000 ml，此上限是录入边界。
- 饮水新增事务先由统一入口锁 users 行，再汇总本人当日 `deleted_at IS NULL` 的 amount_ml，校验加本次量后不超上限，插入记录，并调用同事务积分服务。删除也按同一用户锁序执行，防止并发增删突破上限或丢失汇总。
- `DELETE /me/water-records/{id}`、`DELETE /me/weight-records/{id}` 统一写 deleted_at。owner 不匹配返回 404；本人已软删记录重复 DELETE 返回 204。所有列表、看板、Overview、奖励条件和导出查询都立即加 `deleted_at IS NULL`。不能只在单个页面过滤。
- 删除记录不删除或重置 point_task_awards / point_ledger，不能删除后再添加以重复获奖。补录非服务器当前业务日只记事实，不补发当日任务积分。回滚与纠错使用积分模块正式规则，M02 不直接改账。
- 当日体重取该日有效记录按 `(recorded_at DESC,id DESC)` 最新一条；previousKg 取查询日之前最近有效测量；当天无测量 latestKg=null。取相同时间戳时必须用 id 决定稳定顺序。
- Overview 先生成连续 7/30 个业务日期，再联接每日聚合；缺测体重/情绪=null。饮水/饮食均值分母只算存在相应有效记录的天数；零记录时平均值=null。目标不全时 BMI/目标预算衍生项应为 null，不能做除零或猜值。
- 业务写入提交后使对应用户/日期的 dashboard、overview、积分任务缓存失效。写接口响应中的 summary 来自已提交一致事实；不能混用本地 seed。
- 软删不是无限保留政策。最终清理/去标识化走统一受控流程并记录审计；上线前明确保留策略，但本片段不编造固定法定期限。



## 事件字段注册表

| 事件 | 生成 → 消费 | payload必填 | eventKey（加事件名前缀） |
| --- | --- | --- | --- |
| media.validate.requested.v1 | M01 → M01媒体Worker | assetId:UUID | media.validate.requested.v1:assetId |
| nutrition.recognition.requested.v1 | M03 → M03识别Worker | jobId:UUID, userId:UUID, assetId:UUID | nutrition.recognition.requested.v1:jobId |
| companion.reply.requested.v1 | M06 → M06聊天Worker | assistantMessageId:UUID, sessionId:UUID, userId:UUID | companion.reply.requested.v1:assistantMessageId |
| training.reminder.due.v1 | M04 → M01通知服务，调用M04验证当前规则 | reminderId:UUID, userId:UUID, reminderVersion:int, scheduledAt:Instant | training.reminder.due.v1:reminderId:reminderVersion:scheduledAt |
| activity.booking.confirmed.v1 | M05 → M01通知服务 | bookingId:UUID, bookingEventId:UUID, slotId:UUID, userId:UUID | activity.booking.confirmed.v1:bookingEventId |
| activity.booking.canceled.v1 | M05 → M01通知服务 | bookingId:UUID, bookingEventId:UUID, slotId:UUID, userId:UUID | activity.booking.canceled.v1:bookingEventId |
| activity.slot.canceled.v1 | M05 → M05列出host_cancel动作，M01通知 | slotId:UUID, slotVersion:int, actorUserId:UUID | activity.slot.canceled.v1:slotId:slotVersion |
| points.redemption.requested.v1 | M05 → M05履约Worker | redemptionId:UUID, userId:UUID | points.redemption.requested.v1:redemptionId |
| points.redemption.finished.v1 | M05 → M01通知服务 | redemptionId:UUID, userId:UUID, redemptionVersion:int, status:fulfilled&#124;refunded | points.redemption.finished.v1:redemptionId:redemptionVersion:status |

## 本组逐字段数据库字典

### `health_profiles` · M02

用户主动设置的档案与目标，不冗余当前体重。

| 字段 | 精确SQL定义（类型 / 空值 / 默认 / 生成规则） |
| --- | --- |
| `id` | `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL` |
| `user_id` | `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL` |
| `height_cm` | `DECIMAL(4,1) NULL` |
| `birth_year` | `SMALLINT NULL` |
| `target_weight_kg` | `DECIMAL(4,1) NOT NULL` |
| `water_target_ml` | `INT NOT NULL` |
| `calorie_target_kcal` | `DECIMAL(6,1) NOT NULL` |
| `carbs_target_g` | `DECIMAL(5,1) NULL` |
| `protein_target_g` | `DECIMAL(5,1) NULL` |
| `fat_target_g` | `DECIMAL(5,1) NULL` |
| `goal_type` | `VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL` |
| `version` | `INT NOT NULL DEFAULT 1` |
| `created_at` | `DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)` |
| `updated_at` | `DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)` |

约束与索引：

- `PRIMARY KEY (id)`
- `CONSTRAINT uq_health_profiles_user UNIQUE (user_id)`
- `CONSTRAINT ck_health_height CHECK (height_cm IS NULL OR height_cm BETWEEN 50.0 AND 250.0)`
- `CONSTRAINT ck_health_birth_year CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 9999)`
- `CONSTRAINT ck_health_target_weight CHECK (target_weight_kg BETWEEN 20.0 AND 350.0)`
- `CONSTRAINT ck_health_water_target CHECK (water_target_ml BETWEEN 500 AND 6000)`
- `CONSTRAINT ck_health_calorie_target CHECK (calorie_target_kcal BETWEEN 800.0 AND 5000.0)`
- `CONSTRAINT ck_health_carbs_target CHECK (carbs_target_g IS NULL OR carbs_target_g BETWEEN 0.0 AND 1000.0)`
- `CONSTRAINT ck_health_protein_target CHECK (protein_target_g IS NULL OR protein_target_g BETWEEN 0.0 AND 1000.0)`
- `CONSTRAINT ck_health_fat_target CHECK (fat_target_g IS NULL OR fat_target_g BETWEEN 0.0 AND 1000.0)`
- `CONSTRAINT ck_health_goal_type CHECK (goal_type IN ('balanced', 'maintain', 'lose', 'gain'))`
- `CONSTRAINT ck_health_version CHECK (version >= 1)`

### `water_records` · M02

每次饮水事实；软删后不参与统计。

| 字段 | 精确SQL定义（类型 / 空值 / 默认 / 生成规则） |
| --- | --- |
| `id` | `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL` |
| `user_id` | `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL` |
| `amount_ml` | `INT NOT NULL` |
| `recorded_at` | `DATETIME(3) NOT NULL` |
| `business_date` | `DATE NOT NULL` |
| `timezone` | `VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Asia/Shanghai'` |
| `source` | `VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'manual'` |
| `deleted_at` | `DATETIME(3) NULL` |
| `created_at` | `DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)` |
| `updated_at` | `DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)` |

约束与索引：

- `PRIMARY KEY (id)`
- `KEY ix_water_user_day_live_time (user_id, business_date, deleted_at, recorded_at DESC, id DESC)`
- `CONSTRAINT ck_water_amount CHECK (amount_ml BETWEEN 1 AND 1000)`
- `CONSTRAINT ck_water_timezone CHECK (timezone = 'Asia/Shanghai')`
- `CONSTRAINT ck_water_source CHECK (source = 'manual')`
- `CONSTRAINT ck_water_business_date CHECK (business_date = DATE(DATE_ADD(recorded_at, INTERVAL 8 HOUR)))`

### `weight_records` · M02

每次称重测量；同一天可多次。

| 字段 | 精确SQL定义（类型 / 空值 / 默认 / 生成规则） |
| --- | --- |
| `id` | `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL` |
| `user_id` | `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL` |
| `weight_kg` | `DECIMAL(4,1) NOT NULL` |
| `recorded_at` | `DATETIME(3) NOT NULL` |
| `business_date` | `DATE NOT NULL` |
| `timezone` | `VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Asia/Shanghai'` |
| `source` | `VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'manual'` |
| `deleted_at` | `DATETIME(3) NULL` |
| `created_at` | `DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)` |
| `updated_at` | `DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)` |

约束与索引：

- `PRIMARY KEY (id)`
- `KEY ix_weight_user_day_live_time (user_id, business_date, deleted_at, recorded_at DESC, id DESC)`
- `CONSTRAINT ck_weight_value CHECK (weight_kg BETWEEN 20.0 AND 350.0)`
- `CONSTRAINT ck_weight_timezone CHECK (timezone = 'Asia/Shanghai')`
- `CONSTRAINT ck_weight_source CHECK (source = 'manual')`
- `CONSTRAINT ck_weight_business_date CHECK (business_date = DATE(DATE_ADD(recorded_at, INTERVAL 8 HOUR)))`

## 附录｜公共TypeScript接口

此文件提供共享数据形状和进程内端口，尚不是业务实现或完整OpenAPI文件。运行时仍须校验输入。

<!-- BEGIN_SHARED_TYPES -->
```typescript
/** QY-MYSQL-1.0.0 shared interface contract. No runtime/database implementation. */
export const CONTRACT_VERSION = 'QY-MYSQL-1.0.0' as const;
export const BUSINESS_TIMEZONE = 'Asia/Shanghai' as const;
export type UUID = string; // Runtime validation: canonical lowercase UUID v4.
export type ISODate = string; // YYYY-MM-DD, validated calendar date.
export type Instant = string; // ISO8601 with Z; milliseconds.
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type DbParam = string | number | boolean | null | Date | Uint8Array;
export type Platform = 'h5' | 'ios' | 'android';
export interface Meta { requestId: UUID; serverTime: Instant; timezone: typeof BUSINESS_TIMEZONE; }
export interface Envelope<T> { data: T; meta: Meta; }
export interface CursorPage<T> { items: T[]; nextCursor: string | null; }
export interface ApiError { error: { code: string; message: string; fields?: Record<string,string>; retryAfterSeconds?: number | null }; meta: Omit<Meta,'timezone'>; }
export interface CommandContext { userId: UUID; operationNow: Instant; businessDate: ISODate; requestId: UUID; platform: Platform; }
/** The same pinned mysql2 connection. No commit/rollback exposed to modules. */
export interface SqlTx {
  query<T extends object>(sql: string, values: readonly DbParam[]): Promise<T[]>;
  execute(sql: string, values: readonly DbParam[]): Promise<{ affectedRows: number }>;
}
export interface UnitOfWork {
  runForUser<T>(userId: UUID, run: (tx: SqlTx, ctx: CommandContext) => Promise<T>): Promise<T>;
  runForUsers<T>(actorUserId: UUID, referencedUserIds: readonly UUID[], run: (tx: SqlTx, ctx: CommandContext) => Promise<T>): Promise<T>;
  runSystem<T>(scope:'auth_bootstrap'|'idempotency_claim'|'outbox_claim'|'delivery_claim'|'provider_job', run:(tx:SqlTx,ctx:{operationNow:Instant;requestId:UUID})=>Promise<T>):Promise<T>;
  readSnapshot<T>(run: (tx: SqlTx) => Promise<T>): Promise<T>;
}
export interface UserAdministrationPort { disableInTransaction(tx:SqlTx,ctx:CommandContext,targetUserId:UUID):Promise<void>; }

export type AdminMediaPurpose = 'course_cover'|'course_video'|'activity_cover'|'reward_image';
export type MediaPurpose = 'meal_photo'|'avatar'|AdminMediaPurpose;
/** Trusted internal input; never pass HTTP body identity/access directly to this port. */
export type MediaAccessInput =
  | {assetId:UUID;purpose:'meal_photo'|'avatar';actorUserId:UUID;access:'owner'}
  | {assetId:UUID;purpose:AdminMediaPurpose;actorUserId:UUID;access:'admin_material'}
  | {assetId:UUID;purpose:'avatar'|AdminMediaPurpose;actorUserId:UUID|null;access:'public_display'};
export interface ReadyMedia { assetId:UUID;purpose:MediaPurpose;userId:UUID|null;contentType:string;sizeBytes:number; }
export interface MediaPort {
  assertReady(tx:SqlTx,input:MediaAccessInput):Promise<ReadyMedia>;
  createReadUrl(input:MediaAccessInput & {expiresInSeconds?:number}):Promise<{assetId:UUID;readUrl:string;readUrlExpiresAt:Instant}>;
}

export type GoalType = 'balanced' | 'maintain' | 'lose' | 'gain';
export interface HealthProfileInput {
  heightCm?: number | null; birthYear?: number | null; targetWeightKg: number;
  waterTargetMl: number; calorieTargetKcal: number; carbsTargetG?: number | null;
  proteinTargetG?: number | null; fatTargetG?: number | null; goalType: GoalType; version: number;
}
export interface HealthProfileDto {
  id: UUID; userId: UUID; heightCm: number | null; birthYear: number | null; targetWeightKg: number;
  waterTargetMl: number; calorieTargetKcal: number; carbsTargetG: number | null;
  proteinTargetG: number | null; fatTargetG: number | null; goalType: GoalType; version: number; updatedAt: Instant;
}
export interface WaterRecordDto { id: UUID; amountMl: number; recordedAt: Instant; businessDate: ISODate; source: 'manual'; }
export interface WeightRecordDto { id: UUID; weightKg: number; recordedAt: Instant; businessDate: ISODate; source: 'manual'; }
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type NutritionSource = 'catalog' | 'model' | 'user';
/** Write input never accepts id/confidence/provider/model/status/totals. */
export type FoodItemInput =
  | { nutritionSource:'catalog'; foodId:UUID; grams:number }
  | { nutritionSource:'user'; foodId?:UUID|null; name:string; grams:number; caloriesKcal:number; carbsG:number|null; proteinG:number|null; fatG:number|null }
  | { nutritionSource:'model'; candidateIndex:number }; // Only on creation with succeeded recognitionJobId; server loads candidate.
export interface FoodItemDto { id:UUID; foodId:UUID|null; name:string; grams:number; caloriesKcal:number; carbsG:number|null; proteinG:number|null; fatG:number|null; nutritionSource:NutritionSource; confidence:number|null; }
export interface FoodItemDraft { candidateIndex:number; foodId:UUID|null; name:string; grams:number; caloriesKcal:number; carbsG:number|null; proteinG:number|null; fatG:number|null; nutritionSource:'model'; confidence:number|null; }
export interface MealTotals { caloriesKcal:number; carbsG:number|null; proteinG:number|null; fatG:number|null; }
export interface MealDto { id:UUID; mealType:MealType; recordedAt:Instant; businessDate:ISODate; source:'manual'|'photo'; photoAssetId:UUID|null; photoUrl:string|null; items:FoodItemDto[]; totals:MealTotals; version:number; createdAt:Instant; updatedAt:Instant; }
export interface CreateMealInput { mealType:MealType; recordedAt?:Instant; source:'manual'|'photo'; photoAssetId?:UUID; recognitionJobId?:UUID; items:FoodItemInput[]; }
export interface UpdateMealInput { version:number; mealType?:MealType; recordedAt?:Instant; items?:Exclude<FoodItemInput,{nutritionSource:'model'}>[]; }
export type RecognitionStatus = 'queued'|'running'|'succeeded'|'failed'|'canceled';
export interface RecognitionJobDto { id:UUID; status:RecognitionStatus; items:FoodItemDraft[]; error:{code:string;message:string}|null; createdAt:Instant; completedAt:Instant|null; }

export interface CourseDto { id:UUID; title:string; category:'stretch'|'strength'|'cardio'; level:'beginner'|'intermediate'; description:string; coverUrl:string|null; videoUrl:string|null; estimatedDurationSeconds:number; estimatedCaloriesKcal:number; status:'draft'|'published'|'archived'; version:number; }
export type WorkoutStatus = 'active'|'paused'|'completed'|'abandoned';
export interface WorkoutSessionDto {
  id:UUID; courseId:UUID; status:WorkoutStatus; startedAt:Instant; endedAt:Instant|null;
  activeDurationSeconds:number; estimatedCaloriesKcal:number; businessDate:ISODate|null;
  durationSnapshotSeconds:number; rewardThresholdSeconds:number; rewardEligible:boolean; version:number;
}
export interface CurrentWorkoutDto { session:WorkoutSessionDto|null; serverNow:Instant; }
export interface TrainingReminderInput { enabled:boolean; localTime:string; timezone:typeof BUSINESS_TIMEZONE; weekdays:number[]; channels:('in_app'|'web_push'|'app_push')[]; skipIfCompleted:boolean; version:number; }
export interface TrainingReminderDto extends TrainingReminderInput { id:UUID; nextTriggerAt:Instant|null; deliveryCapability:{webPush:boolean;appPush:boolean}; }

export type TaskCode = 'daily_checkin'|'daily_water'|'daily_meal'|'course_workout';
export interface PointAccountDto { balance:number; lifetimeEarned:number; lifetimeSpent:number; version:number; }
export interface PointAwardDto { id:UUID; taskCode:TaskCode; points:number; businessDate:ISODate; scopeKey:string; }
export interface TaskDto { code:TaskCode; title:string; description:string; rewardPoints:number; progress:number; target:number; status:'pending'|'completed'; completedAt:Instant|null; action:{type:'navigate'|'checkin';path?:string}; }
export type AwardInput = { type:'checkin' } | { type:'water_recorded'|'meal_confirmed'|'workout_completed'; sourceId:UUID };
export interface PointsPort {
  ensureAccountInTransaction(tx:SqlTx,input:{userId:UUID}):Promise<PointAccountDto>;
  awardInTransaction(tx:SqlTx,ctx:CommandContext,input:AwardInput):Promise<{awards:PointAwardDto[];account:PointAccountDto}>;
}

export type Mood = 'happy'|'calm'|'tired'|'low';
export interface MoodRecordDto { id:UUID; date:ISODate; mood:Mood; note:string|null; updatedAt:Instant; }
export type MessageStatus = 'queued'|'generating'|'completed'|'failed'|'canceled';
export interface CompanionSessionDto { id:UUID; title:string; status:'active'|'archived'; createdAt:Instant; updatedAt:Instant; lastMessageAt:Instant|null; }
export interface MessageDto { id:UUID; sessionId:UUID; role:'user'|'assistant'; content:string; status:MessageStatus; replyToId:UUID|null; errorCode:string|null; createdAt:Instant; completedAt:Instant|null; }
export interface CreateMessageInput { content:string; clientMessageId:UUID; }
export interface CreateMessageDto { userMessage:MessageDto; assistantMessage:MessageDto; streamUrl:string; }

export interface RestaurantDto { id:UUID; provider:string; providerPlaceId:string; name:string; address:string; latitude:number; longitude:number; coordinateSystem:'wgs84'; distanceMeters:number|null; rating:number|null; ratingScaleMax:number|null; priceCents:number|null; currency:'CNY'; tags:string[]; coverUrl:string|null; nutritionVerified:boolean; estimatedCaloriesKcal:number|null; isFavorited:boolean; status:'available'|'unavailable'; sourceUpdatedAt:Instant; }
export interface SlotDto { id:UUID; activityId:UUID; startAt:Instant; endAt:Instant; timezone:typeof BUSINESS_TIMEZONE; capacity:number; bookedCount:number; remainingSeats:number; bookingOpenAt:Instant; bookingCloseAt:Instant; cancelBeforeAt:Instant; status:'open'|'canceled'|'completed'; version:number; }
export interface ActivitySnapshot { id:UUID; title:string; locationName:string; address:string; coordinateSystem:'wgs84'; latitude:number|null; longitude:number|null; }
export interface SlotSnapshot { id:UUID; activityId:UUID; startAt:Instant; endAt:Instant; timezone:typeof BUSINESS_TIMEZONE; bookingOpenAt:Instant; bookingCloseAt:Instant; cancelBeforeAt:Instant; }
export interface BookingDto { id:UUID; slotId:UUID; activityId:UUID; status:'confirmed'|'canceled'|'attended'|'no_show'; participantVisibility:'hidden'|'public'; bookedAt:Instant; canceledAt:Instant|null; activityTitle:string; slot:SlotDto; activitySnapshot:ActivitySnapshot; slotSnapshot:SlotSnapshot; version:number; }
export interface CommunityProfileInput { bio:string|null; discoverable:boolean; version:number; }
export interface CommunityProfileDto extends CommunityProfileInput { id:UUID; userId:UUID; updatedAt:Instant; }

export type OutboxEventType =
  | 'media.validate.requested.v1' | 'nutrition.recognition.requested.v1' | 'companion.reply.requested.v1'
  | 'training.reminder.due.v1' | 'activity.booking.confirmed.v1' | 'activity.booking.canceled.v1'
  | 'activity.slot.canceled.v1' | 'points.redemption.requested.v1' | 'points.redemption.finished.v1';
export interface OutboxPayloadMap {
  'media.validate.requested.v1':{assetId:UUID};
  'nutrition.recognition.requested.v1':{jobId:UUID;userId:UUID;assetId:UUID};
  'companion.reply.requested.v1':{assistantMessageId:UUID;sessionId:UUID;userId:UUID};
  'training.reminder.due.v1':{reminderId:UUID;userId:UUID;reminderVersion:number;scheduledAt:Instant};
  'activity.booking.confirmed.v1':{bookingId:UUID;bookingEventId:UUID;slotId:UUID;userId:UUID};
  'activity.booking.canceled.v1':{bookingId:UUID;bookingEventId:UUID;slotId:UUID;userId:UUID};
  'activity.slot.canceled.v1':{slotId:UUID;slotVersion:number;actorUserId:UUID};
  'points.redemption.requested.v1':{redemptionId:UUID;userId:UUID};
  'points.redemption.finished.v1':{redemptionId:UUID;userId:UUID;redemptionVersion:number;status:'fulfilled'|'refunded'};
}
export type OutboxInput = { [K in OutboxEventType]:{eventType:K;aggregateType:string;aggregateId:UUID;eventKey:string;schemaVersion:1;payload:OutboxPayloadMap[K]} }[OutboxEventType];
export interface OutboxPort { enqueueInTransaction(tx:SqlTx,input:OutboxInput):Promise<{id:UUID}>; }

export interface NutrientSum { knownG:number; complete:boolean; }
export interface NutritionDay { date:ISODate; hasMealRecord:boolean; intakeKcal:number; carbs:NutrientSum; protein:NutrientSum; fat:NutrientSum; }
export interface TrainingDay { date:ISODate; completedWorkouts:number; exerciseKcal:number; durationSeconds:number; }
export interface NutritionQueryPort {
  days(tx:SqlTx,userId:UUID,startDate:ISODate,endDate:ISODate):Promise<NutritionDay[]>;
  latestMeal(tx:SqlTx,userId:UUID,date:ISODate):Promise<MealDto|null>;
}
export interface TrainingQueryPort {
  days(tx:SqlTx,userId:UUID,startDate:ISODate,endDate:ISODate):Promise<TrainingDay[]>;
  recommendedCourse(tx:SqlTx,userId:UUID,date:ISODate):Promise<CourseDto|null>;
}
export interface PointsQueryPort {
  account(tx:SqlTx,userId:UUID):Promise<PointAccountDto>;
  tasks(tx:SqlTx,userId:UUID,date:ISODate):Promise<TaskDto[]>;
  consecutiveCheckinDays(tx:SqlTx,userId:UUID,asOfDate:ISODate):Promise<number>;
}
export interface CompanionQueryPort { moods(tx:SqlTx,userId:UUID,startDate:ISODate,endDate:ISODate):Promise<MoodRecordDto[]>; }
export interface ActivitiesQueryPort { activeBookingCount(tx:SqlTx,userId:UUID,at:Instant):Promise<number>; }
export interface HealthDay { date:ISODate; waterMl:number; hasWaterRecord:boolean; weightKg:number|null; }
export interface HealthQueryPort { profile(tx:SqlTx,userId:UUID):Promise<HealthProfileDto|null>; days(tx:SqlTx,userId:UUID,startDate:ISODate,endDate:ISODate):Promise<HealthDay[]>; }

export interface DashboardDto {
  date:ISODate; isDemo:false;
  water:{totalMl:number;targetMl:number|null;progress:number|null};
  weight:{latestKg:number|null;targetKg:number|null;previousKg:number|null;changeKg:number|null;bmi:number|null};
  energy:{intakeKcal:number;exerciseKcal:number;baseTargetKcal:number|null;effectiveTargetKcal:number|null;remainingKcal:number|null;exceededKcal:number|null};
  nutrients:{carbs:{consumedG:number;targetG:number|null;complete:boolean};protein:{consumedG:number;targetG:number|null;complete:boolean};fat:{consumedG:number;targetG:number|null;complete:boolean}};
  week:{date:ISODate;hasMealRecord:boolean;hasTrainingRecord:boolean}[];
  latestMeal:MealDto|null; recommendedWorkout:CourseDto|null; pointsBalance:number; dailyTasks:TaskDto[]; generatedAt:Instant;
}
export interface OverviewDto {
  range:7|30;startDate:ISODate;endDate:ISODate;generatedAt:Instant;
  summary:{avgIntakeKcal:number|null;avgWaterMl:number|null;completedWorkouts:number;totalExerciseKcal:number;latestWeightKg:number|null;moodRecordedDays:number;pointsBalance:number;activeBookings:number};
  series:{date:ISODate;intakeKcal:number;exerciseKcal:number;waterMl:number;weightKg:number|null;mood:Mood|null;completedWorkouts:number;hasMealRecord:boolean;hasWaterRecord:boolean}[];
  coverage:{mealDays:number;waterDays:number;weightDays:number;moodDays:number;rangeDays:number};
}

/** Query ports use the provided read-snapshot tx. Days methods return recorded rows only; M02 fills the date grid. */
export interface ContractMetadataDto { contractVersion:typeof CONTRACT_VERSION; schemaVersion:string; baselineSha256:string; timezone:typeof BUSINESS_TIMEZONE; }
export const NOTIFICATION_TYPES = ['training_reminder','booking_confirmed','booking_canceled','activity_canceled','redemption_result'] as const;
export const DEVELOPMENT_RULES = { daily_checkin:10, daily_water:5, daily_meal:10, course_workout:20, workoutThresholdRatio:0.8 } as const;
```
<!-- END_SHARED_TYPES -->

## 附录｜完整MySQL V001建表脚本

**仅初始化明确选中的空开发库；所有组使用同一份。不重复执行、不关闭外键。**

<!-- BEGIN_CANONICAL_SQL -->
```sql
-- QY-MYSQL-1.0.0 | V001 baseline | 2026-10-19
-- Target: MySQL 8.4 / InnoDB. Run once in a NEW, EMPTY, explicitly selected database.
-- This file does not CREATE DATABASE, DROP objects, seed user data, or disable FK checks.
-- Migrations after this baseline are sequenced centrally by M01; never edit a deployed V001.
-- All UUIDs are generated by the application as lowercase UUID v4 strings.
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET SESSION time_zone = '+00:00';
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,ONLY_FULL_GROUP_BY,NO_ZERO_DATE,NO_ZERO_IN_DATE';

-- @table users owner=M01
CREATE TABLE users (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  phone_ciphertext TEXT NOT NULL,
  phone_lookup_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nickname VARCHAR(30) NOT NULL,
  avatar_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  timezone VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Asia/Shanghai',
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_users_phone_hash UNIQUE (phone_lookup_hash),
  KEY ix_users_avatar (avatar_asset_id),
  CONSTRAINT ck_users_phone_cipher CHECK (CHAR_LENGTH(phone_ciphertext) > 0),
  CONSTRAINT ck_users_phone_hash CHECK (REGEXP_LIKE(phone_lookup_hash, '^[0-9a-f]{64}$', 'c')),
  CONSTRAINT ck_users_nickname CHECK (CHAR_LENGTH(TRIM(nickname)) BETWEEN 1 AND 30),
  CONSTRAINT ck_users_timezone CHECK (timezone = 'Asia/Shanghai'),
  CONSTRAINT ck_users_status CHECK (status IN ('active', 'disabled', 'deleted')),
  CONSTRAINT ck_users_deletion CHECK (
    (status = 'deleted' AND deleted_at IS NOT NULL) OR
    (status IN ('active', 'disabled') AND deleted_at IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table auth_challenges owner=M01
CREATE TABLE auth_challenges (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  phone_lookup_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  phone_ciphertext TEXT NOT NULL,
  purpose VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'login',
  code_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  attempts SMALLINT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_auth_phone_created (phone_lookup_hash, created_at DESC, id DESC),
  KEY ix_auth_expires (expires_at),
  CONSTRAINT ck_auth_phone_hash CHECK (REGEXP_LIKE(phone_lookup_hash, '^[0-9a-f]{64}$', 'c')),
  CONSTRAINT ck_auth_phone_cipher CHECK (CHAR_LENGTH(phone_ciphertext) > 0),
  CONSTRAINT ck_auth_purpose CHECK (purpose = 'login'),
  CONSTRAINT ck_auth_code_hash CHECK (CHAR_LENGTH(code_hash) BETWEEN 1 AND 255),
  CONSTRAINT ck_auth_attempts CHECK (attempts BETWEEN 0 AND 5),
  CONSTRAINT ck_auth_expires CHECK (expires_at > created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table user_sessions owner=M01
CREATE TABLE user_sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  platform VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  refresh_family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_sessions_refresh_family UNIQUE (refresh_family_id),
  CONSTRAINT uq_sessions_id_user UNIQUE (id, user_id),
  KEY ix_sessions_user_revoked (user_id, revoked_at),
  KEY ix_sessions_expires (expires_at),
  CONSTRAINT ck_sessions_platform CHECK (platform IN ('h5', 'ios', 'android')),
  CONSTRAINT ck_sessions_expires CHECK (expires_at > created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table refresh_tokens owner=M01
CREATE TABLE refresh_tokens (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  replaced_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_refresh_token_hash UNIQUE (token_hash),
  CONSTRAINT uq_refresh_id_session UNIQUE (id, session_id),
  CONSTRAINT uq_refresh_replaced_by UNIQUE (replaced_by),
  KEY ix_refresh_session_expiry (session_id, expires_at),
  KEY ix_refresh_next_session (replaced_by, session_id),
  CONSTRAINT ck_refresh_token_hash CHECK (REGEXP_LIKE(token_hash, '^[0-9a-f]{64}$', 'c')),
  CONSTRAINT ck_refresh_expires CHECK (expires_at > created_at),
  CONSTRAINT ck_refresh_replacement CHECK (
    replaced_by IS NULL OR (replaced_by <> id AND consumed_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table media_assets owner=M01
CREATE TABLE media_assets (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  purpose VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bucket VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  safe_object_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NULL,
  content_type VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_media_bucket_object UNIQUE (bucket, object_key),
  CONSTRAINT uq_media_id_user UNIQUE (id, user_id),
  KEY ix_media_user_created (user_id, created_at DESC, id DESC),
  KEY ix_media_status_expiry (status, expires_at, id),
  CONSTRAINT ck_media_purpose CHECK (purpose IN (
    'meal_photo', 'avatar', 'course_cover', 'course_video', 'activity_cover', 'reward_image'
  )),
  CONSTRAINT ck_media_private_owner CHECK (purpose NOT IN ('meal_photo', 'avatar') OR user_id IS NOT NULL),
  CONSTRAINT ck_media_bucket CHECK (REGEXP_LIKE(bucket, '^[A-Za-z0-9._-]{1,100}$', 'c')),
  CONSTRAINT ck_media_object_key CHECK (REGEXP_LIKE(object_key, '^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$', 'c')),
  CONSTRAINT ck_media_safe_key CHECK (
    safe_object_key IS NULL OR REGEXP_LIKE(safe_object_key, '^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$', 'c')
  ),
  CONSTRAINT ck_media_content_type CHECK (
    (purpose = 'course_video' AND content_type IN ('video/mp4', 'video/webm')) OR
    (purpose <> 'course_video' AND content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic'))
  ),
  CONSTRAINT ck_media_size CHECK (size_bytes > 0),
  CONSTRAINT ck_media_checksum CHECK (REGEXP_LIKE(checksum_sha256, '^[0-9a-f]{64}$', 'c')),
  CONSTRAINT ck_media_status CHECK (status IN ('pending', 'validating', 'ready', 'rejected')),
  CONSTRAINT ck_media_ready_key CHECK (status <> 'ready' OR safe_object_key IS NOT NULL),
  CONSTRAINT ck_media_error_code CHECK (
    error_code IS NULL OR REGEXP_LIKE(error_code, '^[A-Za-z0-9_.:-]{1,64}$', 'c')
  ),
  CONSTRAINT ck_media_rejected_error CHECK (status <> 'rejected' OR error_code IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table notification_subscriptions owner=M01
CREATE TABLE notification_subscriptions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
  endpoint_ciphertext TEXT NULL,
  endpoint_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  keys_ciphertext TEXT NULL,
  token_ciphertext TEXT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_subscriptions_endpoint UNIQUE (endpoint_hash),
  CONSTRAINT uq_subscriptions_token UNIQUE (token_hash),
  CONSTRAINT uq_subscriptions_id_user UNIQUE (id, user_id),
  KEY ix_subscriptions_user_device (user_id, device_id, enabled),
  CONSTRAINT ck_subscriptions_channel CHECK (channel IN ('web_push', 'app_push')),
  CONSTRAINT ck_subscriptions_provider CHECK (provider IS NULL OR provider IN ('apns', 'fcm', 'vendor')),
  CONSTRAINT ck_subscriptions_endpoint_hash CHECK (
    endpoint_hash IS NULL OR REGEXP_LIKE(endpoint_hash, '^[0-9a-f]{64}$', 'c')
  ),
  CONSTRAINT ck_subscriptions_token_hash CHECK (
    token_hash IS NULL OR REGEXP_LIKE(token_hash, '^[0-9a-f]{64}$', 'c')
  ),
  CONSTRAINT ck_subscriptions_enabled CHECK (enabled IN (0, 1)),
  CONSTRAINT ck_subscriptions_fields CHECK (
    (channel = 'web_push' AND provider IS NULL AND
      token_ciphertext IS NULL AND token_hash IS NULL AND (
        (endpoint_ciphertext IS NOT NULL AND endpoint_hash IS NOT NULL AND keys_ciphertext IS NOT NULL) OR
        (enabled = 0 AND endpoint_ciphertext IS NULL AND endpoint_hash IS NULL AND keys_ciphertext IS NULL)
      )) OR
    (channel = 'app_push' AND provider IS NOT NULL AND
      endpoint_ciphertext IS NULL AND endpoint_hash IS NULL AND keys_ciphertext IS NULL AND (
        (token_ciphertext IS NOT NULL AND token_hash IS NOT NULL) OR
        (enabled = 0 AND token_ciphertext IS NULL AND token_hash IS NULL)
      ))
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table notifications owner=M01
CREATE TABLE notifications (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(100) NOT NULL,
  body VARCHAR(500) NOT NULL,
  action_path VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_key VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_notifications_user_event UNIQUE (user_id, event_key),
  CONSTRAINT uq_notifications_id_user UNIQUE (id, user_id),
  KEY ix_notifications_user_created (user_id, created_at DESC, id DESC),
  KEY ix_notifications_user_unread (user_id, read_at, created_at DESC, id DESC),
  CONSTRAINT ck_notifications_type CHECK (type IN (
    'training_reminder', 'booking_confirmed', 'booking_canceled', 'activity_canceled', 'redemption_result'
  )),
  CONSTRAINT ck_notifications_title CHECK (CHAR_LENGTH(TRIM(title)) BETWEEN 1 AND 100),
  CONSTRAINT ck_notifications_body CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 500),
  CONSTRAINT ck_notifications_action CHECK (LEFT(action_path, 1) = '/' AND LEFT(action_path, 2) <> '//'),
  CONSTRAINT ck_notifications_event_key CHECK (REGEXP_LIKE(event_key, '^[A-Za-z0-9_.:@/-]{1,200}$', 'c'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table notification_deliveries owner=M01
CREATE TABLE notification_deliveries (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  notification_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subscription_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'queued',
  provider_message_id VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  sent_at DATETIME(3) NULL,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_by VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  locked_until DATETIME(3) NULL,
  lease_version BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_deliveries_notice_device UNIQUE (notification_id, subscription_id),
  KEY ix_deliveries_notice_user (notification_id, user_id),
  KEY ix_deliveries_sub_user (subscription_id, user_id),
  KEY ix_deliveries_due (status, next_attempt_at, id),
  KEY ix_deliveries_lease (locked_until, id),
  CONSTRAINT ck_deliveries_status CHECK (status IN ('queued', 'sent', 'failed', 'invalid_subscription')),
  CONSTRAINT ck_deliveries_provider_id CHECK (
    provider_message_id IS NULL OR CHAR_LENGTH(provider_message_id) BETWEEN 1 AND 200
  ),
  CONSTRAINT ck_deliveries_attempts CHECK (attempts >= 0),
  CONSTRAINT ck_deliveries_error_code CHECK (
    last_error_code IS NULL OR REGEXP_LIKE(last_error_code, '^[A-Za-z0-9_.:-]{1,80}$', 'c')
  ),
  CONSTRAINT ck_deliveries_sent CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CONSTRAINT ck_deliveries_lock_owner CHECK (
    locked_by IS NULL OR REGEXP_LIKE(locked_by, '^[A-Za-z0-9_.:-]{1,64}$', 'c')
  ),
  CONSTRAINT ck_deliveries_lease_pair CHECK (
    (locked_by IS NULL AND locked_until IS NULL) OR (locked_by IS NOT NULL AND locked_until IS NOT NULL)
  ),
  CONSTRAINT ck_deliveries_lease_state CHECK (locked_by IS NULL OR status = 'queued'),
  CONSTRAINT ck_deliveries_lease_version CHECK (lease_version >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table idempotency_requests owner=M01
CREATE TABLE idempotency_requests (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  principal_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  method VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_path VARCHAR(250) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  body_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'processing',
  response_status SMALLINT NULL,
  response_body JSON NULL,
  expires_at DATETIME(3) NOT NULL,
  locked_by VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  locked_until DATETIME(3) NULL,
  lease_version BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_idempotency_scope UNIQUE (principal_key, method, request_path, idempotency_key),
  KEY ix_idempotency_expiry (expires_at),
  KEY ix_idempotency_lease (status, locked_until, id),
  CONSTRAINT ck_idempotency_principal CHECK (REGEXP_LIKE(principal_key, '^[A-Za-z0-9_.:-]{1,128}$', 'c')),
  CONSTRAINT ck_idempotency_method CHECK (method IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  CONSTRAINT ck_idempotency_path CHECK (LEFT(request_path, 1) = '/' AND LEFT(request_path, 2) <> '//'),
  CONSTRAINT ck_idempotency_body_hash CHECK (REGEXP_LIKE(body_hash, '^[0-9a-f]{64}$', 'c')),
  CONSTRAINT ck_idempotency_status CHECK (status IN ('processing', 'completed', 'failed')),
  CONSTRAINT ck_idempotency_http_status CHECK (response_status IS NULL OR response_status BETWEEN 200 AND 599),
  CONSTRAINT ck_idempotency_expiry CHECK (expires_at > created_at),
  CONSTRAINT ck_idempotency_lock_owner CHECK (
    locked_by IS NULL OR REGEXP_LIKE(locked_by, '^[A-Za-z0-9_.:-]{1,64}$', 'c')
  ),
  CONSTRAINT ck_idempotency_lease_version CHECK (lease_version >= 1),
  CONSTRAINT ck_idempotency_state_fields CHECK (
    (status = 'processing' AND locked_by IS NOT NULL AND locked_until IS NOT NULL AND
      response_status IS NULL AND response_body IS NULL) OR
    (status = 'completed' AND locked_by IS NULL AND locked_until IS NULL AND response_status IS NOT NULL AND response_status BETWEEN 200 AND 299) OR
    (status = 'failed' AND locked_by IS NULL AND locked_until IS NULL AND response_status IS NOT NULL AND response_status BETWEEN 400 AND 599)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table outbox_events owner=M01
CREATE TABLE outbox_events (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  aggregate_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  aggregate_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_key VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  payload JSON NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_at DATETIME(3) NULL,
  locked_by VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  locked_until DATETIME(3) NULL,
  lease_version BIGINT NOT NULL DEFAULT 0,
  last_error_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_outbox_event_key UNIQUE (event_key),
  KEY ix_outbox_due (status, next_attempt_at, id),
  KEY ix_outbox_lease (status, locked_until, id),
  KEY ix_outbox_aggregate (aggregate_type, aggregate_id, created_at, id),
  CONSTRAINT ck_outbox_event_type CHECK (REGEXP_LIKE(event_type, '^[a-z][a-z0-9_.-]{1,79}$', 'c')),
  CONSTRAINT ck_outbox_aggregate_type CHECK (REGEXP_LIKE(aggregate_type, '^[a-z][a-z0-9_]{0,39}$', 'c')),
  CONSTRAINT ck_outbox_event_key CHECK (REGEXP_LIKE(event_key, '^[A-Za-z0-9_.:@/-]{1,200}$', 'c')),
  CONSTRAINT ck_outbox_schema_version CHECK (schema_version >= 1),
  CONSTRAINT ck_outbox_payload CHECK (JSON_TYPE(payload) = 'OBJECT'),
  CONSTRAINT ck_outbox_status CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  CONSTRAINT ck_outbox_attempts CHECK (attempts >= 0),
  CONSTRAINT ck_outbox_lock_owner CHECK (
    locked_by IS NULL OR REGEXP_LIKE(locked_by, '^[A-Za-z0-9_.:-]{1,64}$', 'c')
  ),
  CONSTRAINT ck_outbox_lease_version CHECK (lease_version >= 0),
  CONSTRAINT ck_outbox_error_code CHECK (
    last_error_code IS NULL OR REGEXP_LIKE(last_error_code, '^[A-Za-z0-9_.:-]{1,80}$', 'c')
  ),
  CONSTRAINT ck_outbox_state_fields CHECK (
    (status = 'pending' AND locked_by IS NULL AND locked_until IS NULL AND published_at IS NULL) OR
    (status = 'processing' AND locked_by IS NOT NULL AND locked_until IS NOT NULL AND published_at IS NULL) OR
    (status = 'published' AND locked_by IS NULL AND locked_until IS NULL AND published_at IS NOT NULL) OR
    (status = 'failed' AND locked_by IS NULL AND locked_until IS NULL AND published_at IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table user_roles owner=M01
CREATE TABLE user_roles (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_roles_user_role UNIQUE (user_id, role),
  CONSTRAINT ck_roles_role CHECK (role IN ('user', 'admin'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table audit_logs owner=M01
CREATE TABLE audit_logs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  action VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  change_summary JSON NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_audit_resource_time (resource_type, resource_id, occurred_at, id),
  KEY ix_audit_actor_time (actor_user_id, occurred_at, id),
  KEY ix_audit_request (request_id),
  CONSTRAINT ck_audit_action CHECK (REGEXP_LIKE(action, '^[A-Za-z0-9_.:-]{1,100}$', 'c')),
  CONSTRAINT ck_audit_resource_type CHECK (REGEXP_LIKE(resource_type, '^[a-z][a-z0-9_]{0,39}$', 'c')),
  CONSTRAINT ck_audit_summary CHECK (JSON_TYPE(change_summary) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table health_profiles owner=M02
CREATE TABLE health_profiles (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  height_cm DECIMAL(4,1) NULL,
  birth_year SMALLINT NULL,
  target_weight_kg DECIMAL(4,1) NOT NULL,
  water_target_ml INT NOT NULL,
  calorie_target_kcal DECIMAL(6,1) NOT NULL,
  carbs_target_g DECIMAL(5,1) NULL,
  protein_target_g DECIMAL(5,1) NULL,
  fat_target_g DECIMAL(5,1) NULL,
  goal_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_health_profiles_user UNIQUE (user_id),
  CONSTRAINT ck_health_height CHECK (height_cm IS NULL OR height_cm BETWEEN 50.0 AND 250.0),
  CONSTRAINT ck_health_birth_year CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 9999),
  CONSTRAINT ck_health_target_weight CHECK (target_weight_kg BETWEEN 20.0 AND 350.0),
  CONSTRAINT ck_health_water_target CHECK (water_target_ml BETWEEN 500 AND 6000),
  CONSTRAINT ck_health_calorie_target CHECK (calorie_target_kcal BETWEEN 800.0 AND 5000.0),
  CONSTRAINT ck_health_carbs_target CHECK (carbs_target_g IS NULL OR carbs_target_g BETWEEN 0.0 AND 1000.0),
  CONSTRAINT ck_health_protein_target CHECK (protein_target_g IS NULL OR protein_target_g BETWEEN 0.0 AND 1000.0),
  CONSTRAINT ck_health_fat_target CHECK (fat_target_g IS NULL OR fat_target_g BETWEEN 0.0 AND 1000.0),
  CONSTRAINT ck_health_goal_type CHECK (goal_type IN ('balanced', 'maintain', 'lose', 'gain')),
  CONSTRAINT ck_health_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table water_records owner=M02
CREATE TABLE water_records (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_ml INT NOT NULL,
  recorded_at DATETIME(3) NOT NULL,
  business_date DATE NOT NULL,
  timezone VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Asia/Shanghai',
  source VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'manual',
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_water_user_day_live_time (user_id, business_date, deleted_at, recorded_at DESC, id DESC),
  CONSTRAINT ck_water_amount CHECK (amount_ml BETWEEN 1 AND 1000),
  CONSTRAINT ck_water_timezone CHECK (timezone = 'Asia/Shanghai'),
  CONSTRAINT ck_water_source CHECK (source = 'manual'),
  CONSTRAINT ck_water_business_date CHECK (business_date = DATE(DATE_ADD(recorded_at, INTERVAL 8 HOUR)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table weight_records owner=M02
CREATE TABLE weight_records (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  weight_kg DECIMAL(4,1) NOT NULL,
  recorded_at DATETIME(3) NOT NULL,
  business_date DATE NOT NULL,
  timezone VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Asia/Shanghai',
  source VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'manual',
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_weight_user_day_live_time (user_id, business_date, deleted_at, recorded_at DESC, id DESC),
  CONSTRAINT ck_weight_value CHECK (weight_kg BETWEEN 20.0 AND 350.0),
  CONSTRAINT ck_weight_timezone CHECK (timezone = 'Asia/Shanghai'),
  CONSTRAINT ck_weight_source CHECK (source = 'manual'),
  CONSTRAINT ck_weight_business_date CHECK (business_date = DATE(DATE_ADD(recorded_at, INTERVAL 8 HOUR)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table foods owner=M03
CREATE TABLE foods (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  calories_per_100g DECIMAL(6,1) NOT NULL,
  carbs_per_100g DECIMAL(5,1) NULL,
  protein_per_100g DECIMAL(5,1) NULL,
  fat_per_100g DECIMAL(5,1) NULL,
  source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'published',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_foods_status_name (status, name, id),
  CONSTRAINT ck_foods_calories CHECK (calories_per_100g > 0 AND calories_per_100g <= 5000),
  CONSTRAINT ck_foods_carbs CHECK (carbs_per_100g IS NULL OR carbs_per_100g BETWEEN 0 AND 100),
  CONSTRAINT ck_foods_protein CHECK (protein_per_100g IS NULL OR protein_per_100g BETWEEN 0 AND 100),
  CONSTRAINT ck_foods_fat CHECK (fat_per_100g IS NULL OR fat_per_100g BETWEEN 0 AND 100),
  CONSTRAINT ck_foods_status CHECK (status IN ('draft','published','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table recognition_jobs owner=M03
CREATE TABLE recognition_jobs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  meal_type_hint VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'queued',
  result JSON NULL,
  provider VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  model VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  run_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_until DATETIME(3) NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_recognition_id_user (id, user_id),
  UNIQUE KEY uq_recognition_id_user_asset (id, user_id, asset_id),
  KEY ix_recognition_user_created (user_id, created_at DESC, id DESC),
  KEY ix_recognition_asset_owner (asset_id, user_id),
  KEY ix_recognition_status_lease (status, lease_until, id),
  CONSTRAINT ck_recognition_status CHECK (status IN ('queued','running','succeeded','failed','canceled')),
  CONSTRAINT ck_recognition_meal_hint CHECK (meal_type_hint IS NULL OR meal_type_hint IN ('breakfast','lunch','dinner','snack')),
  CONSTRAINT ck_recognition_result CHECK (result IS NULL OR JSON_TYPE(result) = 'OBJECT'),
  CONSTRAINT ck_recognition_result_state CHECK (status = 'succeeded' OR result IS NULL),
  CONSTRAINT ck_recognition_success CHECK (status <> 'succeeded' OR (result IS NOT NULL AND completed_at IS NOT NULL)),
  CONSTRAINT ck_recognition_terminal CHECK ((status IN ('queued','running') AND completed_at IS NULL) OR (status IN ('succeeded','failed','canceled') AND completed_at IS NOT NULL)),
  CONSTRAINT ck_recognition_claim CHECK ((status = 'queued' AND started_at IS NULL AND run_token IS NULL AND lease_until IS NULL AND attempts = 0) OR (status = 'running' AND started_at IS NOT NULL AND run_token IS NOT NULL AND lease_until IS NOT NULL AND attempts >= 1) OR (status IN ('succeeded','failed','canceled') AND lease_until IS NULL)),
  CONSTRAINT ck_recognition_success_claim CHECK (status <> 'succeeded' OR (started_at IS NOT NULL AND run_token IS NOT NULL AND attempts >= 1)),
  CONSTRAINT ck_recognition_failure_code CHECK (status <> 'failed' OR error_code IS NOT NULL),
  CONSTRAINT ck_recognition_time CHECK (started_at IS NULL OR completed_at IS NULL OR completed_at >= started_at),
  CONSTRAINT ck_recognition_attempts CHECK (attempts >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table meals owner=M03
CREATE TABLE meals (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  meal_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recorded_at DATETIME(3) NOT NULL,
  business_date DATE NOT NULL,
  timezone VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Asia/Shanghai',
  source VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  photo_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  recognition_job_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version INT NOT NULL DEFAULT 1,
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_meals_recognition (recognition_job_id),
  KEY ix_meals_user_date_live (user_id, business_date, deleted_at, recorded_at DESC, id DESC),
  KEY ix_meals_photo_owner (photo_asset_id, user_id),
  KEY ix_meals_job_owner_asset (recognition_job_id, user_id, photo_asset_id),
  CONSTRAINT ck_meals_type CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  CONSTRAINT ck_meals_timezone CHECK (timezone = 'Asia/Shanghai'),
  CONSTRAINT ck_meals_business_date CHECK (business_date = DATE(DATE_ADD(recorded_at, INTERVAL 8 HOUR))),
  CONSTRAINT ck_meals_source CHECK (source IN ('manual','photo')),
  CONSTRAINT ck_meals_photo CHECK (source <> 'photo' OR photo_asset_id IS NOT NULL),
  CONSTRAINT ck_meals_job_photo CHECK (recognition_job_id IS NULL OR (source = 'photo' AND photo_asset_id IS NOT NULL)),
  CONSTRAINT ck_meals_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table meal_items owner=M03
CREATE TABLE meal_items (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  meal_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  food_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  name VARCHAR(100) NOT NULL,
  grams DECIMAL(7,1) NOT NULL,
  calories_kcal DECIMAL(7,1) NOT NULL,
  carbs_g DECIMAL(5,1) NULL,
  protein_g DECIMAL(5,1) NULL,
  fat_g DECIMAL(5,1) NULL,
  nutrition_source VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  confidence DECIMAL(4,3) NULL,
  sort_order SMALLINT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_meal_items_order (meal_id, sort_order),
  KEY ix_meal_items_food (food_id),
  CONSTRAINT ck_meal_items_grams CHECK (grams > 0 AND grams <= 5000),
  CONSTRAINT ck_meal_items_calories CHECK (calories_kcal > 0 AND calories_kcal <= 5000),
  CONSTRAINT ck_meal_items_carbs CHECK (carbs_g IS NULL OR carbs_g BETWEEN 0 AND 1000),
  CONSTRAINT ck_meal_items_protein CHECK (protein_g IS NULL OR protein_g BETWEEN 0 AND 1000),
  CONSTRAINT ck_meal_items_fat CHECK (fat_g IS NULL OR fat_g BETWEEN 0 AND 1000),
  CONSTRAINT ck_meal_items_source CHECK (nutrition_source IN ('catalog','model','user')),
  CONSTRAINT ck_meal_items_catalog CHECK (nutrition_source <> 'catalog' OR food_id IS NOT NULL),
  CONSTRAINT ck_meal_items_confidence CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  CONSTRAINT ck_meal_items_order CHECK (sort_order BETWEEN 0 AND 29)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table restaurants owner=M03
CREATE TABLE restaurants (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_place_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(150) NOT NULL,
  address TEXT NOT NULL,
  latitude DECIMAL(9,6) NOT NULL,
  longitude DECIMAL(9,6) NOT NULL,
  coordinate_system VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'wgs84',
  rating DECIMAL(4,2) NULL,
  rating_scale_max DECIMAL(4,2) NULL,
  price_cents INT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CNY',
  tags JSON NOT NULL,
  cover_url TEXT NULL,
  nutrition_verified BOOLEAN NOT NULL DEFAULT FALSE,
  estimated_calories_kcal DECIMAL(7,1) NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'available',
  source_updated_at DATETIME(3) NOT NULL,
  cache_expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_restaurants_provider_place (provider, provider_place_id),
  KEY ix_restaurants_status (status, id),
  CONSTRAINT ck_restaurants_latitude CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT ck_restaurants_longitude CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT ck_restaurants_coordinates CHECK (coordinate_system = 'wgs84'),
  CONSTRAINT ck_restaurants_rating CHECK ((rating IS NULL AND rating_scale_max IS NULL) OR (rating IS NOT NULL AND rating_scale_max IS NOT NULL AND rating >= 0 AND rating_scale_max > 0 AND rating <= rating_scale_max)),
  CONSTRAINT ck_restaurants_price CHECK (price_cents IS NULL OR price_cents >= 0),
  CONSTRAINT ck_restaurants_currency CHECK (currency = 'CNY'),
  CONSTRAINT ck_restaurants_tags CHECK (JSON_TYPE(tags) = 'ARRAY'),
  CONSTRAINT ck_restaurants_nutrition_flag CHECK (nutrition_verified IN (0,1)),
  CONSTRAINT ck_restaurants_calories CHECK (estimated_calories_kcal IS NULL OR estimated_calories_kcal >= 0),
  CONSTRAINT ck_restaurants_status CHECK (status IN ('available','unavailable'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table restaurant_favorites owner=M03
CREATE TABLE restaurant_favorites (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  restaurant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_favorites_user_restaurant (user_id, restaurant_id),
  KEY ix_favorites_user_created (user_id, created_at DESC, id DESC),
  KEY ix_favorites_restaurant (restaurant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table training_courses owner=M04
CREATE TABLE training_courses (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(100) NOT NULL,
    category VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    level VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    description TEXT NOT NULL,
    cover_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    video_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    estimated_duration_seconds INT NOT NULL,
    estimated_calories_kcal DECIMAL(7,1) NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft',
    version INT NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY ix_training_courses_catalog (status, category, level, id),
    KEY ix_training_courses_cover (cover_asset_id),
    KEY ix_training_courses_video (video_asset_id),
    CONSTRAINT ck_training_courses_title CHECK (CHAR_LENGTH(TRIM(title)) BETWEEN 1 AND 100),
    CONSTRAINT ck_training_courses_category CHECK (category IN ('stretch', 'strength', 'cardio')),
    CONSTRAINT ck_training_courses_level CHECK (level IN ('beginner', 'intermediate')),
    CONSTRAINT ck_training_courses_duration CHECK (estimated_duration_seconds BETWEEN 60 AND 14400),
    CONSTRAINT ck_training_courses_calories CHECK (estimated_calories_kcal >= 0),
    CONSTRAINT ck_training_courses_status CHECK (status IN ('draft', 'published', 'archived')),
    CONSTRAINT ck_training_courses_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table training_plan_templates owner=M04
CREATE TABLE training_plan_templates (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY ix_training_plan_templates_status (status, id),
    CONSTRAINT ck_training_plan_templates_title CHECK (CHAR_LENGTH(TRIM(title)) BETWEEN 1 AND 100),
    CONSTRAINT ck_training_plan_templates_status CHECK (status IN ('draft', 'published', 'archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table training_template_items owner=M04
CREATE TABLE training_template_items (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    template_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    day_offset SMALLINT NOT NULL,
    course_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    rest_day BOOLEAN NOT NULL,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_training_template_items_order (template_id, day_offset, sort_order),
    KEY ix_training_template_items_course (course_id),
    CONSTRAINT ck_training_template_items_day CHECK (day_offset BETWEEN 0 AND 27),
    CONSTRAINT ck_training_template_items_rest_bool CHECK (rest_day IN (0, 1)),
    CONSTRAINT ck_training_template_items_order CHECK (sort_order >= 0),
    CONSTRAINT ck_training_template_items_rest_course CHECK (
        (rest_day = 1 AND course_id IS NULL)
        OR (rest_day = 0 AND course_id IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table training_plans owner=M04
CREATE TABLE training_plans (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    template_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    title VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
    active_user_guard CHAR(36) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN user_id ELSE NULL END) STORED,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_training_plans_active_user (active_user_guard),
    KEY ix_training_plans_user_dates (user_id, start_date, end_date, id),
    KEY ix_training_plans_template (template_id),
    CONSTRAINT ck_training_plans_title CHECK (CHAR_LENGTH(TRIM(title)) BETWEEN 1 AND 100),
    CONSTRAINT ck_training_plans_dates CHECK (end_date >= start_date),
    CONSTRAINT ck_training_plans_status CHECK (status IN ('active', 'archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table training_plan_items owner=M04
CREATE TABLE training_plan_items (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    scheduled_date DATE NOT NULL,
    course_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    rest_day BOOLEAN NOT NULL,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_training_plan_items_order (plan_id, scheduled_date, sort_order),
    KEY ix_training_plan_items_course (course_id),
    CONSTRAINT ck_training_plan_items_rest_bool CHECK (rest_day IN (0, 1)),
    CONSTRAINT ck_training_plan_items_order CHECK (sort_order >= 0),
    CONSTRAINT ck_training_plan_items_rest_course CHECK (
        (rest_day = 1 AND course_id IS NULL)
        OR (rest_day = 0 AND course_id IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table workout_sessions owner=M04
CREATE TABLE workout_sessions (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    course_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
    started_at DATETIME(3) NOT NULL,
    active_since DATETIME(3) NULL,
    accumulated_seconds INT NOT NULL DEFAULT 0,
    ended_at DATETIME(3) NULL,
    business_date DATE NULL,
    duration_snapshot_seconds INT NOT NULL,
    calories_snapshot_kcal DECIMAL(7,1) NOT NULL,
    reward_threshold_seconds INT NOT NULL,
    active_duration_seconds INT NOT NULL DEFAULT 0,
    estimated_calories_kcal DECIMAL(7,1) NOT NULL DEFAULT 0,
    reward_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    version INT NOT NULL DEFAULT 1,
    open_user_guard CHAR(36) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (CASE WHEN status IN ('active', 'paused') THEN user_id ELSE NULL END) STORED,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_workout_sessions_open_user (open_user_guard),
    KEY ix_workout_sessions_user_date (user_id, business_date, status, id),
    KEY ix_workout_sessions_course (course_id),
    CONSTRAINT ck_workout_sessions_status CHECK (status IN ('active', 'paused', 'completed', 'abandoned')),
    CONSTRAINT ck_workout_sessions_accumulated CHECK (accumulated_seconds >= 0),
    CONSTRAINT ck_workout_sessions_active_duration CHECK (active_duration_seconds >= 0),
    CONSTRAINT ck_workout_sessions_settled_duration CHECK (active_duration_seconds = accumulated_seconds),
    CONSTRAINT ck_workout_sessions_duration_snapshot CHECK (duration_snapshot_seconds BETWEEN 60 AND 14400),
    CONSTRAINT ck_workout_sessions_calories_snapshot CHECK (calories_snapshot_kcal >= 0),
    CONSTRAINT ck_workout_sessions_reward_threshold CHECK (
        reward_threshold_seconds BETWEEN 1 AND duration_snapshot_seconds
    ),
    CONSTRAINT ck_workout_sessions_estimated_calories CHECK (
        estimated_calories_kcal >= 0 AND estimated_calories_kcal <= calories_snapshot_kcal
    ),
    CONSTRAINT ck_workout_sessions_reward_bool CHECK (reward_eligible IN (0, 1)),
    CONSTRAINT ck_workout_sessions_version CHECK (version >= 1),
    CONSTRAINT ck_workout_sessions_active_time CHECK (active_since IS NULL OR active_since >= started_at),
    CONSTRAINT ck_workout_sessions_end_time CHECK (ended_at IS NULL OR ended_at >= started_at),
    CONSTRAINT ck_workout_sessions_terminal_duration CHECK (
        ended_at IS NULL OR active_duration_seconds <= TIMESTAMPDIFF(SECOND, started_at, ended_at)
    ),
    CONSTRAINT ck_workout_sessions_business_date CHECK (
        ended_at IS NULL OR business_date = DATE(DATE_ADD(ended_at, INTERVAL 8 HOUR))
    ),
    CONSTRAINT ck_workout_sessions_state_shape CHECK (
        (status = 'active' AND active_since IS NOT NULL AND ended_at IS NULL AND business_date IS NULL)
        OR (status = 'paused' AND active_since IS NULL AND ended_at IS NULL AND business_date IS NULL)
        OR (status IN ('completed', 'abandoned') AND active_since IS NULL AND ended_at IS NOT NULL AND business_date IS NOT NULL)
    ),
    CONSTRAINT ck_workout_sessions_uncompleted_outcome CHECK (
        status = 'completed' OR (reward_eligible = 0 AND estimated_calories_kcal = 0)
    ),
    CONSTRAINT ck_workout_sessions_completed_reward CHECK (
        status <> 'completed'
        OR (reward_eligible = 1 AND active_duration_seconds >= reward_threshold_seconds)
        OR (reward_eligible = 0 AND active_duration_seconds < reward_threshold_seconds)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table training_reminders owner=M04
CREATE TABLE training_reminders (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    local_time TIME NOT NULL,
    timezone VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Asia/Shanghai',
    weekdays JSON NOT NULL,
    channels JSON NOT NULL,
    skip_if_completed BOOLEAN NOT NULL DEFAULT TRUE,
    next_trigger_at DATETIME(3) NULL,
    version INT NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_training_reminders_user (user_id),
    KEY ix_training_reminders_trigger (enabled, next_trigger_at, id),
    CONSTRAINT ck_training_reminders_enabled_bool CHECK (enabled IN (0, 1)),
    CONSTRAINT ck_training_reminders_skip_bool CHECK (skip_if_completed IN (0, 1)),
    CONSTRAINT ck_training_reminders_time CHECK (
        local_time >= '00:00:00' AND local_time < '24:00:00' AND SECOND(local_time) = 0
    ),
    CONSTRAINT ck_training_reminders_timezone CHECK (timezone = 'Asia/Shanghai'),
    CONSTRAINT ck_training_reminders_weekdays_array CHECK (
        JSON_TYPE(weekdays) = 'ARRAY' AND JSON_LENGTH(weekdays) <= 7
    ),
    CONSTRAINT ck_training_reminders_channels_array CHECK (
        JSON_TYPE(channels) = 'ARRAY' AND JSON_LENGTH(channels) <= 3
    ),
    CONSTRAINT ck_training_reminders_enabled_shape CHECK (
        (enabled = 0 AND next_trigger_at IS NULL)
        OR (enabled = 1 AND next_trigger_at IS NOT NULL AND JSON_LENGTH(weekdays) >= 1 AND JSON_LENGTH(channels) >= 1)
    ),
    CONSTRAINT ck_training_reminders_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table point_accounts owner=M05
CREATE TABLE point_accounts (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  balance INT NOT NULL DEFAULT 0,
  lifetime_earned INT NOT NULL DEFAULT 0,
  lifetime_spent INT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_m05_point_accounts_user (user_id),
  CONSTRAINT ck_m05_point_accounts_balance CHECK (balance >= 0),
  CONSTRAINT ck_m05_point_accounts_earned CHECK (lifetime_earned >= 0),
  CONSTRAINT ck_m05_point_accounts_spent CHECK (lifetime_spent >= 0),
  CONSTRAINT ck_m05_point_accounts_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- @table point_task_definitions owner=M05
CREATE TABLE point_task_definitions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  reward_points INT NOT NULL,
  scope VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  rule_version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_m05_point_task_definitions_code (code),
  CONSTRAINT ck_m05_point_task_definitions_code CHECK (CHAR_LENGTH(TRIM(code)) BETWEEN 1 AND 40),
  CONSTRAINT ck_m05_point_task_definitions_points CHECK (reward_points > 0),
  CONSTRAINT ck_m05_point_task_definitions_scope CHECK (scope IN ('daily', 'daily_course', 'once')),
  CONSTRAINT ck_m05_point_task_definitions_active CHECK (active IN (0, 1)),
  CONSTRAINT ck_m05_point_task_definitions_version CHECK (rule_version >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- @table point_task_awards owner=M05
CREATE TABLE point_task_awards (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_code VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  business_date DATE NOT NULL,
  scope_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
  rule_version INT NOT NULL,
  points INT NOT NULL,
  source_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_m05_point_awards_user_task_day_scope (user_id, task_code, business_date, scope_key),
  KEY ix_m05_point_awards_task (task_code),
  KEY ix_m05_point_awards_user_day (user_id, business_date, id),
  CONSTRAINT ck_m05_point_awards_version CHECK (rule_version >= 1),
  CONSTRAINT ck_m05_point_awards_points CHECK (points > 0),
  CONSTRAINT ck_m05_point_awards_source CHECK (CHAR_LENGTH(TRIM(source_type)) BETWEEN 1 AND 32)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- @table point_ledger owner=M05
CREATE TABLE point_ledger (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  delta INT NOT NULL,
  balance_after INT NOT NULL,
  reason VARCHAR(160) NOT NULL,
  business_date DATE NOT NULL,
  business_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  business_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_key VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reversal_of CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_m05_point_ledger_user_event (user_id, event_key),
  UNIQUE KEY uq_m05_point_ledger_reversal (reversal_of),
  UNIQUE KEY uq_m05_point_ledger_user_id (user_id, id),
  KEY ix_m05_point_ledger_user_reversal (user_id, reversal_of),
  KEY ix_m05_point_ledger_user_created (user_id, created_at DESC, id DESC),
  KEY ix_m05_point_ledger_business (business_type, business_id),
  CONSTRAINT ck_m05_point_ledger_delta CHECK (delta <> 0),
  CONSTRAINT ck_m05_point_ledger_balance CHECK (balance_after >= 0),
  CONSTRAINT ck_m05_point_ledger_type CHECK (business_type IN ('task_award', 'redemption', 'redemption_refund', 'adjustment')),
  CONSTRAINT ck_m05_point_ledger_sign CHECK (
    (business_type = 'task_award' AND delta > 0)
    OR (business_type = 'redemption' AND delta < 0)
    OR (business_type = 'redemption_refund' AND delta > 0)
    OR business_type = 'adjustment'
  ),
  CONSTRAINT ck_m05_point_ledger_event CHECK (CHAR_LENGTH(TRIM(event_key)) BETWEEN 1 AND 200),
  CONSTRAINT ck_m05_point_ledger_reversal_type CHECK (
    (reversal_of IS NULL AND business_type <> 'redemption_refund')
    OR (reversal_of IS NOT NULL AND business_type IN ('redemption_refund', 'adjustment'))
  ),
  CONSTRAINT ck_m05_point_ledger_not_self CHECK (reversal_of IS NULL OR reversal_of <> id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- @table point_rewards owner=M05
CREATE TABLE point_rewards (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  image_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  cost_points INT NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  daily_limit INT NOT NULL DEFAULT 1,
  fulfillment_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'digital',
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft',
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_m05_point_rewards_status (status, id),
  KEY ix_m05_point_rewards_asset (image_asset_id),
  CONSTRAINT ck_m05_point_rewards_cost CHECK (cost_points > 0),
  CONSTRAINT ck_m05_point_rewards_stock CHECK (stock >= 0),
  CONSTRAINT ck_m05_point_rewards_limit CHECK (daily_limit >= 1),
  CONSTRAINT ck_m05_point_rewards_fulfillment CHECK (fulfillment_type = 'digital'),
  CONSTRAINT ck_m05_point_rewards_status CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT ck_m05_point_rewards_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- @table point_redemptions owner=M05
CREATE TABLE point_redemptions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reward_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reward_title_snapshot VARCHAR(100) NOT NULL,
  reward_version_snapshot INT NOT NULL,
  cost_points INT NOT NULL,
  business_date DATE NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  fulfillment_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  fulfilled_at DATETIME(3) NULL,
  redeem_code_ciphertext TEXT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_m05_point_redemptions_user_created (user_id, created_at DESC, id DESC),
  KEY ix_m05_point_redemptions_daily_limit (user_id, reward_id, business_date, status),
  KEY ix_m05_point_redemptions_reward (reward_id),
  KEY ix_m05_point_redemptions_status (status, created_at, id),
  CONSTRAINT ck_m05_point_redemptions_cost CHECK (cost_points > 0),
  CONSTRAINT ck_m05_point_redemptions_reward_version CHECK (reward_version_snapshot >= 1),
  CONSTRAINT ck_m05_point_redemptions_version CHECK (version >= 1),
  CONSTRAINT ck_m05_point_redemptions_status CHECK (status IN ('pending', 'fulfilled', 'failed', 'refunded')),
  CONSTRAINT ck_m05_point_redemptions_fulfillment CHECK (fulfillment_status IN ('pending', 'processing', 'succeeded', 'failed')),
  CONSTRAINT ck_m05_point_redemptions_state CHECK (
    (status = 'pending' AND fulfillment_status IN ('pending', 'processing') AND fulfilled_at IS NULL)
    OR (status = 'fulfilled' AND fulfillment_status = 'succeeded' AND fulfilled_at IS NOT NULL)
    OR (status IN ('failed', 'refunded') AND fulfillment_status = 'failed' AND fulfilled_at IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- @table activities owner=M05
CREATE TABLE activities (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organizer_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(100) NOT NULL,
  category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  description TEXT NOT NULL,
  cover_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  location_name VARCHAR(150) NOT NULL,
  address TEXT NOT NULL,
  latitude DECIMAL(9,6) NULL,
  longitude DECIMAL(9,6) NULL,
  coordinate_system VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'wgs84',
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft',
  visibility VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'public',
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_m05_activities_public_feed (status, visibility, category, created_at DESC, id DESC),
  KEY ix_m05_activities_organizer (organizer_user_id, created_at DESC, id DESC),
  KEY ix_m05_activities_cover (cover_asset_id),
  CONSTRAINT ck_m05_activities_category CHECK (CHAR_LENGTH(TRIM(category)) BETWEEN 1 AND 32),
  CONSTRAINT ck_m05_activities_coordinates CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  ),
  CONSTRAINT ck_m05_activities_coordinate_system CHECK (coordinate_system = 'wgs84'),
  CONSTRAINT ck_m05_activities_status CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT ck_m05_activities_visibility CHECK (visibility IN ('public', 'private')),
  CONSTRAINT ck_m05_activities_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- @table activity_slots owner=M05
CREATE TABLE activity_slots (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  activity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  start_at DATETIME(3) NOT NULL,
  end_at DATETIME(3) NOT NULL,
  timezone VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Asia/Shanghai',
  capacity INT NOT NULL,
  booked_count INT NOT NULL DEFAULT 0,
  booking_open_at DATETIME(3) NOT NULL,
  booking_close_at DATETIME(3) NOT NULL,
  cancel_before_at DATETIME(3) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'open',
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_m05_activity_slots_activity_start (activity_id, start_at, id),
  KEY ix_m05_activity_slots_status_start (status, start_at, id),
  CONSTRAINT ck_m05_activity_slots_time CHECK (start_at < end_at),
  CONSTRAINT ck_m05_activity_slots_capacity CHECK (capacity > 0 AND booked_count >= 0 AND booked_count <= capacity),
  CONSTRAINT ck_m05_activity_slots_booking_window CHECK (booking_open_at < booking_close_at AND booking_close_at <= start_at),
  CONSTRAINT ck_m05_activity_slots_cancel_window CHECK (cancel_before_at <= start_at),
  CONSTRAINT ck_m05_activity_slots_timezone CHECK (timezone = 'Asia/Shanghai'),
  CONSTRAINT ck_m05_activity_slots_status CHECK (status IN ('open', 'canceled', 'completed')),
  CONSTRAINT ck_m05_activity_slots_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- @table activity_bookings owner=M05
CREATE TABLE activity_bookings (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'confirmed',
  participant_visibility VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'hidden',
  booked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  canceled_at DATETIME(3) NULL,
  cancel_reason VARCHAR(200) NULL,
  activity_snapshot JSON NOT NULL,
  slot_snapshot JSON NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_m05_activity_bookings_user_slot (user_id, slot_id),
  KEY ix_m05_activity_bookings_user_created (user_id, created_at DESC, id DESC),
  KEY ix_m05_activity_bookings_slot_status (slot_id, status, id),
  CONSTRAINT ck_m05_activity_bookings_status CHECK (status IN ('confirmed', 'canceled', 'attended', 'no_show')),
  CONSTRAINT ck_m05_activity_bookings_visibility CHECK (participant_visibility IN ('hidden', 'public')),
  CONSTRAINT ck_m05_activity_bookings_cancel_state CHECK (
    (status = 'canceled' AND canceled_at IS NOT NULL AND canceled_at >= booked_at)
    OR (status <> 'canceled' AND canceled_at IS NULL AND cancel_reason IS NULL)
  ),
  CONSTRAINT ck_m05_activity_bookings_activity_snapshot CHECK (JSON_TYPE(activity_snapshot) = 'OBJECT'),
  CONSTRAINT ck_m05_activity_bookings_slot_snapshot CHECK (JSON_TYPE(slot_snapshot) = 'OBJECT'),
  CONSTRAINT ck_m05_activity_bookings_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- @table booking_events owner=M05
CREATE TABLE booking_events (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  booking_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  action VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason TEXT NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_m05_booking_events_booking_occurred (booking_id, occurred_at, id),
  KEY ix_m05_booking_events_actor (actor_user_id),
  CONSTRAINT ck_m05_booking_events_action CHECK (action IN ('create', 'rebook', 'cancel', 'host_cancel', 'checkin', 'no_show'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- @table community_profiles owner=M05
CREATE TABLE community_profiles (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bio VARCHAR(200) NULL,
  discoverable BOOLEAN NOT NULL DEFAULT FALSE,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_m05_community_profiles_user (user_id),
  CONSTRAINT ck_m05_community_profiles_discoverable CHECK (discoverable IN (0, 1)),
  CONSTRAINT ck_m05_community_profiles_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- @table user_blocks owner=M05
CREATE TABLE user_blocks (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  blocked_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_m05_user_blocks_pair (user_id, blocked_user_id),
  KEY ix_m05_user_blocks_reverse (blocked_user_id, user_id),
  CONSTRAINT ck_m05_user_blocks_not_self CHECK (user_id <> blocked_user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- @table community_reports owner=M05
CREATE TABLE community_reports (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reporter_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  description VARCHAR(1000) NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  resolved_at DATETIME(3) NULL,
  resolved_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  resolution VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
  resolution_note VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_m05_community_reports_queue (status, created_at, id),
  KEY ix_m05_community_reports_reporter (reporter_user_id, created_at DESC, id DESC),
  KEY ix_m05_community_reports_target (target_type, target_id, status),
  KEY ix_m05_community_reports_resolver (resolved_by),
  CONSTRAINT ck_m05_community_reports_target CHECK (target_type IN ('activity', 'user')),
  CONSTRAINT ck_m05_community_reports_reason CHECK (reason IN ('spam', 'harassment', 'misleading', 'other')),
  CONSTRAINT ck_m05_community_reports_status CHECK (status IN ('pending', 'resolved')),
  CONSTRAINT ck_m05_community_reports_resolution CHECK (resolution IS NULL OR resolution IN ('dismiss', 'disable_target')),
  CONSTRAINT ck_m05_community_reports_state CHECK (
    (status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL AND resolution IS NULL AND resolution_note IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution IS NOT NULL AND resolution_note IS NOT NULL AND CHAR_LENGTH(TRIM(resolution_note)) >= 1)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- @table mood_records owner=M06
CREATE TABLE mood_records (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    business_date DATE NOT NULL,
    mood VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    note VARCHAR(500) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_mood_records_user_date (user_id, business_date),
    KEY ix_mood_records_user_recent (user_id, business_date DESC, id DESC),
    CONSTRAINT ck_mood_records_mood CHECK (mood IN ('happy', 'calm', 'tired', 'low'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table companion_sessions owner=M06
CREATE TABLE companion_sessions (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(60) NOT NULL DEFAULT '与小养聊聊',
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
    last_message_at DATETIME(3) NULL,
    deleted_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_companion_sessions_id_user (id, user_id),
    KEY ix_companion_sessions_user_visible (user_id, deleted_at, last_message_at DESC, id DESC),
    CONSTRAINT ck_companion_sessions_title CHECK (CHAR_LENGTH(TRIM(title)) BETWEEN 1 AND 60),
    CONSTRAINT ck_companion_sessions_status CHECK (status IN ('active', 'archived')),
    CONSTRAINT ck_companion_sessions_deleted_state CHECK (deleted_at IS NULL OR status = 'archived')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- @table companion_messages owner=M06
CREATE TABLE companion_messages (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    content TEXT NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    client_message_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    reply_to_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    provider VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    model VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
    error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    completed_at DATETIME(3) NULL,
    run_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    lease_until DATETIME(3) NULL,
    attempts INT NOT NULL DEFAULT 0,
    client_message_guard CHAR(36) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (CASE WHEN role = 'user' THEN client_message_id ELSE NULL END) STORED,
    assistant_reply_guard CHAR(36) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (CASE WHEN role = 'assistant' THEN reply_to_id ELSE NULL END) STORED,
    active_generation_guard CHAR(36) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (CASE WHEN role = 'assistant' AND status IN ('queued', 'generating') THEN session_id ELSE NULL END) STORED,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_companion_messages_id_session_user (id, session_id, user_id),
    UNIQUE KEY uq_companion_messages_client (user_id, client_message_guard),
    UNIQUE KEY uq_companion_messages_reply (assistant_reply_guard),
    UNIQUE KEY uq_companion_messages_active_generation (active_generation_guard),
    KEY ix_companion_messages_session_owner_recent (session_id, user_id, created_at DESC, id DESC),
    KEY ix_companion_messages_reply_owner (reply_to_id, session_id, user_id),
    KEY ix_companion_messages_lease (status, lease_until, id),
    CONSTRAINT ck_companion_messages_role CHECK (role IN ('user', 'assistant')),
    CONSTRAINT ck_companion_messages_status CHECK (status IN ('queued', 'generating', 'completed', 'failed', 'canceled')),
    CONSTRAINT ck_companion_messages_attempts CHECK (attempts >= 0),
    CONSTRAINT ck_companion_messages_provider CHECK (provider IS NULL OR CHAR_LENGTH(TRIM(provider)) >= 1),
    CONSTRAINT ck_companion_messages_model CHECK (model IS NULL OR CHAR_LENGTH(TRIM(model)) >= 1),
    CONSTRAINT ck_companion_messages_error_code CHECK (error_code IS NULL OR CHAR_LENGTH(TRIM(error_code)) >= 1),
    CONSTRAINT ck_companion_messages_not_self_reply CHECK (reply_to_id IS NULL OR reply_to_id <> id),
    CONSTRAINT ck_companion_messages_role_shape CHECK (
        (role = 'user' AND status = 'completed' AND client_message_id IS NOT NULL AND reply_to_id IS NULL
            AND provider IS NULL AND model IS NULL AND run_token IS NULL AND lease_until IS NULL AND attempts = 0
            AND CHAR_LENGTH(TRIM(content)) BETWEEN 1 AND 2000)
        OR (role = 'assistant' AND client_message_id IS NULL AND reply_to_id IS NOT NULL)
    ),
    CONSTRAINT ck_companion_messages_terminal_time CHECK (
        (status IN ('queued', 'generating') AND completed_at IS NULL)
        OR (status IN ('completed', 'failed', 'canceled') AND completed_at IS NOT NULL)
    ),
    CONSTRAINT ck_companion_messages_error_shape CHECK (
        (status = 'failed' AND error_code IS NOT NULL)
        OR (status <> 'failed' AND error_code IS NULL)
    ),
    CONSTRAINT ck_companion_messages_worker_shape CHECK (
        role = 'user'
        OR (status = 'queued' AND run_token IS NULL AND lease_until IS NULL AND attempts = 0)
        OR (status = 'generating' AND run_token IS NOT NULL AND lease_until IS NOT NULL AND attempts >= 1)
        OR (status IN ('completed', 'failed', 'canceled') AND lease_until IS NULL
            AND ((attempts = 0 AND run_token IS NULL) OR (attempts >= 1 AND run_token IS NOT NULL)))
    ),
    CONSTRAINT ck_companion_messages_completed_attempt CHECK (
        role <> 'assistant' OR status <> 'completed' OR attempts >= 1
    ),
    CONSTRAINT ck_companion_messages_completed_content CHECK (
        role <> 'assistant' OR status <> 'completed' OR CHAR_LENGTH(TRIM(content)) >= 1
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- All referenced tables and explicit candidate keys now exist.
ALTER TABLE users ADD CONSTRAINT fk_users_avatar FOREIGN KEY (avatar_asset_id) REFERENCES media_assets (id);
ALTER TABLE user_sessions ADD CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE refresh_tokens ADD CONSTRAINT fk_refresh_session FOREIGN KEY (session_id) REFERENCES user_sessions (id);
ALTER TABLE refresh_tokens ADD CONSTRAINT fk_refresh_successor_same_session FOREIGN KEY (replaced_by, session_id) REFERENCES refresh_tokens (id, session_id);
ALTER TABLE media_assets ADD CONSTRAINT fk_media_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE notification_subscriptions ADD CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE notification_deliveries ADD CONSTRAINT fk_deliveries_notice_owner FOREIGN KEY (notification_id, user_id) REFERENCES notifications (id, user_id);
ALTER TABLE notification_deliveries ADD CONSTRAINT fk_deliveries_subscription_owner FOREIGN KEY (subscription_id, user_id) REFERENCES notification_subscriptions (id, user_id);
ALTER TABLE user_roles ADD CONSTRAINT fk_roles_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users (id);
ALTER TABLE health_profiles ADD CONSTRAINT fk_health_profiles_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE water_records ADD CONSTRAINT fk_water_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE weight_records ADD CONSTRAINT fk_weight_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE recognition_jobs ADD CONSTRAINT fk_recognition_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE recognition_jobs ADD CONSTRAINT fk_recognition_asset_owner FOREIGN KEY (asset_id, user_id) REFERENCES media_assets (id, user_id);
ALTER TABLE meals ADD CONSTRAINT fk_meals_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE meals ADD CONSTRAINT fk_meals_photo_owner FOREIGN KEY (photo_asset_id, user_id) REFERENCES media_assets (id, user_id);
ALTER TABLE meals ADD CONSTRAINT fk_meals_job_owner_asset FOREIGN KEY (recognition_job_id, user_id, photo_asset_id) REFERENCES recognition_jobs (id, user_id, asset_id);
ALTER TABLE meal_items ADD CONSTRAINT fk_meal_items_meal FOREIGN KEY (meal_id) REFERENCES meals (id);
ALTER TABLE meal_items ADD CONSTRAINT fk_meal_items_food FOREIGN KEY (food_id) REFERENCES foods (id);
ALTER TABLE restaurant_favorites ADD CONSTRAINT fk_favorites_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE restaurant_favorites ADD CONSTRAINT fk_favorites_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants (id);
ALTER TABLE training_courses ADD CONSTRAINT fk_training_courses_cover_asset FOREIGN KEY (cover_asset_id) REFERENCES media_assets (id);
ALTER TABLE training_courses ADD CONSTRAINT fk_training_courses_video_asset FOREIGN KEY (video_asset_id) REFERENCES media_assets (id);
ALTER TABLE training_template_items ADD CONSTRAINT fk_training_template_items_template FOREIGN KEY (template_id) REFERENCES training_plan_templates (id);
ALTER TABLE training_template_items ADD CONSTRAINT fk_training_template_items_course FOREIGN KEY (course_id) REFERENCES training_courses (id);
ALTER TABLE training_plans ADD CONSTRAINT fk_training_plans_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE training_plans ADD CONSTRAINT fk_training_plans_template FOREIGN KEY (template_id) REFERENCES training_plan_templates (id);
ALTER TABLE training_plan_items ADD CONSTRAINT fk_training_plan_items_plan FOREIGN KEY (plan_id) REFERENCES training_plans (id);
ALTER TABLE training_plan_items ADD CONSTRAINT fk_training_plan_items_course FOREIGN KEY (course_id) REFERENCES training_courses (id);
ALTER TABLE workout_sessions ADD CONSTRAINT fk_workout_sessions_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE workout_sessions ADD CONSTRAINT fk_workout_sessions_course FOREIGN KEY (course_id) REFERENCES training_courses (id);
ALTER TABLE training_reminders ADD CONSTRAINT fk_training_reminders_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE mood_records ADD CONSTRAINT fk_mood_records_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE companion_sessions ADD CONSTRAINT fk_companion_sessions_user FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE companion_messages ADD CONSTRAINT fk_companion_messages_session_owner FOREIGN KEY (session_id, user_id) REFERENCES companion_sessions (id, user_id);
ALTER TABLE companion_messages ADD CONSTRAINT fk_companion_messages_reply_owner FOREIGN KEY (reply_to_id, session_id, user_id) REFERENCES companion_messages (id, session_id, user_id);
ALTER TABLE point_accounts ADD CONSTRAINT fk_m05_point_accounts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE point_task_awards ADD CONSTRAINT fk_m05_point_awards_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE point_task_awards ADD CONSTRAINT fk_m05_point_awards_task FOREIGN KEY (task_code) REFERENCES point_task_definitions (code) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE point_ledger ADD CONSTRAINT fk_m05_point_ledger_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE point_ledger ADD CONSTRAINT fk_m05_point_ledger_reversal_user FOREIGN KEY (user_id, reversal_of) REFERENCES point_ledger (user_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE point_rewards ADD CONSTRAINT fk_m05_point_rewards_asset FOREIGN KEY (image_asset_id) REFERENCES media_assets (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE point_redemptions ADD CONSTRAINT fk_m05_point_redemptions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE point_redemptions ADD CONSTRAINT fk_m05_point_redemptions_reward FOREIGN KEY (reward_id) REFERENCES point_rewards (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE activities ADD CONSTRAINT fk_m05_activities_organizer FOREIGN KEY (organizer_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE activities ADD CONSTRAINT fk_m05_activities_cover FOREIGN KEY (cover_asset_id) REFERENCES media_assets (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE activity_slots ADD CONSTRAINT fk_m05_activity_slots_activity FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE activity_bookings ADD CONSTRAINT fk_m05_activity_bookings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE activity_bookings ADD CONSTRAINT fk_m05_activity_bookings_slot FOREIGN KEY (slot_id) REFERENCES activity_slots (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE booking_events ADD CONSTRAINT fk_m05_booking_events_booking FOREIGN KEY (booking_id) REFERENCES activity_bookings (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE booking_events ADD CONSTRAINT fk_m05_booking_events_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE community_profiles ADD CONSTRAINT fk_m05_community_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE user_blocks ADD CONSTRAINT fk_m05_user_blocks_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE user_blocks ADD CONSTRAINT fk_m05_user_blocks_blocked_user FOREIGN KEY (blocked_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE community_reports ADD CONSTRAINT fk_m05_community_reports_reporter FOREIGN KEY (reporter_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE community_reports ADD CONSTRAINT fk_m05_community_reports_resolver FOREIGN KEY (resolved_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
```
<!-- END_CANONICAL_SQL -->

## 附录｜统一开发夹具ID与任务规则

以下JSON保存为 `db/seeds/fixture_ids.json`；这是测试注册表，不会自动创建用户或课程。相应表负责人负责对应fixture的实际seed。四条积分规则SQL只在已执行V001的明确开发库运行一次。

<!-- BEGIN_FIXTURE_IDS -->
```json
{
  "note": "仅测试夹具注册ID，非真实用户/门店/营养事实；各组seed统一复用，不导入演示健康历史。",
  "task_daily_checkin": "f0000000-0000-4000-8000-000000000001",
  "task_daily_water": "f0000000-0000-4000-8000-000000000002",
  "task_daily_meal": "f0000000-0000-4000-8000-000000000003",
  "task_course_workout": "f0000000-0000-4000-8000-000000000004",
  "test_user_a": "a0000000-0000-4000-8000-000000000001",
  "test_user_b": "a0000000-0000-4000-8000-000000000002",
  "test_course": "c0000000-0000-4000-8000-000000000001",
  "test_plan_template": "c0000000-0000-4000-8000-000000000002",
  "test_activity": "a1000000-0000-4000-8000-000000000001",
  "test_slot": "a1000000-0000-4000-8000-000000000002"
}
```
<!-- END_FIXTURE_IDS -->

<!-- BEGIN_DEV_POINT_RULES -->
```sql
-- Development-only rule configuration for QY-MYSQL-1.0.0.
-- No user accounts, health history, initial balances, or real rewards are seeded.
-- Run only in an explicitly selected development database, once after V001.
INSERT INTO point_task_definitions (id,code,title,description,reward_points,scope,active,rule_version) VALUES
('f0000000-0000-4000-8000-000000000001','daily_checkin','每日签到','开发暂定规则：服务端当日签到一次',10,'daily',1,1),
('f0000000-0000-4000-8000-000000000002','daily_water','认真喝水','开发暂定规则：当日首次饮水记录',5,'daily',1,1),
('f0000000-0000-4000-8000-000000000003','daily_meal','好好吃饭','开发暂定规则：当日首次确认餐记录',10,'daily',1,1),
('f0000000-0000-4000-8000-000000000004','course_workout','完成有效训练','开发暂定规则：同课程当日一次',20,'daily_course',1,1);
```
<!-- END_DEV_POINT_RULES -->

## 单文件交接与变更单要点

若Agent只拿到本MD，可先按以下字段建立本组交接单：模块、契约版本、源码基线commit和本组commit、V001校验值、修改目录与表、所属接口、启动命令、配置变量名、依赖/装配需求、已通过及未运行的测试、真实服务与mock清单、剩余任务。取得完整包后沿用 `HANDOFF_TEMPLATE.md`。

数据库变化提案至少写：CR-M0X-日期-序号、表负责人、原因、旧/新字段和约束、SQL草案、影响接口/消费组、存量数据处理、兼容步骤、失败恢复和验证。提案不自行分配V002；由M01统一排序发布。完整包另有 `SCHEMA_CHANGE_TEMPLATE.md`。

## 提交前最后核对

版本号、SQL校验值、接口归属和公共类型必须一致；只交本组模块。完整代码与运行结果填写HANDOFF_TEMPLATE.md；数据库变化填写SCHEMA_CHANGE_TEMPLATE.md。本文件是任务与数据库契约，不能把阅读/建表成功报为应用开发完成。
