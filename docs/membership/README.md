# 会员权限（轻耦合）

## 两套东西，不要混

| 名称 | 文件 / 位置 | 改什么 |
|------|-------------|--------|
| **权益** | 兑换码 → 会话（档位 + 到期日） | 谁买了多久 |
| **策略** | `access-policy.json` | 哪个资源要会员 |

改收费场景 / 按钮 / 未来功能：**只改策略**（或以后后台改同一结构），不要改 Solid 业务逻辑。

## 资源 ID 约定

- 场景（不手改权威 JSON）：`scene:{sandbox}:name:{场景显示名}`  
  例：`scene:geometry:name:【光影基础规律】面转则明暗分，体积现`
- Solid 面板 Tab：`ui:solid:tab:{light|env|atmos|assist}`
- 以后新功能：`feature:{领域}:{名字}`，在策略里加一行即可

## 探针

当前 `probe: true` 的条目只为打通技术链路。业务正式清单另定后：改 `enabled` / `require`，或删探针条目。

## 客户端

`docs/js/membership/MembershipAccess.js` → `window.MembershipAccess`  
插件：`plugins_02/Plugin_MembershipGate.js`（包装 `switchScene` / `switchTab`，不侵入课内渲染）

## 兑换与安全

页面：`/member`（`member.html`）

| API | 作用 |
|-----|------|
| `POST /api/membership/redeem` | 验码 → 写 **HttpOnly 签名 Cookie** |
| `GET /api/membership/me` | 读会话 |
| `DELETE /api/membership/me` | 退出 |
| `GET /api/membership/catalog?sandbox=` | 按会话过滤课表 |
| `functions/docs/json/[[path]].js` | 拦截三大沙盒静态课表 URL，同样过滤 |

密钥：Cloudflare Pages Secret `MEMBERSHIP_SECRET`（≥16 字符）  
探针码：仅 `ALLOW_PROBE_CODES=1` 时可用  
生成正式码：`自用工具文件_不部署/membership/gen-redeem-code.mjs`

**生产环境**客户端不会在兑码失败时本地伪造会员；课表也不会回退到未过滤的公开全文。
