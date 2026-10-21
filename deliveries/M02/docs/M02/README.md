# M02 健康记录与个人看板

基于现有轻养前端完成 M02 模块，沿用浅紫主色、白色圆角卡片、原有插画和响应式布局。今日页与大屏读取 API，不再读取 localStorage 的演示健康数据。

2026-10-20 本地部署与验收复核、队友独立启动及整合说明见 [LOCAL_MYSQL_DEPLOYMENT.md](LOCAL_MYSQL_DEPLOYMENT.md)。

完整请求头、错误码、日期/游标/版本规则、十个接口调用和重试示例见 [API_GUIDE.md](API_GUIDE.md)。OpenAPI 可通过 `python3 tools/m02-dev/generate-openapi.py` 重复生成；补充说明不改变十个业务路由或公共类型。

## 已实现

- 健康档案完整 PUT、首次 version=0、条件更新和冲突提示。
- 饮水新增、逐次列表、6000 ml 日累计录入边界、同事务 PointsPort 调用。
- 体重新增、同日多次测量、稳定排序、删除最新测量后回退。
- 两类记录软删除、本人重复删除 204、他人记录 404、筛选绑定游标。
- UTC 时间与上海业务日、近 30 天补录、历史补录不发日任务积分。
- 同一只读快照聚合、7/30 天连续日期、缺测不连线、按有记录天数求均值。
- 移动端和桌面今日页、个人大屏、HealthProfilePanel、保存失败保留输入、同操作重试复用幂等键。
- 10 个接口的 OpenAPI 3.1、SQL/DTO 映射、验证脚本与验收用例。

## 源码位置

| 内容 | 位置 |
| --- | --- |
| 今日页 | src/features/dashboard/dashboard.tsx |
| 个人大屏 | src/features/overview/overview.tsx |
| 档案面板及模块前端适配接口 | src/features/health/ |
| 后端业务模块、DTO 校验、mapper、查询端口 | server/src/modules/health/ |
| 本组接口片段 | contracts/openapi/M02.yaml |
| 原样提取的公共类型及冻结基线 | contracts/shared_types.ts、db/migrations/V001__baseline.sql |
| 显式本地联调入口及测试适配器 | tools/m02-dev/ |

当前工作区是完整前端项目；交付 ZIP 是叠加于记录的起始 commit 的 M02 模块交付包，不重复打包其他组原始源码。原前端仓库曾忽略 server/；本次公开的统一仓库已经纳入后端源码，保留依赖与本地配置的忽略规则。**交付 ZIP 同样显式包含后端源码**，可通过逐文件校验清单确认。运行 `python3 tools/package_m02.py` 可重新生成完整交付包与逐文件校验清单。

## 本地启动

需要 Node.js 22+ 和 MySQL 8.4。根依赖与锁文件保持前端基线不变，新增后端依赖只安装在隔离的联调工具目录。

在项目根目录：

```sh
npm ci
npm --prefix tools/m02-dev ci
```

