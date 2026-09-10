/**
 * 逐点单显复核：隐藏其它热点，只亮一个，供 AI 视觉判定。
 * ONLY=外眦,内眦,虹膜 逗号分隔；默认关键点集。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-solo-vision-qa`);

const DEFAULT = [
  '外眦',
  '内眦',
  '虹膜',
  '上眼睑',
  '下眼睑',
  '眉头',
  '眉峰',
  '鼻根',
  '鼻头',
  '鼻底',
  '人中（沟）',
  '唇珠',
  '耳轮',
  '耳屏',
];

const NAMES = process.env.ONLY ? process.env.ONLY.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : DEFAULT;

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
  if (/耳|舟|三角|甲|屏|轮|垂/.test(t)) return CAM.ear;
  return CAM.eye;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForFunction(() => /52/.test((document.getElementById('point-count') || {}).innerText || ''), null, {
    timeout: 180000,
  });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const frame = document.getElementById('anno-mobile-frame-overlay');
    if (frame) frame.hidden = true;
  });

  const manifest = [];
  for (const name of NAMES) {
    const pt = data.pointsData.find((p) => p.text === name);
    const cam = camFor(name);
    await page.evaluate(
      ({ name, cam }) => {
        const v = document.querySelector('#workbench-viewer');
        v.setAttribute('camera-target', cam.target);
        v.setAttribute('camera-orbit', cam.orbit);
        v.setAttribute('field-of-view', `${cam.fov}deg`);
        // hide all hotspots then show matching
        const slots = [...v.querySelectorAll('[slot^="hotspot"]')];
        for (const el of slots) {
          const label = (el.textContent || '').trim();
          const on = label === name || label.startsWith(name);
          el.style.visibility = on ? 'visible' : 'hidden';
          el.style.opacity = on ? '1' : '0';
          el.style.display = on ? '' : 'none';
        }
        // also try annotation class
        document.querySelectorAll('.HotspotAnnotation').forEach((el) => {
          const label = (el.textContent || '').trim();
          const on = label.includes(name);
          el.style.visibility = on ? 'visible' : 'hidden';
          el.style.opacity = on ? '1' : '0';
        });
      },
      { name, cam }
    );
    await page.waitForTimeout(350);
    const safe = name.replace(/[^\w\u4e00-\u9fff]+/g, '_');
    const shot = path.join(outDir, `solo_${safe}.png`);
    await page.locator('#workbench-viewer').screenshot({ path: shot });
    manifest.push({ name, pos: pt && pt.pos, shot, cam });
    console.log('SOLO', name, pt && pt.pos);
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ outDir, manifest }, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, n: manifest.length, outDir }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
