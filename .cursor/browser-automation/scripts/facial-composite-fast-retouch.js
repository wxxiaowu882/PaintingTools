/**
 * 05 综合快速纠偏：估 uv + 小范围搜索 + 世界盒过滤。
 * 整组一次 evaluate，避免每点全屏扫。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-composite-fast-retouch`);

const GROUPS = [
  {
    key: 'eye',
    orbit: '-20deg 88deg auto',
    target: '-0.032m 0.176m 0.062m',
    fov: 9,
    points: [
      // u/v 相对 viewer；盒约束防落到颊
      { text: '睑眉沟', u: 0.48, v: 0.30, box: [-0.048, -0.015, 0.182, 0.196, 0.052, 0.078] },
      { text: '睑上沟', u: 0.48, v: 0.38, box: [-0.048, -0.015, 0.174, 0.188, 0.055, 0.080] },
      { text: '上眼睑', u: 0.48, v: 0.44, box: [-0.048, -0.015, 0.170, 0.182, 0.058, 0.080] },
      { text: '下眼睑', u: 0.48, v: 0.58, box: [-0.048, -0.015, 0.162, 0.174, 0.055, 0.078] },
      { text: '内眦', u: 0.62, v: 0.50, box: [-0.026, -0.008, 0.166, 0.182, 0.058, 0.082] },
      { text: '外眦', u: 0.30, v: 0.48, box: [-0.058, -0.036, 0.166, 0.184, 0.042, 0.070] },
      { text: '眼球', u: 0.50, v: 0.50, box: [-0.042, -0.020, 0.166, 0.182, 0.060, 0.082] },
      { text: '虹膜', u: 0.48, v: 0.50, box: [-0.040, -0.020, 0.166, 0.182, 0.060, 0.082] },
      { text: '角膜', u: 0.49, v: 0.48, box: [-0.039, -0.021, 0.167, 0.182, 0.062, 0.084] },
      { text: '巩白', u: 0.56, v: 0.50, box: [-0.032, -0.012, 0.166, 0.182, 0.058, 0.080] },
      { text: '卧蚕', u: 0.48, v: 0.64, box: [-0.048, -0.015, 0.156, 0.168, 0.052, 0.076] },
      { text: '睑下沟', u: 0.48, v: 0.72, box: [-0.048, -0.015, 0.148, 0.162, 0.048, 0.072] },
    ],
  },
  {
    key: 'brow',
    orbit: '-16deg 76deg auto',
    target: '-0.030m 0.196m 0.062m',
    fov: 10,
    points: [
      { text: '眉弓隆起', u: 0.42, v: 0.30, box: [-0.048, -0.012, 0.186, 0.208, 0.052, 0.080] },
      { text: '眉头', u: 0.58, v: 0.42, box: [-0.030, -0.008, 0.186, 0.204, 0.055, 0.082] },
      { text: '眉峰', u: 0.36, v: 0.34, box: [-0.052, -0.025, 0.188, 0.208, 0.048, 0.078] },
      { text: '眉毛最浓处', u: 0.46, v: 0.40, box: [-0.042, -0.018, 0.186, 0.204, 0.052, 0.080] },
      { text: '眼眶上缘+脂肪垫', u: 0.48, v: 0.22, box: [-0.048, -0.015, 0.196, 0.218, 0.048, 0.078] },
    ],
  },
  {
    key: 'nose',
    orbit: '0deg 92deg auto',
    target: '0m 0.162m 0.08m',
    fov: 12,
    points: [
      { text: '鼻根', u: 0.50, v: 0.28, box: [-0.012, 0.012, 0.186, 0.208, 0.062, 0.092] },
      { text: '鼻梁(鼻背)', u: 0.50, v: 0.40, box: [-0.012, 0.012, 0.162, 0.186, 0.072, 0.100] },
      { text: '鼻头', u: 0.50, v: 0.55, box: [-0.014, 0.014, 0.146, 0.164, 0.075, 0.096] },
      { text: '鼻翼', u: 0.62, v: 0.56, box: [0.010, 0.032, 0.142, 0.162, 0.058, 0.084] },
      { text: '鼻唇沟起点', u: 0.66, v: 0.60, box: [0.012, 0.038, 0.138, 0.156, 0.052, 0.080] },
    ],
  },
  {
    key: 'nose_up',
    orbit: '0deg 130deg auto',
    target: '0m 0.142m 0.068m',
    fov: 11,
    points: [
      { text: '鼻底', u: 0.50, v: 0.42, box: [-0.012, 0.012, 0.134, 0.148, 0.068, 0.090] },
      { text: '鼻中隔', u: 0.50, v: 0.52, box: [-0.012, 0.012, 0.132, 0.144, 0.058, 0.082] },
      { text: '鼻翼脚', u: 0.62, v: 0.50, box: [0.010, 0.032, 0.132, 0.148, 0.052, 0.078] },
    ],
  },
  {
    key: 'mouth',
    orbit: '0deg 100deg auto',
    target: '0m 0.128m 0.075m',
    fov: 10,
    points: [
      { text: '人中（沟）', u: 0.50, v: 0.36, box: [-0.012, 0.012, 0.128, 0.140, 0.066, 0.084] },
      { text: '人中脊', u: 0.56, v: 0.36, box: [0.002, 0.020, 0.126, 0.138, 0.066, 0.084] },
      { text: '人中切迹', u: 0.50, v: 0.44, box: [-0.012, 0.012, 0.124, 0.136, 0.070, 0.088] },
      { text: '唇峰', u: 0.58, v: 0.46, box: [0.004, 0.022, 0.124, 0.136, 0.070, 0.088] },
      { text: '唇珠', u: 0.50, v: 0.50, box: [-0.012, 0.012, 0.122, 0.134, 0.070, 0.088] },
      { text: '翼状凹', u: 0.60, v: 0.50, box: [0.006, 0.024, 0.122, 0.134, 0.068, 0.086] },
      { text: '下唇圆形隆起', u: 0.58, v: 0.62, box: [0.002, 0.022, 0.114, 0.128, 0.062, 0.082] },
      { text: '沟状凹', u: 0.50, v: 0.58, box: [-0.012, 0.012, 0.116, 0.130, 0.066, 0.084] },
      { text: '白脊（口唇外圈脊状隆起线）', u: 0.56, v: 0.45, box: [0.002, 0.020, 0.126, 0.138, 0.070, 0.088] },
      { text: '口角(窝)', u: 0.72, v: 0.52, box: [0.020, 0.042, 0.120, 0.138, 0.052, 0.078] },
      { text: '颏唇沟', u: 0.50, v: 0.72, box: [-0.012, 0.012, 0.106, 0.122, 0.062, 0.082] },
      { text: '白脊（下唇）', u: 0.50, v: 0.64, box: [-0.012, 0.012, 0.112, 0.126, 0.066, 0.084] },
    ],
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
  const byText = Object.fromEntries(data.pointsData.map((p) => [p.text, p]));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForFunction(() => {
    const el = document.getElementById('point-count');
    return el && /52/.test(el.innerText || '');
  }, null, { timeout: 180000 });
  for (let i = 0; i < 40; i++) {
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
  for (const g of GROUPS) {
    await page.evaluate((v) => {
      const viewer = document.querySelector('#workbench-viewer');
      viewer.setAttribute('camera-target', v.target);
      viewer.setAttribute('camera-orbit', v.orbit);
      viewer.setAttribute('field-of-view', `${v.fov}deg`);
    }, g);
    await page.waitForTimeout(400);

    const hits = await page.evaluate((points) => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      const out = [];
      for (const spec of points) {
        const [xmin, xmax, ymin, ymax, zmin, zmax] = spec.box;
        const cx = rect.left + rect.width * spec.u;
        const cy = rect.top + rect.height * spec.v;
        let best = null;
        for (let r = 0; r <= 22; r += 2) {
          const nAng = r === 0 ? 1 : 8;
          for (let a = 0; a < nAng; a++) {
            const rad = (a * Math.PI) / 4;
            const ox = r === 0 ? 0 : Math.round(r * Math.cos(rad));
            const oy = r === 0 ? 0 : Math.round(r * Math.sin(rad));
            const h = viewer.positionAndNormalFromPoint(cx + ox, cy + oy);
            if (!h) continue;
            const p = h.position;
            if (p.x < xmin || p.x > xmax || p.y < ymin || p.y > ymax || p.z < zmin || p.z > zmax) continue;
            let nx = h.normal.x;
            let ny = h.normal.y;
            let nz = h.normal.z;
            const len = Math.hypot(nx, ny, nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
            const score = p.z * 4 + nz * 2 - r * 0.2;
            if (!best || score > best.score) {
              best = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz], r };
            }
          }
        }
        out.push({ text: spec.text, best });
      }
      return out;
    }, g.points);

    for (const h of hits) {
      const pt = byText[h.text];
      if (!pt) {
        report.push({ text: h.text, ok: false, error: 'missing' });
        continue;
      }
      if (!h.best) {
        report.push({ text: h.text, ok: false, error: 'nohit', old: pt.pos });
        console.log('NOHIT', g.key, h.text, 'keep', pt.pos);
        continue;
      }
      const n = faceCam(h.best.norm, g.orbit);
      const newPos = `${h.best.pos[0].toFixed(4)}m ${h.best.pos[1].toFixed(4)}m ${h.best.pos[2].toFixed(4)}m`;
      const newNorm = `${n[0].toFixed(4)}m ${n[1].toFixed(4)}m ${n[2].toFixed(4)}m`;
      report.push({ text: h.text, ok: true, group: g.key, old: pt.pos, pos: newPos, r: h.best.r });
      console.log('FIX', h.text, pt.pos, '->', newPos);
      pt.pos = newPos;
      pt.norm = newNorm;
    }
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  // reload QA
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const frame = document.getElementById('anno-mobile-frame-overlay');
    if (frame) frame.hidden = true;
  });

  for (const g of [
    { name: 'eye', ...GROUPS[0] },
    { name: 'brow', ...GROUPS[1] },
    { name: 'nose', ...GROUPS[2] },
    { name: 'mouth', ...GROUPS[4] },
    { name: 'front', orbit: '0deg 88deg auto', target: '0m 0.16m 0.05m', fov: 24 },
  ]) {
    await page.evaluate((v) => {
      const viewer = document.querySelector('#workbench-viewer');
      viewer.setAttribute('camera-target', v.target);
      viewer.setAttribute('camera-orbit', v.orbit);
      viewer.setAttribute('field-of-view', `${v.fov}deg`);
    }, g);
    await page.waitForTimeout(400);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `qa_${g.name}.png`) });
  }

  for (const t of ['外眦', '内眦', '虹膜', '上眼睑', '眉峰', '唇珠', '鼻头']) {
    await page.evaluate((name) => {
      const inp = [...document.querySelectorAll('#points-list .point-text-input')].find((el) => el.value === name);
      if (!inp) return;
      (inp.closest('.point-item') || inp.parentElement).querySelector('.point-name')?.click();
    }, t);
    await page.waitForTimeout(500);
    const lock = ['外眦', '内眦', '虹膜', '上眼睑'].includes(t)
      ? GROUPS[0]
      : t === '眉峰'
        ? GROUPS[1]
        : t === '唇珠'
          ? GROUPS[4]
          : GROUPS[2];
    await page.evaluate((v) => {
      const viewer = document.querySelector('#workbench-viewer');
      viewer.setAttribute('camera-target', v.target);
      viewer.setAttribute('camera-orbit', v.orbit);
      viewer.setAttribute('field-of-view', `${v.fov}deg`);
    }, lock);
    await page.waitForTimeout(250);
    await page.locator('#workbench-viewer').screenshot({
      path: path.join(outDir, `focus_${t}.png`),
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixed: report.filter((r) => r.ok).length,
        fail: report.filter((r) => !r.ok).map((r) => r.text),
        outDir,
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
