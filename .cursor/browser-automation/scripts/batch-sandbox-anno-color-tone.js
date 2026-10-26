/**
 * 批量：只改 annotations / groundAnnotations 的 color（保色相压亮度；近白→暖灰）
 * 不动物体 items[].color、env、缩略图。
 *
 * DRY_RUN=1（默认）只报表；DRY_RUN=0 写单课 JSON。
 * 写完后请再跑 rebuild-*-index.js 重建统合清单。
 *
 * 用法：
 *   node scripts/batch-sandbox-anno-color-tone.js
 *   DRY_RUN=0 node scripts/batch-sandbox-anno-color-tone.js
 *   SANDBOXES=geometry,headform,portrait DRY_RUN=0 node scripts/batch-sandbox-anno-color-tone.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const DRY = process.env.DRY_RUN !== '0';
const sandboxFilter = (process.env.SANDBOXES || 'geometry,headform,portrait')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const DIRS = {
  geometry: path.join(repoRoot, 'docs', 'json', '沙盒_几何体静物'),
  headform: path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律'),
  portrait: path.join(repoRoot, 'docs', 'json', '沙盒_肖像光影沙盒')
};

const MASTERS = {
  geometry: '沙盒_几何体静物.json',
  headform: '沙盒_头部造型规律.json',
  portrait: '沙盒_肖像光影沙盒.json'
};

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function hexToRgb(hex) {
  let c = String(hex || '').trim().replace('#', '');
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return null;
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16)
  };
}

function rgbToHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6; break;
  }
  return { h: h * 360, s, l };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp01(s);
  l = clamp01(l);
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = h / 360;
  const t = (x) => {
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return {
    r: t(hk + 1 / 3) * 255,
    g: t(hk) * 255,
    b: t(hk - 1 / 3) * 255
  };
}

/** 近白/浅灰 → 暖灰；彩标保 H，压 L（略收 S）。目标带内二次跑应幂等。 */
function toneHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return { hex: hex, changed: false, reason: 'invalid' };
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const prev = rgbToHex(rgb.r, rgb.g, rgb.b).toLowerCase();

  // 已是目标暖灰带（近白处理后）
  if (s < 0.14 && l >= 0.68 && l <= 0.76 && (s < 0.04 || (h >= 20 && h <= 50))) {
    return { hex: prev, changed: false, reason: 'gray_ok' };
  }

  if (s < 0.12) {
    // 仍偏亮的近白 / 浅灰 → 暖灰
    if (l > 0.76) {
      const out = hslToRgb(36, 0.08, 0.72);
      const next = rgbToHex(out.r, out.g, out.b).toLowerCase();
      return { hex: next, changed: next !== prev, reason: 'near_white', from: prev };
    }
    return { hex: prev, changed: false, reason: 'gray_ok' };
  }

  // 彩标：目标带内跳过（幂等）
  if (l <= 0.44 && s <= 0.85) {
    return { hex: prev, changed: false, reason: 'chroma_ok' };
  }
  const nh = h;
  const ns = Math.min(s, 0.82) * 0.90;
  let nl = Math.min(l, 0.46);
  if (nl > 0.40) nl = 0.36 + (nl - 0.40) * 0.35;
  nl = Math.max(0.28, Math.min(0.44, nl));
  const out = hslToRgb(nh, ns, nl);
  const next = rgbToHex(out.r, out.g, out.b).toLowerCase();
  return { hex: next, changed: next !== prev, reason: 'chroma_tone', from: prev };
}

/**
 * 只改：经典引线 color、取色引线 lineColor、受光探针 color。
 * 勿动：items[].color、sampledColor、env 等。
 */
function applyToneField(obj, key, fileLabel, stats, kind) {
  if (!obj || typeof obj[key] !== 'string' || !obj[key].trim()) return 0;
  stats.seen += 1;
  const t = toneHex(obj[key]);
  const reason = kind + ':' + t.reason;
  stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;
  if (!t.changed) return 0;
  stats.changed += 1;
  if (stats.samples.length < 40) {
    stats.samples.push({
      file: fileLabel,
      kind,
      field: key,
      from: t.from || obj[key],
      to: t.hex,
      reason: t.reason
    });
  }
  if (!DRY) obj[key] = t.hex;
  return 1;
}

