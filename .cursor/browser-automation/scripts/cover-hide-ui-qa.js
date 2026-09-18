/**
 * 验收：覆写选中项 + 勾选保存封面时，截取瞬间隐藏下方面板 / 手机取景框，结束后恢复。
 * 用法：先 serve:repo（或 PORT=18080），再 node scripts/cover-hide-ui-qa.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const OUT = path.join(__dirname, '..', 'runs', 'cover-hide-ui');
const PAGE =
  `http://127.0.0.1:${PORT}/自用工具文件_不部署/石膏人像沙盒场景生成/Solid_Portrait_Create`;

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

async function waitLoaderGone(page) {
  try {
    await page.waitForSelector('#scene-loader', { state: 'hidden', timeout: 120000 });
  } catch (_e) {}
  await page.waitForTimeout(1500);
}

async function main() {
  ensureDir(OUT);
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(90000);

  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await waitLoaderGone(page);

  const result = await page.evaluate(async () => {
    const out = { ok: false, mid: null, after: null, before: null, err: null, thumbLen: 0 };

    // 勾选保存封面
    const cb = document.getElementById('update-cover-on-save');
    if (cb && !cb.checked) {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (typeof window.solidCreateSyncUpdateCoverLabel === 'function') {
      try { window.solidCreateSyncUpdateCoverLabel(); } catch (_e) {}
    }

    // 打开手机取景框
    if (typeof setMobileFrameEnabled === 'function') setMobileFrameEnabled(true);
    else {
      const ov = document.getElementById('mobile-frame-overlay');
      if (ov) ov.hidden = false;
      const t = document.getElementById('mobile-frame-toggle');
      if (t) t.checked = true;
    }

    // 确保绿框可见（封面裁切框）
    const crop = document.getElementById('crop-box');
    if (crop) {
      crop.style.display = 'block';
      crop.style.visibility = '';
    }

    const snap = () => {
      const panel = (typeof getMainControlPanelEl === 'function')
        ? getMainControlPanelEl()
        : (document.getElementById('main-panel') || document.querySelector('.control-panel'));
      const mf = document.getElementById('mobile-frame-overlay');
      const c = document.getElementById('crop-box');
      return {
        panelVis: panel ? panel.style.visibility : null,
        panelDisplay: panel ? getComputedStyle(panel).visibility : null,
        mfVis: mf ? mf.style.visibility : null,
        mfHidden: mf ? !!mf.hidden : null,
        mfComputed: mf ? getComputedStyle(mf).visibility : null,
        cropVis: c ? c.style.visibility : null,
        cropComputed: c ? getComputedStyle(c).visibility : null,
      };
    };

    out.before = snap();

    // 禁止录屏弹窗卡住
    try {
      navigator.mediaDevices.getDisplayMedia = async () => {
        throw new Error('qa-skip-display-media');
      };
    } catch (_e) {}

    // mock 工作目录，避免「请先挂载」；写入落到内存
    let wrote = null;
    const fakeWritable = {
      write: async (data) => { wrote = data; },
      close: async () => {},
    };
    const fakeHandle = {
      name: '999_cover_hide_qa.json',
      createWritable: async () => fakeWritable,
      getFile: async () => new File([JSON.stringify({ thumbnail: null })], '999_cover_hide_qa.json'),
    };
    window.workDirHandle = {
      name: 'qa',
      values: async function* () {},
      getFileHandle: async () => fakeHandle,
    };
    window.currentFileHandle = fakeHandle;
    window.refreshFileList = async () => {};
    const nameInput = document.getElementById('scene-name-input');
    if (nameInput) nameInput.value = 'cover_hide_qa';

    // 在双 rAF 稳定后的截取窗口探测「隐藏中」状态：
    // 给 html2canvas 注入探针（若走 WebGL 直出则用 style 观察）
    const midSamples = [];
    const panel = (typeof getMainControlPanelEl === 'function')
      ? getMainControlPanelEl()
      : (document.getElementById('main-panel') || document.querySelector('.control-panel'));
    const mf = document.getElementById('mobile-frame-overlay');
    const obs = new MutationObserver(() => {
      const s = snap();
      if (s.panelVis === 'hidden' || s.mfVis === 'hidden' || s.cropVis === 'hidden') {
        midSamples.push(s);
      }
    });
    if (panel) obs.observe(panel, { attributes: true, attributeFilter: ['style'] });
    if (mf) obs.observe(mf, { attributes: true, attributeFilter: ['style'] });
    if (crop) obs.observe(crop, { attributes: true, attributeFilter: ['style'] });

    // 同时轮询，防止 MutationObserver 漏掉同步赋值
    let polling = true;
    const poll = (async () => {
      while (polling) {
        const s = snap();
        if (s.panelVis === 'hidden' && s.mfVis === 'hidden') midSamples.push(s);
        await new Promise((r) => setTimeout(r, 16));
      }
    })();

    try {
      await window.saveCurrentSceneDirectly();
    } catch (e) {
      out.err = String(e && e.message ? e.message : e);
    } finally {
      polling = false;
      obs.disconnect();
      await poll.catch(() => {});
    }

    out.mid = midSamples.length ? midSamples[Math.floor(midSamples.length / 2)] : null;
    out.midCount = midSamples.length;
    out.after = snap();
    if (wrote) {
      try {
        const j = typeof wrote === 'string' ? JSON.parse(wrote) : JSON.parse(String(wrote));
        out.thumbLen = j && j.thumbnail ? String(j.thumbnail).length : 0;
        if (j && j.thumbnail && String(j.thumbnail).startsWith('data:image')) {
          window.__qaCoverThumb = String(j.thumbnail);
        }
      } catch (_e) {}
    }
    out.ok = !!(out.mid && out.mid.panelVis === 'hidden' && out.mid.mfVis === 'hidden'
      && out.after && out.after.panelVis !== 'hidden' && out.after.mfVis !== 'hidden');
    return out;
  });

  await page.screenshot({ path: path.join(OUT, 'after-restore.png'), fullPage: false });

  // 若页内留下了 dataURL 缩略图，落盘供视觉验收
  const thumb = await page.evaluate(() => window.__qaCoverThumb || null);
  if (thumb && thumb.startsWith('data:image')) {
    const b64 = thumb.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(path.join(OUT, 'cover-thumb.jpg'), Buffer.from(b64, 'base64'));
  }

  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  if (!result.ok) {
    process.exitCode = 1;
    console.error('[FAIL] cover hide UI probe did not pass');
  } else {
    console.log('[PASS] mid-hide + restore ok');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
