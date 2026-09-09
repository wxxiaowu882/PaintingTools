/**
 * GLB 管理器：历史文件夹下拉切换自测
 * 用页面内 __GLB_DIR_HISTORY_TEST__ 注入两个虚拟目录，验证切换后模型列表不同。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const pageUrl = `${base}/${encodeURI('自用工具文件_不部署/GBL管理器/Glb管理器.html')}`;
const outDir = path.join(
  __dirname,
  '..',
  'runs',
  `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-glb-dir-switch`
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitForTestApi(page, timeoutMs = 20000) {
  await page.waitForFunction(
    () => !!(window.__GLB_DIR_HISTORY_TEST__ && window.__GLB_DIR_HISTORY_TEST__.connectMock),
    null,
    { timeout: timeoutMs }
  );
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const fails = [];
  const logs = [];

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('历史') || t.includes('切换') || t.includes('已连接') || t.includes('❌')) {
      logs.push(`[console] ${t}`);
    }
  });

  try {
    console.log(`Open ${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForTestApi(page);
    await page.waitForTimeout(800);

    const step1 = await page.evaluate(async () => {
      const api = window.__GLB_DIR_HISTORY_TEST__;
      api.beginIsolated();
      await api.resetHistory();
      const a = await api.connectMock('folder_alpha', ['alpha_one.glb', 'alpha_two.glb']);
      const b = await api.connectMock('folder_beta', ['beta_only.glb']);
      return { a, b, after: api.getState() };
    });

    await page.screenshot({ path: path.join(outDir, '01-after-two-folders.png'), fullPage: true });

    assert(step1.after.history.length === 2, `期望历史 2 条，实际 ${step1.after.history.length}`);
    assert(step1.after.modelCount === 1, `当前应在 beta（1 个模型），实际 ${step1.after.modelCount}`);
    assert(
      step1.after.models.some((n) => String(n).includes('beta_only')),
      `当前列表应含 beta_only，实际 ${JSON.stringify(step1.after.models)}`
    );

    const idAlpha = step1.after.history.find((h) => h.name === 'folder_alpha')?.id;
    const idBeta = step1.after.history.find((h) => h.name === 'folder_beta')?.id;
    assert(idAlpha && idBeta, '未找到 alpha/beta 历史 id');
    assert(idAlpha !== idBeta, 'alpha/beta 不应共用同一历史 id');

    const switchedAlpha = await page.evaluate(async (id) => {
      return window.__GLB_DIR_HISTORY_TEST__.selectById(id);
    }, idAlpha);

    await page.screenshot({ path: path.join(outDir, '02-switched-alpha.png'), fullPage: true });

    assert(switchedAlpha.currentId === idAlpha, `切换后 currentId 应为 alpha，实际 ${switchedAlpha.currentId}`);
    assert(switchedAlpha.selectValue === idAlpha, `下拉选中应为 alpha，实际 ${switchedAlpha.selectValue}`);
    assert(switchedAlpha.modelCount === 2, `切到 alpha 应有 2 个模型，实际 ${switchedAlpha.modelCount}`);
    assert(
      switchedAlpha.models.every((n) => String(n).includes('alpha_')),
      `alpha 列表应全是 alpha_*，实际 ${JSON.stringify(switchedAlpha.models)}`
    );
    assert(
      !switchedAlpha.models.some((n) => String(n).includes('beta_')),
      `切到 alpha 后不应再有 beta，实际 ${JSON.stringify(switchedAlpha.models)}`
    );

    const switchedBeta = await page.evaluate(async (id) => {
      return window.__GLB_DIR_HISTORY_TEST__.selectById(id);
    }, idBeta);

    await page.screenshot({ path: path.join(outDir, '03-switched-beta.png'), fullPage: true });

    assert(switchedBeta.currentId === idBeta, `再切回 beta 的 currentId 不对: ${switchedBeta.currentId}`);
    assert(switchedBeta.modelCount === 1, `再切回 beta 应有 1 个模型，实际 ${switchedBeta.modelCount}`);
    assert(
      switchedBeta.models.some((n) => String(n).includes('beta_only')),
      `再切回 beta 应含 beta_only，实际 ${JSON.stringify(switchedBeta.models)}`
    );

    // 同名不同目录：应合并为 1 条
    const sameName = await page.evaluate(async () => {
      const api = window.__GLB_DIR_HISTORY_TEST__;
      await api.resetHistory();
      await api.connectMock('测试', ['a1.glb']);
      await api.connectMock('测试', ['b1.glb', 'b2.glb']);
      return api.getState();
    });
    assert(sameName.history.length === 1, `同名目录应合并为 1 条历史，实际 ${sameName.history.length}`);
    assert(sameName.modelCount === 2, `同名后再次载入应更新为最新目录文件，实际 ${sameName.modelCount}`);

    // 删除历史路径
    const afterDelete = await page.evaluate(async () => {
      const api = window.__GLB_DIR_HISTORY_TEST__;
      await api.resetHistory();
      await api.connectMock('folder_del_a', ['da.glb']);
      await api.connectMock('folder_del_b', ['db.glb']);
      const before = api.getState();
      const id = before.history.find((h) => h.name === 'folder_del_a')?.id;
      const after = await api.removeById(id);
      return { beforeCount: before.history.length, after, removedId: id };
    });
    assert(afterDelete.beforeCount === 2, '删除前应有 2 条');
    assert(afterDelete.after.history.length === 1, `删除后应剩 1 条，实际 ${afterDelete.after.history.length}`);
    assert(
      !afterDelete.after.history.some((h) => h.id === afterDelete.removedId),
      '被删 id 不应还在列表中'
    );

    // 跨历史文件夹复制（同名冲突自动加时间戳）
    const copyCase = await page.evaluate(async () => {
      const api = window.__GLB_DIR_HISTORY_TEST__;
      await api.resetHistory();
      await api.connectMock('copy_src', ['shared.glb', 'unique_src.glb']);
      await api.connectMock('copy_dst', ['shared.glb', 'dst_only.glb']);
      const st = api.getState();
      const idSrc = st.history.find((h) => h.name === 'copy_src')?.id;
      const idDst = st.history.find((h) => h.name === 'copy_dst')?.id;
      await api.selectById(idSrc);
      const copyUnique = await api.copyModelTo('unique_src.glb', idDst);
      const copyConflict = await api.copyModelTo('shared.glb', idDst);
      const dstNames = api.listDirNames(idDst) || [];
      const uiHasCopyBtn = !!document.querySelector('.model-card .copy-btn');
      return {
        idSrc,
        idDst,
        copyUnique,
        copyConflict,
        dstNames,
        uiHasCopyBtn,
        stayedOnSrc: api.getState().currentId === idSrc,
      };
    });

    await page.screenshot({ path: path.join(outDir, '04-after-copy.png'), fullPage: true });

    assert(copyCase.uiHasCopyBtn, '卡片应有「复制到」按钮');
    assert(copyCase.stayedOnSrc, '复制后应仍停留在源文件夹');
    assert(copyCase.copyUnique?.result?.finalName === 'unique_src.glb', `无冲突应保持原名，实际 ${JSON.stringify(copyCase.copyUnique)}`);
    assert(
      Array.isArray(copyCase.dstNames) && copyCase.dstNames.includes('unique_src.glb'),
      `目标目录应含 unique_src.glb，实际 ${JSON.stringify(copyCase.dstNames)}`
    );
    assert(
      copyCase.copyConflict?.result?.finalName
        && copyCase.copyConflict.result.finalName !== 'shared.glb'
        && String(copyCase.copyConflict.result.finalName).startsWith('shared_')
        && String(copyCase.copyConflict.result.finalName).endsWith('.glb'),
      `同名冲突应追加时间戳，实际 ${JSON.stringify(copyCase.copyConflict)}`
    );
    assert(
      copyCase.dstNames.includes(copyCase.copyConflict.result.finalName),
      `目标目录应含冲突后文件名，实际 ${JSON.stringify(copyCase.dstNames)}`
    );

    await page.evaluate(async () => {
      await window.__GLB_DIR_HISTORY_TEST__.endIsolated();
    });

    const report = {
      ok: true,
      pageUrl,
      step1,
      switchedAlpha,
      switchedBeta,
      sameName,
      afterDelete,
      copyCase,
      logs,
    };
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log('PASS glb-dir-history switch selftest');
    console.log(`Evidence: ${outDir}`);
    await browser.close();
    process.exit(0);
  } catch (e) {
    fails.push(e.message || String(e));
    try {
      await page.screenshot({ path: path.join(outDir, 'FAIL.png'), fullPage: true });
    } catch (_) {}
    fs.writeFileSync(
      path.join(outDir, 'report.json'),
      JSON.stringify({ ok: false, error: fails, logs }, null, 2),
      'utf8'
    );
    console.error('FAIL', e);
    console.error(`Evidence: ${outDir}`);
    await browser.close();
    process.exit(1);
  }
})();
