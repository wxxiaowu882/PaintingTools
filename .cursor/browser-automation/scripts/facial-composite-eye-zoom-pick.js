/**
 * 显式相机距离拉近眼区，屏幕点选外眦/内眦/虹膜/上下睑。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-eye-zoom-pick`);

// 关键半径，对准右眼
const EYE_CAM = { orbit: '-18deg 88deg 0.42m', target: '-0.032m 0.178m 0.065m', fov: 18 };

/** 相对拉近后的眼区画面估 uv（右眼在画面中部偏左） */
const PICKS = [
  { text: '虹膜', u: 0.48, v: 0.48 },
  { text: '角膜', u: 0.49, v: 0.46 },
  { text: '眼球', u: 0.50, v: 0.48 },
  { text: '内眦', u: 0.62, v: 0.50 },
  { text: '外眦', u: 0.30, v: 0.48 },
  { text: '上眼睑', u: 0.48, v: 0.40 },
  { text: '下眼睑', u: 0.48, v: 0.58 },
  { text: '巩白', u: 0.56, v: 0.48 },
  { text: '睑上沟', u: 0.48, v: 0.34 },
  { text: '睑眉沟', u: 0.48, v: 0.26 },
  { text: '卧蚕', u: 0.48, v: 0.66 },
  { text: '睑下沟', u: 0.48, v: 0.74 },
];

function faceCam(n, orbit) {
  const m = /(-?\d+(?:\.\d+)?)deg\s+(-?\d+(?:\.\d+)?)deg/.exec(orbit);
  if (!m) return n;
  const theta = (Number(m[1]) * Math.PI) / 180;
  const phi = (Number(m[2]) * Math.PI) / 180;
  const toCam = [Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta)];
  const dot = n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2];
  if (dot < 0) return [-n[0], -n[1], -n[2]];
  return n;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const by = Object.fromEntries(data.pointsData.map((p) => [p.text, p]));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });

  const empty = path.join(outDir, '_empty.json');
  fs.writeFileSync(empty, JSON.stringify({ ...data, pointsData: [], snapshots: [], timestamp: Date.now() }, null, 2));
  await page.setInputFiles('#file-input', empty);
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && (v.getAttribute('src') || '').includes('石膏');
  }, null, { timeout: 180000 });
  for (let i = 0; i < 35; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.4);
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

  await page.evaluate((c) => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-target', c.target);
    v.setAttribute('camera-orbit', c.orbit);
    v.setAttribute('field-of-view', `${c.fov}deg`);
  }, EYE_CAM);
  await page.waitForTimeout(600);
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean_eye_zoom.png') });

  const hits = await page.evaluate((picks) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const out = [];
    for (const spec of picks) {
      const cx = rect.left + rect.width * spec.u;
      const cy = rect.top + rect.height * spec.v;
      let best = null;
      for (let r = 0; r <= 16; r += 2) {
        const nAng = r === 0 ? 1 : 8;
        for (let a = 0; a < nAng; a++) {
          const rad = (a * Math.PI) / 4;
          const ox = r === 0 ? 0 : Math.round(r * Math.cos(rad));
          const oy = r === 0 ? 0 : Math.round(r * Math.sin(rad));
          const h = viewer.positionAndNormalFromPoint(cx + ox, cy + oy);
          if (!h) continue;
          const p = h.position;
          // 必须在右眼一带
          if (p.x > -0.005 || p.x < -0.065) continue;
          if (p.y < 0.155 || p.y > 0.210) continue;
          if (p.z < 0.035) continue;
          let nx = h.normal.x,
            ny = h.normal.y,
            nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          const score = p.z * 4 + nz * 2 - r * 0.2;
          if (!best || score > best.score) best = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz], r };
        }
      }
      out.push({ text: spec.text, best });
    }
    return out;
  }, PICKS);

  const report = [];
  for (const h of hits) {
    const pt = by[h.text];
    if (!pt) continue;
    if (!h.best) {
      report.push({ text: h.text, ok: false, old: pt.pos });
      console.log('NOHIT', h.text);
      continue;
    }
    const n = faceCam(h.best.norm, EYE_CAM.orbit);
    const pos = `${h.best.pos[0].toFixed(4)}m ${h.best.pos[1].toFixed(4)}m ${h.best.pos[2].toFixed(4)}m`;
    const norm = `${n[0].toFixed(4)}m ${n[1].toFixed(4)}m ${n[2].toFixed(4)}m`;
    console.log('FIX', h.text, pt.pos, '->', pos);
    report.push({ text: h.text, ok: true, old: pt.pos, pos });
    pt.pos = pos;
    pt.norm = norm;
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

  // 单点验证外眦/内眦/虹膜（不点聚焦）
  for (const name of ['外眦', '内眦', '虹膜']) {
    const pt = by[name];
    const tmp = path.join(outDir, `_solo_${name}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({ ...data, pointsData: [{ ...pt, id: 1 }], snapshots: [], timestamp: Date.now() }, null, 2)
    );
    await page.evaluate(() => {
      const input = document.getElementById('file-input');
      if (input) input.value = '';
    });
    await page.setInputFiles('#file-input', tmp);
    await page.waitForFunction(
      (expected) => {
        const inp = document.querySelector('#points-list .point-text-input');
        return inp && inp.value === expected;
      },
      name,
      { timeout: 120000 }
    );
    await page.waitForTimeout(450);
    await page.evaluate(() => {
      ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.visibility = 'hidden';
      });
    });
    await page.evaluate((c) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-target', c.target);
      v.setAttribute('camera-orbit', c.orbit);
      v.setAttribute('field-of-view', `${c.fov}deg`);
    }, EYE_CAM);
    await page.waitForTimeout(400);
    await page.locator('#workbench-viewer').screenshot({
      path: path.join(outDir, `solo_${name}.png`),
    });
    console.log('SOLO', name, pt.pos);
  }

  console.log(JSON.stringify({ ok: true, fixed: report.filter((r) => r.ok).length, outDir }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
