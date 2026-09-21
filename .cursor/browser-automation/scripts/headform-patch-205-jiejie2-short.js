/**
 * 四套 205：交界2 格式修正——标题换行 + 先列⑦⑧⑨再说明
 * node scripts/headform-patch-205-jiejie2-short.js
 */
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

const SHORT_PLAIN = [
  '【交界2 · 颞—眉—眼】',
  '⑦→⑧.颞线（⑧是眉峰）',
  '⑨.眶外角',
  '正前光下，这条交界依赖颞线、眉峰、眶外角一带的前后转折。头型偏扁、东亚常见面型、女性、低龄者，这片往往更平，交界2常不明显甚至几乎糊掉——不是没有这些点，而是亮暗边不够锋利。点位框架仍用⑦→⑧→⑨，再按个体强弱调整。'
].join('\n');

const SHORT_RICH = [
  '<strong>【交界2 · 颞—眉—眼】</strong>',
  '<strong>⑦→⑧.颞线（⑧是眉峰）</strong>',
  '<strong>⑨.眶外角</strong>',
  '正前光下，这条交界依赖颞线、眉峰、眶外角一带的前后转折。头型偏扁、东亚常见面型、女性、低龄者，这片往往更平，交界2常不明显甚至几乎糊掉——不是没有这些点，而是亮暗边不够锋利。点位框架仍用⑦→⑧→⑨，再按个体强弱调整。'
].join('<br>');

/** 自「【交界2」起，到「可点击」之前 */
const RE_PLAIN_BLOCK = /【交界2[\s\S]*?(?=\n可点击操作面板)/;
const RE_RICH_BLOCK =
  /(?:<strong>)?【交界2[\s\S]*?(?=(?:<br\s*\/?>)*可点击操作面板)/;

const FILES = [
  '205_【交界线规律】正前光 · 头侧交界.json',
  '205_女05_【交界线规律】正前光 · 头侧交界.json',
  '205_光头亚裔_【交界线规律】正前光 · 头侧交界.json',
  '205_叶问_【交界线规律】正前光 · 头侧交界.json'
];

let fail = 0;
for (const f of FILES) {
  const p = path.join(lib.jsonDir, f);
  if (!fs.existsSync(p)) {
    console.error('MISSING', f);
    fail++;
    continue;
  }
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const plain0 = j.meta.keyPoints || '';
  const rich0 = j.meta.keyPointsRich || '';

  if (!RE_PLAIN_BLOCK.test(plain0)) {
    console.error('PLAIN_NO_MATCH', f);
    fail++;
    continue;
  }
  j.meta.keyPoints = plain0.replace(RE_PLAIN_BLOCK, SHORT_PLAIN + '\n\n');

  if (rich0 && RE_RICH_BLOCK.test(rich0)) {
    j.meta.keyPointsRich = rich0.replace(RE_RICH_BLOCK, SHORT_RICH + '<br><br>');
  } else if (rich0) {
    console.error('RICH_NO_MATCH', f);
    fail++;
    continue;
  }

  fs.writeFileSync(p, JSON.stringify(j));
  const kp = j.meta.keyPoints;
  const block = kp.slice(kp.indexOf('【交界2'), kp.indexOf('可点击'));
  console.log('OK', f);
  console.log(block.trim());
  console.log('---');
}

lib.rebuildAggregate();
console.log('AGG rebuilt, fail', fail);
process.exit(fail ? 1 : 0);
