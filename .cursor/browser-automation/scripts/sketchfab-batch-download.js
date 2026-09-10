/**
 * Sketchfab 批量 GLB 下载（可复用）
 *
 * 做法：用 Playwright 打开纯净 embed 页，注入仓库内篡改猴脚本逻辑，
 * 等自动贴图+自动导出，把 GLB 存到指定目录。
 *
 * 用法示例：
 *   cd .cursor/browser-automation
 *   npm run sketchfab:login
 *   npm run sketchfab:batch -- --list lists/sketchfab-urls.txt
 *
 * 环境变量 / 参数：
 *   --list <file>     URL 列表（每行一个，# 开头为注释）
 *   --out <dir>       下载目录，默认 E:\模型\0820模型下载
 *   --timeout <ms>    单模型超时，默认 480000（8 分钟）
 *   --headed          有界面（默认）
 *   --headless        无界面（WebGL/登录可能不稳）
 *   --login           只打开 Sketchfab 登录，方便写入持久档案
 *   --script <path>   篡改猴脚本路径（默认仓库内最新版）
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');

const baRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(baRoot, '..', '..');
const defaultOutDir = 'E:\\模型\\0820模型下载';
const defaultList = path.join(baRoot, 'lists', 'sketchfab-urls.txt');
const defaultScript = path.join(repoRoot, '自用工具文件_不部署', '篡改猴', '篡改猴Sketchfab.js');
const profileDir = path.join(baRoot, 'chrome-profile-sketchfab');

function parseArgs(argv) {
  const opts = {
    list: defaultList,
    out: defaultOutDir,
    timeout: 480000,
    headed: true,
    login: false,
    script: defaultScript,
    urls: []
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') opts.list = path.resolve(argv[++i]);
    else if (a === '--out') opts.out = path.resolve(argv[++i]);
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--script') opts.script = path.resolve(argv[++i]);
    else if (a === '--url') opts.urls.push(argv[++i]);
    else if (a === '--headed') opts.headed = true;
    else if (a === '--headless') opts.headed = false;
    else if (a === '--login') opts.login = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

function extractModelId(urlOrId) {
  const s = String(urlOrId || '').trim();
  if (!s) return null;
  if (/^[a-f0-9]{32}$/i.test(s)) return s.toLowerCase();
  const m = s.match(/([a-f0-9]{32})(?:\/|$|\?|#)/i) || s.match(/([a-f0-9]{32})/i);
  return m ? m[1].toLowerCase() : null;
}

function toEmbedUrl(modelId) {
  return `https://sketchfab.com/models/${modelId}/embed?autostart=1&internal=1&tracking=0&ui_ar=0&ui_infos=0&ui_snapshots=1&ui_stop=0&ui_theatre=1&ui_watermark=0`;
}

function readUrlList(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`URL 列表不存在: ${filePath}`);
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const items = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const id = extractModelId(t);
    if (!id) {
      console.warn('[skip] 无法解析模型 ID:', t);
      continue;
    }
    items.push({ raw: t, id, embed: toEmbedUrl(id) });
  }
  return items;
}

function loadUserscriptSource(scriptPath) {
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`篡改猴脚本不存在: ${scriptPath}`);
  }
  let src = fs.readFileSync(scriptPath, 'utf8');
  src = src.replace(/\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==\s*/, '');
  // Playwright 注入：与篡改猴一致直接执行，勿再包 IIFE（脚本末尾已有 })(); 闭包）
  return `
try {
  if (typeof unsafeWindow === 'undefined') {
    window.unsafeWindow = window;
  } else if (!window.unsafeWindow) {
    window.unsafeWindow = unsafeWindow;
  }
} catch (e) {
  window.unsafeWindow = window;
}
// Playwright route 已补丁 viewer JS；禁止篡改猴再 preventDefault+同步 XHR 替换，否则会冲掉 route 补丁或导出空壳。
try { window._sf_viewer_patched = true; } catch (_e) {}
try { window._sf_route_mesh_patch = true; } catch (_e) {}
${src}
`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function glbMeshCount(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 20 || buf.toString('utf8', 0, 4) !== 'glTF') return 0;
    const jsonLen = buf.readUInt32LE(12);
    const json = buf.slice(20, 20 + jsonLen).toString('utf8');
    const parsed = JSON.parse(json);
    return Array.isArray(parsed.meshes) ? parsed.meshes.length : 0;
  } catch (_e) {
    return 0;
  }
}

