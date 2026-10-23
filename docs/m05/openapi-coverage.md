# M05 正式 OpenAPI 覆盖说明

更新：2026-10-23。对应问题：M05-05。基线：后端 main 的 `3ec4962fd6043bfea6c6b83c587eb6f94e5b0119`，本轮任务分支 `codex/m05-remediation-20261023`。

`contracts/openapi/M05.yaml` 使用与 M03 同样的 JSON 编码（合法 YAML 1.2），声明 OpenAPI 3.0.3。根据当前正式装配、Controller、业务 Service/Queries、M01 公共安全设施和冻结数据库状态编写；没有复制旧独立包或修改 M01–M03 的契约。

## 实际路由范围

| 实现入口 | 操作数 | 范围 |
| --- | ---: | --- |
| `src/m05/runtime.ts` | 5 | 正式会话、后台总览、运行能力、公共素材列表/详情 |
| `src/m05/modules/points/http.ts` | 8 | 本人账户/任务/流水/签到、后台账户/流水/规则查询与编辑 |
| `src/m05/modules/activities/http.ts` | 29 | 活动/场次、预约/取消/核销、社区资料/屏蔽/举报/审核 |
| `src/m05/modules/rewards/http.ts` | 13 | 权益管理、本人兑换、后台订单与核对调度 |
| `src/m05/modules/notifications/http.ts` | 11 | 消息批次、接收人与发送结果、审计、通知事件重试 |
| 合计 | 66 | 55 个路径；4 个匿名读取、20 个登录用户操作、42 个管理员操作 |

只包含正式 runtime 实际注册的 M05 路由。`notifications/http.ts` 中旧 H5 类未装配，故不重复声明其 inbox/read/capabilities；它们继续由 M01 实现，身份、登录/刷新/退出、上传、站内通知参阅 `contracts/openapi/M01.yaml`。不存在 `/dev/session`、短信、私信或动态流接口。

## 字段与行为核对

- 102 个具名 Schema；请求必填/可选字段、nullable、数字上下界、枚举、UTC 毫秒时间、业务日、版本以及所有返回字段均列明。请求对象拒绝未声明字段；没有用任意 `data` 对象替代响应 DTO。
- 列表使用 `items` 与 `nextCursor`，不声明不存在的 total/page。游标与账号/筛选绑定，默认 20、最大 100；活动场次按开始时间升序，其他分页按各自记录时间倒序。H5 场次必须同时提供日期范围，最多 90 天。
- 所有写入声明 M01 Cookie、Origin、CSRF、UUIDv4 幂等键；后台需 admin，事务内重新校验角色。每个错误状态列出相关 `x-error-codes`，共同错误体含可选 `retryAfterSeconds`；请求处理中响应包含 `Retry-After`。
- 版本冲突、账号隔离、隐藏/屏蔽、名额/时间冲突、报名及取消窗口、规则停用、发布前供应商检查均按实现写入描述。通知发送和对账返回 202 表示排队，不表示已完成。
- H5 兑换仅在 fulfilled 时可含本人 code；后台不暴露 code，使用 codeAvailable。后台订单 execution、ledger 和外部投递 deliveries 的现存 snake_case 子字段如实记录，未擅改运行接口。
- 公共素材仅 activity_cover/reward_image，排除私人头像、餐照和 deleted。读取接口签发短期安全图链接；活动/权益写接口的图片 URL 仍为 null。
- 审计 summary 根据当前 LocalAudit 调用列出 12 种字段结构，使用 anyOf；没有以无约束对象代替已知审计字段。
- 通知 channel=external 表示调用 M01 NotificationsPort，不表示外部推送已启用。现有 webPush/appPush=false；sentAt 是首次提交时间，succeeded 表示站内通知创建成功。

本轮同时发现 M05 的 Nest 错误过滤器丢弃公共幂等错误重试时间；主任务已修复 `Retry-After` 和 `error.retryAfterSeconds`，契约与该修复配套。权益供应商继续遵循当前明确未配置的状态，文档不宣称真实权益履约已验收；积分分值及启用仍由运营决定。

## 本轮验证

`node --import tsx --test tests/m05-openapi.test.ts`：5 项通过、0 失败、0 跳过，验证 JSON/YAML 子集可解析、内部引用、必填字段、操作 ID/路径参数、66 个实际路由完整对应、认证/CSRF/幂等、分页及本人/后台字段差异，并把关键状态枚举与冻结 SQL、通知事件与 Worker 注册列表对照。测试不连数据库、不发送消息、不更改环境。

`npm run typecheck`：通过。上述契约测试属于静态契约保护，不代替真实 API/MySQL/Redis 集成测试或第三方 OpenAPI lint；实际业务回归结果由本轮交付记录单列。数据库、依赖和公共 DTO 无结构变更。
