/**
 * Portrait 移动端抽屉：左三角开合 + 整条顶栏（含课名）拖高 + 画布高度互补
 * 用法：PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-portrait-drawer-toggle-resize.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
require('./_playwright-browsers-path');

const PORT = process.env.PORT || '18080';
const BASE = (process.env.BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const OUT = path.join(__dirname, '../runs');
const channel = process.env.PLAYWRIGHT_CHANNEL || 'msedge';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    channel,
    headless: process.env.HEADED === '1' ? false : true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const url = `${BASE}/Portrait_c?lib=anatomy`;
  console.log('open', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const g = document.getElementById('gallery-grid');
    return g && g.querySelector('.course-card');
  }, null, { timeout: 45000 });
  // 本地无会员会话时 anatomy 会门禁；抽屉 UI 不依赖模型，直接亮起底栏冒烟
  await page.evaluate(() => {
    const modal = document.getElementById('course-gallery-modal');
    if (modal) modal.classList.remove('show');
    const ld = document.getElementById('loading-screen');
    if (ld) {
      ld.classList.add('is-hidden');
      ld.style.opacity = '0';
      ld.style.pointerEvents = 'none';
    }
    const panel = document.getElementById('control-panel');
    panel.style.display = 'flex';
    panel.classList.add('collapsed');
    document.getElementById('workbench-viewer').classList.remove('drawer-open');
    document.getElementById('ink-overlay').classList.remove('drawer-open');
  });
  await sleep(400);

  const snap = async (name) => {
    const p = path.join(OUT, name);
    await page.screenshot({ path: p, fullPage: false });
    console.log('shot', p);
    return p;
  };

  const measure = async () => page.evaluate(() => {
    const panel = document.getElementById('control-panel');
    const viewer = document.getElementById('workbench-viewer');
    const pr = panel.getBoundingClientRect();
    const vr = viewer.getBoundingClientRect();
    return {
      collapsed: panel.classList.contains('collapsed'),
      panelH: Math.round(pr.height),
      viewerH: Math.round(vr.height),
      aria: (document.getElementById('drawer-toggle-btn') || {}).getAttribute
        ? document.getElementById('drawer-toggle-btn').getAttribute('aria-expanded')
        : null,
    };
  });

  const before = await measure();
  console.log('before', before);
  if (!before.collapsed) throw new Error('期望进课后抽屉默认收起');

  // 1) 三角展开
  await page.locator('#drawer-toggle-btn').tap();
  await sleep(500);
  const opened = await measure();
  console.log('after toggle open', opened);
  if (opened.collapsed) throw new Error('三角未能展开抽屉');
  if (opened.aria !== 'true') throw new Error('aria-expanded 应为 true');
  await snap('portrait-drawer-toggle-open.png');

  // 2) 按住课名文字拖高（此前真机失效点）
  const tab = page.locator('.tab-btn.active');
  const box = await tab.boundingBox();
  if (!box) throw new Error('找不到课名 tab');
  const sx = box.x + box.width * 0.5;
  const sy = box.y + box.height * 0.5;
  const h0 = opened.panelH;
  const v0 = opened.viewerH;
  await page.touchscreen.tap(sx, sy); // warm
  await page.evaluate(({ sx, sy }) => {
    const header = document.getElementById('drawer-panel-header');
    const down = new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch',
      clientX: sx, clientY: sy, buttons: 1,
    });
    header.dispatchEvent(down);
    for (let i = 1; i <= 12; i++) {
      header.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch',
        clientX: sx, clientY: sy - i * 10, buttons: 1,
      }));
    }
    header.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch',
      clientX: sx, clientY: sy - 120, buttons: 0,
    }));
  }, { sx, sy });
  await sleep(400);
  const afterDrag = await measure();
  console.log('after drag on tab text', afterDrag);
  if (afterDrag.panelH < h0 + 40) {
    throw new Error(`课名拖高失败: ${h0} -> ${afterDrag.panelH}`);
  }
  if (afterDrag.viewerH > v0 - 20) {
    throw new Error(`画布未互补缩小: viewer ${v0} -> ${afterDrag.viewerH}`);
  }
  await snap('portrait-drawer-drag-taller.png');

  // 3) 三角收起
  await page.locator('#drawer-toggle-btn').tap();
  await sleep(500);
  const closed = await measure();
  console.log('after toggle close', closed);
  if (!closed.collapsed) throw new Error('三角未能收起抽屉');
  if (closed.aria !== 'false') throw new Error('aria-expanded 应为 false');
  await snap('portrait-drawer-toggle-closed.png');

  // 4) 收起态上拖拉开
  const handle = page.locator('#drawer-header-trigger');
  const hb = await handle.boundingBox();
  if (!hb) throw new Error('无把手');
  const hx = hb.x + hb.width * 0.5;
  const hy = hb.y + hb.height * 0.5;
  await page.evaluate(({ hx, hy }) => {
    const header = document.getElementById('drawer-panel-header');
    header.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 8, pointerType: 'touch',
      clientX: hx, clientY: hy, buttons: 1,
    }));
    for (let i = 1; i <= 15; i++) {
      header.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerId: 8, pointerType: 'touch',
        clientX: hx, clientY: hy - i * 12, buttons: 1,
      }));
    }
    header.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, pointerId: 8, pointerType: 'touch',
      clientX: hx, clientY: hy - 180, buttons: 0,
    }));
  }, { hx, hy });
  await sleep(450);
  const pullOpen = await measure();
  console.log('after pull open', pullOpen);
  if (pullOpen.collapsed) throw new Error('收起态上拖未能拉开');

  console.log('PASS');
  await browser.close();
}

main().catch(async (e) => {
  console.error('FAIL', e);
  process.exitCode = 1;
});
