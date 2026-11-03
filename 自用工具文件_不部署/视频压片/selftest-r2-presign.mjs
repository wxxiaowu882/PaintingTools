/**
 * 本地自测 R2 SigV4 短时签名形状（不访问网络、不建桶）
 *   node 自用工具文件_不部署/视频压片/selftest-r2-presign.mjs
 */
import {
  encodeS3Path,
  isR2PresignConfigured,
  objectKeyForLesson,
  presignR2GetUrl
} from '../../functions/course/r2-presign.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const fixedNow = new Date('2026-11-03T12:00:00.000Z');

assert(encodeS3Path('course/71/v1/main.mp4') === 'course/71/v1/main.mp4', 'simple path');
assert(encodeS3Path('a b/c').includes('%20'), 'space encode');

assert(!isR2PresignConfigured({}), 'empty env');
assert(
  isR2PresignConfigured({
    COURSE_R2_ACCOUNT_ID: 'acc',
    COURSE_R2_ACCESS_KEY_ID: 'ak',
    COURSE_R2_SECRET_ACCESS_KEY: 'sk',
    COURSE_R2_BUCKET: 'bucket'
  }),
  'full env'
);

assert(objectKeyForLesson('71', {}) === 'course/71/v1/main.mp4', 'default key');
assert(
  objectKeyForLesson('71', { COURSE_LESSON_KEY_JSON: '{"71":"course/71/v2/main.mp4"}' }) ===
    'course/71/v2/main.mp4',
  'map override'
);

const signed = await presignR2GetUrl({
  accountId: 'abcdef0123456789abcdef0123456789',
  accessKeyId: 'AKIA_TEST',
  secretAccessKey: 'secret_test_value_not_real',
  bucket: 'wuxiao-course-staging',
  key: 'course/demo/v1/main.mp4',
  expiresIn: 600,
  now: fixedNow
});

assert(signed.url.startsWith('https://abcdef0123456789abcdef0123456789.r2.cloudflarestorage.com/'), 'host');
assert(signed.url.includes('/wuxiao-course-staging/course/demo/v1/main.mp4?'), 'path');
assert(signed.url.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256'), 'algo');
assert(signed.url.includes('X-Amz-Expires=600'), 'ttl');
assert(/X-Amz-Signature=[0-9a-f]{64}/.test(signed.url), 'sig hex64');
assert(signed.ttlSec === 600, 'ttlSec');
assert(signed.key === 'course/demo/v1/main.mp4', 'key echo');

// 同一输入应稳定（同 now）
const signed2 = await presignR2GetUrl({
  accountId: 'abcdef0123456789abcdef0123456789',
  accessKeyId: 'AKIA_TEST',
  secretAccessKey: 'secret_test_value_not_real',
  bucket: 'wuxiao-course-staging',
  key: 'course/demo/v1/main.mp4',
  expiresIn: 600,
  now: fixedNow
});
assert(signed.url === signed2.url, 'deterministic');

console.log('[ok] r2-presign selftest passed');
console.log('[sample]', signed.url.slice(0, 120) + '…');
