# HOUZY 后台 HitPay 接入

后台开单系统是 GitHub Pages 静态页面，不能把 HitPay 密钥放进 `portal/staff.html`。本次接入使用 Supabase Edge Functions：员工在订单详情点击“生成付款链接”，Edge Function 用密钥创建 HitPay hosted checkout，付款完成后由 webhook 自动把订单标记为已付款。

## 一次性部署

在项目根目录执行：

```sh
supabase login
supabase link --project-ref csabbxiijzghooppayae
supabase db push --include-all
supabase secrets set HITPAY_API_KEY='HitPay API Key' HITPAY_SALT='HitPay Salt' HOUZY_PUBLIC_URL='https://houzyhome.com'
supabase functions deploy hitpay-payment
supabase functions deploy hitpay-webhook --no-verify-jwt
supabase functions deploy hitpay-customer-payment --no-verify-jwt
```

在 HitPay Dashboard → Developers → Webhooks 新建 webhook：

`https://csabbxiijzghooppayae.supabase.co/functions/v1/hitpay-webhook`

订阅 `charge.created` 和 `charge.updated` 事件。API Key 和 Salt 只放在 Supabase Secrets，不要放进前端或 Git 仓库。

## 付款规则（2026-11）

- 员工和客户共用同一条链接，每一期一条。金额由服务器按当前这一期计算，页面不能指定金额。
- 收到付款后核对金额，写入 `order_payments`。金额对不上不计入，`hitpay_status` 变为 `review`，等店长核对。
- 订单进度只会从“待付款”变为“已付款”，不会让后面的阶段倒退。
- 只支持马币（MYR）订单。
- 上线顺序：先跑 `supabase/order_payment_links_migration.sql`，再部署三个付款程序，最后推送页面。

## 订单失效，付款也失效（2026-11）

- 待付款且从未收款的订单，链接带 `expiry_date`，和订单同时在建单 24 小时后到期；超过 24 小时立即不能再付款，不等每小时一次的自动取消任务。
- 员工取消订单、金额修改等情况，由 `hitpay-close-links`（每 15 分钟）到 HitPay 删除旧链接。
- 已开始付款的分期单不受 24 小时限制。
- 链接关闭前，旧的 15 天清理不会删除订单，避免迟到的付款找不到订单。
- 部署：先跑 `supabase/order_payment_links_expiry_migration.sql`，再执行 `supabase functions deploy hitpay-close-links --no-verify-jwt`，并重新部署 `hitpay-payment` 和 `hitpay-customer-payment`。

