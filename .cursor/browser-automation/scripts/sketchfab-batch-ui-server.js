/**
 * Sketchfab 批量下载 — 本地网页控制台
 * 启动：npm run sketchfab:ui
 * 浏览器打开：http://127.0.0.1:18999/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const batch = require('./sketchfab-batch-download.js');

const PORT = process.env.SKETCHFAB_UI_PORT ? Number(process.env.SKETCHFAB_UI_PORT) : 18999;
const uiHtml = path.join(batch.baRoot, 'ui', 'sketchfab-batch.html');
const listFile = batch.defaultList;

const state = {
  mode: 'idle', // idle | login | running | stopping
  outDir: batch.defaultOutDir,
  timeoutMs: 480000,
  urlsText: '',
  currentIndex: -1,
  items: [],
  results: [],
  logs: [],
  loginPending: false,
  lastError: null,
  startedAt: null,
  finishedAt: null
};

let abortFlag = false;
let loginResolve = null;
let busyContext = null;
const sseClients = new Set();

function pushLog(level, message, extra) {
  const entry = {
    t: new Date().toLocaleTimeString(),
    level: level || 'info',
    message: String(message || ''),
    extra: extra || null
  };
  state.logs.push(entry);
  if (state.logs.length > 500) state.logs.splice(0, state.logs.length - 500);
  broadcast({ type: 'log', entry, state: publicState() });
}

function publicState() {
  return {
    mode: state.mode,
    outDir: state.outDir,
    timeoutMs: state.timeoutMs,
    urlsText: state.urlsText,
    currentIndex: state.currentIndex,
    items: state.items.map((it, i) => ({
      id: it.id,
      raw: it.raw,
      status: state.results[i]
        ? (state.results[i].ok ? 'ok' : 'fail')
        : (i === state.currentIndex && state.mode === 'running' ? 'running' : 'pending'),
      result: state.results[i] || null
    })),
    results: state.results,
    loginPending: state.loginPending,
    lastError: state.lastError,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    okCount: state.results.filter((r) => r && r.ok).length,
    failCount: state.results.filter((r) => r && !r.ok).length,
    total: state.items.length
  };
}

function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch (_e) { sseClients.delete(res); }
  }
}

function loadDefaultUrls() {
  try {
    if (fs.existsSync(listFile)) {
      state.urlsText = fs.readFileSync(listFile, 'utf8');
    }
  } catch (_e) {}
}

function saveUrlsToDisk(text) {
  batch.ensureDir(path.dirname(listFile));
  fs.writeFileSync(listFile, text, 'utf8');
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 2e6) reject(new Error('body too large')); });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function runLoginFlow() {
  if (state.mode !== 'idle') throw new Error('当前有任务在跑，请先停止或等结束');
  state.mode = 'login';
  state.loginPending = true;
  state.lastError = null;
  pushLog('info', '正在打开 Chrome 登录页…');
  broadcast({ type: 'state', state: publicState() });

  const context = await batch.launchContext({ out: state.outDir, timeout: state.timeoutMs, headed: true });
  busyContext = context;
  const page = await context.newPage();
  await page.goto('https://sketchfab.com/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
  pushLog('success', '请在弹出的 Chrome 里登录 Sketchfab，然后回到本页点「我已登录完成」');

  await new Promise((resolve) => { loginResolve = resolve; });
  loginResolve = null;
  state.loginPending = false;
  await page.close().catch(() => {});
  await context.close().catch(() => {});
  busyContext = null;
  state.mode = 'idle';
  pushLog('success', '登录流程结束，登录态已写入本地档案');
  broadcast({ type: 'state', state: publicState() });
}

async function runBatchFlow(urlsText) {
  if (state.mode !== 'idle') throw new Error('当前有任务在跑');
  const parsed = batch.parseUrlLines(urlsText);
  if (!parsed.items.length) throw new Error('没有可识别的模型链接');
  if (parsed.skipped.length) {
    pushLog('warn', `有 ${parsed.skipped.length} 行无法解析，已跳过`);
  }

  abortFlag = false;
  state.mode = 'running';
  state.urlsText = urlsText;
  state.items = parsed.items;
  state.results = [];
  state.currentIndex = -1;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.lastError = null;
  saveUrlsToDisk(urlsText);
  pushLog('info', `开始批量下载，共 ${parsed.items.length} 个 → ${state.outDir}`);
  broadcast({ type: 'state', state: publicState() });

  const userscript = batch.loadUserscriptSource(batch.defaultScript);
  const context = await batch.launchContext({ out: state.outDir, timeout: state.timeoutMs, headed: true });
  busyContext = context;

  try {
    for (let i = 0; i < parsed.items.length; i++) {
      if (abortFlag) {
        pushLog('warn', '用户请求停止，后续任务取消');
        break;
      }
      state.currentIndex = i;
      const item = parsed.items[i];
      pushLog('info', `(${i + 1}/${parsed.items.length}) 开始：${item.id}`);
      broadcast({ type: 'state', state: publicState() });

      const result = await batch.downloadOne(
        context,
        item,
        { out: state.outDir, timeout: state.timeoutMs, headed: true },
        userscript,
        {
          shouldAbort: () => abortFlag,
          onProgress: (p) => {
            pushLog('info', `[${item.id}] ${p.message}`);
            broadcast({ type: 'progress', id: item.id, index: i, progress: p, state: publicState() });
          }
        }
      );
      state.results[i] = result;
      pushLog(result.ok ? 'success' : 'error', result.ok
        ? `完成：${path.basename(result.file || '')}`
        : `失败：${result.error || 'unknown'}`);
      broadcast({ type: 'state', state: publicState() });
    }
  } catch (e) {
    state.lastError = e.message || String(e);
    pushLog('error', state.lastError);
  } finally {
    await context.close().catch(() => {});
    busyContext = null;
    state.mode = 'idle';
    state.currentIndex = -1;
    state.finishedAt = new Date().toISOString();
    abortFlag = false;
    const ok = state.results.filter((r) => r && r.ok).length;
    const fail = state.results.filter((r) => r && !r.ok).length;
    pushLog('success', `全部结束：成功 ${ok}，失败 ${fail}`);
    try {
      const reportPath = path.join(state.outDir, `_batch_report_${Date.now()}.json`);
      fs.writeFileSync(reportPath, JSON.stringify({ when: state.finishedAt, results: state.results }, null, 2));
      pushLog('info', `报告已写：${reportPath}`);
    } catch (_e) {}
    broadcast({ type: 'state', state: publicState() });
  }
}

function openBrowser(url) {
  const plat = process.platform;
  if (plat === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true });
  else if (plat === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true });
  else spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
}

async function handler(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  if (p === '/' || p === '/index.html') {
    const html = fs.readFileSync(uiHtml, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (p === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write(`data: ${JSON.stringify({ type: 'hello', state: publicState(), logs: state.logs.slice(-80) })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (p === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, { state: publicState(), logs: state.logs.slice(-120) });
    return;
  }

  if (p === '/api/config' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      if (typeof body.outDir === 'string' && body.outDir.trim()) state.outDir = body.outDir.trim();
      if (body.timeoutMs) state.timeoutMs = Number(body.timeoutMs) || state.timeoutMs;
      if (typeof body.urlsText === 'string') {
        state.urlsText = body.urlsText;
        saveUrlsToDisk(body.urlsText);
      }
      pushLog('info', '已保存页面配置');
      sendJson(res, 200, { ok: true, state: publicState() });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (p === '/api/login/start' && req.method === 'POST') {
    if (state.mode !== 'idle') return sendJson(res, 409, { ok: false, error: '忙' });
    runLoginFlow().catch((e) => {
      state.mode = 'idle';
      state.loginPending = false;
      state.lastError = e.message || String(e);
      pushLog('error', state.lastError);
      broadcast({ type: 'state', state: publicState() });
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (p === '/api/login/done' && req.method === 'POST') {
    if (loginResolve) loginResolve();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (p === '/api/start' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      if (typeof body.urlsText === 'string') state.urlsText = body.urlsText;
      if (typeof body.outDir === 'string' && body.outDir.trim()) state.outDir = body.outDir.trim();
      if (body.timeoutMs) state.timeoutMs = Number(body.timeoutMs) || state.timeoutMs;
      if (state.mode !== 'idle') return sendJson(res, 409, { ok: false, error: '已有任务在运行' });
      runBatchFlow(state.urlsText).catch((e) => {
        state.lastError = e.message || String(e);
        pushLog('error', state.lastError);
        state.mode = 'idle';
        broadcast({ type: 'state', state: publicState() });
      });
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (p === '/api/stop' && req.method === 'POST') {
    abortFlag = true;
    state.mode = state.mode === 'running' ? 'stopping' : state.mode;
    pushLog('warn', '正在停止（当前模型结束后生效）…');
    if (loginResolve) loginResolve();
    broadcast({ type: 'state', state: publicState() });
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

loadDefaultUrls();
const server = http.createServer((req, res) => {
  handler(req, res).catch((e) => {
    console.error(e);
    try { sendJson(res, 500, { error: e.message || String(e) }); } catch (_e) {}
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`Sketchfab 批量下载控制台：${url}`);
  openBrowser(url);
});
