/**
 * 在用户实际使用的 Live Server(5500) 上检查「删除此历史路径」按钮是否存在且可见
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const outDir = path.join(
  __dirname,
  '..',
  'runs',
  `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-glb-delete-btn-check`
);
fs.mkdirSync(outDir, { recursive: true });

const candidates = [
  'http://127.0.0.1:5500/' + encodeURI('自用工具文件_不部署/GBL管理器/Glb管理器.html'),
  'http://127.0.0.1:18080/' + encodeURI('自用工具文件_不部署/GBL管理器/Glb管理器.html'),
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const report = { checks: [] };

  for (const url of candidates) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const item = { url, ok: false };
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      item.status = resp ? resp.status() : null;
      await page.waitForTimeout(500);
      const info = await page.evaluate(() => {
        const btn = document.getElementById('btn-remove-dir-history');
        const select = document.getElementById('dir-history-select');
        const headerHtml = document.querySelector('.sidebar-header')?.innerHTML?.slice(0, 800) || '';
        if (!btn) {
          return {
            found: false,
            headerHasDelete: /删除|btn-remove-dir/.test(headerHtml),
            headerSnippet: headerHtml,
            allButtons: [...document.querySelectorAll('#sidebar button')].map((b) => ({
              id: b.id,
              text: (b.innerText || '').trim(),
              title: b.title || '',
            })),
          };
        }
        const r = btn.getBoundingClientRect();
        const cs = getComputedStyle(btn);
        return {
          found: true,
          text: (btn.innerText || '').trim(),
          disabled: btn.disabled,
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          zIndex: cs.zIndex,
          width: Math.round(r.width),
          height: Math.round(r.height),
          top: Math.round(r.top),
          left: Math.round(r.left),
          bottom: Math.round(r.bottom),
          inViewport: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight,
          selectValue: select ? select.value : null,
          selectText: select && select.selectedOptions[0] ? select.selectedOptions[0].textContent : null,
        };
      });
      item.info = info;
      const tag = url.includes('5500') ? '5500' : '18080';
      await page.screenshot({ path: path.join(outDir, `${tag}-full.png`), fullPage: false });
      await page.locator('#sidebar').screenshot({ path: path.join(outDir, `${tag}-sidebar.png`) }).catch(() => {});
      item.ok = !!(info.found && info.inViewport && String(info.text).includes('删除'));
    } catch (e) {
      item.error = e.message || String(e);
    }
    report.checks.push(item);
    await page.close();
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log('Evidence:', outDir);
  const live = report.checks.find((c) => c.url.includes('5500'));
  if (!live || !live.ok) {
    console.error('FAIL: 5500 页面上看不到可用的删除历史路径按钮');
    process.exit(1);
  }
  console.log('PASS: 5500 可见删除按钮');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
