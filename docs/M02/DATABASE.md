# M02｜数据库结构与团队连接说明

契约 QY-MYSQL-1.1.0 / V004，MySQL 8.4、InnoDB、utf8mb4 / utf8mb4_0900_ai_ci。M02仅拥有以下三张业务表；统一数据库共44张业务表，另有schema_migrations。不存在单独的M02用户表或健康汇总事实表。

## 三表字段

| 表 | 字段与类型 | 约束及用途 |
| --- | --- | --- |
| health_profiles（14列） | id/user_id CHAR(36)；height_cm DECIMAL(4,1)；birth_year SMALLINT；target_weight_kg DECIMAL(4,1)；water_target_ml INT；calorie_target_kcal DECIMAL(6,1)；carbs_target_g/protein_target_g/fat_target_g DECIMAL(5,1)；goal_type VARCHAR(16)；version INT；created_at/updated_at DATETIME(3) | user_id唯一且外键关联users.id；身高、出生年份、营养目标可空；档案版本乐观锁；目标由用户设置 |
| water_records（10列） | id/user_id CHAR(36)；amount_ml INT；recorded_at DATETIME(3)；business_date DATE；timezone VARCHAR(64)；source VARCHAR(16)；deleted_at/created_at/updated_at DATETIME(3) | 外键users.id；amount_ml 1–1000；上海业务日；source=manual；deleted_at可空，非空为软删除 |
| weight_records（10列） | id/user_id CHAR(36)；weight_kg DECIMAL(4,1)；recorded_at DATETIME(3)；business_date DATE；timezone VARCHAR(64)；source VARCHAR(16)；deleted_at/created_at/updated_at DATETIME(3) | 外键users.id；weight_kg 20–350；上海业务日；source=manual；保留同日多次测量，软删除 |

两类记录均按 `(user_id,business_date,deleted_at,recorded_at DESC,id DESC)` 建索引。业务ID为小写UUID v4；数据库时间存UTC。每日6000ml累计上限、出生年份不能超过当前上海年份等动态规则在服务端校验，不能只依赖静态CHECK。

## 每人本地一库，整合环境另建一库

- 每名成员选择自己的开发库；团队整合环境使用另一独立库，不合并成员开发库数据、不复制成员账号或密码。
- 本仓库 `src/common/database.ts` 从服务端 `.env.local` 的 DB_HOST、DB_PORT、DB_NAME、DB_USER、DB_PASSWORD 读取连接；不硬编码其他成员库名。浏览器不直接访问MySQL。
- DB_MIGRATION_USER、DB_MIGRATION_PASSWORD 是单独迁移账号；应用账号仅需目标库 SELECT/INSERT/UPDATE/DELETE，迁移账号仅管理目标库结构。
- `.env.local` 已被Git忽略。真实密码、邮箱授权码、认证密钥、Cookie和数据库数据不提交；每个环境独立配置认证密钥。
- 队友拉取代码后连自己的开发/整合库。代码提交不会把数据库搬到GitHub，也不会让127.0.0.1自动指向其他成员的电脑。

## 初始化与升级

1. 管理员创建明确选择的空库，设置上述字符集及排序规则，并创建独立的应用/迁移账号。
2. 复制根目录 `.env.example` 为 `.env.local`，填写本环境DB连接、Redis、SMTP和认证密钥。
3. 全新空库：执行 `npm ci`、`npm run migrate`；也可按 [统一建表说明](../../db/releases/建表与升级说明.md) 选择完整安装SQL，两条方式只选一种。
4. 已有库：先核对实际结构和schema_migrations，再按统一升级说明处理；迁移工具会校验已应用版本的校验值。旧手机号用户/挑战不能自动当成邮箱账号迁移。
5. 启动API后查询 `/api/v1/meta/contract`，核对 QY-MYSQL-1.1.0、实际schemaVersion及V001校验值。迁移到V004的整合库应返回V004。

完整安装文件 [QY-MYSQL-1.1.0_full_install.sql](../../db/releases/QY-MYSQL-1.1.0_full_install.sql) 和 [SHA256SUMS.txt](../../db/releases/SHA256SUMS.txt) 由公共底座统一维护。已安装V001的库已有M02三表，不可再执行三表CREATE TABLE或全库安装文件；本次没有新增DDL，也没有改写V001–V004。

V001 SHA-256：`64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56`。

## 本机检查边界

2026-10-21，本机新工作区已完成独立整合库安装与迁移校验，原M02开发库保留；数据库与Redis已就绪，任务进程已启动。SMTP尚未提供，普通API启动被缺失SMTP_USER阻止，真实邮箱登录及本轮端到端流程未验收。这是本机状态，不代表队友或线上环境已部署。
