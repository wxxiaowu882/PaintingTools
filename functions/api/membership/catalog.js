import { loadFilteredCatalogList, loadCatalogThumbsBatch } from '../../membership/policy.js';
import { isMember, jsonResponse, readEntitlementFromRequest } from '../../membership/session.js';

/**
 * 课表列表（轻量）：默认不含 items/标注，也不下发 dataURL 缩略图，保证首屏可进。
 * ?thumbs=1&offset=&limit= → 仅返回该批 {name,thumbnail}，供列表逐步补图。
 */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sandbox = (url.searchParams.get('sandbox') || 'geometry').toLowerCase();
  const includeThumb = url.searchParams.get('thumbs') === '1';
  const ent = await readEntitlementFromRequest(context.request, context.env);
  const member = isMember(ent);

  try {
    if (includeThumb) {
      const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw != null && limitRaw !== '' ? parseInt(limitRaw, 10) : 10;
      const batch = await loadCatalogThumbsBatch(context, sandbox, offset, limit);
      return jsonResponse(
        {
          ok: true,
          sandbox,
          member,
          thumbs: true,
          batch: true,
          total: batch.total,
          offset: batch.offset,
          nextOffset: batch.nextOffset,
          done: batch.done,
          items: batch.items
        },
        200,
        { 'Cache-Control': 'private, max-age=60' }
      );
    }

    const data = await loadFilteredCatalogList(context, sandbox, member, false);
    return jsonResponse(
      {
        ok: true,
        sandbox,
        member,
        listOnly: true,
        thumbs: false,
        scenes: data
      },
      200,
      {
        'Cache-Control': 'private, max-age=30'
      }
    );
  } catch (e) {
    return jsonResponse(
      { ok: false, error: '课表加载失败', detail: String(e && e.message ? e.message : e) },
      500
    );
  }
}
