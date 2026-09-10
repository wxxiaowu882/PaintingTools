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
6. GLB 管理器历史文件夹：下拉切换、同名合并、删除；卡片「复制到」仅可复制到其它历史文件夹，同名冲突自动加时间戳。自测：`npm run selftest:glb-dir-switch`（需先 `serve:repo`）。
7. GLB 管理器「打开所在文件夹」：浏览器**故意不把盘符路径交给网页**（能读内容 ≠ 知道 `E:\...`）。有 18080 时「新文件夹」**只选一次系统目录**即记住路径；旧历史若缺路径，点打开会再绑一次。自测：`npm run selftest:glb-reveal`（隔离模式）。
7a. **GLB 管理器框选拆出**：高模（如 `head_parts_anatomy.glb`，50万+三角）禁止每帧/`setFromObject` 扫顶点；面数或连通块过多时整 mesh 当一件；优先包围盒投影选中；射线仅用于少数孤岛细分。自测：`npm run selftest:glb-box-select`（需 `serve:repo` + 本机 `E:/模型/五官下载/head_parts_anatomy.glb`，可用 `GLB_PATH` 覆盖）。
7b. **分色/平涂 GLB 预览天坑**：`updateViewerFromThree` 曾把「限制最高 1024」用线性缩小贴图，10 色会串成 2000+ 脏色 fleck；预览禁止 `maxTextureSize`。柔和光默认关阴影（低模面阴影像黑三角）。导出缩图用最近邻 `nearestResizeMapsForExport`。贴图 `NEAREST` + 关 mipmap。自测：`node scripts/skull-tex-manager-selftest.js`（`PORT`/`serve:repo` 指向仓库根，常见 `18080`）。
8. 肌肉标注换模（欧版 → 黄种人女 V8）：另存 `docs/json/结构_头骨骨点肌肉/03 肌肉详解_黄种人女V8.json`。先探测同索引是否真对应；若顶点已重排则改「旧世界坐标 → 新肌肉网格最近顶点」。Draco 用 `@gltf-transform/cli@4 copy` 解压。Playwright 对隐藏 `#file-input` 用 `state: 'attached'` 再 `setInputFiles`。自测：`npm run selftest:remap-muscle-v8`（需先 `serve:repo`）。
9. 换模后若「点在脸上但聚焦却转到后脑勺」：多半是 **法线反了**（双面网格拉到内侧）。用 `npm run fix:muscle-v8-visual` 在浏览器里按原档案法线对准观看侧、对热点重拾射线写回 `pos/norm`；再用 `node scripts/visual-qa-muscle-v8.js` 点击列表聚焦抽检。
10. 口周点位解剖纠偏：`node scripts/precise-repick-muscle-v8.js`（口轮匝肌锚点 + 手调偏移 + 近邻射线）；单点微调可用 `fix-dao-front.js` / `fix-dao-visual.js`。确认图务必用**正面**+斜视各一张，避免斜视投影误判高低。
11. **AI 视觉定点（优先）**：先 `vision-audit-all-points.js` 出 23 张聚焦图目视；再按看图结论用 `vision-retouch-critical.js` / 浏览器点选写回。点选后法线必须「朝向当时相机」（列表聚焦用 `atan2(nx,nz)` / `acos(ny)`），否则会从下巴底/后脑看。口周高度以正面图为准；偏好命中更大 `+z`，避免点到底面。产物：`03 肌肉详解_黄种人女V8.json`（不覆盖原 `03 肌肉详解.json`）。
12. **肌肉色块硬对齐（推荐最终）**：欧版与 V8 的 Deform **UV 岛共享**但配色不同、顶点索引不共享。正确做法：`uv-muscle-remap-v8-nongap.py`——原版点→最近 Deform 顶点取 UV→V8 同 UV 候选（左右各一）按原版左右选侧→避开灰缝/头皮色吸附到肌腹；再用 `fixed-view-muscle-qa.js` / `dual-muscle-qa.js` 固定视角验收（勿只靠列表法线聚焦）。须先 `@gltf-transform/cli@4 copy` 解压 GLB。

13. **肌肉快照手机取景对齐**：生产端参考框用**光学裁切**（不缩视口，框外模型仍可见）。`model-viewer` 竖屏会自动拉大 FOV，消费端 `applySnapshot` 用 FOV 锁把 `getFieldOfView` 拉回生产真实视角。验收：`PORT=18080 node scripts/mobile-frame-match-verify.js`。

14. **五官局部模表面点位标注**：入口是 `自用工具文件_不部署/模型标注生产工具.html`（坐标拾取系统 Pro），工具模式默认 `表面点位 [Alt+左击]`，档案在 `docs/json/结构_五官/`。流程：`facial-features-capture-views.js` 多视角截图 → 对照 `docs/美术知识库/五官造型规律.md` 只标模型上看得见的部位 → `facial-features-annotate.js`（`ONLY=eye` / `SKIP_SHOT=1`）按模型屏幕包围盒 uv 射线写 `pointsData`（`type:point`，`desc` 可空）。同路径反复 `setInputFiles` 可能不触发 change；验收截图优先**每场景新开 page**。鼻孔等凹陷部位要用仰视再拾，避免与鼻中隔叠点。

15. **五官点位微调**：先对照好大夫/系统解剖学等资料定「该落在脊/凹/缘哪一类」，再用 `facial-features-retouch.js` 重拾；关键偏差用 `facial-features-uvfix.js`（模型屏幕包围盒 uv，勿用画布中心像素，FOV 一变就漂）。鼻翼等侧壁要偏好更大 `+z`，避免点到后侧面。

