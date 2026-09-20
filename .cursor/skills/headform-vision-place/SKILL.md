---
name: headform-vision-place
description: >-
  Places headform landmarks on a new GLB by semantic understanding + AI vision
  in the browser — not by copying UV/localPos from 大本. Use for 光头亚裔 / 第三套
  headform, or any contrast model where mechanical remap fails.
---

# Headform 视觉定点（语义 → 候选 → AI 读图 → 落面 → 复检）

## 原则

1. **禁止**把大本/女05 的 `localPos` / UV 当权威迁到新模（肩宽、头宽不同会偷肩、偷耳）。
2. **每个点**先读：大本同槽 `keyPoints` + `docs/美术知识库/头部造型规律之解析/` 对应概念 → 形成「应落 / 禁落」。
3. **候选**只在新模当前相机画面上按语义采样（脚本生成编号黄点；**绿点=语义分推荐**）：
   - **颅顶点** `apexHighest`：近中线扫 **max localY**（禁止误用左缘）
   - **脑颅侧方最宽点**：允许略负 z，带内 **最宽（最负 x）**；头型可略偏前/偏后
   - 颧弓：`ignoreEar` 在初扫与二分细化都生效，只留前脸左缘
4. **择优**必须 **Read 打开 PNG**；优先核对绿点是否符合应落，再 `MODE=place`。
5. **验收**再截带标注图，Read 核对；不过则改 U/V 重 place。探针 hit 不算通过。

## 已知坑（已修）

- 旧版 `side:leftish` **未实现**，颅顶点被采成顶弧左缘 → 现改 `apexHighest`
- 顶结节 `z<-0.03` 过严会丢掉「顶骨外侧最宽」真点
- `ignoreEar` 曾只在初扫生效、二分会漏回耳后

## 命令（需 `serve:repo` → 18080）

```bash
cd .cursor/browser-automation

# 大本同槽参照（理解用）
MODE=teachshot SLOT=V02 LANDMARK=_ node scripts/headform-vision-place.js

# 新模干净图
MODE=clean SLOT=V02 LANDMARK=_ node scripts/headform-vision-place.js

# 某点语义候选（1–6 / A）
MODE=propose SLOT=V02 LANDMARK=2 node scripts/headform-vision-place.js

# AI 读图选编号后落面（U V 来自 propose_*.json）
MODE=place SLOT=V02 LANDMARK=2 U=0.41 V=0.33 node scripts/headform-vision-place.js

# 整槽验收
MODE=verify SLOT=V02 LANDMARK=_ node scripts/headform-vision-place.js
```

## 批量

```bash
# 外轮廓全槽（一页内推荐落点+去重）
ALL_V=1 node scripts/headform-vision-auto-slot.js

# 交界槽
SLOTS=L05,L01,L09,L02,L03,L06,L08,L04,L07 node scripts/headform-vision-auto-slot.js

# 单点/整槽补钉（去重）
SLOT=V04 ONLY=8 node scripts/headform-vision-fix.js
SLOT=V01 node scripts/headform-vision-fix.js
```

语义卡：`headform-vision-cards.js`（V01–V07 + L01–L09）。

## 与肌肉视觉链路的关系

肌肉关已有 `vision-audit` → `vision-retouch`（固定视角点选）。本 skill 把同一思路接到 **Solid headform 消费端**：候选由语义 band 在新模上生成，Agent 用 Cursor Read 做 VLM，不依赖人工最终拧点。

## 验收

走 skill `annotation-vision-qa`；通过后删无用过程图，保留 teach / propose 择优 / verify 终图。
