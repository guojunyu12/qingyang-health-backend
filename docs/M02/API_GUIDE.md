# M02｜团队接口调用说明

日期：2026-10-21。当前契约 QY-MYSQL-1.1.0 / Schema V004。本文对应已接入 M01 的团队版本；机器定义见 [M02 OpenAPI](../../contracts/openapi/M02.yaml)，类型见 [shared_types.ts](../../contracts/shared_types.ts)。

## 地址、身份与请求头

- H5 默认 `http://127.0.0.1:3001`；后端默认 `http://127.0.0.1:3002/api/v1`。浏览器调用同站 `/api/v1`，由前端服务端变量 `API_INTERNAL_URL` 配置代理目标。
- 复用 M01 邮箱登录及 HttpOnly Cookie `qy_access`、`qy_refresh`，不接入独立 M02 的 A/B 测试账号、`/dev/session` 或 4002 端口。身份只从服务端会话取得，body 不允许 userId。
- 公共客户端发送 `X-Client-Platform: h5`。所有 PUT、POST、DELETE 均需 `Origin` 与服务端 `APP_ORIGIN` 一致、当前会话的 `X-CSRF-Token`、小写 UUID v4 的 `Idempotency-Key`。GET `/api/v1/auth/csrf` 返回 `data.csrfToken`；前端统一客户端自动处理。
- JSON body 使用 `Content-Type: application/json`；DELETE 不需要 body。同一次操作结果不明时保留原 key 和 body；用户主动新增另一条记录时生成新 key。确定业务失败后，修改输入的新提交使用新 key。
- 前端通过统一 `api()` 处理 Cookie、CSRF、刷新和错误，不读取 HttpOnly Cookie、不把令牌写入 localStorage。

## 十个业务操作

下表路径均在 `/api/v1` 下；除声明字段外，不接受多余 body/query 字段。

| 方法与路径 | 输入 | 成功结果 |
| --- | --- | --- |
| GET /me/dashboard | date 可省略，默认服务端上海日；timezone 若传只能为 Asia/Shanghai | 200 DashboardDto |
| GET /me/health-profile | 无 query | 200 HealthProfileDto 或 data:null |
| PUT /me/health-profile | 完整档案；首次 version=0，之后携带当前 version | 200 HealthProfileDto；旧版本409 |
| GET /me/health/overview | range 为7或30，默认7；endDate 默认服务端上海日 | 200 OverviewDto，完整日期网格 |
| GET /me/water-records | date 必填；limit 默认20、1–100；cursor 可选 | 200 {items,nextCursor} |
| POST /me/water-records | amountMl 为1–1000整数；recordedAt 可选；source 若传只能 manual | 201 {record,todaySummary,awards,rewardsAvailable} |
| DELETE /me/water-records/{id} | 本人记录的小写UUID v4 | 204，无JSON；重复删除本人记录仍204 |
| GET /me/weight-records | startDate/endDate 必填，含端点、最多366个日期；limit/cursor 同上 | 200 {items,nextCursor} |
| POST /me/weight-records | weightKg 为20–350，最多一位小数；recordedAt/source 同上 | 201 WeightRecordDto |
| DELETE /me/weight-records/{id} | 本人记录的小写UUID v4 | 204；删除最新测量后回退至剩余有效记录 |

档案必填 targetWeightKg（20–350）、waterTargetMl（500–6000整数）、calorieTargetKcal（800–5000）、goalType（balanced/maintain/lose/gain）、version。可选 heightCm（50–250）、birthYear（1900至服务端当前上海年份的整数）、carbsTargetG/proteinTargetG/fatTargetG（0–1000）省略或传null会清空；非整数数值项最多一位小数。不能把 SQL 的静态出生年份上限9999当成 API 上限。

