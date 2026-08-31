/**
 * 审计预设间几何差异，防止「名称不同脸一样」
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(
  fs.readFileSync(path.join(__dirname, '_bake_asian_report.json'), 'utf8')
);
const baked = report.baked;
const byId = Object.fromEntries(baked.map((b) => [b.id, b.metrics]));

const RULES = [
  { a: 'identity-as07-child-wide', b: 'identity-as16-female-grace', minEyeGap: 0.09, label: '童颜 vs 温婉' },
  { a: 'identity-as13-female-sweet', b: 'identity-as16-female-grace', minEyeGap: 0.07, label: '萝莉 vs 温婉' },
  { a: 'identity-as15-female-petite', b: 'identity-as05-female-oval', minEyeGap: 0.06, label: '漫画眼 vs 初恋' },
  { a: 'identity-as01-male-north', b: 'identity-as05-female-oval', minEyeGap: 0.0, minSkinGap: 0.008, label: '男 vs 女留白' },
  { a: 'identity-as12-female-doe-eye', b: 'identity-as17-female-cool', minFaceGap: 0.04, label: '丹凤 vs 清冷面长' },
];

let ok = true;
for (const r of RULES) {
  const ma = byId[r.a];
  const mb = byId[r.b];
  if (!ma || !mb) {
    console.log('MISSING', r.a, r.b);
    ok = false;
    continue;
  }
  const eyeGap = Math.abs(ma.eyeToFace - mb.eyeToFace);
  const skinGap = Math.abs(ma.skinW - mb.skinW);
  const faceGap = Math.abs(ma.faceIndex - mb.faceIndex);
  let pass = true;
  if (r.minEyeGap != null && eyeGap < r.minEyeGap) pass = false;
  if (r.minSkinGap != null && skinGap < r.minSkinGap) pass = false;
  if (r.minFaceGap != null && faceGap < r.minFaceGap) pass = false;
  console.log(
    pass ? '✓' : '✗',
    r.label,
    `eyeΔ=${eyeGap.toFixed(4)}`,
    r.minSkinGap != null ? `skinΔ=${skinGap.toFixed(5)}` : '',
    r.minFaceGap != null ? `faceΔ=${faceGap.toFixed(4)}` : ''
  );
  if (!pass) ok = false;
}

// 美女档之间 eyeToFace 方差
const beautyIds = baked.filter((b) => b.id.includes('female') || b.id.includes('as10') || b.id.includes('as11') || b.id.includes('as12') || b.id.includes('as13') || b.id.includes('as14') || b.id.includes('as15') || b.id.includes('as16') || b.id.includes('as17')).map((b) => b.id);
const eyes = beautyIds.map((id) => byId[id]?.eyeToFace).filter((x) => x != null);
const spread = Math.max(...eyes) - Math.min(...eyes);
console.log('\n美女+东亚女 eye spread', spread.toFixed(4), eyes.length ? '' : '(none)');
if (spread < 0.079) {
  console.log('✗ 美女档眼比跨度不足 0.08');
  ok = false;
} else {
  console.log('✓ 美女档眼比跨度 OK');
}

process.exit(ok ? 0 : 1);
