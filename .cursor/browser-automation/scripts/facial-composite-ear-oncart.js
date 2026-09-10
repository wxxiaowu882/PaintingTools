/**
 * 耳屏/耳垂/耳甲：在耳屏右半屏（高 u）拾取；不强制 z>0（55deg 下耳面常为负 z）。
 * 耳轮已视觉通过，本脚本不改 耳轮。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-ear-oncart`);

const EAR = { orbit: '55deg 88deg 0.24m', target: '0.060m 0.155m 0.018m', fov: '13deg' };
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

/** 耳轮已验证 uv≈0.85,0.12；耳块约 u0.60–0.90。tragus 在耳块左缘。 */
const PICKS = [
  { text: '耳屏', u: 0.64, v: 0.42 },
  { text: '前缺口', u: 0.62, v: 0.36 },
  { text: '耳甲腔', u: 0.70, v: 0.44 },
  { text: '对耳轮', u: 0.72, v: 0.36 },
  { text: '耳垂', u: 0.74, v: 0.58 },
  { text: '对耳屏', u: 0.68, v: 0.52 },
  { text: '凹入缺口', u: 0.66, v: 0.50 },
  { text: '三角凹', u: 0.72, v: 0.28 },
  { text: '耳甲艇', u: 0.68, v: 0.34 },
  { text: '舟状凹', u: 0.78, v: 0.32 },
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
  await page.setInputFiles('#file-input', empty);
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && (v.getAttribute('src') || '').includes('石膏');
  }, null, { timeout: 180000 });
  for (let i = 0; i < 50; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.7, r.top + r.height * 0.35);
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
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean.png') });
  console.log('PICK');

  const hits = await page.evaluate((specs) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const out = [];
    for (const s of specs) {
      const cx = rect.left + rect.width * s.u;
      const cy = rect.top + rect.height * s.v;
      let best = null;
      for (let rad = 0; rad <= 12; rad += 2) {
        const nAng = rad === 0 ? 1 : 8;
        for (let a = 0; a < nAng; a++) {
          const ang = (a * Math.PI) / 4;
          const ox = rad === 0 ? 0 : Math.round(rad * Math.cos(ang));
          const oy = rad === 0 ? 0 : Math.round(rad * Math.sin(ang));
          const h = viewer.positionAndNormalFromPoint(cx + ox, cy + oy);
          if (!h) continue;
          const p = h.position;
          // 耳软骨带：x 够大，落在耳屏右半屏
          if (p.x < 0.058) continue;
          if (p.x > 0.085) continue;
          if (p.y < 0.115 || p.y > 0.2) continue;
          if (p.z < -0.045 || p.z > 0.03) continue;
          let nx = h.normal.x;
          let ny = h.normal.y;
          let nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          // 偏好：靠近点击、x 大、法线偏侧向；耳屏额外偏好相对前向
          let score = p.x * 10 + nx * 3 - rad * 0.25;
          if (s.text === '耳屏' || s.text === '前缺口') score += p.z * 8;
          if (s.text === '耳垂') score += -p.y * 4;
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
    if (!pt) continue;
    const n = faceCam(row.hit.norm, EAR.orbit);
    const pos = row.hit.pos.map(fmt).join(' ');
    console.log('FIX', row.text, pt.pos, '->', pos, `uv=${row.hit.u},${row.hit.v} rad=${row.hit.rad}`);
    pt.pos = pos;
    pt.norm = n.map(fmt).join(' ');
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);

  for (const name of ['耳屏', '耳垂', '耳甲腔', '对耳轮', '耳轮', '前缺口']) {
    const pt = by[name];
    if (!pt) continue;
    const tmp = path.join(outDir, `_s_${name}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({ ...data, pointsData: [{ ...pt, id: 1 }], camera: { ...EAR }, timestamp: Date.now() }, null, 2)
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
    await page.waitForTimeout(130);
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
