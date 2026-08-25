# Sketchfab 下载到规范化 — Agent 提示词

把本文件丢给 Agent（或 `@` 本文件）。**从 Sketchfab 链接（或列表页描述）到中文命名 GLB + 压缩 `_opt`，全程用仓库既有脚本**；Agent 负责解析任务、看图定朝向与中文名、调用命令、最后汇总汇报。

**不要**为下载 / 渲图 / 规范化 / 压缩重写业务代码。中间结果必须落盘，不要只写在聊天里。

用户这样发即可（把占位换成这次的真实信息）：

```
按《Sketchfab下载到规范化_Agent提示词.md》执行。

任务: （二选一或组合）
  A) 链接列表：（粘贴，或 @某 txt）
  B) 自然语言：去 Sketchfab 某某列表/收藏页，下载其中「……描述……」的模型

输出目录: E:/模型/某次任务文件夹
与 docs/model 不重名: 是
保留原英文 GLB: 是
压缩: 是（先体积优先，有问题再展示安全）
```

---

## 每次必填（只认当前这条用户消息）

| 项 | 说明 |
|---|---|
| **任务** | 链接列表和/或自然语言筛选条件；都没有则立刻问用户 |
| **输出目录 `{OUT}`** | 完整路径；不存在则创建；不要用聊天记录里「上次那个」 |
| **与 docs/model 不重名** | 默认 **是**；扫描仓库 `docs/model/**/*.glb` |
| **保留原英文 GLB** | 默认 **是**；规范化只新增中文名文件，不删英文导出 |
| **压缩** | 默认 **是**；见阶段 6 |

仓库根记为 `{REPO}`（本文件所在：`{REPO}/.cursor/browser-automation/`）。

---

## 这次要达成什么

对任务里**每一个** Sketchfab 模型：

1. 下载 GLB 到 `{OUT}`
2. 四向正视预览 → Agent **看图**选正脸朝向
3. 按正脸起中文名（前缀见 `quickNames.json`），与 `docs/model` **不重名**
4. 旋正 + 30cm + 底部中心对齐 → 导出中文 `.glb`（英文原文件保留）
5. **体积优先**压缩 → 渲染比对 → 有问题则用**展示安全**再压
6. 写 `{OUT}/pipeline-report.json`，用大白话向用户汇报

Sketchfab 刚下载的模型 **不走** `batch-rename` 重命名流程（那是「只改名、不改几何」）。本任务走 **`batch-normalize`**。

---

## 硬规则（违反就等于做错）

1. **禁止**重写或 fork 下载器、规范化、压缩核心逻辑；只调下面「脚本速查」里的命令。
2. **禁止**用 `batch-rename/gen-thumbs-cli.mjs` 的 3/4 角图给刚下载模型**起名**（未旋正）。
3. **禁止**用 `build-confirm-cli.mjs` 的结果当最终中文名（弱初猜，会大量 `其它_英文名`）。
4. **必须**先 4 张正视预览，Agent Read 看图，再写 `normalize-plan.json`（顺序见《GLB批量规范化_Agent提示词.md》）。
5. **必须**全量：用户要 N 个就处理 N 个，禁止只做一部分交差。
6. **压缩**只对 `normalize-report.json` 里 `ok: true` 的 **中文规范化 GLB** 逐文件执行；**禁止**对整个 `{OUT}` 文件夹盲压（会误压英文原文件）。
7. 体积优先 `_opt` 渲染比对 **FAIL** → **删除**该坏 `{名}_opt.glb` → 再跑展示安全；每个中文名最终只保留 **一份** 合格 `_opt`（或标记待人工）。
8. 命名、朝向、比对结论写入 `{OUT}` 下 json；汇报用大白话，少堆函数名。

---

## 依赖与环境

### Sketchfab 下载

```bash
cd "{REPO}/.cursor/browser-automation"
npm install
```

首次或无登录态：

```bash
npm run sketchfab:login
```

（在打开的 Chrome 里登录 Sketchfab，终端回车保存档案。档案目录：`chrome-profile-sketchfab/`，勿删。）

### 规范化（puppeteer）

```bash
cd "{REPO}/自用工具文件_不部署/GBL管理器/batch-rename"
npm install
```

### 压缩

需要 **Node.js**（`npx` 可用）。`compress-glb.ps1` 会拉取 `@gltf-transform/cli@4`（需网络）。

---

