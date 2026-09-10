/**
 * 05 综合：只重拾明显错位点（快）。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-composite-fix2`);
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');

const FIXES = [
  { text: '耳轮脚', orbit: '88deg 90deg auto', fov: 11, u: 0.40, v: 0.40, ok: (p) => p.x > 0.04 && p.z < 0.04 },
  { text: '耳轮', orbit: '92deg 86deg auto', fov: 11, u: 0.58, v: 0.24, ok: (p) => p.x > 0.04 && p.z < 0.04 },
  { text: '对耳轮下脚', orbit: '88deg 88deg auto', fov: 10, u: 0.44, v: 0.36, ok: (p) => p.x > 0.04 && p.z < 0.04 },
  { text: '鼻根', orbit: '0deg 80deg auto', fov: 12, u: 0.50, v: 0.26, ok: (p) => Math.abs(p.x) < 0.015 && p.z > 0.05 && p.y > 0.16 },
  { text: '鼻底', orbit: '0deg 130deg auto', fov: 11, u: 0.50, v: 0.30, ok: (p) => Math.abs(p.x) < 0.015 && p.y > 0.13 && p.y < 0.16 },
  { text: '鼻中隔', orbit: '0deg 132deg auto', fov: 10, u: 0.50, v: 0.36, ok: (p) => Math.abs(p.x) < 0.015 && p.y > 0.13 && p.y < 0.16 },
  { text: '鼻翼脚', orbit: '18deg 128deg auto', fov: 11, u: 0.60, v: 0.38, ok: (p) => p.x > 0.008 && p.x < 0.04 && p.y > 0.13 && p.y < 0.16 },
  { text: '人中脊', orbit: '8deg 96deg auto', fov: 10, u: 0.56, v: 0.42, ok: (p) => p.x > 0 && p.x < 0.025 && p.y < 0.145 && p.y > 0.125 && p.z > 0.06 },
  { text: '人中（沟）', orbit: '0deg 96deg auto', fov: 10, u: 0.50, v: 0.40, ok: (p) => Math.abs(p.x) < 0.012 && p.y < 0.145 && p.y > 0.125 },
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(90000);

  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForFunction(
    () => {
      const v = document.querySelector('#workbench-viewer');
      return v && (v.getAttribute('src') || '').includes('石膏');
    },
    null,
    { timeout: 180000 }
  );
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.35);
    });
    if (ok) break;
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
  });

  const report = [];
  for (const fix of FIXES) {
    await page.evaluate(({ orbit, fov }) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-target', 'auto auto auto');
      v.setAttribute('camera-orbit', orbit);
      v.setAttribute('field-of-view', `${fov}deg`);
    }, { orbit: fix.orbit, fov: fix.fov });
    await page.waitForTimeout(350);

    const bounds = await page.evaluate(() => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      const step = 0.06;
      let minX = 1, minY = 1, maxX = 0, maxY = 0, any = false;
      for (let yy = 0.05; yy <= 0.95; yy += step) {
        for (let xx = 0.05; xx <= 0.95; xx += step) {
          if (viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy)) {
            any = true;
            minX = Math.min(minX, xx); minY = Math.min(minY, yy);
            maxX = Math.max(maxX, xx); maxY = Math.max(maxY, yy);
          }
        }
      }
      return any ? { minX, minY, maxX, maxY } : null;
    });
    if (!bounds) {
      report.push({ text: fix.text, status: 'no-bounds' });
      console.log('NOBOUNDS', fix.text);
      continue;
    }

    // denser local scan around uv, filter by ok predicate in page via ranges
    const ranges = {
      ear: { xmin: 0.04, zmax: 0.04 },
      noseRoot: { xmaxAbs: 0.015, zmin: 0.05, ymin: 0.16 },
      noseBase: { xmaxAbs: 0.015, ymin: 0.13, ymax: 0.16 },
      noseBaseR: { xmin: 0.008, xmax: 0.04, ymin: 0.13, ymax: 0.16 },
      philtrum: { xmin: -0.002, xmax: 0.025, ymin: 0.125, ymax: 0.145, zmin: 0.06 },
      philtrumMid: { xmaxAbs: 0.012, ymin: 0.125, ymax: 0.145 },
    };
    let mode = 'ear';
    if (fix.text === '鼻根') mode = 'noseRoot';
    else if (fix.text === '鼻底' || fix.text === '鼻中隔') mode = 'noseBase';
    else if (fix.text === '鼻翼脚') mode = 'noseBaseR';
    else if (fix.text === '人中脊') mode = 'philtrum';
    else if (fix.text === '人中（沟）') mode = 'philtrumMid';
    else if (fix.text.startsWith('耳') || fix.text.includes('耳')) mode = 'ear';

    const hit = await page.evaluate(({ u, v, bounds, mode, ranges }) => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      const sx = bounds.minX + (bounds.maxX - bounds.minX) * u;
      const sy = bounds.minY + (bounds.maxY - bounds.minY) * v;
      const baseX = rect.left + rect.width * sx;
      const baseY = rect.top + rect.height * sy;
      const offsets = [[0, 0]];
      for (let r = 2; r <= 22; r += 2) {
        for (let a = 0; a < 16; a++) {
          const rad = (a / 16) * Math.PI * 2;
          offsets.push([Math.cos(rad) * r, Math.sin(rad) * r]);
        }
      }
      function ok(mode, p, ranges) {
        const R = ranges[mode] || {};
        if (R.xmin != null && p.x < R.xmin) return false;
        if (R.xmax != null && p.x > R.xmax) return false;
        if (R.xmaxAbs != null && Math.abs(p.x) > R.xmaxAbs) return false;
        if (R.ymin != null && p.y < R.ymin) return false;
        if (R.ymax != null && p.y > R.ymax) return false;
        if (R.zmin != null && p.z < R.zmin) return false;
        if (R.zmax != null && p.z > R.zmax) return false;
        return true;
      }
      let best = null;
      for (const [ox, oy] of offsets) {
        const h = viewer.positionAndNormalFromPoint(baseX + ox, baseY + oy);
        if (!h) continue;
        const p = { x: h.position.x, y: h.position.y, z: h.position.z };
        if (!ok(mode, p, ranges)) continue;
        let nx = h.normal.x, ny = h.normal.y, nz = h.normal.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        const s = mode === 'ear' ? p.x * 5 - Math.abs(p.z) : p.z * 3 + nz - Math.abs(p.x) * 5;
        if (!best || s > best.s) {
          best = {
            s,
            pos: `${p.x.toFixed(4)}m ${p.y.toFixed(4)}m ${p.z.toFixed(4)}m`,
            norm: `${nx.toFixed(4)}m ${ny.toFixed(4)}m ${nz.toFixed(4)}m`,
            xyz: p,
          };
        }
      }
      return best;
    }, { u: fix.u, v: fix.v, bounds, mode, ranges });

    const pt = data.pointsData.find((p) => p.text === fix.text);
    if (!pt) {
      report.push({ text: fix.text, status: 'missing' });
      continue;
    }
    if (!hit) {
      report.push({ text: fix.text, status: 'nohit', old: pt.pos });
      console.log('NOHIT', fix.text, 'keep', pt.pos);
      continue;
    }
    const old = pt.pos;
    pt.pos = hit.pos;
    pt.norm = hit.norm;
    report.push({ text: fix.text, status: 'ok', old, neu: hit.pos });
    console.log('FIX', fix.text, old, '->', hit.pos);
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

  // QA shots after reload
  await page.evaluate(() => { const i = document.querySelector('#file-input'); if (i) i.value = ''; });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForTimeout(2800);
  const qa = [
    { name: 'qa_front', orbit: '0deg 85deg auto', fov: 24 },
    { name: 'qa_ear', orbit: '88deg 90deg auto', fov: 11 },
    { name: 'qa_nose', orbit: '0deg 90deg auto', fov: 12 },
    { name: 'qa_nose_up', orbit: '0deg 130deg auto', fov: 12 },
    { name: 'qa_mouth', orbit: '0deg 100deg auto', fov: 11 },
    { name: 'qa_eye', orbit: '-16deg 84deg auto', fov: 11 },
  ];
  for (const view of qa) {
    await page.evaluate(({ orbit, fov }) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-orbit', orbit);
      v.setAttribute('field-of-view', `${fov}deg`);
      v.querySelectorAll('.preview-hotspot').forEach((el) => el.classList.add('show-text'));
    }, view);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, `${view.name}.png`) });
    console.log('shot', view.name);
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('DONE', JSON.stringify(report, null, 2));
  await browser.close();
  if (report.some((r) => r.status !== 'ok')) process.exitCode = 2;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