16. **坐标拾取生产端面板（2026-09）**：右侧已拆「标注 / 场景」Tab（默认标注）；画面双击 `.HotspotAnnotation` 可改名；列表 ✖ 与 Delete/Backspace（非输入框）均先 `confirm` 再删。代码框/复制/导入/清空已移除，导出与工作区存盘直接走 `generateCode()`；隐藏 `#file-input` 仍保留供自动化 `setInputFiles`。

17. **头部肌肉色彩变更 · 笔刷筛孔**：石膏耳等多材质薄壳，背景纯白；只动命中网格或按顶点法线推，会在接缝/打穿处漏出规则白点。现行 build 起：同侧多网格+同位焊接、命中法线位移、壳厚限制减料。自测：`node scripts/ear-brush-sieve-qa.js`（服务 `8765`）。

18. **笔刷局部加密（已弃用路径）**：真网格加密易在未焊接耳模上撕成纱窗。
19. **笔刷临时 TPS 烘焙**：`sculpt-brush-20260908ag` 起，落笔临时控制点 + `fitTps`（与锚点拧形同原理）→ 烘焙 restPos；不进锚点列表、不加密。自测：`node scripts/ear-brush-warp-bake-qa.js`。

20. **五官综合场景（石膏全身头像）**：产物 `docs/json/结构_五官/05 五官综合讲解.json`（01–04 全部约 52 名，模型 `石膏头像_女中青年_05_opt_石膏白.glb`）。脚本：`facial-composite-*.js`（眼区优先 `eye-fast-uv.js` / `brow-uv.js`）。要点：耳取模型 **+x**；眼眉取模型 **右眼（x&lt;0）**；鼻口走中线；面点偏好更大 `+z`。Playwright **`page.evaluate` 禁止传入函数**。鼻–人中–唇珠：鼻底 ≥ 鼻中隔 &gt; 人中（沟）/人中脊 &gt; 唇珠。名册：`runs/_facial_inventory.json`。
    - **相机必须进临时 JSON 的 `camera` 字段**（加载档案会盖掉 JS 设的 orbit）；距离写死如 `0.30m`，**勿用 `auto`**（整脸取景易点到颊）；设完后 `jumpCameraToGoal()`。
    - **眼区推荐相机**：`orbit: '-18deg 88deg 0.30m'`，`target: '-0.032m 0.192m 0.068m'`，`fov: '16deg'`。探针（中线 u=0.48）：虹膜约 v0.40/y0.205；眉脊约 v0.22–0.28/y0.225–0.232；上睑约 v0.35–0.38。
    - **单点复核**：临时 JSON 只留 1 点；隐藏 DOM hotspot 不可靠。同页反复 `setInputFiles` 先 `input.value=''`。
    - **眉易过冲到额**：用屏幕 uv + 每点 `yMin/yMax` 分层，勿用过宽 y 带粗扫（多点会压成同一命中）。
    - **耳(+x) 侧视坑**：颊面高 `+z` 易冒充耳屏；纯侧视（≈88–100deg）强制 `z>0` 会点到颊。略偏正面（≈55deg）下耳软骨表面常为负 `z`，应用**高 u（耳块内）+ `x≥0.06`**，勿追高 z。耳轮可用高 x + 负 z 钉在 helix。侧视 AI 判读耳细部易不稳，关键点须结合几何与截图交叉确认。
    - **耳推荐相机**：`orbit: '55deg 88deg 0.24m'`，`target: '0.060m 0.155m 0.018m'`，`fov: '13deg'`（整耳入画）。脚本：`facial-composite-ear-sep.js` / `ear-oncart.js`。

21. **头部造型规律样板关标注（消费端 Solid）**：`sandbox=headform` 的 101/201/102/103…。消费端需 `window.__solidHost`（camera/sceneGroup/THREE）才能 `page.evaluate` 射线。统合只合并 `^\d+_.+\.json$`。自动化建议 URL 加 **`skipPerf=1`**；`switchScene` 后须等到 sceneGroup 有 mesh 再射线（否则拾取为空或截图空景）。射线步进宜粗（如 u+=0.004），过密会卡死 `page.evaluate`。
    - **验收硬性**：必须对截图做 **AI 视觉读图**，禁止只靠探针/命中日志宣称通过（见 `.cursor/rules/ai-vision-qa.mdc`）。
    - **侧前（101）**：主课**远端**颧颊起伏（眉弓/颧骨等）；勿标近侧耳颞。圆标凸青凹灰；名称写 `keyPoints`；剪影已清可不连虚线。
    - **正面（102）**：钉左缘「W」凸点；**凹点不凑数**（用户手改只留关键凹 A=角前切迹）。柔**正前光**方位角 **90**（0=左侧光，勿混）。
    - **大半侧（103）**：比侧前更侧、未到全侧（约 50–60°）；主课改为**额—鼻—唇—颏剪影线**（与 101 颧颊课区分）；命名须与落点一致（鼻头≠鼻根）。脚本：`headform-anno-103c.js` / `103d.js`。
    - **虚线**：非必须；若画则宜多点折线（勿用过疏 `kind:straight` 弦切进脸内）。
    - **光方位备忘**：Solid 预设 **90=正面光，0=左侧光，180=右侧光**。

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
11b. **自动化 Chrome 必须能加载篡改猴**：Playwright 默认 `--disable-extensions`，会让 `chrome-profile-sketchfab` 里看不到篡改猴。`sketchfab-batch-download.js` 须 `ignoreDefaultArgs: ['--disable-extensions']` 并用 `--load-extension` 挂上扩展；脚本库可从本机 Chrome「Profile 1」同步 `Extensions/dhdgffkk…` + `Local Extension Settings/dhdgffkk…`。有扩展时优先走扩展内脚本，不再二次注入。
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
