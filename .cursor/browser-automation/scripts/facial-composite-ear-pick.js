/**
 * 耳廓点云筛选 + 鼻中线纠偏（快速）。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-ear-pick`);

const EAR = { orbit: '100deg 88deg 0.22m', target: '0.065m 0.158m 0.0m', fov: '12deg' };
const NOSE = { orbit: '0deg 85deg 0.22m', target: '0.0m 0.156m 0.090m', fov: '11deg' };
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

async function jump(page, cam) {
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
}

async function loadEmpty(page, data, cam, tag) {
  const empty = path.join(outDir, `_e_${tag}.json`);
  fs.writeFileSync(
    empty,
    JSON.stringify({ ...data, pointsData: [], camera: { ...cam }, timestamp: Date.now() }, null, 2)
  );
  await page.evaluate(() => {
    const i = document.getElementById('file-input');
    if (i) i.value = '';
  });
  await page.setInputFiles('#file-input', empty);
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && (v.getAttribute('src') || '').includes('石膏');
  }, null, { timeout: 120000 });
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.55, r.top + r.height * 0.4);
    });
    if (ok) break;
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
  await jump(page, cam);
  await page.waitForTimeout(250);
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

  await loadEmpty(page, data, EAR, 'ear');
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean_ear.png') });

  const cloud = await page.evaluate(() => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const pts = [];
    for (let v = 0.08; v <= 0.85; v += 0.02) {
      for (let u = 0.3; u <= 0.92; u += 0.02) {
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * u, rect.top + rect.height * v);
        if (!h) continue;
        const p = h.position;
        if (p.x < 0.05 || p.x > 0.09) continue;
        if (p.y < 0.105 || p.y > 0.205) continue;
        if (p.z < -0.045 || p.z > 0.04) continue;
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
  console.log('CLOUD', cloud.length);

  function pick(fn, score) {
    let b = null;
    for (const p of cloud) {
      if (!fn(p)) continue;
      const s = score(p);
      if (!b || s > b._s) b = { ...p, _s: s };
    }
    return b;
  }

  const fwd = [...cloud]
    .filter((p) => p.z > 0.015 && p.x > 0.055)
    .sort((a, b) => b.z - a.z)
    .slice(0, 8)
    .map((p) => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4), u: p.u, v: p.v }));
  console.log('FWD', JSON.stringify(fwd));

  const picks = {
    耳轮: pick((p) => p.y > 0.17 && p.z < -0.005 && p.x > 0.062, (p) => p.x * 3 - p.z * 2 + p.y),
    耳屏: pick(
      (p) => p.y > 0.148 && p.y < 0.168 && p.z > 0.015 && p.x > 0.055 && p.x < 0.068,
      (p) => p.z * 10 + p.x * 2 - Math.abs(p.y - 0.157) * 8
    ),
    耳垂: pick((p) => p.y < 0.138 && p.y > 0.112 && p.x > 0.052, (p) => p.x * 8 - Math.abs(p.z) * 3 - p.y * 2),
    对耳轮: pick(
      (p) => p.y > 0.152 && p.y < 0.175 && p.z > -0.008 && p.z < 0.012 && p.x > 0.058,
      (p) => p.x * 4 - Math.abs(p.z) * 2
    ),
    耳甲腔: pick(
      (p) => p.y > 0.148 && p.y < 0.168 && p.z > 0.0 && p.z < 0.018 && p.x > 0.056,
      (p) => p.x * 3 - Math.abs(p.z - 0.008) * 4
    ),
    对耳屏: pick(
      (p) => p.y > 0.132 && p.y < 0.15 && p.z > -0.005 && p.z < 0.018 && p.x > 0.054,
      (p) => p.x * 4
    ),
    前缺口: pick((p) => p.y > 0.155 && p.y < 0.172 && p.z > 0.012 && p.x > 0.055, (p) => p.z * 6 + p.x),
    凹入缺口: pick((p) => p.y > 0.138 && p.y < 0.155 && p.z > 0.008 && p.x > 0.054, (p) => p.z * 5 + p.x),
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
    console.log('FIX', name, pt.pos, '->', pos, 'uv', hit.u, hit.v);
    pt.pos = pos;
    pt.norm = n.map(fmt).join(' ');
  }

  await loadEmpty(page, data, NOSE, 'nose');
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean_nose.png') });
  const nose = await page.evaluate(() => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const pts = [];
    for (let v = 0.1; v <= 0.65; v += 0.015) {
      for (let u = 0.4; u <= 0.6; u += 0.015) {
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * u, rect.top + rect.height * v);
        if (!h) continue;
        const p = h.position;
        if (p.z < 0.065) continue;
        let nx = h.normal.x;
        let ny = h.normal.y;
        let nz = h.normal.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        pts.push({ x: p.x, y: p.y, z: p.z, n: [nx / len, ny / len, nz / len] });
      }
    }
    function best(fn, sc) {
      let b = null;
      for (const p of pts) {
        if (!fn(p)) continue;
        const s = sc(p);
        if (!b || s > b._s) b = { ...p, _s: s };
      }
      return b;
    }
    return {
      鼻根: best((p) => Math.abs(p.x) < 0.005 && p.y > 0.19 && p.y < 0.205, (p) => -p.z * 5 + p.y),
      鼻头: best((p) => Math.abs(p.x) < 0.008 && p.y > 0.152 && p.y < 0.162, (p) => p.z * 15 - Math.abs(p.y - 0.156) * 5),
      鼻梁: best((p) => Math.abs(p.x) < 0.006 && p.y > 0.165 && p.y < 0.18, (p) => p.z * 15),
    };
  });
  const nmap = { 鼻梁: '鼻梁(鼻背)' };
  for (const [k, hit] of Object.entries(nose)) {
    const name = nmap[k] || k;
    if (!hit) {
      console.log('NOHIT', name);
      continue;
    }
    const pt = by[name];
    if (!pt) continue;
    const n = faceCam(hit.n, NOSE.orbit);
    const pos = [hit.x, hit.y, hit.z].map(fmt).join(' ');
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
    await page.waitForTimeout(180);
    await jump(page, cam);
    await page.waitForTimeout(160);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `solo_${name}.png`) });
    console.log('SHOT', name);
  }

  console.log(JSON.stringify({ ok: true, outDir }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
