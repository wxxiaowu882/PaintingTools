const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;

const HISTORY_DIR = path.join(
  repoRoot,
  '自用工具文件_不部署',
  'GNM头模工坊',
  'align-overlay',
  'landmarks',
  'history'
);
const HISTORY_INDEX = path.join(HISTORY_DIR, 'index.json');

const PARAM_LABELS_PATH = path.join(
  repoRoot,
  '自用工具文件_不部署',
  'GNM头模工坊',
  'data',
  'param-labels.json'
);
const PARAM_LABELS_BACKUP_DIR = path.join(
  repoRoot,
  '自用工具文件_不部署',
  'GNM头模工坊',
  'data',
  'param-labels-backups'
);
const CUSTOM_IDENTITIES_PATH = path.join(
  repoRoot,
  '自用工具文件_不部署',
  'GNM头模工坊',
  'data',
  'custom-identities.json'
);
const CUSTOM_IDENTITIES_BACKUP_DIR = path.join(
  repoRoot,
  '自用工具文件_不部署',
  'GNM头模工坊',
  'data',
  'custom-identities-backups'
);
const PARAM_FAVORITES_PATH = path.join(
  repoRoot,
  '自用工具文件_不部署',
  'GNM头模工坊',
  'data',
  'param-favorites.json'
);
const PARAM_FAVORITES_BACKUP_DIR = path.join(
  repoRoot,
  '自用工具文件_不部署',
  'GNM头模工坊',
  'data',
  'param-favorites-backups'
);
const IDENTITY_TAXONOMY_PATH = path.join(
  repoRoot,
  '自用工具文件_不部署',
  'GNM头模工坊',
  'data',
  'identity-taxonomy.json'
);
const IDENTITY_TAXONOMY_BACKUP_DIR = path.join(
  repoRoot,
  '自用工具文件_不部署',
  'GNM头模工坊',
  'data',
  'identity-taxonomy-backups'
);
const GLB_DIR_HISTORY_PATH = path.join(
  repoRoot,
  '自用工具文件_不部署',
  'GBL管理器',
  'data',
  'dir-history.json'
);
const GLB_DIR_HISTORY_BACKUP_DIR = path.join(
  repoRoot,
  '自用工具文件_不部署',
  'GBL管理器',
  'data',
  'dir-history-backups'
);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.md': 'text/markdown; charset=utf-8',
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function resolvePath(urlPath) {
  let pathname = decodeURIComponent((urlPath || '/').split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const cleaned = pathname.replace(/^\/+/, '');
  let absolutePath = path.resolve(repoRoot, cleaned);

  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
    const htmlCandidate = path.join(absolutePath, 'index.html');
    if (fs.existsSync(htmlCandidate)) absolutePath = htmlCandidate;
  } else if (!fs.existsSync(absolutePath) && !path.extname(absolutePath)) {
    const htmlCandidate = `${absolutePath}.html`;
    if (fs.existsSync(htmlCandidate)) absolutePath = htmlCandidate;
  }

  if (!absolutePath.startsWith(repoRoot)) return null;
  return absolutePath;
}

function readIndex() {
  try {
    if (!fs.existsSync(HISTORY_INDEX)) return { version: 1, versions: [] };
    const data = JSON.parse(fs.readFileSync(HISTORY_INDEX, 'utf8'));
    if (!Array.isArray(data.versions)) return { version: 1, versions: [] };
    return data;
  } catch (_) {
    return { version: 1, versions: [] };
  }
}

function writeIndex(data) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_INDEX, JSON.stringify(data, null, 2), 'utf8');
}

