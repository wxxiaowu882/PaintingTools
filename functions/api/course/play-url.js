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

  // 正式站：未配 R2 前不开放；已配则至少要登录（细档位后续接 C6）
  if (!staging && !local) {
    if (!r2Ready) {
      return jsonResponse(
        { ok: false, error: '正课播放尚未开放', code: 'not_ready', lessonId },
        503
      );
    }
    if (level === 'guest') {
      return jsonResponse({ ok: false, error: '请先登录', code: 'auth_required', lessonId }, 401);
    }
  }

  // 显式 demo 课：始终本机/相对路径（方便 UI 联调，不消耗 R2）
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
        ? 'demo 课强制本地样片路径'
        : '未配置 COURSE_R2_*；返回本地/测站 demo 路径（测站若无静态文件则播放器回退占位壳）'
    });
  }

  if (!r2Ready) {
    return jsonResponse(
      { ok: false, error: '正课播放尚未开放', code: 'not_ready', lessonId },
      503
    );
  }

  try {
    const signed = await presignFromEnv(context.env, lessonId);
    if (!signed) {
      return jsonResponse(
        { ok: false, error: '无法生成播放地址', code: 'presign_failed', lessonId },
        500
      );
    }
    return jsonResponse({
      ok: true,
      lessonId,
      url: signed.url,
      expiresAt: signed.expiresAt,
      ttlSec: signed.ttlSec,
      source: 'r2',
      key: signed.key || objectKeyForLesson(lessonId, context.env),
      accessLevel: level,
      note: '短时 R2 GET；到期前请再调本接口续签。桶须配 CORS。'
    });
  } catch (e) {
    return jsonResponse(
      {
        ok: false,
        error: '签名失败',
        code: 'presign_error',
        lessonId,
        detail: String(e && e.message ? e.message : e)
      },
      500
    );
  }
}
