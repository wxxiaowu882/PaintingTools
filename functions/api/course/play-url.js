/**
 * GET /api/course/play-url?lessonId=xxx
 *
 * 阶段 C · C3 短时播放许可
 * - 配齐 COURSE_R2_* Secrets → 返回 R2 短时 GET URL（source:r2）
 * - 未配置 → 测站/本机 demo 回退；正式站未就绪则 503
 *
 * 响应成功：
 *   { ok, lessonId, url, expiresAt, ttlSec, source: 'demo'|'r2', key?, accessLevel, note? }
 */
import { jsonResponse, readEntitlementFromRequest, accessLevel } from '../../membership/session.js';
import {
  isR2PresignConfigured,
  objectKeyForLesson,
  presignFromEnv
} from '../../course/r2-presign.js';
import { requireCoursePack, resolvePackIdFromRequest } from '../../course/pack-access.js';

const DEMO_TTL_SEC = 600;

function isStagingHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'test.wuxiaoart.com' || h.includes('soft-voice-f822-staging');
}

function isLocalHost(host) {
  const h = String(host || '').toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') return true;
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
}

function demoUrlForLesson(lessonId) {
  const id = String(lessonId || 'demo').toLowerCase();
  if (id === 'demo-vert') {
    return '/自用工具文件_不部署/视频压片/samples/demo-vert-preview.mp4';
  }
  return '/自用工具文件_不部署/视频压片/samples/demo-land-1080.mp4';
}

function wantDemoLesson(lessonId) {
  return String(lessonId || '')
    .toLowerCase()
    .startsWith('demo');
}

function isCourseLearnPublic(env) {
  return String((env && env.COURSE_LEARN_PUBLIC) || '') === '1';
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const host = url.hostname;
  const lessonId = (url.searchParams.get('lessonId') || url.searchParams.get('lesson') || '').trim();
  if (!lessonId) {
    return jsonResponse({ ok: false, error: '缺少 lessonId', code: 'missing_lesson' }, 400);
  }

  const staging = isStagingHost(host);
  const local = isLocalHost(host);
  const ent = await readEntitlementFromRequest(context.request, context.env);
  const level = accessLevel(ent);
  const r2Ready = isR2PresignConfigured(context.env);

  // 正式站：与学习页同口径——未对公开放前一律不签发（即使已配 R2）
  if (!staging && !local && !isCourseLearnPublic(context.env)) {
    return jsonResponse(
      { ok: false, error: '正课播放尚未开放', code: 'not_ready', lessonId },
      503
    );
  }

  // 正式站已开放但仍未配 R2：仍 503
  if (!staging && !local && !r2Ready) {
    return jsonResponse(
      { ok: false, error: '正课播放尚未开放', code: 'not_ready', lessonId },
      503
    );
  }

  // 显式 demo 课 / 未配 R2 的本地测站回退：仍本机样片，方便搭 UI（不验课包）
  if (wantDemoLesson(lessonId) || (!r2Ready && (staging || local))) {
    const ttlSec = DEMO_TTL_SEC;
    return jsonResponse({
      ok: true,
      lessonId,
      url: demoUrlForLesson(lessonId),
      expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
      ttlSec,
      source: 'demo',
      accessLevel: level,
      note: r2Ready
        ? 'demo 课强制本地样片路径（不验课包）'
        : '未配置 COURSE_R2_*；返回本地/测站 demo 路径（不验课包）'
    });
  }

  if (!r2Ready) {
    return jsonResponse(
      { ok: false, error: '正课播放尚未开放', code: 'not_ready', lessonId },
      503
    );
  }

  // 正课短时链：登录 + 课包清单（Pro 在期 ≠ 自动拥有；Pro 过期仍可凭课包播）
  const packId = resolvePackIdFromRequest(url, lessonId);
  const packGate = await requireCoursePack(context.env, ent, packId);
  if (!packGate.ok) {
    return jsonResponse(
      Object.assign({ lessonId }, packGate.body),
      packGate.status
    );
  }

  try {
    const signed = await presignFromEnv(context.env, lessonId);
    if (!signed) {
      return jsonResponse(
        { ok: false, error: '无法生成播放地址', code: 'presign_failed', lessonId, packId },
        500
      );
    }
    return jsonResponse({
      ok: true,
      lessonId,
      packId,
      url: signed.url,
      expiresAt: signed.expiresAt,
      ttlSec: signed.ttlSec,
      source: 'r2',
      key: signed.key || objectKeyForLesson(lessonId, context.env),
      accessLevel: level,
      note: '短时 R2 GET；已验课包。到期前请再调本接口续签。桶须配 CORS。'
    });
  } catch (e) {
    return jsonResponse(
      {
        ok: false,
        error: '签名失败',
        code: 'presign_error',
        lessonId,
        packId,
        detail: String(e && e.message ? e.message : e)
      },
      500
    );
  }
}
