/**
 * 05 综合：按净图视觉估 uv，在网页射线重拾全部点，写回 JSON。
 * 眼眉取模型右眼（x<0）；耳取模型右耳——本 bust 右耳为 +x 侧（与现有 01 约定一致需核对：耳用 +x）。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-composite-vision-retouch`);

/** 相机：先对准区域，再按 viewer 画布 uv 射线 */
const VIEWS = {
  // 模型右眼（画面偏左）：抬高对准眼裂，避免点到颊
  eye: { orbit: '-18deg 88deg auto', target: '-0.032m 0.176m 0.065m', fov: 8 },
  brow: { orbit: '-16deg 78deg auto', target: '-0.030m 0.195m 0.065m', fov: 9 },
  nose: { orbit: '0deg 92deg auto', target: '0m 0.165m 0.08m', fov: 11 },
  nose_up: { orbit: '0deg 128deg auto', target: '0m 0.145m 0.07m', fov: 10 },
  mouth: { orbit: '0deg 98deg auto', target: '0m 0.128m 0.075m', fov: 9 },
  // +x 侧耳（侧视）
  ear: { orbit: '88deg 90deg auto', target: '0.062m 0.160m 0.005m', fov: 12 },
};

/**
 * u/v：相对 #workbench-viewer 画布（0-1），来自净图目视。
 * prefer: front(+z) | lat(+x 耳)
 */
