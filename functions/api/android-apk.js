/**
 * 安卓 App APK 下载：强制 attachment，避免手机浏览器把包当空白页打开。
 * 文件名带版本号（读 android-shell-update.json 的 versionName）。
 * GET/HEAD /api/android-apk
 *
 * 按域名分流：
 * - test.wuxiaoart.com / staging Worker → 测站壳（手绘工坊·测，.staging 包名）
 * - 正式站及其它 → 正式壳（手绘工坊）
 * 两套包 applicationId 不同，同机可并存，互不覆盖。
 */
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const origin = url.origin;
  const host = String(url.hostname || '').toLowerCase();
  const isStagingHost =
    host === 'test.wuxiaoart.com' ||
    host.includes('soft-voice-f822-staging') ||
    /(^|\.)staging(\.|$)/i.test(host);

  const apkPath = isStagingHost
    ? '/docs/app/wuxiao-workshop-staging.apk'
    : '/docs/app/wuxiao-workshop.apk';
  const namePrefix = isStagingHost ? '手绘工坊·测' : '手绘工坊';
  const asciiPrefix = isStagingHost ? 'shouhui-gongfang-ce' : 'shouhui-gongfang';

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

  const displayBase = versionName ? `${namePrefix}-${versionName}` : namePrefix;
  const asciiFallback = versionName
    ? `${asciiPrefix}-${versionName}.apk`
    : `${asciiPrefix}.apk`;
  const utf8Name = encodeURIComponent(`${displayBase}.apk`);

  const assetReq = new Request(new URL(apkPath, origin), {
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
  headers.set('X-Wuxiao-Apk-Channel', isStagingHost ? 'staging' : 'prod');

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  return new Response(res.body, { status: 200, headers });
}
