# 会员权限（三档 · 轻耦合）

## 对外称呼

| 对外 | 对内 level / 策略 require | 说明 |
|------|---------------------------|------|
| **游客** | `guest` / `public`（兼容旧值 `free`） | 未登录 |
| **会员** | `user` / `user` | 已注册，未付费或付费已过期 |
| **高级会员** | `member` / `member` | 兑码有效期内（按时长：3 月 / 1 年 / 永久） |

业务上「谁开放给哪一档」最终以后台策略为准；仓库里带 `probe: true` 的条目仅技术验证。

## 两套东西，不要混

| 名称 | 文件 / 位置 | 改什么 |
|------|-------------|--------|
| **权益** | 兑换码 → 会话（档位 + 到期日）；注册账号默认 `user` | 谁买了多久 / 是否登录 |
| **策略** | `access-policy.json`（及运营台「收费设置」） | 哪个资源要哪一档 |

改收费场景 / 按钮 / 未来功能：**只改策略**，不要改 Solid 业务逻辑。

## 资源 ID 约定

- 场景（不手改权威 JSON）：`scene:{sandbox}:name:{场景显示名}`
- Solid 面板 Tab：`ui:solid:tab:{light|env|atmos|assist}`
- 以后新功能：`feature:{领域}:{名字}`，在策略里加一行即可

## 客户端

`docs/js/membership/MembershipAccess.js` → `window.MembershipAccess`  
插件：`plugins_02/Plugin_MembershipGate.js`（角标「会员免费」/「高级会员尊享」，包装 `switchScene` / `switchTab`）

## 页面

| 地址 | 作用 |
|------|------|
| `/member` | 权益说明（PC 宽版）+ 账号 + 兑换 |
| `/member-ops` | 发码、会员账号查询/重置密码、三档收费设置 |

忘记密码：用户微信联系 → 运营台「会员账号」人工重置（无短信自助）。

## API（节选）

| API | 作用 |
|-----|------|
| `POST /api/membership/redeem` | 验码 → 写 **HttpOnly 签名 Cookie**（`level: member`） |
| `GET /api/membership/me` | 读会话 + `accessLevel` |
| `GET /api/membership/catalog?sandbox=` | 按访问档过滤课表 |
| `GET /api/membership/scene?sandbox=&name=` | 进课全文（不够档返回 locked） |
| `POST /api/membership/account/register\|login` | 注册/登录（注册默认会员档） |
| `GET/POST /api/membership/admin/accounts` | 运营台查账号 / 重置密码 |

密钥：Cloudflare Secret `MEMBERSHIP_SECRET`（≥16 字符）  
生成正式码：`node docs/membership/gen-redeem-code.mjs`
