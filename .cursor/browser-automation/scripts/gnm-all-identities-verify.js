/**
 * 截图验收 manifest 全部身份预设
 * BASE_URL=http://127.0.0.1:18080 node scripts/gnm-all-identities-verify.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RUNS = path.resolve(__dirname, '../runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-all-identities-verify`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const PAGE =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/?v=20260831-asian10';

const MANIFEST = path.resolve(
  __dirname,
  '../../../自用工具文件_不部署/GNM头模工坊/data/presets/manifest.json'
);
const BAKE_REPORT = path.resolve(
  __dirname,
  '../../../自用工具文件_不部署/GNM头模工坊/scripts/_bake_asian_report.json'
);
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const bakeReport = fs.existsSync(BAKE_REPORT)
  ? JSON.parse(fs.readFileSync(BAKE_REPORT, 'utf8'))
  : null;

function gateFor(id) {
  if (id.includes('-male-')) return 'male';
  if (id.includes('-female-')) return 'female';
  if (id.includes('child')) return 'child';
  if (id.includes('tween')) return 'tween';
  if (id === 'identity-t01-tembrica') return 'tembrica_male';
  if (id === 'identity-t04-tembrica') return 'tembrica_female';
  return 'neutral';
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const report = { ok: true, presets: [], outDir };

  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 180000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const cb = document.getElementById('muscle-enable');
    if (cb?.checked) cb.click();
    const op = document.getElementById('muscle-opacity');
    if (op) {
      op.value = '0';
      op.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.locator('.preset-rail-tab[data-preset-tab="identity"]').click();
  await page.waitForTimeout(300);

  for (const entry of manifest.identities) {
    const clicked = await page.evaluate((label) => {
      const chips = [...document.querySelectorAll('#preset-rail-body .preset-chip-label')];
      const el = chips.find((c) => c.textContent.trim() === label);
      if (!el) return false;
      el.closest('button')?.click();
      return true;
    }, entry.name);

    await page.waitForTimeout(900);
    const status = await page.locator('#status-text').textContent();
    const slug = entry.id.replace(/[^\w-]+/g, '_').slice(0, 48);
    const shot = path.join(outDir, `${slug}.png`);
    await page.locator('#viewport-wrap').screenshot({ path: shot });

    const baked = bakeReport?.baked?.find((b) => b.id === entry.id);
    const geo = baked?.metrics || null;
    const gate = gateFor(entry.id);

    let pass = clicked && /预设|就绪/.test(status || '');
    if (
      gate === 'female' &&
      geo &&
      (entry.id.includes('as04') ||
        entry.id.includes('as10') ||
        entry.id.includes('as11') ||
        entry.id.includes('as12') ||
        entry.id.includes('as16') ||
        entry.id.includes('as17')) &&
      geo.browProj > 0.051
    ) {
      pass = false;
    }
    if (gate === 'male' && geo?.browProj < 0.0465) pass = false;
    if (gate === 'tembrica_male' && geo?.browProj < 0.05) pass = false;
    if (gate === 'tembrica_female' && geo?.browProj > 0.043) pass = false;

    if (!pass) report.ok = false;
    report.presets.push({
      id: entry.id,
      label: entry.name,
      gate,
      ok: pass,
      clicked,
      geo,
      screenshot: shot,
    });
    console.log(pass ? '✓' : '✗', entry.name, geo ? `brow ${geo.browProj}` : '');
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log('\nOUT', outDir);
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
