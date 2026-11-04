import { requireAdmin, jsonResponse } from '../../../membership/admin-auth.js';
import {
  adminFindByPhone,
  adminListAccounts,
  adminResetPassword,
  adminUpdateNote,
  adminRemoveDevice,
  adminExtendMember,
  adminRevokeMember,
  adminGrantCourseStudent,
  adminRevokeCoursePack
} from '../../../membership/accounts.js';
import { accessLevel, normalizeEntitlement } from '../../../membership/session.js';
import { referralSummaryForAdmin } from '../../../membership/referral.js';
import { loadAccount } from '../../../membership/accounts.js';

async function enrich(account, env) {
  if (!account) return null;
  const ent = normalizeEntitlement(account.entitlement || null);
  let referral = null;
  try {
    const full = env && account.accountId ? await loadAccount(env, account.accountId) : null;
    referral = referralSummaryForAdmin(full || account);
  } catch (_e) {
    referral = referralSummaryForAdmin(account);
  }
  return Object.assign({}, account, {
    entitlement: ent,
    accessLevel: accessLevel(Object.assign({}, ent, { accountId: account.accountId })),
    referral
  });
}

/** GET ?phone= → 查单账号；无 phone → 列表（客户端再筛，少打接口） */
export async function onRequestGet(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;
  const url = new URL(context.request.url);
  const phone = url.searchParams.get('phone') || '';
  if (phone) {
    const result = await adminFindByPhone(context.env, phone);
    if (!result.ok) return jsonResponse(result, 404);
    return jsonResponse({ ok: true, account: await enrich(result.account, context.env) });
  }
  const cursor = url.searchParams.get('cursor') || '';
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw != null && limitRaw !== '' ? parseInt(limitRaw, 10) : undefined;
  const result = await adminListAccounts(context.env, {
    cursor: cursor || undefined,
    limit,
    singlePage: !!cursor
  });
  if (!result.ok) return jsonResponse(result, 503);
  const accounts = [];
  for (const a of result.accounts || []) {
    accounts.push(await enrich(a, context.env));
  }
  return jsonResponse({
    ok: true,
    accounts,
    cursor: result.cursor || null,
    truncated: !!result.truncated
  });
}

/**
 * POST body:
 * { action: 'reset_password', phone, password }
 * { action: 'update_note', phone, wechatNote }
 * { action: 'remove_device', phone, deviceId }
 * { action: 'extend_days', phone, days }
 * { action: 'revoke_member', phone }
 * { action: 'grant_course_student', phone, packId, packTitle?, password?, displayName?, wechatNote? }
 * { action: 'revoke_course_pack', phone, packId }
 */
export async function onRequestPost(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;
  let body;
  try {
    body = await context.request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: '请求无效' }, 400);
  }
  const action = String((body && body.action) || '').trim();
  const phone = (body && body.phone) || '';

  if (action === 'reset_password') {
    const result = await adminResetPassword(context.env, phone, body.password);
    if (!result.ok) return jsonResponse(result, 400);
    return jsonResponse({
      ok: true,
      account: await enrich(result.account, context.env),
      tip: '密码已重置'
    });
  }
  if (action === 'update_note') {
    const result = await adminUpdateNote(context.env, phone, body.wechatNote);
    if (!result.ok) return jsonResponse(result, 400);
    return jsonResponse({
      ok: true,
      account: await enrich(result.account, context.env),
      tip: '备注已更新'
    });
  }
  if (action === 'remove_device') {
    const result = await adminRemoveDevice(context.env, phone, body.deviceId);
    if (!result.ok) return jsonResponse(result, 400);
    return jsonResponse({
      ok: true,
      account: await enrich(result.account, context.env),
      tip: '已踢掉该设备'
    });
  }
  if (action === 'extend_days') {
    const result = await adminExtendMember(context.env, phone, body.days);
    if (!result.ok) return jsonResponse(result, 400);
    return jsonResponse({
      ok: true,
      account: await enrich(result.account, context.env),
      tip: '已延期'
    });
  }
  if (action === 'revoke_member') {
    const result = await adminRevokeMember(context.env, phone);
    if (!result.ok) return jsonResponse(result, 400);
    return jsonResponse({
      ok: true,
      account: await enrich(result.account, context.env),
      tip: '已取消高级会员'
    });
  }
  if (action === 'grant_course_student') {
    const result = await adminGrantCourseStudent(context.env, {
      phone,
      packId: body && body.packId,
      packTitle: body && body.packTitle,
      password: body && body.password,
      displayName: body && body.displayName,
      wechatNote: body && body.wechatNote
    });
    if (!result.ok) return jsonResponse(result, 400);
    const tips = [];
    if (result.created) tips.push('已新开账号');
    else tips.push('已写入现有账号');
    if (result.alreadyHadPack) tips.push('课包原本已有（仍重算三年 Pro）');
    else tips.push('已追加课包');
    tips.push('Pro 自今日起三年');
    return jsonResponse({
      ok: true,
      created: !!result.created,
      alreadyHadPack: !!result.alreadyHadPack,
      initialPassword: result.initialPassword || null,
      account: await enrich(result.account, context.env),
      tip: tips.join('；')
    });
  }
  if (action === 'revoke_course_pack') {
    const result = await adminRevokeCoursePack(context.env, phone, body && body.packId);
    if (!result.ok) return jsonResponse(result, 400);
    return jsonResponse({
      ok: true,
      account: await enrich(result.account, context.env),
      tip: '已取消该课包（未改 Pro）'
    });
  }
  return jsonResponse({ ok: false, error: '未知操作' }, 400);
}
