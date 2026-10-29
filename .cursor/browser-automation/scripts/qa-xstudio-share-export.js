/**
 * 晓色：分享颜料盒（复制码）+ 下载分享文件 + 导入闭环
 * PORT=18080 QA_BASE=http://127.0.0.1:18080 node scripts/qa-xstudio-share-export.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || process.env.BASE_URL || 'http://127.0.0.1:18080';
const OUT = path.join(__dirname, '..', 'runs', 'qa-xstudio-share-export');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { ok: true, issues: [], steps: {} };
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  await page.addInitScript(() => {
    try {
      localStorage.removeItem('xstudioMyBoxes');
      localStorage.removeItem('customIds');
      localStorage.removeItem('customIds2');
      localStorage.removeItem('currentTabId');
      localStorage.removeItem('userAddedPigments');
    } catch (_e) {}
  });

  await page.goto(BASE + '/XStudio?_qa=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(
    () => typeof window.openPigmentModal === 'function' && window.appState && window.appState.myBoxes && window.appState.myBoxes.length > 0,
    null,
    { timeout: 60000 }
  );
  await page.waitForTimeout(600);

  // 测试环境放行分享/导入门禁，避免会员锁挡验收
  await page.evaluate(() => {
    try {
      if (window.MembershipPaintHost && typeof window.MembershipPaintHost.guard === 'function') {
        window.MembershipPaintHost.guard = function () { return true; };
      }
    } catch (_e) {}
  });

  await page.evaluate(() => window.openPigmentModal());
  await page.waitForFunction(
    () => document.getElementById('pigmentModal') && document.getElementById('pigmentModal').classList.contains('active') && !window.__pigmentModalBusy,
    null,
    { timeout: 15000 }
  );
  // 确保在自定义盒（才有分享按钮）
  await page.evaluate(() => {
    const box = (window.modalState.tempMyBoxes || [])[0];
    if (box) window.switchModalTab(box.id);
  });
  await page.waitForTimeout(200);

  const shareBtnVisible = await page.evaluate(() => {
    const b = document.getElementById('shareBoxInlineBtn');
    return !!(b && getComputedStyle(b).display !== 'none');
  });
  report.steps.shareBtnVisible = shareBtnVisible;
  if (!shareBtnVisible) {
    report.ok = false;
    report.issues.push('自定义盒下未见「分享颜料盒」按钮');
  }

  // 1) 打开分享弹层
  await page.click('#shareBoxInlineBtn');
  await page.waitForSelector('#shareBoxOverlay.active', { timeout: 5000 });
  report.steps.shareOverlayOpen = true;
  await page.screenshot({ path: path.join(OUT, '01-share-overlay.png') });

  // 2) 复制分享码
  const copyResult = await page.evaluate(async () => {
    const beforeToast = (document.getElementById('toast') && document.getElementById('toast').textContent) || '';
    await window.exportCurrentBoxShare();
    await new Promise((r) => setTimeout(r, 200));
    let clip = '';
    try { clip = await navigator.clipboard.readText(); } catch (_e) { clip = ''; }
    const toast = (document.getElementById('toast') && document.getElementById('toast').textContent) || '';
    let decoded = null;
    let decodeErr = '';
    try { decoded = window.decodeShareCode(clip); } catch (e) { decodeErr = String(e && e.message || e); }
    return {
      clipPrefix: String(clip).slice(0, 10),
      clipLen: String(clip).length,
      toast,
      beforeToast,
      decodedOk: !!(decoded && decoded.v === 1 && Array.isArray(decoded.ids) && decoded.ids.length > 0),
      decodeErr,
      name: decoded && decoded.name,
      idCount: decoded && decoded.ids && decoded.ids.length
    };
  });
  report.steps.copy = copyResult;
  if (!copyResult.decodedOk || String(copyResult.clipPrefix).indexOf('XWBOX1.') !== 0) {
    report.ok = false;
    report.issues.push('复制分享码失败或无效: ' + JSON.stringify(copyResult));
  }
  if (String(copyResult.toast).indexOf('复制') < 0 && String(copyResult.toast).indexOf('分享') < 0) {
    report.warnings = report.warnings || [];
    report.warnings.push('复制后 toast 文案异常: ' + copyResult.toast);
  }

  // 3) 下载分享文件
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.evaluate(() => window.downloadCurrentBoxShare())
  ]);
  const suggested = download.suggestedFilename();
  const savePath = path.join(OUT, suggested || 'share.xwbox.txt');
  await download.saveAs(savePath);
  const fileText = fs.readFileSync(savePath, 'utf8');
  const fileCheck = await page.evaluate((text) => {
    try {
      const d = window.decodeShareCode(text);
      return { ok: !!(d && d.v === 1 && Array.isArray(d.ids) && d.ids.length), name: d.name, n: d.ids.length, prefix: String(text).slice(0, 10) };
    } catch (e) {
      return { ok: false, err: String(e && e.message || e) };
    }
  }, fileText);
  report.steps.download = { suggested, savePath: path.basename(savePath), fileCheck, bytes: fileText.length };
  if (!fileCheck.ok || String(fileCheck.prefix).indexOf('XWBOX1.') !== 0) {
    report.ok = false;
    report.issues.push('下载分享文件无效: ' + JSON.stringify(fileCheck));
  }
  if (!/\.xwbox\.txt$/i.test(suggested || '')) {
    report.warnings = report.warnings || [];
    report.warnings.push('下载文件名后缀异常: ' + suggested);
  }
  await page.screenshot({ path: path.join(OUT, '02-after-download.png') });

  await page.evaluate(() => window.closeShareBoxOverlay());

  // 4) 用下载内容导入（改名冲突）
  const beforeN = await page.evaluate(() => (window.modalState.tempMyBoxes || []).length);
  const importResult = await page.evaluate((text) => {
    document.getElementById('importBoxTextarea').value = text;
    const n0 = window.modalState.tempMyBoxes.length;
    window.confirmImportBoxShare();
    return {
      before: n0,
      after: window.modalState.tempMyBoxes.length,
      firstName: window.modalState.tempMyBoxes[0] && window.modalState.tempMyBoxes[0].name,
      viewing: window.modalState.viewingTabId
    };
  }, fileText);
  report.steps.import = importResult;
  if (importResult.after !== beforeN + 1) {
    report.ok = false;
    report.issues.push('导入后盒子数量未 +1');
  }

  // 5) 往返：encode → decode 字段一致
  const roundtrip = await page.evaluate(() => {
    const tab = window.modalState.viewingTabId;
    const payload = window.buildSharePayloadForTab(tab, window.modalState.tempMyBoxes, window.modalState.tempUserAdded);
    const code = window.encodeShareCode(payload);
    const back = window.decodeShareCode(code);
    return {
      sameName: back.name === payload.name,
      sameIds: JSON.stringify(back.ids) === JSON.stringify(payload.ids),
      customs: (back.customs || []).length === (payload.customs || []).length,
      codeLen: code.length
    };
  });
  report.steps.roundtrip = roundtrip;
  if (!roundtrip.sameName || !roundtrip.sameIds || !roundtrip.customs) {
    report.ok = false;
    report.issues.push('分享码往返不一致: ' + JSON.stringify(roundtrip));
  }

  await page.screenshot({ path: path.join(OUT, '03-after-import.png') });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