const SPECS = [
  // —— 耳（模型 +x 侧）——
  { text: '耳轮脚', view: 'ear', u: 0.38, v: 0.40, prefer: 'lat' },
  { text: '耳轮', view: 'ear', u: 0.58, v: 0.28, prefer: 'lat' },
  { text: '耳垂', view: 'ear', u: 0.52, v: 0.78, prefer: 'lat' },
  { text: '对耳轮', view: 'ear', u: 0.50, v: 0.48, prefer: 'lat' },
  { text: '对耳轮上脚', view: 'ear', u: 0.48, v: 0.30, prefer: 'lat' },
  { text: '对耳轮下脚', view: 'ear', u: 0.42, v: 0.40, prefer: 'lat' },
  { text: '耳屏', view: 'ear', u: 0.28, v: 0.52, prefer: 'lat' },
  { text: '对耳屏', view: 'ear', u: 0.46, v: 0.66, prefer: 'lat' },
  { text: '凹入缺口', view: 'ear', u: 0.34, v: 0.60, prefer: 'lat' },
  { text: '前缺口', view: 'ear', u: 0.30, v: 0.44, prefer: 'lat' },
  { text: '耳甲腔', view: 'ear', u: 0.40, v: 0.54, prefer: 'lat' },
  { text: '耳甲艇', view: 'ear', u: 0.42, v: 0.40, prefer: 'lat' },
  { text: '三角凹', view: 'ear', u: 0.48, v: 0.26, prefer: 'lat' },
  { text: '舟状凹', view: 'ear', u: 0.62, v: 0.38, prefer: 'lat' },
  { text: '耳廓结节', view: 'ear', u: 0.66, v: 0.32, prefer: 'lat' },

  // —— 鼻 ——
  { text: '鼻根', view: 'nose', u: 0.50, v: 0.28, prefer: 'front' },
  { text: '鼻梁(鼻背)', view: 'nose', u: 0.50, v: 0.40, prefer: 'front' },
  { text: '鼻头', view: 'nose', u: 0.50, v: 0.55, prefer: 'front' },
  { text: '鼻翼', view: 'nose', u: 0.62, v: 0.56, prefer: 'front' },
  { text: '鼻唇沟起点', view: 'nose', u: 0.66, v: 0.60, prefer: 'front' },
  { text: '鼻底', view: 'nose_up', u: 0.50, v: 0.42, prefer: 'front' },
  { text: '鼻中隔', view: 'nose_up', u: 0.50, v: 0.52, prefer: 'front' },
  { text: '鼻翼脚', view: 'nose_up', u: 0.62, v: 0.50, prefer: 'front' },

  // —— 口 ——
  { text: '人中（沟）', view: 'mouth', u: 0.50, v: 0.36, prefer: 'front' },
  { text: '人中脊', view: 'mouth', u: 0.56, v: 0.36, prefer: 'front' },
  { text: '人中切迹', view: 'mouth', u: 0.50, v: 0.44, prefer: 'front' },
  { text: '唇峰', view: 'mouth', u: 0.58, v: 0.46, prefer: 'front' },
  { text: '唇珠', view: 'mouth', u: 0.50, v: 0.50, prefer: 'front' },
  { text: '翼状凹', view: 'mouth', u: 0.60, v: 0.50, prefer: 'front' },
  { text: '下唇圆形隆起', view: 'mouth', u: 0.58, v: 0.62, prefer: 'front' },
  { text: '沟状凹', view: 'mouth', u: 0.50, v: 0.58, prefer: 'front' },
  { text: '白脊（口唇外圈脊状隆起线）', view: 'mouth', u: 0.56, v: 0.45, prefer: 'front' },
  { text: '口角(窝)', view: 'mouth', u: 0.72, v: 0.52, prefer: 'front' },
  { text: '颏唇沟', view: 'mouth', u: 0.50, v: 0.72, prefer: 'front' },
  { text: '白脊（下唇）', view: 'mouth', u: 0.50, v: 0.64, prefer: 'front' },

  // —— 眉（右）——
  { text: '眉弓隆起', view: 'brow', u: 0.42, v: 0.28, prefer: 'front' },
  { text: '眉头', view: 'brow', u: 0.36, v: 0.42, prefer: 'front' },
  { text: '眉峰', view: 'brow', u: 0.52, v: 0.36, prefer: 'front' },
  { text: '眉毛最浓处', view: 'brow', u: 0.46, v: 0.40, prefer: 'front' },
  { text: '眼眶上缘+脂肪垫', view: 'brow', u: 0.48, v: 0.22, prefer: 'front' },

  // —— 眼（右，画面中眼裂）——
  // 净图：睑裂大致在画布中部；内眦靠鼻（u 更大），外眦靠颞（u 更小）
  { text: '睑眉沟', view: 'eye', u: 0.48, v: 0.28, prefer: 'front' },
  { text: '睑上沟', view: 'eye', u: 0.48, v: 0.38, prefer: 'front' },
  { text: '上眼睑', view: 'eye', u: 0.48, v: 0.44, prefer: 'front' },
  { text: '下眼睑', view: 'eye', u: 0.48, v: 0.58, prefer: 'front' },
  { text: '内眦', view: 'eye', u: 0.62, v: 0.50, prefer: 'front' },
  { text: '外眦', view: 'eye', u: 0.32, v: 0.48, prefer: 'front' },
  { text: '眼球', view: 'eye', u: 0.50, v: 0.50, prefer: 'front' },
  { text: '虹膜', view: 'eye', u: 0.48, v: 0.50, prefer: 'front' },
  { text: '角膜', view: 'eye', u: 0.49, v: 0.48, prefer: 'front' },
  { text: '巩白', view: 'eye', u: 0.56, v: 0.50, prefer: 'front' },
  { text: '卧蚕', view: 'eye', u: 0.48, v: 0.64, prefer: 'front' },
  { text: '睑下沟', view: 'eye', u: 0.48, v: 0.72, prefer: 'front' },
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
  for (let i = 0; i < 25; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.4);
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
  for (const spec of SPECS) {
    const pt = byText[spec.text];
    if (!pt) {
      report.push({ text: spec.text, ok: false, error: 'missing' });
      continue;
    }
    const view = VIEWS[spec.view];
    if (spec.view !== lastView) {
      await page.evaluate((v) => {
        const viewer = document.querySelector('#workbench-viewer');
        viewer.setAttribute('camera-target', v.target);
        viewer.setAttribute('camera-orbit', v.orbit);
        viewer.setAttribute('field-of-view', `${v.fov}deg`);
      }, view);
      await page.waitForTimeout(380);
      lastView = spec.view;
    }

    const hit = await page.evaluate(({ u, v, prefer }) => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      const cx = rect.left + rect.width * u;
      const cy = rect.top + rect.height * v;
      let best = null;
      for (let r = 0; r <= 18; r += 2) {
        for (let a = 0; a < (r === 0 ? 1 : 8); a++) {
          const rad = (a * Math.PI) / 4;
          const ox = r === 0 ? 0 : Math.round(r * Math.cos(rad));
          const oy = r === 0 ? 0 : Math.round(r * Math.sin(rad));
          const h = viewer.positionAndNormalFromPoint(cx + ox, cy + oy);
          if (!h) continue;
          const p = h.position;
          let nx = h.normal.x;
          let ny = h.normal.y;
          let nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          let score;
          if (prefer === 'lat') {
            // 耳：偏好更大 +x，且不要落到颈前
            score = p.x * 8 + nz * 0.5 - Math.abs(p.z) * 0.3;
            if (p.x < 0.03) score -= 20;
          } else {
            // 面：偏好 +z、中线附近略优
            score = p.z * 5 + nz * 2;
            if (p.z < 0.02) score -= 15;
          }
          // 距离目标像素越近越好
          score -= r * 0.15;
          if (!best || score > best.score) {
            best = {
              score,
              pos: [p.x, p.y, p.z],
              norm: [nx, ny, nz],
              r,
            };
          }
        }
      }
      return best;
    }, { u: spec.u, v: spec.v, prefer: spec.prefer });

    if (!hit) {
      report.push({ text: spec.text, ok: false, error: 'nohit', old: pt.pos });
      console.log('NOHIT', spec.text);
      continue;
    }
    const n = faceCam(hit.norm, view.orbit);
    const newPos = `${hit.pos[0].toFixed(4)}m ${hit.pos[1].toFixed(4)}m ${hit.pos[2].toFixed(4)}m`;
    const newNorm = `${n[0].toFixed(4)}m ${n[1].toFixed(4)}m ${n[2].toFixed(4)}m`;
    const old = pt.pos;
    pt.pos = newPos;
    pt.norm = newNorm;
    report.push({ text: spec.text, ok: true, old, pos: newPos, r: hit.r });
    console.log('FIX', spec.text, old, '->', newPos);
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  // QA shots：只显示当前组
  const qaViews = [
    { name: 'eye', orbit: '-18deg 88deg auto', target: '-0.032m 0.176m 0.065m', fov: 10 },
    { name: 'mouth', orbit: '0deg 98deg auto', target: '0m 0.128m 0.075m', fov: 11 },
    { name: 'nose', orbit: '0deg 92deg auto', target: '0m 0.165m 0.08m', fov: 12 },
    { name: 'ear', orbit: '88deg 90deg auto', target: '0.062m 0.160m 0.005m', fov: 14 },
    { name: 'front', orbit: '0deg 88deg auto', target: '0m 0.16m 0.05m', fov: 24 },
  ];
  // reload to show new positions
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const frame = document.getElementById('anno-mobile-frame-overlay');
    if (frame) frame.hidden = true;
  });
  for (const q of qaViews) {
    await page.evaluate((v) => {
      const viewer = document.querySelector('#workbench-viewer');
      viewer.setAttribute('camera-target', v.target);
      viewer.setAttribute('camera-orbit', v.orbit);
      viewer.setAttribute('field-of-view', `${v.fov}deg`);
    }, q);
    await page.waitForTimeout(450);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `qa_${q.name}.png`) });
  }

  // focus 外眦 / 内眦 / 虹膜
  for (const t of ['外眦', '内眦', '虹膜', '唇珠', '鼻头', '耳轮']) {
    await page.evaluate((name) => {
      const inp = [...document.querySelectorAll('#points-list .point-text-input')].find((el) => el.value === name);
      if (!inp) return;
      (inp.closest('.point-item') || inp.parentElement).querySelector('.point-name')?.click();
    }, t);
    await page.waitForTimeout(700);
    await page.locator('#workbench-viewer').screenshot({
      path: path.join(outDir, `focus_${t.replace(/[^\w\u4e00-\u9fff]+/g, '_')}.png`),
    });
  }

  console.log(JSON.stringify({ ok: true, fixed: report.filter((r) => r.ok).length, outDir }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
