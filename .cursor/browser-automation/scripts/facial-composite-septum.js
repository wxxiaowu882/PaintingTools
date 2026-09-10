const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repo = path.resolve(__dirname, '..', '..', '..');
const jsonPath = path.join(repo, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');

(async () => {
  console.log('json', jsonPath, fs.existsSync(jsonPath));
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-orbit', '0deg 135deg auto');
    v.setAttribute('field-of-view', '10deg');
  });
  await page.waitForTimeout(400);
  const hit = await page.evaluate(() => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    // 仰视：鼻小柱通常比鼻底更靠后（z 更小）
    const box = { xmin: -0.012, xmax: 0.012, ymin: 0.132, ymax: 0.146, zmin: 0.045, zmax: 0.078 };
    let best = null;
    for (let yy = 0.08; yy <= 0.85; yy += 0.015) {
      for (let xx = 0.25; xx <= 0.75; xx += 0.015) {
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy);
        if (!h) continue;
        const p = h.position;
        if (p.x < box.xmin || p.x > box.xmax || p.y < box.ymin || p.y > box.ymax || p.z < box.zmin || p.z > box.zmax) continue;
        let nx = h.normal.x;
        let ny = h.normal.y;
        let nz = h.normal.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        // 偏好更靠后、更居中
        const score = -Math.abs(p.x) * 8 - p.z * 3 - Math.abs(p.y - 0.138);
        if (!best || score > best.score) {
          best = {
            score,
            xyz: { x: p.x, y: p.y, z: p.z },
            pos: `${p.x.toFixed(4)}m ${p.y.toFixed(4)}m ${p.z.toFixed(4)}m`,
            norm: `${nx.toFixed(4)}m ${ny.toFixed(4)}m ${nz.toFixed(4)}m`,
          };
        }
      }
    }
    return best;
  });
  console.log('hit', hit);
  const pt = data.pointsData.find((p) => p.text === '鼻中隔');
  if (hit) {
    console.log('old', pt.pos, '->', hit.pos);
    pt.pos = hit.pos;
    pt.norm = hit.norm;
  } else {
    // 相对鼻底略后移：用仰视射线再试鼻翼脚附近中线
    const base = data.pointsData.find((p) => p.text === '鼻底');
    const wing = data.pointsData.find((p) => p.text === '鼻翼脚');
    const [, , bz] = base.pos.split(' ').map((s) => parseFloat(s));
    const [, wy, wz] = wing.pos.split(' ').map((s) => parseFloat(s));
    const targetZ = Math.min(bz - 0.01, wz);
    const hit2 = await page.evaluate(({ wy, targetZ }) => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      let best = null;
      for (let yy = 0.1; yy <= 0.8; yy += 0.02) {
        for (let xx = 0.35; xx <= 0.65; xx += 0.02) {
          const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy);
          if (!h) continue;
          const p = h.position;
          if (Math.abs(p.x) > 0.012) continue;
          if (Math.abs(p.y - wy) > 0.01) continue;
          if (p.z > targetZ + 0.005 || p.z < targetZ - 0.02) continue;
          let nx = h.normal.x, ny = h.normal.y, nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len; ny /= len; nz /= len;
          const score = -Math.abs(p.x) * 10 - Math.abs(p.z - targetZ);
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
    }, { wy, targetZ });
    console.log('hit2', hit2);
    if (hit2) {
      console.log('old', pt.pos, '->', hit2.pos);
      pt.pos = hit2.pos;
      pt.norm = hit2.norm;
    }
  }
  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