function uniquePath(dir, filename) {
  const safe = String(filename || 'sketchfab_extracted.glb').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  let full = path.join(dir, safe);
  if (!fs.existsSync(full)) return full;
  const ext = path.extname(safe);
  const base = path.basename(safe, ext);
  for (let i = 2; i < 1000; i++) {
    full = path.join(dir, `${base}_${i}${ext}`);
    if (!fs.existsSync(full)) return full;
  }
  return path.join(dir, `${base}_${Date.now()}${ext}`);
}

async function askEnter(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question(promptText, () => resolve()));
  rl.close();
}

function resolveTampermonkeyExtensionPath() {
  // 优先用自动化档案内已同步的篡改猴；否则回退本机 Chrome Profile 1/8
  const candidates = [];
  const localExtRoot = path.join(profileDir, 'Default', 'Extensions', 'dhdgffkkebhmkfjojejmpbldmpobfkfo');
  if (fs.existsSync(localExtRoot)) {
    const vers = fs.readdirSync(localExtRoot).filter((d) => fs.statSync(path.join(localExtRoot, d)).isDirectory());
    vers.sort();
    if (vers.length) candidates.push(path.join(localExtRoot, vers[vers.length - 1]));
  }
  const chromeUserData = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data')
    : '';
  for (const prof of ['Profile 1', 'Profile 8']) {
    const root = path.join(chromeUserData, prof, 'Extensions', 'dhdgffkkebhmkfjojejmpbldmpobfkfo');
    if (!fs.existsSync(root)) continue;
    const vers = fs.readdirSync(root).filter((d) => fs.statSync(path.join(root, d)).isDirectory());
    vers.sort();
    if (vers.length) candidates.push(path.join(root, vers[vers.length - 1]));
  }
  return candidates.find((p) => fs.existsSync(path.join(p, 'manifest.json'))) || null;
}

async function launchContext(opts) {
  ensureDir(profileDir);
  ensureDir(opts.out);
  // Playwright 默认带 --disable-extensions，会导致档案里的篡改猴不加载。
  // 这里显式放开扩展，并 --load-extension 挂上篡改猴（与人工浏览器一致）。
  const tmExt = resolveTampermonkeyExtensionPath();
  opts.tampermonkeyExtensionPath = tmExt || null;
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--autoplay-policy=no-user-gesture-required'
  ];
  // 本机 Clash 等代理（SKETCHFAB_PROXY / HTTPS_PROXY 可覆盖）
  const proxy = process.env.SKETCHFAB_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7897';
  if (proxy) {
    const server = String(proxy).replace(/^https?:\/\//i, '');
    args.push('--proxy-server=' + server);
    console.log('代理:', proxy);
  }
  if (tmExt) {
    args.push(`--disable-extensions-except=${tmExt}`);
    args.push(`--load-extension=${tmExt}`);
    console.log('篡改猴扩展已挂载:', tmExt);
  } else {
    console.log('警告: 未找到篡改猴扩展目录；仍会注入仓库脚本');
  }
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: !opts.headed,
    acceptDownloads: true,
    downloadsPath: opts.out,
    viewport: { width: 1400, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args
  });
  // 下载统一落到目标目录
  try {
    await context.setDefaultTimeout(opts.timeout);
  } catch (_e) {}
  return context;
}

async function waitForGlbDownload(page, outDir, timeoutMs) {
  const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs });
  const download = await downloadPromise;
  const suggested = download.suggestedFilename() || `sketchfab_${Date.now()}.glb`;
  const target = uniquePath(outDir, suggested);
  const fail = await download.failure();
  if (fail) throw new Error('download_failed: ' + fail);

  // 优先用流写入，避免 saveAs 依赖仍打开的 page/context
  const stream = await download.createReadStream();
  if (stream) {
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(target);
      stream.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
      stream.on('error', reject);
    });
    return { target, suggested };
  }

  // 回退：临时路径 / saveAs
  const tmp = await download.path().catch(() => null);
  if (tmp && fs.existsSync(tmp)) {
    fs.copyFileSync(tmp, target);
    return { target, suggested };
  }
  await download.saveAs(target);
  return { target, suggested };
}

