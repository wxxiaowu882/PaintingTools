/**
 * 仅修补仍偏差的少数点 + 出视觉复核图。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-composite-surgical`);

const JOBS = [
  {
    text: '眉头',
    orbit: '-14deg 76deg auto',
    target: '-0.022m 0.198m 0.068m',
    fov: 9,
    u: 0.58,
    v: 0.42,
    box: [-0.028, -0.008, 0.190, 0.208, 0.058, 0.082],
  },
  {
    text: '眉毛最浓处',
    orbit: '-16deg 76deg auto',
    target: '-0.032m 0.198m 0.066m',
    fov: 9,
    u: 0.48,
    v: 0.40,
    box: [-0.042, -0.018, 0.190, 0.208, 0.055, 0.080],
  },
  {
    text: '眉弓隆起',
    orbit: '-16deg 74deg auto',
    target: '-0.030m 0.195m 0.066m',
    fov: 10,
    u: 0.45,
    v: 0.36,
    box: [-0.045, -0.015, 0.188, 0.208, 0.055, 0.080],
  },
  {
    text: '眉峰',
    orbit: '-18deg 74deg auto',
    target: '-0.038m 0.200m 0.064m',
    fov: 9,
    u: 0.36,
    v: 0.34,
    box: [-0.052, -0.028, 0.192, 0.212, 0.050, 0.078],
  },
  {
    text: '人中切迹',
    orbit: '0deg 100deg auto',
    target: '0m 0.130m 0.076m',
    fov: 9,
    u: 0.50,
    v: 0.44,
    box: [-0.01, 0.01, 0.126, 0.136, 0.070, 0.086],
  },
  {
    text: '唇峰',
    orbit: '0deg 100deg auto',
    target: '0m 0.130m 0.076m',
    fov: 9,
    u: 0.58,
    v: 0.46,
    box: [0.004, 0.020, 0.126, 0.136, 0.070, 0.086],
  },
  {
    text: '口角(窝)',
    orbit: '8deg 100deg auto',
    target: '0.028m 0.128m 0.065m',
    fov: 10,
    u: 0.70,
    v: 0.52,
    box: [0.022, 0.040, 0.122, 0.138, 0.055, 0.075],
  },
  {
    text: '颏唇沟',
    orbit: '0deg 105deg auto',
    target: '0m 0.115m 0.072m',
    fov: 10,
    u: 0.50,
    v: 0.70,
    box: [-0.01, 0.01, 0.108, 0.122, 0.065, 0.082],
  },
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForFunction(() => /52/.test((document.getElementById('point-count') || {}).innerText || ''), null, {
    timeout: 180000,
  });
  for (let i = 0; i < 30; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.35);
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

  const report = [];
  for (const job of JOBS) {
    await page.evaluate((j) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-target', j.target);
      v.setAttribute('camera-orbit', j.orbit);
      v.setAttribute('field-of-view', `${j.fov}deg`);
    }, job);
    await page.waitForTimeout(280);
    const hit = await page.evaluate(({ u, v, box }) => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      const cx = rect.left + rect.width * u;
      const cy = rect.top + rect.height * v;
      const [xmin, xmax, ymin, ymax, zmin, zmax] = box;
      let best = null;
      for (let r = 0; r <= 24; r += 2) {
        const nAng = r === 0 ? 1 : 8;
        for (let a = 0; a < nAng; a++) {
          const rad = (a * Math.PI) / 4;
          const ox = r === 0 ? 0 : Math.round(r * Math.cos(rad));
          const oy = r === 0 ? 0 : Math.round(r * Math.sin(rad));
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
          const score = p.z * 4 + nz * 2 - r * 0.15;
          if (!best || score > best.score) best = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz], r };
        }
      }
      return best;
    }, job);
    const pt = by[job.text];
    if (!hit) {
      report.push({ text: job.text, ok: false, old: pt.pos });
      console.log('NOHIT', job.text);
      continue;
    }
    const n = faceCam(hit.norm, job.orbit);
    const pos = `${hit.pos[0].toFixed(4)}m ${hit.pos[1].toFixed(4)}m ${hit.pos[2].toFixed(4)}m`;
    const norm = `${n[0].toFixed(4)}m ${n[1].toFixed(4)}m ${n[2].toFixed(4)}m`;
    console.log('FIX', job.text, pt.pos, '->', pos);
    pt.pos = pos;
    pt.norm = norm;
    report.push({ text: job.text, ok: true, pos });
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForTimeout(1400);
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const frame = document.getElementById('anno-mobile-frame-overlay');
    if (frame) frame.hidden = true;
  });

  const views = [
    { name: 'eye', orbit: '-20deg 88deg auto', target: '-0.032m 0.176m 0.062m', fov: 9 },
    { name: 'brow', orbit: '-16deg 76deg auto', target: '-0.030m 0.198m 0.065m', fov: 10 },
    { name: 'nose', orbit: '0deg 92deg auto', target: '0m 0.162m 0.08m', fov: 12 },
    { name: 'mouth', orbit: '0deg 100deg auto', target: '0m 0.128m 0.075m', fov: 10 },
    { name: 'ear', orbit: '90deg 90deg auto', target: '0.062m 0.160m 0.0m', fov: 13 },
    { name: 'front', orbit: '0deg 88deg auto', target: '0m 0.16m 0.05m', fov: 24 },
  ];
  for (const v of views) {
    await page.evaluate((vv) => {
      const viewer = document.querySelector('#workbench-viewer');
      viewer.setAttribute('camera-target', vv.target);
      viewer.setAttribute('camera-orbit', vv.orbit);
      viewer.setAttribute('field-of-view', `${vv.fov}deg`);
    }, v);
    await page.waitForTimeout(400);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `qa_${v.name}.png`) });
  }

  for (const t of ['外眦', '内眦', '虹膜', '眉头', '眉峰', '鼻根', '唇珠', '耳轮']) {
    await page.evaluate((name) => {
      const inp = [...document.querySelectorAll('#points-list .point-text-input')].find((el) => el.value === name);
      if (!inp) return;
      (inp.closest('.point-item') || inp.parentElement).querySelector('.point-name')?.click();
    }, t);
    await page.waitForTimeout(550);
    const lock =
      t.includes('眦') || t.includes('虹')
        ? views[0]
        : t.includes('眉')
          ? views[1]
          : t.includes('鼻')
            ? views[2]
            : t.includes('唇')
              ? views[3]
              : views[4];
    await page.evaluate((vv) => {
      const viewer = document.querySelector('#workbench-viewer');
      viewer.setAttribute('camera-target', vv.target);
      viewer.setAttribute('camera-orbit', vv.orbit);
      viewer.setAttribute('field-of-view', `${vv.fov}deg`);
    }, lock);
    await page.waitForTimeout(250);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `focus_${t}.png`) });
  }

  console.log(JSON.stringify({ ok: true, report, outDir }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
