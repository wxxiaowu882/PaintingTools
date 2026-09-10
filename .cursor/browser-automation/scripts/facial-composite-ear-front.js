/**
 * 耳屏/耳垂/耳甲腔：偏正面耳相机 + 分点约束（耳屏要前向 z，勿追 max-x 落到耳背）。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-ear-front`);

// 略侧视、整耳入画；clean 中耳在右侧
const EAR = { orbit: '88deg 90deg 0.26m', target: '0.062m 0.155m 0.005m', fov: '13deg' };
const NOSE = { orbit: '0deg 80deg 0.20m', target: '0.0m 0.160m 0.092m', fov: '10deg' };
const fmt = (v) => `${v.toFixed(4)}m`;

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

/** clean：颊在左/中，耳在右。tragus≈耳块左缘。 */
const PICKS = [
  { text: '耳屏', u: 0.58, v: 0.48, xMin: 0.057, zMin: 0.01, zMax: 0.03, yMin: 0.148, yMax: 0.168, mode: 'tragus' },
  { text: '耳甲腔', u: 0.64, v: 0.50, xMin: 0.059, zMin: -0.005, zMax: 0.02, yMin: 0.148, yMax: 0.168, mode: 'concha' },
  { text: '对耳轮', u: 0.68, v: 0.42, xMin: 0.06, zMin: -0.015, zMax: 0.012, yMin: 0.155, yMax: 0.178, mode: 'anti' },
  { text: '耳垂', u: 0.66, v: 0.72, xMin: 0.054, zMin: -0.015, zMax: 0.02, yMin: 0.115, yMax: 0.142, mode: 'lobe' },
  { text: '对耳屏', u: 0.62, v: 0.60, xMin: 0.055, zMin: -0.005, zMax: 0.022, yMin: 0.132, yMax: 0.152, mode: 'anti' },
  { text: '凹入缺口', u: 0.60, v: 0.56, xMin: 0.055, zMin: 0.005, zMax: 0.028, yMin: 0.138, yMax: 0.158, mode: 'tragus' },
  { text: '前缺口', u: 0.56, v: 0.44, xMin: 0.055, zMin: 0.008, zMax: 0.03, yMin: 0.152, yMax: 0.172, mode: 'tragus' },
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const by = Object.fromEntries(data.pointsData.map((p) => [p.text, p]));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  console.log('GOTO');
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });

  const empty = path.join(outDir, '_e.json');
  fs.writeFileSync(
    empty,
    JSON.stringify({ ...data, pointsData: [], camera: { ...EAR }, timestamp: Date.now() }, null, 2)
  );
  console.log('LOAD');
  await page.setInputFiles('#file-input', empty);
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && (v.getAttribute('src') || '').includes('石膏');
  }, null, { timeout: 180000 });
  for (let i = 0; i < 50; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.45);
    });
    if (ok) {
      console.log('RAY', i);
      break;
    }
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(280);
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const f = document.getElementById('anno-mobile-frame-overlay');
    if (f) f.hidden = true;
  });
  await page.evaluate((c) => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-target', c.target);
    v.setAttribute('camera-orbit', c.orbit);
    v.setAttribute('field-of-view', c.fov);
    try {
      v.cameraTarget = c.target;
      v.cameraOrbit = c.orbit;
      v.fieldOfView = c.fov;
      if (v.jumpCameraToGoal) v.jumpCameraToGoal();
    } catch (_e) {}
  }, EAR);
  await page.waitForTimeout(280);
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean_ear.png') });
  console.log('PICK');

  const hits = await page.evaluate((specs) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const out = [];
    for (const s of specs) {
      const cx = rect.left + rect.width * s.u;
      const cy = rect.top + rect.height * s.v;
      let best = null;
      for (let rad = 0; rad <= 16; rad += 2) {
        const nAng = rad === 0 ? 1 : 8;
        for (let a = 0; a < nAng; a++) {
          const ang = (a * Math.PI) / 4;
          const ox = rad === 0 ? 0 : Math.round(rad * Math.cos(ang));
          const oy = rad === 0 ? 0 : Math.round(rad * Math.sin(ang));
          const h = viewer.positionAndNormalFromPoint(cx + ox, cy + oy);
          if (!h) continue;
          const p = h.position;
          if (p.x < s.xMin || p.x > 0.085) continue;
          if (p.y < s.yMin || p.y > s.yMax) continue;
          if (p.z < s.zMin || p.z > s.zMax) continue;
          let nx = h.normal.x;
          let ny = h.normal.y;
          let nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          let score;
          if (s.mode === 'tragus') score = p.z * 12 + p.x * 4 - rad * 0.2;
          else if (s.mode === 'lobe') score = p.x * 8 - p.y * 3 - Math.abs(p.z) * 2 - rad * 0.2;
          else if (s.mode === 'concha') score = p.x * 5 - Math.abs(p.z - 0.008) * 6 - rad * 0.2;
          else score = p.x * 6 - Math.abs(p.z) * 2 - rad * 0.2;
          if (!best || score > best.score) {
            best = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz], rad, u: s.u, v: s.v };
          }
        }
      }
      out.push({ text: s.text, hit: best });
    }
    return out;
  }, PICKS);

  for (const row of hits) {
    if (!row.hit) {
      console.log('NOHIT', row.text);
      continue;
    }
    const pt = by[row.text];
    const n = faceCam(row.hit.norm, EAR.orbit);
    const pos = row.hit.pos.map(fmt).join(' ');
    console.log('FIX', row.text, pt.pos, '->', pos, `uv=${row.hit.u},${row.hit.v}`);
    pt.pos = pos;
    pt.norm = n.map(fmt).join(' ');
  }

  // 鼻根中线
  await page.evaluate(() => {
    const i = document.getElementById('file-input');
    if (i) i.value = '';
  });
  const empty2 = path.join(outDir, '_e2.json');
  fs.writeFileSync(
    empty2,
    JSON.stringify({ ...data, pointsData: [], camera: { ...NOSE }, timestamp: Date.now() }, null, 2)
  );
  await page.setInputFiles('#file-input', empty2);
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && (v.getAttribute('src') || '').includes('石膏');
  }, null, { timeout: 180000 });
  await page.waitForTimeout(250);
  await page.evaluate((c) => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-target', c.target);
    v.setAttribute('camera-orbit', c.orbit);
    v.setAttribute('field-of-view', c.fov);
    try {
      v.cameraTarget = c.target;
      v.cameraOrbit = c.orbit;
      v.fieldOfView = c.fov;
      if (v.jumpCameraToGoal) v.jumpCameraToGoal();
    } catch (_e) {}
  }, NOSE);
  await page.waitForTimeout(220);
  const root = await page.evaluate(() => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    let best = null;
    for (let v = 0.1; v <= 0.28; v += 0.012) {
      for (let u = 0.47; u <= 0.53; u += 0.01) {
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * u, rect.top + rect.height * v);
        if (!h) continue;
        const p = h.position;
        if (Math.abs(p.x) > 0.003) continue;
        if (p.y < 0.19 || p.y > 0.205) continue;
        if (p.z < 0.065) continue;
        let nx = h.normal.x;
        let ny = h.normal.y;
        let nz = h.normal.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        const score = -p.z * 5 - Math.abs(p.x) * 20;
        if (!best || score > best.score) {
          best = { score, pos: [p.x, p.y, p.z], norm: [nx / len, ny / len, nz / len] };
        }
      }
    }
    return best;
  });
  if (root) {
    const n = faceCam(root.norm, NOSE.orbit);
    console.log('FIX 鼻根', by['鼻根'].pos, '->', root.pos.map(fmt).join(' '));
    by['鼻根'].pos = root.pos.map(fmt).join(' ');
    by['鼻根'].norm = n.map(fmt).join(' ');
  } else console.log('NOHIT 鼻根');

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);

  for (const name of ['耳屏', '耳垂', '耳甲腔', '对耳轮', '鼻头', '鼻根']) {
    const pt = by[name];
    const cam = name.startsWith('鼻') ? NOSE : EAR;
    const tmp = path.join(outDir, `_s_${name}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({ ...data, pointsData: [{ ...pt, id: 1 }], camera: { ...cam }, timestamp: Date.now() }, null, 2)
    );
    await page.evaluate(() => {
      const i = document.getElementById('file-input');
      if (i) i.value = '';
    });
    await page.setInputFiles('#file-input', tmp);
    await page.waitForFunction((e) => {
      const i = document.querySelector('#points-list .point-text-input');
      return i && i.value === e;
    }, name, { timeout: 60000 });
    await page.waitForTimeout(140);
    await page.evaluate((c) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-target', c.target);
      v.setAttribute('camera-orbit', c.orbit);
      v.setAttribute('field-of-view', c.fov);
      try {
        v.cameraTarget = c.target;
        v.cameraOrbit = c.orbit;
        v.fieldOfView = c.fov;
        if (v.jumpCameraToGoal) v.jumpCameraToGoal();
      } catch (_e) {}
    }, cam);
    await page.waitForTimeout(130);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `solo_${name}.png`) });
    console.log('SHOT', name);
  }

  console.log(JSON.stringify({ ok: true, outDir }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
