---
name: annotation-vision-qa
description: >-
  Runs AI vision acceptance for 3D scene annotations (callouts, dashed outlines,
  key points, light-boundary / headform lessons). Use when verifying Solid
  sandbox annotations, headform 外轮廓/交界线, Portrait production labels, or
  when claiming annotation placement is correct. Never pass on probe/ray logs alone.
---

# 标注 / 场景 AI 视觉验收

## 硬规则

1. **对错以画面为准**：必须截图并用 Read **打开 PNG 读图**。
2. **禁止**仅凭 UV 探针、射线命中、脚本 exit 0、JSON 已写入宣称通过。
3. 细则见 `.cursor/rules/ai-vision-qa.mdc`。

## 流程

1. 用本地 HTTP 打开目标页（勿 `file://`）。起服务与截图约定见 skill `local-http-browser-qa` 与 `.cursor/browser-automation/README.md`。
2. 等到场景可交互（Solid 生产端：`#scene-loader` 消失后再等 1–2 秒）。
3. 切到待验视角 / 课 / 个体；截图写入 `.cursor/browser-automation/runs/`。
4. **Read 打开 PNG**，至少核对：
   - 标签名与所指部位是否一致
   - 点是否落在本课该讲的线上（外轮廓 → 剪影边缘；交界线 → 明暗交界/结构点）
   - 虚线是否沿目标走
   - 是否串课（外轮廓关勿主讲光影证据，反之亦然）
5. 不通过 → 改点位/文案 → 再截图 → 再读图；循环至通过或用户说停。
6. 通过后：只留有价值最终图，删无关过程截图。

## 口径提示

- headform 显示名：【外轮廓规律】／【交界线规律】；消费端 `/Solid?sandbox=headform`
- 造形终审在用户；AI 视觉只做流程与画面证据，拿不准标「待用户终审」
- JSON：`docs/json` 以生产工具产物为权威，勿手改凑数

## 汇报模板

```text
视觉验收：通过 / 不通过
- 页面与参数：
- 截图：
- 看图结论（逐条）：
- 若失败：下一步修改点
```
