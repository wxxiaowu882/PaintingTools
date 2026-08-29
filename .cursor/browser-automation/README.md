# 浏览器自动化经验库

## 这套目录是做什么的

- 这里专门放我们在本项目里做浏览器自动化时的经验、脚本、输出物和任务模板。
- 目标是三件事：少踩坑、少污染项目目录、让新对话也能快速进入正确流程。

## 目录约定

- `package.json`：本地自动化依赖与常用命令入口。
- `scripts/`：可复用脚本。
- `templates/`：给新任务复用的任务描述模板。
- `runs/`：临时截图、运行产物，只作过程证据，不进版本库。

## 已验证经验

1. 打开仓库页面时，优先使用本地 HTTP 服务，不要直接走 `file://`。
2. Solid 生产端加载慢，默认先等 `#scene-loader` 消失，再留 1 到 2 秒缓冲。
3. 在 `Solid_Portrait_Create.html` 里，标注工具用原生 `#tool-mode-select` 切换，不要误判成自定义下拉。
4. 经典引出线的正确动作是 `Alt+Shift+拖拽`，不是单击。
5. 每个关键节点都截图到 `runs/`，任务结束后只保留有价值的最终证据，其余即时清理。

## 新对话怎么直接用

如果你开一个新对话，希望我直接按这套经验做，可以直接这样下达任务：

`请按 .cursor/browser-automation/README.md 的流程，在 Solid 生产端做一个浏览器自动化任务：<你的目标>`

更口语一点也行，比如：

`请按浏览器自动化经验库来做，打开 Solid 生产端，帮我们加一个球体并打标注。`

## 推荐工作流

1. 先启动本地静态服务：`npm run serve:repo`
   - 这一步是为了在自动化脚本里稳定访问页面（避免 `file://` 初始化问题）。
2. 执行脚本：`npm run smoke:solid-create`
2. 再执行针对任务的脚本，或基于模板写新脚本。
3. 截图和过程文件统一落到 `runs/<时间戳>-<任务名>/`
4. 汇报结果后，清理无价值临时文件。

## 当前可直接复用的脚本

- `npm run smoke:solid-create`
  - 打开 Solid 生产端
  - 新建测试场景
  - 添加内置球体
  - 添加一条测试标注
  - 输出截图到 `runs/`

- `BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-smoke.js`
  - compare_review「骨相拧形」：加载欧版、Farkas 控制点、颧宽滑条、Reset、回到并排 2D
  - 前提：`compare_review/serve_nocache.py` 已在 8765

- `BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-pick-hard.js`
  - 选肌硬测：flood-fill 连通域点选、贴图像素改色、恢复、鼠标选肌按钮
  - 须全部 ✓ 再交付用户验收

- `BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-hsl.js`
  - 整肌色相选区 + 色相/饱和度/明度（Ctrl+U 式）；保留明暗；隔离自测
  - 须全部 ✓ 再交付用户验收

- `BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-hsl-scopes.js`
  - 灰肌选区覆盖 + HSL 三态（全部 / 所有肌肉 / 选定）作用域对比与清除独立性
  - 须全部 ✓ 再交付用户验收

- `BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-bone-mottle.js`
  - 头骨偏白不变；颈背中灰可调；灰区无彩虹斑驳
  - 须全部 ✓ 再交付用户验收

- `BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-bone-vs-gray.js`
  - 对照用户场景（H=-55/S=19）：中灰 162 变色、Static 奶油颅骨不变、Deform 浅冷灰（帽状腱膜）可变
  - 须全部 ✓ 再交付用户验收

- `BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-visual-hsl.js`
  - 视觉验收：所有肌肉 H=-85/S=25/L=-30；PNG 取样 + 射线；颅骨奶油不变、颈前变色、Skiedras/Deform 绿与冷灰可变
  - 须全部 ✓ 再交付用户验收

- `BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-pick-smooth.js`
- `BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-semantic-parts.js` — 语义色块整部件选中 + HSL
- `BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-plastyma-sheet.js` — 颈阔肌整层纤维灰选中 + HSL
  - 滑块顺滑（rAF + live 缓冲）；耳/颈/背整块选肌可点可调；截图 `01-ear` / `02-neck` / `03-back`
  - 须全部 ✓ 再交付用户验收

- `BASE_URL=http://127.0.0.1:18080 node scripts/gnm-workshop-ux-smoke.js`
  - GNM 头模工坊：加载、253/383 能力条、**眼球分层（虹膜/巩膜）**、预设、滑条拖进视口、单项重置、导出 30cm extras

- `BASE_URL=http://127.0.0.1:18080 npm run smoke:gnm-align-overlay`
  - GNM × 欧版对齐叠显：加载、黑斑门禁、**眼球 ROI**、路标编辑

- `BASE_URL=http://127.0.0.1:18080 npm run smoke:gnm-bake-pack`
  - 烘焙包全流程：叠显导出 → 工坊加载 → 滑条驱动肌肉变形 → 导出欧版肌肉 GLB

- `BASE_URL=http://127.0.0.1:18080 npm run smoke:gnm-workshop`
  - 同 `gnm-workshop-ux-smoke.js`（工坊 UX 冒烟）

### 环境变量（可选）

- `BASE_URL`
  - 若你使用的是自己已经在跑的 `liveserver`，把 `BASE_URL` 指向它即可（例如 `http://127.0.0.1:5500`）。

