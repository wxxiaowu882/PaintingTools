/**
 * 仅把眉相关点沿表面向下吸附到眉脊高度带。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-brow-drop`);

const EYE_CAM = {
  orbit: '-16deg 86deg 0.28m',
  target: '-0.032m 0.212m 0.066m',
  fov: '15deg',
};

const NAMES = ['睑眉沟', '眉头', '眉峰', '眉毛最浓处', '眉弓隆起'];

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
  const iy = parseFloat(by['虹膜'].pos.split(/\s+/)[1]);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  const emptyPath = path.join(outDir, '_empty.json');
  fs.writeFileSync(
    emptyPath,
    JSON.stringify({ ...data, pointsData: [], snapshots: [], timestamp: Date.now(), camera: { ...EYE_CAM } }, null, 2)
  );
  await page.setInputFiles('#file-input', emptyPath);
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
  await page.waitForTimeout(500);
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
  }, EYE_CAM);
  await page.waitForTimeout(400);

  // 目标高度带：虹膜上方约 1.2–2.2cm
  const yMin = iy + 0.012;
  const yMax = iy + 0.022;

  for (const name of NAMES) {
    const pt = by[name];
    const [cx, cy, cz] = pt.pos.replace(/m/g, '').split(/\s+/).map(Number);
    const hit = await page.evaluate(
      ({ cx, yMin, yMax }) => {
        const viewer = document.querySelector('#workbench-viewer');
        const rect = viewer.getBoundingClientRect();
        let best = null;
        for (let yy = 0.12; yy <= 0.7; yy += 0.02) {
          for (let xx = 0.25; xx <= 0.75; xx += 0.02) {
            const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy);
            if (!h) continue;
            const p = h.position;
            if (Math.abs(p.x - cx) > 0.012) continue;
            if (p.y < yMin || p.y > yMax) continue;
            if (p.z < 0.048) continue;
            let nx = h.normal.x,
              ny = h.normal.y,
              nz = h.normal.z;
            const len = Math.hypot(nx, ny, nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
            const score = p.z * 4 + nz * 2 - Math.abs(p.x - cx) * 10;
            if (!best || score > best.score) best = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz] };
          }
        }
        return best;
      },
      { cx, yMin, yMax }
    );
    if (!hit) {
      console.log('NOHIT', name);
      continue;
    }
    const n = faceCam(hit.norm, EYE_CAM.orbit);
    const pos = `${hit.pos[0].toFixed(4)}m ${hit.pos[1].toFixed(4)}m ${hit.pos[2].toFixed(4)}m`;
    console.log('FIX', name, pt.pos, '->', pos);
    pt.pos = pos;
    pt.norm = `${n[0].toFixed(4)}m ${n[1].toFixed(4)}m ${n[2].toFixed(4)}m`;
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');

  for (const name of ['眉头', '眉峰', '睑眉沟']) {
    const pt = by[name];
    const tmp = path.join(outDir, `_solo_${name}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify(
        { ...data, pointsData: [{ ...pt, id: 1 }], snapshots: [], timestamp: Date.now(), camera: { ...EYE_CAM } },
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
      { timeout: 90000 }
    );
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
    }, EYE_CAM);
    await page.waitForTimeout(350);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `solo_${name}.png`) });
    console.log('SOLO', name, pt.pos);
  }

  console.log(JSON.stringify({ ok: true, outDir, yBand: [yMin, yMax] }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
