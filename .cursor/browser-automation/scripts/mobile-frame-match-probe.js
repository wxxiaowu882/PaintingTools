/**
 * 探针：同一快照在生产工具参考框 vs Portrait_c 手机视口的相机/画布尺寸。
 * Usage: node scripts/mobile-frame-match-probe.js
 */
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const snapName = process.env.SNAP_NAME || '降眉间肌';
const jsonRel = 'docs/json/结构_头骨骨点肌肉/03 肌肉详解_黄种人女V8.json';
const toolRel = '自用工具文件_不部署/模型标注生产工具.html';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-mobile-frame-probe`);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function encPath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

async function readCam(page) {
  return page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    if (!v) return null;
    const orbit = v.getCameraOrbit ? v.getCameraOrbit() : null;
    const target = v.getCameraTarget ? v.getCameraTarget() : null;
    const fov = v.getFieldOfView ? v.getFieldOfView() : null;
    const vr = v.getBoundingClientRect();
    return {
      attrOrbit: v.getAttribute('camera-orbit'),
      attrTarget: v.getAttribute('camera-target'),
      attrFov: v.getAttribute('field-of-view'),
      orbitStr: orbit ? orbit.toString() : null,
      targetStr: target ? target.toString() : null,
      fovDeg: fov,
      viewer: { x: vr.x, y: vr.y, w: vr.width, h: vr.height, aspect: vr.width / vr.height },
      win: { w: window.innerWidth, h: window.innerHeight },
      hasSnap: !!window._hasAppliedSnapshot,
      tour: !!(window.tourState && window.tourState.isActive),
    };
  });
}

async function readFrame(page) {
  return page.evaluate(() => {
    const wrap = document.getElementById('anno-mobile-frame-wrap');
    const ov = document.getElementById('anno-mobile-frame-overlay');
    if (!wrap || !ov || ov.hidden) return null;
    const r = wrap.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, aspect: r.width / r.height };
  });
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const report = { snapName, base, outDir };

  // ---------- Production tool ----------
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(120000);
    const url = `${base}/${encPath(toolRel)}`;
    console.log('PROD', url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#file-input', { state: 'attached' });
    const jsonAbs = path.join(repoRoot, ...jsonRel.split('/'));
    await page.setInputFiles('#file-input', jsonAbs);
    await page.waitForFunction(() => {
      const v = document.querySelector('#workbench-viewer');
      return v && v.model && v.model.materials && v.model.materials.length > 0;
    }, null, { timeout: 180000 });
    await sleep(1500);

    // enable frame
    await page.evaluate(() => {
      const cb = document.getElementById('anno-mobile-frame-toggle');
      if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    });

    report.prodApply = await page.evaluate((name) => {
      const b = window.__annoBatch;
      if (!b || !b.getSnapshots || !b.applySnapshotFromData) return { ok: false, reason: 'no-batch' };
      const snaps = b.getSnapshots() || [];
      const s = snaps.find((x) => x && x.name === name);
      if (!s) return { ok: false, reason: 'not-found', names: snaps.map((x) => x.name).slice(0, 8) };
      b.applySnapshotFromData(s);
      return { ok: true, fov: s.camera && s.camera.fov, orbit: s.camera && s.camera.orbit };
    }, snapName);

    await sleep(1200);
    report.prodCam = await readCam(page);
    report.prodFrame = await readFrame(page);
    await page.screenshot({ path: path.join(outDir, 'prod.png'), fullPage: false });
    await page.close();
  }

  // ---------- Portrait_c mobile (iPhone 16 Pro Max-ish) ----------
  {
    const page = await browser.newPage({
      viewport: { width: 440, height: 956 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });
    page.setDefaultTimeout(120000);
    const url = `${base}/Portrait_c.html?lib=anatomy`;
    console.log('MOBILE', url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#workbench-viewer', { state: 'attached' });
    // wait loading gone / model
    await page.waitForFunction(() => {
      const v = document.querySelector('#workbench-viewer');
      const loading = document.querySelector('#loading-screen');
      const ready = v && v.model && v.model.materials && v.model.materials.length > 0;
      const hidden = !loading || getComputedStyle(loading).opacity === '0' || loading.style.pointerEvents === 'none';
      return ready && hidden;
    }, null, { timeout: 180000 }).catch(() => {});
    await sleep(2000);

    // open drawer + snap tab if needed
    await page.evaluate(() => {
      const panel = document.getElementById('control-panel');
      if (panel && panel.classList.contains('collapsed') && typeof window.toggleDrawer === 'function') {
        window.toggleDrawer({ stopPropagation() {}, preventDefault() {} });
      }
      // click 画师解析 / snap tab
      const tabs = [...document.querySelectorAll('.tab-btn, .tab, [data-tab], .tab-container *')];
      const snapTab = tabs.find((t) => /解析|快照|画师/.test(t.textContent || ''));
      if (snapTab) snapTab.click();
    });
    await sleep(500);

    // click snapshot in list
    await page.evaluate((name) => {
      const items = [...document.querySelectorAll('#snap-list .list-item, #snap-list > *')];
      const el = items.find((n) => (n.textContent || '').includes(name));
      if (el) {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
        if (typeof window.applySnapshot === 'function') {
          // also direct apply from currentData
        }
      }
      if (window.currentData && window.applySnapshot) {
        const s = (window.currentData.snapshots || []).find((x) => x.name === name);
        if (s) window.applySnapshot(s);
      }
    }, snapName);
    await sleep(1500);

    report.mobileCamDrawerOpen = await readCam(page);
    await page.screenshot({ path: path.join(outDir, 'mobile-drawer-open.png') });

    // also measure tour mode
    await page.evaluate(() => {
      if (typeof window.startTour === 'function') window.startTour('snap');
    });
    await sleep(1500);
    // jump to named snap in tour
    await page.evaluate((name) => {
      if (!window.tourState || !window.tourState.isActive) return;
      const list = window.tourState.list || [];
      const idx = list.findIndex((x) => x.name === name);
      if (idx >= 0) {
        window.tourState.currentIndex = idx;
        if (typeof window.applySnapshot === 'function') window.applySnapshot(list[idx]);
      }
    }, snapName);
    await sleep(1000);
    report.mobileCamTour = await readCam(page);
    await page.screenshot({ path: path.join(outDir, 'mobile-tour.png') });
    await page.close();
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log('wrote', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
