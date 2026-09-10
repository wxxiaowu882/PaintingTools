/**
 * 相对已对准的虹膜，抬高眉点；补睑上沟/睑眉沟；单点出图。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-brow-lift-qa`);

const EYE_CAM = {
  orbit: '-18deg 82deg 0.30m',
  target: '-0.032m 0.210m 0.066m',
  fov: '16deg',
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

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const by = Object.fromEntries(data.pointsData.map((p) => [p.text, p]));
  const iris = by['虹膜'];
  const [ix, iy, iz] = iris.pos.replace(/m/g, '').split(/\s+/).map(Number);

  // 相对虹膜的世界偏移目标（教学右眼）
  const JOBS = [
    { text: '上眼睑', dx: 0.0, dy: 0.006, dz: 0.001, u: 0.50, v: 0.42 },
    { text: '下眼睑', dx: 0.0, dy: -0.010, dz: 0.0, u: 0.50, v: 0.58 },
    { text: '睑上沟', dx: 0.0, dy: 0.012, dz: -0.001, u: 0.50, v: 0.34 },
    { text: '睑眉沟', dx: 0.0, dy: 0.020, dz: -0.002, u: 0.50, v: 0.24 },
    { text: '眉弓隆起', dx: 0.0, dy: 0.018, dz: -0.002, u: 0.48, v: 0.22 },
    { text: '眉头', dx: 0.012, dy: 0.016, dz: 0.002, u: 0.58, v: 0.26 },
    { text: '眉峰', dx: -0.010, dy: 0.020, dz: -0.002, u: 0.40, v: 0.20 },
    { text: '眉毛最浓处', dx: -0.002, dy: 0.017, dz: -0.001, u: 0.46, v: 0.24 },
    { text: '眼眶上缘+脂肪垫', dx: 0.0, dy: 0.028, dz: -0.003, u: 0.50, v: 0.14 },
    { text: '卧蚕', dx: 0.0, dy: -0.018, dz: -0.001, u: 0.50, v: 0.68 },
    { text: '睑下沟', dx: 0.0, dy: -0.026, dz: -0.002, u: 0.50, v: 0.76 },
  ];

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
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.4);
    });
    if (ok) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(600);
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
  await page.waitForTimeout(450);
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean.png') });

  const hits = await page.evaluate(
    ({ jobs, ix, iy, iz }) => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      const out = [];
      for (const job of jobs) {
        const tx = ix + job.dx;
        const ty = iy + job.dy;
        const tz = iz + job.dz;
        const cx = rect.left + rect.width * job.u;
        const cy = rect.top + rect.height * job.v;
        let best = null;
        // 先绕估 uv 搜，再兜底近目标世界点
        for (let rad = 0; rad <= 18; rad += 2) {
          const nAng = rad === 0 ? 1 : 8;
          for (let a = 0; a < nAng; a++) {
            const ang = (a * Math.PI) / 4;
            const ox = rad === 0 ? 0 : Math.round(rad * Math.cos(ang));
            const oy = rad === 0 ? 0 : Math.round(rad * Math.sin(ang));
            const h = viewer.positionAndNormalFromPoint(cx + ox, cy + oy);
            if (!h) continue;
            const p = h.position;
            if (p.x > -0.002 || p.x < -0.065) continue;
            if (p.y < iy - 0.035 || p.y > iy + 0.045) continue;
            if (p.z < 0.045) continue;
            const d = Math.hypot(p.x - tx, p.y - ty, p.z - tz);
            let nx = h.normal.x,
              ny = h.normal.y,
              nz = h.normal.z;
            const len = Math.hypot(nx, ny, nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
            const score = -d * 25 + p.z * 2 + nz - rad * 0.1;
            if (!best || score > best.score) best = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz], d };
          }
        }
        out.push({ text: job.text, best });
      }
      return out;
    },
    { jobs: JOBS, ix, iy, iz }
  );

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
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ iris: iris.pos, report }, null, 2));

  const solos = ['上眼睑', '下眼睑', '眉头', '眉峰', '睑眉沟', '卧蚕', '外眦', '内眦', '虹膜'];
  for (const name of solos) {
    const pt = by[name];
    if (!pt) continue;
    const tmp = path.join(outDir, `_solo_${name.replace(/[^\w\u4e00-\u9fff]+/g, '_')}.json`);
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
    await page.waitForTimeout(500);
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
    await page.waitForTimeout(400);
    const safe = name.replace(/[^\w\u4e00-\u9fff]+/g, '_');
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `solo_${safe}.png`) });
    console.log('SOLO', name, pt.pos);
  }

  // 高度关系自检
  const yOf = (t) => parseFloat(by[t].pos.split(/\s+/)[1]);
  const checks = {
    brow_above_iris: yOf('眉头') > yOf('虹膜') && yOf('眉峰') > yOf('虹膜'),
    lid_order: yOf('上眼睑') > yOf('虹膜') && yOf('虹膜') > yOf('下眼睑'),
    orbit_top: yOf('眼眶上缘+脂肪垫') > yOf('眉峰'),
  };
  console.log(JSON.stringify({ ok: true, outDir, checks, fixed: report.filter((r) => r.ok).length }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
