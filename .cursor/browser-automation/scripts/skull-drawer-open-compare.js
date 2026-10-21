/**
 * 临时对比：头骨「额骨」生产信箱 vs Portrait_c 底栏展开
 * Usage: PORT=18080 node scripts/skull-drawer-open-compare.js
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'runs', 'skull-frame-mismatch');
const repo = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 18080}`;
const jsonRel = path.join(repo, 'docs/json/结构_头骨骨点肌肉/01 头骨详解.json');
const courseUrl = './docs/json/结构_头骨骨点肌肉/01 头骨详解.json';
const TARGET = 440 / Math.max(220, 956 - 60 - Math.round(956 * 0.35));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const report = { TARGET };

  const prod = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await prod.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await prod.waitForSelector('#file-input', { state: 'attached' });
  await prod.setInputFiles('#file-input', jsonRel);
  await prod.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && v.model && v.model.materials && v.model.materials.length > 0;
  }, null, { timeout: 120000 });
  await sleep(1000);
  await prod.evaluate(() => {
    const cb = document.getElementById('anno-mobile-frame-toggle');
    if (!cb) return;
    if (!cb.checked) {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await prod.evaluate(() => {
    const b = window.__annoBatch;
    const s = (b.getSnapshots() || []).find((x) => x.name === '额骨');
    if (s) b.applySnapshotFromData(s);
  });
  await sleep(900);
  report.prod = await prod.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    const wrap = document.getElementById('anno-mobile-frame-wrap');
    const vr = v.getBoundingClientRect();
    const fr = wrap.getBoundingClientRect();
    return {
      letterboxed: Math.abs(vr.width - window.innerWidth) > 40,
      match: Math.abs(vr.width - fr.width) < 2 && Math.abs(vr.height - fr.height) < 2,
      aspect: vr.width / vr.height,
      size: { w: vr.width, h: vr.height },
      fov: v.getFieldOfView(),
      label: (document.getElementById('anno-mobile-frame-label') || {}).textContent,
    };
  });
  const prodShot = path.join(outDir, 'prod-frame-v2.png');
  await prod.locator('#anno-mobile-frame-wrap').screenshot({ path: prodShot });
  await prod.close();

  const page = await browser.newPage({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await page.goto(`${base}/Portrait_c.html?lib=anatomy`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => typeof window.selectCourse === 'function');
  await page.evaluate((url) => window.selectCourse('头骨详解', url), courseUrl);
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    const loading = document.querySelector('#loading-screen');
    return (
      v &&
      v.model &&
      v.model.materials &&
      v.model.materials.length > 0 &&
      (!loading || getComputedStyle(loading).opacity === '0' || loading.style.opacity === '0')
    );
  }, null, { timeout: 120000 });
  await sleep(1200);
  await page.evaluate(async ({ url, name }) => {
    const data = await (await fetch(url)).json();
    const s = (data.snapshots || []).find((x) => x.name === name);
    if (s) window.applySnapshot(s);
  }, { url: courseUrl, name: '额骨' });
  await sleep(600);
  await page.evaluate(() => {
    const panel = document.getElementById('control-panel');
    const v = document.getElementById('workbench-viewer');
    const ink = document.getElementById('ink-overlay');
    panel.classList.remove('collapsed');
    v.classList.add('drawer-open');
    ink.classList.add('drawer-open');
    if (typeof applyViewerLayout === 'function') applyViewerLayout();
    window.dispatchEvent(new Event('resize'));
  });
  await sleep(1000);
  report.open = await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    const vr = v.getBoundingClientRect();
    return {
      aspect: vr.width / vr.height,
      size: { w: vr.width, h: vr.height },
      fov: v.getFieldOfView(),
    };
  });
  await page.evaluate(() => {
    const p = document.getElementById('control-panel');
    if (p) p.style.visibility = 'hidden';
  });
  const mobShot = path.join(outDir, 'mob-open-v2.png');
  await page.locator('#workbench-viewer').screenshot({ path: mobShot });
  await page.close();

  const py = `
from PIL import Image
import numpy as np, json
a=np.array(Image.open(r'''${prodShot.replace(/\\/g, '/')}''').convert('RGB'),dtype=np.float32)
b=np.array(Image.open(r'''${mobShot.replace(/\\/g, '/')}''').convert('RGB'))
bi=np.array(Image.fromarray(b.astype(np.uint8)).resize((a.shape[1],a.shape[0])),dtype=np.float32)
h,w,_=a.shape; y0,y1=int(h*0.08),int(h*0.92); x0,x1=int(w*0.08),int(w*0.92)
aa,bb=a[y0:y1,x0:x1], bi[y0:y1,x0:x1]
mae=float(np.abs(aa-bb).mean())
def frac(img):
  lum=img.mean(2); m=lum>30; ys,xs=np.where(m)
  if len(xs)==0: return 0,0,0.5,0.5
  return float((xs.max()-xs.min())/img.shape[1]), float((ys.max()-ys.min())/img.shape[0]), float(xs.mean()/img.shape[1]), float(ys.mean()/img.shape[0])
fa,fb=frac(aa),frac(bb)
print(json.dumps({'mae':mae,'prod':fa,'mob':fb,'dw':abs(fa[0]-fb[0]),'dh':abs(fa[1]-fb[1]),'dcx':abs(fa[2]-fb[2])}))
`;
  try {
    const out = execFileSync('python', ['-c', py], { encoding: 'utf8' }).trim();
    report.visual = JSON.parse(out.split('\n').pop());
  } catch (e) {
    report.visual = { err: String((e && e.message) || e) };
  }

  report.aspectDelta = Math.abs(report.prod.aspect - report.open.aspect);
  report.okAspect = report.aspectDelta < 0.05;
  // 以 mae + 水平质心为准（frac 宽高易受阈值噪声影响）
  report.okVisual =
    report.visual &&
    report.visual.mae != null &&
    report.visual.mae < 12 &&
    report.visual.dcx < 0.02;
  fs.writeFileSync(path.join(outDir, 'report-v2.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.okAspect && report.okVisual ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
