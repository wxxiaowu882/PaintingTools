/**
 * 从课表 JSON 的 thumbnail（data URL）导出写生台场景封面，供淘宝装修设计用。
 * 不打开浏览器、不渲染 3D。
 *
 * 用法：node scripts/export-sandbox-scene-covers.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..', '..');
const outRoot = path.join(
  root,
  '自用工具文件_不部署',
  '淘宝店铺装修素材_2026-11',
  'scene-covers'
);

const SOURCES = [
  {
    id: 'geo-sketch',
    label: '几何体静物写生（写生台·几何）',
    json: path.join(root, 'docs', 'json', '沙盒_几何体静物写生', '沙盒_几何体静物写生.json'),
    pickEvery: 1 // 全量导出；picks 另筛
  },
  {
    id: 'portrait',
    label: '肖像光影沙盒（写生台·人物）',
    json: path.join(root, 'docs', 'json', '沙盒_肖像光影沙盒', '沙盒_肖像光影沙盒.json'),
    pickEvery: 1
  },
  {
    id: 'geo-teach',
    label: '几何体静物教学沙盒（可选氛围）',
    json: path.join(root, 'docs', 'json', '沙盒_几何体静物', '沙盒_几何体静物.json'),
    pickEvery: 1
  }
];

/** 设计优先用的封面（按 uid / 名称特征挑一批好看的） */
const PICK_RULES = {
  'geo-sketch': {
    // 单几何 + 组合 + 罐/果/复杂各取若干
    preferName: [
      /球体/, /正方体/, /圆柱/, /圆锥/, /组合0[1-4]/,
      /陶瓷罐0[1-4]/, /水果0[1-4]/, /复杂物件0[1-3]/, /自然场景0[1-2]/
    ],
    max: 14
  },
  portrait: {
    preferName: [
      /桌上/, /石膏/, /女/, /男/, /青年/, /儿童/, /凯撒/, /大卫/, /维纳斯/, /老人/, /侧面/, /胸像/
    ],
    max: 16
  },
  'geo-teach': {
    preferName: [/球体/, /正方体/, /圆柱/, /圆锥/, /组合体/, /构图-例/, /欢迎/],
    max: 10
  }
};

function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const keys = Object.keys(raw).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
    if (keys.length) return keys.map((k) => raw[k]);
  }
  return [];
}

function safeName(s, fallback) {
  const t = String(s || fallback || 'scene')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return t || fallback || 'scene';
}