function walkToneTargets(node, fileLabel, stats) {
  if (!node || typeof node !== 'object') return 0;
  let n = 0;
  if (Array.isArray(node)) {
    node.forEach((x, i) => { n += walkToneTargets(x, fileLabel + '[' + i + ']', stats); });
    return n;
  }

  const idStr = node.id != null ? String(node.id) : '';
  const kind = node.annotationKind
    || (node.lineColor != null && node.sampledColor != null ? 'colorSample'
      : (idStr.indexOf('prober_') === 0 || (node.rayLen != null && Array.isArray(node.localNormal)) ? 'prober'
        : (node.text != null && (node.localPos != null || node.dx != null || node.dxN != null) ? 'leader'
          : '')));

  if (kind === 'leader' || node.annotationKind === 'leader') {
    n += applyToneField(node, 'color', fileLabel, stats, 'leader');
  }
  if (kind === 'colorSample' || node.annotationKind === 'colorSample' || (node.lineColor && node.sampledColor != null)) {
    n += applyToneField(node, 'lineColor', fileLabel, stats, 'colorSample');
  }
  if (kind === 'prober') {
    n += applyToneField(node, 'color', fileLabel, stats, 'prober');
  }

  ['items', 'annotations', 'groundAnnotations', 'colorSampleAnnotations', 'groundColorSampleAnnotations', 'probers', 'groundProbers'].forEach((k) => {
    if (node[k] != null) n += walkToneTargets(node[k], fileLabel + '.' + k, stats);
  });
  return n;
}

function processScene(scene, fileLabel, stats) {
  return walkToneTargets(scene, fileLabel, stats);
}

function listLessonFiles(dir, masterName) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => {
    return name.endsWith('.json') && /^\d+/.test(name) && name !== masterName;
  }).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
}

function main() {
  const stats = {
    dryRun: DRY,
    sandboxes: {},
    seen: 0,
    changed: 0,
    byReason: {},
    samples: [],
    filesTouched: 0,
    filesTotal: 0
  };

  for (const key of sandboxFilter) {
    const dir = DIRS[key];
    const master = MASTERS[key];
    if (!dir || !fs.existsSync(dir)) {
      stats.sandboxes[key] = { skipped: true, reason: 'missing_dir' };
      continue;
    }
    const files = listLessonFiles(dir, master);
    let touched = 0;
    let sceneAnno = 0;
    for (const name of files) {
      stats.filesTotal += 1;
      const fp = path.join(dir, name);
      let raw;
      try {
        raw = fs.readFileSync(fp, 'utf8');
      } catch (_e) {
        continue;
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch (_e) {
        continue;
      }
      const before = stats.changed;
      // 单课可能是对象，也可能是数组（少见）
      if (Array.isArray(data)) {
        data.forEach((sc, i) => { sceneAnno += processScene(sc, name + '#' + i, stats); });
      } else {
        sceneAnno += processScene(data, name, stats);
      }
      if (stats.changed > before) {
        touched += 1;
        stats.filesTouched += 1;
        if (!DRY) {
          fs.writeFileSync(fp, JSON.stringify(data, null, 2) + '\n', 'utf8');
        }
      }
    }
    stats.sandboxes[key] = { files: files.length, filesTouched: touched, note: sceneAnno };
  }

  console.log(JSON.stringify(stats, null, 2));
  if (!DRY) {
    console.log('\nWrote lesson JSONs. Rebuild indexes next:');
    console.log('  node scripts/rebuild-geometry-index.js');
    console.log('  node scripts/rebuild-headform-index.js');
    console.log('  node scripts/rebuild-portrait-index.js');
  } else {
    console.log('\nDRY_RUN only. Set DRY_RUN=0 to write.');
  }
}

main();
