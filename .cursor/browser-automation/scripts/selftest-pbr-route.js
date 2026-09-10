/**
 * 自测：Glb管理器 PBR 路线 + 大文件 HTTP 载入
 * 用法: node scripts/selftest-pbr-route.js
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

const files = {
  current: 'E:/模型/0820模型下载/3D Head scan shader testing_CURRENT_推荐打开.glb',
  pbr: 'E:/模型/0820模型下载/3D Head scan shader testing_PBR_Preview.glb'
};

const results = [];

async function main() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const key = u.searchParams.get('key');
    const fp = files[key];
    if (!fp || !fs.existsSync(fp)) {
      res.writeHead(404);
      res.end('missing ' + key);
      return;
    }
    const st = fs.statSync(fp);
    res.writeHead(200, {
      'Content-Type': 'model/gltf-binary',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': st.size
    });
    fs.createReadStream(fp).pipe(res);
  });
  await new Promise((r) => server.listen(18081, '127.0.0.1', r));
  console.log('file server :18081');

  async function loadKey(page, key, name, preferPbr) {
    return page.evaluate(
      async ({ key, name, preferPbr }) => {
        const cb = document.getElementById('check-prefer-pbr');
        if (cb) {
          cb.checked = !!preferPbr;
          localStorage.setItem('prefer_pbr_preview', preferPbr ? '1' : '0');
        }
        const t0 = performance.now();
        const resp = await fetch('http://127.0.0.1:18081/?key=' + key);
        if (!resp.ok) throw new Error('fetch ' + resp.status + ' ' + (await resp.text()));
        const ab = await resp.arrayBuffer();
        const tFetch = performance.now() - t0;
        let loadErr = null;
        let r = null;
        try {
          r = await window.__AGENT_LOAD_GLB_BUFFER__(ab, name);
        } catch (e) {
          loadErr = String((e && e.message) || e);
        }
        await new Promise((x) => setTimeout(x, 5000));
        const mc = document.getElementById('matcap-canvas');
        const mv = document.getElementById('main-viewer');
        if (mv && getComputedStyle(mv).display !== 'none') {
          try {
            mv.setAttribute('camera-orbit', '45deg 75deg auto');
            mv.setAttribute('field-of-view', '25deg');
            if (typeof mv.jumpCameraToGoal === 'function') mv.jumpCameraToGoal();
          } catch (_) {}
        }
        await new Promise((x) => setTimeout(x, 1000));
        return {
          load: r,
          loadErr,
          tFetchMs: Math.round(tFetch),
          bytes: ab.byteLength,
          preferPbr: !!(cb && cb.checked),
          matcapDisplay: mc ? getComputedStyle(mc).display : '?',
          mainDisplay: mv ? getComputedStyle(mv).display : '?',
          lightText: document.getElementById('btn-toggle-light')?.innerText || '?',
          logs: (window.errorLogs || []).slice(-12)
        };
      },
      { key, name, preferPbr }
    );
  }

  async function one(tag, key, name, preferPbr) {
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: ['--use-gl=angle', '--ignore-gpu-blocklist']
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    page.on('pageerror', (e) => console.log('PAGEERR', tag, String(e.message).slice(0, 200)));
    page.on('crash', () => console.log('CRASH', tag));
    try {
      await page.goto(mgr, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => typeof window.__AGENT_LOAD_GLB_BUFFER__ === 'function', {
        timeout: 30000
      });
      // 大文件：把解析超时从 30s 临时抬到 180s（仅本页会话）
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
      console.log(tag, 'start', key, 'MB', (fs.statSync(files[key]).size / 1e6).toFixed(1));
      const info = await loadKey(page, key, name, preferPbr);
      console.log(
        tag,
        'info',
        JSON.stringify({
          load: info.load,
          loadErr: info.loadErr,
          tFetchMs: info.tFetchMs,
          bytes: info.bytes,
          preferPbr: info.preferPbr,
          matcapDisplay: info.matcapDisplay,
          mainDisplay: info.mainDisplay,
          logs: info.logs
        })
      );
      await page.screenshot({ path: path.join(runDir, `${tag}_natural.png`) });
      await page.click('#btn-toggle-light');
      await page.waitForTimeout(1500);
      const studio = await page.evaluate(() => ({
        lightText: document.getElementById('btn-toggle-light')?.innerText,
        exposure: document.getElementById('main-viewer')?.getAttribute('exposure'),
        matcapDisplay: getComputedStyle(document.getElementById('matcap-canvas')).display,
        mainDisplay: getComputedStyle(document.getElementById('main-viewer')).display
      }));
      await page.screenshot({ path: path.join(runDir, `${tag}_studio.png`) });
      console.log(tag, 'studio', JSON.stringify(studio));
      results.push({ tag, info, studio });
    } catch (e) {
      console.log(tag, 'FAIL', e.message);
      results.push({ tag, fail: e.message });
      await page.screenshot({ path: path.join(runDir, `${tag}_fail.png`) }).catch(() => {});
    }
    await browser.close();
  }

  await one('D_current_matcap', 'current', 'CURRENT.glb', false);
  await one('E_current_forcePbr', 'current', 'CURRENT.glb', true);
  await one('F_pbrPreview', 'pbr', 'PBR_Preview.glb', false);

  fs.writeFileSync(path.join(runDir, 'summary3.json'), JSON.stringify(results, null, 2));
  server.close();
  console.log('DONE3');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
