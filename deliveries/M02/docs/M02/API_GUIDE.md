# M02 接口调用与团队接入说明

更新时间：2026-10-20。契约：QY-MYSQL-1.0.0。业务接口：10 个，统一前缀 `/api/v1`。

本文补充现有接口说明，不新增业务路由或修改冻结 V001。机器可读定义与全部请求/成功/失败响应示例见 [M02 OpenAPI](../../contracts/openapi/M02.yaml)。OpenAPI 为 JSON 格式的合法 YAML，可直接用 JSON 工具读取；生成入口为 `python3 tools/m02-dev/generate-openapi.py`。

## 请求约定

| 信息 | 约定 |
| --- | --- |
| 基础地址 | 本地 API：`http://127.0.0.1:4002/api/v1`；整合环境由 M01 提供同站 `/api/v1` 反向代理 |
| 会话 | 身份只取自服务端会话；Body 不接受 userId、role、balance、delta 等字段 |
| 所有业务请求 | `X-Client-Platform: h5`，属于 00 总契约规定的公共请求头 |
| 写请求 | PUT、POST、DELETE 均发送当前会话的 `X-CSRF-Token` |
| JSON 请求体 | `Content-Type: application/json`；只发送该接口声明的字段 |
| POST 幂等 | `Idempotency-Key` 为应用生成的小写 UUID v4；同一操作重试使用原 key 和原请求体，主动新增另一次记录换新 key |
| 成功响应 | 查询/保存 200，新增 201，JSON 为 `{data,meta:{requestId,serverTime,timezone:"Asia/Shanghai"}}` |
| 删除响应 | 204，无 JSON 响应体；本人重复删除仍为 204 |
| 错误响应 | `{error:{code,message,fields?,retryAfterSeconds?},meta:{requestId,serverTime}}`；按 code 处理，不能只判断 message |

M02 的 HTTP 适配器负责业务字段和身份上下文检查；通用平台头处理、正式鉴权、CSRF、限流和幂等执行由 M01 统一装配。本文声明公共请求约定，不代表 M02 已独立实现全部公共中间件。

## 10 个业务接口与参数

| 方法与路径（均在 /api/v1 下） | 输入与边界 | 成功结果 |
| --- | --- | --- |
| GET /me/dashboard | date 可省略，默认服务端当前上海日；timezone 若提供，只能为 Asia/Shanghai | DashboardDto；无目标时相关预算和进度为 null |
| GET /me/health-profile | 无查询参数 | HealthProfileDto 或 data:null |
| PUT /me/health-profile | 必填 targetWeightKg、waterTargetMl、calorieTargetKcal、goalType、version；完整 PUT | 首建 version=0，成功为 1；后续按当前 version 更新 |
| GET /me/health/overview | range 为 7/30，默认 7；endDate 默认服务端当前上海日 | OverviewDto；日期连续，包含结束日 |
| GET /me/water-records | date 必填；limit 默认 20，范围 1—100；cursor 可选 | `{items,nextCursor}` |
| POST /me/water-records | amountMl 为 1—1000 整数；recordedAt 可选；source 若提供只能为 manual | `{record,todaySummary,awards}` |
| DELETE /me/water-records/{id} | 本人记录的小写 UUID v4 | 204；统计排除软删，奖励资格不重置 |
| GET /me/weight-records | startDate、endDate 必填且含端点，结束不早于开始；最多 366 个日期；limit/cursor 同饮水 | `{items,nextCursor}` |
| POST /me/weight-records | weightKg 为 20—350，最多一位小数；recordedAt/source 同饮水 | WeightRecordDto |
| DELETE /me/weight-records/{id} | 本人记录的小写 UUID v4 | 204；删最新测量后回退到剩余最近一次 |

