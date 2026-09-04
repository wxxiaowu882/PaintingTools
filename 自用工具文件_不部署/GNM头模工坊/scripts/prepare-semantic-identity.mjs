/**
 * 下载官方 IdentitySampler decoder，并转为浏览器可用权重。
 *
 * 用法（在 GNM头模工坊 目录）:
 *   node scripts/prepare-semantic-identity.mjs
 *
 * 依赖: Python3 + pip install numpy h5py
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../data/gnm');
const H5_NAME = 'identity_decoder_model.h5';
const H5_URL =
  'https://raw.githubusercontent.com/google/GNM/main/gnm/shape/data/semantic_sampler/identity_decoder_model.h5';
const META_NAME = 'semantic_identity_meta.json';
const BIN_NAME = 'semantic_identity_weights.bin';

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

function runPython(h5Path) {
  const script = path.join(__dirname, 'convert-identity-decoder.py');
  const candidates = ['python', 'python3', 'py'];
  let lastErr = null;
  for (const cmd of candidates) {
    const args = cmd === 'py' ? ['-3', script, h5Path] : [script, h5Path];
    const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.error) {
      lastErr = r.error;
      continue;
    }
    if (r.status === 0) return;
    lastErr = new Error(`${cmd} exited ${r.status}`);
  }
  throw lastErr || new Error('无法运行 Python 转换脚本（需 numpy + h5py）');
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const h5Path = path.join(OUT_DIR, H5_NAME);
const metaPath = path.join(OUT_DIR, META_NAME);
const binPath = path.join(OUT_DIR, BIN_NAME);

const binReady =
  fs.existsSync(binPath) &&
  fs.existsSync(metaPath) &&
  fs.statSync(binPath).size > 100_000;

if (binReady) {
  console.log(`已存在，跳过转换: ${BIN_NAME} (${(fs.statSync(binPath).size / 1e6).toFixed(2)} MB)`);
  process.exit(0);
}

if (!fs.existsSync(h5Path) || fs.statSync(h5Path).size < 100_000) {
  console.log(`下载 ${H5_NAME} …`);
  await fetchToFile(H5_URL, h5Path);
} else {
  console.log(`已有 h5，跳过下载: ${H5_NAME}`);
}

console.log('转换 Dense 权重 …');
runPython(h5Path);

try {
  fs.unlinkSync(h5Path);
  console.log('已删除临时 h5');
} catch (_) {
  /* ignore */
}

console.log('语义身份采样权重准备完毕。');
console.log(`  ${metaPath}`);
console.log(`  ${binPath}`);
