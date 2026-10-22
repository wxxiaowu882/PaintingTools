import { jsonResponse } from '../../membership/session.js';
import { loadPolicy, loadTiers } from '../../membership/policy.js';

/** 公开可读：价格与权限策略（不含密钥）。供兑换页 / Solid 客户端与运营台保存后立即一致。 */
export async function onRequestGet(context) {
  try {
    const policy = await loadPolicy(context);
    const tiers = await loadTiers(context);
    delete policy._source;
    delete tiers._source;
    return jsonResponse({ ok: true, policy, tiers });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e && e.message) }, 500);
  }
}
