/**
 * Colourcoded: Sketchfab embed vs Glb管理器 bone-color compare
 * Usage: node scripts/compare-colourcoded-bone.js [glbPath]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const baRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(baRoot, '..', '..');
const profileDir = path.join(baRoot, 'chrome-profile-sketchfab');
const MODEL_ID = '8c1bcc3685cd40b3bd6b42e0445522a5';
const EMBED =
  'https://sketchfab.com/models/' +
  MODEL_ID +
  '/embed?autostart=1&internal=1&tracking=0&ui_ar=0&ui_infos=0&ui_snapshots=0&ui_stop=0&ui_theatre=1&ui_watermark=0&ui_controls=0&ui_help=0&ui_settings=0&ui_vr=0&ui_fullscreen=0&ui_annotations=0';

const glbPath = path.resolve(
  process.argv[2] ||
    path.join(baRoot, 'runs', 'colourcoded-muscle-fix', 'Colourcoded head muscle chart_V9.9.83_Ultimate.glb')
);
const runDir = path.dirname(glbPath);
fs.mkdirSync(runDir, { recursive: true });

function encodeRepoPath(rel) {
  return String(rel)
    .split(/[/\\]/)
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

async function waitSketchfabReady(page, timeoutMs) {
  const t0 = Date.now();
  let best = { sz: 0, buf: null };
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(2500);
    // dismiss loading overlay if text gone
    const stillLoading = await page.evaluate(() => {
      const t = document.body ? document.body.innerText : '';
      return /Loading 3D model/i.test(t);
    });
    const buf = await page.screenshot({ type: 'png' });
    if (buf.length > best.sz) best = { sz: buf.length, buf };
    if (!stillLoading && buf.length > 200000) break;
    if (!stillLoading && Date.now() - t0 > 25000 && buf.length > 150000) break;
  }
  return best;
}

async function main() {
  if (!fs.existsSync(glbPath)) throw new Error('missing glb: ' + glbPath);
  console.log('glb', glbPath, (fs.statSync(glbPath).size / 1e6).toFixed(1) + 'MB');

  // ---- Sketchfab ----
  const ctx = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1100, height: 900 },
    args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
  });
  const sp = await ctx.newPage();
  await sp.goto(EMBED, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const best = await waitSketchfabReady(sp, 120000);
  fs.writeFileSync(path.join(runDir, 'sketchfab_ref.png'), best.buf);
  console.log('sketchfab bytes', best.sz);
  await sp.screenshot({
    path: path.join(runDir, 'sketchfab_zygoma.png'),
    type: 'png',
    clip: { x: 340, y: 240, width: 420, height: 360 }
  });
  await ctx.close();

  // ---- Glb manager ----
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(u.pathname);
      if (rel === '/' || rel === '') {
        res.writeHead(302, { Location: '/自用工具文件_不部署/GBL管理器/Glb管理器.html' });
        res.end();
        return;
      }
      const fp = path.join(repoRoot, rel.replace(/^\//, '').replace(/\//g, path.sep));
      if (!fp.startsWith(repoRoot) || !fs.existsSync(fp)) {
        res.writeHead(404);
        res.end('404');
        return;
      }
      const ext = path.extname(fp).toLowerCase();
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.glb': 'model/gltf-binary',
        '.wasm': 'application/wasm',
        '.png': 'image/png',
        '.jpg': 'image/jpeg'
      };
      res.writeHead(200, {
        'Content-Type': types[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(fp).pipe(res);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  await new Promise((r) => server.listen(18082, '127.0.0.1', r));

  const mgr = 'http://127.0.0.1:18082/' + encodeRepoPath('自用工具文件_不部署/GBL管理器/Glb管理器.html');
  const glbUrl = 'http://127.0.0.1:18082/' + encodeRepoPath(path.relative(repoRoot, glbPath));

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.setDefaultTimeout(180000);
  await page.goto(mgr, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__AGENT_LOAD_GLB_BUFFER__ === 'function', {
    timeout: 30000
  });
  await page.evaluate(() => {
    const _setTimeout = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...rest) => {
      if (typeof ms === 'number' && ms === 30000 && typeof fn === 'function') {
        const src = Function.prototype.toString.call(fn);
        if (src.includes('防挂死') || src.includes('解析超时') || src.includes('activeGltfLoads')) {
          ms = 180000;
        }
      }
      return _setTimeout(fn, ms, ...rest);
    };
  });

  const info = await page.evaluate(
    async ({ glbUrl, name }) => {
      const prefer = document.getElementById('check-prefer-pbr');
      if (prefer) {
        prefer.checked = true;
        localStorage.setItem('prefer_pbr_preview', '1');
      }
      const resp = await fetch(glbUrl);
      if (!resp.ok) throw new Error('fetch ' + resp.status);
      const ab = await resp.arrayBuffer();
      let r = null;
      let err = null;
      try {
        r = await window.__AGENT_LOAD_GLB_BUFFER__(ab, name);
      } catch (e) {
        err = String((e && e.message) || e);
      }
      await new Promise((x) => setTimeout(x, 5000));
      const mv = document.getElementById('main-viewer');
      if (mv && getComputedStyle(mv).display !== 'none') {
        try {
          mv.setAttribute('camera-orbit', '25deg 78deg auto');
          mv.setAttribute('field-of-view', '28deg');
          if (typeof mv.jumpCameraToGoal === 'function') mv.jumpCameraToGoal();
        } catch (_) {}
      }
      await new Promise((x) => setTimeout(x, 1500));
      return {
        r,
        err,
        bytes: ab.byteLength,
        main: mv ? getComputedStyle(mv).display : '?'
      };
    },
    { glbUrl, name: path.basename(glbPath) }
  );
  console.log('mgr', JSON.stringify(info));
  await page.screenshot({ path: path.join(runDir, 'ours_mgr.png'), type: 'png' });
  await page.screenshot({
    path: path.join(runDir, 'ours_zygoma.png'),
    type: 'png',
    clip: { x: 420, y: 200, width: 440, height: 380 }
  });
  await browser.close();
  server.close();
  console.log('DONE', runDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
