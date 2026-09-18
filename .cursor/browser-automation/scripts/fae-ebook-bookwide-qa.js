/**
 * Multi-section screenshot QA for FAE ebook text formatting.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || '18080';
const OUT = path.join(__dirname, '../runs');
fs.mkdirSync(OUT, { recursive: true });
const base =
  `http://127.0.0.1:${PORT}/` +
  encodeURI('自用工具文件_不部署/知识库原稿/面部表情艺用解剖/ebook/');

const targets = [
  { key: 'skull', match: '头骨的主要骨骼', out: 'fae-book-qa-skull.png' },
  { key: 'glabella', match: '眉间', out: 'fae-book-qa-glabella.png' },
  { key: 'smile', match: '微笑', out: 'fae-book-qa-smile.png' },
  { key: 'rage', match: '暴怒', out: 'fae-book-qa-rage.png' },
  { key: 'facs', match: 'FACS', out: 'fae-book-qa-facs.png' },
  { key: 'soft', match: '结缔组织', out: 'fae-book-qa-soft.png' },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('.page-text', { timeout: 30000 });

  const report = [];
  for (const t of targets) {
    await page.evaluate((match) => {
      const btn = [...document.querySelectorAll('button')].find((el) =>
        (el.textContent || '').includes(match)
      );
      if (btn) btn.click();
    }, t.match);
    await page.waitForTimeout(900);
    const plain = await page.evaluate(() => document.querySelector('.page-text')?.innerText || '');
    const bad = {
      pipes: plain.includes('----') && plain.includes('|'),
      stars: plain.includes('**'),
      empty: plain.trim().length < 40,
    };
    const shot = path.join(OUT, t.out);
    await page.screenshot({ path: shot, fullPage: false });
    fs.writeFileSync(path.join(OUT, t.out.replace('.png', '.txt')), plain, 'utf8');
    report.push({ key: t.key, bad, preview: plain.slice(0, 220).replace(/\n/g, ' | ') });
  }
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
