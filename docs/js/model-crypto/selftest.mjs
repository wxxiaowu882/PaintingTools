#!/usr/bin/env node
/** 统一包自测：往返、魔数、拒认真 PNG */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  encryptGlb,
  decryptToGlb,
  toGlbArrayBuffer,
  isOurContainer,
  isProbablyGlb,
  MAGIC,
  FAKE_EXT
} from './ModelCrypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
}

async function main() {
  // 1) 合成假 GLB 头 + payload
  const fakeGlb = new Uint8Array(64);
  fakeGlb[0] = 0x67;
  fakeGlb[1] = 0x6c;
  fakeGlb[2] = 0x54;
  fakeGlb[3] = 0x46;
  fakeGlb[4] = 2;
  for (let i = 12; i < 64; i++) fakeGlb[i] = i & 0xff;

  const enc = await encryptGlb(fakeGlb);
  const encU8 = new Uint8Array(enc);
  assert(isOurContainer(encU8), '密文应识别为 PTGL');
  assert(!isProbablyGlb(encU8), '密文不应被当成 glb');
  assert(encU8[0] === MAGIC[0] && encU8[3] === MAGIC[3], '魔数 PTGL');

  const dec = await decryptToGlb(encU8);
  const decU8 = new Uint8Array(dec);
  assert(decU8.byteLength === fakeGlb.byteLength, '往返长度一致');
  for (let i = 0; i < fakeGlb.byteLength; i++) {
    assert(decU8[i] === fakeGlb[i], '往返字节一致 @' + i);
  }

  const passthrough = await toGlbArrayBuffer(fakeGlb);
  assert(new Uint8Array(passthrough)[0] === 0x67, '明文 toGlb 原样');

  // 2) 真 PNG 签名不应被当成我们的容器
  const realPngSig = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  ]);
  assert(!isOurContainer(realPngSig), '真 PNG 签名不是 PTGL');

  // 3) 若仓库有样例 glb，做真实往返
  const sample = path.join(repoRoot, 'docs/m/whale_scan_face_std_opt.glb');
  let sampleOk = null;
  if (fs.existsSync(sample)) {
    const raw = new Uint8Array(fs.readFileSync(sample));
    assert(isProbablyGlb(raw), '样例应为 glb');
    const t0 = Date.now();
    const e2 = await encryptGlb(raw);
    const t1 = Date.now();
    const d2 = new Uint8Array(await decryptToGlb(e2));
    const t2 = Date.now();
    assert(d2.byteLength === raw.byteLength, '样例往返长度');
    for (let i = 0; i < Math.min(256, raw.byteLength); i++) {
      assert(d2[i] === raw[i], '样例头一致');
    }
    // 抽查尾部
    for (let i = raw.byteLength - 64; i < raw.byteLength; i++) {
      if (i < 0) continue;
      assert(d2[i] === raw[i], '样例尾一致');
    }
    sampleOk = {
      file: path.basename(sample),
      bytes: raw.byteLength,
      encBytes: e2.byteLength,
      encryptMs: t1 - t0,
      decryptMs: t2 - t1,
      fakeExt: FAKE_EXT
    };
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        fakeExt: FAKE_EXT,
        sample: sampleOk
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
