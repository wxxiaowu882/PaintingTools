/**
 * 测站禁止收录：给 HTML 加 X-Robots-Tag + meta robots；覆盖 /robots.txt 为 Disallow: /。
 * 仅在 test.wuxiaoart.com / soft-voice-f822-staging 生效；正式站原样透传（例外见下）。
 * 依赖 env.staging 的 assets.run_worker_first = true（见 wrangler.toml）；正式站勿开全量 Worker-first。
 *
 * 正式站例外：录播未对公开放前，/CourseLearn* 由本中间件直接返回「筹备中」页，不吐出学习页 demo HTML
 * （wrangler.toml 已把该路径列入 prod 的 run_worker_first）。测站全量 Worker-first，仍走静态 CourseLearn.html。
 * 对公开放时：Worker 变量 COURSE_LEARN_PUBLIC=1，并同步放开 /Course 学习入口（见路线图 §4.5.2）。
 */
function isStagingHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'test.wuxiaoart.com' || h.includes('soft-voice-f822-staging');
}

function isCourseLearnPublic(env) {
  return String((env && env.COURSE_LEARN_PUBLIC) || '') === '1';
}

function isCourseLearnPath(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '') || '/';
  return p === '/CourseLearn' || p === '/CourseLearn.html';
}

function courseLearnComingSoonHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>课程学习 · 筹备中｜手绘工坊 · 童画师吴晓</title>
  <meta name="robots" content="noindex,nofollow">
  <link rel="canonical" href="https://www.wuxiaoart.com/CourseLearn">
  <link rel="icon" data-wuxiao-brand-icon="1" href="/docs/img/brand/favicon-32.png?v=fav7" type="image/png" sizes="32x32">
  <script src="/docs/js/GlobalMenu.js?v=courselearn1"></script>
  <style>
    body{margin:0;min-height:100vh;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
      background:#0c0c10;color:#f4f1ea;display:flex;align-items:center;justify-content:center;padding:72px 20px 48px;}
    .box{max-width:28em;text-align:center}
    .brand{font-size:.78rem;letter-spacing:.14em;color:#d4b56a;margin:0 0 10px}
    h1{font-size:1.35rem;font-weight:560;margin:0 0 12px;letter-spacing:.04em}
    p{color:#a39e96;line-height:1.65;margin:0 0 22px;font-size:.95rem}
    a{color:#f4f1ea;text-decoration:none;border-bottom:1px solid rgba(212,181,106,.45)}
    a:hover{border-bottom-color:#d4b56a}
  </style>
</head>
<body>
  <div id="menu-trigger" class="absolute" onclick="typeof toggleMenu==='function'&&toggleMenu()" aria-label="打开菜单"
    style="position:fixed;top:24px;right:24px;width:44px;height:44px;z-index:50;cursor:pointer;display:flex;flex-direction:column;justify-content:center;align-items:flex-end;">
    <span style="display:block;width:28px;height:1.5px;background:#fff;margin:3.5px 0;border-radius:1px;"></span>
    <span style="display:block;width:20px;height:1.5px;background:#fff;margin:3.5px 0;border-radius:1px;"></span>
    <span style="display:block;width:28px;height:1.5px;background:#fff;margin:3.5px 0;border-radius:1px;"></span>
  </div>
  <div class="box">
    <p class="brand">童画师吴晓 · 水彩课程</p>
    <h1>学习页筹备中</h1>
    <p>站内课程播放还在打磨。正式开放前，课程预告页不会提供进入课堂的入口。你也可先看看课程预告与会员权益。</p>
    <p><a href="/Course">返回课程预告</a> · <a href="/">回首页</a></p>
  </div>
</body>
</html>`;
}

function stagingRobotsTxt() {
  return [
    'User-agent: *',
    'Disallow: /',
    '',
    '# Staging only — do not index test.wuxiaoart.com',
    ''
  ].join('\n');
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const staging = isStagingHost(url.hostname);

  // 正式站：录播未开放前，学习页只出「筹备中」（产品口径 §4.5.2；COURSE_LEARN_PUBLIC=1 才放行）
  if (!staging && isCourseLearnPath(url.pathname) && !isCourseLearnPublic(context.env)) {
    return new Response(courseLearnComingSoonHtml(), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow'
      }
    });
  }

  if (staging && (url.pathname === '/robots.txt' || url.pathname === '/robots.txt/')) {
    return new Response(stagingRobotsTxt(), {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow'
      }
    });
  }

  const res = await context.next();
  if (!staging) return res;

  const headers = new Headers(res.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  const ct = headers.get('content-type') || '';
  if (ct.includes('text/html')) {
    return new HTMLRewriter()
      .on('head', {
        element(el) {
          el.prepend('<meta name="robots" content="noindex,nofollow">', { html: true });
        }
      })
      .transform(new Response(res.body, { status: res.status, statusText: res.statusText, headers }));
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
