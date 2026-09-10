/**
 * 档案内嵌眼区相机 + 屏幕 uv 快拾（已验证中心命中在眼高 y≈0.185）。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-eye-fast-uv`);

const EYE_CAM = {
  orbit: '-18deg 88deg 0.30m',
  target: '-0.032m 0.192m 0.068m',
  fov: '16deg',
};

// 单点复核证明 v≈0.48 落在颊；眼裂约在画面偏上 v≈0.38–0.42
const PICKS = [
  { text: '虹膜', u: 0.50, v: 0.40 },
  { text: '角膜', u: 0.50, v: 0.38 },
  { text: '眼球', u: 0.52, v: 0.40 },
  { text: '内眦', u: 0.56, v: 0.42 },
  { text: '外眦', u: 0.40, v: 0.40 },
  { text: '上眼睑', u: 0.50, v: 0.34 },
  { text: '下眼睑', u: 0.50, v: 0.48 },
  { text: '巩白', u: 0.54, v: 0.40 },
  { text: '睑上沟', u: 0.50, v: 0.28 },
  { text: '睑眉沟', u: 0.50, v: 0.20 },
  { text: '卧蚕', u: 0.50, v: 0.54 },
  { text: '睑下沟', u: 0.50, v: 0.60 },
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
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.45);
    });
    if (ok) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(700);
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
  await page.waitForTimeout(500);
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean.png') });

  const hits = await page.evaluate((picks) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const out = [];
    for (const spec of picks) {
      const cx = rect.left + rect.width * spec.u;
      const cy = rect.top + rect.height * spec.v;
      let best = null;
      for (let rad = 0; rad <= 14; rad += 2) {
        const nAng = rad === 0 ? 1 : 8;
        for (let a = 0; a < nAng; a++) {
          const ang = (a * Math.PI) / 4;
          const ox = rad === 0 ? 0 : Math.round(rad * Math.cos(ang));
          const oy = rad === 0 ? 0 : Math.round(rad * Math.sin(ang));
          const h = viewer.positionAndNormalFromPoint(cx + ox, cy + oy);
          if (!h) continue;
          const p = h.position;
          // 眼裂带：抬高 y（≈0.19+），右眼 x<0，外眦勿过靠后
          if (p.x > -0.005 || p.x < -0.062) continue;
          if (p.y < 0.178 || p.y > 0.215) continue;
          if (p.z < 0.048) continue;
          let nx = h.normal.x,
            ny = h.normal.y,
            nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          const score = p.z * 5 + nz * 2 - rad * 0.2;
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
    const n = faceCam(h.best.norm, EYE_CAM.orbit);
    const pos = `${h.best.pos[0].toFixed(4)}m ${h.best.pos[1].toFixed(4)}m ${h.best.pos[2].toFixed(4)}m`;
    console.log('FIX', h.text, pt.pos, '->', pos);
    pt.pos = pos;
    pt.norm = `${n[0].toFixed(4)}m ${n[1].toFixed(4)}m ${n[2].toFixed(4)}m`;
    report.push({ text: h.text, ok: true, pos });
  }

  // 约束：外眦 x < 虹膜 x < 内眦 x（都为负时外更负）
  const iris = by['虹膜'];
  const waizi = by['外眦'];
  const neizi = by['内眦'];
  if (iris && waizi && neizi) {
    const ix = parseFloat(iris.pos);
    const wx = parseFloat(waizi.pos);
    const nx = parseFloat(neizi.pos);
    console.log('ORDER x', { waizi: wx, iris: ix, neizi: nx, ok: wx < ix && ix < nx });
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

  for (const name of ['外眦', '内眦', '虹膜']) {
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
    await page.waitForTimeout(600);
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
    await page.waitForTimeout(450);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `solo_${name}.png`) });
    console.log('SOLO', name, pt.pos);
  }

  console.log(JSON.stringify({ ok: true, outDir, fixed: report.filter((r) => r.ok).length }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
