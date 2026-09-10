/**
 * 耳关键点：强制 x>=0.060（颊面通常更小），按屏幕 uv 近邻取点，不追高 z。
 * 鼻根拉回中线。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-ear-x060`);

const EAR = { orbit: '100deg 88deg 0.22m', target: '0.065m 0.158m 0.0m', fov: '12deg' };
const NOSE = { orbit: '0deg 80deg 0.20m', target: '0.0m 0.158m 0.092m', fov: '10deg' };
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

/** clean_ear：耳在右上。uv 估在耳软骨上（勿偏左到颊）。 */
const EAR_UV = [
  { text: '耳屏', u: 0.56, v: 0.48 },
  { text: '耳垂', u: 0.62, v: 0.70 },
  { text: '耳甲腔', u: 0.58, v: 0.50 },
  { text: '对耳轮', u: 0.64, v: 0.42 },
  { text: '对耳屏', u: 0.60, v: 0.58 },
  { text: '前缺口', u: 0.54, v: 0.44 },
  { text: '凹入缺口', u: 0.56, v: 0.55 },
  { text: '耳轮脚', u: 0.55, v: 0.38 },
  { text: '耳甲艇', u: 0.58, v: 0.40 },
  { text: '三角凹', u: 0.62, v: 0.34 },
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
  console.log('DOM');
  await page.waitForSelector('#file-input', { state: 'attached' });
  console.log('INPUT');

  const empty = path.join(outDir, '_e.json');
  fs.writeFileSync(
    empty,
    JSON.stringify({ ...data, pointsData: [], camera: { ...EAR }, timestamp: Date.now() }, null, 2)
  );
  console.log('LOAD_EMPTY');
  await page.setInputFiles('#file-input', empty);
  console.log('WAIT_MODEL');
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && (v.getAttribute('src') || '').includes('石膏');
  }, null, { timeout: 180000 });
  console.log('MODEL_SRC_OK');
  for (let i = 0; i < 50; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.6, r.top + r.height * 0.4);
    });
    if (ok) {
      console.log('RAY_OK', i);
      break;
    }
    await page.waitForTimeout(120);
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
  console.log('PICK_START');

  const hits = await page.evaluate((specs) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const out = [];
    for (const s of specs) {
      const cx = rect.left + rect.width * s.u;
      const cy = rect.top + rect.height * s.v;
      let best = null;
      for (let rad = 0; rad <= 18; rad += 2) {
        const nAng = rad === 0 ? 1 : 8;
        for (let a = 0; a < nAng; a++) {
          const ang = (a * Math.PI * 2) / nAng;
          const ox = rad === 0 ? 0 : Math.round(rad * Math.cos(ang));
          const oy = rad === 0 ? 0 : Math.round(rad * Math.sin(ang));
          const h = viewer.positionAndNormalFromPoint(cx + ox, cy + oy);
          if (!h) continue;
          const p = h.position;
          // 硬门槛：落在耳廓外侧，拒绝颊
          if (p.x < 0.06) continue;
          if (p.x > 0.085) continue;
          if (p.y < 0.112 || p.y > 0.2) continue;
          if (p.z < -0.04 || p.z > 0.03) continue;
          let nx = h.normal.x;
          let ny = h.normal.y;
          let nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          // 偏好：靠近点击中心、x 更大（更贴耳）、不要追 z
          const score = p.x * 12 - rad * 0.15 + nx * 2;
          if (!best || score > best.score) {
            best = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz], rad, u: s.u, v: s.v };
          }
        }
      }
      out.push({ text: s.text, hit: best });
    }
    return out;
  }, EAR_UV);

  for (const row of hits) {
    if (!row.hit) {
      console.log('NOHIT', row.text);
      continue;
    }
    const pt = by[row.text];
    if (!pt) continue;
    const n = faceCam(row.hit.norm, EAR.orbit);
    const pos = row.hit.pos.map(fmt).join(' ');
    console.log('FIX', row.text, pt.pos, '->', pos, `uv=${row.hit.u},${row.hit.v} rad=${row.hit.rad}`);
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
  }, null, { timeout: 120000 });
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

  const nose = await page.evaluate(() => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    let root = null;
    let tip = null;
    for (let v = 0.08; v <= 0.55; v += 0.012) {
      for (let u = 0.46; u <= 0.54; u += 0.01) {
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * u, rect.top + rect.height * v);
        if (!h) continue;
        const p = h.position;
        if (Math.abs(p.x) > 0.0035) continue;
        if (p.z < 0.065) continue;
        let nx = h.normal.x;
        let ny = h.normal.y;
        let nz = h.normal.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        if (p.y >= 0.19 && p.y <= 0.205) {
          const score = -p.z * 4 - Math.abs(p.x) * 10;
          if (!root || score > root.score) root = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz] };
        }
        if (p.y >= 0.155 && p.y <= 0.166 && p.z >= 0.08) {
          const score = p.z * 15 - Math.abs(p.x) * 10 - Math.abs(p.y - 0.16) * 5;
          if (!tip || score > tip.score) tip = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz] };
        }
      }
    }
    return { 鼻根: root, 鼻头: tip };
  });

  for (const [name, hit] of Object.entries(nose)) {
    if (!hit) {
      console.log('NOHIT', name);
      continue;
    }
    const pt = by[name];
    const n = faceCam(hit.norm, NOSE.orbit);
    const pos = hit.pos.map(fmt).join(' ');
    console.log('FIX', name, pt.pos, '->', pos);
    pt.pos = pos;
    pt.norm = n.map(fmt).join(' ');
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);

  for (const [name, cam] of [
    ['耳屏', EAR],
    ['耳垂', EAR],
    ['耳甲腔', EAR],
    ['对耳轮', EAR],
    ['耳轮', EAR],
    ['鼻头', NOSE],
    ['鼻根', NOSE],
  ]) {
    const pt = by[name];
    if (!pt) continue;
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
    await page.waitForTimeout(150);
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
    await page.waitForTimeout(140);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `solo_${name}.png`) });
    console.log('SHOT', name);
  }

  console.log(JSON.stringify({ ok: true, outDir }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
