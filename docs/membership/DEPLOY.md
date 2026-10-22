# 会员模块部署清单

## 1. Cloudflare Pages 密钥

项目 `soft-voice-f822`（或当前 Pages 项目）→ Settings → Environment variables / Secrets：

| 名称 | 必填 | 说明 |
|------|------|------|
| `MEMBERSHIP_SECRET` | 是 | ≥16 字符，签名 Cookie 与 `WXM1` 兑换码 |
| `ALLOW_PROBE_CODES` | 否 | 设为 `1` 才允许 `PROBE-*`；生产不要开 |

可选：创建 KV namespace，绑定名 `MEMBERSHIP_KV`（一码一用）。

## 2. 发版

仍用仓库根目录：

```bat
docs\deploy.bat
```

或：

```bash
npx wrangler pages deploy . --project-name=soft-voice-f822
```

确认部署产物含 `functions/`（redeem / me / catalog / `docs/json/[[path]].js` 课表拦截）。

## 3. 本地带 Functions 调试

```bash
npx wrangler pages dev . --binding MEMBERSHIP_SECRET=dev-only-wuxiao-membership-change-me --binding ALLOW_PROBE_CODES=1
```

（具体 flag 以当前 wrangler 版本文档为准；也可用 Dashboard 的 Preview。）

## 4. 验收

1. 访客打开 `/Solid?sandbox=geometry`：探针场景无完整 items，点进引导兑换  
2. 未带 Cookie 请求课表静态 URL：响应带 `X-Membership-Catalog: filtered`（或经 API 过滤）  
3. `/member` 兑正式码或（仅允许时）探针码 → `/me` 显示会员  
4. 伪造 localStorage 会员态：刷新后以 Cookie/`/me` 为准；无签名 Cookie 时课表仍过滤  
5. 到期后自动变访客
