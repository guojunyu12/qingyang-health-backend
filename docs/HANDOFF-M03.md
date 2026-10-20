# M03 正式整合交接

更新：2026-10-21（上海时间）。来源 `weiweidounais/qingyang@54181b81028a857ec95831459c2d1b5da89ef35e`。

## 状态

已在现有 M01/M02 基线上接入 M03 正式代码，并完成本地确定性验收。未推送、未合 main、未部署，也未重启原有 3002 API/Worker。真实千问和高德调用、M05 结算尚未验收，不能称整个业务闭环已完成。

后端切片：`45e4d414cd4fe69d062de62b231aabc46348f7c8`（领域/目录/餐饮）、`862948be4e1b45a3ca6892f484363a3077587ad5`（线上视觉）、`afadd722a6cc0a59f80de65858a9fefcdd2381ca`（正式HTTP/Worker）。配套前端：`5bcfbd1cf9d731717a4483584ba97a54490aa529`、`c748d337b3eb6c999701ea462c80d0292d708bc6`、`0f8ffb0c0e32ff06820db55c620990aa8b90f55b`。

## 已接入及保留

- 复用 M01 邮箱会话、Origin/CSRF、统一请求器、私有上传、SqlTx/UnitOfWork、幂等和 Outbox；没有引入交付 dev server、A/B 测试登录或另一套生产连接池。
- 目录、餐记录查询/编辑/删除、识别创建/轮询/取消、餐厅与收藏接口通过现有 main 路由链装配。14 个业务操作加 `/api/v1/nutrition/capabilities`，见 `contracts/openapi/M03.yaml`。
- `modulePorts.nutrition` 增量注册；M02 同快照聚合读取真实餐记录，不清空其他端口。M02 空餐日的已接入摄入量为 0，其他未接入模块仍保留 null/availability=false。
- 千问 `QianwenVision` 实现受控安全 WebP → Base64 图文消息 → 在线 Chat Completions → 严格候选校验；不抓取用户提供的远程 URL，不重试结果不明的收费调用。
- 原媒体/Outbox Worker 保留，追加识别事件消费者、数据库事件归属复核、租约回收和关闭处理；即使当前没有模型密钥也能回收此前过期租约。
- 高德适配及 WGS84/GCJ02 转换接入。当前零缓存，不持久化实时查询商家、不允许新增收藏；已有收藏可查询和取消。
- 用户确认真实页面替换，不导入演示餐、商家或收藏；取消表单不保存，编辑新旧日期均触发共享失效；切账号按 user.id 重挂载并取消过期请求。

## 配置和启动

沿用 `.env.example` 及忽略的本地 `.env.local`，不复制队友配置或数据。

```dotenv
M03_VISION_PROVIDER=qianwen-online
M03_VISION_BASE_URL=https://maas.qianwenaiapi.com/compatible-mode/v1
M03_VISION_MODEL=qwen3-vl-plus
DASHSCOPE_API_KEY=
M03_VISION_TIMEOUT_MS=60000
M03_AMAP_API_KEY=
```

缺千问密钥时 `recognition=false`，创建识别返回503。配置密钥表示已装配，不保证上游实际可用；运行故障有失败状态。图片原始读取地址不发给供应商，私有签名在服务端复核后直接读取 M01 安全副本。

缺高德密钥时 `poi=false`；有密钥时能力查询尝试初始化所需 MCP 工具，失败明确不可用。密钥不发送到浏览器、不记录在交接材料。

```sh
# 在后端仓库，正常使用既有环境配置
npm ci
npm run seed:m03 # 显式初始化目录，确认目标环境后执行；不在启动时自动导入
npm run dev
# 另一个终端
npm run worker
```

本轮只在隔离测试库执行 seed，未向现有开发库导入目录。默认前端3001、API3002保持原约定；配置或代码变更需重启相应 API/Worker。生产原有 PointsPort、HTTPS、可信代理启动检查保留，当前缺 M05 时仍不能生产启动。

## M05 缺依赖策略

当前没有真实 M05 PointsPort。M03 按契约拒绝新增餐，返回 `503 POINTS_NOT_CONFIGURED`，不写餐事实、不伪造空奖励、不跨写 M05 表，也不承诺未来补发。页面禁用新增记餐入口；已有记录查询、编辑/删除和识别候选仍可用。

后续应由 M05 注册真实端口后验证记餐与奖励同事务、每日首次去重及回滚。若要像 M02 一样允许“先记餐、暂不奖励”，需要项目负责人单独决定并更新契约；本次未擅自采用这一例外。

## 数据库

沿用 QY-MYSQL-1.1.0 / V004，六张 M03 表已在 V001。本轮只读核实当前开发库六表与 V001–V004 记录均存在；不新增DDL、不重放迁移、不导入队友数据库。共享类型两仓 SHA-256 一致且未修改。四种目录数据来源保留交付记录，本轮未重新联网校验营养值。

## 本轮测试

```sh
# BE，明确使用隔离库
npm run typecheck
npm run build
DB_NAME=qingyang_auth_test npm test
DB_NAME=qingyang_auth_test npm run seed:m03

# FE
npm run typecheck
npm test
npm run build
npm run test:e2e -- --workers=1
QY_LIVE_E2E=1 QY_E2E_CODE_FILE=server/.local/m03-e2e-code npx playwright test --config=playwright.m03-live.config.ts
```

- 后端29项、0跳过，通过；包含真实 MySQL/Redis/随机HTTP端口、正式邮箱/CSRF/上传、跨账号、幂等、事务失败回滚、日期与M02聚合、识别唯一领取/确认/取消/过期租约、30项最大合法请求；保留M01媒体独立Worker及所有原M02回归。
- 前端20项单元测试通过；包括上传向同源发送Cookie/CSRF、拒绝外站地址、ready/validating资产恢复不重复PUT。
- 默认浏览器23项通过，两个显式live用例默认跳过；随后独立3101/3102及 `_test` 库实际执行这两个live用例，2项通过。
- 相机使用 Chromium 虚拟视频源；定位使用模拟权限/设备回调。未验收真实手机相机和定位硬件。
- M03识别集成中的上游响应、地图RPC、积分端口是测试替身；正式应用不注册这些测试替身。真实积分账本、供应商额度/响应速度未验收。
- 反复测试期间仅重置过隔离 `_test` 命名空间下 loopback IP 的限流桶，没有清空Redis或修改生产限流规则。

独立审查发现的上传断网恢复P2已修复并复核关闭。类型、构建和上述保护回归均重新通过。Next测试进程自动改写的next-env/tsconfig测试路径已恢复，不提交临时生成路径。

## 下一步与回滚

配置对应服务端密钥、接入真实 M05 后，再完成真实识别确认→记餐→M02更新→真实奖励一次，以及真实高德与手机硬件验收。当前代码可供主窗口复核，不是上线通知。

回滚按上述FE/BE切片评估依赖后有范围revert，不回退 M01/M02，不删除历史业务数据。无DDL，因此无需迁移回滚；目录初始化不能随Git回滚自动删除，尤其不得删除已被历史快照引用的目录项。
