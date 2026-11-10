/**
 * 静物写生台场景列表 → 清晰缩略拼图 → 确认页「课表规模」
 * 快路径：滚一遍催缩略图加载，再在页内 canvas 拼图（不滚屏截图）。
 *
 * 用法：
 *   node .cursor/browser-automation/scripts/taobao-geo-catalog-scale-shot.js
 */
const path = require('path');
const fs = require('fs');
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');
const sharp = require('sharp');

const BASE = process.env.QA_BASE || 'http://localhost:18080';
const OUT = path.join(__dirname, '..', 'runs', 'taobao-geo-catalog-scale');
fs.mkdirSync(OUT, { recursive: true });

const CONFIRM_URL =
  BASE +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/%E8%AE%BE%E8%AE%A1%E6%96%B9%E6%A1%88%E7%A1%AE%E8%AE%A4/%E6%B7%98%E5%AE%9D%E5%AE%9D%E8%B4%9D_%E4%B8%BB%E5%9B%BE%E4%B8%8E%E8%AF%A6%E6%83%85_%E7%A1%AE%E8%AE%A4_2026-11-09.html';

const STORE_KEY = 'tb-product-detail-slots';

async function waitLoaderGone(page, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const visible = await page.evaluate(() => {
      const el = document.getElementById('scene-loader');
      if (!el) return false;
      const st = getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0.05;
    });
    if (!visible) return;
    await page.waitForTimeout(250);
  }
}

