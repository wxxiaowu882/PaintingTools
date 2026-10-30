---
name: site-prod-deploy
description: >-
  将本站发到 Cloudflare 测站或正式站：权限同步口径、Portal/bat 入口、
  发版前后检查与冒烟。用户说发版、上线、deploy、Portal 20/20b 时使用。
---

# 站点发版（测站 / 正式）

## 环境对照

| | 测站 | 正式 |
|--|------|------|
| Portal | `20b_站点发版_测试环境.bat` | `20_站点发版.bat` |
| 脚本 | `docs/deploy-staging.bat` | `docs/deploy.bat` |
| 域名 | `https://test.wuxiaoart.com` | `https://wuxiaoart.com`（www 会跳转） |
| Worker | `soft-voice-f822-staging` | `soft-voice-f822` |
| 权限 KV | 独立；发测站**禁止**覆盖 `policy_live` | 发正式前从测站同步（见下） |

业务说明：`docs/membership/DEPLOY.md`。

## 整体版本号（首页右下角）

- 格式：`V{壳戳}.{站戳}`，例 `V1021B.1029A`（点前=壳，点后=站）
- 站戳文件：`docs/site-version.json` 的 `webStamp`；正式 `deploy.bat` 会跑 `docs/site-version-bump.mjs`（北京日 MMDD + A/B/C）
- 壳戳：`BuildConfig.BUILD_STAMP`（发 APK 时手改）；并写入 `docs/app/android-shell-update.json` 的 `buildStamp`
- 显示位置：首页头像「关于」弹窗底部（**不要**右下角角标）
- 浏览器只显示站戳；App 显示完整 `V壳.站`
- 跳过涨站戳：`SKIP_SITE_VERSION_BUMP=1`

## 权限同步（正式发版默认）


**口径**：测站涂色/定价是验收源；正式发版推到正式；测站没有记录则跳过、不阻断。

1. 跑 `node docs/membership/sync-policy-staging-to-prod.mjs`（`deploy.bat` 第 0 步已含）。
2. 同步 `policy_live` → `access-policy.json` + 正式 KV；有则再同步 `tiers_live` → `tiers.json` + 正式 KV。
3. 紧急不改权限：`SKIP_POLICY_SYNC=1`。
4. **禁止**用仓库底稿整表 `kv put` 盖测站。

Windows 注意：sync 脚本经 `cmd.exe /c npx …` 调 wrangler（直接 `spawnSync('npx')` / `npx.cmd` 易 ENOENT/EINVAL，中文仓库路径尤甚）。

## Agent 标准流程

### A. 只发测站

1. `DEPLOY_NOPAUSE=1 cmd //c "docs\\deploy-staging.bat"`（或 Portal 20b）。
2. 冒烟：`SMOKE_BASE=https://test.wuxiaoart.com node docs/membership/prod-deploy-smoke.mjs`。
3. 汇报：版本/域名、冒烟结果；**勿**写测站 policy。

### B. 发正式（默认）

1. 确认业务要带上测站权限（默认要）。不要则 `SKIP_POLICY_SYNC=1`。
2. `DEPLOY_NOPAUSE=1 cmd //c "docs\\deploy.bat"`（含 **preflight** → sync → build → `wrangler deploy --env=""` → smoke）。
3. preflight 失败：缺 Secret → Portal「23」设口令；探针仍开 → 运营台关掉测试假码。紧急跳过用 `SKIP_PREFLIGHT=1`（须向用户说明风险）。
4. 若 sync 失败：先 `npx wrangler whoami`，再单独跑 sync 看日志；**不要**默认跳过同步除非用户要紧急只发代码。
5. 冒烟已挂在 bat 末步；失败视为发版未完成，根据日志排查（上传可能已成功）。
6. 汇报：preflight、是否同步了 policy/tiers、冒烟是否通过、正式 URL。

### C. 发版前后核对（脚本已覆盖时可略人手）

- **前**：Secrets 有名无值泄露；探针兑换被拒  
- **后**：`GET/HEAD` `/`、`/Solid` → 200；防内嵌头；`/api/membership/public-config`；探针仍关
- **安全账本**：`docs/站点安全配置.md`（模型防盗链在 CF 面板 WAF，勿写入 Worker）

## 已知坑（先查这里）

| 现象 | 处理 |
|------|------|
| sync「读取测站失败」且无输出 | 旧 bug（`npx` ENOENT）；确认已用当前 sync 脚本 |
| sync「测站尚无 policy_live，跳过」 | 正常；正式权限不动 |
| `wrangler deploy` 多环境警告 | 正式必须 `--env=""`；测站 `--env staging` |
| 超大 glb / 自用工具上传失败 | 已在 `.assetsignore`；勿删忽略项 |
| 发版日志/脚本被当成站点文件 | `docs/last-deploy*.log`、`deploy*.bat`、membership 同步/预检/冒烟 `.mjs` 与 DEPLOY 说明已入 `.assetsignore` |
| preflight 报缺 Secret | Portal `23_设置会员口令.bat` 写入正式站两个 Secret |
| preflight / smoke 报探针仍可兑 | 运营台关掉测试假码；确认未设 `ALLOW_PROBE_CODES=1` |

## 不要做的

- 不要用 `wrangler pages deploy` 抢同名项目。
- 不要在发测站时 `kv put` 测站 `policy_live`。
- 不要把 Secret / 运营口令写进仓库或 skill。
- 不要为「顺手」升级 wrangler 大版本（稳定性优先）。

## 与模式 1

发版属运维闭环：主 Agent 可直接跑 bat；验收以冒烟脚本 + 必要时打开正式 Solid 为准。
