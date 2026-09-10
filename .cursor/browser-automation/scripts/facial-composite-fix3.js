/**
 * 05：对剩余难点做「全屏候选 + 世界盒过滤」重拾。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-composite-fix3`);
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');

const TARGETS = [
  {
    text: '鼻底',
    orbit: '0deg 128deg auto',
    fov: 12,
    box: { xmin: -0.012, xmax: 0.012, ymin: 0.135, ymax: 0.148, zmin: 0.055, zmax: 0.085 },
    prefer: (p) => -Math.abs(p.x) + p.z,
  },
  {
    text: '鼻中隔',
    orbit: '0deg 132deg auto',
    fov: 11,
    box: { xmin: -0.01, xmax: 0.01, ymin: 0.132, ymax: 0.146, zmin: 0.05, zmax: 0.08 },
    prefer: (p) => -Math.abs(p.x) * 2 + p.z,
  },
  {
    text: '鼻翼脚',
    orbit: '20deg 128deg auto',
    fov: 12,
    box: { xmin: 0.01, xmax: 0.035, ymin: 0.132, ymax: 0.148, zmin: 0.05, zmax: 0.08 },
    prefer: (p) => p.x + p.z,
  },
  {
    text: '人中脊',
    orbit: '8deg 96deg auto',
    fov: 10,
    box: { xmin: 0.004, xmax: 0.02, ymin: 0.128, ymax: 0.142, zmin: 0.065, zmax: 0.085 },
    prefer: (p) => p.z - Math.abs(p.y - 0.135),
  },
  {
    text: '人中（沟）',
    orbit: '0deg 96deg auto',
    fov: 10,
    box: { xmin: -0.008, xmax: 0.008, ymin: 0.128, ymax: 0.142, zmin: 0.065, zmax: 0.085 },
    prefer: (p) => p.z - Math.abs(p.x) * 3,
  },
  // 鼻底若仰视太难，再试一次略高盒
  {
    text: '鼻底',
    orbit: '0deg 120deg auto',
    fov: 13,
    box: { xmin: -0.015, xmax: 0.015, ymin: 0.138, ymax: 0.152, zmin: 0.06, zmax: 0.09 },
    prefer: (p) => -Math.abs(p.x) + p.z - p.y,
    onlyIfStillBad: true,
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
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.35);
    });
    if (ok) break;
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
  });

  function parsePos(s) {
    const [x, y, z] = s.split(' ').map((t) => parseFloat(t));
    return { x, y, z };
  }
  function stillBad(text, pos) {
    const p = parsePos(pos);
    if (text === '鼻底') return p.y > 0.148 || Math.abs(p.z - 0.084) < 0.003;
    if (text === '鼻中隔' || text === '鼻翼脚') return p.y < 0.125;
    if (text === '人中脊') return p.y > 0.145;
    return false;
  }

  const report = [];
  for (const t of TARGETS) {
    const pt = data.pointsData.find((p) => p.text === t.text);
    if (!pt) continue;
    if (t.onlyIfStillBad && !stillBad(t.text, pt.pos)) {
      report.push({ text: t.text, status: 'skip-already-ok', pos: pt.pos });
      continue;
    }
    if (!t.onlyIfStillBad && !stillBad(t.text, pt.pos) && t.text !== '人中（沟）') {
      // 人中沟也想微调，其它已好的跳过
    }

    await page.evaluate(({ orbit, fov }) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-orbit', orbit);
      v.setAttribute('field-of-view', `${fov}deg`);
    }, { orbit: t.orbit, fov: t.fov });
    await page.waitForTimeout(300);

    const hit = await page.evaluate(({ box }) => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      const step = 0.025;
      const cands = [];
      for (let yy = 0.08; yy <= 0.92; yy += step) {
        for (let xx = 0.2; xx <= 0.8; xx += step) {
          const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy);
          if (!h) continue;
          const p = { x: h.position.x, y: h.position.y, z: h.position.z };
          if (p.x < box.xmin || p.x > box.xmax) continue;
          if (p.y < box.ymin || p.y > box.ymax) continue;
          if (p.z < box.zmin || p.z > box.zmax) continue;
          let nx = h.normal.x, ny = h.normal.y, nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len; ny /= len; nz /= len;
          cands.push({
            p,
            pos: `${p.x.toFixed(4)}m ${p.y.toFixed(4)}m ${p.z.toFixed(4)}m`,
            norm: `${nx.toFixed(4)}m ${ny.toFixed(4)}m ${nz.toFixed(4)}m`,
            score: p.z * 2 + nz - Math.abs(p.x),
          });
        }
      }
      cands.sort((a, b) => b.score - a.score);
      return cands[0] || null;
    }, { box: t.box });

    if (!hit) {
      report.push({ text: t.text, status: 'nohit', old: pt.pos });
      console.log('NOHIT', t.text);
      continue;
    }
    const old = pt.pos;
    pt.pos = hit.pos;
    pt.norm = hit.norm;
    report.push({ text: t.text, status: 'ok', old, neu: hit.pos });
    console.log('FIX', t.text, old, '->', hit.pos);
  }

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

  await page.evaluate(() => { const i = document.querySelector('#file-input'); if (i) i.value = ''; });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForTimeout(2500);
  for (const view of [
    { name: 'qa_front', orbit: '0deg 85deg auto', fov: 24 },
    { name: 'qa_nose_up', orbit: '0deg 128deg auto', fov: 12 },
    { name: 'qa_mouth', orbit: '0deg 98deg auto', fov: 11 },
    { name: 'qa_ear', orbit: '88deg 90deg auto', fov: 11 },
  ]) {
    await page.evaluate(({ orbit, fov }) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-orbit', orbit);
      v.setAttribute('field-of-view', `${fov}deg`);
      v.querySelectorAll('.preview-hotspot').forEach((el) => el.classList.add('show-text'));
    }, view);
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(outDir, `${view.name}.png`) });
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('DONE', JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
