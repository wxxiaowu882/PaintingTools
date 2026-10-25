# 童画师吴晓 · 安卓套壳（WebView）

桌面一点打开测试站 [https://test.wuxiaoart.com/](https://test.wuxiaoart.com/)（验收期）。  
**只加载线上站，APK 内不打包任何网页 / JS / 模型**；本目录在 `自用工具文件_不部署/`，**不会**进 Cloudflare 站点部署。

| 项 | 值 |
|----|-----|
| 桌面名 | 童画师吴晓 |
| 包名 | `com.wuxiaoart.workshop` |
| 最低安卓 | 7.0（API 24） |
| 分发 | 学员群侧载（不上应用商店） |
| 启动站 | **测试站** `https://test.wuxiaoart.com/`（`BuildConfig.START_URL`；正式包再改 `www`） |
| 资源是否进包 | **否**。壳 ≈ 空壳 WebView；JS/CSS/GLB 全部现网拉取，**站点内容更新不用换 APK** |
| 壳强制更新 | 启动读 `/docs/app/android-shell-update.json`；本机 versionCode 低于 `minVersionCode` 则拦进站并跳站点 APK 下载 |
| 当前可测包 | `dist/童画师吴晓-1.0.4-debug.apk`；发测试站时同步 `docs/app/wuxiao-workshop.apk` |
| 对外下载页 | 站点 `/docs/app/`（全局菜单「安卓 App 下载」；苹果说明在页内） |
| 1.0.1 | 修复：相册选图、Cookie、blob/data；描摹可申请摄像头 |
| 1.0.2 | 启动 URL 改为测试站 |
| 1.0.3 | 壳强制更新（仅壳版本，不逼内容更新） |
| 1.0.4 | 界面右下角显示壳版本；站点下载页与菜单入口 |

---

## 学员怎么装（侧载）

1. 用微信/网盘收到 `.apk` 后，用**系统文件管理**打开（不要指望在微信里当网页用）。
2. 若提示「未知来源 / 禁止安装」：到系统设置里允许该次安装来源。
3. 安装后桌面出现「童画师吴晓」，**需联网**才能用。
4. 若 3D 场景黑屏：到应用商店更新 **Android System WebView** 与 **Chrome** 后再试。

iPhone 不能装本 APK；请用 Safari 打开站点后「添加到主屏幕」（另说）。

---

## 开发者：本机构建

### 环境

- [Android Studio](https://developer.android.com/studio)（推荐，自带 SDK）或：JDK 17 + Android SDK（`platforms/android-35`、`build-tools/35.x`）
- 本机 `local.properties` 写 `sdk.dir=...`（可复制 `local.properties.example`）
- **路径含中文**：本仓库在 Windows 上需保留 `gradle.properties` 里的 `android.overridePathCheck=true`（已写好）

### 用 Android Studio

1. **Open** 本目录（含 `settings.gradle.kts` 的那一层）。
2. 等待 Gradle 同步。
3. 连真机或模拟器 → Run。
4. 打安装包：**Build → Build Bundle(s) / APK(s) → Build APK(s)**（debug 自测即可）。

### 命令行（有 SDK 时）

```bash
# Windows（Git Bash / CMD），需本机已装 JDK 17 + Android SDK 35
./gradlew.bat assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
# 亦可复制到 dist/童画师吴晓-1.0.0-debug.apk（APK 默认不入库）
```

Gradle 发行包默认走腾讯云镜像（见 `gradle/wrapper/gradle-wrapper.properties`）。

### 发给学员：release 签名（推荐）

1. 生成密钥（只做一次，**务必备份**，勿提交仓库）：

```bash
keytool -genkeypair -v -keystore release.keystore -alias wuxiao \
  -keyalg RSA -keysize 2048 -validity 10000
```

2. 复制 `keystore.properties.example` → `keystore.properties`，填入路径与密码。  
3. 构建：

```bash
./gradlew.bat assembleRelease
# 产物：app/build/outputs/apk/release/app-release.apk
```

4. 把 APK 拷到 `dist/` 或发群文件。**同一 keystore** 才能以后覆盖更新。

`*.jks` / `*.keystore` / `keystore.properties` / `*.apk` 已在 `.gitignore`。

---

## 行为说明

- 启动 URL：测试站 `https://test.wuxiaoart.com/`（`BuildConfig.START_URL`）
- **未**把 `docs/js`、页面 HTML、模型打进 APK；体积小，内容跟线上走
- **壳更新 vs 站更新**：改网页/场景 → 只发站；改壳 → 升 versionCode、打 APK、更新 `docs/app/` 的 json+apk 再发站
- 同域（`*.wuxiaoart.com`）留在壳内；外链 / 邮件 / 电话走系统浏览器或对应 App
- 返回键：站内有历史则后退，否则退出；强制更新弹窗时返回即退出
- 硬件加速开启，便于 WebGL（Three.js）

### 壳发版清单（强制更新）

1. `app/build.gradle.kts` 提高 `versionCode` / `versionName`
2. 打 APK → 复制为仓库 `docs/app/wuxiao-workshop.apk`（gitignore，发站上传）
3. 改 `docs/app/android-shell-update.json` 的 `minVersionCode` / `latestVersionCode` / `versionName`
4. Portal **先有 APK 再提高 minVersionCode**；测试站用 `20b`

配置拉失败时**放行进站**（避免 json 未上线时全员打不开）。上线并提高 `minVersionCode` 后，旧壳会被强制拦住。

---

## 已知限制

- **必须联网**；不是离线 App，也没有「内置全套 JS」
- 体验取决于手机系统 WebView 版本；过旧可能无法跑 ES Module / WebGL
- 国产杀软可能误报侧载包：群内说明「官方学员包」即可
- 本工程不改站点业务代码；测试站发版（Portal `20b`）后，壳打开即是新内容
