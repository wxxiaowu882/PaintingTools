/**
 * 诊断：滚轮放大后 captureSnapshotFields 是否记下 radius/FOV，
 * 以及 apply 后再读是否一致。
 * Usage: PORT=18080 node scripts/diag-snap-zoom-capture.js
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
require('./_playwright-browsers-path.js');

const PORT = process.env.PORT || '18080';
const BASE = `http://127.0.0.1:${PORT}`;
const PROD = `${BASE}/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/%E6%A8%A1%E5%9E%8B%E6%A0%87%E6%B3%A8%E7%94%9F%E4%BA%A7%E5%B7%A5%E5%85%B7`;
const JSON_URL = `${BASE}/docs/json/%E7%BB%93%E6%9E%84_%E4%BA%94%E5%AE%98/02%20%E9%BC%BB%E5%AD%90%E8%AF%A6%E8%A7%A3.json`;

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(PROD, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!document.querySelector('#workbench-viewer'), { timeout: 30000 });

  const jsonText = await (await page.request.get(JSON_URL)).text();
  await page.evaluate(async (text) => {
    const parsed = JSON.parse(text);
    const file = new File([text], '02 鼻子详解.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('input[type="file"]') || document.getElementById('file-input');
    if (!input) throw new Error('no file input');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    window.__diagParsed = parsed;
  }, jsonText);

  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && v.loaded && (window.__annoBatch || window.snapshotsData || true);
  }, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const result = await page.evaluate(async () => {
    const v = document.querySelector('#workbench-viewer');
    const B = window.__annoBatch;
    if (!B || !B.applySnapshotFromData || !B.captureSnapshotFields) {
      return { error: 'no __annoBatch', keys: Object.keys(window).filter(k => /anno|snap|Batch/i.test(k)) };
    }
    const snaps = B.getSnapshots ? B.getSnapshots() : [];
    if (!snaps.length) return { error: 'no snaps', n: snaps.length };

    const s0 = snaps[0];
    B.applySnapshotFromData(s0);
    await new Promise(r => setTimeout(r, 800));

    const readCam = () => ({
      orbit: v.getCameraOrbit().toString(),
      radius: v.getCameraOrbit().radius,
      fov: v.getFieldOfView(),
      fovAttr: v.getAttribute('field-of-view'),
      authored: window.__annoMobileFrame && window.__annoMobileFrame.getAuthoredFov && window.__annoMobileFrame.getAuthoredFov(),
      frameOn: !!(window.__annoMobileFrame && window.__annoMobileFrame.isOn && window.__annoMobileFrame.isOn()),
    });
    const before = Object.assign({ camSaved: s0.camera }, readCam());
    const rect = v.getBoundingClientRect();
    window.__diagWheelTarget = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    return { phase: 'need-wheel', before, snapId: s0.id, hasSecond: !!snaps[1] };
  });

  if (result.error) {
    console.log(JSON.stringify(result, null, 2));
    await browser.close();
    process.exit(1);
  }

  const { x, y } = await page.evaluate(() => window.__diagWheelTarget);
  await page.mouse.move(x, y);
  const ticks = Number(process.env.ZOOM_TICKS || 6);
  for (let i = 0; i < ticks; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(700);

  const result2 = await page.evaluate(async () => {
    const v = document.querySelector('#workbench-viewer');
    const B = window.__annoBatch;
    const snaps = B.getSnapshots();
    const s0 = snaps[0];
    const readCam = () => ({
      orbit: v.getCameraOrbit().toString(),
      radius: v.getCameraOrbit().radius,
      fov: v.getFieldOfView(),
      fovAttr: v.getAttribute('field-of-view'),
      authored: window.__annoMobileFrame && window.__annoMobileFrame.getAuthoredFov && window.__annoMobileFrame.getAuthoredFov(),
      frameOn: !!(window.__annoMobileFrame && window.__annoMobileFrame.isOn && window.__annoMobileFrame.isOn()),
    });
    const afterWheel = readCam();
    const captured = B.captureSnapshotFields();
    s0.camera = captured.cam;
    if (snaps[1]) B.applySnapshotFromData(snaps[1]);
    await new Promise(r => setTimeout(r, 500));
    B.applySnapshotFromData(s0);
    await new Promise(r => setTimeout(r, 1200));
    const afterReapply = Object.assign({ camInSnap: Object.assign({}, s0.camera) }, readCam());
    const savedFov = parseFloat(captured.cam.fov);
    return {
      afterWheel,
      captured: captured.cam,
      afterReapply,
      radiusRestored: Math.abs(afterReapply.radius - afterWheel.radius) < 0.002,
      fovRestoredToSaved: Math.abs(afterReapply.fov - savedFov) < 0.5,
      fovStillZoomedVsBefore: true, // filled by host
      captureFovMatchesLive: Math.abs(savedFov - afterWheel.fov) < 0.35,
      captureUsesAuthoredNotLive: afterWheel.authored != null && Math.abs(afterWheel.fov - afterWheel.authored) > 0.2
        && Math.abs(savedFov - afterWheel.authored) < 0.35
        && Math.abs(savedFov - afterWheel.fov) > 0.5,
    };
  });

  const before = result.before;
  result2.radiusChanged = Math.abs(result2.afterWheel.radius - before.radius) > 1e-4;
  result2.fovChanged = Math.abs(result2.afterWheel.fov - before.fov) > 0.05;
  result2.fovStillZoomedVsBefore = Math.abs(result2.afterReapply.fov - before.fov) > 2;
  result2.before = before;
  result2.pass = result2.radiusChanged && result2.fovChanged
    && result2.captureFovMatchesLive && !result2.captureUsesAuthoredNotLive
    && result2.radiusRestored && result2.fovStillZoomedVsBefore;

  console.log(JSON.stringify(result2, null, 2));
  await browser.close();
  process.exit(result2.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
