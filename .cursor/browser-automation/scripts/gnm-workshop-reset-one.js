/**
 * 验收：选非中性身份后，点单参「重置」应归零该维并改变网格。
 * 同时在缩略图生成过程中抢先选身份，确认主模型不被缩略图还原污染。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RUNS = path.resolve(__dirname, '../runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-gnm-reset-one`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const PAGE =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/?v=20260904-workshop28';

function rmsDiff(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s / a.length);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const report = { ok: true, checks: [] };
  const check = (name, pass, detail) => {
    report.checks.push({ name, pass: !!pass, detail: detail || '' });
    if (!pass) report.ok = false;
    console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  page.on('pageerror', (e) => console.warn('pageerror', e.message));

  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 180000 });
  await page.waitForTimeout(400);

  // 缩略图仍在生成时尽快点选非中性身份（竞态窗口）
  await page.waitForFunction(
    () => document.querySelectorAll('#preset-rail-body .preset-chip-rail').length >= 3,
    null,
    { timeout: 120000 }
  );

  const picked = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('#preset-rail-body .preset-chip-label')];
    const prefer = ['东亚男·南方阔面', '东亚女·阔面柔和', 'Tembrica Shape 1', '儿童·大眼阔面（6–8）'];
    for (const name of prefer) {
      const lab = chips.find((el) => el.textContent.trim() === name);
      if (lab) {
        lab.closest('button')?.click();
        return name;
      }
    }
    const any = chips.find((el) => el.textContent.trim() && el.textContent.trim() !== '均值中性');
    if (any) {
      any.closest('button')?.click();
      return any.textContent.trim();
    }
    return null;
  });
  check('picked non-neutral identity', !!picked, picked || 'none');
  await page.waitForTimeout(600);

  // 再等一会儿让后续缩略图继续跑完（若有污染会在此暴露）
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, '01-after-pick.png') });

  const before = await page.evaluate(() => {
    const dbg = window.__gnmWorkshopDebug;
    const id = dbg?.getIdentitySnapshot?.() || [];
    let bestIdx = -1;
    let bestAbs = 0;
    for (let i = 0; i < Math.min(id.length, 170); i++) {
      const a = Math.abs(id[i]);
      if (a > bestAbs) {
        bestAbs = a;
        bestIdx = i;
      }
    }
    return {
      bestIdx,
      bestAbs,
      identityAtBest: id[bestIdx],
      posLen: dbg?.getRawPositionsSnapshot?.()?.length || 0,
    };
  });
  check('has strong identity coeff', before.bestIdx >= 0 && before.bestAbs > 0.15, JSON.stringify(before));

  const beforePos = await page.evaluate(() => window.__gnmWorkshopDebug?.getRawPositionsSnapshot?.());

  // 在「全部」里找到对应维并点重置；找不到则走骨相常用区第一个 dirty
  // 切到「全部」并展开分组，便于点到 id-all:<idx>
  await page.locator('.tab-btn[data-tab="all"]').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.querySelectorAll('#controls-root details.group-fold').forEach((d) => {
      d.open = true;
    });
  });
  await page.waitForTimeout(200);

  const resetInfo = await page.evaluate((targetIdx) => {
    const rows = [...document.querySelectorAll('.slider-row')];
    const match =
      rows.find((row) => row.getAttribute('data-key') === `id-all:${targetIdx}`) ||
      rows.find((row) => row.getAttribute('data-key') === `common:${targetIdx}`) ||
      rows.find((row) => (row.getAttribute('data-key') || '').includes(`:${targetIdx}`));
    const row =
      match ||
      rows.find((r) => r.classList.contains('is-dirty') && r.querySelector('.btn-reset-one'));
    if (!row) return { ok: false, reason: 'no row', targetIdx };
    // 展开祖先 details
    let p = row.parentElement;
    while (p) {
      if (p.tagName === 'DETAILS') p.open = true;
      p = p.parentElement;
    }
    const valBefore = row.querySelector('.slider-val')?.textContent || '';
    const btn = row.querySelector('.btn-reset-one');
    if (!btn) return { ok: false, reason: 'no btn', key: row.getAttribute('data-key') };
    btn.click();
    const valAfter = row.querySelector('.slider-val')?.textContent || '';
    return {
      ok: true,
      key: row.getAttribute('data-key'),
      valBefore,
      valAfter,
      stillDirty: row.classList.contains('is-dirty'),
    };
  }, before.bestIdx);

  check('reset button clicked', resetInfo.ok, JSON.stringify(resetInfo));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, '02-after-reset.png') });

  const after = await page.evaluate((idx) => {
    const dbg = window.__gnmWorkshopDebug;
    const id = dbg?.getIdentitySnapshot?.() || [];
    return {
      identityAtIdx: id[idx],
      positions: dbg?.getRawPositionsSnapshot?.(),
    };
  }, before.bestIdx);

  const posDelta = rmsDiff(beforePos, after.positions);
  check(
    'identity coeff near zero after reset',
    Math.abs(after.identityAtIdx) < 1e-4,
    `idx=${before.bestIdx} val=${after.identityAtIdx}`
  );
  check('mesh positions changed', posDelta > 1e-5, `rms=${posDelta}`);

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(report.ok ? 'ALL PASS' : 'FAILED', outDir);
  await browser.close();
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
