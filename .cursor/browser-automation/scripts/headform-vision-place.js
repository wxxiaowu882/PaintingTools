/**
 * Headform 视觉定点 CLI
 *
 * MODE=propose   SLOT=V02 LANDMARK=2   → 语义 band 采候选 + 叠编号截图
 * MODE=place     SLOT=V02 LANDMARK=2 U=0.41 V=0.33 → 射线落面写 JSON + 验收截图
 * MODE=clean     SLOT=V02 → 无标注干净截图（理解参考）
 * MODE=verify    SLOT=V02 → 带标注验收截图
 * MODE=teachshot SLOT=V02 → 打开大本同槽干净+带标各一（语义参照）
 *
 * 不依赖大本 UV；候选全在新模画面采样。AI 读图选编号后 MODE=place。
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

const MODE = process.env.MODE || 'propose';
const SLOT = process.env.SLOT || 'V02';
const LANDMARK = process.env.LANDMARK || '2';
const U = process.env.U ? Number(process.env.U) : null;
const V = process.env.V ? Number(process.env.V) : null;
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-vision-place-${SLOT}-${LANDMARK}`);
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await lib.launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${port}/Solid?sandbox=headform&skipPerf=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 120000
  });

  const MODEL_ID = process.env.MODEL_ID || 'male_bald_asian_01';
  const hit = lib.findScene(SLOT, MODEL_ID);
  if (!hit) throw new Error(MODEL_ID + ' scene missing ' + SLOT);
  const sceneId = hit.d.id;
  const scenePath = path.join(lib.jsonDir, hit.f);
  const cam = (((hit.d.items || [])[0] || {}).camera) || hit.d.camera || null;

  const log = { mode: MODE, slot: SLOT, landmark: LANDMARK, scene: hit.f, outDir };

  if (MODE === 'teachshot') {
    const ref = lib.findScene(SLOT, 'reference');
    if (!ref) throw new Error('reference missing');
    await lib.openScene(page, ref.d.id);
    await lib.applyCamera(page, (((ref.d.items || [])[0] || {}).camera) || null);
    await lib.setAnnosVisible(page, false);
    await page.screenshot({ path: path.join(outDir, 'teach_clean.png') });
    await lib.setAnnosVisible(page, true);
    await page.screenshot({ path: path.join(outDir, 'teach_annos.png') });
    log.teach = ref.f;
  } else {
    await lib.openScene(page, sceneId);
    await lib.applyCamera(page, cam);

    if (MODE === 'clean') {
      await lib.setAnnosVisible(page, false);
      await lib.clearOverlay(page);
      await page.screenshot({ path: path.join(outDir, 'clean.png') });
    } else if (MODE === 'propose') {
      await lib.setAnnosVisible(page, false);
      const prop = await lib.proposeCandidates(page, LANDMARK, SLOT);
      await lib.overlayCandidates(page, prop.candidates);
      await page.screenshot({ path: path.join(outDir, `propose_${LANDMARK}.png`) });
      await lib.clearOverlay(page);
      fs.writeFileSync(path.join(outDir, `propose_${LANDMARK}.json`), JSON.stringify(prop, null, 2));
      log.propose = prop;
      const card = lib.getCard(SLOT, LANDMARK) || lib.V02_CARDS[LANDMARK] || { name: String(LANDMARK) };
      fs.writeFileSync(
        path.join(outDir, `card_${LANDMARK}.md`),
        `# ${LANDMARK} ${card.name}\n\n- 类型: ${card.kind || ''}\n- 应落: ${card.where || ''}\n- 禁落: ${card.forbid || ''}\n- 择优: ${card.pickHint || '对照应落'}\n- 绿点=脚本推荐（语义分最高）；仍须 Read 确认\n\n读图：选编号中最符合「应落」且避开「禁落」者；记其 u/v 后 MODE=place。\n`
      );
    } else if (MODE === 'place') {
      if (U == null || V == null) throw new Error('need U V');
      await lib.clearOverlay(page);
      const placed = await lib.rayPlace(page, U, V);
      log.placed = placed;
      if (!placed.ok) throw new Error(JSON.stringify(placed));
      // 模板样式从当前或大本同名点
      const ref = lib.findScene(SLOT, 'reference');
      let tmpl = null;
      if (ref) {
        const ra = ((((ref.d.items || [])[0] || {}).annotations) || []).find((a) => String(a.text) === String(LANDMARK));
        if (ra) tmpl = ra;
      }
      log.write = lib.writeLandmark(scenePath, LANDMARK, placed, tmpl, SLOT);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
        timeout: 120000
      });
      await lib.openScene(page, sceneId);
      await lib.applyCamera(page, cam);
      await lib.setAnnosVisible(page, true);
      await page.screenshot({ path: path.join(outDir, `placed_${LANDMARK}.png`) });
    } else if (MODE === 'verify') {
      await lib.setAnnosVisible(page, true);
      await lib.clearOverlay(page);
      await page.screenshot({ path: path.join(outDir, 'verify.png') });
    } else {
      throw new Error('unknown MODE ' + MODE);
    }
  }

  fs.writeFileSync(path.join(outDir, 'log.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ ok: true, outDir, log }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
