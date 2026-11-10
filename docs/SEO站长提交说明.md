# SEO 站长提交说明（操作清单）

面向站长本人：把「手绘工坊 · 童画师吴晓」提交给搜索引擎。代码侧的 title / description / sitemap / robots 已按主域对齐，**你只需要在各站长后台点提交**。

## 0. 先确认这些（不用改代码）

| 项 | 当前约定 |
|----|----------|
| 主站 | `https://www.wuxiaoart.com/`（现网无 www 会 301 到 www；canonical / sitemap 已对齐 www） |
| 站名 | **手绘工坊 · 童画师吴晓**（「视觉维度」仅作历史副称，不主推） |
| 首页口径（2026-11-01） | title/desc/keywords 主推 **儿童肖像画师 + 水彩人物教程** 等；关于弹层身份靠标签「儿童肖像画师 · 水彩 · 油画」，**勿**再叠「我专画儿童肖像（水彩）」类重复句 |
| URL 形态 | **无 `.html` 后缀**（如 `/GR`、`/Solid`、`/Portrait_c`） |
| Sitemap | `https://www.wuxiaoart.com/sitemap.xml` |
| Robots | `https://www.wuxiaoart.com/robots.txt` |
| 分享图 | `https://www.wuxiaoart.com/docs/img/wuxiao_s.jpg` |

线上部署后，用浏览器打开上面两个地址，确认能打开、内容是最新版。

---

## 1. 百度站长平台（优先）