档案的可选项 heightCm、birthYear、carbsTargetG、proteinTargetG、fatTargetG，省略或传 null 都清空。heightCm 为 50—250；birthYear 为 1900 至**服务端当前上海年份**；营养目标为 0—1000；targetWeightKg 为 20—350、waterTargetMl 为 500—6000 整数、calorieTargetKcal 为 800—5000。除整数项外的这些数值最多一位小数。goalType 只能为 balanced、maintain、lose、gain。

birthYear 的 SQL CHECK 上界 9999 只控制静态存储，不能用作 API 的动态上界。OpenAPI 用文字及 `x-dynamic-maximum` 记录这一限制，不将生成文档当天的年份写死。

日期格式为 `YYYY-MM-DD`；recordedAt 必须带 Z 或明确偏移时区，最多三位毫秒。允许的瞬间范围为 `[operationNow - 30×24 小时, operationNow]`，未填使用该事务的 operationNow。数据库保存 UTC，businessDate 为上海日期；历史补录不补发日任务积分。POST 饮水的 todaySummary 始终是**服务端当前上海日**，不是补录那天的统计。

饮水日累计按未删记录计算，在用户锁内校验不超过 6000 ml；这是本版录入边界。无档案可以记录饮水和体重；目标相关字段返回 null。progress 是有效累计除以当前目标，可大于 1。

两类列表按 `(recordedAt,id)` 倒序，排除软删。cursor 最长 1500 字符，绑定当前用户、记录类型和日期筛选。客户端只原样传回 nextCursor；换用户、日期或记录类型时清空，不能解码后自行拼接。nextCursor=null 表示结束。体重范围的 366 天包含首尾两天，即日期差不超过 365 天。

## 业务错误码及处理

| HTTP | code | 触发条件 | 客户端处理 |
| --- | --- | --- | --- |
| 401 | UNAUTHENTICATED | 无有效身份、会话失效或账号不可用 | 按 M01 流程重新登录，清理用户缓存 |
| 403 | CSRF_INVALID | 写请求缺少当前会话对应的有效令牌 | 重新获取会话及 CSRF，保留用户输入 |
| 404 | NOT_FOUND | 要删除的记录不存在或不属于当前用户 | 不显示他人记录信息，不自动改写其他资源 |
| 409 | VERSION_CONFLICT | 两次 version=0 首建竞争，或旧版本更新 | GET 最新档案，展示冲突，让用户确认后再保存 |
| 409 | IDEMPOTENCY_CONFLICT | 相同用户/方法/路径/key 的请求体不同 | 检查操作状态；恢复原 body 重试，不能悄悄换 key 再新增 |
| 409 | REQUEST_IN_PROGRESS | 同 key 的请求仍在处理中，或执行租约失效 | 稍后用原 key、原 body 重试，不同时发送不同内容 |
| 409 | WATER_DAILY_LIMIT | 新增后所选上海业务日有效饮水累计将超过 6000 ml | 保留输入并提示录入边界，不自动拆成多条提交 |
| 422 | VALIDATION_ERROR | 未声明字段、类型/精度/日期/时区/分页/游标等校验失败 | 按 fields 提示；修改输入后视为新的操作 |
| 500 | INTERNAL_ERROR | 未识别的服务端异常，包括依赖失败 | 保留输入；若是结果不明的 POST，以原 key/body 查询式重试 |

CSRF 和幂等码由正式 M01 命令执行器返回；联调工具有对应的显式测试实现。M01 统一入口的权限、限流等还可能返回公共契约错误，例如 429；不是本模块已独立交付的限流功能。不要把通用错误清单解读为每个业务接口都会触发所有错误。