async function tryForceExport(page) {
  return page.evaluate(() => {
    const flags = window._sf_flags || {};
    const n = (window.allmodel && window.allmodel.length) || 0;
    const texN = window.objects ? Object.keys(window.objects).filter((k) => k.indexOf('tex_catch_') !== 0).length : 0;
    if (typeof window._sf_doDownload === 'function' && n > 0) {
      try { window._sf_doDownload(); return { ok: true, n, texN, flags }; } catch (e) {
        return { ok: false, error: String(e && e.message || e), n, texN, flags };
      }
    }
    return { ok: false, error: 'no_download_or_empty_mesh', n, texN, flags };
  });
}

async function downloadOne(context, item, opts, userscript, hooks = {}) {
  const onProgress = typeof hooks.onProgress === 'function' ? hooks.onProgress : () => {};
  const shouldAbort = typeof hooks.shouldAbort === 'function' ? hooks.shouldAbort : () => false;
  const page = await context.newPage();
  const started = Date.now();
  const result = { id: item.id, raw: item.raw, ok: false, file: null, error: null, ms: 0, shot: null };

  try {
    // 仓库篡改猴脚本始终注入（与扩展内脚本同源）；扩展负责 document-start 级环境，
    // 另用 route 补丁 viewer JS，避免 MutationObserver 漏拦导致 mesh=0。
    await page.addInitScript({ content: userscript });
    await page.route(/sketchfab\.com\/.*\.(js)(\?|$)/i, async (route) => {
      const req = route.request();
      const url = req.url();
      if (!(url.includes('web/dist/') || url.includes('standaloneViewer') || url.includes('web/dist'))) {
        return route.continue();
      }
      try {
        const resp = await route.fetch();
        let body = await resp.text();
        if (!body || body.indexOf('drawGeometry') < 0) {
          return route.fulfill({ response: resp, body });
        }
        let mode = 'none';
        const wrapper = /drawGeometry\s*:\s*function\s*\(\s*([a-zA-Z0-9_$]+)\s*\)\s*\{\s*this\._stateCache\.drawGeometry\(this\._graphicContext,\s*\1\s*\)/g;
        const stateCache = /(this\._stateCache\.drawGeometry\(this\._graphicContext,\s*([a-zA-Z0-9_]+)\))/g;
        if (wrapper.test(body)) {
          wrapper.lastIndex = 0;
          body = body.replace(wrapper, 'drawGeometry:function($1){try{window.attachbody&&window.attachbody($1);}catch(e){}this._stateCache.drawGeometry(this._graphicContext,$1)');
          mode = 'drawGeometryWrapper';
        } else if (stateCache.test(body)) {
          stateCache.lastIndex = 0;
          body = body.replace(stateCache, '(window.attachbody&&window.attachbody($2),$1)');
          mode = 'stateCache';
        }
        if (mode !== 'none') {
          console.log(`  route补丁 viewer JS: ${mode}`);
        }
        const headers = { ...resp.headers() };
        delete headers['content-encoding'];
        delete headers['content-length'];
        return route.fulfill({ status: resp.status(), headers, body });
      } catch (_e) {
        return route.continue();
      }
    });

    onProgress({ phase: 'open', message: `打开 embed：${item.id}` });
    console.log(`\n=== [${item.id}] 打开 embed ===`);
    console.log(item.embed);

    let downloadWait = waitForGlbDownload(page, opts.out, opts.timeout);
    // goto 失败时避免未处理的 download 监听拒绝把进程打崩
    downloadWait = downloadWait.catch((err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      e.message = `download_wait: ${e.message}`;
      throw e;
    });
    try {
      await page.goto(item.embed, { waitUntil: 'domcontentloaded', timeout: 120000 });
    } catch (gotoErr) {
      // 一次重试（Sketchfab 偶发超时）
      console.log(`\n  ⚠ goto 失败，2s 后重试: ${gotoErr.message || gotoErr}`);
      await new Promise((r) => setTimeout(r, 2000));
      await page.goto(item.embed, { waitUntil: 'domcontentloaded', timeout: 180000 });
    }

    const pollUntil = Date.now() + Math.min(opts.timeout - 15000, opts.timeout);
    let forced = false;
    while (Date.now() < pollUntil) {
      if (shouldAbort()) {
        result.error = '用户停止';
        onProgress({ phase: 'abort', message: '已停止' });
        break;
      }
      const st = await page.evaluate(() => {
        const rootDoc = (() => { try { return window.top.document; } catch (e) { return document; } })();
        const flags = window._sf_flags || {};
        const logs = (rootDoc && rootDoc.getElementById('sf-diag-logs'))
          ? rootDoc.getElementById('sf-diag-logs').innerText.slice(-800)
          : '';
        return {
          panel: !!(rootDoc && rootDoc.getElementById('sf-diag-panel')),
          meshReady: !!flags.meshReady,
          texturesReady: !!flags.texturesReady,
          autoExportTriggered: !!flags.autoExportTriggered,
          isDumping: !!window.isDumping,
          models: (window.allmodel && window.allmodel.length) || 0,
          textures: window.objects ? Object.keys(window.objects).length : 0,
          tail: logs
        };
      }).catch(() => null);

      if (st) {
        onProgress({ phase: 'poll', message: `网格 ${st.models} · 贴图 ${st.textures}${st.texturesReady ? '（贴图就绪）' : ''}${st.autoExportTriggered ? ' · 导出中' : ''}`, detail: st });
        process.stdout.write(
          `\r  panel=${st.panel} mesh=${st.meshReady}/${st.models} tex=${st.texturesReady}/${st.textures} auto=${st.autoExportTriggered}   `
        );
        // 贴图自动抓取卡住时，主动触发 dump（避免只停在 Spec/SSS）
        if (!st.texturesReady && !st.isDumping && st.models > 0 && Date.now() - started > 25000) {
          const kicked = await page.evaluate(() => {
            if (window._sf_flags && window._sf_flags.texturesReady) return 'already';
            if (window.isDumping) return 'dumping';
            const btn = document.getElementById('sf-btn-tex');
            if (btn && typeof btn.onclick === 'function') {
              try { btn.onclick(); return 'clicked'; } catch (_e) {}
            }
            if (typeof window.dumpWebGLTextureData === 'function') {
              try { window.dumpWebGLTextureData(); return 'dump_fn'; } catch (_e) {}
            }
            return 'none';
          }).catch(() => 'err');
          if (kicked === 'clicked' || kicked === 'dump_fn') {
            console.log(`\n  → 主动触发贴图抓取: ${kicked}`);
            onProgress({ phase: 'dump', message: `主动触发贴图抓取 (${kicked})` });
          }
        }
        if (!forced && st.texturesReady && st.models > 0 && !st.autoExportTriggered) {
          onProgress({ phase: 'force', message: '贴图就绪，尝试强制导出' });
          console.log('\n  → 贴图已就绪但未自动导出，尝试强制 _sf_doDownload');
          const fr = await tryForceExport(page);
          console.log('  force:', JSON.stringify(fr));
          forced = true;
        }
        // 保底：接近单模型超时才强导；且至少要有较完整贴图池（>=4）或已 texturesReady
        const nearTimeout = Date.now() - started > Math.max(240000, opts.timeout - 60000);
        if (!forced && nearTimeout && st.models > 0 && !st.autoExportTriggered && (st.texturesReady || st.textures >= 4)) {
          onProgress({ phase: 'force', message: '接近超时，保底强制导出' });
          console.log('\n  → 接近超时保底强制导出');
          await tryForceExport(page);
          forced = true;
        }
      }
      const raced = await Promise.race([
        downloadWait.then(
          (d) => ({ type: 'download', d }),
          (err) => ({ type: 'download_err', err })
        ),
        new Promise((r) => setTimeout(() => r({ type: 'tick' }), 2000))
      ]);
      if (raced.type === 'download_err') {
        console.log(`\n  ⚠ 下载事件失败: ${raced.err && raced.err.message || raced.err}`);
        downloadWait = waitForGlbDownload(page, opts.out, Math.max(30000, opts.timeout - (Date.now() - started)));
        if (!forced && st && st.models > 0) {
          await tryForceExport(page).catch(() => {});
          forced = true;
        }
        continue;
      }
      if (raced.type === 'download') {
        const meshN = glbMeshCount(raced.d.target);
        if (meshN <= 0) {
          console.log(`\n  ⚠ 下载文件无网格 (meshes=0)，丢弃并继续等待: ${raced.d.target}`);
          try { fs.unlinkSync(raced.d.target); } catch (_e) {}
          // 重新挂下载监听
          downloadWait = waitForGlbDownload(page, opts.out, Math.max(30000, opts.timeout - (Date.now() - started)));
          continue;
        }
        result.ok = true;
        result.file = raced.d.target;
        onProgress({ phase: 'done', message: `已保存 ${path.basename(result.file)}`, file: result.file });
        console.log(`\n  ✅ 已保存: ${result.file} (meshes=${meshN})`);
        break;
      }
    }

    if (!result.ok && !shouldAbort()) {
      try {
        const d = await downloadWait;
        const meshN = glbMeshCount(d.target);
        if (meshN <= 0) {
          try { fs.unlinkSync(d.target); } catch (_e) {}
          throw new Error('downloaded_glb_has_no_meshes');
        }
        result.ok = true;
        result.file = d.target;
        onProgress({ phase: 'done', message: `已保存 ${path.basename(result.file)}`, file: result.file });
        console.log(`\n  ✅ 已保存: ${result.file} (meshes=${meshN})`);
      } catch (e) {
        result.error = e.message || String(e);
        const shotDir = path.join(baRoot, 'runs', `sketchfab-batch-${new Date().toISOString().slice(0, 10)}`);
        ensureDir(shotDir);
        const shot = path.join(shotDir, `${item.id}_fail.png`);
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        result.shot = shot;
        onProgress({ phase: 'fail', message: result.error, shot });
        console.log(`\n  ❌ 失败: ${result.error}`);
        console.log(`  截图: ${shot}`);
      }
    }
  } catch (e) {
    result.error = e.message || String(e);
    onProgress({ phase: 'fail', message: result.error });
    console.log(`\n  ❌ 异常: ${result.error}`);
  } finally {
    result.ms = Date.now() - started;
    // 稍等下载收尾，避免大 GLB 仍在落盘时关页导致 saveAs 失败
    await new Promise((r) => setTimeout(r, result.ok ? 1500 : 300));
    await page.close().catch(() => {});
  }
  return result;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 25).join('\n'));
    return;
  }

  console.log('脚本:', opts.script);
  console.log('档案:', profileDir);
  console.log('输出:', opts.out);

  const userscript = loadUserscriptSource(opts.script);
  const context = await launchContext(opts);

  try {
    if (opts.login) {
      const page = await context.newPage();
      await page.goto('https://sketchfab.com/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
      console.log('\n请在打开的浏览器中登录 Sketchfab。');
      console.log('登录完成后回到终端按回车继续（档案会保留登录态）。\n');
      await askEnter('登录完成？按回车关闭… ');
      await page.close().catch(() => {});
      return;
    }

    let items;
    if (opts.urls && opts.urls.length) {
      items = opts.urls.map((u) => {
        const id = extractModelId(u);
        if (!id) throw new Error('无法解析 --url: ' + u);
        return { raw: u, id, embed: toEmbedUrl(id) };
      });
    } else {
      items = readUrlList(opts.list);
    }
    if (!items.length) throw new Error('URL 列表为空');
    console.log(`待下载 ${items.length} 个模型`);

    const report = [];
    for (let i = 0; i < items.length; i++) {
      console.log(`\n######## ${i + 1}/${items.length} ########`);
      const r = await downloadOne(context, items[i], opts, userscript);
      report.push(r);
    }

    const ok = report.filter((r) => r.ok).length;
    const fail = report.length - ok;
    console.log('\n========== 汇总 ==========');
    report.forEach((r) => {
      console.log(`${r.ok ? 'OK' : 'FAIL'}  ${r.id}  ${r.file || r.error || ''}  (${Math.round(r.ms / 1000)}s)`);
    });
    console.log(`成功 ${ok} / 失败 ${fail}`);

    const reportPath = path.join(opts.out, `_batch_report_${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({ when: new Date().toISOString(), opts: { list: opts.list, out: opts.out }, report }, null, 2));
    console.log('报告:', reportPath);

    if (fail) process.exitCode = 2;
  } finally {
    await context.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {
  extractModelId,
  toEmbedUrl,
  readUrlList,
  loadUserscriptSource,
  launchContext,
  downloadOne,
  parseUrlLines,
  defaultOutDir,
  defaultList,
  defaultScript,
  profileDir,
  baRoot,
  ensureDir
};

function parseUrlLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  const items = [];
  const skipped = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const id = extractModelId(t);
    if (!id) {
      skipped.push(t);
      continue;
    }
    items.push({ raw: t, id, embed: toEmbedUrl(id) });
  }
  return { items, skipped };
}