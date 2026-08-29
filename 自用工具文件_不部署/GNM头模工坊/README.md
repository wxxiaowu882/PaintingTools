# GNM 头模工坊（生产端 V1）

自用生产工具：基于 **Google GNM Head** 完整基底调参，导出带参数的压缩 GLB，供 [GLB 管理器](../GBL管理器/Glb管理器.html) 与其它场景生产页使用。

**不是学员课表页。**

## 功能

- 完整身份（253）/ 表情（383）/ 姿态参数；右侧 Tab：骨相 / 表情 / 姿态 / 显示 / 全部
- 常用骨相默认约 20 项（可配置）；张嘴等在「表情」Tab（下脸 PCA 配方，正向=张嘴）
- 身份/表情预设在**左侧竖栏**（身份 / 表情 双 Tab + 滚动），带真实头像缩略图
- 主视口用 ResizeObserver 同步画布缓冲与显示比例，避免头模被拉伸变形
- Tembrica 式滑条（指针捕获）：拖出侧栏 / 进入 3D 区不断档；单项重置；拖动中不重建列表
- 导入带 `asset.extras.paintingtools.gnmHead` 的 GLB → 还原参数继续调；已修改项**就地标黄**（不置顶、不从列表移除）
- 身份库含 **Tembrica Face Maker 内置 Shape 1–6**（前 30 身份维，其余补零）+ 工坊实测改名采样
- 导出三档（课用·轻 / 课用·标准 / 制作·完整）+ 可选 Draco（复用 GLB 管理器本地引擎）
- **导出尺度**：高度固定约 **30cm**，**底部中心对齐**原点（与 GLB 管理器约定一致）；extras 记 `heightCm` / `align`
- 预览光为简单摄影棚光，**不写入 GLB**
- **对齐叠显**：[align-overlay/](./align-overlay/) — 欧版肌肉头按 Farkas 关键点对齐到 GNM 中性头，同视口叠显、分控透明度（便于下一轮改点位）

## 准备基底

```bash
cd 自用工具文件_不部署/GNM头模工坊
node scripts/prepare-gnm-assets.mjs
```

将下载约 34MB 的 `data/gnm/gnm_head_web.bin`（GNMW 全维 int8 基底，Apache-2.0）。该文件已 gitignore。

## 打开方式

在仓库根目录起本地静态服务（勿用 SPA 回退），例如：

```bash
npx --yes serve -p 8765 .
```

浏览器打开：

`http://localhost:8765/自用工具文件_不部署/GNM头模工坊/`

对齐叠显页：

`http://localhost:8765/自用工具文件_不部署/GNM头模工坊/align-overlay/`

若用 Live Server（如 5500），从工坊顶栏点 **「对齐叠显」**，或打开：

`…/GNM头模工坊/align-overlay/index.html`

（需已准备 `data/gnm/gnm_head_web.bin`；欧版肌肉为 `align-overlay/assets/euro_muscle.glb`，内容等同 `参考用_欧洲人头部肌肉_20260324204416_opt.glb`，见 `assets/SOURCE.txt`。）

浏览器自测：

```bash
cd .cursor/browser-automation
npm run serve:repo
# 另开终端
BASE_URL=http://127.0.0.1:18080 npm run smoke:gnm-align-overlay
```

离线重算对齐报告：

```bash
node scripts/bake-align-euro-gnm.mjs
```

写出 `align-overlay/data/align_euro_to_gnm_v1.json`。

## 与 GLB 管理器

导出的 `.glb` 可直接放入管理器监视的文件夹。管理器无需解析 extras；本工坊回炉时会读取内嵌配置。

## 许可

见 [NOTICE](./NOTICE)。评估器改编自 google/xrblocks 的 `GNMModel.js`。
