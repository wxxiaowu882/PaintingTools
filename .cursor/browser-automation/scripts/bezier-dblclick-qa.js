/**
 * 真实双击插点验收（模拟人手：先点选 → 再间隔双击，非 Playwright 合成 dblclick）
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.resolve(__dirname, '../runs');
const TOOL = `http://127.0.0.1:${PORT}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`;
const JSON_PATH = path.join(ROOT, 'docs/json/结构_五官/05 五官综合讲解.json');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
}

async function realDoubleClick(page, x, y) {
  // 人手双击：两次完整 down/up，间隔约 120ms（触发 detail=2 与我们的 _dblArm）
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(30);
  await page.mouse.up();
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(30);
  await page.mouse.up();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(TOOL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#workbench-viewer', { timeout: 30000 });
  await page.locator('#file-input').setInputFiles(JSON_PATH);
  await page.waitForFunction(() => typeof pointsData !== 'undefined' && pointsData.length > 10, { timeout: 25000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    if (!v) return false;
    const r = v.getBoundingClientRect();
    for (let uy = 0.3; uy <= 0.55; uy += 0.05) {
      for (let ux = 0.4; ux <= 0.6; ux += 0.05) {
        if (v.positionAndNormalFromPoint(r.left + r.width * ux, r.top + r.height * uy)) return true;
      }
    }
    return false;
  }, { timeout: 45000 });
  await page.waitForTimeout(500);

  await page.selectOption('#tool-mode-select', 'bezier');
  const picks = await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    const r = v.getBoundingClientRect();
    const found = [];
    for (let uy = 0.28; uy <= 0.55; uy += 0.04) {
      for (let ux = 0.38; ux <= 0.62; ux += 0.04) {
        const x = r.left + r.width * ux;
        const y = r.top + r.height * uy;
        if (v.positionAndNormalFromPoint(x, y)) found.push({ x, y });
      }
    }
    return found;
  });
  assert(picks.length >= 2, '表面可拾取');
  const pA = picks[Math.floor(picks.length * 0.2)];
  const pB = picks[Math.floor(picks.length * 0.8)];

  async function altShiftClick(x, y) {
    await page.keyboard.down('Alt');
    await page.keyboard.down('Shift');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(40);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(160);
  }
  await altShiftClick(pA.x, pA.y);
  await altShiftClick(pB.x, pB.y);
  await page.waitForTimeout(700);

  const created = await page.evaluate(() => {
    const b = pointsData.filter((p) => p.type === 'bezier').pop();
    return { id: b && b.id, dots: b && b.dots.length };
  });
  console.log('CREATED', created);
  assert(created.id && created.dots === 2, '应建出两点贝塞尔');

  // 路径中点
  const mid = await page.evaluate((id) => {
    window.BezierAnnotation.selectLine(id);
    const pathEl = document.querySelector(`#ink-overlay path.svg-hit-path[data-bezier-id="${id}"]`);
    const total = pathEl.getTotalLength();
    const pt = pathEl.getPointAtLength(total * 0.45);
    return { x: pt.x, y: pt.y, total };
  }, created.id);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'bezier-dbl-01-selected.png') });

  // —— 场景 A：先点选（柄已显示），再真实双击路径中段 ——
  await page.mouse.click(mid.x, mid.y);
  await page.waitForTimeout(280);
  const beforeA = await page.evaluate((id) => pointsData.find((p) => p.id === id).dots.length, created.id);
  await realDoubleClick(page, mid.x, mid.y);
  await page.waitForTimeout(400);
  const afterA = await page.evaluate((id) => {
    const b = pointsData.find((p) => p.id === id);
    return {
      dots: b.dots.length,
      anchors: document.querySelectorAll('.bezier-anchor-hit').length,
      toast: (document.getElementById('anno-flash-toast') || {}).innerText || ''
    };
  }, created.id);
  console.log('SCENARIO_A', { beforeA, afterA, mid });
  await page.screenshot({ path: path.join(OUT, 'bezier-dbl-02-after-real-dblclick.png') });
  assert(afterA.dots === beforeA + 1, '一次双击只应 +1 锚点，' + beforeA + '→' + afterA.dots);
  assert(afterA.dots === 3, '真实双击后应有 3 锚点，实际=' + afterA.dots);
  assert(afterA.anchors >= 3, '应显示 3 个锚点 UI');

  // 原生 dblclick 不应再插（已移除该监听）
  await page.evaluate(({ id, x, y }) => {
    const pathEl = document.querySelector(`#ink-overlay path.svg-hit-path[data-bezier-id="${id}"]`);
    if (pathEl) {
      pathEl.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true, cancelable: true, view: window, clientX: x, clientY: y
      }));
    }
  }, { id: created.id, x: mid.x, y: mid.y });
  await page.waitForTimeout(150);
  const afterNative = await page.evaluate((id) => pointsData.find((p) => p.id === id).dots.length, created.id);
  console.log('NATIVE_DBLCLICK', { afterA: afterA.dots, afterNative });
  assert(afterNative === afterA.dots, '原生 dblclick 不得再插锚点');

  // —— 场景 B：再在另一段真实双击，应变成 4 点 ——
  const mid2 = await page.evaluate((id) => {
    window.BezierAnnotation.selectLine(id);
    const pathEl = document.querySelector(`#ink-overlay path.svg-hit-path[data-bezier-id="${id}"]`);
    const total = pathEl.getTotalLength();
    const pt = pathEl.getPointAtLength(total * 0.7);
    return { x: pt.x, y: pt.y };
  }, created.id);
  await page.waitForTimeout(250);
  await realDoubleClick(page, mid2.x, mid2.y);
  await page.waitForTimeout(500);
  const afterB = await page.evaluate((id) => pointsData.find((p) => p.id === id).dots.length, created.id);
  console.log('SCENARIO_B', { afterB, mid2 });
  await page.screenshot({ path: path.join(OUT, 'bezier-dbl-03-second-insert.png') });
  assert(afterB === 4, '第二次双击应有 4 锚点，实际=' + afterB);

  fs.writeFileSync(path.join(OUT, 'bezier-dblclick-qa.json'), JSON.stringify({ created, afterA, afterB }, null, 2));
  await browser.close();
  console.log('DBLCLICK_QA_PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