日期使用 YYYY-MM-DD；recordedAt 必须带 Z 或明确偏移，最多三位毫秒，范围为同事务 operationNow 前30×24小时至 operationNow，未传则取 operationNow。UTC存储、上海业务日；饮水日有效累计不超过6000ml。todaySummary 始终指服务端当日。历史补录不补发奖励，删除不重置已获奖励资格。

分页按 (recordedAt,id) 倒序，排除软删除。cursor 绑定当前用户、类型、日期筛选，最大1500字符，只能原样经URL编码传回；换账号或筛选后清空，nextCursor=null 表示结束。

## 响应与错误

成功 JSON 为 `{data,meta:{requestId,serverTime,timezone:"Asia/Shanghai"}}`。错误 JSON 为 `{error:{code,message,fields?,retryAfterSeconds?},meta:{requestId,serverTime}}`。204 不解析 JSON。公共 M01 入口与 M02 适配器产生的 meta 以各自实际响应为准，不从错误正文读取数据库信息。

| HTTP / code | 处理 |
| --- | --- |
| 401 UNAUTHENTICATED | 统一客户端尝试会话恢复；失败后登录并清理账号缓存 |
| 403 INVALID_ORIGIN / INVALID_CSRF | 核对APP_ORIGIN、同站代理、当前会话CSRF；保留输入 |
| 403 ACCOUNT_DISABLED | 停止当前账号写入，按M01账号状态处理 |
| 404 NOT_FOUND | 不存在或非本人记录，不泄露他人数据 |
| 409 VERSION_CONFLICT | 重新读取档案，让用户确认后保存 |
| 409 IDEMPOTENCY_CONFLICT | 同key对应不同body；不能悄悄换key重复新增 |
| 409 REQUEST_IN_PROGRESS | 按retryAfterSeconds稍后用原key/body重试 |
| 409 WATER_DAILY_LIMIT | 超出该上海日期6000ml有效录入上限 |
| 422 INVALID_IDEMPOTENCY_KEY | 所有写操作均需有效的小写UUID v4 key |
| 422 VALIDATION_ERROR | 修正字段、精度、日期、游标等输入 |
| 500 INTERNAL_ERROR | 未知异常隐藏内部信息；结果不明的写请求保留key/body |

## 调用示例

在已登录的 H5 中调用既有客户端，不新增登录/连接池：

```ts
import { api } from "@/lib/api/client";
const profile = await api("/me/health-profile");
const operationKey = crypto.randomUUID();
const body = { amountMl: 250 };
await api("/me/water-records", {
  method: "POST", body, idempotencyKey: operationKey,
});
// 若结果不明，原样重试上述调用；主动喝第二杯需另一个 key。
```

通过 `src/features/health/runtime.ts` 的 `healthApi` 调用时同样传入稳定key；成功后沿用 `invalidateHealth()`。HealthProfilePanel 由今日和“我的”共用，跨模块不要另存一份健康档案。

## 跨模块与数据库边界

后端 `src/modules/health/integration.ts` 复用 IdentityService、idempotent()、sqlTx()、unitOfWorkPort；HealthRepository 提供 HealthQueryPort。modulePorts 按实际注册状态启用聚合，所有 QueryPort 复用传入的只读快照tx，不能各自另开连接。

缺少对应端口时 availability=false、相关未知值null；没有积分端口时饮水仍保存、rewardsAvailable=false、不写M05表、不承诺补发。营养端口现已装配，但供应商密钥、M05及其他模块是否可用需按实际环境单独验收。

公共 GET `/api/v1/meta/contract` 已由M01实现，不计入本组十个操作；返回 contractVersion、schemaVersion、baselineSha256、timezone。schemaVersion 来自真实迁移历史，不返回数据库连接信息。

数据库建库、连接和三表归属见 [DATABASE.md](DATABASE.md)。这些是服务端配置与SQL，不是可供浏览器调用的“建库接口”。完整启动仍需M01的SMTP、Redis和独立认证密钥，缺SMTP不能把登录或API服务报为可用。
