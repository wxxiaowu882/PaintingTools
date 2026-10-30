#!/usr/bin/env node
/**
 * 模型加解密 CLI（与浏览器共用 ModelCrypto.js）
 * 用法：
 *   node docs/js/model-crypto/cli.mjs encrypt <in.glb> <out.png>
 *   node docs/js/model-crypto/cli.mjs decrypt <in.png> <out.glb>
 *   node docs/js/model-crypto/cli.mjs info <file>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  encryptGlb,
  decryptToGlb,
  isOurContainer,
  isProbablyGlb,
  FAKE_EXT,
  PLAIN_EXT,
  MODEL_CRYPTO_VERSION
} from './ModelCrypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(`ModelCrypto CLI v${MODEL_CRYPTO_VERSION}
  encrypt <in.glb> [out${FAKE_EXT}]
  decrypt <in${FAKE_EXT}> [out${PLAIN_EXT}]
  info <file>`);
}

async function main() {
  const [cmd, inPath, outPathArg] = process.argv.slice(2);
  if (!cmd || cmd === '-h' || cmd === '--help') {
    usage();
    process.exit(cmd ? 0 : 1);
  }
  if (!inPath) {
    usage();
    process.exit(1);
  }
  const absIn = path.resolve(inPath);
  const input = new Uint8Array(fs.readFileSync(absIn));

  if (cmd === 'info') {
    console.log(
      JSON.stringify(
        {
          file: absIn,
          bytes: input.byteLength,
          isOurContainer: isOurContainer(input),
          isProbablyGlb: isProbablyGlb(input),
          fakeExt: FAKE_EXT,
          plainExt: PLAIN_EXT
        },
        null,
        2
      )
    );
    return;
  }

  if (cmd === 'encrypt') {
    const out =
      outPathArg ||
      absIn.replace(/\.glb$/i, FAKE_EXT) ||
      absIn + FAKE_EXT;
    const absOut = path.resolve(out);
    const enc = await encryptGlb(input);
    fs.writeFileSync(absOut, Buffer.from(enc));
    console.log(
      JSON.stringify({
        ok: true,
        cmd: 'encrypt',
        in: absIn,
        out: absOut,
        inBytes: input.byteLength,
        outBytes: enc.byteLength
      })
    );
    return;
  }

  if (cmd === 'decrypt') {
    const out =
      outPathArg ||
      absIn.replace(/\.png$/i, PLAIN_EXT) ||
      absIn + PLAIN_EXT;
    const absOut = path.resolve(out);
    const dec = await decryptToGlb(input);
    fs.writeFileSync(absOut, Buffer.from(dec));
    console.log(
      JSON.stringify({
        ok: true,
        cmd: 'decrypt',
        in: absIn,
        out: absOut,
        inBytes: input.byteLength,
        outBytes: dec.byteLength,
        isProbablyGlb: isProbablyGlb(dec)
      })
    );
    return;
  }

  console.error('未知命令:', cmd);
  usage();
  process.exit(1);
}

main().catch((e) => {
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
});