(async () => {
  const report = { ok: true, steps: [] };
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1
  });

  try {
    await page.goto(BASE + '/Solid?sandbox=geometrysketch', {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    await waitLoaderGone(page, 90000);
    await page.waitForTimeout(1200);

    await page.evaluate(() => {
      if (typeof window.openSceneGridModal === 'function') window.openSceneGridModal();
      const modal = document.getElementById('scene-grid-modal');
      if (modal) {
        modal.style.display = 'block';
        modal.classList.add('show', 'open', 'active');
      }
    });
    await page.waitForFunction(() => {
      const grid = document.getElementById('scene-grid-container');
      return !!(grid && grid.querySelectorAll('.scene-item').length > 5);
    }, { timeout: 60000 });

    await page.evaluate(() => {
      const tab =
        document.querySelector('#scene-tabbar .scene-tab[data-mode="all"]') ||
        document.querySelector('.scene-tab[data-mode="all"]');
      if (tab) tab.click();
    });
    await page.waitForTimeout(500);

    /* 快速滚一遍催缩略图加载 */
    await page.evaluate(async () => {
      const grid = document.getElementById('scene-grid-container');
      if (!grid) return;
      grid.style.maxHeight = '640px';
      grid.style.height = '640px';
      grid.style.overflowY = 'auto';
      const max = grid.scrollHeight;
      for (let y = 0; y < max; y += 480) {
        grid.scrollTop = y;
        await new Promise((r) => setTimeout(r, 120));
      }
      grid.scrollTop = max;
      await new Promise((r) => setTimeout(r, 200));
      grid.scrollTop = 0;
    });

    /* 再等一会儿让 pending 变少 */
    let thumbStat = { items: 0, ready: 0, pending: 0 };
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      thumbStat = await page.evaluate(() => {
        const items = document.querySelectorAll('#scene-grid-container .scene-item').length;
        const ready = document.querySelectorAll(
          '#scene-grid-container img.scene-thumb.solid-thumb-ready'
        ).length;
        const pending = document.querySelectorAll(
          '#scene-grid-container img.scene-thumb.solid-thumb-pending'
        ).length;
        return { items, ready, pending };
      });
      if (thumbStat.items >= 40 && thumbStat.ready >= Math.floor(thumbStat.items * 0.7)) break;
      await page.waitForTimeout(500);
    }
    report.steps.push({ name: 'thumbs', thumbStat });

    const stitch = await page.evaluate(async () => {
      const items = Array.from(document.querySelectorAll('#scene-grid-container .scene-item'));
      const cols = 4;
      const gap = 10;
      const pad = 12;
      const cellW = 176;
      const imgH = 132;
      const labelH = 36;
      const cellH = imgH + labelH;
      const rows = Math.ceil(items.length / cols) || 1;
      const W = pad * 2 + cols * cellW + (cols - 1) * gap;
      const H = pad * 2 + rows * cellH + (rows - 1) * gap;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0c0c0e';
      ctx.fillRect(0, 0, W, H);
      ctx.font = '12px "Microsoft YaHei","PingFang SC",sans-serif';
      ctx.fillStyle = 'rgba(243,241,236,0.72)';
      ctx.textAlign = 'center';

      const loadImg = (src) =>
        new Promise((resolve) => {
          if (!src) return resolve(null);
          const im = new Image();
          im.crossOrigin = 'anonymous';
          im.onload = () => resolve(im);
          im.onerror = () => resolve(null);
          im.src = src;
        });

      let ok = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const imgEl = it.querySelector('img.scene-thumb, img');
        const src = imgEl ? imgEl.currentSrc || imgEl.src : '';
        const labelEl =
          it.querySelector('.scene-item-title, .scene-title, .title, .name, figcaption') ||
          it.querySelector('span, div');
        let label = '';
        if (labelEl) {
          const t = (labelEl.innerText || labelEl.textContent || '').trim().replace(/\s+/g, ' ');
          if (t && t.length < 40 && !/^https?:/i.test(t)) label = t;
        }
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = pad + col * (cellW + gap);
        const y = pad + row * (cellH + gap);
        ctx.fillStyle = '#16161a';
        ctx.fillRect(x, y, cellW, cellH);
        const im = await loadImg(src);
        if (im) {
          const iw = im.naturalWidth || im.width;
          const ih = im.naturalHeight || im.height;
          const scale = Math.max(cellW / iw, imgH / ih);
          const dw = iw * scale;
          const dh = ih * scale;
          const sx = (dw - cellW) / 2;
          const sy = (dh - imgH) / 2;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, cellW, imgH);
          ctx.clip();
          ctx.drawImage(im, x - sx, y - sy, dw, dh);
          ctx.restore();
          ok += 1;
        } else {
          ctx.fillStyle = '#2a2a30';
          ctx.fillRect(x, y, cellW, imgH);
        }
        if (label) {
          ctx.fillStyle = 'rgba(243,241,236,0.78)';
          const text = label.length > 12 ? label.slice(0, 11) + '…' : label;
          ctx.fillText(text, x + cellW / 2, y + imgH + 22);
        }
      }
      return {
        ok,
        total: items.length,
        w: W,
        h: H,
        dataUrl: canvas.toDataURL('image/jpeg', 0.92)
      };
    });

    if (!stitch || !stitch.dataUrl || stitch.ok < 20) {
      throw new Error('canvas stitch weak: ' + JSON.stringify({ ok: stitch && stitch.ok, total: stitch && stitch.total }));
    }
    report.steps.push({
      name: 'canvasStitch',
      ok: stitch.ok,
      total: stitch.total,
      w: stitch.w,
      h: stitch.h
    });

    const rawBuf = Buffer.from(stitch.dataUrl.split(',')[1], 'base64');
    const rawPath = path.join(OUT, 'catalog-full-raw.jpg');
    fs.writeFileSync(rawPath, rawBuf);

    const targetW = 750;
    const jpegOpts = { quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' };
    const longBuf = await sharp(rawBuf)
      .resize({ width: targetW, withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
      .jpeg(jpegOpts)
      .toBuffer();
    const longPath = path.join(OUT, 'catalog-scale-long.jpg');
    const croppedPath = path.join(OUT, 'catalog-scale-cropped.jpg');
    fs.writeFileSync(longPath, longBuf);
    fs.writeFileSync(croppedPath, longBuf);

    const assetsDir = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '自用工具文件_不部署',
      '设计方案确认',
      'assets'
    );
    fs.mkdirSync(assetsDir, { recursive: true });
    const assetPath = path.join(assetsDir, 'geo-catalog-scale-long.jpg');
    fs.copyFileSync(croppedPath, assetPath);

    const dataUrl = 'data:image/jpeg;base64,' + longBuf.toString('base64');
    report.steps.push({
      name: 'compress',
      outBytes: longBuf.length,
      assetPath
    });

    await page.goto(CONFIRM_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(600);
    const inject = await page.evaluate(
      ({ storeKey, dataUrl, caption }) => {
        let store = {};
        try {
          store = JSON.parse(localStorage.getItem(storeKey) || '{}') || {};
        } catch (_e) {
          store = {};
        }
        if (!store.geo) {
          store.geo = {
            mains: {},
            detail: {},
            overview: {},
            regions: {},
            mainCopy: {},
            overviewCopy: {},
            detailText: {}
          };
        }
        if (!store.geo.regions) store.geo.regions = {};
        store.geo.regions.scale = {
          items: [
            {
              id: 'scale-catalog-long',
              src: dataUrl,
              caption,
              captionH: 56,
              zoom: 1,
              x: 50,
              y: 0,
              bright: 1,
              contrast: 1,
              saturate: 1,
              g0: 8,
              gOp: 0.12,
              warm: 0,
              viewH: 420,
              viewHPc: 480
            }
          ]
        };
        localStorage.setItem(storeKey, JSON.stringify(store));
        return { ok: true, srcLen: dataUrl.length };
      },
      { storeKey: STORE_KEY, dataUrl, caption: '静物写生台各场景一览' }
    );
    report.steps.push({ name: 'inject', inject });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const el = document.querySelector('[data-region-block="scale"]');
      if (el) el.scrollIntoView({ block: 'center' });
      if (typeof window.fillGeoScaleCatalogLong === 'function') {
        /* 资源已写入 assets；再点一次按框宽撑满高度 */
      }
    });
    /* 用确认页按钮逻辑撑满高度 */
    await page.evaluate(async () => {
      const btn = document.getElementById('btnFillScaleCatalog');
      if (btn) {
        /* 直接调用内部 fill，避免 confirm 弹窗：silent + force */
        if (typeof window.__fillGeoScaleCatalogLong === 'function') {
          await window.__fillGeoScaleCatalogLong({ silent: true, forceFullHeight: true });
        }
      }
    });
    /* 若未暴露 API，按 natural 高度手算 */
    await page.evaluate(() => {
      const slot = document.querySelector('[data-region-block="scale"] .pic-slot');
      const img = slot && slot.querySelector('img.fg');
      if (!slot || !img || !img.naturalWidth) return;
      const h = Math.round(slot.clientWidth * (img.naturalHeight / img.naturalWidth));
      slot.style.height = Math.min(4800, Math.max(80, h)) + 'px';
    });

    const qaPath = path.join(OUT, 'confirm-scale-region.png');
    const scaleBlock = page.locator('[data-region-block="scale"]');
    if (await scaleBlock.count()) {
      await scaleBlock.screenshot({ path: qaPath, timeout: 60000 });
    }
    report.steps.push({ name: 'qaShot', path: qaPath });

    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    report.ok = false;
    report.error = String(e && e.stack ? e.stack : e);
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
