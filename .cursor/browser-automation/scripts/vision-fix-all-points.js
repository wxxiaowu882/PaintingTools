/**
 * AI 视觉定点修正：相机固定到「看清该肌」的视角后，
 * 在视口中心附近用我（AI）看图决定的偏移像素点击拾取。
 * 不是解剖偏移公式，是视觉点选坐标。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const OUT_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解_黄种人女V8.json');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-vision-fix`);

/**
 * 每个点：看审计截图后定的「相机 + 相对视口中心的点击偏移」
 * orbit: model-viewer camera-orbit
 * target: 粗略对准该区域
 * click: [dx, dy] 相对画布中心，向下为正 y（屏幕坐标）
 */
const VISION_CLICKS = [
  // 额区
  { text: '额肌', orbit: '5deg 80deg auto', target: '0.04m 0.32m 0.08m', fov: 22, click: [18, -12] },
  { text: '降眉间肌', orbit: '0deg 88deg auto', target: '0m 0.27m 0.12m', fov: 20, click: [0, 8] },
  { text: '降眉肌', orbit: '-8deg 88deg auto', target: '-0.015m 0.28m 0.12m', fov: 20, click: [-14, 4] },
  // 眼鼻
  { text: '眼轮匝肌', orbit: '25deg 88deg auto', target: '0.05m 0.23m 0.1m', fov: 20, click: [22, 6] },
  { text: '鼻肌横部', orbit: '0deg 90deg auto', target: '0m 0.235m 0.14m', fov: 18, click: [0, -4] },
  { text: '提上唇鼻翼肌', orbit: '12deg 90deg auto', target: '0.02m 0.225m 0.12m', fov: 18, click: [16, 10] },
  { text: '鼻小压肌', orbit: '5deg 92deg auto', target: '0.008m 0.21m 0.15m', fov: 16, click: [8, 12] },
  { text: '鼻前扩张肌', orbit: '-10deg 92deg auto', target: '-0.012m 0.215m 0.145m', fov: 16, click: [-12, 10] },
  { text: '鼻肌翼部', orbit: '15deg 92deg auto', target: '0.02m 0.21m 0.13m', fov: 16, click: [18, 14] },
  { text: '降鼻中隔肌', orbit: '0deg 95deg auto', target: '0m 0.19m 0.13m', fov: 16, click: [0, 18] },
  // 颧颊
  { text: '颧小肌', orbit: '30deg 90deg auto', target: '0.04m 0.2m 0.1m', fov: 18, click: [20, 8] },
  { text: '颧大肌', orbit: '35deg 92deg auto', target: '0.05m 0.185m 0.09m', fov: 18, click: [28, 16] },
  { text: '提上唇肌', orbit: '-25deg 90deg auto', target: '-0.03m 0.21m 0.11m', fov: 18, click: [-22, 6] },
  { text: '提口角肌', orbit: '-30deg 92deg auto', target: '-0.035m 0.185m 0.1m', fov: 18, click: [-26, 14] },
  { text: '颊肌', orbit: '50deg 95deg auto', target: '0.05m 0.17m 0.06m', fov: 20, click: [10, 8] },
  // 口周 —— 降口角肌：口角外下三角肌腹（不要贴口角、不要贴下颌底）
  { text: '口轮匝肌', orbit: '0deg 95deg auto', target: '0m 0.18m 0.13m', fov: 16, click: [0, 4] },
  { text: '降口角肌', orbit: '20deg 95deg auto', target: '0.03m 0.15m 0.11m', fov: 16, click: [26, 36] },
  { text: '降下唇肌', orbit: '-12deg 98deg auto', target: '-0.02m 0.145m 0.12m', fov: 16, click: [-16, 42] },
  { text: '笑肌', orbit: '-45deg 95deg auto', target: '-0.05m 0.16m 0.07m', fov: 18, click: [-8, 12] },
  { text: '颏肌', orbit: '0deg 100deg auto', target: '0.01m 0.12m 0.12m', fov: 16, click: [6, 48] },
  // 侧后
  { text: '颞肌', orbit: '70deg 85deg auto', target: '0.08m 0.28m 0.02m', fov: 22, click: [0, -6] },
  { text: '咬肌', orbit: '75deg 95deg auto', target: '0.07m 0.17m 0.03m', fov: 20, click: [4, 10] },
  { text: '枕肌', orbit: '180deg 90deg auto', target: '0.04m 0.26m -0.1m', fov: 24, click: [12, -8] },
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  const byText = Object.fromEntries(data.pointsData.map((p) => [p.text, p]));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', OUT_JSON);
  await page.waitForFunction(
    () => /23/.test((document.getElementById('point-count') || {}).innerText || ''),
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(2800);

  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
  });

  const results = [];

  for (const spec of VISION_CLICKS) {
    const p = byText[spec.text];
    if (!p) {
      results.push({ text: spec.text, ok: false, error: 'missing in json' });
      continue;
    }

    await page.evaluate(
      ({ orbit, target, fov }) => {
        const v = document.querySelector('#workbench-viewer');
        v.setAttribute('camera-target', target);
        v.setAttribute('camera-orbit', orbit);
        v.setAttribute('field-of-view', `${fov}deg`);
      },
      { orbit: spec.orbit, target: spec.target, fov: spec.fov }
    );
    await page.waitForTimeout(700);

    // 先拍「点选前」方便对照
    const safe = spec.text.replace(/[^\w\u4e00-\u9fff]+/g, '_');
    await page.screenshot({ path: path.join(outDir, `aim-${safe}.png`), fullPage: true });

    const hit = await page.evaluate(({ dx, dy }) => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      const cx = rect.left + rect.width / 2 + dx;
      const cy = rect.top + rect.height / 2 + dy;
      // 在点击附近搜一下，避免点到空隙
      const tries = [[0, 0], [0, -6], [0, 6], [-6, 0], [6, 0], [-8, 8], [8, 8], [-8, -8], [8, -8]];
      for (const [ox, oy] of tries) {
        const h = viewer.positionAndNormalFromPoint(cx + ox, cy + oy);
        if (!h) continue;
        let nx = h.normal.x;
        let ny = h.normal.y;
        let nz = h.normal.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        // 尽量朝外：若法线背向相机大致方向则翻（用 z 为主的启发式，侧视再靠 x）
        return {
          ok: true,
          pos: `${h.position.x.toFixed(4)}m ${h.position.y.toFixed(4)}m ${h.position.z.toFixed(4)}m`,
          norm: `${nx.toFixed(4)}m ${ny.toFixed(4)}m ${nz.toFixed(4)}m`,
          screen: { cx: cx + ox, cy: cy + oy },
        };
      }
      return { ok: false, error: 'miss' };
    }, { dx: spec.click[0], dy: spec.click[1] });

    if (!hit.ok) {
      results.push({ text: spec.text, ok: false, error: hit.error, spec });
      continue;
    }

    // 法线朝向：用原档案法线半球校正
    const src = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/json/结构_头骨骨点肌肉/03 肌肉详解.json'), 'utf8'));
    const srcP = src.pointsData.find((x) => x.text === spec.text);
    if (srcP) {
      const sn = srcP.norm.replace(/m/g, '').split(/\s+/).map(Number);
      const nn = hit.norm.replace(/m/g, '').split(/\s+/).map(Number);
      if (sn[0] * nn[0] + sn[1] * nn[1] + sn[2] * nn[2] < 0) {
        hit.norm = `${(-nn[0]).toFixed(4)}m ${(-nn[1]).toFixed(4)}m ${(-nn[2]).toFixed(4)}m`;
      }
    }

    p.pos = hit.pos;
    p.norm = hit.norm;
    results.push({ text: spec.text, ok: true, pos: hit.pos, norm: hit.norm, click: spec.click });
  }

  data.timestamp = Date.now();
  fs.writeFileSync(OUT_JSON, JSON.stringify(data, null, 2) + '\n', 'utf8');

  // 重新导入并逐点确认截图
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.visibility = '';
        el.style.opacity = '0.35';
      }
    });
  });
  await page.setInputFiles('#file-input', OUT_JSON);
  await page.waitForTimeout(2800);

  for (const spec of VISION_CLICKS) {
    await page.evaluate((text) => {
      const inp = [...document.querySelectorAll('#points-list .point-text-input')].find(
        (el) => el.value === text
      );
      inp?.parentElement.querySelector('.point-name')?.click();
    }, spec.text);
    await page.waitForTimeout(750);
    const safe = spec.text.replace(/[^\w\u4e00-\u9fff]+/g, '_');
    await page.screenshot({ path: path.join(outDir, `ok-${safe}.png`), fullPage: true });
  }

  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-orbit', '0deg 90deg auto');
    v.setAttribute('camera-target', '0m 0.2m 0.08m');
    v.setAttribute('field-of-view', '28deg');
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, 'zz-front.png'), fullPage: true });

  const failed = results.filter((r) => !r.ok);
  const report = {
    ok: failed.length === 0,
    fixed: results.filter((r) => r.ok).length,
    failed,
    outDir: path.relative(repoRoot, outDir),
    results,
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  await browser.close();
  console.log(JSON.stringify({ ok: report.ok, fixed: report.fixed, failed, outDir: report.outDir }, null, 2));
  if (!report.ok) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
