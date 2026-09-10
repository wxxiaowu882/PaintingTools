/**
 * 耳(+x) + 鼻头等：档案内嵌拉近相机 + 屏幕 uv；耳点强制落在耳廓带。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-ear-nose-uv`);

const EAR_CAM = {
  orbit: '88deg 90deg 0.26m',
  target: '0.062m 0.155m 0.005m',
  fov: '14deg',
};
const NOSE_CAM = {
  orbit: '0deg 92deg 0.28m',
  target: '0.0m 0.155m 0.09m',
  fov: '14deg',
};
const NOSE_UP_CAM = {
  orbit: '5deg 128deg 0.28m',
  target: '0.0m 0.130m 0.070m',
  fov: '15deg',
};

/** clean_ear：耳在画面右上；u 小=靠前(+z)，u 大=靠后 */
const EAR_PICKS = [
  { text: '耳轮', u: 0.66, v: 0.28, xMin: 0.058, zMin: -0.03, zMax: 0.01 },
  { text: '耳廓结节', u: 0.70, v: 0.30, xMin: 0.060, zMin: -0.03, zMax: 0.005 },
  { text: '耳轮脚', u: 0.52, v: 0.36, xMin: 0.055, zMin: -0.005, zMax: 0.025 },
  { text: '三角凹', u: 0.58, v: 0.33, xMin: 0.058, zMin: -0.01, zMax: 0.02 },
  { text: '对耳轮上脚', u: 0.60, v: 0.34, xMin: 0.058, zMin: -0.01, zMax: 0.02 },
  { text: '对耳轮下脚', u: 0.55, v: 0.40, xMin: 0.055, zMin: 0.0, zMax: 0.025 },
  { text: '对耳轮', u: 0.56, v: 0.44, xMin: 0.055, zMin: -0.005, zMax: 0.02 },
  { text: '舟状凹', u: 0.64, v: 0.38, xMin: 0.060, zMin: -0.025, zMax: 0.01 },
  { text: '耳甲艇', u: 0.54, v: 0.38, xMin: 0.055, zMin: 0.0, zMax: 0.025 },
  { text: '耳甲腔', u: 0.52, v: 0.48, xMin: 0.052, zMin: 0.0, zMax: 0.03 },
  { text: '前缺口', u: 0.42, v: 0.42, xMin: 0.052, zMin: 0.01, zMax: 0.035 },
  { text: '耳屏', u: 0.40, v: 0.48, xMin: 0.050, zMin: 0.015, zMax: 0.04 },
  { text: '凹入缺口', u: 0.46, v: 0.54, xMin: 0.050, zMin: 0.005, zMax: 0.03 },
  { text: '对耳屏', u: 0.52, v: 0.56, xMin: 0.048, zMin: -0.005, zMax: 0.025 },
  { text: '耳垂', u: 0.55, v: 0.68, xMin: 0.048, zMin: -0.015, zMax: 0.02 },
];

const NOSE_PICKS = [
  { text: '鼻根', u: 0.50, v: 0.14, yMin: 0.188, yMax: 0.205, prefer: 'z' },
  { text: '鼻梁(鼻背)', u: 0.50, v: 0.34, yMin: 0.165, yMax: 0.180, prefer: 'z' },
  { text: '鼻头', u: 0.50, v: 0.50, yMin: 0.150, yMax: 0.162, prefer: 'z' },
  { text: '鼻翼', u: 0.62, v: 0.52, yMin: 0.145, yMax: 0.160, prefer: 'z' },
];

const NOSE_UP_PICKS = [
  { text: '鼻底', u: 0.50, v: 0.42, yMin: 0.135, yMax: 0.148, prefer: 'z' },
  { text: '鼻中隔', u: 0.50, v: 0.40, yMin: 0.135, yMax: 0.148, prefer: 'z' },
  { text: '鼻翼脚', u: 0.62, v: 0.48, yMin: 0.132, yMax: 0.148, prefer: 'z' },
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

const fmt = (v) => `${v.toFixed(4)}m`;

async function warm(page, data, cam, tag) {
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
  }, null, { timeout: 180000 });
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.5);
    });
    if (ok) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(400);
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
    v.setAttribute('field-of-view', c.fov);
    try {
      v.cameraTarget = c.target;
      v.cameraOrbit = c.orbit;
      v.fieldOfView = c.fov;
      if (v.jumpCameraToGoal) v.jumpCameraToGoal();
    } catch (_e) {}
  }, cam);
  await page.waitForTimeout(350);
}

