# 安卓壳 · 站点侧更新与下载

给 **WebView 空壳 APK** 用，**不是**给网页业务发版用。

| 文件 | 作用 |
|------|------|
| `index.html` | 对外下载说明页（菜单「安卓 App 下载」→ `/docs/app/`；含微信引导） |
| `android-shell-update.json` | 壳读这个；`apkPath` 建议 `/api/android-apk`（带 attachment） |
| `wuxiao-workshop.apk` | **正式壳**（包名 `com.wuxiaoart.workshop`，桌面「手绘工坊」；**勿强求入库**，发站时上传） |
| `wuxiao-workshop-staging.apk` | **测站壳**（包名 `….workshop.staging`，桌面「手绘工坊·测」；可与正式壳同机并存；发测站时上传） |
| `/api/android-apk` | Worker 下载接口；**按域名分流**（测站域名 → staging 包，正式 → prod 包） |
| `verify-apk-channels.mjs` | 发版前校验两套 APK 包名未搞反（`deploy-staging.bat` / `deploy.bat` 已挂） |

对外口径：安卓可装 App；**苹果暂无 App，用 Safari 网页版**。

壳改动时版本号由 Agent **自动**升（见 `.cursor/rules/android-webview-shell.mdc`），勿手改漏同步。

## 防再发：测站下载盖掉正式 App

曾踩坑：测站主下载发了正式包（同包名），安装后覆盖桌面「手绘工坊」。

硬性口径：

1. **两套包名必须不同**：正式 `com.wuxiaoart.workshop`；测站 `….workshop.staging`（桌面「手绘工坊·测」）。
2. **文件不得拷反**：`wuxiao-workshop.apk` = prod flavor；`wuxiao-workshop-staging.apk` = staging flavor。拷完用 aapt / `node docs/app/verify-apk-channels.mjs` 看 `package: name=`。
3. **API 按域名分流**：`functions/api/android-apk.js` — `test.wuxiaoart.com` 只吐 staging 文件；正式站只吐 prod。禁止再改回「永远读正式文件」。
4. **发版门槛**：`deploy-staging.bat` / `deploy.bat` 在上传前跑 `verify-apk-channels.mjs`，包名不对直接失败。紧急跳过：`SKIP_APK_CHANNEL_CHECK=1`（须向用户说明风险）。
5. **Agent 拷贝清单**（打完 APK 后）：
   - `app-prod-*-debug.apk` → `docs/app/wuxiao-workshop.apk` + `dist/…正式…`
   - `app-staging-*-debug.apk` → `docs/app/wuxiao-workshop-staging.apk` + `dist/…测…`
   - **禁止**把 prod 拷到 `*-staging.apk`，也禁止只更新正式文件却让测站主按钮仍指向它。

## 和「网站更新」的关系

- **改网页 / 场景 / JS**：Portal 发站即可，用户**不用**换 APK。
- **改壳（图标、选图、强制更新逻辑、启动域名等）**：升 `versionCode` → 打对应渠道 APK → 覆盖正确路径 → json 里 **`minVersionCode` 与 `latestVersionCode` 都改成新 versionCode** → 发站。旧壳打开会被拦住并跳下载。
- **没有「可选更新」弹窗**：壳代码只认 `versionCode < minVersionCode`。只抬 `latest`、不抬 `min` = 用户感知「没提示更新」（曾踩坑）。
- **强制更新下载（1.0.28+）**：壳内直下 APK 再调系统安装，**不**再 `ACTION_VIEW` 打开 Chrome，避免浏览器「文件可能有害」拦截。网页下载页仍可走 `/api/android-apk`（浏览器侧载仍可能被 Chrome 提示，与壳内更新无关）。

## 发版注意

1. 先上传 **新 APK**，再改 json 提高 `minVersionCode`（避免用户点下载还是旧包）；默认同一次发版两者一起上。
2. 测试站：`https://test.wuxiaoart.com/docs/app/android-shell-update.json`
3. 正式站同路径；壳的 `START_URL` 决定读哪套域名（测站抬 min **不**影响正式壳）。
4. 下载页**对访客不提**测站/并存；测站与正式站界面文案一致，包由 `/api/android-apk` 按域名静默分流。
5. 壳发版闭环见 `.cursor/rules/android-webview-shell.mdc`（升版本 → 打 APK → 拷对文件 → min=latest → 发站 → 核验）。
