/**
 * 降口角肌：正面视角下放到口角外下三角区，并出正面确认图
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const OUT_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解_黄种人女V8.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-dao-front`);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  const mouth = data.pointsData.find((p) => p.text === '口轮匝肌');
  const dao = data.pointsData.find((p) => p.text === '降口角肌');
  const [mx, my, mz] = mouth.pos.replace(/m/g, '').split(/\s+/).map(Number);
  // 口角外下三角肌腹（比口裂低约 2.8cm、外偏 3cm）
  const target = [mx + 0.03, my - 0.028, mz - 0.018];

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

  // 正面对准目标
  await page.evaluate(({ target }) => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute(
      'camera-target',
      `${target[0].toFixed(4)}m ${target[1].toFixed(4)}m ${target[2].toFixed(4)}m`
    );
    v.setAttribute('camera-orbit', '0deg 90deg auto');
    v.setAttribute('field-of-view', '15deg');
  }, { target });
  await page.waitForTimeout(800);

  const picked = await page.evaluate(({ target }) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
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
    let best = null;
    for (let dy = -60; dy <= 60; dy += 4) {
      for (let dx = -60; dx <= 60; dx += 4) {
        const h = ray(cx + dx, cy + dy);
        if (!h) continue;
        const p = [h.position.x, h.position.y, h.position.z];
        // 约束：右侧、低于嘴、高于颏底
        if (p[0] < 0.015 || p[0] > 0.055) continue;
        if (p[1] > target[1] + 0.012 || p[1] < target[1] - 0.025) continue;
        if (p[2] < 0.08) continue;
        const d = dist(p, target);
        let n = norm3([h.normal.x, h.normal.y, h.normal.z]);
        if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
        if (!best || d < best.d) best = { d, p, n };
      }
    }
    if (!best) return { ok: false };
    return {
      ok: true,
      pos: `${best.p[0].toFixed(4)}m ${best.p[1].toFixed(4)}m ${best.p[2].toFixed(4)}m`,
      norm: `${best.n[0].toFixed(4)}m ${best.n[1].toFixed(4)}m ${best.n[2].toFixed(4)}m`,
      xyz: best.p,
      distMm: +(best.d * 1000).toFixed(2),
    };
  }, { target });

  if (!picked.ok) throw new Error('拾取失败');
  dao.pos = picked.pos;
  dao.norm = picked.norm;
  data.timestamp = Date.now();
  fs.writeFileSync(OUT_JSON, JSON.stringify(data, null, 2) + '\n', 'utf8');

  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.visibility = '';
        el.style.opacity = '0.35';
      }
    });
  });
  await page.setInputFiles('#file-input', OUT_JSON);
  await page.waitForTimeout(2500);

  // 正面确认
  await page.evaluate(() => {
    const inp = [...document.querySelectorAll('#points-list .point-text-input')].find(
      (el) => el.value === '降口角肌'
    );
    inp?.parentElement.querySelector('.point-name')?.click();
  });
  await page.waitForTimeout(700);
  // 强制正面，避免斜视误判
  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    const nameEl = [...document.querySelectorAll('#points-list .point-name')].find((el) =>
      (el.parentElement.querySelector('.point-text-input') || {}).value === '降口角肌'
    );
    const pos = nameEl?.getAttribute('data-pos');
    if (pos) v.setAttribute('camera-target', pos);
    v.setAttribute('camera-orbit', '0deg 90deg auto');
    v.setAttribute('field-of-view', '18deg');
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'dao-front.png'), fullPage: true });

  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-orbit', '35deg 85deg auto');
    v.setAttribute('field-of-view', '16deg');
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, 'dao-oblique.png'), fullPage: true });

  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify({ ok: true, picked, mouth: mouth.pos, target }, null, 2),
    'utf8'
  );
  await browser.close();
  console.log(JSON.stringify({ ok: true, picked, outDir: path.relative(repoRoot, outDir) }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
