/** 203 手调后截图，供 AI 视觉核对交界线段 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-203-vision`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  // 回写 id，避免消费端丢
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('203_') && n.endsWith('.json'));
  const full = path.join(jsonDir, f);
  const data = JSON.parse(fs.readFileSync(full, 'utf8'));
  data.id = 'L03';
  data.meta = Object.assign({}, data.meta, { line: 'light', slot: 'L03', status: 'handtuned' });
  fs.writeFileSync(full, JSON.stringify(data) + '\n');
  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+[A-Za-z]?_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  fs.writeFileSync(
    path.join(jsonDir, '沙盒_头部造型规律.json'),
    JSON.stringify(files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')))) + '\n'
  );

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    window._solidUserStoppedRender = true;
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(() => (window.customScenes || []).length > 0, null, { timeout: 120000 });
  await page.waitForFunction(() => !!(window.__solidHost && window.__solidHost.getCamera), null, {
    timeout: 120000
  });
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'L03');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && /蝴蝶/.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  for (let i = 0; i < 100; i++) {
    const n = await page.evaluate(() => {
      let c = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) c++;
        });
      } catch (e) {}
      return c;
    });
    if (n > 0) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(3000);
  for (let k = 0; k < 8; k++) {
    await page.evaluate(() => {
      try {
        if (typeof window.stopRender === 'function') window.stopRender();
      } catch (e) {}
      window.useAdvancedRender = false;
      window.perfTestDone = true;
      const hide = (el) => {
        if (!el) return;
        el.style.display = 'none';
        el.style.opacity = '0';
      };
      hide(document.getElementById('scene-loader'));
      document.querySelectorAll('body *').forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        const t = (el.textContent || '').trim();
        if (/^(正在计算光影|首帧渲染中|即将完成|光影探针)/.test(t) && t.length < 50) hide(el);
      });
    });
    await page.waitForTimeout(280);
  }

  const crop = await page.evaluate(() => {
    const s = (window.customScenes || []).find((x) => x && (x.id === 'L03' || /蝴蝶/.test(String(x.name || ''))));
    const c = (s && s.crop) || {};
    // crop.display 可能为 none，仍用 left/top 作截图框；若无效则居中裁
    const x = parseFloat(c.left);
    const y = parseFloat(c.top);
    return {
      x: Number.isFinite(x) ? x : 260,
      y: Number.isFinite(y) ? y : 70,
      width: 760,
      height: 720
    };
  });

  await page.evaluate(() => {
    if (window.showAnnotations !== true && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, 'L03-annotated-full.png') });
  await page.screenshot({ path: path.join(outDir, 'L03-annotated-crop.png'), clip: crop });

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'L03-light-only.png'), clip: crop });

  console.log('OUT', outDir, crop);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
