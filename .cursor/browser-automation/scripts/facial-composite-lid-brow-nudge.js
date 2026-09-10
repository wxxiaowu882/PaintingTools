/**
 * 把上睑/眉从额区拉回：以虹膜为锚，世界盒 + 屏幕 uv。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-lid-brow-nudge`);

const EYE_CAM = {
  orbit: '-16deg 86deg 0.28m',
  target: '-0.032m 0.208m 0.066m',
  fov: '15deg',
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
  const [ix, iy, iz] = by['虹膜'].pos.replace(/m/g, '').split(/\s+/).map(Number);
  const [wx] = by['外眦'].pos.replace(/m/g, '').split(/\s+/).map(Number);
  const [nx] = by['内眦'].pos.replace(/m/g, '').split(/\s+/).map(Number);

  // 紧世界盒：上睑略高于虹膜；眉再高一点但仍近眼
  const JOBS = [
    {
      text: '上眼睑',
      u: 0.5,
      v: 0.44,
      box: [ix - 0.01, ix + 0.01, iy + 0.004, iy + 0.012, iz - 0.008, iz + 0.006],
    },
    {
      text: '睑上沟',
      u: 0.5,
      v: 0.38,
      box: [ix - 0.012, ix + 0.012, iy + 0.010, iy + 0.020, iz - 0.010, iz + 0.004],
    },
    {
      text: '睑眉沟',
      u: 0.5,
      v: 0.32,
      box: [ix - 0.014, ix + 0.014, iy + 0.016, iy + 0.028, iz - 0.012, iz + 0.002],
    },
    {
      text: '眉头',
      u: 0.58,
      v: 0.30,
      box: [nx - 0.008, nx + 0.012, iy + 0.014, iy + 0.028, iz - 0.008, iz + 0.008],
    },
    {
      text: '眉峰',
      u: 0.40,
      v: 0.28,
      box: [wx + 0.002, wx + 0.018, iy + 0.016, iy + 0.032, iz - 0.012, iz + 0.006],
    },
    {
      text: '眉毛最浓处',
      u: 0.46,
      v: 0.30,
      box: [ix - 0.016, ix + 0.004, iy + 0.014, iy + 0.028, iz - 0.010, iz + 0.004],
    },
    {
      text: '眉弓隆起',
      u: 0.48,
      v: 0.26,
      box: [ix - 0.014, ix + 0.010, iy + 0.018, iy + 0.034, iz - 0.014, iz + 0.002],
    },
    {
      text: '眼眶上缘+脂肪垫',
      u: 0.50,
      v: 0.20,
      box: [ix - 0.016, ix + 0.012, iy + 0.024, iy + 0.042, iz - 0.016, iz + 0.002],
    },
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

  const hits = await page.evaluate((jobs) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const out = [];
    for (const job of jobs) {
      const [xmin, xmax, ymin, ymax, zmin, zmax] = job.box;
      const cx = rect.left + rect.width * job.u;
      const cy = rect.top + rect.height * job.v;
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
          if (p.x < xmin || p.x > xmax || p.y < ymin || p.y > ymax || p.z < zmin || p.z > zmax) continue;
          let nx = h.normal.x,
            ny = h.normal.y,
            nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          const score = p.z * 4 + nz * 2 - rad * 0.15;
          if (!best || score > best.score) best = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz] };
        }
      }
      out.push({ text: job.text, best });
    }
    return out;
  }, JOBS);

  const report = [];
  for (const h of hits) {
    const pt = by[h.text];
    if (!h.best) {
      report.push({ text: h.text, ok: false, old: pt.pos });
      console.log('NOHIT', h.text, 'keep', pt.pos);
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
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

  for (const name of ['上眼睑', '眉头', '眉峰', '睑眉沟', '虹膜']) {
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
    await page.waitForTimeout(450);
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
    await page.waitForTimeout(350);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `solo_${name}.png`) });
    console.log('SOLO', name, pt.pos);
  }

  const y = (t) => parseFloat(by[t].pos.split(/\s+/)[1]);
  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir,
        order: {
          orbit: y('眼眶上缘+脂肪垫'),
          browPeak: y('眉峰'),
          browHead: y('眉头'),
          lidCrease: y('睑眉沟'),
          upperLid: y('上眼睑'),
          iris: y('虹膜'),
        },
      },
      null,
      2
    )
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
