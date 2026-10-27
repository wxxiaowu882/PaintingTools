/**
 * 拦截 /docs/json/*：三大沙盒课表按会员会话过滤；其它 JSON 原样走 ASSETS。
 * 使用 ASSETS.fetch 读取磁盘权威文件（不手改 docs/json）。
 */
import {
  isProtectedCatalogPath,
  sandboxFromCatalogPath,
  loadFilteredCatalog
} from '../../membership/policy.js';
import { accessLevel, readEntitlementFromRequest } from '../../membership/session.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch (_e) {}

  if (!isProtectedCatalogPath(pathname)) {
    return context.env.ASSETS.fetch(context.request);
  }

  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const sandbox = sandboxFromCatalogPath(pathname) || 'geometry';
  const ent = await readEntitlementFromRequest(context.request, context.env);
  const level = accessLevel(ent);

  try {
    const scenes = await loadFilteredCatalog(context, sandbox, level);
    const body = JSON.stringify(scenes);
    return new Response(context.request.method === 'HEAD' ? null : body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Membership-Catalog': level,
        'X-Membership-Access': level
      }
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'catalog_filter_failed', message: String(e && e.message) }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      }
    );
  }
}
