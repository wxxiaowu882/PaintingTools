/**
 * 探测大本 vs 光头亚裔 世界 AABB，推算对齐头高的 scale
 * 用法：先 seed 再跑；读 V02 两关
 * node scripts/headform-probe-scale-bald-asian.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-bald-asian-scale-probe`);
fs.mkdirSync(outDir, { recursive: true });

function launchBrowser() {
  const preferred = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
  const fallbacks = [preferred, 'chrome'].filter((c, i, a) => a.indexOf(c) === i);
  return (async () => {
    let lastErr;
    for (const channel of fallbacks) {
      try {
        const browser = await chromium.launch({ headless: true, channel });
        console.log('[probe] browser', channel);
        return browser;
      } catch (err) {
        lastErr = err;
      }
    }
    return chromium.launch({ headless: true });
  })();
}

async function waitReady(page) {
  await page
    .waitForFunction(() => {
      const el = document.getElementById('scene-loader');
      if (!el) return true;
      const st = getComputedStyle(el);
      return st.display === 'none' || Number(st.opacity || 1) < 0.05;
    }, null, { timeout: 420000 })
    .catch(() => {});
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
}

async function openId(page, id) {
  const idx = await page.evaluate((sid) => (window.customScenes || []).findIndex((s) => s && String(s.id) === sid), id);
  if (idx < 0) throw new Error('missing ' + id);
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await waitReady(page);
}

async function measure(page) {
  return page.evaluate(() => {
    const host = window.__solidHost;
    const THREE = host.getTHREE();
    const g = host.getSceneGroup();
    let root = null;
    g.traverse((o) => {
      if (!root && o.userData && o.userData.type === 'glb') root = o;
    });
    if (!root) root = g.children[0];
    const boxW = new THREE.Box3().setFromObject(root);
    const size = boxW.getSize(new THREE.Vector3());
    const center = boxW.getCenter(new THREE.Vector3());
    return {
      scale: root.scale ? [root.scale.x, root.scale.y, root.scale.z] : null,
      worldMin: [boxW.min.x, boxW.min.y, boxW.min.z],
      worldMax: [boxW.max.x, boxW.max.y, boxW.max.z],
      worldSize: [size.x, size.y, size.z],
      worldCenter: [center.x, center.y, center.z]
    };
  });
}

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(300000);
  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });

  await openId(page, 'V02');
  const daben = await measure(page);
  await page.screenshot({ path: path.join(outDir, 'daben-V02.png') });

  await openId(page, 'V02_male_bald_asian_01');
  const bald = await measure(page);
  await page.screenshot({ path: path.join(outDir, 'bald-V02.png') });

  const curScale = bald.scale && bald.scale[0] ? bald.scale[0] : 5.8;
  const suggested = curScale * (daben.worldSize[1] / bald.worldSize[1]);
  const result = {
    daben,
    bald,
    suggestedScale: +suggested.toFixed(4),
    note: 'suggestedScale ≈ curScale * (dabenH / baldH) 使世界头高对齐'
  };
  fs.writeFileSync(path.join(outDir, 'probe.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
