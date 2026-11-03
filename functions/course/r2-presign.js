/**
 * R2 S3 兼容短时 GET 签名（AWS SigV4 query auth）
 * 不依赖 aws4fetch / AWS SDK，便于 Pages Functions 直用。
 *
 * 需要的 env（Secrets / vars，未配齐则视为未启用）：
 * - COURSE_R2_ACCOUNT_ID
 * - COURSE_R2_ACCESS_KEY_ID
 * - COURSE_R2_SECRET_ACCESS_KEY
 * - COURSE_R2_BUCKET
 * 可选：
 * - COURSE_R2_TTL_SEC（默认 600，上限 3600）
 *
 * 说明：R2 Worker binding **不能**签浏览器用的短时 URL；须用 R2 S3 API Token。
 * 浏览器直链还须给桶配 CORS（允许我们的域 GET/HEAD + Range）。
 */

const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
  const dig = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return toHex(dig);
}

async function hmac(key, data) {
  const raw = typeof key === 'string' ? enc.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign'
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data)));
}

/** 路径分段编码（保留 `/` 分隔） */
export function encodeS3Path(key) {
  return String(key || '')
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

export function isR2PresignConfigured(env) {
  if (!env) return false;
  return !!(
    env.COURSE_R2_ACCOUNT_ID &&
    env.COURSE_R2_ACCESS_KEY_ID &&
    env.COURSE_R2_SECRET_ACCESS_KEY &&
    env.COURSE_R2_BUCKET
  );
}

export function objectKeyForLesson(lessonId, env) {
  const id = String(lessonId || '').trim();
  if (!id) return null;
  // 可选：COURSE_LESSON_KEY_JSON = {"71":"course/71/v1/main.mp4"}
  try {
    const raw = env && env.COURSE_LESSON_KEY_JSON;
    if (raw) {
      const map = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (map && map[id]) return String(map[id]).replace(/^\/+/, '');
    }
  } catch (_e) {
    /* ignore bad json */
  }
  return `course/${id}/v1/main.mp4`;
}

/**
 * @param {object} opts
 * @param {string} opts.accountId
 * @param {string} opts.accessKeyId
 * @param {string} opts.secretAccessKey
 * @param {string} opts.bucket
 * @param {string} opts.key
 * @param {number} [opts.expiresIn=600]
 * @param {Date} [opts.now]
 * @returns {Promise<{ url: string, expiresAt: string, ttlSec: number, key: string }>}
 */
export async function presignR2GetUrl(opts) {
  const accountId = String(opts.accountId || '').trim();
  const accessKeyId = String(opts.accessKeyId || '').trim();
  const secretAccessKey = String(opts.secretAccessKey || '').trim();
  const bucket = String(opts.bucket || '').trim();
  const key = String(opts.key || '').replace(/^\/+/, '');
  let expiresIn = Number(opts.expiresIn || 600);
  if (!Number.isFinite(expiresIn) || expiresIn < 30) expiresIn = 600;
  if (expiresIn > 3600) expiresIn = 3600;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !key) {
    throw new Error('presign_missing_config');
  }

  const now = opts.now instanceof Date ? opts.now : new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;

  const canonicalUri = `/${encodeS3Path(bucket)}/${encodeS3Path(key)}`;
  const params = new Map([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', credential],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(Math.floor(expiresIn))],
    ['X-Amz-SignedHeaders', 'host']
  ]);
  const canonicalQuery = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const payloadHash = 'UNSIGNED-PAYLOAD';
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'host',
    payloadHash
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n');

  const kDate = await hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  const url = `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  const expiresAt = new Date(now.getTime() + expiresIn * 1000).toISOString();
  return { url, expiresAt, ttlSec: Math.floor(expiresIn), key };
}

export async function presignFromEnv(env, lessonId) {
  if (!isR2PresignConfigured(env)) return null;
  const key = objectKeyForLesson(lessonId, env);
  if (!key) return null;
  const ttl = Number(env.COURSE_R2_TTL_SEC || 600);
  return presignR2GetUrl({
    accountId: env.COURSE_R2_ACCOUNT_ID,
    accessKeyId: env.COURSE_R2_ACCESS_KEY_ID,
    secretAccessKey: env.COURSE_R2_SECRET_ACCESS_KEY,
    bucket: env.COURSE_R2_BUCKET,
    key,
    expiresIn: ttl
  });
}
