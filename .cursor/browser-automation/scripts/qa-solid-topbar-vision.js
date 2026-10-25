/**
 * 顶栏「场景」与「问号」视觉验收截图（强制可见对比）。
 * PORT=18080 node scripts/qa-solid-topbar-vision.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const shot = path.join(outDir, `solid-topbar-vision-${Date.now()}.png`);
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/Solid?sandbox=geometry&skipPerf=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForSelector('#top-left-scene-btn', { timeout: 60000 });
  await page.waitForSelector('#solid-global-help-btn', { timeout: 30000 });
  await page.waitForTimeout(1200);

  const metrics = await page.evaluate(() => {
    document.body.classList.remove('immersive-mode');
    const modal = document.getElementById('scene-grid-modal');
    if (modal) modal.style.display = 'none';
    // 顶栏对比底：避免纯黑 WebGL 截不出控件
    let bar = document.getElementById('__qa-topbar-bg');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = '__qa-topbar-bg';
      bar.style.cssText =
        'position:fixed;left:0;top:0;right:0;height:64px;z-index:7000;background:#2a2a32;pointer-events:none;';
      document.body.appendChild(bar);
    }
    const scene = document.getElementById('top-left-scene-btn');
    const help = document.getElementById('solid-global-help-btn');
    const menu = document.getElementById('menu-trigger-overlay');
    [scene, help, menu].forEach((el) => {
      if (!el) return;
      el.style.opacity = '1';
      el.style.visibility = 'visible';
      el.style.pointerEvents = 'auto';
    });
    if (scene) {
      scene.style.background = 'rgba(40,40,48,0.95)';
      scene.style.zIndex = '7003';
    }
    if (help) {
      help.style.color = '#fff';
      help.style.zIndex = '7003';
      help.style.background = 'rgba(40,40,48,0.35)';
    }
    const a = scene.getBoundingClientRect();
    const b = help.getBoundingClientRect();
    return {
      scene: {
        top: a.top,
        mid: a.top + a.height / 2,
        h: a.height,
        left: a.left,
        text: (scene.innerText || '').trim().slice(0, 40)
      },
      help: {
        top: b.top,
        mid: b.top + b.height / 2,
        h: b.height,
        right: b.right,
        text: (help.textContent || '').trim().slice(0, 8)
      },
      midDelta: Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)),
      topDelta: Math.abs(a.top - b.top)
    };
  });

  await page.waitForTimeout(200);
  await page.screenshot({
    path: shot,
    clip: { x: 0, y: 0, width: 390, height: 64 }
  });
  await browser.close();

  console.log(JSON.stringify({ metrics, shot }, null, 2));
  if (metrics.midDelta > 2.5) {
    console.error('FAIL midDelta=' + metrics.midDelta);
    process.exit(1);
  }
  console.log('PASS midDelta=' + metrics.midDelta);
  console.log('SHOT=' + shot);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
