/**
 * 仅写 209_欧男 单场景：重建两条贝塞尔
 *   ①→②→③（3 锚点）
 *   ④→⑤（2 锚点）
 * 不动统合 JSON。默认柄对齐 Plugin_DashedLine._ensureDefaultHandles（弦长 1/3）。
 *
 * 用法：node scripts/headform-patch-ouman-209-bezier.js
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const filePath = path.join(
  repoRoot,
  'docs',
  'json',
  '沙盒_头部造型规律',
  '209_欧男_【交界线规律】背面光 · 背侧交界B.json'
);

function round3(n) {
  return Number(Number(n).toFixed(3));
}
function round4(n) {
  return Number(Number(n).toFixed(4));
}
function vSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function vAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function vScale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function vLen(a) {
  return Math.hypot(a[0], a[1], a[2]);
}
function vNorm(a) {
  const L = vLen(a);
  if (L < 1e-12) return [1, 0, 0];
  return [a[0] / L, a[1] / L, a[2] / L];
}
function vRound(a, fn) {
  return [fn(a[0]), fn(a[1]), fn(a[2])];
}

/** 与插件 _ensureDefaultHandles 等价，输出磁盘 pos/norm/handle* */
function buildBezierLine(id, leaders, appearance) {
  const pts = leaders.map((L) => ({
    pos: [...L.localPos],
    norm: [...L.localNormal]
  }));
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (i === 0) {
      p.handleOut = vRound(vScale(vSub(pts[1].pos, p.pos), 1 / 3), round4);
    } else if (i === n - 1) {
      p.handleIn = vRound(vScale(vSub(pts[i - 1].pos, p.pos), 1 / 3), round4);
    } else {
      const tan = vNorm(vSub(pts[i + 1].pos, pts[i - 1].pos));
      const dIn = vLen(vSub(p.pos, pts[i - 1].pos)) / 3;
      const dOut = vLen(vSub(pts[i + 1].pos, p.pos)) / 3;
      p.handleIn = vRound(vScale(tan, -dIn), round4);
      p.handleOut = vRound(vScale(tan, dOut), round4);
    }
    p.pos = vRound(p.pos, round4);
    p.norm = vRound(p.norm, round3);
  }
  return {
    id,
    color: appearance.color,
    kind: 'bezier',
    opacity: appearance.opacity,
    capR: appearance.capR,
    points: pts
  };
}

const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const item = (data.items || []).find((it) => it && it.type === 'glb');
if (!item) {
  console.error('no glb item');
  process.exit(1);
}
const byText = {};
for (const a of item.annotations || []) {
  if (a && a.text != null) byText[String(a.text)] = a;
}
for (const t of ['1', '2', '3', '4', '5']) {
  if (!byText[t] || !byText[t].localPos || !byText[t].localNormal) {
    console.error('missing leader', t);
    process.exit(1);
  }
}

const appearance = { color: '#c9c9c9', opacity: 0.88, capR: 2.5 };
const ts = Date.now();
const dashedLines = [
  buildBezierLine('dash_line_' + ts + '_123', [byText['1'], byText['2'], byText['3']], appearance),
  buildBezierLine('dash_line_' + (ts + 1) + '_45', [byText['4'], byText['5']], appearance)
];

item.dashedLines = dashedLines;
fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');

console.log(
  JSON.stringify(
    {
      file: path.basename(filePath),
      dashedLines: dashedLines.map((L) => ({
        id: L.id,
        pts: L.points.length,
        first: L.points[0].pos,
        last: L.points[L.points.length - 1].pos,
        capR: L.capR
      })),
      aggregate: 'not touched'
    },
    null,
    2
  )
);