function safeHistoryFileName(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safe || `v_${Date.now()}`}.json`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function handleHistoryApi(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET') {
    const index = readIndex();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(index));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    return;
  }

  const body = await readBody(req);
  const action = body.action || 'save';
  fs.mkdirSync(HISTORY_DIR, { recursive: true });

  if (action === 'save') {
    const entry = body.entry;
    if (!entry?.id || !entry?.payload) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'missing entry' }));
      return;
    }
    const file = safeHistoryFileName(entry.id);
    const full = { ...entry, file };
    fs.writeFileSync(path.join(HISTORY_DIR, file), JSON.stringify(full, null, 2), 'utf8');
    const index = readIndex();
    index.versions = (index.versions || []).filter((v) => v.id !== entry.id);
    index.versions.push({
      id: full.id,
      note: full.note || '',
      createdAt: full.createdAt,
      pointCount: full.pointCount,
      preTrsSummary: full.preTrsSummary || '',
      warpSummary: full.warpSummary || '',
      file,
    });
    while (index.versions.length > 40) {
      const old = index.versions.shift();
      if (old?.file) {
        const p = path.join(HISTORY_DIR, old.file);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    }
    writeIndex(index);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, file, index }));
    return;
  }

  if (action === 'delete') {
    const id = body.id;
    const index = readIndex();
    const hit = (index.versions || []).find((v) => v.id === id);
    index.versions = (index.versions || []).filter((v) => v.id !== id);
    if (hit?.file) {
      const p = path.join(HISTORY_DIR, hit.file);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    writeIndex(index);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, index }));
    return;
  }

  res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: `unknown action ${action}` }));
}

function writeWorkshopJsonWithBackup(filePath, backupDir, backupPrefix, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(filePath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(filePath, path.join(backupDir, `${backupPrefix}_${stamp}.json`));
    const backups = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith(`${backupPrefix}_`) && f.endsWith('.json'))
      .sort();
    while (backups.length > 30) {
      const old = backups.shift();
      try {
        fs.unlinkSync(path.join(backupDir, old));
      } catch (_) {}
    }
  }
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

async function handleJsonFileApi(req, res, { filePath, backupDir, backupPrefix, buildPayload }) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'GET') {
    try {
      const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '{}';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(raw);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    return;
  }
  try {
    const body = await readBody(req);
    const payload = buildPayload(body);
    writeWorkshopJsonWithBackup(filePath, backupDir, backupPrefix, payload);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, path: filePath }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: e.message || String(e) }));
  }
}

async function handleParamLabelsApi(req, res) {
  await handleJsonFileApi(req, res, {
    filePath: PARAM_LABELS_PATH,
    backupDir: PARAM_LABELS_BACKUP_DIR,
    backupPrefix: 'param-labels',
    buildPayload: (body) => ({
      kind: 'gnmWorkshopParamLabels',
      version: Number(body.version) || 1,
      updatedAt: new Date().toISOString(),
      identity: body.identity && typeof body.identity === 'object' ? body.identity : {},
      expression: body.expression && typeof body.expression === 'object' ? body.expression : {},
      pose: body.pose && typeof body.pose === 'object' ? body.pose : {},
      commonIdentity:
        body.commonIdentity && typeof body.commonIdentity === 'object' ? body.commonIdentity : {},
      commonExpression:
        body.commonExpression && typeof body.commonExpression === 'object'
          ? body.commonExpression
          : {},
      component: body.component && typeof body.component === 'object' ? body.component : {},
    }),
  });
}

async function handleCustomIdentitiesApi(req, res) {
  await handleJsonFileApi(req, res, {
    filePath: CUSTOM_IDENTITIES_PATH,
    backupDir: CUSTOM_IDENTITIES_BACKUP_DIR,
    backupPrefix: 'custom-identities',
    buildPayload: (body) => {
      const identities = Array.isArray(body.identities)
        ? body.identities.filter((x) => x?.id && x?.name && Array.isArray(x.identity))
        : [];
      return {
        kind: 'gnmWorkshopCustomIdentities',
        version: Number(body.version) || 1,
        updatedAt: new Date().toISOString(),
        identities,
      };
    },
  });
}

async function handleParamFavoritesApi(req, res) {
  await handleJsonFileApi(req, res, {
    filePath: PARAM_FAVORITES_PATH,
    backupDir: PARAM_FAVORITES_BACKUP_DIR,
    backupPrefix: 'param-favorites',
    buildPayload: (body) => {
      const favorites = Array.isArray(body.favorites)
        ? body.favorites.filter((k) => typeof k === 'string' && k.includes(':'))
        : [];
      return {
        kind: 'gnmWorkshopParamFavorites',
        version: Number(body.version) || 1,
        updatedAt: new Date().toISOString(),
        favorites,
      };
    },
  });
}

async function handleIdentityTaxonomyApi(req, res) {
  await handleJsonFileApi(req, res, {
    filePath: IDENTITY_TAXONOMY_PATH,
    backupDir: IDENTITY_TAXONOMY_BACKUP_DIR,
    backupPrefix: 'identity-taxonomy',
    buildPayload: (body) => {
      const clusters = Array.isArray(body.clusters)
        ? body.clusters
            .filter((c) => c?.id && Array.isArray(c.indices) && c.indices.length)
            .map((c) => ({
              id: String(c.id),
              name: String(c.name || c.defaultName || c.id).trim() || String(c.id),
              defaultName: String(c.defaultName || c.name || c.id).trim(),
              medoid: c.medoid != null ? Number(c.medoid) : null,
              indices: [...new Set(c.indices.map((x) => Number(x) | 0))].sort((a, b) => a - b),
              meanMagCos: c.meanMagCos,
              regionHint: c.regionHint || '',
            }))
        : [];
      if (!clusters.length) {
        throw new Error('identity taxonomy clusters cannot be empty');
      }
      return {
        kind: 'gnmWorkshopIdentityTaxonomy',
        version: Number(body.version) || 1,
        updatedAt: new Date().toISOString(),
        source: body.source && typeof body.source === 'object' ? body.source : {},
        scope:
          body.scope && typeof body.scope === 'object'
            ? body.scope
            : { groupId: 'head', start: 0, count: 170 },
        clusters,
      };
    },
  });
}

async function handleGlbDirHistoryApi(req, res) {
  const isSyntheticTestDirName = (name) =>
    /^(copy_src|copy_dst|folder_alpha|folder_beta|folder_del_[ab]|reveal_folder)$/i.test(
      String(name || '').trim()
    );
  await handleJsonFileApi(req, res, {
    filePath: GLB_DIR_HISTORY_PATH,
    backupDir: GLB_DIR_HISTORY_BACKUP_DIR,
    backupPrefix: 'dir-history',
    buildPayload: (body) => {
      const folders = Array.isArray(body.folders)
        ? body.folders
            .filter((f) => f && typeof f.path === 'string' && f.path.trim())
            .filter((f) => !isSyntheticTestDirName(f.name) && !isSyntheticTestDirName(f.path))
            .map((f) => {
              const pathStr = String(f.path).trim().replace(/\//g, '\\');
              const absRaw = f.absPath != null ? String(f.absPath).trim().replace(/\//g, '\\') : '';
              const absPath = absRaw && (/^[a-zA-Z]:\\/.test(absRaw) || absRaw.startsWith('\\\\'))
                ? absRaw.replace(/[\\\/]+$/, '')
                : '';
              const row = {
                id: String(f.id || `dir_${Date.now()}`),
                path: pathStr,
                name: String(f.name || path.basename(pathStr) || f.path).trim(),
                lastUsed: Number(f.lastUsed) || Date.now(),
              };
              if (absPath) row.absPath = absPath;
              return row;
            })
            .slice(0, 40)
        : [];
      // 若客户端只提交了自测假目录，写成空列表，避免再次污染
      return {
        kind: 'glbManagerDirHistory',
        version: Number(body.version) || 1,
        updatedAt: new Date().toISOString(),
        lastId: body.lastId && folders.some((f) => f.id === String(body.lastId))
          ? String(body.lastId)
          : folders[0]?.id || null,
        folders,
      };
    },
  });
}

/** 在 Windows 资源管理器中打开并选中文件（或打开目录） */
async function handleRevealInExplorerApi(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    return;
  }
  try {
    const body = await readBody(req);
    let target = String(body.path || body.filePath || '').trim().replace(/\//g, '\\');
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'missing path' }));
      return;
    }
    target = path.normalize(target);
    if (!path.isAbsolute(target)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'path must be absolute' }));
      return;
    }
    if (!fs.existsSync(target)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'path not found', path: target }));
      return;
    }
    if (process.platform === 'win32') {
      const st = fs.statSync(target);
      if (st.isDirectory()) {
        spawn('explorer', [target], { detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('explorer', [`/select,${target}`], { detached: true, stdio: 'ignore' }).unref();
      }
    } else {
      const folder = fs.statSync(target).isDirectory() ? target : path.dirname(target);
      spawn('xdg-open', [folder], { detached: true, stdio: 'ignore' }).unref();
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, path: target }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: e.message || String(e) }));
  }
}

function assertPathInsideRoot(rootAbs, targetAbs) {
  const root = path.normalize(rootAbs).replace(/[\\\/]+$/, '');
  const target = path.normalize(targetAbs);
  const rootLower = root.toLowerCase();
  const targetLower = target.toLowerCase();
  if (targetLower !== rootLower && !targetLower.startsWith(rootLower + path.sep)) {
    throw new Error('path escapes root');
  }
  return target;
}

function pickFolderNative() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, error: 'pick-folder only supported on Windows' });
      return;
    }
    const outFile = path.join(
      require('os').tmpdir(),
      `glb-pick-folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`
    );
    // 独立可见进程 + TopMost 窗体，避免藏在浏览器后面 / 最小化服务窗口里无界面
    const psScript = `
