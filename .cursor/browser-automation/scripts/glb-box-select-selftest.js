/**
 * GLB 管理器：框选算法性能自测（head_parts_anatomy 等高模不应卡死）
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const pageUrl = `${base}/${encodeURI('自用工具文件_不部署/GBL管理器/Glb管理器.html')}`;
const GLB_PATH =
  process.env.GLB_PATH ||
  'E:/模型/五官下载/head_parts_anatomy.glb';
const outDir = path.join(
  __dirname,
  '..',
  'runs',
  `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-glb-box-select`
);

const COLLECT_MS_MAX = Number(process.env.COLLECT_MS_MAX || 1500);
const SETTLE_MS_MAX = Number(process.env.SETTLE_MS_MAX || 2500);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  assert(fs.existsSync(GLB_PATH), `缺少测试 GLB: ${GLB_PATH}`);
  fs.mkdirSync(outDir, { recursive: true });

  const fileServer = http.createServer((req, res) => {
    if (!fs.existsSync(GLB_PATH)) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    const st = fs.statSync(GLB_PATH);
    res.writeHead(200, {
      'Content-Type': 'model/gltf-binary',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': st.size,
    });
    fs.createReadStream(GLB_PATH).pipe(res);
  });
  await new Promise((r) => fileServer.listen(0, '127.0.0.1', r));
  const fileBase = `http://127.0.0.1:${fileServer.address().port}`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));

  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () =>
        typeof window.__AGENT_LOAD_GLB_BUFFER__ === 'function' &&
        !!window.__AGENT_BOX_SELECT_TEST__,
      null,
      { timeout: 30000 }
    );

    // 大文件解析：抬高页面内 30s 防挂死超时
    await page.evaluate(() => {
      const _setTimeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...rest) => {
        if (typeof ms === 'number' && ms === 30000 && typeof fn === 'function') {
          const src = Function.prototype.toString.call(fn);
          if (src.includes('防挂死') || src.includes('解析超时') || src.includes('activeGltfLoads')) {
            ms = 180000;
          }
        }
        return _setTimeout(fn, ms, ...rest);
      };
    });

    const load = await page.evaluate(async (fileUrl) => {
      const resp = await fetch(fileUrl);
      if (!resp.ok) throw new Error('fetch glb ' + resp.status);
      const ab = await resp.arrayBuffer();
      const t0 = performance.now();
      const result = await window.__AGENT_LOAD_GLB_BUFFER__(ab, 'head_parts_anatomy.glb');
      await new Promise((r) => setTimeout(r, 1200));
      return {
        ...result,
        bytes: ab.byteLength,
        loadMs: Math.round(performance.now() - t0),
      };
    }, fileBase + '/');

    assert(load && load.ok, `载入失败: ${JSON.stringify(load)}`);

    const enter = await page.evaluate(() => {
      const t0 = performance.now();
      const api = window.__AGENT_BOX_SELECT_TEST__;
      const r = api.enter();
      const collect = api.collect();
      return {
        ...r,
        enterMs: Math.round(performance.now() - t0),
        collect,
      };
    });

    assert(enter.ok, '未能进入框选模式');
    assert(
      enter.collect.ms <= COLLECT_MS_MAX,
      `collectSelectableParts 过慢: ${enter.collect.ms}ms > ${COLLECT_MS_MAX}ms`
    );
    assert(enter.collect.parts >= 1, '可选件应为 ≥1');
    assert(
      enter.collect.heavySkip >= 1 || enter.collect.triTotal < 12000,
      '高模应跳过孤岛分析（heavySkip≥1）'
    );
    assert(
      enter.collect.parts <= 200,
      `可选件过多仍会卡：parts=${enter.collect.parts} meshes=${enter.collect.meshes}`
    );

    const full = await page.evaluate(() => window.__AGENT_BOX_SELECT_TEST__.settleFullView());
    assert(full && full.ok, `全视口框选失败: ${JSON.stringify(full)}`);
    assert(
      full.ms <= SETTLE_MS_MAX,
      `settle 过慢: ${full.ms}ms > ${SETTLE_MS_MAX}ms method=${full.method}`
    );
    assert(full.picked >= 1, `全视口应选中至少 1 件，实际 ${full.picked}`);

    // 中心小框：应快速返回（允许 0；高模不得再走全场景射线）
    const small = await page.evaluate(() => {
      const rect = document.getElementById('main-view').getBoundingClientRect();
      const cx = rect.width * 0.5;
      const cy = rect.height * 0.55;
      return window.__AGENT_BOX_SELECT_TEST__.settle(cx - 80, cy - 60, cx + 80, cy + 60);
    });
    assert(small && small.ok, `小框框选失败: ${JSON.stringify(small)}`);
    assert(
      small.ms <= SETTLE_MS_MAX,
      `小框 settle 过慢: ${small.ms}ms > ${SETTLE_MS_MAX}ms method=${small.method}`
    );

    // 再框一次：用全视口已选件的投影中心附近，确保「框到东西」路径也够快
    const targeted = await page.evaluate(() => {
      const api = window.__AGENT_BOX_SELECT_TEST__;
      api.settleFullView();
      const sel = api.getSelected();
      if (!sel.n) return { ok: false, reason: 'no selection after full' };
      const rect = document.getElementById('main-view').getBoundingClientRect();
      // 右下象限常见五官摆放；再叠一次全视口验证可重复
      const again = api.settle(rect.width * 0.15, rect.height * 0.2, rect.width * 0.85, rect.height * 0.85);
      return { ok: true, again, selectedAfterFull: sel.n };
    });
    assert(targeted.ok, `定向框选失败: ${JSON.stringify(targeted)}`);
    assert(
      targeted.again.ms <= SETTLE_MS_MAX,
      `定向 settle 过慢: ${targeted.again.ms}ms`
    );
    assert(targeted.again.picked >= 1, `定向框应选中 ≥1，实际 ${targeted.again.picked}`);

    const selected = await page.evaluate(() => window.__AGENT_BOX_SELECT_TEST__.getSelected());
    await page.screenshot({ path: path.join(outDir, '01-box-select.png'), fullPage: true });

    const report = {
      ok: true,
      glb: GLB_PATH,
      load,
      enter,
      full,
      small,
      targeted,
      selected,
      pageErrors,
      limits: { COLLECT_MS_MAX, SETTLE_MS_MAX },
    };
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log('PASS glb box-select selftest');
    console.log(
      JSON.stringify(
        {
          collectMs: enter.collect.ms,
          parts: enter.collect.parts,
          meshes: enter.collect.meshes,
          triTotal: enter.collect.triTotal,
          heavySkip: enter.collect.heavySkip,
          fullMs: full.ms,
          fullPicked: full.picked,
          fullMethod: full.method,
          smallMs: small.ms,
          smallPicked: small.picked,
          smallMethod: small.method,
          againMs: targeted.again.ms,
          againPicked: targeted.again.picked,
          againMethod: targeted.again.method,
        },
        null,
        2
      )
    );
    console.log(`Evidence: ${outDir}`);
    await browser.close();
    fileServer.close();
    process.exit(0);
  } catch (e) {
    try {
      await page.screenshot({ path: path.join(outDir, 'FAIL.png'), fullPage: true });
    } catch (_) {}
    let snap = null;
    try {
      snap = await page.evaluate(() => {
        const api = window.__AGENT_BOX_SELECT_TEST__;
        if (!api) return null;
        return { collect: api.collect(), selected: api.getSelected() };
      });
    } catch (_) {}
    fs.writeFileSync(
      path.join(outDir, 'report.json'),
      JSON.stringify({ ok: false, error: e.message || String(e), pageErrors, snap }, null, 2),
      'utf8'
    );
    console.error('FAIL', e);
    await browser.close();
    fileServer.close();
    process.exit(1);
  }
})();