## GLB 批量规范化（刚下载、朝向乱）

走 `自用工具文件_不部署/GBL管理器/batch-normalize/`，**不要**先用未旋正的 3/4 缩略图起名。

1. 每个模型先出 4 张正视预览（躺着的再试 X 轴 90°/270° 扶正）
2. 看清正脸后再写中文名和朝向
3. 再导出：30cm + 底部对齐 + 中文文件名
4. 原英文文件保留，用户抽查后再手动删

详细步骤见 `GLB批量规范化_Agent提示词.md`。

## 清理规则

- 不要再把 `pw_*.js`、`test_*.png` 散落到仓库别处。
- 无价值调试图、失败试错脚本、重复截图，任务结束后立刻删。
- 需要留档时，只保留“最终成功图”和“少量关键过程图”。

## Sketchfab 头扫 / Matcap 模型（经验）

1. Matcap 贴图走 `/i/models/{id}/matcaps`，不在 `/textures`；脚本须单独合并。
2. Headless 有多个 canvas：选**面积最大**的；建议 `--use-gl=angle --ignore-gpu-blocklist`。
3. 不要用 DOM 里是否残留 “Loading 3D model” 判断就绪（文字常不消失）；用全页截图的文件大小/方差更稳。
4. CDN `Colour` 斜纹时：**不要**把 Colour 当照片 albedo；强模糊作空间染色 + Spec 低频明暗 + `MeshMatcapMaterial(skin_soft)`。Matcap 勿烘进 albedo。
5. 近隐眼球层无 UV：用法线平均朝向建球面 UV；程序化虹膜要暗、小 catchlight；Phong 高 `shininess`/`emissive` 会把虹膜洗成白/青板。
6. 离线 patch 会抽出 `_spec_src`/`_colour_src`（数十 MB），重建后务必删；`runs/` 只留 slim、对照图、必要贴图。
7. `获取模型方法,md` 的「API 材质树 / OSG 指针」解决的是**通道绑定**，不是斜纹 Diffuse 变照片。
8. **对照必须以 `Glb管理器.html` 截图为准**，不要用 `preview.html` 自测页当验收。Matcap 直出预览若不加灯：皮肤 Matcap 仍正常，但 `sfEyeball` Phong 会整球黑死——预览场景需补 Hemisphere + Directional。
9. **PBR 路线**：`PBR_Preview` 去掉皮肤 `sfMatcap` 后仍可能只剩 `sfEyeball`。管理器不得因「仅有眼球 extras」就进 Matcap 直出（否则摄影棚/曝光无效）。大 GLB（~186MB）解析超时须 ≥180s；Agent 用 base64 注入会撑爆页面，改走本机 HTTP 拉 ArrayBuffer。
10. **a4s / Anatomy Next**：列表页标 downloadable ≠ 篡改猴一定能导出；若 embed 里长期 `panel=false`，优先查篡改猴脚本是否语法错误（批量注入勿再包外层 IIFE）。Chrome profile 被占用时会报「用户数据目录已在使用中」，先关掉占用该 profile 的 Chrome。
11. **批量下载假失败**：`panel=false` 且全程无 mesh，多半是 `篡改猴Sketchfab.js` 语法错误导致注入崩溃（Console 可见 `Unexpected token`）。`panel=true`、贴图就绪但无 download 事件，看面板是否 `导出崩溃`（如 `findTexIdx before initialization` = 函数声明顺序问题）。
12. **Anatomy Next 色块头肌图（colourcoded / Static）**：勿对 `Static` 走头扫「斜纹 Diffuse→Colour低频+Spec+Matcap」抢救。线上露出颧骨等是象牙/浅灰骨；误抢救会变成粉肤 `synth_albedo`+`skin_soft`。v9.9.85：`Static` 禁用 Matcap，骨色用 `Static_diffuse × Tekstura` 合成；对照用 Sketchfab embed + `Glb管理器` 截图（`scripts/compare-colourcoded-bone.js`）。

## Sketchfab → GLB 批量下载（可复用）

### 推荐：网页按钮操作

双击本目录下的 `启动_Sketchfab批量下载.bat` 即可（会自动打开浏览器）。

或手动：

```bash
cd .cursor/browser-automation
npm run sketchfab:ui
```

浏览器打开 `http://127.0.0.1:18999/`：在页面里贴链接、点登录/开始/停止，进度和日志都在页上看。

详见 `lists/README_sketchfab_batch.md`。

### 命令行（可选）

```bash
npm run sketchfab:login
npm run sketchfab:batch -- --list lists/sketchfab-urls.txt
```

默认输出：`E:\模型\0820模型下载`。持久登录档案：`chrome-profile-sketchfab/`（不进 git）。

## Sketchfab 一条龙（Agent）

从链接列表（或自然语言描述列表页）→ 批量下载 → Agent 看图定朝向与中文名 → 30cm 规范 → 体积优先压缩 / 展示安全回退 → 汇报。

在 Cursor 新对话中 `@Sketchfab下载到规范化_Agent提示词.md`，并写上任务与输出目录即可。Agent **只调既有脚本**，不重写下载/规范/压缩逻辑。

详细步骤见 [`Sketchfab下载到规范化_Agent提示词.md`](Sketchfab下载到规范化_Agent提示词.md)。规范化子流程见 `自用工具文件_不部署/GBL管理器/batch-normalize/GLB批量规范化_Agent提示词.md`。
