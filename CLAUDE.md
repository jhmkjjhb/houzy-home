# HOUZY HOME OMS — 项目说明书

> 本文件给 AI 助手(Claude Code)看,帮助快速理解本项目。
> 由 Claude 于 2026-05-15 首次通读代码后生成。内容如与代码冲突,以代码为准。

## 一、这是什么项目

**HOUZY HOME 公司内部的「订单全流程管理系统」(OMS)。**

它**不是**对外卖货的 Shopify 商城(那是另一个独立项目 `my-shopify`,两套系统数据不互通)。
本系统是公司内部的"总调度台":一张订单从下单 → 付款 → 派给工厂 → 生产 → 发货 →
物流 → 上门安装 → 客户签收 → 售后,全程在这里跟踪。

- **线上域名**:`houzyhome.com`(见 `CNAME`,挂在 GitHub Pages 上托管)
- **GitHub 仓库**:https://github.com/jhmkjjhb/houzy-home
- **公司**:合屋整装科技有限公司 / HOUZY HOME SDN. BHD.(马来西亚柔佛新山)

## 二、技术架构(简版)

- **前端**:纯静态 HTML 网页(无构建工具、无框架,直接写 HTML + 原生 JS + Tailwind CDN)。
- **后端**:Supabase(托管 Postgres 数据库 + Auth + 存储)。
  - 项目:`https://csabbxiijzghooppayae.supabase.co`
  - 前端通过 `@supabase/supabase-js` 的 `createClient(SB_URL, SB_KEY)` 直连。
  - `SB_URL` / `SB_KEY`(anon key)**硬编码在每个 HTML 文件的 `<script>` 里**。
- **数据库定义**:`supabase/schema.sql` 是主结构,需在 Supabase Dashboard → SQL Editor 里手动跑。
- **安全模型**:全靠 Postgres **RLS(行级安全策略)**做权限隔离,前端不可信。

> ⚠️ **已知安全隐患**:anon key 暴露在前端源码中(纯静态站点的固有特性)。
> RLS 能挡住绝大多数滥用,但任何改动都必须确认 **没有绕过或削弱 RLS 策略**。
> 改 `schema.sql` 或加新表时,务必同步加 `ENABLE ROW LEVEL SECURITY` + 对应 policy。

## 三、文件地图

```
index.html                         公司官网门面(品牌/套餐/预约,5 语言 i18n)
CNAME                              自定义域名 = houzyhome.com
portal/
  login.html                       登录 + 注册申请(店员/厂家/物流/仓库分类填表,待管理员审批)
  staff.html        ★最核心★      店员/管理层后台:建单、订单列表、派单、进度、报表、质保
  supplier.html                    厂家门户:接单/拒单、报生产进度、完工、发货、打印任务单
  logistics.html                   物流门户:管"已发货→运输中→已送达"
  warehouse.html                   仓库系统:库存、入库、出库、流水、SKU、二维码
  customer.html                    顾客查单:手机号查询、时间轴、电子签收、WhatsApp
  product-lookup.html              产品信息查询
  diag.html                        "补件单诊断"内部排查小工具
  registrations_migration.sql      注册申请表 registrations 的建表 + RLS
supabase/
  schema.sql           ★主结构★    所有核心表 + 函数 + 触发器 + RLS(先读这个)
  *_migration.sql                  历次增量改造脚本(系统是边用边迭代的,见下)
  fix-rls.sql                      RLS 修复脚本
  relink_orphan_supplements.sql    一次性数据清洗(补件单关联修复)
```

## 四、数据库结构(schema.sql 摘要)

核心表:
- `stores` 门店(001 Austin / 002 Singapore;`region` 用于区域经理隔离)
- `profiles` 用户档案(关联 Supabase `auth.users`,带 `role` + `store_id` + `region`)
- `customers` 客户(可无账号)、`referrers` 推荐人、`suppliers` 厂家(分 tier 1/2/3)
- `orders` 订单(主表)、`order_logs` 进度日志(带图片 JSONB)、`order_sequences` 单号流水
- `registrations` 注册审批表(见 `portal/registrations_migration.sql`)

