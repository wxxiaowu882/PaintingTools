/**
 * 验收：手机取景信箱开启时，贝塞尔 SVG 与 hotspot 屏幕坐标对齐（不偏右）。
 * Usage: PORT=18080 node scripts/bezier-letterbox-offset-qa.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 18080}`;
const jsonRel = path.join(repo, 'docs/json/结构_头骨骨点肌肉/02 骨点详解.json');
const outDir = path.join(__dirname, '..', 'runs', 'bezier-letterbox-qa');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', jsonRel);
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && v.model && v.model.materials && v.model.materials.length > 0;
  }, null, { timeout: 120000 });
  await sleep(1500);

  await page.evaluate(() => {
    const cb = document.getElementById('anno-mobile-frame-toggle');
    if (cb && !cb.checked) {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (cb) {
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await sleep(400);
  await page.evaluate(() => {
    if (typeof updateSVG === 'function') updateSVG();
  });
  await sleep(500);

  const report = await page.evaluate(() => {
    const svg = document.getElementById('ink-overlay');
    const mv = document.getElementById('workbench-viewer');
    const ov = svg.getBoundingClientRect();
    const vb = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
    const paths = Array.from(svg.querySelectorAll('path[data-bezier-id], path.svg-hit-path[data-bezier-id]'));
    const beziers = (window.__annoBatch && window.__annoBatch.getPoints
      ? window.__annoBatch.getPoints()
      : (typeof pointsData !== 'undefined' ? pointsData : []))
      .filter((p) => p && p.type === 'bezier' && !p.hidden);

    // fallback: read from page pointsData via list
    let pts = beziers;
    if (!pts.length) {
      try {
        pts = (window.pointsData || []).filter((p) => p.type === 'bezier' && !p.hidden);
      } catch (_e) {}
    }

    // 路径起点 M 应对齐该贝塞尔第一个锚点 hotspot 的屏幕中心
    const paired = [];
    for (const p of pts.slice(0, 6)) {
      const dots = p.dots || [];
      if (!dots.length) continue;
      const first = dots[0];
      const el = mv.querySelector(`[slot="${first.slot}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const hx = r.left + r.width / 2;
      const hy = r.top + r.height / 2;
      const path = paths.find((ph) => String(ph.getAttribute('data-bezier-id')) === String(p.id));
      const d = path ? path.getAttribute('d') || '' : '';
      const m = d.match(/M\s*([-\d.]+)\s+([-\d.]+)/i);
      if (!m) continue;
      const px = +m[1];
      const py = +m[2];
      paired.push({
        id: p.id,
        hotspot: { x: hx, y: hy },
        pathM: { x: px, y: py },
        drift: Math.hypot(px - hx, py - hy),
      });
    }

    const letterboxed = Math.abs(mv.getBoundingClientRect().width - window.innerWidth) > 40;
    const viewBoxOk =
      vb.length === 4 &&
      Math.abs(vb[0] - ov.left) < 2 &&
      Math.abs(vb[1] - ov.top) < 2 &&
      Math.abs(vb[2] - ov.width) < 2 &&
      Math.abs(vb[3] - ov.height) < 2;

    return {
      letterboxed,
      viewBox: vb,
      ov: { left: ov.left, top: ov.top, w: ov.width, h: ov.height },
      viewBoxOk,
      bezierCount: pts.length,
      pathCount: paths.length,
      paired,
    };
  });

  const drifts = (report.paired || []).map((p) => p.drift);
  const maxDrift = drifts.length ? Math.max(...drifts) : null;

  await page.locator('#anno-mobile-frame-wrap').screenshot({
    path: path.join(outDir, 'letterbox-beziers.png'),
  });
  await page.screenshot({ path: path.join(outDir, 'full.png') });

  // toggle off — viewBox should be ~0,0,W,H and still ok
  await page.evaluate(() => {
    const cb = document.getElementById('anno-mobile-frame-toggle');
    if (cb && cb.checked) {
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await sleep(300);
  await page.evaluate(() => {
    if (typeof updateSVG === 'function') updateSVG();
  });
  await sleep(300);
  const off = await page.evaluate(() => {
    const svg = document.getElementById('ink-overlay');
    const ov = svg.getBoundingClientRect();
    const vb = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
    return {
      viewBoxOk:
        vb.length === 4 &&
        Math.abs(vb[0] - ov.left) < 2 &&
        Math.abs(vb[1] - ov.top) < 2,
      vb,
      ov: { left: ov.left, top: ov.top, w: ov.width, h: ov.height },
    };
  });

  const out = { report, maxDrift, off };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  // 旧 bug 偏右约等于 letterbox left（~400px）；修复后锚点与 M 应在数像素内
  const ok =
    report.letterboxed &&
    report.viewBoxOk &&
    off.viewBoxOk &&
    report.pathCount >= 1 &&
    drifts.length >= 1 &&
    maxDrift != null &&
    maxDrift < 8;
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
