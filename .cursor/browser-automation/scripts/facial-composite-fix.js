/**
 * 05 综合场景纠偏：按世界坐标硬约束重拾（耳必须 +x，中线 |x| 小，鼻底勿落到颏）。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-composite-fix`);
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');

const VIEWS = {
  ear: { orbit: '88deg 90deg auto', fov: 11 },
  nose: { orbit: '0deg 88deg auto', fov: 12 },
  nose_up: { orbit: '5deg 128deg auto', fov: 12 },
  mouth: { orbit: '0deg 100deg auto', fov: 10 },
  eye: { orbit: '-18deg 86deg auto', fov: 9 },
  brow: { orbit: '-12deg 74deg auto', fov: 11 },
};

/** 纠偏表：覆盖全部点，用更稳的 uv + 约束 */
const FIXES = [
  // ear — 只接受 x>0.035
  { text: '耳轮脚', view: 'ear', u: 0.40, v: 0.40, mode: 'ear' },
  { text: '耳轮', view: 'ear', u: 0.56, v: 0.26, mode: 'ear' },
  { text: '耳垂', view: 'ear', u: 0.50, v: 0.76, mode: 'ear' },
  { text: '对耳轮', view: 'ear', u: 0.48, v: 0.46, mode: 'ear' },
  { text: '对耳轮上脚', view: 'ear', u: 0.46, v: 0.30, mode: 'ear' },
  { text: '对耳轮下脚', view: 'ear', u: 0.44, v: 0.38, mode: 'ear' },
  { text: '耳屏', view: 'ear', u: 0.34, v: 0.50, mode: 'ear' },
  { text: '对耳屏', view: 'ear', u: 0.46, v: 0.64, mode: 'ear' },
  { text: '凹入缺口', view: 'ear', u: 0.38, v: 0.58, mode: 'ear' },
  { text: '前缺口', view: 'ear', u: 0.34, v: 0.42, mode: 'ear' },
  { text: '耳甲腔', view: 'ear', u: 0.42, v: 0.52, mode: 'ear' },
  { text: '耳甲艇', view: 'ear', u: 0.44, v: 0.40, mode: 'ear' },
  { text: '三角凹', view: 'ear', u: 0.48, v: 0.24, mode: 'ear' },
  { text: '舟状凹', view: 'ear', u: 0.60, v: 0.36, mode: 'ear' },
  { text: '耳廓结节', view: 'ear', u: 0.62, v: 0.30, mode: 'ear' },

  // nose front
  { text: '鼻根', view: 'nose', u: 0.50, v: 0.28, mode: 'mid' },
  { text: '鼻梁(鼻背)', view: 'nose', u: 0.50, v: 0.38, mode: 'mid' },
  { text: '鼻头', view: 'nose', u: 0.50, v: 0.50, mode: 'midZ' },
  { text: '鼻翼', view: 'nose', u: 0.60, v: 0.52, mode: 'frontR' },
  { text: '鼻唇沟起点', view: 'nose', u: 0.62, v: 0.58, mode: 'frontR' },

  // nose up — 仰视时鼻在画面偏上
  { text: '鼻底', view: 'nose_up', u: 0.50, v: 0.28, mode: 'noseBase' },
  { text: '鼻中隔', view: 'nose_up', u: 0.50, v: 0.34, mode: 'noseBase' },
  { text: '鼻翼脚', view: 'nose_up', u: 0.58, v: 0.36, mode: 'noseBaseR' },

  // mouth
  { text: '人中（沟）', view: 'mouth', u: 0.50, v: 0.40, mode: 'mid' },
  { text: '人中脊', view: 'mouth', u: 0.55, v: 0.40, mode: 'frontR' },
  { text: '人中切迹', view: 'mouth', u: 0.50, v: 0.48, mode: 'mid' },
  { text: '唇峰', view: 'mouth', u: 0.56, v: 0.50, mode: 'frontR' },
  { text: '唇珠', view: 'mouth', u: 0.50, v: 0.54, mode: 'mid' },
  { text: '翼状凹', view: 'mouth', u: 0.60, v: 0.54, mode: 'frontR' },
  { text: '下唇圆形隆起', view: 'mouth', u: 0.58, v: 0.64, mode: 'frontR' },
  { text: '沟状凹', view: 'mouth', u: 0.50, v: 0.60, mode: 'mid' },
  { text: '白脊（口唇外圈脊状隆起线）', view: 'mouth', u: 0.55, v: 0.49, mode: 'frontR' },
  { text: '口角(窝)', view: 'mouth', u: 0.72, v: 0.56, mode: 'frontR' },
  { text: '颏唇沟', view: 'mouth', u: 0.50, v: 0.72, mode: 'mid' },
  { text: '白脊（下唇）', view: 'mouth', u: 0.50, v: 0.66, mode: 'mid' },

  // brow / eye — 模型右眼 x<0
  { text: '眉弓隆起', view: 'brow', u: 0.40, v: 0.30, mode: 'eyeR' },
  { text: '眉头', view: 'brow', u: 0.34, v: 0.34, mode: 'eyeR' },
  { text: '眉峰', view: 'brow', u: 0.46, v: 0.30, mode: 'eyeR' },
  { text: '眉毛最浓处', view: 'brow', u: 0.42, v: 0.32, mode: 'eyeR' },
  { text: '眼眶上缘+脂肪垫', view: 'brow', u: 0.42, v: 0.24, mode: 'eyeR' },
  { text: '睑眉沟', view: 'eye', u: 0.42, v: 0.32, mode: 'eyeR' },
  { text: '睑上沟', view: 'eye', u: 0.44, v: 0.38, mode: 'eyeR' },
  { text: '上眼睑', view: 'eye', u: 0.44, v: 0.42, mode: 'eyeR' },
  { text: '下眼睑', view: 'eye', u: 0.44, v: 0.54, mode: 'eyeR' },
  { text: '内眦', view: 'eye', u: 0.34, v: 0.48, mode: 'eyeR' },
  { text: '外眦', view: 'eye', u: 0.54, v: 0.48, mode: 'eyeR' },
  { text: '眼球', view: 'eye', u: 0.46, v: 0.48, mode: 'eyeR' },
  { text: '虹膜', view: 'eye', u: 0.45, v: 0.48, mode: 'eyeR' },
  { text: '角膜', view: 'eye', u: 0.46, v: 0.46, mode: 'eyeR' },
  { text: '巩白', view: 'eye', u: 0.40, v: 0.48, mode: 'eyeR' },
  { text: '卧蚕', view: 'eye', u: 0.44, v: 0.58, mode: 'eyeR' },
  { text: '睑下沟', view: 'eye', u: 0.44, v: 0.64, mode: 'eyeR' },
];

