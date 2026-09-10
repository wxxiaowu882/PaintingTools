/**
 * 固定视角验收：不用列表法线聚焦（避免倒看法线误导），
 * 相机对准点位本身，正面/合适侧视截图。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const OUT_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解_黄种人女V8.json');
const SRC_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解.json');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-fixed-view-qa`);

function parsePos(s) {
  return s.replace(/m/g, '').split(/\s+/).map(Number);
}

function orbitFor(text, pos) {
  if (text === '枕肌') return '180deg 90deg 0.55m';
  if (text === '颞肌' || text === '咬肌' || text === '颊肌') {
    return `${pos[0] >= 0 ? 70 : -70}deg 95deg 0.55m`;
  }
  if (text === '笑肌' || text === '提口角肌' || text === '提上唇肌') {
    return `${pos[0] >= 0 ? 35 : -35}deg 92deg 0.5m`;
  }
  // default front-ish, slight toward point side
  const th = Math.max(-25, Math.min(25, pos[0] * 200));
  return `${th.toFixed(0)}deg 92deg 0.55m`;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  const src = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
  const srcBy = Object.fromEntries(src.pointsData.map((p) => [p.text, p]));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', OUT_JSON);
  await page.waitForFunction(
    () => document.querySelectorAll('#points-list .point-text-input').length >= 23,
    null,
    { timeout: 180000 }
  );
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
  });

  const viewer = page.locator('#workbench-viewer');
  const report = [];

  for (const p of data.pointsData) {
    const pos = parsePos(p.pos);
    const orbit = orbitFor(p.text, pos);
    await page.evaluate(
      ({ target, orbit, text }) => {
        const v = document.querySelector('#workbench-viewer');
        v.setAttribute('camera-target', target);
        v.setAttribute('camera-orbit', orbit);
        v.setAttribute('field-of-view', '18deg');
        // show this point's text
        v.querySelectorAll('.preview-hotspot').forEach((el) => el.classList.remove('show-text'));
        const hs = [...v.querySelectorAll('.preview-hotspot')].find((el) => {
          const t = el.querySelector('.hotspot-annotation, .Annotation') || el;
          return (el.textContent || '').includes(text) || el.getAttribute('data-text') === text;
        });
        // fallback: click list name without relying on normal orbit — we already set camera
        const inp = [...document.querySelectorAll('#points-list .point-text-input')].find(
          (el) => el.value === text
        );
        if (inp) {
          const item = inp.parentElement;
          item.classList.add('active');
          const hot = v.querySelector(`[slot="${inp.parentElement?.dataset?.slot || ''}"]`);
        }
        // force show text via list focus button attrs without orbit override:
        const nameBtn = inp?.parentElement.querySelector('.point-name');
        if (nameBtn) {
          // temporarily neutralize orbit jump by re-applying after click
          nameBtn.click();
        }
      },
      { target: `${pos[0]}m ${pos[1]}m ${pos[2]}m`, orbit, text: p.text }
    );
    await page.waitForTimeout(200);
    // re-apply fixed orbit after list click
    await page.evaluate(
      ({ target, orbit }) => {
        const v = document.querySelector('#workbench-viewer');
        v.setAttribute('camera-target', target);
        v.setAttribute('camera-orbit', orbit);
        v.setAttribute('field-of-view', '18deg');
      },
      { target: `${pos[0]}m ${pos[1]}m ${pos[2]}m`, orbit }
    );
    await page.waitForTimeout(650);

    const safe = p.text.replace(/[^\w\u4e00-\u9fff]+/g, '_');
    await viewer.screenshot({ path: path.join(outDir, `v8-${safe}.png`) });

    const srcP = srcBy[p.text];
    const spos = srcP ? parsePos(srcP.pos) : null;
    report.push({
      text: p.text,
      pos: p.pos,
      norm: p.norm,
      srcPos: srcP?.pos,
      dxyz: spos
        ? [
            +(pos[0] - spos[0]).toFixed(4),
            +(pos[1] - spos[1]).toFixed(4),
            +(pos[2] - spos[2]).toFixed(4),
          ]
        : null,
      orbit,
    });
  }

  // front overview
  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-orbit', '0deg 90deg 0.75m');
    v.setAttribute('camera-target', '0m 0.22m 0.05m');
    v.setAttribute('field-of-view', '28deg');
  });
  await page.waitForTimeout(700);
  await viewer.screenshot({ path: path.join(outDir, 'v8-00-front.png') });

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ report, outDir }, null, 2));
  await browser.close();
  console.log(JSON.stringify({ ok: true, count: report.length, outDir: path.relative(repoRoot, outDir) }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