1. 打开 [百度搜索资源平台](https://ziyuan.baidu.com/)，用百度账号登录。
2. **站点管理 → 添加网站**：填 `https://www.wuxiaoart.com`（与现网主域 / canonical 一致；若另有无 www 未验证条目，可忽略或以后再删）。
3. **验证归属**（任选其一，验证码到手后再写进页面，**不要用占位符**）：
   - **HTML 标签**：把官方给你的 `baidu-site-verification` 内容交给开发写入首页 `<head>`；或
   - **文件验证**：把验证文件放到站点根目录后点验证。
4. **站点属性（交资源前先看一眼）**：
   - **关联主体**：未关联时，普通收录「今日提交上限」常为 **0**，sitemap / API / 手动都会交不进去。可以后再试；**不等于**要办工信部备案。
   - **主体备案号**：页面会提示可抬配额。我们站挂 **Cloudflare 境外**，**不走 ICP 备案**（不是「不能备案」的口号，是部署形态不适合办）。配额暂时为 0 时，先靠蜘蛛自然抓取。
   - 站点类型建议改成 **自适应**（现网一套响应式，不是单独 PC 站）——低成本可做。
5. **普通收录 → sitemap**（todo，改天再试）：`https://www.wuxiaoart.com/sitemap.xml`  
   （可选再手动提 `/`、`/GR`、`/XStudio`、`/Solid`、`/Portrait_c`、`/Gallery`）
6. 过几天在「索引量 / 抓取异常」里看是否有报错（常见：旧域、带 `.html` 的重复 URL）。

---

## 2. 必应 Webmaster（Bing）

1. 打开 [Bing Webmaster Tools](https://www.bing.com/webmasters/)，登录。
2. 添加站点 `https://www.wuxiaoart.com`，验证方式任选：
   - **XML 文件**：根目录 `BingSiteAuth.xml`（已入库并上线）；或
   - **HTML Meta**：首页 `<meta name="msvalidate.01" …>`（已写入 `index.html`，验证后勿删）。
3. **Sitemaps → Submit sitemap**：`https://www.wuxiaoart.com/sitemap.xml`。

**进度（2026-11-01）**：www 已验证；sitemap 已提交，后台显示 **Submitted / Processing**（收录需等 Bing 抓取，属正常）。URL Submission 已交 9 条高优 URL。

---

## 2b. Google Search Console

1. 打开 [Google Search Console](https://search.google.com/search-console)，用 Google 账号登录。
2. **网址前缀**资源：`https://www.wuxiaoart.com/`（不必做 Domain + DNS）。
3. **验证归属**：HTML 元标记——首页已写入  
   `<meta name="google-site-verification" content="ecyHQny47Y28Yp6wd7e2LqMj3Zf95oTiAk8d_q4_P1s">`  
   （发正式站后再点「验证」；验证后勿删该 meta）。
4. **Sitemaps**：提交 `https://www.wuxiaoart.com/sitemap.xml`。

**进度（2026-11-01）**：www 已用 HTML 元标记验证通过；sitemap `https://www.wuxiaoart.com/sitemap.xml` 已提交，状态 **成功**（已发现 13 个网页）。验证后勿删首页 `google-site-verification` meta。

---

## 3. 提交后自检（5 分钟）

用无痕窗口或手机流量打开：

- [ ] 首页标题含「手绘工坊 · 童画师吴晓」
- [ ] 地址栏是无后缀形式（不是 `xxx.html`）
- [ ] 微信 / 小红书发链接时预览图能出来（OG 图地址可访问）
- [ ] 菜单「色阶分析 · 网格构图」能进到晓阶页

---

## 4. 不要做的事

- 不要在站长后台同时提交大量带 `.html` 与无后缀的重复 URL。
- 不要把 Backup、自用工具、`.cursor` 等目录主动提交收录。
- 不要堆砌关键词改正文；品牌词「童画师吴晓」+ 自然长尾即可。
- 验证码未到手之前，**不要**在页面里留 `code-xxxx` 一类占位 meta。

---

## 5. 和代码仓库的对应关系（备查）

| 文件 | 作用 |
|------|------|
| `sitemap.xml` | 规范 URL 列表 |
| `robots.txt` | 放行 / 禁止抓取路径 |
| 各关键页 `<head>` | title / description / canonical / OG |
| `docs/js/GlobalMenu.js` | 菜单文案与页脚站名 |

改完部署后，若站长后台提示「sitemap 无法访问」，先查 Cloudflare 是否已发布到最新，再查 `robots.txt` 是否误拦。

---

## 6. Cloudflare 与百度蜘蛛（已踩坑）

**现象（2026-11-01）**：开启 Cloudflare「Bot Preference Sync / Managed robots.txt」后，线上 `robots.txt` 被前置托管段，其中含：

```txt
User-agent: Baiduspider
Disallow: /
```

等于口头禁止百度抓全站（我们自己的 `robots.txt` 并没有这条）。

**现行口径（zone `wuxiaoart.com`）**

| 项 | 取值 | 说明 |
|----|------|------|
| Bot Fight Mode | 关 | 避免误伤搜索爬虫 |
| Managed robots.txt / Bot Preference Sync | **关** | 线上只出仓库根目录 `robots.txt` |
| Block AI bots（边缘拦截） | 开 | 仍拦 GPTBot 等训练向爬虫；**不**靠托管段禁百度 |
| 模型防盗链 WAF | 不变 | 仍只拦 `/docs/m/` 外站 Referer |

验收：打开 `https://www.wuxiaoart.com/robots.txt`，应**看不到** `Baiduspider` / `BEGIN Cloudflare Managed`。

---

## 7. AI / 协作备忘（水位 · 禁改 · 改进 · 定期检查）

给站长与 AI 同一口径。Cursor 规则镜像：`.cursor/rules/seo-memo.mdc`（`alwaysApply`）。原则变更：**先改本节再改代码/规则**。

### 7.1 我们现在做到什么程度（2026-11-01）

| 层 | 状态 | 说明 |
|----|------|------|
| 基础技术 SEO | **已完成并续修** | 主域 www、301、canonical、sitemap、robots、关键页 title/desc/OG；Solid/Portrait 按 sandbox·lib 同步 |
| 百度 | **大半完成** | www 已验证 + 自适应；sitemap **暂挂**（配额常 0，不办 ICP） |
| 必应 | **已完成首轮** | 验证 + sitemap + 9 条高优 URL；收录继续等抓取 |
| Google | **已完成首轮** | GSC 网址前缀验证 + sitemap 成功（约 13 URL） |
| Cloudflare 与蜘蛛 | **已踩坑并定口径** | Managed robots / Bot Preference Sync **保持关**；勿再禁 Baiduspider |
| 首页内容口径 | **已收紧一版** | title/desc/keywords：儿童肖像画师 + 水彩人物教程；关于弹层保持原口语（不强制 SEO 句） |
| 内容运营 SEO | **未做完** | 独立关于/课程说明长页、长尾页、站外回链——见路线图 §4.7 / §8 |

一句话：**「能被正确发现 + 三大站长已挂上」这一层已到位；「靠内容与外链养排名」还在后面。**

### 7.2 严禁改动（未征得站长同意不要动）

1. 首页验证用 meta / 根目录验证文件：`baidu-site-verification`、`msvalidate.01`、`google-site-verification`、`BingSiteAuth.xml`（验证后**勿删**）。
2. 对外主域与 URL 形态：`https://www.wuxiaoart.com/` + **无 `.html` 后缀**（sitemap / canonical / 站内链接一致）。
3. 站名主推「手绘工坊 · 童画师吴晓」；「视觉维度」不主推。
4. Cloudflare：**不要**打开 Managed robots.txt / Bot Preference Sync；Bot Fight Mode 保持关（细则 §6）。
5. 不要把 Backup、自用工具、`.cursor`、`/docs/json/`、`/docs/m/`、会员后台与 API 等送去收录（与 `robots.txt` 一致）。
6. 不要为抬百度配额默认去办 ICP；现行决定是**不办**。
7. 不要堆砌关键词改正文；验证码未到手不要写占位 meta。

### 7.2b 测站与正式站（重复收录）

- **要不要紧**：测站 `test.wuxiaoart.com` 与正式站内容常相似，但我们**从不**把 test 提交给站长，sitemap **不含** test → 一般不致命。
- **仍有小风险**：测站若允许蜘蛛抓，理论上可能被当成重复页。
- **现行做法（2026-11-01）**：测站 Worker 经 `functions/_middleware.js` —— `robots.txt` = `Disallow: /`，HTML 带 `X-Robots-Tag: noindex, nofollow`（及 meta）。**正式站不变。**
- **不要做**：把 test 加进百度/必应/GSC；不要把测站 URL 写进对外 sitemap。

### 7.3 可以改进 / 还没做完的

| 项 | 优先级 | 备注 |
|----|--------|------|
| 百度 sitemap 再试 | 中（等配额） | 后台「今日提交上限」>0 时再交 |
| 独立关于页 / 课程说明页 | 中高（产品） | 路线图已列；比再拧 meta 更有用 |
| 长尾内容页 + 小红书回链 | 中（运营） | 水彩大词不急攻 |
| 对外分享路径验证 | 中 | 路线图「待执行」 |
| 各关键页文案与首页口径对齐复查 | 低～中 | 避免工具页只剩「泛工具」表述 |
| Domain 级 GSC（DNS） | 低 | 当前网址前缀已够用 |

### 7.4 要定期 check 的

| 频率 | 看什么 | 怎么算正常 |
|------|--------|------------|
| **每次正式发版后** | 首页 title；`/robots.txt`；`/sitemap.xml` | 站名在；robots **无** Baiduspider 全站 Disallow / CF Managed 段；sitemap 为 www 无后缀 |
| **约每 1～2 周**（或口述「查 SEO」） | 百度索引量/抓取异常；必应与 GSC 的 sitemap 状态 | 无大面积 404/重复 `.html`；sitemap 仍成功或处理中 |
| **改过 CF Bot/安全相关后** | 立刻再看 `robots.txt` | 与 §6 现行口径一致 |
| **发测站后** | `https://test.wuxiaoart.com/robots.txt`；首页响应头 | 应为 `Disallow: /`；`X-Robots-Tag: noindex, nofollow`（与正式站不同属正常） |
| **改站名/主域/验证方式前** | 三方站长后台 + 本说明 | 先改文档与验证，再发版 |

### 7.5 仓库落点（改 SEO 时先搜这里）

| 路径 | 作用 |
|------|------|
| `index.html` | 首页 title/desc/keywords/验证 meta/关于弹层/SEO 隐藏区 |
| `sitemap.xml` / `robots.txt` | 抓取清单与禁抓路径 |
| `BingSiteAuth.xml` | 必应文件验证 |
| 各关键页 `<head>` | 分页 title/canonical/OG |
| `docs/js/GlobalMenu.js` | 菜单与页脚站名 |
| `.cursor/rules/seo-memo.mdc` | AI alwaysApply 镜像 |
| `docs/站点规划_访谈与路线图.md` §8 / §11 | 产品进度与关键词策略 |
