/**
 * 课包门禁（C12）：登录账号须持有 packId；与 Pro 是否在期脱钩。
 * packId 与 docs/course/packs.json、课表 courseId 对齐。
 */

import { loadAccount, accountHasCoursePack } from '../membership/accounts.js';

/** 当前唯一试播课包；日后多课包时以 query courseId/packId 为准，或读课表映射 */
export const DEFAULT_DEMO_PACK_ID = 'watercolor-portrait-demo';

/**
 * @param {URL} url
 * @param {string} lessonId
 */
export function resolvePackIdFromRequest(url, lessonId) {
  const q = String(
    (url && url.searchParams.get('courseId')) ||
      (url && url.searchParams.get('packId')) ||
      ''
  ).trim();
  if (q) return q;
  // smoke / demo 课表同属 watercolor-portrait-demo
  void lessonId;
  return DEFAULT_DEMO_PACK_ID;
}

/**
 * @returns {Promise<{ ok: true, packId: string } | { ok: false, status: number, body: object }>}
 */
export async function requireCoursePack(env, entitlement, packId) {
  const id = String(packId || '').trim();
  if (!id) {
    return {
      ok: false,
      status: 400,
      body: { ok: false, error: '缺少课包', code: 'missing_pack' }
    };
  }
  const accountId = entitlement && entitlement.accountId;
  if (!accountId) {
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        error: '请先登录',
        code: 'auth_required',
        packId: id
      }
    };
  }
  let acct = null;
  try {
    acct = await loadAccount(env, accountId);
  } catch (_e) {
    acct = null;
  }
  if (!acct) {
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        error: '请先登录',
        code: 'auth_required',
        packId: id
      }
    };
  }
  if (!accountHasCoursePack(acct, id)) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: '未开通本课，请联系运营',
        code: 'pack_required',
        packId: id
      }
    };
  }
  return { ok: true, packId: id };
}
