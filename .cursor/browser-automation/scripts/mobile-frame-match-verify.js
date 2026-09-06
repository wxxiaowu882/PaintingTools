/**
 * 验收：生产光学参考框（框外可见）vs Portrait_c 手机快照。
 * - 生产不信箱；框宽高比 = 手机 3D 区
 * - 手机 getFieldOfView ≈ 生产 getFieldOfView（FOV 锁）
 * Usage: PORT=18080 node scripts/mobile-frame-match-verify.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const snapName = process.env.SNAP_NAME || '降眉间肌';
const jsonRel = 'docs/json/结构_头骨骨点肌肉/03 肌肉详解_黄种人女V8.json';
const toolRel = '自用工具文件_不部署/模型标注生产工具.html';
const courseUrl = './docs/json/结构_头骨骨点肌肉/03 肌肉详解_黄种人女V8.json';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-mobile-frame-verify`);

const TARGET_ASPECT = 440 / (956 - 115);
const ASPECT_TOL = 0.02;
const FOV_TOL = 0.35;
const RADIUS_TOL = 0.03;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function encPath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}
function parseRadius(orbitStr) {
  if (!orbitStr) return null;
  const m = String(orbitStr).match(/([-\d.]+)\s*m\s*$/i);
  return m ? Math.abs(parseFloat(m[1])) : null;
}
function near(a, b, tol) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const report = { snapName, TARGET_ASPECT, checks: [] };
  let failed = false;
  const check = (name, ok, detail) => {
    report.checks.push({ name, ok, detail });
    console.log(ok ? 'PASS' : 'FAIL', name, detail || '');
    if (!ok) failed = true;
  };

  // ---- Production (optical overlay, full viewer) ----
  const prodPage = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  prodPage.setDefaultTimeout(180000);
  await prodPage.goto(`${base}/${encPath(toolRel)}`, { waitUntil: 'domcontentloaded' });
  await prodPage.waitForSelector('#file-input', { state: 'attached' });
  await prodPage.setInputFiles('#file-input', path.join(repoRoot, ...jsonRel.split('/')));
  await prodPage.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && v.model && v.model.materials && v.model.materials.length > 0;
  });
  await sleep(1200);
  await prodPage.evaluate(() => {
    const cb = document.getElementById('anno-mobile-frame-toggle');
    if (cb && !cb.checked) {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  const prodApply = await prodPage.evaluate((name) => {
    const b = window.__annoBatch;
    const s = (b.getSnapshots() || []).find((x) => x.name === name);
    if (!s) return { ok: false };
    b.applySnapshotFromData(s);
    return { ok: true, cam: s.camera };
  }, snapName);
  check('prod-apply-snapshot', !!prodApply.ok, prodApply);
  await sleep(800);
  await prodPage.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    if (v && v.jumpCameraToGoal) v.jumpCameraToGoal();
  });
  await sleep(200);
  report.prod = await prodPage.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    const wrap = document.getElementById('anno-mobile-frame-wrap');
    const fr = wrap.getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    return {
      fovAttr: v.getAttribute('field-of-view'),
      fovGet: v.getFieldOfView(),
      orbit: v.getCameraOrbit().toString(),
      target: v.getCameraTarget().toString(),
      frame: { w: fr.width, h: fr.height, aspect: fr.width / fr.height },
      viewer: { w: vr.width, h: vr.height, aspect: vr.width / vr.height },
      letterboxed: Math.abs(vr.width - window.innerWidth) > 40,
    };
  });
  report.prod.fov = report.prod.fovGet;
  await prodPage.locator('#anno-mobile-frame-wrap').screenshot({
    path: path.join(outDir, 'prod-frame-crop.png'),
  });
  await prodPage.screenshot({ path: path.join(outDir, 'prod-full.png') });
  await prodPage.close();

  check('prod-not-letterboxed', !report.prod.letterboxed, report.prod.viewer);
  check(
    'prod-frame-aspect',
    near(report.prod.frame.aspect, TARGET_ASPECT, ASPECT_TOL),
    { got: report.prod.frame.aspect, want: TARGET_ASPECT }
  );

  // ---- Mobile ----
  const mobPage = await browser.newPage({
    viewport: { width: 440, height: 956 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  mobPage.setDefaultTimeout(180000);
  await mobPage.goto(`${base}/Portrait_c.html?lib=anatomy`, { waitUntil: 'domcontentloaded' });
  await mobPage.waitForFunction(() => typeof window.selectCourse === 'function');
  await mobPage.evaluate((url) => window.selectCourse('肌肉详解', url), courseUrl);
  await mobPage.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    const loading = document.querySelector('#loading-screen');
    const ready = v && v.model && v.model.materials && v.model.materials.length > 0;
    const gone = !loading || loading.style.opacity === '0' || getComputedStyle(loading).opacity === '0';
    return ready && gone;
  }, null, { timeout: 180000 });
  await sleep(1800);

  await mobPage.evaluate(async (args) => {
    const res = await fetch(args.url);
    const data = await res.json();
    const s = (data.snapshots || []).find((x) => x.name === args.name);
    if (s && typeof window.applySnapshot === 'function') window.applySnapshot(s);
  }, { url: courseUrl, name: snapName });
  await sleep(600);
  await mobPage.evaluate(() => {
    const panel = document.getElementById('control-panel');
    if (panel && panel.classList.contains('collapsed')) {
      panel.classList.remove('collapsed');
      document.getElementById('workbench-viewer').classList.add('drawer-open');
      document.getElementById('ink-overlay').classList.add('drawer-open');
    }
    window.dispatchEvent(new Event('resize'));
  });
  await sleep(700);

  report.mobile = await mobPage.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    const vr = v.getBoundingClientRect();
    return {
      hasSnap: !!window._hasAppliedSnapshot,
      fovAttr: v.getAttribute('field-of-view'),
      fovGet: v.getFieldOfView(),
      orbit: v.getCameraOrbit().toString(),
      target: v.getCameraTarget().toString(),
      viewer: { x: vr.x, y: vr.y, w: vr.width, h: vr.height, aspect: vr.width / vr.height },
      win: { w: window.innerWidth, h: window.innerHeight },
    };
  });
  report.mobile.fov = report.mobile.fovGet;

  await mobPage.evaluate(() => {
    const panel = document.getElementById('control-panel');
    if (panel) panel.style.visibility = 'hidden';
  });
  await mobPage.locator('#workbench-viewer').screenshot({
    path: path.join(outDir, 'mobile-viewer.png'),
  });
  await mobPage.evaluate(() => {
    const panel = document.getElementById('control-panel');
    if (panel) panel.style.visibility = '';
  });
  await mobPage.screenshot({ path: path.join(outDir, 'mobile-full.png') });
  await mobPage.close();

  check('mobile-snapshot-flag', report.mobile.hasSnap, report.mobile);
  check(
    'mobile-full-width',
    Math.abs(report.mobile.viewer.w - 440) < 2 && report.mobile.viewer.x < 2,
    report.mobile.viewer
  );
  check(
    'mobile-viewer-aspect',
    near(report.mobile.viewer.aspect, TARGET_ASPECT, ASPECT_TOL),
    { got: report.mobile.viewer.aspect, want: TARGET_ASPECT }
  );
  check(
    'fov-match',
    near(report.prod.fov, report.mobile.fov, FOV_TOL),
    { prod: report.prod.fov, mobile: report.mobile.fov }
  );
  const pr = parseRadius(report.prod.orbit);
  const mr = parseRadius(report.mobile.orbit);
  check('radius-match', near(pr, mr, RADIUS_TOL), { prod: pr, mobile: mr });

  try {
    const py = `
from PIL import Image
import numpy as np, json
a=np.array(Image.open(r'''${path.join(outDir, 'prod-frame-crop.png').replace(/\\/g, '/')}''').convert('RGB'),dtype=np.float32)
b=np.array(Image.open(r'''${path.join(outDir, 'mobile-viewer.png').replace(/\\/g, '/')}''').convert('RGB'))
bi=np.array(Image.fromarray(b.astype(np.uint8)).resize((a.shape[1],a.shape[0])),dtype=np.float32)
h,w,_=a.shape; y0,y1=int(h*0.08),int(h*0.92); x0,x1=int(w*0.08),int(w*0.92)
aa,bb=a[y0:y1,x0:x1], bi[y0:y1,x0:x1]
mae=float(np.abs(aa-bb).mean())
def frac(img):
  lum=img.mean(2); m=lum>30; ys,xs=np.where(m)
  return float((xs.max()-xs.min())/img.shape[1]), float((ys.max()-ys.min())/img.shape[0])
fa,fb=frac(aa),frac(bb)
print(json.dumps({'mae':mae,'prod':fa,'mob':fb,'dw':abs(fa[0]-fb[0]),'dh':abs(fa[1]-fb[1])}))
`;
    const out = execFileSync('python', ['-c', py], { encoding: 'utf8' }).trim();
    const vis = JSON.parse(out.split('\n').pop());
    check('visual-inset', vis.mae < 28 && vis.dw < 0.08 && vis.dh < 0.08, vis);
  } catch (e) {
    check('visual-inset', false, String(e && e.message || e));
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('report ->', outDir);
  await browser.close();
  if (failed) process.exit(1);
  console.log('ALL CHECKS PASSED');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
