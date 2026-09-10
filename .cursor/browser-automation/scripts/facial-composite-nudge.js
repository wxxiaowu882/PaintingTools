/**
 * 微调：人中沟略下移；鼻中隔与鼻底拉开。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const outDir = path.join(__dirname, '..', 'runs', `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-facial-composite-nudge`);

const TARGETS = [
  {
    text: '人中（沟）',
    orbit: '0deg 98deg auto',
    fov: 10,
    box: { xmin: -0.008, xmax: 0.008, ymin: 0.133, ymax: 0.139, zmin: 0.068, zmax: 0.082 },
  },
  {
    text: '鼻中隔',
    orbit: '0deg 132deg auto',
    fov: 11,
    box: { xmin: -0.008, xmax: 0.008, ymin: 0.134, ymax: 0.140, zmin: 0.055, zmax: 0.072 },
  },
];

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
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.35);
    });
    if (ok) break;
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => {
    const el = document.getElementById('console-panel');
    if (el) el.style.visibility = 'hidden';
  });

  for (const t of TARGETS) {
    await page.evaluate(({ orbit, fov }) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-orbit', orbit);
      v.setAttribute('field-of-view', `${fov}deg`);
    }, { orbit: t.orbit, fov: t.fov });
    await page.waitForTimeout(280);
    const hit = await page.evaluate(({ box }) => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      const step = 0.03;
      let best = null;
      for (let yy = 0.1; yy <= 0.9; yy += step) {
        for (let xx = 0.25; xx <= 0.75; xx += step) {
          const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy);
          if (!h) continue;
          const p = h.position;
          if (p.x < box.xmin || p.x > box.xmax || p.y < box.ymin || p.y > box.ymax || p.z < box.zmin || p.z > box.zmax) continue;
          let nx = h.normal.x, ny = h.normal.y, nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len; ny /= len; nz /= len;
          const score = p.z + nz - Math.abs(p.x) * 4;
          if (!best || score > best.score) {
            best = {
              score,
              pos: `${p.x.toFixed(4)}m ${p.y.toFixed(4)}m ${p.z.toFixed(4)}m`,
              norm: `${nx.toFixed(4)}m ${ny.toFixed(4)}m ${nz.toFixed(4)}m`,
            };
          }
        }
      }
      return best;
    }, { box: t.box });
    const pt = data.pointsData.find((p) => p.text === t.text);
    if (!hit || !pt) {
      console.log('NOHIT', t.text);
      continue;
    }
    console.log('NUDGE', t.text, pt.pos, '->', hit.pos);
    pt.pos = hit.pos;
    pt.norm = hit.norm;
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await page.evaluate(() => { const i = document.querySelector('#file-input'); if (i) i.value = ''; });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-orbit', '0deg 90deg auto');
    v.setAttribute('field-of-view', '14deg');
    v.querySelectorAll('.preview-hotspot').forEach((el) => el.classList.add('show-text'));
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'qa_nudge.png') });
  console.log('DONE', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
