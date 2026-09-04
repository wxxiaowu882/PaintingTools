const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RUNS = path.resolve(__dirname, '../runs');
const outDir = path.join(RUNS, `semantic-sample-${Date.now()}`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const PAGE =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/?v=workshop13';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.warn('pageerror', e.message));
  const fails = [];
  const check = (n, p, d) => {
    console.log(`${p ? 'OK' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
    if (!p) fails.push(n);
  };

  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 180000 });
  await page.waitForTimeout(1000);

  await page.locator('.preset-rail-tab[data-preset-tab="identity"]').click();
  await page.waitForTimeout(200);

  const btn = page.locator('#preset-rail-body .preset-chip-label', { hasText: '语义采样…' });
  check('entry button', await btn.count() > 0);
  await btn.first().click();

  await page.waitForSelector('.identity-sample-modal', { timeout: 60000 });
  await page.waitForTimeout(800);
  // default should be pure female end
  const genderVal = await page.locator('.identity-sample-val').first().textContent();
  check('default pure female label', /纯女/.test(genderVal || ''), genderVal);
  const hasCanvas = (await page.locator('.identity-sample-preview-canvas').count()) > 0;
  check('interactive canvas', hasCanvas);
  await page.screenshot({ path: path.join(outDir, '01-modal.png') });

  const previewOk = await page.evaluate(() => {
    const c = document.querySelector('.identity-sample-preview-canvas');
    return !!(c && c.width > 0 && c.height > 0);
  });
  check('preview canvas sized', previewOk);

  // drag rotate smoke
  const box = await page.locator('.identity-sample-preview-canvas').boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.45, { steps: 8 });
    await page.mouse.up();
  }
  check('orbit drag', !!box);

  // cancel should not add
  const before = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('gnmWorkshop.customIdentities.v1') || '[]').length; } catch { return -1; }
  });
  await page.locator('.identity-sample-modal .btn', { hasText: '取消' }).click();
  await page.waitForSelector('.identity-sample-modal', { state: 'detached', timeout: 5000 });
  const afterCancel = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('gnmWorkshop.customIdentities.v1') || '[]').length; } catch { return -1; }
  });
  check('cancel no add', before === afterCancel, `${before} -> ${afterCancel}`);

  // open again and confirm
  await btn.first().click();
  await page.waitForSelector('.identity-sample-modal', { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.locator('.identity-sample-modal input[type="range"]').first().fill('0.8');
  await page.waitForTimeout(400);
  await page.locator('.identity-sample-modal .btn', { hasText: '换种子' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, '02-tweaked.png') });

  await page.locator('.identity-sample-modal .btn.primary', { hasText: '确认加入我的身份' }).click();
  await page.waitForSelector('.identity-sample-modal', { state: 'detached', timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, '03-confirmed.png') });

  const after = await page.evaluate(() => {
    try {
      const list = JSON.parse(localStorage.getItem('gnmWorkshop.customIdentities.v1') || '[]');
      return { len: list.length, first: list[0]?.name || null };
    } catch (e) { return { len: -1, first: String(e) }; }
  });
  check('confirmed added', after.len > before, JSON.stringify(after));
  check('newest first name has 采样', /采样/.test(after.first || ''), after.first);

  const id0 = await page.evaluate(() => window.__gnmWorkshopDebug?.getIdentity?.()?.[0] ?? null);
  // may not have debug helper - check status text instead
  const status = await page.locator('#status-text').textContent();
  check('status mentions join', /已加入我的身份|预设：采样/.test(status || ''), status);

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ fails, after, status, outDir }, null, 2));
  await browser.close();
  if (fails.length) {
    console.error('FAILED', fails);
    process.exit(1);
  }
  console.log('ALL OK', outDir);
})().catch((e) => { console.error(e); process.exit(1); });
