# SEO 站长提交说明（操作清单）

面向站长本人：把「手绘工坊 · 童画师吴晓」提交给搜索引擎。代码侧的 title / description / sitemap / robots 已按主域对齐，**你只需要在各站长后台点提交**。

## 0. 先确认这些（不用改代码）

| 项 | 当前约定 |
|----|----------|
| 主站 | `https://www.wuxiaoart.com/` |
| 站名 | **手绘工坊 · 童画师吴晓**（「视觉维度」仅作历史副称，不主推） |
| URL 形态 | **无 `.html` 后缀**（如 `/GR`、`/Solid`、`/Portrait_c`） |
| Sitemap | `https://www.wuxiaoart.com/sitemap.xml` |
| Robots | `https://www.wuxiaoart.com/robots.txt` |
| 分享图 | `https://www.wuxiaoart.com/docs/img/wuxiao_s.jpg` |

线上部署后，用浏览器打开上面两个地址，确认能打开、内容是最新版。

---

## 1. 百度站长平台（优先）

1. 打开 [百度搜索资源平台](https://ziyuan.baidu.com/)，用百度账号登录。
2. **站点管理 → 添加网站**：填 `https://www.wuxiaoart.com`（建议带 `www`，与 canonical 一致）。
3. **验证归属**（任选其一，验证码到手后再写进页面，**不要用占位符**）：
   - **HTML 标签**：把官方给你的 `baidu-site-verification` 内容交给开发写入首页 `<head>`；或
   - **文件验证**：把验证文件放到站点根目录后点验证。
4. **数据引入 → 链接提交**：
   - 提交 sitemap：`https://www.wuxiaoart.com/sitemap.xml`
   - （可选）手动提交几条高优 URL：`/`、`/GR`、`/XStudio`、`/Solid`、`/Portrait_c`、`/Gallery`
5. 过几天在「索引量 / 抓取异常」里看是否有报错（常见：旧域、带 `.html` 的重复 URL）。

---

## 2. 必应 Webmaster（Bing）

1. 打开 [Bing Webmaster Tools](https://www.bing.com/webmasters/)，登录。
2. 添加站点 `https://www.wuxiaoart.com`，按提示验证（可与百度同用文件或 meta）。
3. **Sitemaps → 提交** `https://www.wuxiaoart.com/sitemap.xml`。

（若你已用 Google Search Console，同样添加站点并提交同一 sitemap；国内流量以百度为主即可。）

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
