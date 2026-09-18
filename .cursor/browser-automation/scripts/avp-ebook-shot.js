/**
 * Shot AVP ebook pages.
 * Usage: node scripts/avp-ebook-shot.js 0158,0159,0165 avp_light_qa
 */
require('./_playwright-browsers-path');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || '18080';
const ids = (process.argv[2] || '0158').split(',').map((s) => s.trim()).filter(Boolean);
const runName = process.argv[3] || 'avp_qa';
const OUT = path.join(__dirname, '../runs', runName);
fs.mkdirSync(OUT, { recursive: true });

const ROOT = path.resolve(__dirname, '../../..');
const data = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, '自用工具文件_不部署/知识库原稿/艺术与视知觉/ebook/data.json'),
    'utf8'
  )
);
const imgToSec = {};
for (const sec of data.sections || []) {
  for (const p of sec.pages || []) {
    imgToSec[p.imgId] = { sectionId: sec.id, title: sec.title, index: sec.pages.indexOf(p), n: sec.pages.length };
  }
}

const url =
  `http://127.0.0.1:${PORT}/` +
  encodeURI('自用工具文件_不部署/知识库原稿/艺术与视知觉/ebook/') +
  `?t=${Date.now()}`;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);

  const results = [];
  for (const id of ids) {
    const meta = imgToSec[id];
    if (!meta) {
      results.push({ id, error: 'not in data.json' });
      continue;
    }
    // click TOC by title
    await page.evaluate((title) => {
      const btn = [...document.querySelectorAll('button, a, [data-id]')].find((el) =>
        (el.textContent || '').trim().includes(title.replace(/\s+/g, '')) ||
        (el.textContent || '').includes(title)
      );
      // looser: match chapter keyword
      const btn2 =
        btn ||
        [...document.querySelectorAll('button, a')].find((el) => {
          const t = (el.textContent || '').replace(/\s+/g, '');
          const key = title.replace(/\s+/g, '');
          return t.includes(key) || key.includes(t);
        });
      if (btn2) btn2.click();
    }, meta.title);
    await page.waitForTimeout(900);

    // force single mode
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((el) => /单页|整节/.test(el.textContent || ''));
      if (btn && /整节/.test(btn.textContent || '')) btn.click();
    });
    await page.waitForTimeout(300);

    // click filmstrip thumb by title/alt containing img id or book page
    const navigated = await page.evaluate((imgId) => {
      const nodes = [...document.querySelectorAll('img, button, [title], [data-img]')];
      const hit = nodes.find((el) => {
        const s = `${el.getAttribute('data-img') || ''} ${el.getAttribute('title') || ''} ${el.alt || ''} ${el.id || ''}`;
        return s.includes(imgId);
      });
      if (hit) {
        hit.click();
        return 'thumb';
      }
      return '';
    }, id);

    // if no thumb, ArrowRight from start of section meta.index times
    if (!navigated) {
      // jump to first of section then step
      await page.keyboard.press('Home');
      await page.waitForTimeout(200);
      for (let i = 0; i < meta.index; i++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(120);
      }
    }
    await page.waitForTimeout(700);

    // verify
    let plain = await page.evaluate((imgId) => {
      const card = document.getElementById('page-' + imgId);
      if (card) {
        card.scrollIntoView({ block: 'start' });
        return card.innerText.slice(0, 1000);
      }
      return document.body.innerText.slice(0, 1200);
    }, id);

    // last resort: scroll all page-cards
    if (!plain.includes('IMG_' + id) && !plain.includes(`书页`) ) {
      plain = await page.evaluate((imgId) => {
        const card = document.getElementById('page-' + imgId);
        if (card) {
          card.scrollIntoView({ block: 'start' });
          return card.innerText.slice(0, 1000);
        }
        // section mode: all cards present
        const all = [...document.querySelectorAll('.page-card')];
        const c = all.find((el) => el.id === 'page-' + imgId);
        if (c) {
          c.scrollIntoView({ block: 'start' });
          return c.innerText.slice(0, 1000);
        }
        return document.body.innerText.slice(0, 1000);
      }, id);
    }

    // if still wrong, switch to section mode and scroll to card
    if (!plain.includes(id)) {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((el) => /单页|整节/.test(el.textContent || ''));
        if (btn && /单页/.test(btn.textContent || '')) btn.click(); // switch to 整节
      });
      await page.waitForTimeout(500);
      plain = await page.evaluate((imgId) => {
        const card = document.getElementById('page-' + imgId);
        if (!card) return '';
        card.scrollIntoView({ block: 'center' });
        return card.innerText.slice(0, 1000);
      }, id);
      await page.waitForTimeout(400);
    }

    const shot = path.join(OUT, `IMG_${id}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    fs.writeFileSync(path.join(OUT, `IMG_${id}.txt`), plain, 'utf8');
    results.push({
      id,
      section: meta.title,
      index: meta.index,
      navigated,
      ok: plain.includes(id) || plain.includes('IMG_' + id),
      shot,
      preview: plain.slice(0, 160).replace(/\s+/g, ' '),
    });
  }
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
