/**
 * 只修外眦（贴睑裂外角，勿落到颞侧颊面）+ 再拍复核图。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-fix-waizi`);

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

  // 更正面看右眼，外眦应在虹膜颞侧睑裂尽头
  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-target', '-0.036m 0.176m 0.068m');
    v.setAttribute('camera-orbit', '-8deg 90deg auto');
    v.setAttribute('field-of-view', '8deg');
  });
  await page.waitForTimeout(400);

  const iris = data.pointsData.find((p) => p.text === '虹膜');
  const [ix, iy, iz] = iris.pos.replace(/m/g, '').split(/\s+/).map(Number);

  const hit = await page.evaluate(({ ix, iy, iz }) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    let best = null;
    for (let yy = 0.25; yy <= 0.75; yy += 0.015) {
      for (let xx = 0.15; xx <= 0.55; xx += 0.015) {
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy);
        if (!h) continue;
        const p = h.position;
        // 外眦：比虹膜更负 x，y 接近，z 不能太靠后
        if (p.x > ix - 0.008 || p.x < ix - 0.028) continue;
        if (Math.abs(p.y - iy) > 0.012) continue;
        if (p.z < iz - 0.018 || p.z > iz + 0.008) continue;
        let nx = h.normal.x,
          ny = h.normal.y,
          nz = h.normal.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        // 偏好：更靠前、法线朝前、略低于/平于虹膜
        const score = p.z * 6 + nz * 3 - Math.abs(p.y - iy) * 10 - Math.abs(p.x - (ix - 0.016)) * 8;
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
    return best;
  }, { ix, iy, iz });

  const pt = data.pointsData.find((p) => p.text === '外眦');
  if (!hit) {
    console.log('NOHIT keep', pt.pos);
  } else {
    console.log('FIX 外眦', pt.pos, '->', hit.pos);
    pt.pos = hit.pos;
    pt.norm = hit.norm;
  }
  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');

  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const frame = document.getElementById('anno-mobile-frame-overlay');
    if (frame) frame.hidden = true;
  });

  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-target', '-0.036m 0.176m 0.068m');
    v.setAttribute('camera-orbit', '-8deg 90deg auto');
    v.setAttribute('field-of-view', '8deg');
  });
  await page.waitForTimeout(400);
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'qa_eye.png') });

  await page.evaluate(() => {
    const inp = [...document.querySelectorAll('#points-list .point-text-input')].find((el) => el.value === '外眦');
    (inp.closest('.point-item') || inp.parentElement).querySelector('.point-name')?.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-target', '-0.036m 0.176m 0.068m');
    v.setAttribute('camera-orbit', '-8deg 90deg auto');
    v.setAttribute('field-of-view', '8deg');
  });
  await page.waitForTimeout(300);
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'focus_外眦.png') });

  for (const t of ['内眦', '虹膜']) {
    await page.evaluate((name) => {
      const inp = [...document.querySelectorAll('#points-list .point-text-input')].find((el) => el.value === name);
      (inp.closest('.point-item') || inp.parentElement).querySelector('.point-name')?.click();
    }, t);
    await page.waitForTimeout(450);
    await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-target', '-0.036m 0.176m 0.068m');
      v.setAttribute('camera-orbit', '-8deg 90deg auto');
      v.setAttribute('field-of-view', '8deg');
    });
    await page.waitForTimeout(250);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `focus_${t}.png`) });
  }

  fs.writeFileSync(path.join(outDir, 'hit.json'), JSON.stringify({ hit, iris: iris.pos }, null, 2));
  console.log(JSON.stringify({ ok: true, outDir, hit }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
