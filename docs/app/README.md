# 安卓壳 · 站点侧更新与下载

给 **WebView 空壳 APK** 用，**不是**给网页业务发版用。

| 文件 | 作用 |
|------|------|
| `index.html` | 对外下载说明页（菜单「安卓 App 下载」→ `/docs/app/`；含微信引导） |
| `android-shell-update.json` | 壳读这个；`apkPath` 建议 `/api/android-apk`（带 attachment） |
| `wuxiao-workshop.apk` | 实际文件（**勿强求入库**，发测试/正式站时上传） |
| `/api/android-apk` | Worker 下载接口，手机浏览器更好触发「下载」 |

对外口径：安卓可装 App；**苹果暂无 App，用 Safari 网页版**。

壳改动时版本号由 Agent **自动**升（见 `.cursor/rules/android-webview-shell.mdc`），勿手改漏同步。

## 和「网站更新」的关系

- **改网页 / 场景 / JS**：Portal 发站即可，用户**不用**换 APK。
- **改壳（选图、强制更新逻辑、启动域名等）**：升 `versionCode` → 打新 APK → 覆盖 `wuxiao-workshop.apk` → 把 json 里的 `minVersionCode` / `latestVersionCode` 写成新号 → 发站。旧壳打开会被拦住并跳下载。

## 发版注意

1. 先上传 **新 APK**，再改 json 提高 `minVersionCode`（避免用户点下载还是旧包）。
2. 测试站：`https://test.wuxiaoart.com/docs/app/android-shell-update.json`
3. 正式站同路径；壳的 `START_URL` 决定读哪套域名。