## 标准流程

输出目录记为 `{OUT}`。规范化的 `{DIR}` 与 `{OUT}` **相同**（下载与后续处理在同一文件夹）。

### 阶段 0 — 解析任务 → URL 列表

**0A — 用户给了链接列表**

- 去重、去空行、`#` 注释
- 写入 `{OUT}/sketchfab-urls.txt`（一行一个 URL 或 32 位 model id）
- 解析规则与 `sketchfab-batch-download.js` 的 `extractModelId` 一致

**0B — 用户给了自然语言（如「某收藏页里亚洲男性头模」）**

1. 用浏览器打开用户指定的 Sketchfab 列表 / 收藏 / 搜索结果页
2. 按描述筛选模型，收集详情页或 embed 可解析的 URL
3. 写入 `{OUT}/sketchfab-urls.txt`
4. 在 `{OUT}/task-meta.json` 记录：原始描述、列表页 URL、选中条数、每条 title（若能读到）

**0C — 断点**

- 列表为空 → 停下来问用户
- 无法访问列表页 / 筛不出模型 → 说明原因，给出已找到的 0 条或部分条

---

### 阶段 1 — Sketchfab 批量下载

```bash
cd "{REPO}/.cursor/browser-automation"
npm run sketchfab:batch -- --list "{OUT}/sketchfab-urls.txt" --out "{OUT}" --timeout 480000
```

单条链接时也可用：

```bash
npm run sketchfab:batch -- --url "https://sketchfab.com/3d-models/..." --out "{OUT}"
```

- 下载报告： `{OUT}/_batch_report_*.json`（取最新一份）
- 失败截图： `{REPO}/.cursor/browser-automation/runs/sketchfab-batch-*/`
- **下载失败**的条目：记入报告，`ok: false`，**不**进入阶段 2–6；继续下一个
- 串行下载，不要并行多个大模型

---

### 阶段 2 — 正视四向预览

工作目录：

```bash
cd "{REPO}/自用工具文件_不部署/GBL管理器/batch-normalize"
```

**逐步执行**《[GLB批量规范化_Agent提示词.md](../../自用工具文件_不部署/GBL管理器/batch-normalize/GLB批量规范化_Agent提示词.md)》**步骤 A**：

```bash
node gen-front-thumbs-cli.mjs "{OUT}"
```

- 输出：`{OUT}/_front_thumbs/*_r0.png` … `*_r3.png`，`front-preview-manifest.json`
- 侧躺 / 倒立时再跑 `gen-front-thumbs-cli.mjs "{OUT}" 1` 与 `3`，看 `_x1_` / `_x3_` 组

**必须**每个待处理 GLB 都有 4 张够大的正视预览后再进入阶段 3。

---

### 阶段 3 — Agent 看图 → normalize-plan.json

**逐步执行**《GLB批量规范化_Agent提示词.md》**步骤 B**：

1. 对每个 GLB，Read 其 `_r0` `_r1` `_r2` `_r3`（及需要的 `_x1_` / `_x3_`）
2. **先判是否桌面摆放静物**（静物台、几何组合、水果扫描等）：**桌面大平面必须朝上**。侧躺时先定 `rotXSteps`（常见 **3** = Glb 管理器 **X 逆转**；或 **1** = X 顺转），再选正脸 `rotYSteps`（0/1/2/3）
3. 按正脸内容起中文名：`{quickNames前缀}_{中文描述}[序号].glb`
   - 前缀表：`{REPO}/自用工具文件_不部署/GBL管理器/batch-rename/quickNames.json`
   - 命名例子见《GLB批量重命名_Agent提示词.md》第 2 节表格
4. 先**不要** finalize 去重；阶段 4 会校验

在 `{OUT}/normalize-plan.json` 写全量方案，例如：

```json
{
  "targetDir": "E:/模型/某次任务",
  "rules": { "targetHeightCm": 30, "keepOriginal": true, "autoRotateY": false },
  "items": [
    {
      "rel": "3D Head scan shader testing_V9.9.83_Ultimate.glb",
      "outName": "真人头像_男_青年_shader测试01.glb",
      "rotXSteps": 0,
      "rotYSteps": 2,
      "sketchfabId": "a93fd43dd1eb485eb8bcb9f5afae50d8"
    }
  ]
}
```

