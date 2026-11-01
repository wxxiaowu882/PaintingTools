/**
 * 从单课 JSON 重建 Portrait 列表轻量封面缓存。
 * 生产端覆写 mainThumbnail 后须跑本脚本，否则课表仍显示旧封面。
 *
 * 用法：
 *   node .cursor/browser-automation/scripts/rebuild-portrait-course-cards.js
 *   node .cursor/browser-automation/scripts/rebuild-portrait-course-cards.js --lib=anatomy
 *   node .cursor/browser-automation/scripts/rebuild-portrait-course-cards.js --lib=facial
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const LIBS = {
  anatomy: {
    out: path.join(repoRoot, 'docs', 'js', 'portrait-course-cards-anatomy.json'),
    coverSize: [240, 320],
    courses: [
      { name: '头骨详解', url: 'docs/json/结构_头骨骨点肌肉/01 头骨详解.json' },
      { name: '骨点详解', url: 'docs/json/结构_头骨骨点肌肉/02 骨点详解.json' },
      { name: '肌肉详解', url: 'docs/json/结构_头骨骨点肌肉/03 肌肉详解_黄种人女V8.json' }
    ]
  },
  facial: {
    out: path.join(repoRoot, 'docs', 'js', 'portrait-course-cards-facial.json'),
    coverSize: [240, 320],
    courses: [
      { name: '耳朵详解', url: 'docs/json/结构_五官/01 耳朵详解.json' },
      { name: '鼻子详解', url: 'docs/json/结构_五官/02 鼻子详解.json' },
      { name: '嘴巴详解', url: 'docs/json/结构_五官/03 嘴巴详解.json' },
      { name: '眼眉详解', url: 'docs/json/结构_五官/04 眼眉详解.json' }
    ]
  }
};

function pickThumb(data) {
  if (data && typeof data.mainThumbnail === 'string' && data.mainThumbnail) return data.mainThumbnail;
  const snaps = (data && data.snapshots) || [];
  for (const s of snaps) {
    if (s && typeof s.thumb === 'string' && s.thumb) return s.thumb;
  }
  return '';
}

function buildLib(libKey) {
  const cfg = LIBS[libKey];
  if (!cfg) throw new Error('unknown lib: ' + libKey);
  const cards = [];
  for (const course of cfg.courses) {
    const file = path.join(repoRoot, course.url);
    if (!fs.existsSync(file)) throw new Error('missing course json: ' + course.url);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    cards.push({
      name: course.name,
      url: course.url,
      mainThumbnail: pickThumb(data),
      ptCount: Array.isArray(data.pointsData) ? data.pointsData.length : 0,
      snapCount: Array.isArray(data.snapshots) ? data.snapshots.length : 0
    });
  }
  const pack = {
    v: 1,
    lib: libKey,
    generatedAt: new Date().toISOString(),
    cards,
    coverSize: cfg.coverSize
  };
  fs.writeFileSync(cfg.out, JSON.stringify(pack), 'utf8');
  return {
    lib: libKey,
    out: path.relative(repoRoot, cfg.out).replace(/\\/g, '/'),
    cards: cards.map((c) => ({
      name: c.name,
      ptCount: c.ptCount,
      snapCount: c.snapCount,
      thumbBytes: (c.mainThumbnail || '').length
    })),
    generatedAt: pack.generatedAt
  };
}

const arg = process.argv.find((a) => a.startsWith('--lib='));
const only = arg ? arg.slice('--lib='.length) : '';
const keys = only ? [only] : Object.keys(LIBS);
const reports = keys.map(buildLib);
console.log(JSON.stringify({ ok: true, reports }, null, 2));
