/**
 * 单点视觉微调：降口角肌 → 口角外下三角区
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const OUT_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解_黄种人女V8.json');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-fix-dao`);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  const mouth = data.pointsData.find((p) => p.text === '口轮匝肌');
  const dao = data.pointsData.find((p) => p.text === '降口角肌');
  const [mx, my, mz] = mouth.pos.replace(/m/g, '').split(/\s+/).map(Number);

  // 口角外下：略低于口裂、略偏外侧、略退
  const target = [mx + 0.024, my - 0.018, mz - 0.015];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', OUT_JSON);
  await page.waitForFunction(
    () => /23/.test((document.getElementById('point-count') || {}).innerText || ''),
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
  });

  // 斜前视，看清口角下方
  await page.evaluate(
    ({ target }) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute(
        'camera-target',
        `${target[0].toFixed(4)}m ${target[1].toFixed(4)}m ${target[2].toFixed(4)}m`
      );
      v.setAttribute('camera-orbit', '25deg 85deg auto');
      v.setAttribute('field-of-view', '16deg');
    },
    { target }
  );
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, '01-before-aim.png'), fullPage: true });

  const picked = await page.evaluate(({ target }) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const srcNorm = [0.7, -0.2, 0.65];

    function ray(x, y) {
      return viewer.positionAndNormalFromPoint(x, y);
    }
    function dist(a, b) {
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    }
    function norm3(v) {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    }
    function dot(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    let best = null;
    for (let dy = -50; dy <= 50; dy += 5) {
      for (let dx = -50; dx <= 50; dx += 5) {
        const h = ray(cx + dx, cy + dy);
        if (!h) continue;
        let n = norm3([h.normal.x, h.normal.y, h.normal.z]);
        if (dot(n, srcNorm) < 0) n = [-n[0], -n[1], -n[2]];
        const p = [h.position.x, h.position.y, h.position.z];
        // 必须在口角下方区域：y < mouthY approx，x>0
        if (p[0] < 0.01 || p[1] > target[1] + 0.015) continue;
        if (p[1] < target[1] - 0.035) continue;
        const d = dist(p, target);
        if (!best || d < best.d) best = { d, p, n };
      }
    }
    if (!best) return { ok: false };
    return {
      ok: true,
      pos: `${best.p[0].toFixed(4)}m ${best.p[1].toFixed(4)}m ${best.p[2].toFixed(4)}m`,
      norm: `${best.n[0].toFixed(4)}m ${best.n[1].toFixed(4)}m ${best.n[2].toFixed(4)}m`,
      distMm: +(best.d * 1000).toFixed(2),
      xyz: best.p,
    };
  }, { target });

  if (!picked.ok) throw new Error('降口角肌拾取失败');

  dao.pos = picked.pos;
  dao.norm = picked.norm;
  data.timestamp = Date.now();
  fs.writeFileSync(OUT_JSON, JSON.stringify(data, null, 2) + '\n', 'utf8');

  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.visibility = '';
        el.style.opacity = '0.4';
      }
    });
  });

  await page.setInputFiles('#file-input', OUT_JSON);
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const inp = [...document.querySelectorAll('#points-list .point-text-input')].find(
      (el) => el.value === '降口角肌'
    );
    inp?.parentElement.querySelector('.point-name')?.click();
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, '02-confirm-dao.png'), fullPage: true });

  // 再来一张更近的斜视
  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('field-of-view', '14deg');
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, '03-confirm-dao-close.png'), fullPage: true });

  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify({ ok: true, picked, oldPos: dao, target }, null, 2),
    'utf8'
  );
  await browser.close();
  console.log(JSON.stringify({ ok: true, picked, outDir: path.relative(repoRoot, outDir) }, null, 2));
})().catch((e) => {
  console.error('FAIL', e);
  process.exitCode = 1;
});