本次验证已在 `.local/m02-downloads/mysql-8.4.11-macos15-arm64/` 下载独立 MySQL 8.4.11，数据仅位于 `.local/m02-mysql/`，监听 `127.0.0.1:3308`，不安装系统服务。交付包不包含数据库程序、数据库数据、Cookie 或依赖目录。该压缩包来源：[MySQL 官方下载](https://dev.mysql.com/downloads/mysql/?version=8.4.11)。

后端模块按标准 Node 模块解析查找 Nest 依赖。当前工作区有 `server/node_modules` 指向 `../tools/m02-dev/node_modules` 的本地链接。新解压的目录在 server 尚未安装统一依赖时，可执行一次：

```sh
ln -s ../tools/m02-dev/node_modules server/node_modules
```

**已有统一后端依赖目录时不执行此链接。** 正式接入由 M01 统一安装依赖，业务模块无需联调工具。

数据库配置（均为服务端变量）：

| 名称 | 联调默认值 |
| --- | --- |
| M02_DB_HOST | 127.0.0.1 |
| M02_DB_PORT | 3308 |
| M02_DB_NAME | qingyang_dev_m02 |
| M02_DB_USER | root（仅本地测试） |
| M02_DB_PASSWORD | 空（仅本次独立回环测试实例） |
| M02_API_PORT | 4002 |
| M02_FRONTEND_ORIGIN | http://127.0.0.1:3001 |

若使用自己的数据库服务，请配置相应账号和密码。**初始化仅允许明确选定的 M02 空开发/测试库；非空库直接拒绝重复执行 V001，不会清库重建。** 初始化会创建明确标记的两个测试账号与 0 积分账户，不创建健康历史。

第一次启动：

```sh
M02_TEST_ADAPTERS=1 npm --prefix tools/m02-dev run start -- --init
```

后续启动（不再加 --init）：

```sh
M02_TEST_ADAPTERS=1 npm --prefix tools/m02-dev run start
```

另开一个终端启动原前端：

```sh
NEXT_PUBLIC_M02_DEV_API=http://127.0.0.1:4002 npm run dev
```

打开 http://127.0.0.1:3001/dashboard，选择横幅中的测试账号 A 或 B。记录会持久保存在 MySQL 中。测试账号切换会清除 M02 视图和请求状态；其他组旧演示页面仍由原工程管理。

## 与 M01 的正式接入

00 总契约已明确 M01 的职责与类型，提供的三份附件没有单独 M01 工作包。本次未获得可读取的 M01 底座实现；因此不将本地登录或积分测试适配器标为团队底座完成。

后端由 M01 提供 HealthDependencies 的全部端口和 HealthCommandExecutor：

```ts
createHealthModule(realDependencies, realCommandExecutor, 'real');
```

该模块默认注册完整 `/api/v1/me/...` 路径。若 M01 应用已统一 `setGlobalPrefix('api/v1')`，第四参数传空字符串，避免重复前缀：

```ts
createHealthModule(realDependencies, realCommandExecutor, 'real', '');
```

M01 鉴权中间件设置 `req.identity.userId`、`req.requestId`。HealthCommandExecutor 必须验证 CSRF，并按契约领取幂等租约、锁用户行、锁幂等行，在同事务内执行回调和保存响应。禁止把请求 Body 中的 userId 当作身份。普通 PUT/DELETE 同样必须在用户锁内执行。

HealthRepository 实现原样公共 HealthQueryPort；Nest 导出 token `HEALTH_QUERY_PORT`（值 `M02.HealthQueryPort`），也可在 M01 装配中直接提供 repository 实例。所有端口使用回调传入的 SqlTx，不各开连接。正式 PointsPort 由 M05 注入；M02 只传来源事件和记录 ID。

前端由 M01 的统一客户端调用 `installHealthRuntime`，模块自身不创建第二套生产登录或数据存储：

```ts
installHealthRuntime({
  request: unifiedApiRequest, // 返回 envelope.data，负责 Cookie/CSRF/幂等头
  invalidateHealth: unifiedInvalidateHealth,
  subscribeSession: onIdentityChanged, // 账号变更时通知订阅者，返回取消订阅函数
});
```

账号切换通知是必需接入项，用于丢弃旧请求结果、清空列表分页与失败操作状态。每次成功提交会调用统一失效入口并重新读取 M02 视图。M01 可以在同一失效入口刷新积分与其他模块缓存。

生产环境不会启用浏览器本地联调适配器；缺少前端统一客户端时显示明确的未接入状态。后端生产装配若未声明真实适配器会拒绝启动；联调入口在 NODE_ENV=production 下无条件拒绝运行。

## 与 M05 的组件交接

```tsx
<HealthProfilePanel open={open} onClose={closePanel} onSaved={refreshProfile} />
```

组件路径 `src/features/health/health-profile-panel.tsx`。由 M05 嵌入“我的”页，本组未修改 M05 的 profile.tsx。该页面目前仍有原始演示表单，M05 集成时应替换为本组件。

## 验证命令

```sh
python3 tools/check_m02_contract.py
npm run typecheck
npm test
npm run build
M02_DB_NAME=qingyang_m02_test_local_01 npm --prefix tools/m02-dev run test:mysql
npx playwright test --config tools/m02-dev/playwright.config.ts
```

测试库后缀请使用小写英文、数字或下划线；重复运行时将示例 `local_01` 改为新的后缀，确保每次 MySQL 验收使用新的空库，不重复套用 V001。

浏览器用例针对独立测试账号；重复运行前，可在明确的本地测试环境执行下列命令清理**仅这两个测试账号**的事实和奖励：

```sh
M02_TEST_ADAPTERS=1 tools/m02-dev/node_modules/.bin/tsx tools/m02-dev/reset-fixtures.ts
```

原 `tests/e2e/app.spec.ts` 中若干场景断言 localStorage、固定种子水量和旧大屏行为，已不适用于改造后的 M02。保留原文件供其他组追溯；本组使用专用配置运行真实 API 与 MySQL 用例，未将旧全站演示测试报为通过。

完整验收结果与剩余团队接入项见 HANDOFF.md。
