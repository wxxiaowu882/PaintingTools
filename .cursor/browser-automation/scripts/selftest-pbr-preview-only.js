/**
 * 仅测 PBR_Preview 大文件载入
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const baRoot = path.resolve(__dirname, '..');
const runDir = path.join(baRoot, 'runs', '20260823-pbr-route-test');
fs.mkdirSync(runDir, { recursive: true });
const mgr =
  'http://127.0.0.1:18080/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GBL%E7%AE%A1%E7%90%86%E5%99%A8/Glb%E7%AE%A1%E7%90%86%E5%99%A8.html';
const glbPath = 'E:/模型/0820模型下载/3D Head scan shader testing_PBR_Preview.glb';

async function main() {
  const server = http.createServer((req, res) => {
    if (!fs.existsSync(glbPath)) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    const st = fs.statSync(glbPath);
    res.writeHead(200, {
      'Content-Type': 'model/gltf-binary',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': st.size
    });
    fs.createReadStream(glbPath).pipe(res);
  });
  await new Promise((r) => server.listen(18081, '127.0.0.1', r));
  console.log('file server up, size MB', (fs.statSync(glbPath).size / 1e6).toFixed(1));

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (e) => console.log('PAGEERR', String(e.message).slice(0, 240)));
  page.on('crash', () => console.log('CRASH'));

  const out = { tag: 'F_pbrPreview' };
  try {
    await page.goto(mgr, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => typeof window.__AGENT_LOAD_GLB_BUFFER__ === 'function', {
      timeout: 30000
    });
    console.log('loading PBR_Preview...');
    const info = await page.evaluate(async () => {
      const cb = document.getElementById('check-prefer-pbr');
      if (cb) {
        cb.checked = false;
        localStorage.setItem('prefer_pbr_preview', '0');
      }
      const t0 = performance.now();
      const resp = await fetch('http://127.0.0.1:18081/');
      if (!resp.ok) throw new Error('fetch ' + resp.status);
      const ab = await resp.arrayBuffer();
      const tFetch = performance.now() - t0;
      const t1 = performance.now();
      let load = null;
      let loadErr = null;
      try {
        load = await window.__AGENT_LOAD_GLB_BUFFER__(ab, 'PBR_Preview.glb');
      } catch (e) {
        loadErr = String((e && e.message) || e);
      }
      const tParse = performance.now() - t1;
      await new Promise((x) => setTimeout(x, 6000));
      const mv = document.getElementById('main-viewer');
      const mc = document.getElementById('matcap-canvas');
      if (mv) {
        mv.setAttribute('camera-orbit', '45deg 75deg auto');
        mv.setAttribute('field-of-view', '25deg');
        if (typeof mv.jumpCameraToGoal === 'function') mv.jumpCameraToGoal();
      }
      await new Promise((x) => setTimeout(x, 1500));
      return {
        load,
        loadErr,
        tFetchMs: Math.round(tFetch),
        tParseMs: Math.round(tParse),
        bytes: ab.byteLength,
        matcapDisplay: mc ? getComputedStyle(mc).display : '?',
        mainDisplay: mv ? getComputedStyle(mv).display : '?',
        lightText: document.getElementById('btn-toggle-light')?.innerText || '?',
        logs: (window.errorLogs || []).slice(-15)
      };
    });
    console.log('info', JSON.stringify(info));
    out.info = info;
    await page.screenshot({ path: path.join(runDir, 'F_pbrPreview_natural.png') });
    await page.click('#btn-toggle-light');
    await page.waitForTimeout(2000);
    out.studio = await page.evaluate(() => ({
      lightText: document.getElementById('btn-toggle-light')?.innerText,
      exposure: document.getElementById('main-viewer')?.getAttribute('exposure'),
      matcapDisplay: getComputedStyle(document.getElementById('matcap-canvas')).display,
      mainDisplay: getComputedStyle(document.getElementById('main-viewer')).display
    }));
    await page.screenshot({ path: path.join(runDir, 'F_pbrPreview_studio.png') });
    console.log('studio', JSON.stringify(out.studio));
  } catch (e) {
    out.fail = e.message;
    console.log('FAIL', e.message);
    await page.screenshot({ path: path.join(runDir, 'F_pbrPreview_fail.png') }).catch(() => {});
  }
  fs.writeFileSync(path.join(runDir, 'summary_F.json'), JSON.stringify(out, null, 2));
  await browser.close();
  server.close();
  console.log('DONE_F');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
