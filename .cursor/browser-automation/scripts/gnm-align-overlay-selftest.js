/**
 * 叠显页综合自测：加载、黄/粉点可见、预变换、JSON 历史存取、拧形
 * BASE_URL=http://127.0.0.1:18080 node scripts/gnm-align-overlay-selftest.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RUNS = path.resolve(__dirname, '../runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-gnm-align-selftest`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const PAGE =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/align-overlay/?v=20260828-warp2&t=' +
  Date.now();
const HIST_DIR = path.resolve(
  __dirname,
  '../../../自用工具文件_不部署/GNM头模工坊/align-overlay/landmarks/history'
);

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  console.log('goto', PAGE);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(
    () => document.querySelector('#loading')?.classList.contains('hidden'),
    null,
    { timeout: 240000 }
  );
  check('page loaded', true);
  check('no pageerror on load', pageErrors.length === 0, pageErrors.join('; '));

  // markers
  const markers = await page.evaluate(() => {
    const ed = window.__alignOverlayApp.lmEditor;
    const list = [...ed.markerByUid.values()];
    return {
      total: list.length,
      pink: list.filter((m) => m.userData.lmSide === 'gnm').length,
      yellow: list.filter((m) => m.userData.lmSide === 'euro').length,
      noDepth: list.every((m) => m.material && m.material.depthTest === false),
      renderOrder: list.every((m) => m.renderOrder >= 20),
    };
  });
  check('pink markers 16', markers.pink === 16, JSON.stringify(markers));
  check('yellow markers 16', markers.yellow === 16, JSON.stringify(markers));
  check('markers depthTest off', markers.noDepth, JSON.stringify(markers));

  await page.screenshot({ path: path.join(outDir, '01-front.png') });

  // preTrs
  await page.click('.lm-tab-btn[data-tab="trs"]');
  await page.fill('#trs-rx', '-8.5');
  await page.dispatchEvent('#trs-rx', 'input');
  await page.fill('#trs-su', '1.05');
  await page.dispatchEvent('#trs-su', 'input');
  await page.waitForTimeout(150);
  const trs = await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    return {
      rx: app.preTrs.rxDeg,
      su: app.preTrs.su,
      pivotRx: (app.euroPivot.rotation.x * 180) / Math.PI,
      scaleX: app.euroPivot.scale.x,
    };
  });
  check('preTrs rx applied', Math.abs(trs.rx + 8.5) < 1e-6 && Math.abs(trs.pivotRx + 8.5) < 0.05, JSON.stringify(trs));
  check('preTrs scale applied', Math.abs(trs.su - 1.05) < 1e-6 && Math.abs(trs.scaleX - 1.05) < 1e-6, JSON.stringify(trs));

  // save history JSON
  await page.click('.lm-tab-btn[data-tab="hist"]');
  const note = `自测_${Date.now()}`;
  await page.fill('#lm-hist-note', note);
  await page.click('#lm-hist-save');
  await page.waitForTimeout(1000);
  const saveStatus = await page.textContent('#status-text');
  check('history save to disk', /写入 landmarks\/history/.test(saveStatus || ''), saveStatus);

  const index = JSON.parse(fs.readFileSync(path.join(HIST_DIR, 'index.json'), 'utf8'));
  const meta = (index.versions || []).find((v) => v.note === note);
  check('index.json has entry', !!meta, JSON.stringify(meta));
  check('preTrsSummary shows rx', meta && /rx=/.test(meta.preTrsSummary || ''), meta && meta.preTrsSummary);
  check('version file exists', meta && fs.existsSync(path.join(HIST_DIR, meta.file)), meta && meta.file);

  const full = JSON.parse(fs.readFileSync(path.join(HIST_DIR, meta.file), 'utf8'));
  check('file has payload+preTrs', !!full.payload?.points?.length && full.preTrs?.rxDeg === -8.5, `n=${full.payload?.points?.length}`);

  // reset trs then load history
  await page.click('.lm-tab-btn[data-tab="trs"]');
  await page.click('#trs-reset');
  await page.waitForTimeout(100);
  await page.click('.lm-tab-btn[data-tab="hist"]');
  await page.click('#lm-hist-reload');
  await page.waitForTimeout(300);
  // select the option containing note
  await page.evaluate((n) => {
    const sel = document.querySelector('#lm-hist-select');
    const opt = [...sel.options].find((o) => o.textContent.includes(n));
    if (!opt) throw new Error('option not found');
    sel.value = opt.value;
  }, note);
  await page.click('#lm-hist-select');
  await page.waitForTimeout(500);
  const afterLoad = await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    return {
      rx: app.preTrs.rxDeg,
      status: document.querySelector('#status-text')?.textContent || '',
      yellow: [...app.lmEditor.markerByUid.values()].filter((m) => m.userData.lmSide === 'euro').length,
    };
  });
  check('load restores rx', Math.abs(afterLoad.rx + 8.5) < 1e-6, JSON.stringify(afterLoad));
  check('load status mentions 预变换', /预变换|rx=/.test(afterLoad.status), afterLoad.status);
  check('yellow still 16 after load', afterLoad.yellow === 16, JSON.stringify(afterLoad));

  // warp (拧)
  await page.click('.lm-tab-btn[data-tab="edit"]');
  await page.click('#lm-warp');
  await page.waitForTimeout(800);
  const afterWarp = await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    return {
      yellow: [...app.lmEditor.markerByUid.values()].filter((m) => m.userData.lmSide === 'euro').length,
      pink: [...app.lmEditor.markerByUid.values()].filter((m) => m.userData.lmSide === 'gnm').length,
      rx: app.preTrs.rxDeg,
      status: document.querySelector('#status-text')?.textContent || '',
      warpCache: app.euroWarpCache?.length || 0,
      warped: app._euroWarped,
    };
  });
  check('warp keeps markers', afterWarp.yellow >= 16 && afterWarp.pink >= 16, JSON.stringify(afterWarp));
  check('warp keeps preTrs rx', Math.abs(afterWarp.rx + 8.5) < 1e-6, JSON.stringify(afterWarp));
  check('warp status', /拧 · \d+ 对路标/.test(afterWarp.status), afterWarp.status);
  check('warp mesh cache', afterWarp.warpCache > 0, String(afterWarp.warpCache));
  check('warp flag set', afterWarp.warped === true, String(afterWarp.warped));

  // save warped history then load an older unwarped meta if any
  await page.click('.lm-tab-btn[data-tab="hist"]');
  const warpNote = `自测拧_${Date.now()}`;
  await page.fill('#lm-hist-note', warpNote);
  await page.click('#lm-hist-save');
  await page.waitForTimeout(1000);
  const warpSaveStatus = await page.textContent('#status-text');
  check('warp history save', /拧·\d+对/.test(warpSaveStatus || ''), warpSaveStatus);

  await page.click('#btn-side');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, '02-side.png') });

  const pass = results.every((r) => r.pass);
  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify({ pass, results, pageErrors, note, meta }, null, 2)
  );
  console.log(pass ? 'PASS' : 'FAIL', 'out=', outDir);
  await browser.close();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
