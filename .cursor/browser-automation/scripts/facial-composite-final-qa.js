const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repo = path.resolve(__dirname, '..', '..', '..');
const jsonPath = path.join(repo, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const runDir = path.join(
  repo,
  '.cursor',
  'browser-automation',
  'runs',
  new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-facial-composite-final-qa'
);
fs.mkdirSync(runDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://127.0.0.1:18080/' + encodeURI('自用工具文件_不部署/模型标注生产工具.html'), {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && (v.getAttribute('src') || '').includes('石膏');
  }, null, { timeout: 180000 });
  await page.waitForTimeout(1500);

  const shots = [
    { name: 'front', orbit: '0deg 90deg auto', fov: 22 },
    { name: 'nose_mouth', orbit: '0deg 105deg auto', fov: 12 },
    { name: 'ear_right', orbit: '88deg 90deg auto', fov: 18 },
    { name: 'eye_right', orbit: '-18deg 88deg auto', fov: 14 },
  ];
  for (const s of shots) {
    await page.evaluate(({ orbit, fov }) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-orbit', orbit);
      v.setAttribute('field-of-view', `${fov}deg`);
    }, s);
    await page.waitForTimeout(400);
    const out = path.join(runDir, `qa_${s.name}.png`);
    await page.screenshot({ path: out, fullPage: false });
    console.log('SHOT', out);
  }
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  fs.writeFileSync(
    path.join(runDir, 'summary.json'),
    JSON.stringify(
      {
        n: data.pointsData.length,
        modelSrc: data.modelSrc,
        key: ['鼻底', '鼻中隔', '人中（沟）', '人中脊', '唇珠'].map((t) => {
          const p = data.pointsData.find((x) => x.text === t);
          return { text: t, pos: p && p.pos };
        }),
      },
      null,
      2
    ),
    'utf8'
  );
  console.log('DONE', runDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