function accept(mode, p) {
  const { x, y, z } = p;
  switch (mode) {
    case 'ear':
      return x > 0.035 && y > 0.10 && y < 0.22 && z < 0.05;
    case 'mid':
      return Math.abs(x) < 0.012 && z > 0.05;
    case 'midZ':
      return Math.abs(x) < 0.012 && z > 0.07;
    case 'frontR':
      return x > -0.005 && x < 0.045 && z > 0.05;
    case 'noseBase':
      return Math.abs(x) < 0.015 && y > 0.125 && y < 0.165 && z > 0.04;
    case 'noseBaseR':
      return x > 0.005 && x < 0.04 && y > 0.125 && y < 0.165 && z > 0.04;
    case 'eyeR':
      return x < -0.01 && x > -0.06 && y > 0.14 && y < 0.22 && z > 0.05;
    default:
      return true;
  }
}

function score(mode, p, n) {
  switch (mode) {
    case 'ear':
      return p.x * 4 - Math.abs(p.z) + Math.abs(n.x);
    case 'mid':
    case 'midZ':
    case 'noseBase':
      return p.z * 3 + n.z - Math.abs(p.x) * 8;
    case 'frontR':
    case 'noseBaseR':
      return p.z * 2 + n.z - Math.abs(p.x - 0.02) * 3;
    case 'eyeR':
      return p.z * 2 + n.z - Math.abs(p.x + 0.03) * 4;
    default:
      return p.z;
  }
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForFunction(
    () => {
      const v = document.querySelector('#workbench-viewer');
      return v && (v.getAttribute('src') || '').includes('石膏');
    },
    null,
    { timeout: 180000 }
  );
  for (let i = 0; i < 30; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.4);
    });
    if (ok) break;
    await page.waitForTimeout(400);
  }

  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
  });

  const boundsCache = {};
  async function boundsFor(viewKey) {
    if (boundsCache[viewKey]) return boundsCache[viewKey];
    const view = VIEWS[viewKey];
    await page.evaluate(({ orbit, fov }) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-target', 'auto auto auto');
      v.setAttribute('camera-orbit', orbit);
      v.setAttribute('field-of-view', `${fov}deg`);
    }, view);
    await page.waitForTimeout(350);
    const b = await page.evaluate(() => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      const step = 0.05;
      let minX = 1;
      let minY = 1;
      let maxX = 0;
      let maxY = 0;
      let any = false;
      for (let yy = 0.05; yy <= 0.95; yy += step) {
        for (let xx = 0.05; xx <= 0.95; xx += step) {
          if (viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy)) {
            any = true;
            minX = Math.min(minX, xx);
            minY = Math.min(minY, yy);
            maxX = Math.max(maxX, xx);
            maxY = Math.max(maxY, yy);
          }
        }
      }
      return any ? { minX, minY, maxX, maxY } : null;
    });
    boundsCache[viewKey] = b;
    return b;
  }

  for (const k of Object.keys(VIEWS)) await boundsFor(k);

  const report = [];
  let lastView = null;
  for (const fix of FIXES) {
    if (fix.view !== lastView) {
      await page.evaluate(({ orbit, fov }) => {
        const v = document.querySelector('#workbench-viewer');
        v.setAttribute('camera-orbit', orbit);
        v.setAttribute('field-of-view', `${fov}deg`);
      }, VIEWS[fix.view]);
      await page.waitForTimeout(200);
      lastView = fix.view;
    }
    const bounds = boundsCache[fix.view];
    const hit = await page.evaluate(
      ({ u, v, bounds, mode }) => {
        const viewer = document.querySelector('#workbench-viewer');
        const rect = viewer.getBoundingClientRect();
        const sx = bounds.minX + (bounds.maxX - bounds.minX) * u;
        const sy = bounds.minY + (bounds.maxY - bounds.minY) * v;
        const baseX = rect.left + rect.width * sx;
        const baseY = rect.top + rect.height * sy;
        const offsets = [[0, 0]];
        for (let r = 2; r <= 18; r += 2) {
          for (let a = 0; a < 12; a++) {
            const rad = (a / 12) * Math.PI * 2;
            offsets.push([Math.cos(rad) * r, Math.sin(rad) * r]);
          }
        }
        // accept/score inlined
        function accept(mode, p) {
          const { x, y, z } = p;
          if (mode === 'ear') return x > 0.035 && y > 0.10 && y < 0.22 && z < 0.05;
          if (mode === 'mid') return Math.abs(x) < 0.012 && z > 0.05;
          if (mode === 'midZ') return Math.abs(x) < 0.012 && z > 0.07;
          if (mode === 'frontR') return x > -0.005 && x < 0.045 && z > 0.05;
          if (mode === 'noseBase') return Math.abs(x) < 0.015 && y > 0.125 && y < 0.165 && z > 0.04;
          if (mode === 'noseBaseR') return x > 0.005 && x < 0.04 && y > 0.125 && y < 0.165 && z > 0.04;
          if (mode === 'eyeR') return x < -0.01 && x > -0.06 && y > 0.14 && y < 0.22 && z > 0.05;
          return true;
        }
        function score(mode, p, n) {
          if (mode === 'ear') return p.x * 4 - Math.abs(p.z) + Math.abs(n.x);
          if (mode === 'mid' || mode === 'midZ' || mode === 'noseBase') return p.z * 3 + n.z - Math.abs(p.x) * 8;
          if (mode === 'frontR' || mode === 'noseBaseR') return p.z * 2 + n.z - Math.abs(p.x - 0.02) * 3;
          if (mode === 'eyeR') return p.z * 2 + n.z - Math.abs(p.x + 0.03) * 4;
          return p.z;
        }
        let best = null;
        for (const [ox, oy] of offsets) {
          const h = viewer.positionAndNormalFromPoint(baseX + ox, baseY + oy);
          if (!h) continue;
          const p = { x: h.position.x, y: h.position.y, z: h.position.z };
          if (!accept(mode, p)) continue;
          let nx = h.normal.x;
          let ny = h.normal.y;
          let nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          const s = score(mode, p, { x: nx, y: ny, z: nz });
          if (!best || s > best.s) {
            best = {
              s,
              pos: `${p.x.toFixed(4)}m ${p.y.toFixed(4)}m ${p.z.toFixed(4)}m`,
              norm: `${nx.toFixed(4)}m ${ny.toFixed(4)}m ${nz.toFixed(4)}m`,
              xyz: p,
            };
          }
        }
        return best;
      },
      { u: fix.u, v: fix.v, bounds, mode: fix.mode }
    );

    const pt = data.pointsData.find((p) => p.text === fix.text);
    if (!pt) {
      report.push({ text: fix.text, status: 'missing-in-json' });
      continue;
    }
    if (!hit) {
      report.push({ text: fix.text, status: 'no-hit', old: pt.pos });
      console.log('NOHIT', fix.text, 'keep', pt.pos);
      continue;
    }
    const old = pt.pos;
    pt.pos = hit.pos;
    pt.norm = hit.norm;
    report.push({ text: fix.text, status: 'ok', old, neu: hit.pos });
    console.log('FIX', fix.text, hit.pos);
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

  // QA：重新导入并截图（每视角新等）
  await page.evaluate(() => {
    const inp = document.querySelector('#file-input');
    if (inp) inp.value = '';
  });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForTimeout(3500);

  const qa = [
    { name: 'qa_front', orbit: '0deg 85deg auto', fov: 24 },
    { name: 'qa_eye', orbit: '-16deg 84deg auto', fov: 11 },
    { name: 'qa_nose', orbit: '0deg 90deg auto', fov: 12 },
    { name: 'qa_mouth', orbit: '0deg 100deg auto', fov: 11 },
    { name: 'qa_ear', orbit: '88deg 90deg auto', fov: 11 },
    { name: 'qa_nose_up', orbit: '5deg 128deg auto', fov: 12 },
  ];
  for (const view of qa) {
    await page.evaluate(({ orbit, fov }) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-orbit', orbit);
      v.setAttribute('field-of-view', `${fov}deg`);
      v.querySelectorAll('.preview-hotspot').forEach((el) => el.classList.add('show-text'));
    }, view);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outDir, `${view.name}.png`) });
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  const nohit = report.filter((r) => r.status !== 'ok');
  console.log('DONE nohit=', nohit.length, 'out=', outDir);
  await browser.close();
  if (nohit.length) process.exitCode = 2;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
