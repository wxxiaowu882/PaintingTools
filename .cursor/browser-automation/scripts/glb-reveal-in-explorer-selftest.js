/**
 * GLB 管理器：打开所在文件夹 API + 路径拼接自测
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const pageUrl = `${base}/${encodeURI('自用工具文件_不部署/GBL管理器/Glb管理器.html')}`;
const outDir = path.join(
  __dirname,
  '..',
  'runs',
  `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-glb-reveal`
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function norm(p) {
  return String(p || '').replace(/\//g, '\\').toLowerCase();
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glb-reveal-'));
  const tmpFile = path.join(tmpDir, 'probe_model.glb');
  fs.writeFileSync(tmpFile, Buffer.from([0x67, 0x6c, 0x54, 0x46]));

  const apiRes = await fetch(`${base}/__api/reveal-in-explorer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: tmpFile }),
  });
  const apiJson = await apiRes.json();
  assert(apiRes.ok && apiJson.ok, `reveal API 失败: ${JSON.stringify(apiJson)}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => !!(window.__GLB_DIR_HISTORY_TEST__ && window.__GLB_DIR_HISTORY_TEST__.setActiveModel),
      null,
      { timeout: 20000 }
    );

    const result = await page.evaluate(async (absRoot) => {
      const api = window.__GLB_DIR_HISTORY_TEST__;
      api.beginIsolated();
      await api.resetHistory();
      await api.connectMock('reveal_folder', ['probe_model.glb', 'sub/child.glb']);
      const hasBtn = !!document.getElementById('btn-reveal-in-explorer');
      api.setActiveModel('probe_model.glb');

      // 无路径时：不弹系统窗（skipInteractive），应得不到路径
      await api.clearAbsPathForCurrent();
      const missing = api.resolveActiveAbsFile();
      const ensuredSkip = await api.ensureAbsRoot({ skipInteractive: true });

      await api.setAbsPathForCurrent(absRoot);
      const resolved = api.resolveActiveAbsFile();
      const nested = (() => {
        api.setActiveModel('sub/child.glb');
        return api.resolveActiveAbsFile();
      })();
      api.setActiveModel('probe_model.glb');
      const revealed = await api.revealActive(absRoot);
      // 缺路径时用 opts.absRoot 也能一次绑上并打开
      await api.clearAbsPathForCurrent();
      const revealedBind = await api.revealActive(absRoot);
      await api.endIsolated();
      return {
        hasBtn,
        missing,
        ensuredSkip,
        resolved,
        nested,
        revealed,
        revealedBind,
        state: api.getState(),
      };
    }, tmpDir);

    assert(result.hasBtn, '应有「打开所在文件夹」按钮');
    assert(result.missing == null, '清空 absPath 后不应还能解析路径');
    assert(result.ensuredSkip == null, 'skipInteractive 时不应凭空得到路径');
    assert(norm(result.resolved) === norm(tmpFile), `根目录文件路径不对: ${result.resolved}`);
    assert(
      norm(result.nested) === norm(path.join(tmpDir, 'sub', 'child.glb')),
      `子目录文件路径不对: ${result.nested}`
    );
    assert(result.revealed && result.revealed.ok, `revealActive 失败: ${JSON.stringify(result.revealed)}`);
    assert(
      result.revealedBind && result.revealedBind.ok,
      `缺路径时用 absRoot 绑定并打开失败: ${JSON.stringify(result.revealedBind)}`
    );

    await page.screenshot({ path: path.join(outDir, '01-ui.png'), fullPage: true });
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ ok: true, apiJson, result }, null, 2), 'utf8');
    console.log('PASS glb reveal-in-explorer selftest');
    console.log(`Evidence: ${outDir}`);
    await browser.close();
    process.exit(0);
  } catch (e) {
    try {
      await page.screenshot({ path: path.join(outDir, 'FAIL.png'), fullPage: true });
    } catch (_) {}
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ ok: false, error: e.message || String(e) }, null, 2), 'utf8');
    console.error('FAIL', e);
    await browser.close();
    process.exit(1);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
})();
