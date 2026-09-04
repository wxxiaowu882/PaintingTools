const http = require('http');
const fs = require('fs');
const path = require('path');

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
});
