/**
 * 修内眦：相对虹膜更靠鼻侧，但仍在睑裂内角，勿贴到鼻侧壁。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-fix-neizi`);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const iris = data.pointsData.find((p) => p.text === '虹膜');
  const [ix, iy, iz] = iris.pos.replace(/m/g, '').split(/\s+/).map(Number);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForFunction(() => /52/.test((document.getElementById('point-count') || {}).innerText || ''), null, {
    timeout: 180000,
  });
  for (let i = 0; i < 30; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.35);
    });
    if (ok) break;
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const frame = document.getElementById('anno-mobile-frame-overlay');
    if (frame) frame.hidden = true;
  });

  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-target', '-0.036m 0.176m 0.068m');
    v.setAttribute('camera-orbit', '-8deg 90deg auto');
    v.setAttribute('field-of-view', '8deg');
  });
  await page.waitForTimeout(400);

  const hit = await page.evaluate(({ ix, iy, iz }) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    let best = null;
    for (let yy = 0.25; yy <= 0.75; yy += 0.015) {
      for (let xx = 0.35; xx <= 0.75; xx += 0.015) {
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy);
        if (!h) continue;
        const p = h.position;
        // 内眦：比虹膜更靠中线（x 更大/更接近0），仍在眼区
        if (p.x < ix + 0.006 || p.x > ix + 0.022) continue;
        if (Math.abs(p.y - iy) > 0.012) continue;
        if (p.z < iz - 0.012 || p.z > iz + 0.010) continue;
        let nx = h.normal.x,
          ny = h.normal.y,
          nz = h.normal.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        const score = p.z * 5 + nz * 3 - Math.abs(p.y - (iy - 0.002)) * 12 - Math.abs(p.x - (ix + 0.014)) * 8;
        if (!best || score > best.score) {
          best = {
            score,
            pos: `${p.x.toFixed(4)}m ${p.y.toFixed(4)}m ${p.z.toFixed(4)}m`,
            norm: `${nx.toFixed(4)}m ${ny.toFixed(4)}m ${nz.toFixed(4)}m`,
          };
        }
      }
    }
    return best;
  }, { ix, iy, iz });

  const pt = data.pointsData.find((p) => p.text === '内眦');
  if (!hit) console.log('NOHIT keep', pt.pos);
  else {
    console.log('FIX 内眦', pt.pos, '->', hit.pos);
    pt.pos = hit.pos;
    pt.norm = hit.norm;
  }
  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'hit.json'), JSON.stringify({ hit, iris: iris.pos }, null, 2));
  console.log(JSON.stringify({ ok: true, outDir }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
