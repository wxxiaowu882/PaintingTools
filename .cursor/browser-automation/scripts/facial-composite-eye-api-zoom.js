/**
 * 用 model-viewer JS API 强制拉近右眼，再屏幕拾取眼点；单点出图复核。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-eye-api-zoom`);

const TARGET = '-0.032m 0.182m 0.066m';
const ORBIT = '-20deg 88deg 0.28m';
const FOV = '20deg';

// 拉近后右眼应占画面大部；uv 相对眼裂
const PICKS = [
  { text: '虹膜', u: 0.50, v: 0.48 },
  { text: '角膜', u: 0.51, v: 0.46 },
  { text: '眼球', u: 0.52, v: 0.48 },
  { text: '内眦', u: 0.68, v: 0.50 },
  { text: '外眦', u: 0.28, v: 0.48 },
  { text: '上眼睑', u: 0.50, v: 0.38 },
  { text: '下眼睑', u: 0.50, v: 0.60 },
  { text: '巩白', u: 0.60, v: 0.48 },
  { text: '睑上沟', u: 0.50, v: 0.30 },
  { text: '睑眉沟', u: 0.50, v: 0.20 },
  { text: '卧蚕', u: 0.50, v: 0.70 },
  { text: '睑下沟', u: 0.50, v: 0.80 },
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
  for (let i = 0; i < 40; i++) {
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

  const camInfo = await page.evaluate(({ target, orbit, fov }) => {
    const v = document.querySelector('#workbench-viewer');
    try {
      v.cameraTarget = target;
    } catch (_e) {
      v.setAttribute('camera-target', target);
    }
    try {
      v.cameraOrbit = orbit;
    } catch (_e) {
      v.setAttribute('camera-orbit', orbit);
    }
    try {
      v.fieldOfView = fov;
    } catch (_e) {
      v.setAttribute('field-of-view', fov);
    }
    try {
      if (typeof v.jumpCameraToGoal === 'function') v.jumpCameraToGoal();
    } catch (_e) {}
    const o = v.getCameraOrbit ? v.getCameraOrbit() : null;
    const f = v.getFieldOfView ? v.getFieldOfView() : null;
    const t = v.getCameraTarget ? v.getCameraTarget() : null;
    return {
      orbitStr: o ? o.toString() : v.getAttribute('camera-orbit'),
      radius: o && o.radius,
      fov: f,
      targetStr: t ? t.toString() : v.getAttribute('camera-target'),
    };
  }, { target: TARGET, orbit: ORBIT, fov: FOV });
  console.log('CAM', JSON.stringify(camInfo));
  await page.waitForTimeout(700);
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean_zoom.png') });

  // 中心命中探测：确认是否落在眼区
  const centerHit = await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    const r = v.getBoundingClientRect();
    const h = v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.45);
    if (!h) return null;
    return { x: h.position.x, y: h.position.y, z: h.position.z };
  });
  console.log('CENTER', JSON.stringify(centerHit));
  fs.writeFileSync(path.join(outDir, 'cam.json'), JSON.stringify({ camInfo, centerHit }, null, 2));

  const hits = await page.evaluate((picks) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const out = [];
    for (const spec of picks) {
      const cx = rect.left + rect.width * spec.u;
      const cy = rect.top + rect.height * spec.v;
      let best = null;
      for (let rad = 0; rad <= 20; rad += 2) {
        const nAng = rad === 0 ? 1 : 8;
        for (let a = 0; a < nAng; a++) {
          const ang = (a * Math.PI) / 4;
          const ox = rad === 0 ? 0 : Math.round(rad * Math.cos(ang));
          const oy = rad === 0 ? 0 : Math.round(rad * Math.sin(ang));
          const h = viewer.positionAndNormalFromPoint(cx + ox, cy + oy);
          if (!h) continue;
          const p = h.position;
          if (p.x > -0.002 || p.x < -0.07) continue;
          if (p.y < 0.16 || p.y > 0.22) continue;
          if (p.z < 0.04) continue;
          let nx = h.normal.x,
            ny = h.normal.y,
            nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          const score = p.z * 5 + nz * 2 - rad * 0.15;
          if (!best || score > best.score) best = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz], rad };
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
    const n = faceCam(h.best.norm, ORBIT);
    const pos = `${h.best.pos[0].toFixed(4)}m ${h.best.pos[1].toFixed(4)}m ${h.best.pos[2].toFixed(4)}m`;
    console.log('FIX', h.text, pt.pos, '->', pos);
    pt.pos = pos;
    pt.norm = `${n[0].toFixed(4)}m ${n[1].toFixed(4)}m ${n[2].toFixed(4)}m`;
    report.push({ text: h.text, ok: true, old: report.length, pos });
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ camInfo, centerHit, report }, null, 2));

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
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.visibility = 'hidden';
      });
    });
    await page.evaluate(({ target, orbit, fov }) => {
      const v = document.querySelector('#workbench-viewer');
      try {
        v.cameraTarget = target;
        v.cameraOrbit = orbit;
        v.fieldOfView = fov;
        if (v.jumpCameraToGoal) v.jumpCameraToGoal();
      } catch (_e) {
        v.setAttribute('camera-target', target);
        v.setAttribute('camera-orbit', orbit);
        v.setAttribute('field-of-view', fov);
      }
    }, { target: TARGET, orbit: ORBIT, fov: FOV });
    await page.waitForTimeout(500);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `solo_${name}.png`) });
    console.log('SOLO', name, pt.pos);
  }

  console.log(JSON.stringify({ ok: true, outDir, camInfo, centerHit }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