function decodeThumb(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return { ext, buf: Buffer.from(m[2], 'base64') };
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function exportSource(src) {
  const raw = JSON.parse(fs.readFileSync(src.json, 'utf8'));
  const scenes = asArray(raw);
  const dir = path.join(outRoot, src.id);
  ensureDir(dir);

  const manifest = [];
  let ok = 0;
  let skip = 0;

  scenes.forEach((sc, i) => {
    if (!sc) return;
    const uid = String(sc.uid != null ? sc.uid : i + 1);
    const name = String(sc.name || uid);
    const decoded = decodeThumb(sc.thumbnail);
    if (!decoded) {
      skip++;
      return;
    }
    const base = `${String(i + 1).padStart(3, '0')}_${safeName(name, uid)}`;
    const file = `${base}.${decoded.ext}`;
    const full = path.join(dir, file);
    fs.writeFileSync(full, decoded.buf);
    ok++;
    manifest.push({
      i: i + 1,
      uid,
      name,
      file: `${src.id}/${file}`,
      bytes: decoded.buf.length,
      meta: sc.meta || null
    });
  });

  return { src, ok, skip, total: scenes.length, manifest };
}

function buildPicks(allManifests) {
  const picksDir = path.join(outRoot, 'picks');
  ensureDir(picksDir);
  const picks = [];

  for (const { src, manifest } of allManifests) {
    const rule = PICK_RULES[src.id] || { preferName: [], max: 12 };
    const scored = manifest.map((m) => {
      let score = 0;
      for (let i = 0; i < rule.preferName.length; i++) {
        if (rule.preferName[i].test(m.name)) score += rule.preferName.length - i;
      }
      // 略偏大文件通常更清晰
      score += Math.min(3, Math.floor((m.bytes || 0) / 8000));
      return { m, score };
    });
    scored.sort((a, b) => b.score - a.score || a.m.i - b.m.i);

    const chosen = [];
    const seen = new Set();
    for (const { m, score } of scored) {
      if (chosen.length >= rule.max) break;
      if (score <= 0 && chosen.length >= Math.ceil(rule.max / 2)) continue;
      const key = m.name;
      if (seen.has(key)) continue;
      seen.add(key);
      chosen.push(m);
    }

    for (const m of chosen) {
      const from = path.join(outRoot, m.file);
      const toName = `${src.id}__${path.basename(m.file)}`;
      const to = path.join(picksDir, toName);
      fs.copyFileSync(from, to);
      picks.push({
        group: src.id,
        label: src.label,
        name: m.name,
        uid: m.uid,
        file: `picks/${toName}`,
        source: m.file
      });
    }
  }

  return picks;
}

function writeIndex(allManifests, picks) {
  const rows = picks
    .map(
      (p) => `<figure data-group="${p.group}">
      <img src="${p.file}" alt="${escapeHtml(p.name)}" loading="lazy" />
      <figcaption><b>${escapeHtml(p.name)}</b><br/><span>${escapeHtml(p.group)} · uid ${escapeHtml(String(p.uid))}</span></figcaption>
    </figure>`
    )
    .join('\n');

  const stats = allManifests
    .map((x) => `<li><b>${escapeHtml(x.src.label)}</b>：导出 ${x.ok} / ${x.total}${x.skip ? `（缺封面 ${x.skip}）` : ''}</li>`)
    .join('');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>写生台场景封面素材库</title>
  <style>
    :root { --bg:#0a0a0a; --ink:#eee; --muted:#999; --line:rgba(255,255,255,.12); --gold:#e8d4a8; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:"Microsoft YaHei","PingFang SC",sans-serif; background:var(--bg); color:var(--ink); }
    .wrap { max-width:1200px; margin:0 auto; padding:24px 16px 80px; }
    h1 { font-weight:300; letter-spacing:.12em; font-size:1.15rem; }
    .lead,.note { color:var(--muted); font-size:.9rem; line-height:1.55; }
    .note { margin-top:10px; padding:12px 14px; border:1px solid var(--line); border-radius:10px; background:#111; }
    .note b { color:var(--gold); }
    .tabs { display:flex; gap:8px; flex-wrap:wrap; margin:16px 0; }
    .tabs button {
      background:#161616; color:var(--muted); border:1px solid var(--line);
      border-radius:999px; padding:6px 12px; cursor:pointer; font-size:12px;
    }
    .tabs button.on { color:#111; background:var(--gold); border-color:transparent; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:12px; }
    figure { margin:0; background:#121212; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
    figure img { display:block; width:100%; aspect-ratio:1; object-fit:cover; background:#000; }
    figcaption { padding:8px 9px 10px; font-size:11px; line-height:1.35; }
    figcaption span { color:var(--muted); font-size:10px; }
    ul { color:var(--muted); font-size:.86rem; line-height:1.5; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>写生台场景封面素材库</h1>
    <p class="lead">从课表 JSON 的 thumbnail 导出，不截 3D 实时画面。下方默认展示「设计精选」；全量在子目录 geo-sketch / portrait / geo-teach。</p>
    <div class="note">
      <b>用法</b>：淘宝模块虚背景 / 头图氛围优先用 <code>picks/</code>；需要更多时翻对应全量目录。<br/>
      路径：<code>自用工具文件_不部署/淘宝店铺装修素材_2026-11/scene-covers/</code>
    </div>
    <ul>${stats}<li><b>设计精选 picks</b>：${picks.length} 张</li></ul>
    <div class="tabs" id="tabs">
      <button type="button" class="on" data-g="all">全部精选</button>
      <button type="button" data-g="geo-sketch">几何写生</button>
      <button type="button" data-g="portrait">人物肖像</button>
      <button type="button" data-g="geo-teach">几何教学</button>
    </div>
    <div class="grid" id="grid">${rows}</div>
  </div>
  <script>
    const tabs = document.getElementById('tabs');
    const figs = [...document.querySelectorAll('#grid figure')];
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-g]');
      if (!btn) return;
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      const g = btn.dataset.g;
      figs.forEach((f) => { f.style.display = (g === 'all' || f.dataset.group === g) ? '' : 'none'; });
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(path.join(outRoot, 'index.html'), html, 'utf8');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function main() {
  ensureDir(outRoot);
  const all = SOURCES.map((src) => {
    console.log('export', src.id, '…');
    const r = exportSource(src);
    console.log(' ', r.ok, '/', r.total, 'skip', r.skip);
    fs.writeFileSync(
      path.join(outRoot, `${src.id}-manifest.json`),
      JSON.stringify({ label: src.label, count: r.ok, items: r.manifest }, null, 2),
      'utf8'
    );
    return r;
  });

  const picks = buildPicks(all);
  fs.writeFileSync(path.join(outRoot, 'picks-manifest.json'), JSON.stringify(picks, null, 2), 'utf8');
  writeIndex(all, picks);

  const readme = `# 写生台场景封面素材

- 来源：课表 JSON 内嵌 \`thumbnail\`（与 Solid 课表封面一致）
- 全量：\`geo-sketch/\`（几何写生）、\`portrait/\`（肖像）、\`geo-teach/\`（几何教学）
- 精选：\`picks/\` + 打开 \`index.html\` 浏览
- 重新导出：\`node .cursor/browser-automation/scripts/export-sandbox-scene-covers.js\`

更新：${new Date().toISOString().slice(0, 10)}
`;
  fs.writeFileSync(path.join(outRoot, 'README.md'), readme, 'utf8');
  console.log('DONE', outRoot);
  console.log('picks', picks.length);
}

main();
