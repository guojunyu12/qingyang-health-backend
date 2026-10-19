# M01 交付与整合说明

2026-10-19，契约 QY-MYSQL-1.1.0，Schema V004。

## 本轮功能

- 邮箱验证码注册/登录、受限发送与错码次数、受保护的邮箱存储、H5 Cookie、CSRF、访问过期刷新、刷新凭据重放撤销、退出。
- 真实账号摘要、昵称/头像编辑、管理员检查及审计；后台禁用端口可撤销目标用户全部会话。
- 本地私有图片上传签名、上传完成、异步格式/字节数/SHA256/解码/像素校验、去EXIF、独立WebP安全副本、授权短签名和引用保护删除。
- 站内通知分页/已读、可信内部通知意图接口、外部能力查询及订阅禁用；Web Push/App Push按用户决定待配置，订阅创建明确503，不创建假订阅或假投递。
- 同连接SqlTx与UnitOfWork、用户锁顺序、多用户排序锁、只读一致性快照、幂等租约/恢复/结果原子提交、Outbox至少一次派发及媒体Worker恢复。
- 公共端口实现、17个HTTP接口说明、V001/V002/V003/V004迁移、完整与M01专属建表SQL。

## 启动

根项目先运行 `python3 scripts/local-infra.py start`（本机开发工具），启动MySQL3307、Redis6380。后端独立仓库：

```sh
npm ci
# 按.env.example在本机填写.env.local；包含邮箱、数据库和随机密钥
npm run migrate
npm run dev
# 另一终端，必须与API共用同一配置、数据库和私有磁盘
npm run worker
```

前端根目录 `npm ci && npm run dev`，默认代理到127.0.0.1:3002；生产/其他机器使用服务端API_INTERNAL_URL配置代理目标。前端不加载后端秘密。

现有本地库已由44表结构比对登记V001并升级V004。新成员/线上新空库见 `db/releases/建表与升级说明.md`。后端入口位于 `src/main.ts`，额外资源路由 `src/resources.ts`，公共端口 `src/common/ports.ts`，Worker `src/worker.ts`。

## 公共端口

- `unitOfWorkPort` 严格输出共享SqlTx，不向模块暴露commit；普通业务使用runForUser/runForUsers。
- `outboxPort` 校验注册payload并复用调用方事务。队列名按数据库隔离；消费者从outbox ID重读数据库，不信任队列payload身份。
- `mediaPort` 校验用途/归属/角色/ready后只签安全副本。public_display属于可信模块入口，调用模块必须先验证内容发布或用户可见性，不能直接映射HTTP入参。
- M05在应用装配时注册 `modulePorts.points`，开户复用同一SqlTx。未注册不造假积分；production启动会拒绝缺失该端口。
- M04/M05注册自己的业务事件消费者与通知意图核验，M01提供通知持久化/投递租约能力，不伪造它们的业务状态。未接入的业务队列保留，不按任意payload发通知。

## 已知整合/上线前置

- Web Push及App Push由用户明确延期；当前站内通知真实可用，外部投递适配器只经过注入适配器测试，不表示用户实际收到推送。
- 视频/HEIC解码转码未配置，接口明确拒绝；首轮可用媒体类型为JPEG/PNG/WebP。
- 开发环境通过Next代理时IP是loopback，共享保守限额；正式入口必须覆盖X-Real-IP并注入私有X-QY-Proxy-Token，后端仅信任loopback来源加匹配秘密。不得直接信任客户端X-Forwarded-For。production缺少可信代理配置拒绝启动。
- 生产APP_ORIGIN必须HTTPS；数据库、Redis、媒体磁盘需备份、访问隔离与持久化。默认只监听127.0.0.1，需按实际网络拓扑配置可信反向代理。
- 登录/刷新使用绑定请求标识与内容摘要的30秒专用加密重试结果，与认证事实同事务保存；不会写入普通幂等响应。超过窗口或使用不同请求标识重放旧刷新凭据会撤销会话。
- 本地界面中的饮食、训练、积分等仍为演示数据，并已按账号隔离；不会冒充已接M02–M06数据库。
- 原1.0.0工作包作为历史快照保留。邮箱差异以CR-email-identity.md、新OpenAPI及schema_manifest为准；未宣称完整上游check_contract.py通过。

## 验证记录

真实MySQL/Redis集成测试覆盖验证码状态、并发消费、身份复用、刷新重放、HTTP Cookie/CSRF、资料编辑、私有图片、跨用户拒绝、被引用资源删除、幂等回滚及恢复、站内通知、注入投递及Outbox。前端覆盖登录错误保留、资料编辑、退出和原业务演示回归。

真实SMTP由163发送到用户授权的测试邮箱，已通过授权邮箱工具确认收件，并完成浏览器登录与刷新恢复。测试脚本初次退出断言因登录URL附带returnTo查询参数而超时，实际已退出；该断言已按实际路由语义修正。秘密与验证码不入库。

尚未把本次分支部署到线上，也未修改线上数据库。线上原演示版不包含本次真实认证。

最终验证：后端18项测试全部通过（包含独立Worker）；前端14项单元测试、9项浏览器测试通过；双方构建与类型检查通过。最终真实邮箱→登录→昵称及头像编辑→独立Worker安全校验→刷新恢复→退出已通过。独立审查最后一轮无P1/P2遗留。

前端缓存失效入口 `src/lib/api/cache.ts` 提供setCacheUser、invalidateHealth(date)、invalidatePoints及订阅；当前API为no-store，业务组接入查询缓存时复用此边界，退出/切换账号会失效用户缓存上下文。
