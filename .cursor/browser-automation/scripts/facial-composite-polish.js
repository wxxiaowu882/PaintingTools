const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repo = path.resolve(__dirname, '..', '..', '..');
const jsonPath = path.join(repo, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const outLog = path.join(repo, '.cursor', 'browser-automation', 'runs', '_facial_polish_log.txt');

function parsePos(s) {
  const [x, y, z] = s.replace(/m/g, '').split(/\s+/).map(Number);
  return { x, y, z };
}

const JOBS = [
  // 鼻中隔（小柱）：紧贴鼻底下方，略收 z
  {
    text: '鼻中隔',
    orbit: '0deg 135deg auto',
    fov: 10,
    box: { xmin: -0.015, xmax: 0.015, ymin: 0.135, ymax: 0.143, zmin: 0.055, zmax: 0.082 },
    score: (p, n) => p.y * 8 + p.z * 3 + n.z * 2 - Math.abs(p.x) * 20,
  },
  // 唇珠：应低于人中沟
  {
    text: '唇珠',
    orbit: '0deg 95deg auto',
    fov: 11,
    box: { xmin: -0.012, xmax: 0.012, ymin: 0.126, ymax: 0.134, zmin: 0.072, zmax: 0.086 },
    score: (p, n) => p.z * 4 + n.z * 2 - Math.abs(p.x) * 15,
  },
];

(async () => {
  const lines = [];
  const log = (s) => {
    lines.push(s);
    console.log(s);
  };
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 750 } });
  await page.goto('http://127.0.0.1:18080/' + encodeURI('自用工具文件_不部署/模型标注生产工具.html'), {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && (v.getAttribute('src') || '').includes('石膏');
  }, null, { timeout: 180000 });
  for (let i = 0; i < 25; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.35);
    });
    if (ok) break;
    await page.waitForTimeout(250);
  }

  for (const job of JOBS) {
    await page.evaluate(({ orbit, fov }) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-orbit', orbit);
      v.setAttribute('field-of-view', `${fov}deg`);
    }, { orbit: job.orbit, fov: job.fov });
    await page.waitForTimeout(300);
    // score fn cannot be passed into evaluate — encode preference as mode string
    const mode = job.text === '鼻中隔' ? 'septum' : 'tubercle';
    const hit = await page.evaluate(({ box, mode }) => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      let best = null;
      let samples = 0;
      for (let yy = 0.08; yy <= 0.85; yy += 0.018) {
        for (let xx = 0.28; xx <= 0.72; xx += 0.018) {
          const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy);
          if (!h) continue;
          samples++;
          const p = h.position;
          if (p.x < box.xmin || p.x > box.xmax || p.y < box.ymin || p.y > box.ymax || p.z < box.zmin || p.z > box.zmax) continue;
          let nx = h.normal.x, ny = h.normal.y, nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len; ny /= len; nz /= len;
          let score;
          if (mode === 'septum') score = p.y * 8 + p.z * 3 + nz * 2 - Math.abs(p.x) * 20;
          else score = p.z * 4 + nz * 2 - Math.abs(p.x) * 15;
          if (!best || score > best.score) {
            best = {
              score,
              pos: `${p.x.toFixed(4)}m ${p.y.toFixed(4)}m ${p.z.toFixed(4)}m`,
              norm: `${nx.toFixed(4)}m ${ny.toFixed(4)}m ${nz.toFixed(4)}m`,
              xyz: { x: p.x, y: p.y, z: p.z },
            };
          }
        }
      }
      return { best, samples };
    }, { box: job.box, mode });
    const pt = data.pointsData.find((p) => p.text === job.text);
    if (!hit.best) {
      log(`NOHIT ${job.text} samples=${hit.samples} keep=${pt && pt.pos}`);
      continue;
    }
    log(`FIX ${job.text} ${pt.pos} -> ${hit.best.pos} (samples=${hit.samples})`);
    pt.pos = hit.best.pos;
    pt.norm = hit.best.norm;
  }

  // sanity dump
  for (const name of ['鼻头', '鼻底', '鼻中隔', '人中（沟）', '人中脊', '唇珠']) {
    const pt = data.pointsData.find((p) => p.text === name);
    log(`FINAL ${name}: ${pt ? pt.pos : 'MISSING'}`);
  }
  const septum = parsePos(data.pointsData.find((p) => p.text === '鼻中隔').pos);
  const philtrum = parsePos(data.pointsData.find((p) => p.text === '人中（沟）').pos);
  const ridge = parsePos(data.pointsData.find((p) => p.text === '人中脊').pos);
  const tubercle = parsePos(data.pointsData.find((p) => p.text === '唇珠').pos);
  const base = parsePos(data.pointsData.find((p) => p.text === '鼻底').pos);
  const okOrder =
    base.y > septum.y &&
    septum.y > philtrum.y - 0.002 &&
    philtrum.y > tubercle.y - 0.002 &&
    Math.abs(septum.y - philtrum.y) > 0.003;
  log(`ORDER_OK=${okOrder} base>${septum.y.toFixed(4)} phil=${philtrum.y.toFixed(4)} ridge=${ridge.y.toFixed(4)} tub=${tubercle.y.toFixed(4)}`);

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');
  fs.writeFileSync(outLog, lines.join('\n') + '\n', 'utf8');
  log('WROTE ' + jsonPath);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