async function pick(page, picks, mode) {
  return page.evaluate(({ picks, mode }) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const out = [];
    for (const spec of picks) {
      const cx = rect.left + rect.width * spec.u;
      const cy = rect.top + rect.height * spec.v;
      let best = null;
      for (let rad = 0; rad <= 18; rad += 2) {
        const nAng = rad === 0 ? 1 : 8;
        for (let a = 0; a < nAng; a++) {
          const ang = (a * Math.PI) / 4;
          const ox = rad === 0 ? 0 : Math.round(rad * Math.cos(ang));
          const oy = rad === 0 ? 0 : Math.round(rad * Math.sin(ang));
          const h = viewer.positionAndNormalFromPoint(cx + ox, cy + oy);
          if (!h) continue;
          const p = h.position;
          if (mode === 'ear') {
            if (p.x < (spec.xMin != null ? spec.xMin : 0.048)) continue;
            if (p.x > 0.085) continue;
            if (p.z < (spec.zMin != null ? spec.zMin : -0.03)) continue;
            if (p.z > (spec.zMax != null ? spec.zMax : 0.04)) continue;
            if (p.y < 0.105 || p.y > 0.205) continue;
          } else {
            if (Math.abs(p.x) > 0.035 && !String(spec.text).includes('翼')) continue;
            if (spec.yMin != null && p.y < spec.yMin) continue;
            if (spec.yMax != null && p.y > spec.yMax) continue;
            if (p.z < 0.05) continue;
          }
          let nx = h.normal.x;
          let ny = h.normal.y;
          let nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          let score;
          if (mode === 'ear') {
            score = p.x * 6 + Math.abs(p.z) * -1 + nz * 0.5 - rad * 0.04;
            if (spec.text === '耳屏') score = p.z * 8 + p.x * 3 - rad * 0.04;
            if (spec.text === '耳垂') score = -p.y * 4 + p.x * 5 - Math.abs(p.z) * 2 - rad * 0.04;
          } else {
            score = p.z * 10 - Math.abs(p.x) * 4 - rad * 0.04;
          }
          if (!best || score > best.score) {
            best = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz], u: spec.u, v: spec.v };
          }
        }
      }
      out.push({ text: spec.text, hit: best });
    }
    return out;
  }, { picks, mode });
}

async function applyHits(by, hits, orbit) {
  for (const row of hits) {
    if (!row.hit) {
      console.log('NOHIT', row.text);
      continue;
    }
    const pt = by[row.text];
    if (!pt) {
      console.log('MISSING', row.text);
      continue;
    }
    const n = faceCam(row.hit.norm, orbit);
    const pos = row.hit.pos.map(fmt).join(' ');
    const norm = n.map(fmt).join(' ');
    console.log('FIX', row.text, pt.pos, '->', pos, `uv=${row.hit.u},${row.hit.v}`);
    pt.pos = pos;
    pt.norm = norm;
  }
}

async function solo(page, data, by, names, cam, prefix) {
  for (const name of names) {
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
    }, cam);
    await page.waitForTimeout(220);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `${prefix}_${name}.png`) });
  }
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

  await warm(page, data, EAR_CAM, 'ear');
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean_ear.png') });
  await applyHits(by, await pick(page, EAR_PICKS, 'ear'), EAR_CAM.orbit);

  await warm(page, data, NOSE_CAM, 'nose');
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean_nose.png') });
  await applyHits(by, await pick(page, NOSE_PICKS, 'nose'), NOSE_CAM.orbit);

  await warm(page, data, NOSE_UP_CAM, 'nose_up');
  await applyHits(by, await pick(page, NOSE_UP_PICKS, 'nose'), NOSE_UP_CAM.orbit);

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);

  await solo(page, data, by, ['耳轮', '耳屏', '耳垂', '对耳轮', '耳甲腔'], EAR_CAM, 'solo');
  await solo(page, data, by, ['鼻头', '鼻梁(鼻背)', '鼻中隔', '鼻翼'], NOSE_CAM, 'solo');

  console.log(JSON.stringify({ ok: true, outDir }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
