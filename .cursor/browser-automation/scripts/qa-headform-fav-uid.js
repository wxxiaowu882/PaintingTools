/**
 * 头部造型：点一颗星只收藏一条（同名多头模不串关）；收藏键为 uid:xxx。
 * PORT=18080 node scripts/qa-headform-fav-uid.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  await page.goto(`${BASE}/Solid?sandbox=headform`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => {
    const loader = document.getElementById('scene-loader');
    const modal = document.getElementById('scene-grid-modal');
    const loaderGone = !loader || loader.style.display === 'none' || getComputedStyle(loader).display === 'none';
    const modalOn = modal && (modal.style.display === 'flex' || getComputedStyle(modal).display === 'flex');
    return loaderGone && modalOn && document.querySelectorAll('#scene-grid-container .scene-item').length > 1;
  }, { timeout: 120000 });
  await page.waitForTimeout(800);

  // 清旧收藏，避免干扰
  await page.evaluate(() => {
    try {
      const sk = 'SolidConsumer_Favorites_v1_headform';
      localStorage.setItem(sk, '[]');
    } catch (_e) {}
  });
  // 触发重建：点一下收藏夹再回外轮廓
  await page.evaluate(() => {
    const tabs = document.querySelectorAll('#scene-tabbar .scene-tab, .scene-tab');
    const fav = [].find.call(tabs, (el) => /收藏/.test(el.textContent || ''));
    if (fav) fav.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const tabs = document.querySelectorAll('#scene-tabbar .scene-tab, .scene-tab');
    const view = [].find.call(tabs, (el) => /外轮廓/.test(el.textContent || ''));
    if (view) view.click();
  });
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => {
    const items = [].slice.call(document.querySelectorAll('#scene-grid-container .scene-item'));
    const favs = items.filter((el) => el.querySelector('.scene-fav-btn.is-fav'));
    const scenes = (window.customScenes || []).slice(0, 6).map((s, i) => ({
      i, uid: s && s.uid, id: s && s.id, name: s && s.name, key: (typeof solidSceneKey === 'function' ? null : null)
    }));
    // solidSceneKey 可能不在 window；从列表算
    const keys = items.slice(0, 6).map((el) => {
      const idx = Number(el.getAttribute('data-scene-index'));
      const sc = window.customScenes && window.customScenes[idx];
      if (!sc) return null;
      if (sc.uid) return 'uid:' + sc.uid;
      if (sc.id) return 'id:' + sc.id;
      return 'name:' + sc.name;
    });
    return { itemCount: items.length, favCount: favs.length, scenes, keys };
  });

  // 点第一条的星
  await page.locator('#scene-grid-container .scene-item').first().locator('.scene-fav-btn').click();
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => {
    const items = [].slice.call(document.querySelectorAll('#scene-grid-container .scene-item'));
    const favIdx = [];
    items.forEach((el, i) => {
      if (el.querySelector('.scene-fav-btn.is-fav')) favIdx.push(Number(el.getAttribute('data-scene-index')));
    });
    const raw = localStorage.getItem('SolidConsumer_Favorites_v1_headform') || '[]';
    let store = [];
    try { store = JSON.parse(raw); } catch (_e) {}
    const sameNameCount = (window.customScenes || []).filter((s) => s && s.name === (window.customScenes[0] && window.customScenes[0].name)).length;
    return {
      favIdx,
      store,
      firstUid: window.customScenes[0] && window.customScenes[0].uid,
      firstName: window.customScenes[0] && window.customScenes[0].name,
      sameNameCount,
      listHasUid: !!(window.customScenes[0] && window.customScenes[0].uid)
    };
  });

  const shot = path.join(outDir, `headform-fav-uid-${Date.now()}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  await browser.close();

  const ok =
    after.listHasUid &&
    after.favIdx.length === 1 &&
    after.store.length === 1 &&
    String(after.store[0]).indexOf('uid:') === 0 &&
    after.sameNameCount > 1;

  console.log(JSON.stringify({ ok, before, after, shot }, null, 2));
  if (!ok) {
    console.error('FAIL');
    process.exit(1);
  }
  console.log('PASS');
  console.log('SHOT=' + shot);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
