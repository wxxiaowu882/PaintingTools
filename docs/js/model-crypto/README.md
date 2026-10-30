# ModelCrypto（统一加解密包）

**唯一实现**：本目录。浏览器与 Node 共用 `ModelCrypto.js`（Web Crypto AES-256-GCM）。

业务口径：`docs/站点安全配置.md` §6～§8。

| 后缀 | 含义 |
|------|------|
| `.glb` | 明文 |
| `.png` | 密文假后缀（文件头魔数 `PTGL`，不是真 PNG） |

```bash
# 自测
node docs/js/model-crypto/selftest.mjs

# 加密 / 解密
node docs/js/model-crypto/cli.mjs encrypt path/to/model.glb
node docs/js/model-crypto/cli.mjs decrypt path/to/model.png
node docs/js/model-crypto/cli.mjs info path/to/file

# 第 4 步全量（先 --dry-run；加密带往返校验；JSON 仅改已有 PTGL 的路径）
node docs/js/model-crypto/batch-migrate.mjs --all --dry-run
node docs/js/model-crypto/batch-migrate.mjs --all
node docs/js/model-crypto/batch-rewrite-json-paths.mjs --from-disk --dry-run
node docs/js/model-crypto/batch-rewrite-json-paths.mjs --from-disk

# 明文备份到 历史备份文件/ 后再删 docs/m/*.glb（须已有对应 .png）
node docs/js/model-crypto/backup-then-delete-plain-glb.mjs --dry-run
node docs/js/model-crypto/backup-then-delete-plain-glb.mjs --stamp 2026-10-30
```

播放器 / 工具请：

```js
import { loadModelUrl, toGlbArrayBuffer, encryptGlb } from '/docs/js/model-crypto/ModelCrypto.js';
```
