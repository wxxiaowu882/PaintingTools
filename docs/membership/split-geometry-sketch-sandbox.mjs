/**
 * 从「沙盒_几何体静物」抽出「几何体写生」「静物写生」到新库「沙盒_几何体静物写生」。
 * 权威 JSON 只经本脚本改写（禁止手改 docs/json）。
 *
 * 用法：node docs/membership/split-geometry-sketch-sandbox.mjs
 * 可选：--dry-run
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const srcDir = path.join(root, 'docs', 'json', '沙盒_几何体静物');
const srcFile = path.join(srcDir, '沙盒_几何体静物.json');
const dstDir = path.join(root, 'docs', 'json', '沙盒_几何体静物写生');
const dstFile = path.join(dstDir, '沙盒_几何体静物写生.json');
const SKETCH_CATS = new Set(['几何体写生', '静物写生']);
const dry = process.argv.includes('--dry-run');

function sceneCat(sc) {
  if (!sc || typeof sc !== 'object') return '';
  if (sc.meta && sc.meta.category != null) return String(sc.meta.category).trim();
  if (sc.category != null) return String(sc.category).trim();
  return '';
}

function main() {
  if (!fs.existsSync(srcFile)) {
    console.error('missing', srcFile);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
  if (!Array.isArray(raw)) {
    console.error('expected top-level array');
    process.exit(1);
  }
  const keep = [];
  const sketch = [];
  const counts = {};
  for (const sc of raw) {
    const c = sceneCat(sc) || '?';
    counts[c] = (counts[c] || 0) + 1;
    if (SKETCH_CATS.has(c)) sketch.push(sc);
    else keep.push(sc);
  }
  console.log('source counts', counts);
  console.log('keep', keep.length, 'sketch', sketch.length);
  if (dry) {
    console.log('dry-run: no write');
    return;
  }
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
  fs.writeFileSync(dstFile, JSON.stringify(sketch, null, 2) + '\n', 'utf8');
  fs.writeFileSync(srcFile, JSON.stringify(keep, null, 2) + '\n', 'utf8');
  console.log('wrote', dstFile);
  console.log('rewrote', srcFile);
}

main();
