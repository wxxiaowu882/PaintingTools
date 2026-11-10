/**
 * 从「几何体静物」001 欢迎页克隆到「静物写生台」2403b：
 * - 删除全部标注
 * - 改 uid / 类别 / 场景说明 / 童画师解析（短文）
 * - 写入 2403 与 2404 之间（文件名 2403b_…；numeric 排序已验）
 * - 重建 沙盒_几何体静物写生.json
 *
 * 用法：node .cursor/browser-automation/scripts/add-geometrysketch-2403b-from-001.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const srcPath = path.join(repoRoot, 'docs', 'json', '沙盒_几何体静物', '001_欢迎页.json');
const dstDir = path.join(repoRoot, 'docs', 'json', '沙盒_几何体静物写生');
const masterName = '沙盒_几何体静物写生.json';
const uid = '2403b';
const outFileName = '2403b_【静物写生】复杂物件 · 画框花束.json';
const outPath = path.join(dstDir, outFileName);

function stripAnnotations(scene) {
  const emptyArrKeys = [
    'groundAnnotations',
    'groundNormArrows',
    'groundPolygon3ds',
    'groundColorSampleAnnotations',
  ];
  for (const k of emptyArrKeys) {
    if (k in scene) scene[k] = [];
  }
  const items = Array.isArray(scene.items) ? scene.items : [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    if ('annotations' in it) it.annotations = [];
    if ('dashes' in it) it.dashes = [];
    if ('dashLines' in it) it.dashLines = [];
    if ('polygons' in it) it.polygons = [];
    if ('normArrows' in it) it.normArrows = [];
    if ('colorSampleAnnotations' in it) it.colorSampleAnnotations = [];
  }
  return scene;
}

function uidFromFileName(name) {
  const m = String(name || '').match(/^(\d+[A-Za-z]?)/);
  return m ? m[1] : '';
}

function rebuildSketchIndex() {
  const names = fs.readdirSync(dstDir).filter((name) => {
    return name.endsWith('.json') && /^\d+/.test(name) && name !== masterName;
  });
  names.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));

  const merged = [];
  const skipped = [];
  const repaired = [];
  const uids = new Map();
  for (const name of names) {
    const fp = path.join(dstDir, name);
    const text = fs.readFileSync(fp, 'utf8');
    try {
      const obj = JSON.parse(text);
      let id = obj && obj.uid != null ? String(obj.uid) : '';
      if (!id) {
        id = uidFromFileName(name);
        if (!id) {
          skipped.push(name + ': missing uid and no numeric prefix');
          continue;
        }
        obj.uid = id;
        fs.writeFileSync(fp, JSON.stringify(obj));
        repaired.push(name + ' -> uid ' + id);
      }
      if (uids.has(id)) {
        throw new Error('uid collision: ' + id + ' in ' + uids.get(id) + ' and ' + name);
      }
      uids.set(id, name);
      merged.push(obj);
    } catch (e) {
      if (String(e.message || e).startsWith('uid collision')) throw e;
      skipped.push(name + ': ' + e.message);
    }
  }

  const outPathMaster = path.join(dstDir, masterName);
  fs.writeFileSync(outPathMaster, JSON.stringify(merged));
  return {
    files: names.length,
    merged: merged.length,
    skipped,
    repaired,
    out: outPathMaster,
    orderSample: names.filter((n) => /^2403/.test(n) || n.startsWith('2404')),
  };
}

function main() {
  if (!fs.existsSync(srcPath)) {
    throw new Error('source missing: ' + srcPath);
  }
  if (fs.existsSync(outPath)) {
    throw new Error('already exists (refuse overwrite): ' + outPath);
  }

  const scene = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  stripAnnotations(scene);

  scene.uid = uid;
  scene.name = '【静物写生】复杂物件 · 画框花束';
  scene.meta = scene.meta && typeof scene.meta === 'object' ? scene.meta : {};
  scene.meta.category = '静物写生';
  scene.meta.detail =
    '<b>静物写生 · 画框花束</b>\n\n' +
    '花框是复杂，脚边球、柱、锥是简单。\n' +
    '先认简单体上的光，再回头对照花与框。';
  scene.meta.keyPoints =
    '【静物写生】复杂物件 · 画框花束。\n\n' +
    '眼前这一幅：画框里的花束是复杂，脚边的球、柱、锥是简单。写生时先把简单体上的明暗看稳，再回头看花与框——复杂也往往能拆回这些基本形。\n\n' +
    '同一幅可以多看几遍；看稳了，再试着调光或转视角，换一套条件继续观察。';

  fs.writeFileSync(outPath, JSON.stringify(scene));
  const index = rebuildSketchIndex();

  const around = index.orderSample;
  console.log(
    JSON.stringify(
      {
        wrote: outPath,
        uid,
        name: scene.name,
        annotationsCleared: true,
        index,
        neighborFiles: around,
      },
      null,
      2
    )
  );
}

main();