- `rel`：`walkGlb` 相对路径，正斜杠，必须与磁盘文件名**完全一致**
- `outName`：最终中文名，**不要** `_std.glb`；压缩后才是 `_opt.glb`
- **必须**写看图选定的 `rotYSteps`，不要留给启发式

---

### 阶段 4 — 与 docs/model 去重

1. 扫描 `{REPO}/docs/model/**/*.glb`，收集已有 basename（**大小写不敏感**）
2. 对 `normalize-plan.json` 每条 `outName`：
   - 与库内重名 → 改描述加 `01`/`02`，或后缀 `_YYYYMMDDhhmmss`（同目录逻辑可参考 `naming-utils.mjs` 的 `ensureUniquePerDir`）
   - 与 `{OUT}` 内已有中文 GLB 重名 → 同样处理
3. 更新 plan 后写 `{OUT}/dedup-log.json`（原 intent 名 → 最终 outName）
4. **去重完成后再跑 normalize**

默认 **不** 自动复制进 `docs/model`；产物留在 `{OUT}`，除非用户本条消息明确要求复制。

---

### 阶段 5 — 批量规范化导出

**逐步执行**《GLB批量规范化_Agent提示词.md》**步骤 C**：

```bash
cd "{REPO}/自用工具文件_不部署/GBL管理器/batch-normalize"
node normalize-cli.mjs "{OUT}"
```

- 输出：`{OUT}/normalize-report.json`
- 原英文 `.glb` **保留**
- 新文件：plan 里 `outName` 对应的中文 `.glb`
- `ok: false` 的条目进入最终汇报，**不**进入阶段 6

---

### 阶段 6 — 压缩与渲染比对

压缩**只**用 [`compress-glb.ps1`](../../自用工具文件_不部署/减面和压缩脚本/compress-glb.ps1)（与 Portal [`09b_压缩GLB_体积优先.bat`](../../自用工具文件_不部署/0_Portal/09b_压缩GLB_体积优先.bat) / [`09_压缩GLB_展示安全.bat`](../../自用工具文件_不部署/0_Portal/09_压缩GLB_展示安全.bat) 等价）。

**Agent 必须用 PowerShell 直接调 ps1**（bat 末尾有 `pause`，不适合自动化）。

脚本路径记为 `{COMPRESS_PS1}`：

`{REPO}/自用工具文件_不部署/减面和压缩脚本/compress-glb.ps1`

#### 6A — 体积优先（每个规范化成功的源 GLB）

对 `normalize-report.json` 中 `ok: true` 的每一项，取 `{OUT}/{outName}` 的**绝对路径**：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "{COMPRESS_PS1}" -Mode size "E:/模型/.../真人头像_男_青年01.glb"
```

- `-Mode size`：Draco 默认 + WebP，不减面、不 join
- 输出：同目录 `{stem}_opt.glb`
- 记录压缩前后字节数

#### 6B — 渲染比对（Agent Read）

1. 对 `{OUT}` 跑缩略图（压缩验收用 3/4 角即可）：

```bash
cd "{REPO}/自用工具文件_不部署/GBL管理器/batch-rename"
node gen-thumbs-cli.mjs "{OUT}"
```

2. 在 `{OUT}/_preview_thumbs/` 中，成对对比 **源中文 GLB** 与 **`_opt`** 的缩略图（同一模型、同一索引规则）
3. Agent Read 两张图，判定 **visualOk**

| FAIL（任一条） | 通常可接受 |
|----------------|------------|
| 破面、接缝炸开、缺块 | 体积明显变小 |
| 贴图花、大面积色块/斜纹 | 轻微锐度损失 |
| 网格塌陷、五官糊成一团 | — |
| 头扫：角膜变实心白壳 | — |

4. 写入 `{OUT}/compress-review.json`，每条例如：

```json
{
  "sourceGlb": "真人头像_男_青年01.glb",
  "optGlb": "真人头像_男_青年01_opt.glb",
  "sizeModeAttempted": "size",
  "bytesBefore": 120000000,
  "bytesAfter": 35000000,
  "visualOk": false,
  "issue": "鼻翼接缝破面",
  "fallback": "display"
}
```

#### 6C — 展示安全回退

对 `visualOk: false` 且尚未成功的条目：

1. **删除** 体积优先产生的坏 `{名}_opt.glb`
2. 对**同一源中文 GLB** 再跑：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "{COMPRESS_PS1}" -Mode display "E:/模型/.../真人头像_男_青年01.glb"
```

