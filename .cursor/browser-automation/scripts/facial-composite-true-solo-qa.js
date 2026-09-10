/**
 * 真·单点复核：临时 JSON 只留一个点再截图。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-true-solo-qa`);

const NAMES = (process.env.ONLY || '外眦,内眦,虹膜,上眼睑,下眼睑,眉头,鼻根,鼻头,唇珠,耳轮')
  .split(/[,，]/)
  .map((s) => s.trim())
  .filter(Boolean);

const CAM = {
  eye: { orbit: '-10deg 90deg auto', target: '-0.036m 0.176m 0.068m', fov: 9 },
  brow: { orbit: '-14deg 78deg auto', target: '-0.030m 0.200m 0.066m', fov: 10 },
  nose: { orbit: '0deg 92deg auto', target: '0m 0.160m 0.08m', fov: 12 },
  mouth: { orbit: '0deg 100deg auto', target: '0m 0.128m 0.075m', fov: 10 },
  ear: { orbit: '90deg 90deg auto', target: '0.062m 0.160m 0.0m', fov: 13 },
};

function camFor(t) {
  if (/眦|虹|睑|巩|眼|卧|角膜|眼球/.test(t)) return CAM.eye;
  if (/眉/.test(t)) return CAM.brow;
  if (/鼻/.test(t)) return CAM.nose;
  if (/人中|唇|口|沟状|白脊|颏/.test(t)) return CAM.mouth;
  return CAM.ear;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const full = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });

  const manifest = [];
  for (const name of NAMES) {
    const pt = full.pointsData.find((p) => p.text === name);
    if (!pt) {
      console.log('MISSING', name);
      continue;
    }
    const tmp = path.join(outDir, `_tmp_${name.replace(/[^\w\u4e00-\u9fff]+/g, '_')}.json`);
    const one = {
      ...full,
      pointsData: [{ ...pt, id: 1 }],
      snapshots: [],
      timestamp: Date.now(),
    };
    fs.writeFileSync(tmp, JSON.stringify(one, null, 2));
    // 换唯一路径；并先清空再导入，避免同页反复 setInputFiles 不触发
    await page.evaluate(() => {
      const input = document.getElementById('file-input');
      if (input) input.value = '';
    });
    await page.setInputFiles('#file-input', tmp);
    await page.waitForFunction(
      (expected) => {
        const inp = document.querySelector('#points-list .point-text-input');
        const n = (document.getElementById('point-count') || {}).innerText || '';
        return inp && inp.value === expected && /1/.test(n);
      },
      name,
      { timeout: 120000 }
    );
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.visibility = 'hidden';
      });
      const frame = document.getElementById('anno-mobile-frame-overlay');
      if (frame) frame.hidden = true;
    });
    const cam = camFor(name);
    await page.evaluate((c) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-target', c.target);
      v.setAttribute('camera-orbit', c.orbit);
      v.setAttribute('field-of-view', `${c.fov}deg`);
    }, cam);
    await page.waitForTimeout(400);
    // click focus so label shows
    await page.evaluate(() => {
      const inp = document.querySelector('#points-list .point-text-input');
      if (inp) (inp.closest('.point-item') || inp.parentElement).querySelector('.point-name')?.click();
    });
    await page.waitForTimeout(400);
    // re-lock camera after focus
    await page.evaluate((c) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-target', c.target);
      v.setAttribute('camera-orbit', c.orbit);
      v.setAttribute('field-of-view', `${c.fov}deg`);
    }, cam);
    await page.waitForTimeout(250);
    const safe = name.replace(/[^\w\u4e00-\u9fff]+/g, '_');
    const shot = path.join(outDir, `solo_${safe}.png`);
    await page.locator('#workbench-viewer').screenshot({ path: shot });
    manifest.push({ name, pos: pt.pos, shot });
    console.log('SOLO', name, pt.pos);
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ outDir, manifest }, null, 2));
  console.log(JSON.stringify({ ok: true, n: manifest.length, outDir }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