$ErrorActionPreference = 'Stop'
$out = ${JSON.stringify(outFile)}
try {
  Add-Type -AssemblyName System.Windows.Forms
  $form = New-Object System.Windows.Forms.Form
  $form.TopMost = $true
  $form.Opacity = 0
  $form.ShowInTaskbar = $false
  $form.FormBorderStyle = 'None'
  $form.StartPosition = 'Manual'
  $form.Location = New-Object System.Drawing.Point(-10000, -10000)
  $form.Size = New-Object System.Drawing.Size(1, 1)
  $form.Show()
  $form.Activate()
  $d = New-Object System.Windows.Forms.FolderBrowserDialog
  $d.Description = '选择 GLB 模型文件夹（将记住完整路径）'
  $d.ShowNewFolderButton = $true
  $r = $d.ShowDialog($form)
  $form.Close()
  $form.Dispose()
  if ($r -eq [System.Windows.Forms.DialogResult]::OK -and $d.SelectedPath) {
    [System.IO.File]::WriteAllText($out, $d.SelectedPath, [System.Text.UTF8Encoding]::new($false))
  }
} catch {
  [System.IO.File]::WriteAllText($out, ('ERROR:' + $_.Exception.Message), [System.Text.UTF8Encoding]::new($false))
  exit 1
}
`;
    const psPath = path.join(
      require('os').tmpdir(),
      `glb-pick-folder-${Date.now()}.ps1`
    );
    try {
      fs.writeFileSync(psPath, psScript, 'utf8');
    } catch (e) {
      resolve({ ok: false, error: e.message || String(e) });
      return;
    }
    // start /wait 保证在交互桌面弹出，而不是挂在最小化的 node 服务窗口后
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', 'GLB选文件夹', '/wait', 'powershell.exe', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', psPath],
      {
        windowsHide: false,
        detached: false,
        stdio: 'ignore',
        shell: false,
      }
    );
    child.on('error', (e) => {
      try { fs.unlinkSync(psPath); } catch (_) {}
      try { fs.unlinkSync(outFile); } catch (_) {}
      resolve({ ok: false, error: e.message || String(e) });
    });
    child.on('close', () => {
      let selected = '';
      try {
        if (fs.existsSync(outFile)) selected = fs.readFileSync(outFile, 'utf8').trim();
      } catch (_) {}
      try { fs.unlinkSync(psPath); } catch (_) {}
      try { fs.unlinkSync(outFile); } catch (_) {}
      if (!selected) {
        resolve({ ok: false, cancelled: true, error: 'cancelled' });
        return;
      }
      if (selected.startsWith('ERROR:')) {
        resolve({ ok: false, error: selected.slice(6) });
        return;
      }
      resolve({ ok: true, path: path.normalize(selected) });
    });
  });
}

function listGlbFilesUnder(rootAbs) {
  const root = path.normalize(rootAbs);
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const ent of entries) {
      if (!ent.name || ent.name === '.' || ent.name === '..') continue;
      const abs = path.join(dir, ent.name);
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        walk(abs, childRel);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.glb')) {
        try {
          const st = fs.statSync(abs);
          out.push({
            rel: childRel.replace(/\\/g, '/'),
            name: ent.name,
            size: st.size,
            mtimeMs: st.mtimeMs,
          });
        } catch (_) {}
      }
    }
  };
  walk(root, '');
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

async function handlePickFolderApi(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    return;
  }
  const result = await pickFolderNative();
  res.writeHead(result.ok ? 200 : result.cancelled ? 200 : 500, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(result));
}

async function handleFsListApi(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    return;
  }
  try {
    const body = await readBody(req);
    const root = path.normalize(String(body.root || body.path || '').trim());
    if (!root || !path.isAbsolute(root) || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'invalid root directory' }));
      return;
    }
    const files = listGlbFilesUnder(root);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, root, files, name: path.basename(root) }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: e.message || String(e) }));
  }
}

async function handleFsReadApi(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    return;
  }
  try {
    const body = await readBody(req);
    const root = path.normalize(String(body.root || '').trim());
    const rel = String(body.rel || body.file || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!root || !rel || !path.isAbsolute(root)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'missing root/rel' }));
      return;
    }
    const target = assertPathInsideRoot(root, path.resolve(root, rel));
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'file not found' }));
      return;
    }
    const buf = fs.readFileSync(target);
    res.writeHead(200, {
      'Content-Type': 'model/gltf-binary',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store',
      'X-Glb-Name': encodeURIComponent(path.basename(target)),
      'X-Glb-Mtime': String(fs.statSync(target).mtimeMs),
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: e.message || String(e) }));
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleFsWriteApi(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    return;
  }
  try {
    const root = decodeURIComponent(String(req.headers['x-glb-root'] || '')).trim();
    const rel = decodeURIComponent(String(req.headers['x-glb-rel'] || '')).trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!root || !rel || !path.isAbsolute(root)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'missing X-Glb-Root / X-Glb-Rel' }));
      return;
    }
    const target = assertPathInsideRoot(root, path.resolve(root, rel));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const buf = await readRawBody(req);
    fs.writeFileSync(target, buf);
    const st = fs.statSync(target);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, path: target, size: st.size, mtimeMs: st.mtimeMs }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: e.message || String(e) }));
  }
}

async function handleFsDeleteApi(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    return;
  }
  try {
    const body = await readBody(req);
    const root = path.normalize(String(body.root || '').trim());
    const rel = String(body.rel || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!root || !rel || !path.isAbsolute(root)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'missing root/rel' }));
      return;
    }
    const target = assertPathInsideRoot(root, path.resolve(root, rel));
    if (!fs.existsSync(target)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    fs.unlinkSync(target);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: e.message || String(e) }));
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/__api/align-overlay-history') {
      await handleHistoryApi(req, res);
      return;
    }
    if (urlPath === '/__api/gnm-param-labels') {
      await handleParamLabelsApi(req, res);
      return;
    }
    if (urlPath === '/__api/gnm-custom-identities') {
      await handleCustomIdentitiesApi(req, res);
      return;
    }
    if (urlPath === '/__api/gnm-param-favorites') {
      await handleParamFavoritesApi(req, res);
      return;
    }
    if (urlPath === '/__api/gnm-identity-taxonomy') {
      await handleIdentityTaxonomyApi(req, res);
      return;
    }
    if (urlPath === '/__api/glb-dir-history') {
      await handleGlbDirHistoryApi(req, res);
      return;
    }
    if (urlPath === '/__api/reveal-in-explorer') {
      await handleRevealInExplorerApi(req, res);
      return;
    }
    if (urlPath === '/__api/pick-folder') {
      await handlePickFolderApi(req, res);
      return;
    }
    if (urlPath === '/__api/fs/list') {
      await handleFsListApi(req, res);
      return;
    }
    if (urlPath === '/__api/fs/read') {
      await handleFsReadApi(req, res);
      return;
    }
    if (urlPath === '/__api/fs/write') {
      await handleFsWriteApi(req, res);
      return;
    }
    if (urlPath === '/__api/fs/delete') {
      await handleFsDeleteApi(req, res);
      return;
    }

    const filePath = resolvePath(req.url);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      cors(res);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    cors(res);
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    cors(res);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Server error: ${error.message}`);
  }
});

server.listen(port, () => {
  console.log(`Browser automation static server running at http://localhost:${port}`);
  console.log(`Serving repo root: ${repoRoot}`);
  console.log(`Align history API: POST/GET http://localhost:${port}/__api/align-overlay-history`);
  console.log(`Param labels API: POST/GET http://localhost:${port}/__api/gnm-param-labels`);
  console.log(`Custom identities API: POST/GET http://localhost:${port}/__api/gnm-custom-identities`);
  console.log(`Param favorites API: POST/GET http://localhost:${port}/__api/gnm-param-favorites`);
  console.log(`Identity taxonomy API: POST/GET http://localhost:${port}/__api/gnm-identity-taxonomy`);
  console.log(`GLB dir history API: POST/GET http://localhost:${port}/__api/glb-dir-history`);
  console.log(`Reveal in Explorer API: POST http://localhost:${port}/__api/reveal-in-explorer`);
  console.log(`Pick folder API: POST http://localhost:${port}/__api/pick-folder`);
  console.log(`FS list/read/write/delete: /__api/fs/*`);
});