- `-Mode display`：WebP → Draco scene/16 sequential（更防破面）
3. 再跑 6B 比对；仍 FAIL → `needsManualReview: true`，**不**再留坏 `_opt`，保留未压缩中文 GLB

用户未要求压缩时，跳过阶段 6，在报告中注明。

---

### 阶段 7 — 总汇报

1. 合并写 `{OUT}/pipeline-report.json`（含 download / normalize / compress 各阶段）
2. 用**大白话**回复用户，建议包含：

| 块 | 内容 |
|---|---|
| 概况 | 任务来源、输出目录、共几个模型 |
| 下载 | 成功 / 失败数；失败 id + 原因 + 截图路径 |
| 规范化 | 中文文件名列表；normalize 失败项 |
| 去重 | 是否与 docs/model 冲突及如何改名 |
| 压缩 | 体积优先 OK 数；回退展示安全数；待人工数 |
| 交付物 | 最终推荐使用的 `{名}_opt.glb` 完整路径 |
| 保留 | 英文原 GLB 仍在 `{OUT}`，满意后可手动删 |
| 待办 | `needsManualReview` 条目与建议下一步 |

不要只贴 json；用户要能扫一眼看懂。

---

## 与相关文档的关系

| 场景 | 文档 |
|------|------|
| **本文件** | Sketchfab 链接 → 下载 → 规范 → 压缩 一条龙 |
| 已有 GLB、只规范+中文名 | [`GLB批量规范化_Agent提示词.md`](../../自用工具文件_不部署/GBL管理器/batch-normalize/GLB批量规范化_Agent提示词.md) |
| 已有 GLB、只改名 | [`GLB批量重命名_Agent提示词.md`](../../自用工具文件_不部署/GBL管理器/batch-rename/GLB批量重命名_Agent提示词.md) |
| 仅批量下载、不后续处理 | [`lists/README_sketchfab_batch.md`](lists/README_sketchfab_batch.md) |

---

## 脚本速查

| 命令 | 作用 |
|------|------|
| `npm run sketchfab:login` | Sketchfab 登录（`.cursor/browser-automation`） |
| `npm run sketchfab:batch -- --list "{OUT}/sketchfab-urls.txt" --out "{OUT}"` | 批量下载 |
| `node gen-front-thumbs-cli.mjs "{OUT}"` | 四向正视预览（batch-normalize） |
| `node normalize-cli.mjs "{OUT}"` | 按 plan 规范导出 |
| `node gen-thumbs-cli.mjs "{OUT}"` | 3/4 缩略图（压缩比对用，batch-rename） |
| `powershell ... compress-glb.ps1 -Mode size "..."` | 体积优先压缩 |
| `powershell ... compress-glb.ps1 -Mode display "..."` | 展示安全压缩 |

---

## 交付前自检

- [ ] `{OUT}/sketchfab-urls.txt` 与用户任务一致
- [ ] 下载报告已读；失败项已列入汇报
- [ ] 每个进入规范化的 GLB 有 4 张 `_front_thumbs` 正视图
- [ ] `normalize-plan.json` 全量、每条有看图选定的 `rotYSteps` 与中文 `outName`
- [ ] `dedup-log.json` 已处理与 `docs/model` 的重名
- [ ] `normalize-report.json` 成功项 `bytes` 远大于 0
- [ ] 压缩只对规范化成功的中文 GLB 执行，未误压英文原文件
- [ ] `compress-review.json` 每条有 visualOk；FAIL 已走展示安全或标记待人工
- [ ] 每个模型至多一份最终合格 `{名}_opt.glb`
- [ ] `pipeline-report.json` 已写；用户收到大白话汇总

---

## 常见排错

| 现象 | 处理 |
|------|------|
| embed 长期 `panel=false` | 查 `篡改猴Sketchfab.js` 语法；见 `README.md` 条目 11 |
| 贴图就绪无 download | 面板是否 `导出崩溃`（如 findTexIdx） |
| Chrome profile 被占用 | 关掉占用 `chrome-profile-sketchfab` 的 Chrome |
| 正视 preview 黑图 | 浅灰底；Draco 用本地 `GBL管理器/draco/` |
| compress npx 失败 | 确认 Node.js、网络；看 ps1 输出的 FAIL 行 |
| 列表页筛模型 | 无下载权 / 商店锁仍会失败，记入报告继续下一个 |