错误响应示例（仅用于说明结构）：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "档案已更新，请重新加载后保存"
  },
  "meta": {
    "requestId": "e0000000-0000-4000-8000-000000000001",
    "serverTime": "2026-10-20T02:00:00.000Z"
  }
}
```

## 本地调用示例

先按根 README 启动 MySQL 和本地 API。以下为 macOS/Linux 终端示例，使用 Node.js 读取 JSON 和生成 UUID。只针对显式测试账号；写请求会产生测试记录，目标值需由调用者主动选择。OpenAPI 中的日期/UUID/数值均为构造示例，不是数据库实测结果。

先建立测试会话。此 `/dev/session` 是本地工具端点，**不计入 M02 十个业务 API，也不是正式登录接口**：

```sh
M02_API_ORIGIN=http://127.0.0.1:4002
M02_FRONTEND_ORIGIN=http://127.0.0.1:3001
M02_COOKIE_FILE="$(mktemp)"
M02_SESSION_FILE="$(mktemp)"
M02_WATER_RESPONSE="$(mktemp)"
M02_WEIGHT_RESPONSE="$(mktemp)"
trap 'rm -f "$M02_COOKIE_FILE" "$M02_SESSION_FILE" "$M02_WATER_RESPONSE" "$M02_WEIGHT_RESPONSE"' EXIT
curl --fail-with-body --silent --show-error \
  --cookie-jar "$M02_COOKIE_FILE" \
  --header "Origin: $M02_FRONTEND_ORIGIN" \
  --header 'Content-Type: application/json' \
  --data '{"account":"a"}' "$M02_API_ORIGIN/dev/session" > "$M02_SESSION_FILE"
M02_CSRF="$(node -e 'const fs=require("node:fs");console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).csrfToken)' "$M02_SESSION_FILE")"
M02_DATE="$(node -e 'console.log(new Date(Date.now()+8*3600000).toISOString().slice(0,10))')"
m02_request() {
  curl --fail-with-body --silent --show-error \
    --cookie "$M02_COOKIE_FILE" \
    --header "Origin: $M02_FRONTEND_ORIGIN" \
    --header 'X-Client-Platform: h5' \
    --header "X-CSRF-Token: $M02_CSRF" "$@"
}
```

测试 Cookie 为 HttpOnly 的 `m02_test_session`。本地脚本允许将令牌暂存于终端变量，不将 Cookie 文件或 CSRF 输出到公共文档、提交记录或浏览器持久缓存。正式 H5 由 M01 统一客户端发送 Cookie，前端不读取 HttpOnly Cookie。

查询今日、档案、近 7 天大屏及两类记录列表，共五个 GET：

```sh
m02_request "$M02_API_ORIGIN/api/v1/me/dashboard?date=$M02_DATE&timezone=Asia%2FShanghai"
m02_request "$M02_API_ORIGIN/api/v1/me/health-profile"
m02_request "$M02_API_ORIGIN/api/v1/me/health/overview?range=7&endDate=$M02_DATE"
m02_request "$M02_API_ORIGIN/api/v1/me/water-records?date=$M02_DATE&limit=20"
m02_request "$M02_API_ORIGIN/api/v1/me/weight-records?startDate=$M02_DATE&endDate=$M02_DATE&limit=20"
```

档案完整保存示例：仅无档案时使用 version=0；若已存在，先读取上一步 GET 的 version，结合用户选择修改请求体，不能沿用 0 覆盖。下列数值只表示主动选择的示例：

```sh
m02_request --request PUT \
  --header 'Content-Type: application/json' \
  --data '{"targetWeightKg":60,"waterTargetMl":2000,"calorieTargetKcal":1800,"goalType":"balanced","version":0}' \
  "$M02_API_ORIGIN/api/v1/me/health-profile"
```

新增饮水与网络重试示例。同一次操作的 body 字符串和 key 都保存下来；第二条请求示范重放，预期仍为 201 且返回同一记录，不再新增。用户主动再喝一杯时，另行生成新的 key：

```sh
M02_WATER_KEY="$(node -e 'console.log(require("node:crypto").randomUUID())')"
M02_WATER_BODY='{"amountMl":250}'
m02_request --request POST --header 'Content-Type: application/json' \
  --header "Idempotency-Key: $M02_WATER_KEY" --data "$M02_WATER_BODY" \
  "$M02_API_ORIGIN/api/v1/me/water-records" > "$M02_WATER_RESPONSE"
