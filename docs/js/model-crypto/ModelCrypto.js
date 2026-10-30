/**
 * PaintingTools 模型加解密统一包（浏览器 + Node 共用，Web Crypto AES-256-GCM）。
 * 口径：docs/站点安全配置.md §6～§8
 *
 * - .glb  → 明文，调用方直接播
 * - .png  → 假后缀密文（魔数 PTGL，非合法 PNG）
 *
 * 一改全改：禁止其它文件复制算法。
 */

export const MODEL_CRYPTO_VERSION = 1;
/** ASCII "PTGL" — PaintingTools GLB container（故意不是 PNG 签名） */
export const MAGIC = new Uint8Array([0x50, 0x54, 0x47, 0x4c]);
export const FAKE_EXT = '.png';
export const PLAIN_EXT = '.glb';

const HEADER_LEN = 20; // magic4 + ver1 + flags1 + reserved2 + iv12
const IV_LEN = 12;
const GCM_TAG_LEN = 16;

/** 第一版固定钥材料（2A：游客可播；客户端可见属预期）。只改这一处。 */
const KEY_MATERIAL = 'wuxiaoart-model-container-v1';

function getSubtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('ModelCrypto: Web Crypto subtle 不可用');
  }
  return c.subtle;
}

function getRandomIv() {
  const iv = new Uint8Array(IV_LEN);
  globalThis.crypto.getRandomValues(iv);
  return iv;
}

async function getAesKey() {
  const subtle = getSubtle();
  const raw = await subtle.digest('SHA-256', new TextEncoder().encode(KEY_MATERIAL));
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function asUint8(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (ArrayBuffer.isView(buf)) {
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  throw new Error('ModelCrypto: 需要 ArrayBuffer / TypedArray');
}

/**
 * 是否为我们的密文容器（看魔数+版本，不看后缀）。
 * @param {ArrayBuffer|Uint8Array} buf
 */
export function isOurContainer(buf) {
  const u8 = asUint8(buf);
  if (u8.byteLength < HEADER_LEN + GCM_TAG_LEN) return false;
  for (let i = 0; i < 4; i++) {
    if (u8[i] !== MAGIC[i]) return false;
  }
  if (u8[4] !== MODEL_CRYPTO_VERSION) return false;
  return true;
}

/**
 * 是否像标准 GLB（glTF 二进制魔数）。
 * @param {ArrayBuffer|Uint8Array} buf
 */
export function isProbablyGlb(buf) {
  const u8 = asUint8(buf);
  // 'glTF' = 67 6C 54 46
  return (
    u8.byteLength >= 12 &&
    u8[0] === 0x67 &&
    u8[1] === 0x6c &&
    u8[2] === 0x54 &&
    u8[3] === 0x46
  );
}

function buildAad(version, flags) {
  // 绑定版本与 flags，防头篡改
  return new Uint8Array([version & 0xff, flags & 0xff]);
}

/**
 * 明文 GLB → 密文容器（假后缀 .png 的内容）。
 * @param {ArrayBuffer|Uint8Array} glbBuffer
 * @returns {Promise<ArrayBuffer>}
 */
export async function encryptGlb(glbBuffer) {
  const plain = asUint8(glbBuffer);
  if (!isProbablyGlb(plain)) {
    // 仍允许加密任意 buffer（工具链弹性），但警告由调用方处理
  }
  const subtle = getSubtle();
  const key = await getAesKey();
  const iv = getRandomIv();
  const flags = 0;
  const aad = buildAad(MODEL_CRYPTO_VERSION, flags);
  const cipherBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    key,
    plain
  );
  const cipher = new Uint8Array(cipherBuf);
  const out = new Uint8Array(HEADER_LEN + cipher.byteLength);
  out.set(MAGIC, 0);
  out[4] = MODEL_CRYPTO_VERSION;
  out[5] = flags;
  out[6] = 0;
  out[7] = 0;
  out.set(iv, 8);
  out.set(cipher, HEADER_LEN);
  return out.buffer;
}

/**
 * 密文容器 → 明文 GLB ArrayBuffer。
 * @param {ArrayBuffer|Uint8Array} container
 * @returns {Promise<ArrayBuffer>}
 */
export async function decryptToGlb(container) {
  const u8 = asUint8(container);
  if (!isOurContainer(u8)) {
    throw new Error('ModelCrypto: 不是 PTGL 密文容器');
  }
  const version = u8[4];
  const flags = u8[5];
  if (version !== MODEL_CRYPTO_VERSION) {
    throw new Error('ModelCrypto: 不支持的容器版本 ' + version);
  }
  const iv = u8.subarray(8, 8 + IV_LEN);
  const cipher = u8.subarray(HEADER_LEN);
  const subtle = getSubtle();
  const key = await getAesKey();
  const aad = buildAad(version, flags);
  try {
    return await subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      key,
      cipher
    );
  } catch (_e) {
    throw new Error('ModelCrypto: 解密失败（损坏或密钥不匹配）');
  }
}

/**
 * 按内容自动：密文则解密，否则原样返回（供播放器双轨）。
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {Promise<ArrayBuffer>}
 */
export async function toGlbArrayBuffer(buf) {
  const u8 = asUint8(buf);
  if (isOurContainer(u8)) {
    return decryptToGlb(u8);
  }
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

/**
 * 拉取 URL：自动识别密文/明文。
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<ArrayBuffer>}
 */
export async function loadModelUrl(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error('ModelCrypto: 加载失败 HTTP ' + res.status + ' ' + url);
  }
  const buf = await res.arrayBuffer();
  return toGlbArrayBuffer(buf);
}

/** 路径 .glb → .png */
export function toFakeExtPath(pathOrUrl) {
  return String(pathOrUrl).replace(/\.glb(\?|#|$)/i, `${FAKE_EXT}$1`);
}

/** 路径 .png → .glb（仅改后缀字符串，不解密） */
export function toPlainExtPath(pathOrUrl) {
  return String(pathOrUrl).replace(/\.png(\?|#|$)/i, `${PLAIN_EXT}$1`);
}

export const ModelCrypto = {
  MODEL_CRYPTO_VERSION,
  MAGIC,
  FAKE_EXT,
  PLAIN_EXT,
  isOurContainer,
  isProbablyGlb,
  encryptGlb,
  decryptToGlb,
  toGlbArrayBuffer,
  loadModelUrl,
  toFakeExtPath,
  toPlainExtPath
};

export default ModelCrypto;
