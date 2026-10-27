/**
 * 安卓 App APK 下载：强制 attachment，避免手机浏览器把包当空白页打开。
 * 文件名带版本号（读 android-shell-update.json 的 versionName）。
 * GET/HEAD /api/android-apk
 */
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const origin = new URL(request.url).origin;

  let versionName = '';
  try {
    const metaRes = await env.ASSETS.fetch(
      new Request(new URL('/docs/app/android-shell-update.json', origin), {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' }
      })
    );
    if (metaRes && metaRes.ok) {
      const meta = await metaRes.json();
      if (meta && meta.versionName) versionName = String(meta.versionName).trim();
    }
  } catch (_e) {}

  const displayBase = versionName ? `手绘工坊-${versionName}` : '手绘工坊';
  const asciiFallback = versionName
    ? `shouhui-gongfang-${versionName}.apk`
    : 'shouhui-gongfang.apk';
  const utf8Name = encodeURIComponent(`${displayBase}.apk`);

  const assetReq = new Request(new URL('/docs/app/wuxiao-workshop.apk', origin), {
    method: request.method,
    headers: request.headers
  });

  let res;
  try {
    res = await env.ASSETS.fetch(assetReq);
  } catch (e) {
    return new Response('安装包读取失败，请稍后重试。', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  if (!res || !res.ok) {
    return new Response('安装包暂未上线或发版未包含 APK，请稍后再试或联系老师。', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  const headers = new Headers(res.headers);
  headers.set('Content-Type', 'application/vnd.android.package-archive');
  headers.set(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Name}`
  );
  headers.set('Cache-Control', 'public, max-age=120');
  headers.set('X-Content-Type-Options', 'nosniff');

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  return new Response(res.body, { status: 200, headers });
}
