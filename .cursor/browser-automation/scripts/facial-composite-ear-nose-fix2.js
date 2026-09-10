/**
 * 耳/鼻关键点快速纠偏：更紧耳相机 + 更严 x/z 带；鼻头取 tip 球带最大 +z。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-ear-nose-fix2`);

const EAR_CAM = {
  orbit: '100deg 88deg 0.22m',
  target: '0.065m 0.158m 0.0m',
  fov: '12deg',
};
const NOSE_CAM = {
  orbit: '0deg 88deg 0.26m',
  target: '0.0m 0.158m 0.090m',
  fov: '13deg',
};

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
const fmt = (v) => `${v.toFixed(4)}m`;

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
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
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
  }, cam);
  await page.waitForTimeout(280);
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

  // ---- EAR ----
  console.log('EAR_LOAD');
  await loadEmpty(page, data, EAR_CAM, 'ear');
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean_ear.png') });

  const earHits = await page.evaluate(() => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const pts = [];
    // 只扫耳廓带：画面偏右上
    for (let v = 0.12; v <= 0.78; v += 0.025) {
      for (let u = 0.35; u <= 0.85; u += 0.025) {
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * u, rect.top + rect.height * v);
        if (!h) continue;
        const p = h.position;
        // 耳廓：x 够大，勿落面颊（面颊 z 偏大）
        if (p.x < 0.055 || p.x > 0.085) continue;
        if (p.z > 0.032 || p.z < -0.035) continue;
        if (p.y < 0.110 || p.y > 0.200) continue;
        let nx = h.normal.x;
        let ny = h.normal.y;
        let nz = h.normal.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        pts.push({ u, v, x: p.x, y: p.y, z: p.z, n: [nx, ny, nz] });
      }
    }
    function best(filter, scoreFn) {
      let b = null;
      for (const p of pts) {
        if (!filter(p)) continue;
        const s = scoreFn(p);
        if (!b || s > b.s) b = { ...p, s };
      }
      return b;
    }
    return {
      耳轮: best((p) => p.y > 0.168 && p.z < 0.005, (p) => p.x * 5 - p.z * 3 + p.y),
      耳廓结节: best((p) => p.y > 0.165 && p.z < -0.005, (p) => p.x * 4 - p.z * 4),
      耳屏: best((p) => p.y > 0.145 && p.y < 0.170 && p.z > 0.012, (p) => p.z * 10 + p.x * 2),
      对耳轮: best((p) => p.y > 0.150 && p.y < 0.175 && p.z > -0.01 && p.z < 0.015, (p) => p.x * 3 - Math.abs(p.z - 0.0) * 2),
      耳甲腔: best((p) => p.y > 0.145 && p.y < 0.165 && p.z > 0.0 && p.z < 0.02, (p) => -Math.abs(p.z - 0.01) * 3 + p.x),
      耳垂: best((p) => p.y < 0.140 && p.y > 0.115, (p) => p.x * 6 - Math.abs(p.z) * 2 - p.y),
      对耳屏: best((p) => p.y > 0.130 && p.y < 0.150 && p.z > -0.005 && p.z < 0.02, (p) => p.x * 3),
      前缺口: best((p) => p.y > 0.155 && p.y < 0.175 && p.z > 0.01, (p) => p.z * 6 + p.x),
      凹入缺口: best((p) => p.y > 0.135 && p.y < 0.155 && p.z > 0.005, (p) => p.z * 4 + p.x),
      耳轮脚: best((p) => p.y > 0.160 && p.y < 0.180 && p.z > 0.0 && p.z < 0.02, (p) => p.x * 2 + p.z),
      三角凹: best((p) => p.y > 0.170 && p.y < 0.190 && p.z > -0.01 && p.z < 0.015, (p) => p.x * 3),
      舟状凹: best((p) => p.y > 0.155 && p.y < 0.180 && p.z < 0.0, (p) => p.x * 3 - p.z),
      耳甲艇: best((p) => p.y > 0.160 && p.y < 0.178 && p.z > 0.0 && p.z < 0.02, (p) => p.x * 2),
      对耳轮上脚: best((p) => p.y > 0.168 && p.y < 0.188 && p.z > -0.01 && p.z < 0.015, (p) => p.x * 3),
      对耳轮下脚: best((p) => p.y > 0.155 && p.y < 0.175 && p.z > 0.0 && p.z < 0.02, (p) => p.x * 3),
      n: pts.length,
    };
  });
  console.log('EAR_CANDS', earHits.n);
  for (const [name, hit] of Object.entries(earHits)) {
    if (name === 'n') continue;
    if (!hit) {
      console.log('NOHIT', name);
      continue;
    }
    const pt = by[name];
    if (!pt) continue;
    const n = faceCam(hit.n, EAR_CAM.orbit);
    const pos = [hit.x, hit.y, hit.z].map(fmt).join(' ');
    console.log('FIX', name, pt.pos, '->', pos);
    pt.pos = pos;
    pt.norm = n.map(fmt).join(' ');
  }

  // ---- NOSE tip / bridge ----
  console.log('NOSE_LOAD');
  await loadEmpty(page, data, NOSE_CAM, 'nose');
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean_nose.png') });
  const noseHits = await page.evaluate(() => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const pts = [];
    for (let v = 0.10; v <= 0.70; v += 0.02) {
      for (let u = 0.35; u <= 0.65; u += 0.02) {
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * u, rect.top + rect.height * v);
        if (!h) continue;
        const p = h.position;
        if (p.z < 0.06) continue;
        if (p.y < 0.125 || p.y > 0.210) continue;
        let nx = h.normal.x;
        let ny = h.normal.y;
        let nz = h.normal.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        pts.push({ u, v, x: p.x, y: p.y, z: p.z, n: [nx, ny, nz] });
      }
    }
    function best(filter, scoreFn) {
      let b = null;
      for (const p of pts) {
        if (!filter(p)) continue;
        const s = scoreFn(p);
        if (!b || s > b.s) b = { ...p, s };
      }
      return b;
    }
    return {
      鼻根: best((p) => Math.abs(p.x) < 0.008 && p.y > 0.190, (p) => -p.z * 2 + p.y), // 最凹略偏
      鼻梁: best((p) => Math.abs(p.x) < 0.008 && p.y > 0.165 && p.y < 0.185, (p) => p.z * 10),
      鼻头: best((p) => Math.abs(p.x) < 0.01 && p.y > 0.148 && p.y < 0.162, (p) => p.z * 12 - Math.abs(p.y - 0.155) * 4),
      鼻翼: best((p) => p.x > 0.012 && p.x < 0.028 && p.y > 0.145 && p.y < 0.160, (p) => p.z * 8),
      鼻底: best((p) => Math.abs(p.x) < 0.01 && p.y > 0.136 && p.y < 0.146, (p) => p.z * 8),
      鼻中隔: best((p) => Math.abs(p.x) < 0.008 && p.y > 0.134 && p.y < 0.145, (p) => p.z * 8),
      n: pts.length,
    };
  });
  console.log('NOSE_CANDS', noseHits.n);
  const noseMap = { 鼻梁: '鼻梁(鼻背)' };
  for (const [key, hit] of Object.entries(noseHits)) {
    if (key === 'n') continue;
    const name = noseMap[key] || key;
    if (!hit) {
      console.log('NOHIT', name);
      continue;
    }
    const pt = by[name];
    if (!pt) continue;
    const n = faceCam(hit.n, NOSE_CAM.orbit);
    const pos = [hit.x, hit.y, hit.z].map(fmt).join(' ');
    console.log('FIX', name, pt.pos, '->', pos);
    pt.pos = pos;
    pt.norm = n.map(fmt).join(' ');
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);

  // solos
  for (const [name, cam] of [
    ['耳轮', EAR_CAM],
    ['耳屏', EAR_CAM],
    ['耳垂', EAR_CAM],
    ['对耳轮', EAR_CAM],
    ['耳甲腔', EAR_CAM],
    ['鼻头', NOSE_CAM],
    ['鼻梁(鼻背)', NOSE_CAM],
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
    await page.waitForTimeout(220);
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
    await page.waitForTimeout(200);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `solo_${name}.png`) });
    console.log('SHOT', name);
  }

  console.log(JSON.stringify({ ok: true, outDir }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
