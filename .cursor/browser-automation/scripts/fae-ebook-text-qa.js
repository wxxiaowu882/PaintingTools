/**
 * Screenshot FAE ebook page for visual QA of left-panel text formatting.
 * Usage: node scripts/fae-ebook-text-qa.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || '18080';
const OUT = path.join(__dirname, '../runs');
fs.mkdirSync(OUT, { recursive: true });

const url =
  `http://127.0.0.1:${PORT}/` +
  encodeURI(
    '自用工具文件_不部署/知识库原稿/面部表情艺用解剖/ebook/'
  ) +
  '#mus-frontal';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('.page-text', { timeout: 30000 });
  // jump to section with 枕额肌
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.toc button, .toc a, button')].find((el) =>
      (el.textContent || '').includes('额叶与顶叶')
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(800);
  // ensure page 52 / IMG_0054 if multi-page section
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.page-card')];
    const hit = cards.find((c) => (c.id || '').includes('0054') || (c.textContent || '').includes('书页 52'));
    if (hit) hit.scrollIntoView({ block: 'start' });
  });
  // Prefer single-page mode focusing text+image
  const shot1 = path.join(OUT, 'fae-text-qa-0054.png');
  await page.screenshot({ path: shot1, fullPage: false });

  // Extract rendered left text HTML plain
  const plain = await page.evaluate(() => {
    const el = document.querySelector('.page-text .t-p, .page-text');
    const root = document.querySelector('.page-text');
    return root ? root.innerText : '';
  });
  fs.writeFileSync(path.join(OUT, 'fae-text-qa-0054.txt'), plain, 'utf8');

  // Also open 头部区域 50
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((el) =>
      (el.textContent || '').includes('头部区域')
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(800);
  const shot2 = path.join(OUT, 'fae-text-qa-0052.png');
  await page.screenshot({ path: shot2, fullPage: false });
  const plain2 = await page.evaluate(() => {
    const root = document.querySelector('.page-text');
    return root ? root.innerText : '';
  });
  fs.writeFileSync(path.join(OUT, 'fae-text-qa-0052.txt'), plain2, 'utf8');

  console.log(JSON.stringify({ shot1, shot2, plainPreview: plain.slice(0, 400), plain2Preview: plain2.slice(0, 300) }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
