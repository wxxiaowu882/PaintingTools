/**
 * 05 综合场景：按解剖区分组聚焦截图，供 AI 视觉判偏。
 * 不写回坐标。ONLY=eye|nose|mouth|ear|brow|all
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-composite-vision-audit`);
const ONLY = (process.env.ONLY || 'all').toLowerCase();

const GROUPS = {
  ear: {
    texts: null, // filled from keywords
    keywords: ['耳', '舟状', '三角凹', '耳甲', '耳屏', '对耳', '耳轮', '耳垂', '耳廓', '凹入', '前缺口'],
    orbit: '88deg 90deg auto',
    target: '0.06m 0.16m 0.01m',
    fov: 16,
  },
  nose: {
    keywords: ['鼻'],
    orbit: '0deg 95deg auto',
    target: '0m 0.16m 0.08m',
    fov: 14,
  },
  mouth: {
    keywords: ['人中', '唇', '口角', '沟状', '白脊', '颏唇', '翼状'],
    orbit: '0deg 100deg auto',
    target: '0m 0.13m 0.075m',
    fov: 12,
  },
  brow: {
    keywords: ['眉'],
    orbit: '-18deg 78deg auto',
    target: '-0.03m 0.19m 0.07m',
    fov: 12,
  },
  eye: {
    keywords: ['眦', '睑', '虹', '角', '巩', '眼', '卧蚕'],
    orbit: '-20deg 88deg auto',
    target: '-0.03m 0.16m 0.07m',
    fov: 10,
  },
};

function inGroup(text, g) {
  return g.keywords.some((k) => text.includes(k));
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForFunction(() => {
    const el = document.getElementById('point-count');
    return el && /52/.test(el.innerText || '');
  }, null, { timeout: 180000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const frame = document.getElementById('anno-mobile-frame-overlay');
    if (frame) frame.hidden = true;
  });

  const manifest = [];
  const groupKeys = Object.keys(GROUPS).filter((k) => ONLY === 'all' || ONLY === k);

  for (const gk of groupKeys) {
    const g = GROUPS[gk];
    const points = data.pointsData.filter((p) => inGroup(p.text, g));
    // overview: show all in group
    await page.evaluate(({ orbit, target, fov, texts }) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-target', target);
      v.setAttribute('camera-orbit', orbit);
      v.setAttribute('field-of-view', `${fov}deg`);
      // dim others
      document.querySelectorAll('#points-list .point-item').forEach((row) => {
        const inp = row.querySelector('.point-text-input');
        const eyeBtn = row.querySelector('[data-action="toggle-visibility"], .point-visibility, button');
        const on = texts.includes(inp && inp.value);
        row.style.opacity = on ? '1' : '0.25';
      });
    }, { ...g, texts: points.map((p) => p.text) });
    await page.waitForTimeout(500);
    const overview = path.join(outDir, `00-${gk}-overview.png`);
    await page.locator('#workbench-viewer').screenshot({ path: overview });
    manifest.push({ group: gk, kind: 'overview', shot: overview });

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      // click list focus
      await page.evaluate((t) => {
        const inp = [...document.querySelectorAll('#points-list .point-text-input')].find((el) => el.value === t);
        if (!inp) return;
        const row = inp.closest('.point-item') || inp.parentElement;
        const focus = row.querySelector('.point-name, .focus-btn, [title*="聚焦"]') || inp;
        focus.click();
      }, p.text);
      await page.waitForTimeout(700);
      // then force anatomical camera so we see landmark even if normal is bad
      await page.evaluate(({ orbit, target, fov }) => {
        const v = document.querySelector('#workbench-viewer');
        v.setAttribute('camera-target', target);
        v.setAttribute('camera-orbit', orbit);
        v.setAttribute('field-of-view', `${fov}deg`);
      }, g);
      await page.waitForTimeout(350);
      const safe = `${gk}-${String(i + 1).padStart(2, '0')}-id${p.id}-${p.text.replace(/[^\w\u4e00-\u9fff]+/g, '_')}`;
      const shot = path.join(outDir, `${safe}.png`);
      await page.locator('#workbench-viewer').screenshot({ path: shot });
      manifest.push({ group: gk, id: p.id, text: p.text, pos: p.pos, shot });
      console.log('SHOT', safe);
    }
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ outDir, manifest }, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, n: manifest.length, outDir }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