m02_request --request POST --header 'Content-Type: application/json' \
  --header "Idempotency-Key: $M02_WATER_KEY" --data "$M02_WATER_BODY" \
  "$M02_API_ORIGIN/api/v1/me/water-records"
```

新增体重：每次主动新增使用自己的新 key；默认记录当前瞬间。补录时另外提供符合时间范围的 recordedAt，原样保留整个请求体用于重试：

```sh
M02_WEIGHT_KEY="$(node -e 'console.log(require("node:crypto").randomUUID())')"
m02_request --request POST --header 'Content-Type: application/json' \
  --header "Idempotency-Key: $M02_WEIGHT_KEY" --data '{"weightKg":60.5}' \
  "$M02_API_ORIGIN/api/v1/me/weight-records" > "$M02_WEIGHT_RESPONSE"
```

确认上述新增成功后，从实际响应取记录 ID 删除这两条测试记录，覆盖两个 DELETE。204 没有 JSON 内容；原有记录和已有积分奖励不因该示例被重置：

```sh
M02_WATER_ID="$(node -e 'const fs=require("node:fs");console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).data.record.id)' "$M02_WATER_RESPONSE")"
M02_WEIGHT_ID="$(node -e 'const fs=require("node:fs");console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).data.id)' "$M02_WEIGHT_RESPONSE")"
m02_request --include --request DELETE "$M02_API_ORIGIN/api/v1/me/water-records/$M02_WATER_ID"
m02_request --include --request DELETE "$M02_API_ORIGIN/api/v1/me/weight-records/$M02_WEIGHT_ID"
```

下一页请求将响应中的非空 nextCursor 原样作为 cursor，经 URL 编码发送，并保持原来的账号、类型、日期条件。例如使用 `curl --get --data-urlencode "cursor=$M02_NEXT_CURSOR"`，不能直接拼接未编码的游标或发送字符串 `null`。

## 正式团队接入待确认项

| 信息 / 能力 | 负责人 | 当前交付边界 |
| --- | --- | --- |
| 正式登录 Cookie 名称、属性、会话续期 | M01 | OpenAPI 的 session 为名称占位；M02 不提供另一套正式登录 |
| CSRF 获取、刷新、401 恢复流程 | M01 | 当前只提供统一客户端注入接口；本地 /dev/session 不能用于正式用户 |
| 平台请求头、同站代理、鉴权、限流 | M01 | 正式公共入口装配；本地 API 仅回环测试 |
| 幂等租约、用户锁、统一错误适配 | M01 | 按 HealthCommandExecutor / UnitOfWork 注入；本地有显式测试实现 |
| GET /api/v1/meta/contract | M01 | 本仓库 M02 未实现，未加入本组十个路径；由 M01 从真实迁移历史读取版本 |
| 饮水原子奖励、账户和任务查询 | M05 | 注入真实 PointsPort / PointsQueryPort；当前为测试适配器 |
| 饮食、训练、心情、活动查询 | M03/M04/M06/M05 | 注入约定 QueryPort，复用同一 readSnapshot 事务 |

`GET /api/v1/meta/contract` 的约定成功 data 包含 contractVersion、schemaVersion、baselineSha256、timezone；外层沿用公共 envelope。schemaVersion 不从静态 `applied:false` 推断，也不能写死成未执行的版本。该接口不返回数据库主机、账号、密码等连接信息。本次补充不将其标为已实现。

后端调用 `createHealthModule(realDependencies, realCommandExecutor, 'real')`。若 M01 已使用全局前缀 api/v1，第四参数传空字符串。前端调用 `installHealthRuntime` 注入统一请求客户端、失效入口与账号切换通知。详细依赖见 [模块 README](README.md)。

数据库建库和连接已有 [本地部署说明](LOCAL_MYSQL_DEPLOYMENT.md)、冻结 SQL 和环境示例；它们不是开放给浏览器调用的建库 API。各成员开发库独立，团队整合库单独建立。
