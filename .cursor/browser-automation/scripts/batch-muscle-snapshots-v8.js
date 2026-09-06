/**
 * 按额肌/颞肌模板，为其余肌肉批量生成组合快照（含缩略图与标注 desc），写回 V8 JSON。
 * Usage:
 *   PORT=18080 node scripts/batch-muscle-snapshots-v8.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;

const OUT_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解_黄种人女V8.json');
const TOOL_PATH = '自用工具文件_不部署/模型标注生产工具.html';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-batch-muscle-snaps`);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(OUT_JSON)) throw new Error('missing ' + OUT_JSON);

  const backupPath = path.join(outDir, '03 肌肉详解_黄种人女V8.backup.json');
  fs.copyFileSync(OUT_JSON, backupPath);
  console.log('backup ->', backupPath);

  const workPath = path.join(outDir, '_import.json');
  fs.copyFileSync(OUT_JSON, workPath);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(120000);

  const url = `${base}/${TOOL_PATH.split('/').map(encodeURIComponent).join('/')}`;
  console.log('goto', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#file-input', { state: 'attached', timeout: 20000 });
  await page.waitForFunction(() => typeof window.__annoBatch === 'object' && window.__annoBatch, null, {
    timeout: 30000,
  });

  await page.setInputFiles('#file-input', workPath);
  await page.waitForFunction(
    () => {
      const b = window.__annoBatch;
      if (!b) return false;
      const pts = b.getPoints() || [];
      const snaps = b.getSnapshots() || [];
      const v = document.querySelector('#workbench-viewer');
      const src = (v && (v.getAttribute('src') || '')) || '';
      return pts.length >= 23 && snaps.length >= 2 && src.length > 0;
    },
    null,
    { timeout: 180000 }
  );
  // wait model load event
  await page.waitForFunction(
    () => {
      const v = document.querySelector('#workbench-viewer');
      return v && v.model && v.model.materials && v.model.materials.length > 0;
    },
    null,
    { timeout: 180000 }
  );
  await sleep(2000);

  // dim panels so thumbs are cleaner
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.opacity = '0.15';
    });
  });

  const summary = await page.evaluate(async () => {
    const B = window.__annoBatch;
    const points = B.getPoints();
    const snaps = B.getSnapshots();
    const existingNames = new Set(snaps.map((s) => s.name));
    const template =
      snaps.find((s) => s.name === '额肌') ||
      snaps.find((s) => s.settings) ||
      snaps[0];
    if (!template || !template.settings) throw new Error('no template settings');

    B.applyLightSettings(template.settings);
    // ensure all points visible
    points.forEach((p) => {
      p.hidden = false;
    });
    B.renderState();
    B.updateSVG();

    const allIds = points.map((p) => p.id);
    let snapIndex = Math.max(0, ...snaps.map((s) => s.id || 0)) + 1;
    B.setSnapIndex(snapIndex);

    const created = [];
    const skipped = [];

    for (const p of points) {
      if (existingNames.has(p.text)) {
        skipped.push(p.text);
        continue;
      }
      B.selectSurfacePoint(p.id);
      B.focusPointCamera(p);
      await new Promise((r) => setTimeout(r, 900));
      try {
        if (typeof document.querySelector('#workbench-viewer').jumpCameraToGoal === 'function') {
          document.querySelector('#workbench-viewer').jumpCameraToGoal();
        }
      } catch (_e) {}
      await new Promise((r) => setTimeout(r, 400));

      const { cam, set, vis } = B.captureSnapshotFields();
      // force template lighting into snapshot even if UI drifted
      const settings = Object.assign({}, template.settings, {
        modelOpacity: set.modelOpacity,
        surfaceGloss: template.settings.surfaceGloss,
      });
      const thumb = await B.captureSnapshotThumb();
      const id = snapIndex++;
      B.setSnapIndex(id + 1);
      const snap = {
        id,
        name: p.text,
        thumb,
        camera: cam,
        settings,
        visiblePoints: vis && vis.length ? vis : allIds,
        showTextPoints: [p.id],
        desc: p.desc || '',
      };
      B.pushSnapshot(snap);
      created.push({ id, name: p.text, thumbLen: (thumb || '').length, descLen: (snap.desc || '').length });
    }

    B.renderSnapshots();
    const json = B.generateCode();
    const ambDisp = document.querySelector('#global-ambient')?.nextElementSibling?.innerText;
    const spotDisp = document.querySelector('#global-spot')?.nextElementSibling?.innerText;
    return {
      created,
      skipped,
      totalSnaps: B.getSnapshots().length,
      pointCount: points.length,
      json,
      ambDisp,
      spotDisp,
      ambVal: document.querySelector('#global-ambient')?.value,
      spotVal: document.querySelector('#global-spot')?.value,
    };
  });

  const outJsonPath = path.join(outDir, 'result.json');
  fs.writeFileSync(outJsonPath, summary.json, 'utf8');
  fs.writeFileSync(OUT_JSON, summary.json, 'utf8');
  fs.writeFileSync(
    path.join(outDir, 'summary.json'),
    JSON.stringify(
      {
        created: summary.created,
        skipped: summary.skipped,
        totalSnaps: summary.totalSnaps,
        pointCount: summary.pointCount,
        ambDisp: summary.ambDisp,
        spotDisp: summary.spotDisp,
        ambVal: summary.ambVal,
        spotVal: summary.spotVal,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log('created', summary.created.length, 'skipped', summary.skipped);
  console.log('total snaps', summary.totalSnaps, 'points', summary.pointCount);
  console.log('slider amb/spot', summary.ambVal, summary.spotVal, 'disp', summary.ambDisp, summary.spotDisp);
  console.log('wrote', OUT_JSON);

  await browser.close();
  if (summary.totalSnaps !== summary.pointCount) {
    console.error('WARN: snap count != point count');
    process.exitCode = 2;
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
