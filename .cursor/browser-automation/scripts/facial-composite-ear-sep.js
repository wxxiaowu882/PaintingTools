/**
 * 耳点：55deg 略偏正面，颊/耳在景深上分开；密网格 + 分点硬约束。
 * 耳屏：高 u（靠耳）且 z 前向；耳轮：高 x 负 z；耳垂：低 y。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-ear-sep`);

const EAR = { orbit: '55deg 88deg 0.24m', target: '0.060m 0.155m 0.018m', fov: '13deg' };
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
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.55, r.top + r.height * 0.45);
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
  await page.waitForTimeout(300);
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean.png') });
  console.log('CLOUD');

  const cloud = await page.evaluate(() => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const pts = [];
    for (let v = 0.12; v <= 0.82; v += 0.02) {
      for (let u = 0.35; u <= 0.88; u += 0.02) {
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * u, rect.top + rect.height * v);
        if (!h) continue;
        const p = h.position;
        if (p.x < 0.05 || p.x > 0.09) continue;
        if (p.y < 0.11 || p.y > 0.205) continue;
        if (p.z < -0.045 || p.z > 0.045) continue;
        let nx = h.normal.x;
        let ny = h.normal.y;
        let nz = h.normal.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        pts.push({
          u: +u.toFixed(3),
          v: +v.toFixed(3),
          x: p.x,
          y: p.y,
          z: p.z,
          n: [nx / len, ny / len, nz / len],
        });
      }
    }
    return pts;
  });
  console.log('N', cloud.length);
  fs.writeFileSync(path.join(outDir, 'cloud.json'), JSON.stringify(cloud, null, 2));

  const pick = (fn, score) => {
    let b = null;
    for (const p of cloud) {
      if (!fn(p)) continue;
      const s = score(p);
      if (!b || s > b._s) b = { ...p, _s: s };
    }
    return b;
  };

  // 调试：前向且偏耳
  const dbg = cloud
    .filter((p) => p.x >= 0.058 && p.z >= 0.01 && p.y > 0.148 && p.y < 0.168)
    .sort((a, b) => b.x - a.x || b.z - a.z)
    .slice(0, 10)
    .map((p) => ({ u: p.u, v: p.v, x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4) }));
  console.log('DBG_TRAG', JSON.stringify(dbg));

  const picks = {
    // 耳屏：宁可 x 更大（贴耳），不要落在颊（颊往往 x 更小）
    耳屏: pick(
      (p) => p.x >= 0.06 && p.x <= 0.068 && p.z >= 0.012 && p.z <= 0.028 && p.y >= 0.15 && p.y <= 0.166 && p.u >= 0.45,
      (p) => p.x * 15 + p.z * 6 - Math.abs(p.y - 0.157) * 8
    ),
    前缺口: pick(
      (p) => p.x >= 0.059 && p.z >= 0.01 && p.z <= 0.028 && p.y >= 0.155 && p.y <= 0.172 && p.u >= 0.42,
      (p) => p.x * 10 + p.z * 5
    ),
    耳甲腔: pick(
      (p) => p.x >= 0.06 && p.z >= -0.005 && p.z <= 0.015 && p.y >= 0.148 && p.y <= 0.168 && p.u >= 0.5,
      (p) => p.x * 8 - Math.abs(p.z - 0.005) * 5
    ),
    对耳轮: pick(
      (p) => p.x >= 0.062 && p.z >= -0.015 && p.z <= 0.008 && p.y >= 0.155 && p.y <= 0.178 && p.u >= 0.52,
      (p) => p.x * 8 - Math.abs(p.z) * 2
    ),
    耳轮: pick(
      (p) => p.x >= 0.066 && p.z <= -0.01 && p.y >= 0.17 && p.y <= 0.195 && p.u >= 0.58,
      (p) => p.x * 10 - p.z * 4 + p.y
    ),
    耳垂: pick(
      (p) => p.x >= 0.054 && p.y >= 0.118 && p.y <= 0.142 && p.z >= -0.02 && p.z <= 0.02 && p.u >= 0.48,
      (p) => p.x * 12 - p.y * 3 - Math.abs(p.z) * 2
    ),
    对耳屏: pick(
      (p) => p.x >= 0.058 && p.y >= 0.132 && p.y <= 0.152 && p.z >= -0.005 && p.z <= 0.02 && p.u >= 0.48,
      (p) => p.x * 8
    ),
    凹入缺口: pick(
      (p) => p.x >= 0.058 && p.y >= 0.14 && p.y <= 0.158 && p.z >= 0.006 && p.z <= 0.025 && p.u >= 0.45,
      (p) => p.x * 8 + p.z * 4
    ),
  };

  for (const [name, hit] of Object.entries(picks)) {
    if (!hit) {
      console.log('NOHIT', name);
      continue;
    }
    const pt = by[name];
    if (!pt) continue;
    const n = faceCam(hit.n, EAR.orbit);
    const pos = [hit.x, hit.y, hit.z].map(fmt).join(' ');
    console.log('FIX', name, pt.pos, '->', pos, `uv=${hit.u},${hit.v}`);
    pt.pos = pos;
    pt.norm = n.map(fmt).join(' ');
  }

  // 鼻根回中线
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
    for (let v = 0.1; v <= 0.28; v += 0.01) {
      for (let u = 0.47; u <= 0.53; u += 0.01) {
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * u, rect.top + rect.height * v);
        if (!h) continue;
        const p = h.position;
        if (Math.abs(p.x) > 0.0025) continue;
        if (p.y < 0.19 || p.y > 0.205) continue;
        if (p.z < 0.065 || p.z > 0.09) continue;
        let nx = h.normal.x;
        let ny = h.normal.y;
        let nz = h.normal.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        const score = -p.z * 6 - Math.abs(p.x) * 30;
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

  for (const name of ['耳屏', '耳垂', '耳甲腔', '对耳轮', '耳轮', '鼻头', '鼻根']) {
    const pt = by[name];
    if (!pt) continue;
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
    await page.waitForTimeout(120);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `solo_${name}.png`) });
    console.log('SHOT', name);
  }

  console.log(JSON.stringify({ ok: true, outDir }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
