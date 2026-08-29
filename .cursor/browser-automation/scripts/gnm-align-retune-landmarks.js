/**
 * 自测：seed「鼻根」历史 → URL loadHist+retuneKeep → 验证眉心/鼻根保留、其余更新
 * BASE_URL=http://127.0.0.1:18080 node scripts/gnm-align-retune-landmarks.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RUNS = path.resolve(__dirname, '../runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-gnm-align-retune`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const PAGE =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/align-overlay/' +
  '?loadHist=%E9%BC%BB%E6%A0%B9&retuneKeep=glabella,nasion&t=' +
  Date.now();

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

  // 先打开一次以建立 origin，再写入假「鼻根」历史
  const boot =
    BASE.replace(/\/$/, '') +
    '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/align-overlay/?t=boot';
  await page.goto(boot, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(
    () => document.querySelector('#loading')?.classList.contains('hidden'),
    null,
    { timeout: 240000 }
  );

  const seeded = await page.evaluate(() => {
    const ed = window.__alignOverlayApp.lmEditor;
    const pack = ed.toJSON();
    // 故意挪动眉心/鼻根，作为「用户已调」标记
    for (const p of pack.points) {
      if (p.pairKey === 'glabella' || p.pairKey === 'nasion') {
        p.pos = [p.pos[0] + 0.003, p.pos[1] - 0.002, p.pos[2] + 0.001];
      }
      // 故意弄歪鼻尖，看重摆是否改回
      if (p.pairKey === 'pronasale') {
        p.pos = [p.pos[0] + 0.02, p.pos[1], p.pos[2]];
      }
    }
    const keepSnap = {};
    for (const p of pack.points) {
      if (p.pairKey === 'glabella' || p.pairKey === 'nasion') {
        keepSnap[`${p.pairKey}:${p.side}`] = p.pos.slice(0, 3);
      }
    }
    const entry = {
      id: `v_seed_${Date.now()}`,
      note: '鼻根',
      createdAt: new Date().toISOString(),
      pointCount: pack.points.length,
      preTrs: window.__alignOverlayApp.getPreTrs(),
      payload: pack,
    };
    localStorage.setItem(
      'gnm-align-overlay-history-v1',
      JSON.stringify({ version: 1, versions: [entry] })
    );
    return { keepSnap, n: pack.points.length };
  });

  console.log('seeded', seeded.n, '→ reload with query');
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(
    () => document.querySelector('#loading')?.classList.contains('hidden'),
    null,
    { timeout: 240000 }
  );
  await page.waitForFunction(
    () => /重摆|对齐/.test(document.querySelector('#status-text')?.textContent || ''),
    null,
    { timeout: 60000 }
  );
  // boot query 异步，再等一会
  await page.waitForTimeout(1500);

  const result = await page.evaluate((keepSnap) => {
    const ed = window.__alignOverlayApp.lmEditor;
    const keepOk = {};
    for (const p of ed.points) {
      if (p.pairKey !== 'glabella' && p.pairKey !== 'nasion') continue;
      const k = `${p.pairKey}:${p.side}`;
      const a = keepSnap[k];
      const b = p.pos;
      keepOk[k] =
        !!a &&
        Math.abs(a[0] - b[0]) < 1e-9 &&
        Math.abs(a[1] - b[1]) < 1e-9 &&
        Math.abs(a[2] - b[2]) < 1e-9;
    }
    const prona = ed.points.filter((p) => p.pairKey === 'pronasale');
    return {
      status: document.querySelector('#status-text')?.textContent,
      keepOk,
      summary: window.__alignOverlayApp.alignReport?.summary,
      prona,
      histNotes: (JSON.parse(localStorage.getItem('gnm-align-overlay-history-v1') || '{}').versions || []).map(
        (v) => v.note
      ),
    };
  }, seeded.keepSnap);

  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ seeded, result }, null, 2));
  await page.screenshot({ path: path.join(outDir, 'front.png') });

  const pass = result.keepOk && Object.values(result.keepOk).every(Boolean);
  console.log(pass ? 'PASS' : 'FAIL', outDir);
  await browser.close();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
