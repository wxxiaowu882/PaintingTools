/**
 * 05 综合：世界包围盒约束射线重拾（防漂到颊/对侧）。
 * 眼眉：模型右眼 x<0；耳：+x 且 z 勿过大（防贴到面颊）。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-composite-box-retouch`);

const VIEWS = {
  eye: { orbit: '-20deg 88deg auto', target: '-0.032m 0.176m 0.062m', fov: 9 },
  brow: { orbit: '-16deg 76deg auto', target: '-0.030m 0.196m 0.062m', fov: 10 },
  nose: { orbit: '0deg 92deg auto', target: '0m 0.162m 0.08m', fov: 12 },
  nose_up: { orbit: '0deg 130deg auto', target: '0m 0.142m 0.068m', fov: 11 },
  mouth: { orbit: '0deg 100deg auto', target: '0m 0.128m 0.075m', fov: 10 },
  ear: { orbit: '90deg 90deg auto', target: '0.062m 0.160m 0.0m', fov: 13 },
};

/** box: xmin xmax ymin ymax zmin zmax；mode: front|ear */
const JOBS = [
  // 耳：贴耳廓，z 勿冲到脸颊
  { text: '耳轮脚', view: 'ear', mode: 'ear', box: { xmin: 0.048, xmax: 0.072, ymin: 0.160, ymax: 0.178, zmin: -0.01, zmax: 0.022 } },
  { text: '耳轮', view: 'ear', mode: 'ear', box: { xmin: 0.055, xmax: 0.078, ymin: 0.175, ymax: 0.200, zmin: -0.03, zmax: 0.01 } },
  { text: '耳垂', view: 'ear', mode: 'ear', box: { xmin: 0.035, xmax: 0.060, ymin: 0.110, ymax: 0.135, zmin: -0.02, zmax: 0.02 } },
  { text: '对耳轮', view: 'ear', mode: 'ear', box: { xmin: 0.050, xmax: 0.070, ymin: 0.150, ymax: 0.175, zmin: -0.01, zmax: 0.018 } },
  { text: '对耳轮上脚', view: 'ear', mode: 'ear', box: { xmin: 0.055, xmax: 0.072, ymin: 0.168, ymax: 0.190, zmin: -0.01, zmax: 0.015 } },
  { text: '对耳轮下脚', view: 'ear', mode: 'ear', box: { xmin: 0.055, xmax: 0.072, ymin: 0.160, ymax: 0.180, zmin: -0.005, zmax: 0.02 } },
  { text: '耳屏', view: 'ear', mode: 'ear', box: { xmin: 0.048, xmax: 0.068, ymin: 0.145, ymax: 0.165, zmin: 0.005, zmax: 0.032 } },
  { text: '对耳屏', view: 'ear', mode: 'ear', box: { xmin: 0.042, xmax: 0.062, ymin: 0.125, ymax: 0.148, zmin: -0.005, zmax: 0.02 } },
  { text: '凹入缺口', view: 'ear', mode: 'ear', box: { xmin: 0.048, xmax: 0.065, ymin: 0.135, ymax: 0.155, zmin: 0.0, zmax: 0.028 } },
  { text: '前缺口', view: 'ear', mode: 'ear', box: { xmin: 0.052, xmax: 0.070, ymin: 0.155, ymax: 0.175, zmin: 0.005, zmax: 0.030 } },
  { text: '耳甲腔', view: 'ear', mode: 'ear', box: { xmin: 0.050, xmax: 0.068, ymin: 0.142, ymax: 0.162, zmin: 0.0, zmax: 0.025 } },
  { text: '耳甲艇', view: 'ear', mode: 'ear', box: { xmin: 0.052, xmax: 0.070, ymin: 0.158, ymax: 0.178, zmin: -0.005, zmax: 0.02 } },
  { text: '三角凹', view: 'ear', mode: 'ear', box: { xmin: 0.055, xmax: 0.075, ymin: 0.172, ymax: 0.195, zmin: -0.01, zmax: 0.015 } },
  { text: '舟状凹', view: 'ear', mode: 'ear', box: { xmin: 0.058, xmax: 0.080, ymin: 0.155, ymax: 0.185, zmin: -0.03, zmax: 0.005 } },
  { text: '耳廓结节', view: 'ear', mode: 'ear', box: { xmin: 0.060, xmax: 0.082, ymin: 0.165, ymax: 0.190, zmin: -0.035, zmax: 0.0 } },

  // 鼻：中线教学
  { text: '鼻根', view: 'nose', mode: 'front', box: { xmin: -0.01, xmax: 0.01, ymin: 0.188, ymax: 0.205, zmin: 0.065, zmax: 0.090 } },
  { text: '鼻梁(鼻背)', view: 'nose', mode: 'front', box: { xmin: -0.01, xmax: 0.01, ymin: 0.165, ymax: 0.185, zmin: 0.075, zmax: 0.100 } },
  { text: '鼻头', view: 'nose', mode: 'front', box: { xmin: -0.012, xmax: 0.012, ymin: 0.148, ymax: 0.162, zmin: 0.078, zmax: 0.095 } },
  { text: '鼻翼', view: 'nose', mode: 'front', box: { xmin: 0.012, xmax: 0.030, ymin: 0.145, ymax: 0.160, zmin: 0.060, zmax: 0.082 } },
  { text: '鼻唇沟起点', view: 'nose', mode: 'front', box: { xmin: 0.015, xmax: 0.035, ymin: 0.140, ymax: 0.155, zmin: 0.055, zmax: 0.078 } },
  { text: '鼻底', view: 'nose_up', mode: 'front', box: { xmin: -0.01, xmax: 0.01, ymin: 0.136, ymax: 0.146, zmin: 0.070, zmax: 0.088 } },
  { text: '鼻中隔', view: 'nose_up', mode: 'front', box: { xmin: -0.01, xmax: 0.01, ymin: 0.134, ymax: 0.143, zmin: 0.060, zmax: 0.080 } },
  { text: '鼻翼脚', view: 'nose_up', mode: 'front', box: { xmin: 0.012, xmax: 0.030, ymin: 0.134, ymax: 0.146, zmin: 0.055, zmax: 0.075 } },

  // 口
  { text: '人中（沟）', view: 'mouth', mode: 'front', box: { xmin: -0.01, xmax: 0.01, ymin: 0.130, ymax: 0.138, zmin: 0.068, zmax: 0.082 } },
  { text: '人中脊', view: 'mouth', mode: 'front', box: { xmin: 0.004, xmax: 0.018, ymin: 0.128, ymax: 0.137, zmin: 0.068, zmax: 0.082 } },
  { text: '人中切迹', view: 'mouth', mode: 'front', box: { xmin: -0.01, xmax: 0.01, ymin: 0.126, ymax: 0.134, zmin: 0.072, zmax: 0.085 } },
  { text: '唇峰', view: 'mouth', mode: 'front', box: { xmin: 0.006, xmax: 0.020, ymin: 0.126, ymax: 0.134, zmin: 0.072, zmax: 0.085 } },
  { text: '唇珠', view: 'mouth', mode: 'front', box: { xmin: -0.01, xmax: 0.01, ymin: 0.124, ymax: 0.132, zmin: 0.072, zmax: 0.086 } },
  { text: '翼状凹', view: 'mouth', mode: 'front', box: { xmin: 0.008, xmax: 0.022, ymin: 0.124, ymax: 0.132, zmin: 0.070, zmax: 0.084 } },
  { text: '下唇圆形隆起', view: 'mouth', mode: 'front', box: { xmin: 0.005, xmax: 0.020, ymin: 0.116, ymax: 0.126, zmin: 0.065, zmax: 0.080 } },
  { text: '沟状凹', view: 'mouth', mode: 'front', box: { xmin: -0.01, xmax: 0.01, ymin: 0.118, ymax: 0.128, zmin: 0.068, zmax: 0.082 } },
  { text: '白脊（口唇外圈脊状隆起线）', view: 'mouth', mode: 'front', box: { xmin: 0.004, xmax: 0.018, ymin: 0.128, ymax: 0.136, zmin: 0.072, zmax: 0.086 } },
  { text: '口角(窝)', view: 'mouth', mode: 'front', box: { xmin: 0.022, xmax: 0.040, ymin: 0.122, ymax: 0.136, zmin: 0.055, zmax: 0.075 } },
  { text: '颏唇沟', view: 'mouth', mode: 'front', box: { xmin: -0.01, xmax: 0.01, ymin: 0.108, ymax: 0.120, zmin: 0.065, zmax: 0.080 } },
  { text: '白脊（下唇）', view: 'mouth', mode: 'front', box: { xmin: -0.01, xmax: 0.01, ymin: 0.114, ymax: 0.124, zmin: 0.068, zmax: 0.082 } },

  // 眉（右）抬高
  { text: '眉弓隆起', view: 'brow', mode: 'front', box: { xmin: -0.045, xmax: -0.015, ymin: 0.188, ymax: 0.205, zmin: 0.055, zmax: 0.078 } },
  { text: '眉头', view: 'brow', mode: 'front', box: { xmin: -0.028, xmax: -0.010, ymin: 0.188, ymax: 0.202, zmin: 0.058, zmax: 0.080 } },
  { text: '眉峰', view: 'brow', mode: 'front', box: { xmin: -0.048, xmax: -0.028, ymin: 0.190, ymax: 0.205, zmin: 0.052, zmax: 0.075 } },
  { text: '眉毛最浓处', view: 'brow', mode: 'front', box: { xmin: -0.040, xmax: -0.020, ymin: 0.188, ymax: 0.202, zmin: 0.055, zmax: 0.078 } },
  { text: '眼眶上缘+脂肪垫', view: 'brow', mode: 'front', box: { xmin: -0.045, xmax: -0.018, ymin: 0.198, ymax: 0.215, zmin: 0.050, zmax: 0.075 } },

  // 眼（右）：必须抬到眼裂高度 y≈0.17+；内眦更近中线，外眦更负 x
  { text: '睑眉沟', view: 'eye', mode: 'front', box: { xmin: -0.045, xmax: -0.018, ymin: 0.182, ymax: 0.195, zmin: 0.055, zmax: 0.075 } },
  { text: '睑上沟', view: 'eye', mode: 'front', box: { xmin: -0.045, xmax: -0.018, ymin: 0.176, ymax: 0.188, zmin: 0.058, zmax: 0.078 } },
  { text: '上眼睑', view: 'eye', mode: 'front', box: { xmin: -0.045, xmax: -0.018, ymin: 0.172, ymax: 0.182, zmin: 0.060, zmax: 0.078 } },
  { text: '下眼睑', view: 'eye', mode: 'front', box: { xmin: -0.045, xmax: -0.018, ymin: 0.164, ymax: 0.174, zmin: 0.058, zmax: 0.078 } },
  { text: '内眦', view: 'eye', mode: 'front', box: { xmin: -0.024, xmax: -0.010, ymin: 0.168, ymax: 0.180, zmin: 0.060, zmax: 0.080 } },
  { text: '外眦', view: 'eye', mode: 'front', box: { xmin: -0.055, xmax: -0.038, ymin: 0.168, ymax: 0.182, zmin: 0.045, zmax: 0.068 } },
  { text: '眼球', view: 'eye', mode: 'front', box: { xmin: -0.040, xmax: -0.022, ymin: 0.168, ymax: 0.180, zmin: 0.062, zmax: 0.080 } },
  { text: '虹膜', view: 'eye', mode: 'front', box: { xmin: -0.038, xmax: -0.022, ymin: 0.168, ymax: 0.180, zmin: 0.062, zmax: 0.080 } },
  { text: '角膜', view: 'eye', mode: 'front', box: { xmin: -0.037, xmax: -0.023, ymin: 0.169, ymax: 0.180, zmin: 0.064, zmax: 0.082 } },
  { text: '巩白', view: 'eye', mode: 'front', box: { xmin: -0.030, xmax: -0.014, ymin: 0.168, ymax: 0.180, zmin: 0.060, zmax: 0.078 } },
  { text: '卧蚕', view: 'eye', mode: 'front', box: { xmin: -0.045, xmax: -0.018, ymin: 0.158, ymax: 0.168, zmin: 0.055, zmax: 0.075 } },
  { text: '睑下沟', view: 'eye', mode: 'front', box: { xmin: -0.045, xmax: -0.018, ymin: 0.150, ymax: 0.162, zmin: 0.052, zmax: 0.072 } },
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
  for (let i = 0; i < 30; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.35);
    });
    if (ok) break;
    await page.waitForTimeout(250);
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
  let lastView = '';
  for (const job of JOBS) {
    const pt = byText[job.text];
    if (!pt) {
      report.push({ text: job.text, ok: false, error: 'missing' });
      continue;
    }
    const view = VIEWS[job.view];
    if (job.view !== lastView) {
      await page.evaluate((v) => {
        const viewer = document.querySelector('#workbench-viewer');
        viewer.setAttribute('camera-target', v.target);
        viewer.setAttribute('camera-orbit', v.orbit);
        viewer.setAttribute('field-of-view', `${v.fov}deg`);
      }, view);
      await page.waitForTimeout(320);
      lastView = job.view;
    }

    const hit = await page.evaluate(({ box, mode }) => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      let best = null;
      let inBox = 0;
      for (let yy = 0.08; yy <= 0.92; yy += 0.022) {
        for (let xx = 0.12; xx <= 0.88; xx += 0.022) {
          const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy);
          if (!h) continue;
          const p = h.position;
          if (p.x < box.xmin || p.x > box.xmax || p.y < box.ymin || p.y > box.ymax || p.z < box.zmin || p.z > box.zmax) continue;
          inBox++;
          let nx = h.normal.x;
          let ny = h.normal.y;
          let nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          let score;
          if (mode === 'ear') {
            score = p.x * 4 - Math.abs(p.z - 0.005) * 3 + nz * 0.5;
          } else {
            score = p.z * 4 + nz * 2 - Math.abs(p.x) * 0.5;
          }
          // 偏好框中心
          const cx = (box.xmin + box.xmax) / 2;
          const cy = (box.ymin + box.ymax) / 2;
          const cz = (box.zmin + box.zmax) / 2;
          score -= Math.hypot(p.x - cx, p.y - cy, p.z - cz) * 8;
          if (!best || score > best.score) {
            best = {
              score,
              pos: [p.x, p.y, p.z],
              norm: [nx, ny, nz],
            };
          }
        }
      }
      return { best, inBox };
    }, { box: job.box, mode: job.mode });

    if (!hit.best) {
      report.push({ text: job.text, ok: false, error: 'nohit', inBox: hit.inBox, old: pt.pos });
      console.log('NOHIT', job.text, 'inBox', hit.inBox, 'keep', pt.pos);
      continue;
    }
    const n = faceCam(hit.best.norm, view.orbit);
    const newPos = `${hit.best.pos[0].toFixed(4)}m ${hit.best.pos[1].toFixed(4)}m ${hit.best.pos[2].toFixed(4)}m`;
    const newNorm = `${n[0].toFixed(4)}m ${n[1].toFixed(4)}m ${n[2].toFixed(4)}m`;
    report.push({ text: job.text, ok: true, old: pt.pos, pos: newPos, inBox: hit.inBox });
    console.log('FIX', job.text, pt.pos, '->', newPos, 'n=', hit.inBox);
    pt.pos = newPos;
    pt.norm = newNorm;
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'log.txt'), report.map((r) => JSON.stringify(r)).join('\n'), 'utf8');

  // reload + QA
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const frame = document.getElementById('anno-mobile-frame-overlay');
    if (frame) frame.hidden = true;
  });

  const qa = [
    { name: 'eye', ...VIEWS.eye, fov: 10 },
    { name: 'brow', ...VIEWS.brow },
    { name: 'nose', ...VIEWS.nose },
    { name: 'mouth', ...VIEWS.mouth },
    { name: 'ear', ...VIEWS.ear },
    { name: 'front', orbit: '0deg 88deg auto', target: '0m 0.16m 0.05m', fov: 24 },
  ];
  for (const q of qa) {
    await page.evaluate((v) => {
      const viewer = document.querySelector('#workbench-viewer');
      viewer.setAttribute('camera-target', v.target);
      viewer.setAttribute('camera-orbit', v.orbit);
      viewer.setAttribute('field-of-view', `${v.fov}deg`);
    }, q);
    await page.waitForTimeout(400);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `qa_${q.name}.png`) });
  }

  for (const t of ['外眦', '内眦', '虹膜', '上眼睑', '唇珠', '鼻头', '耳轮']) {
    await page.evaluate((name) => {
      const inp = [...document.querySelectorAll('#points-list .point-text-input')].find((el) => el.value === name);
      if (!inp) return;
      (inp.closest('.point-item') || inp.parentElement).querySelector('.point-name')?.click();
    }, t);
    await page.waitForTimeout(650);
    // 再锁回解剖相机，避免坏法线飞走
    const lock =
      t.includes('眦') || t.includes('虹') || t.includes('睑')
        ? VIEWS.eye
        : t.includes('唇')
          ? VIEWS.mouth
          : t.includes('鼻')
            ? VIEWS.nose
            : VIEWS.ear;
    await page.evaluate((v) => {
      const viewer = document.querySelector('#workbench-viewer');
      viewer.setAttribute('camera-target', v.target);
      viewer.setAttribute('camera-orbit', v.orbit);
      viewer.setAttribute('field-of-view', `${v.fov}deg`);
    }, lock);
    await page.waitForTimeout(300);
    await page.locator('#workbench-viewer').screenshot({
      path: path.join(outDir, `focus_${t.replace(/[^\w\u4e00-\u9fff]+/g, '_')}.png`),
    });
  }

  const okN = report.filter((r) => r.ok).length;
  const fail = report.filter((r) => !r.ok);
  console.log(JSON.stringify({ ok: true, fixed: okN, fail: fail.map((f) => f.text), outDir }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
