/**
 * 把拉近眼区的相机写进临时 JSON，加载后即生效；再屏幕拾取眼点。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-eye-json-cam`);

const EYE_CAM = {
  orbit: '-20deg 88deg 0.32m',
  target: '-0.032m 0.182m 0.066m',
  fov: '18deg',
};

const PICKS = [
  { text: '虹膜', u: 0.50, v: 0.48 },
  { text: '角膜', u: 0.51, v: 0.45 },
  { text: '眼球', u: 0.52, v: 0.48 },
  { text: '内眦', u: 0.70, v: 0.52 },
  { text: '外眦', u: 0.26, v: 0.48 },
  { text: '上眼睑', u: 0.50, v: 0.36 },
  { text: '下眼睑', u: 0.50, v: 0.62 },
  { text: '巩白', u: 0.62, v: 0.48 },
  { text: '睑上沟', u: 0.50, v: 0.28 },
  { text: '睑眉沟', u: 0.50, v: 0.18 },
  { text: '卧蚕', u: 0.50, v: 0.72 },
  { text: '睑下沟', u: 0.50, v: 0.82 },
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

  const empty = {
    ...data,
    pointsData: [],
    snapshots: [],
    timestamp: Date.now(),
    camera: { ...EYE_CAM },
  };
  const emptyPath = path.join(outDir, '_empty_eye_cam.json');
  fs.writeFileSync(emptyPath, JSON.stringify(empty, null, 2));
  await page.setInputFiles('#file-input', emptyPath);
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && (v.getAttribute('src') || '').includes('石膏');
  }, null, { timeout: 180000 });
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.4);
    });
    if (ok) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const frame = document.getElementById('anno-mobile-frame-overlay');
    if (frame) frame.hidden = true;
  });

  // 再强制一次 API + jump
  const camInfo = await page.evaluate((c) => {
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
    const o = v.getCameraOrbit ? v.getCameraOrbit() : null;
    return {
      orbitStr: o ? o.toString() : v.getAttribute('camera-orbit'),
      radius: o && o.radius,
      fov: v.getFieldOfView ? v.getFieldOfView() : null,
      target: v.getCameraTarget ? v.getCameraTarget().toString() : v.getAttribute('camera-target'),
    };
  }, EYE_CAM);
  console.log('CAM', JSON.stringify(camInfo));
  await page.waitForTimeout(600);
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean_zoom.png') });

  const centerHit = await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    const r = v.getBoundingClientRect();
    const samples = [];
    for (const [u, v0] of [
      [0.5, 0.4],
      [0.5, 0.48],
      [0.4, 0.48],
      [0.6, 0.48],
      [0.3, 0.48],
      [0.7, 0.5],
    ]) {
      const h = v.positionAndNormalFromPoint(r.left + r.width * u, r.top + r.height * v0);
      if (h) samples.push({ u, v: v0, x: +h.position.x.toFixed(4), y: +h.position.y.toFixed(4), z: +h.position.z.toFixed(4) });
    }
    return samples;
  });
  console.log('SAMPLES', JSON.stringify(centerHit));
  fs.writeFileSync(path.join(outDir, 'cam.json'), JSON.stringify({ camInfo, centerHit }, null, 2));

  // 若半径仍 >0.5，放弃屏幕估 uv，改用世界盒在当前可见命中里选
  const useBox = !(camInfo.radius && camInfo.radius < 0.45);
  console.log('useBox', useBox, 'radius', camInfo.radius);

  let hits;
  if (!useBox) {
    hits = await page.evaluate((picks) => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      const out = [];
      for (const spec of picks) {
        const cx = rect.left + rect.width * spec.u;
        const cy = rect.top + rect.height * spec.v;
        let best = null;
        for (let rad = 0; rad <= 22; rad += 2) {
          const nAng = rad === 0 ? 1 : 8;
          for (let a = 0; a < nAng; a++) {
            const ang = (a * Math.PI) / 4;
            const ox = rad === 0 ? 0 : Math.round(rad * Math.cos(ang));
            const oy = rad === 0 ? 0 : Math.round(rad * Math.sin(ang));
            const h = viewer.positionAndNormalFromPoint(cx + ox, cy + oy);
            if (!h) continue;
            const p = h.position;
            if (p.x > -0.002 || p.x < -0.07) continue;
            if (p.y < 0.165 || p.y > 0.215) continue;
            if (p.z < 0.045) continue;
            let nx = h.normal.x,
              ny = h.normal.y,
              nz = h.normal.z;
            const len = Math.hypot(nx, ny, nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
            const score = p.z * 5 + nz * 2 - rad * 0.15;
            if (!best || score > best.score) best = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz] };
          }
        }
        out.push({ text: spec.text, best });
      }
      return out;
    }, PICKS);
  } else {
    // 世界盒：先找虹膜锚点（右眼前突），再相对偏移
    const anchor = await page.evaluate(() => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      let best = null;
      for (let yy = 0.15; yy <= 0.75; yy += 0.02) {
        for (let xx = 0.2; xx <= 0.7; xx += 0.02) {
          const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy);
          if (!h) continue;
          const p = h.position;
          if (p.x > -0.015 || p.x < -0.055) continue;
          if (p.y < 0.175 || p.y > 0.205) continue;
          if (p.z < 0.055) continue;
          const score = p.z * 6 + h.normal.z * 2;
          if (!best || score > best.score) {
            best = { score, pos: [p.x, p.y, p.z], u: xx, v: yy };
          }
        }
      }
      return best;
    });
    console.log('ANCHOR', JSON.stringify(anchor));
    if (!anchor) {
      console.log('NO ANCHOR');
      process.exit(1);
    }
    const [ax, ay, az] = anchor.pos;
    const specs = [
      { text: '虹膜', dx: 0, dy: 0, dz: 0 },
      { text: '角膜', dx: 0, dy: 0.002, dz: 0.002 },
      { text: '眼球', dx: -0.004, dy: 0, dz: -0.001 },
      { text: '内眦', dx: 0.014, dy: -0.002, dz: 0.002 },
      { text: '外眦', dx: -0.016, dy: 0.001, dz: -0.006 },
      { text: '上眼睑', dx: 0, dy: 0.008, dz: -0.001 },
      { text: '下眼睑', dx: 0, dy: -0.010, dz: -0.001 },
      { text: '巩白', dx: 0.010, dy: 0, dz: 0 },
      { text: '睑上沟', dx: 0, dy: 0.014, dz: -0.002 },
      { text: '睑眉沟', dx: 0, dy: 0.022, dz: -0.003 },
      { text: '卧蚕', dx: 0, dy: -0.018, dz: -0.002 },
      { text: '睑下沟', dx: 0, dy: -0.026, dz: -0.003 },
    ];
    hits = await page.evaluate(({ specs, ax, ay, az }) => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      const out = [];
      for (const s of specs) {
        const tx = ax + s.dx;
        const ty = ay + s.dy;
        const tz = az + s.dz;
        let best = null;
        for (let yy = 0.1; yy <= 0.85; yy += 0.018) {
          for (let xx = 0.15; xx <= 0.8; xx += 0.018) {
            const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy);
            if (!h) continue;
            const p = h.position;
            const d = Math.hypot(p.x - tx, p.y - ty, p.z - tz);
            if (d > 0.012) continue;
            let nx = h.normal.x,
              ny = h.normal.y,
              nz = h.normal.z;
            const len = Math.hypot(nx, ny, nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
            const score = -d * 20 + p.z * 2 + nz;
            if (!best || score > best.score) best = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz], d };
          }
        }
        out.push({ text: s.text, best });
      }
      return out;
    }, { specs, ax, ay, az });
  }

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
    console.log('FIX', h.text, pt.pos, '->', pos);
    pt.pos = pos;
    pt.norm = `${n[0].toFixed(4)}m ${n[1].toFixed(4)}m ${n[2].toFixed(4)}m`;
    report.push({ text: h.text, ok: true, pos });
  }

  data.timestamp = Date.now();
  // 正式档案相机保持教学用正面
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ camInfo, centerHit, report }, null, 2));

  for (const name of ['外眦', '内眦', '虹膜']) {
    const pt = by[name];
    const tmp = path.join(outDir, `_solo_${name}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify(
        {
          ...data,
          pointsData: [{ ...pt, id: 1 }],
          snapshots: [],
          timestamp: Date.now(),
          camera: { ...EYE_CAM },
        },
        null,
        2
      )
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
    await page.waitForTimeout(700);
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
      v.setAttribute('field-of-view', c.fov);
      try {
        v.cameraTarget = c.target;
        v.cameraOrbit = c.orbit;
        v.fieldOfView = c.fov;
        if (v.jumpCameraToGoal) v.jumpCameraToGoal();
      } catch (_e) {}
    }, EYE_CAM);
    await page.waitForTimeout(500);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `solo_${name}.png`) });
    console.log('SOLO', name, pt.pos);
  }

  console.log(JSON.stringify({ ok: true, outDir, camInfo }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
