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
```

在 HitPay Dashboard → Developers → Webhooks 新建 webhook：

`https://csabbxiijzghooppayae.supabase.co/functions/v1/hitpay-webhook`

订阅 `charge.created` 和 `charge.updated` 事件。API Key 和 Salt 只放在 Supabase Secrets，不要放进前端或 Git 仓库。
