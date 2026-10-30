# 壳注入防再犯清单（硬性）

> 起因：1.0.16/1.0.17 在 `evaluateJavascript` 拼 CSS 时末尾残留 `+`，整段 JS **SyntaxError**，被空 `catch` 吞掉 → 首页无 `V*` 版本角标、Solid/晓色顶栏无安全区，页面其它逻辑看似正常，极难察觉。

## 改 `injectShellPageHelpers` 后必须做

1. **语法**：用 Node 对「最终注入字符串」跑 `node --check`（或跑 `xstudio-modal-twice-qa.js` 里的 inject 冒烟）。禁止在 JS 里手写 `a + b +` 再接下文。
2. **分注**：版本角标与安全区 CSS **分开** `evaluateJavascript`；一侧失败不得拖死另一侧。
3. **真机/平板冒烟（不可省）**  
   - 打开首页：点头像打开「关于」弹窗，底部有版本（浏览器站戳 / App 为 `V{BUILD_STAMP}.{webStamp}`）；**无**右下角角标  


   - Solid：顶栏三杠/场景钮离开状态栏；「童画师解析」不与三杠重叠  
   - 晓色：品牌栏离开状态栏  
   - 控制台或 `window.__SHELL_INJECT_BADGE_OK__` / `__SHELL_INJECT_SAFE_OK__` 均为 true  
4. **发测站顺序**：先 APK 可下载 → 再升 `minVersionCode`（Portal 20b）。
5. **禁止**用「只改网页、不升壳」冒充已修壳问题。

## 晓色配置弹层（齿轮）回归（网页 + 壳都要）

必须测 **打开 → × 关闭 → 再打开 → 再关**，至少 2 轮，并故意在**加载蒙版未消失前**连点 Tab / 弹层上方空隙：

- 加载中：不得误关；× 仍可关；蒙版挡住 Tab  
- 第二次打开应接近即时（关而不毁暖启动）  
- × 保持原样灰色字，**无边框/无底**；壳侧 `.close-modal` z-index 须高于 `#pigmentModalBusy`  

脚本：`.cursor/browser-automation/scripts/xstudio-modal-twice-qa.js`

## Agent 约定

改壳注入或晓色弹层后：**先跑上述脚本再声称完成**；不得只测「第一次打开」。
