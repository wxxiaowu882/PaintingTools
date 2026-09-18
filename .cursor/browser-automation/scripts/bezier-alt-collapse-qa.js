/**
 * 验收 Alt+单击锚点：收起为零柄尖角；再 Alt 沿邻边展开。
 * PORT=18080 node scripts/bezier-alt-collapse-qa.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const OUT = path.join(__dirname, '..', 'runs', 'bezier-alt-collapse');
const PAGE =
  `http://127.0.0.1:${PORT}/自用工具文件_不部署/石膏人像沙盒场景生成/Solid_Portrait_Create`;

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

async function waitLoaderGone(page) {
  try {
    await page.waitForSelector('#scene-loader', { state: 'hidden', timeout: 120000 });
  } catch (_e) {}
  await page.waitForTimeout(1200);
}

async function main() {
  ensureDir(OUT);
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await waitLoaderGone(page);
  await page.waitForFunction(() => !!(window.DashedLineManager && window.DashedLineManager._lastAddPos), {
    timeout: 60000,
  });

  const result = await page.evaluate(() => {
    const M = window.DashedLineManager;
    if (!M || !M._lastAddPos) return { ok: false, err: 'no manager' };
    const V3 = M._lastAddPos.constructor;

    // 直角折线锚点：左→中→上，中间应成锐角
    const A = new V3(-2, 0, 0);
    const B = new V3(0, 0, 0);
    const C = new V3(0, 2, 0);
    const anchorObj = (window.scene && window.THREE)
      ? new window.THREE.Object3D()
      : { matrixWorld: { elements: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] }, updateMatrixWorld() {} };
    if (window.scene && anchorObj.isObject3D) window.scene.add(anchorObj);

    const data = {
      id: 'qa_bezier_alt_' + Date.now(),
      kind: 'bezier',
      projected: false,
      points: [
        {
          localPos: A.clone(),
          handleOut: new V3(0.8, 0.6, 0), // 故意造弧
        },
        {
          localPos: B.clone(),
          handleIn: new V3(-0.7, 0.5, 0),
          handleOut: new V3(0.5, 0.7, 0),
        },
        {
          localPos: C.clone(),
          handleIn: new V3(0.6, -0.8, 0),
        },
      ],
      midIndex: 1,
      anchorObj: anchorObj,
      lastDStr: '',
    };

    window.dashedLineList.push(data);
    M.selectedId = data.id;
    M.selectedAnchorIndex = 1;

    const mid = data.points[1];
    const beforeLenIn = mid.handleIn.length();
    const beforeLenOut = mid.handleOut.length();

    // 1) 收起
    const r1 = M._collapseBezierAnchorHandles(data, 1);
    // 模拟每帧路径刷新（历史上会冲掉 null 收起）
    M._ensureDefaultHandles(data);
    const afterCollapse = {
      handleIn: mid.handleIn ? [mid.handleIn.x, mid.handleIn.y, mid.handleIn.z] : null,
      handleOut: mid.handleOut ? [mid.handleOut.x, mid.handleOut.y, mid.handleOut.z] : null,
      lenIn: mid.handleIn ? mid.handleIn.length() : null,
      lenOut: mid.handleOut ? mid.handleOut.length() : null,
      stillCollapsed: M._isHandleCollapsed(mid.handleIn) && M._isHandleCollapsed(mid.handleOut),
    };

    // 采样：过中点的三次贝塞尔控制点应落在锚点上（尖角）
    const z = new V3(0, 0, 0);
    const ctrlOut = mid.localPos.clone().add(mid.handleOut || z);
    const ctrlIn = mid.localPos.clone().add(mid.handleIn || z);
    const sharp =
      ctrlOut.distanceTo(mid.localPos) < 1e-9 &&
      ctrlIn.distanceTo(mid.localPos) < 1e-9;

    // 2) 再 Alt：沿邻边展开
    const r2 = M._collapseBezierAnchorHandles(data, 1);
    const dirInExpected = A.clone().sub(B).normalize();
    const dirOutExpected = C.clone().sub(B).normalize();
    const dirIn = mid.handleIn.clone().normalize();
    const dirOut = mid.handleOut.clone().normalize();
    const dotIn = dirIn.dot(dirInExpected);
    const dotOut = dirOut.dot(dirOutExpected);
    const edgeAligned = dotIn > 0.999 && dotOut > 0.999;
    const notColinearHandles = Math.abs(dirIn.dot(dirOut)) < 0.2; // 直角 ≈ 0

    // 3) 再收起闭环
    const r3 = M._collapseBezierAnchorHandles(data, 1);
    M._ensureDefaultHandles(data);
    const reCollapsed = M._isHandleCollapsed(mid.handleIn) && M._isHandleCollapsed(mid.handleOut);

    return {
      ok: !!(r1 && r2 && r3 && afterCollapse.stillCollapsed && sharp && edgeAligned && reCollapsed && notColinearHandles),
      beforeLenIn,
      beforeLenOut,
      afterCollapse,
      sharp,
      edgeAligned,
      notColinearHandles,
      dotIn,
      dotOut,
      reCollapsed,
      restoreLens: {
        in: mid.handleIn ? mid.handleIn.length() : 0,
        out: mid.handleOut ? mid.handleOut.length() : 0,
        expectIn: A.distanceTo(B) / 3,
        expectOut: C.distanceTo(B) / 3,
      },
    };
  });

  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  if (!result.ok) {
    process.exitCode = 1;
    console.error('[FAIL] bezier alt collapse');
  } else {
    console.log('[PASS] collapse sharp + restore edge-aligned');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
