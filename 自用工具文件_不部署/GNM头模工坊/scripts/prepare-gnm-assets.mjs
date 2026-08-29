/**
 * 下载完整 GNM Head Web 基底（GNMW / int8 全维）到 data/gnm/
 * 来源：xrblocks/assets-gnm（由官方 GNM 导出，Apache-2.0）
 *
 * 用法：node scripts/prepare-gnm-assets.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../data/gnm');
const ASSETS = [
  {
    name: 'gnm_head_web.bin',
    url: 'https://rawcdn.githack.com/xrblocks/assets-gnm/8480138a42ae746a2f7c9808a51ef23af7648653/gnm_head_web.bin',
  },
];

function fetchToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    const req = mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        fetchToFile(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total) {
          const pct = ((received / total) * 100).toFixed(1);
          process.stdout.write(`\r${path.basename(dest)} ${pct}%`);
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        process.stdout.write('\n');
        resolve();
      });
    });
    req.on('error', reject);
  });
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const asset of ASSETS) {
  const dest = path.join(OUT_DIR, asset.name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) {
    console.log(`已存在，跳过: ${asset.name} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
    continue;
  }
  console.log(`下载 ${asset.name} …`);
  await fetchToFile(asset.url, dest);
  console.log(`完成: ${dest}`);
}
console.log('GNM 基底准备完毕。');
