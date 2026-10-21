/**
 * 为「结构_五官」各档案按每个标注生成组合快照：
 * - name ← pointsData[].text
 * - desc ← pointsData[].desc
 * - camera / settings ← 档案根级（可日后在生产端「复写」微调视角）
 * - showTextPoints ← 仅当前标注 id
 * - visiblePoints ← 全部未隐藏标注
 *
 * Usage: node scripts/facial-seed-snapshots-from-points.js [--dry-run]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const dir = path.join(repoRoot, 'docs', 'json', '结构_五官');
const files = [
  '01 耳朵详解.json',
  '02 鼻子详解.json',
  '03 嘴巴详解.json',
  '04 眼眉详解.json',
  '05 五官综合详解.json',
];
const dryRun = process.argv.includes('--dry-run');

function pickSettings(rootSettings) {
  const s = rootSettings || {};
  return {
    modelOpacity: s.modelOpacity,
    surfaceGloss: s.surfaceGloss,
    ambient: s.ambient,
    ambientTemp: s.ambientTemp,
    ambientX: s.ambientX,
    ambientY: s.ambientY,
    spot: s.spot,
    spotTemp: s.spotTemp,
    spotX: s.spotX,
    spotY: s.spotY,
    shadowIntensity: s.shadowIntensity,
    envRotOffset: s.envRotOffset,
    posterize: s.posterize,
    grayscale: s.grayscale,
  };
}

function cloneCamera(cam) {
  if (!cam || typeof cam !== 'object') {
    return { orbit: 'auto auto auto', target: 'auto auto auto', fov: 'auto' };
  }
  return {
    orbit: cam.orbit != null ? String(cam.orbit) : 'auto auto auto',
    target: cam.target != null ? String(cam.target) : 'auto auto auto',
    fov: cam.fov != null ? String(cam.fov) : 'auto',
  };
}

const summary = [];

for (const fileName of files) {
  const fp = path.join(dir, fileName);
  if (!fs.existsSync(fp)) {
    summary.push({ fileName, error: 'missing' });
    continue;
  }
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const points = Array.isArray(data.pointsData) ? data.pointsData : [];
  const settings = pickSettings(data.settings);
  const camera = cloneCamera(data.camera);
  const thumb = typeof data.mainThumbnail === 'string' ? data.mainThumbnail : '';
  const allVisible = points.filter((p) => p && !p.hidden).map((p) => p.id);

  const snapshots = [];
  let id = 1;
  for (const p of points) {
    if (!p || p.id == null) continue;
    const name = String(p.text != null ? p.text : '').trim() || `标注 ${p.id}`;
    const desc = p.desc != null ? String(p.desc) : '';
    snapshots.push({
      id: id,
      name: name,
      desc: desc,
      thumb: thumb,
      camera: cloneCamera(camera),
      settings: Object.assign({}, settings),
      visiblePoints: allVisible.slice(),
      showTextPoints: [p.id],
      isCover: id === 1,
    });
    id += 1;
  }

  summary.push({
    fileName,
    points: points.length,
    snapshots: snapshots.length,
    sample: snapshots.slice(0, 2).map((s) => ({
      id: s.id,
      name: s.name,
      descLen: (s.desc || '').length,
    })),
  });

  if (!dryRun) {
    data.snapshots = snapshots;
    data.timestamp = Date.now();
    fs.writeFileSync(fp, JSON.stringify(data));
  }
}

console.log(JSON.stringify({ dryRun, summary }, null, 2));
const bad = summary.some((r) => r.error || r.points !== r.snapshots);
process.exit(bad ? 1 : 0);