关键函数(均 `SECURITY DEFINER`):
- `generate_order_no(store_code)` → 生成单号 `001-20260422-0001`(吉隆坡时区,每店每日重置)
- `get_orders_by_phone` / `get_order_timeline` → 顾客免登录查单(用手机号校验归属)
- `get_my_profile`、`handle_new_user`(注册自动建 profile 触发器)、`auth_user_level()`(算权限级别)
- `customer_submit_signature` → 顾客电子签收(校验手机号,见 `add_sign_image_migration.sql`)

## 五、角色与权限分级

`auth_user_level()` 把角色映射为数字级别,RLS 按级别隔离数据:

| 角色 | 级别 | 能见范围 |
|---|---|---|
| customer 顾客 | 0 | 仅自己的订单(手机号校验) |
| staff 店员 | 1 | 仅本门店 |
| store_manager 店长 | 2 | 仅本门店 |
| regional_manager 区域经理 | 3 | 本区域所有门店 |
| general_manager / admin | 4 | 全局(可删订单、改 profile) |
| superadmin | 5 | 最高 |
| supplier 厂家 | 0(特例) | 仅派给自己的订单 |
| logistics 物流 | 0(特例) | 仅 shipped/in_transit/arrived 状态订单 |

supplier / logistics 虽 level=0,但有**专门的 RLS policy** 放行其业务范围,改权限时别忽略这些特例 policy。

## 六、订单生命周期(14 状态)

```
pending_payment 待付款 → paid 已付款 → assigned 已派单 → accepted 工厂接单
→ in_production 生产中 → production_complete 生产完成 → shipped 已发货
→ in_transit 运输中 → arrived 已送达 → installing 安装中
→ completed 完成 → after_sales 售后 → closed 关闭   (cancelled 已取消)
```

进阶概念:
- **补件单**:`parent_order_id` 关联原单;描述格式 `补件单 — 关联原单 <原单号>`
- **责任划分**:`liability_party`(supplier/store/shared)+ `loss_amount`
- **质保提醒**:staff.html 内有质保计算/提醒逻辑
- **电子签收**:`sign_image`,顾客在 installing 状态时签

## 七、改动须知 / 约定

1. **先读 `supabase/schema.sql`** 再动数据库;新增表必开 RLS + 写 policy。
2. 数据库改动走**新的 `*_migration.sql` 文件**(可重复安全执行,用 `IF NOT EXISTS`),
   不要直接重写 schema.sql 历史(参考已有 migration 的写法)。
3. 前端是无框架原生 HTML/JS,**沿用现有写法**(原生 DOM、Tailwind class、文件内 `<script>`),
   不要引入构建工具或框架。
4. 多语言:`index.html` 用 `data-i18n` 属性做 5 语言(en/zh-CN/zh-TW/ms/th);
   portal 部分页面用 `localization` 切换。改文案注意同步多语言。
5. 不要把任何**真实密钥/service_role key** 写进前端或提交进仓库。
6. 改完后一般需 `git push` 到 GitHub,GitHub Pages 才会更新线上 `houzyhome.com`
   (是否推送、何时推送,**先问用户确认**)。

## 八、与用户的协作原则(重要)

业务负责人(老板)**不懂代码**,沟通全程用**中文 + 大白话**:
- 每个操作前先解释"要做什么、为什么、做完啥效果",**等用户确认("好/可以/继续")再执行**。
- **一次只做一件事**,一条消息只让用户做一个动作。
- 技术术语要翻译:API/数据库/RLS 等都用生活化比喻说。
- 任何有风险的改动**先备份**(本地副本 + 已有 GitHub 云端)。
- 操作失败时用大白话说原因 + 给 2-3 个选项,不要直接贴报错。

## 九、本地路径

- 工作副本:`/Users/xieting/Desktop/houzy-home`
- 备份:`/Users/xieting/Desktop/houzy-home-backup-20260515`
- 关联但独立的 Shopify 项目:`/Users/xieting/Desktop/my-shopify`
