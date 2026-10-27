/**
 * Portrait_c 首进：首帧须见加载层；课表走轻量目录；点课再现加载层。
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-portrait-c-boot-loader.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs', 'qa-portrait-c-boot');

async function probe(lib) {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  const catalogHits = [];
  page.on('response', (res) => {
    const u = res.url();
    if (u.indexOf('portrait-course-cards-') >= 0) {
      catalogHits.push({ url: u, status: res.status(), fromCache: res.fromServiceWorker() });
    }
  });

  await page.addInitScript(() => {
    window.__portraitBootProbe = { ticks: [] };
    const mark = () => {
      const ld = document.getElementById('loading-screen');
      if (!ld) return;
      const cs = getComputedStyle(ld);
      window.__portraitBootProbe.ticks.push({
        t: performance.now(),
        opacity: +cs.opacity,
        hidden: ld.classList.contains('is-hidden'),
        text: (document.getElementById('loading-main-text') || {}).textContent || ''
      });
    };
    document.addEventListener('DOMContentLoaded', () => {
      mark();
      requestAnimationFrame(() => { mark(); requestAnimationFrame(mark); });
    });
  });

  const t0 = Date.now();
  await page.goto(`${BASE}/Portrait_c?lib=${lib}&_qa=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForFunction(() => {
    const grid = document.getElementById('gallery-grid');
    return grid && grid.querySelectorAll('.course-card').length > 0;
  }, null, { timeout: 30000 });
  const galleryMs = Date.now() - t0;
  await page.waitForTimeout(350);

  fs.mkdirSync(outDir, { recursive: true });
  const pGal = path.join(outDir, `${lib}-02-gallery.png`);
  await page.screenshot({ path: pGal });

  const state = await page.evaluate(() => {
    const ld = document.getElementById('loading-screen');
    const cs = getComputedStyle(ld);
    const cards = [...document.querySelectorAll('#gallery-grid .course-card')].map((el) => ({
      name: (el.querySelector('.course-name') || {}).textContent || '',
      srcLen: ((el.querySelector('img.course-thumb') || {}).src || '').length
    }));
    return {
      probe: window.__portraitBootProbe,
      loaderOp: +cs.opacity,
      loaderHidden: ld.classList.contains('is-hidden') || +cs.opacity < 0.05,
      modalShow: document.getElementById('course-gallery-modal').classList.contains('show'),
      cards
    };
  });

  // 点课：等加载层真正亮起（opacity 过渡）
  await page.click('#gallery-grid .course-card');
  await page.waitForFunction(() => {
    const ld = document.getElementById('loading-screen');
    if (!ld || ld.classList.contains('is-hidden')) return false;
    return +getComputedStyle(ld).opacity > 0.85;
  }, null, { timeout: 8000 });
  const onSelect = await page.evaluate(() => {
    const main = document.getElementById('loading-main-text');
    return {
      opacity: +getComputedStyle(document.getElementById('loading-screen')).opacity,
      text: main ? main.textContent : ''
    };
  });
  const pSel = path.join(outDir, `${lib}-03-select-loader.png`);
  await page.screenshot({ path: pSel });

  // 静态：CSS 默认 opacity 1、首屏无 is-hidden
  const html = await page.content();
  const cssOk = /#loading-screen\{[^}]*opacity:\s*1/.test(html.replace(/\s+/g, '')) ||
    html.indexOf('opacity: 1') >= 0 && html.indexOf('#loading-screen') >= 0;
  const firstTick = (state.probe && state.probe.ticks && state.probe.ticks[0]) || null;
  const earlyOk = !!(firstTick && firstTick.opacity >= 0.9 && !firstTick.hidden && /课程列表/.test(firstTick.text));

  await browser.close();

  const ok = !!(
    earlyOk &&
    cssOk &&
    state.loaderHidden &&
    state.modalShow &&
    state.cards.length >= 2 &&
    state.cards.every((c) => c.srcLen > 80) &&
    galleryMs < 8000 &&
    catalogHits.some((h) => h.status === 200) &&
    onSelect.opacity >= 0.85 &&
    /构建场景/.test(onSelect.text)
  );
  return {
    lib,
    galleryMs,
    catalogHits,
    firstTick,
    earlyOk,
    cssOk,
    late: { loaderHidden: state.loaderHidden, modalShow: state.modalShow, cards: state.cards },
    onSelect,
    ok,
    shots: [pGal, pSel]
  };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const anatomy = await probe('anatomy');
  const facial = await probe('facial');
  const out = { anatomy, facial, ok: anatomy.ok && facial.ok };
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
