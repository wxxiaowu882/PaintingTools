/**
 * 203-fix3：⑤改钉颏底「形」交界（颏下缘翻进暗部），勿钉颈上铸影
 * 并清探针/首帧遮罩后重截验收图
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-203-fix3`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load203() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('203_') && n.endsWith('.json'));
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}
function rebuild() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+[A-Za-z]?_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  fs.writeFileSync(
    path.join(jsonDir, '沙盒_头部造型规律.json'),
    JSON.stringify(files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')))) + '\n'
  );
}

const KEY_POINTS = `本场景只看正前略高这一档光线下，明暗交界怎么走。交界主要跟「光线和头的夹角」有关，和我们观察的角度无关——你可以转动场景，换几个角度看这些交界，以及圆标钉住的那些结构。

请不要改变当前光线的方向、高低等参数，因为这会影响本场景的教学观感。如有误改，点「重置」把光（和本场景默认状态）恢复即可。

先看表象：光线几乎正对脸、略抬高时，左右颊大体都还亮；真正抢眼的是几条「横着走」的交界——鼻下一块左右对称的影（像蝴蝶），再加上眉弓投下的眶内暗、下唇投下的颏唇沟暗、颏底翻进暗部的交界。这就是摄影里常说的「蝴蝶光」。若一侧已经大暗还出现三角亮，更接近「伦勃朗」；若鼻旁小影偏在一侧、未对称，更接近「环形」。

注意：正中的人中、唇珠一带此刻多半仍是亮面，那里没有竖着的明暗交界——本场景不把中线当交界来标。曲线也只串真实交界（蝶影 ②—①—③），不把亮面点连成假交界。

明暗交界从哪来？圆标钉在交界经过的结构点（或线位）上。交界出现是因为有结构起伏；看见对称蝶影与眶内暗，也能反推鼻底、眉弓的起伏。

点位(或线位)名称如下：

【主线 · 鼻下蝶影交界】
①.鼻头下缘（蝶影上缘中点）
②.左鼻翼缘（蝶影左翼）
③.右鼻翼缘（蝶影右翼）

【支线1 · 眶】
A.左眶上缘交界（眉弓投下的眶内暗上缘）
B.右眶上缘交界

【支线2 · 下唇下影】
④.颏唇沟交界（下唇投下的暗带上缘）

【支线3 · 颏底形交界】
⑤.颏底交界（颏下缘翻进暗部处——形面交界，不是脖子上的投影）

可点击操作面板上的眼睛图标来隐藏标注，更干净地观察明暗交界线。`;

async function scrubUI(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    window._solidUserStoppedRender = true;
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    window.isTestingPerformance = false;
    window.isLoadingScene = false;
    const hide = (el) => {
      if (!el) return;
      el.style.display = 'none';
      el.style.opacity = '0';
      el.style.visibility = 'hidden';
    };
    hide(document.getElementById('scene-loader'));
    hide(document.getElementById('perf-test-overlay'));
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const t = (el.textContent || '').trim();
      if (/^(正在计算光影|首帧渲染中|即将完成|正在加载|光影探针)/.test(t) && t.length < 50) hide(el);
      if (/光影探针/.test(t)) hide(el);
    });
  });
}

(async () => {
  const file0 = load203();
  file0.data.id = 'L03';
  file0.data.meta = Object.assign({}, file0.data.meta, {
    line: 'light',
    slot: 'L03',
    status: 'seeded',
    keyPoints: KEY_POINTS
  });
  fs.writeFileSync(file0.full, JSON.stringify(file0.data) + '\n');
  rebuild();

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(() => (window.customScenes || []).length > 0, null, { timeout: 120000 });
  await page.waitForFunction(() => !!(window.__solidHost && window.__solidHost.getCamera), null, {
    timeout: 120000
  });
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'L03');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && /蝴蝶/.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  for (let i = 0; i < 90; i++) {
    const n = await page.evaluate(() => {
      let c = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) c++;
        });
      } catch (e) {}
      return c;
    });
    if (n > 0) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2800);
  for (let k = 0; k < 8; k++) {
    await scrubUI(page);
    await page.waitForTimeout(280);
  }

  // ⑤：颏下缘形交界 —— 偏好 y 低、z 中等（颏底翻面），避开过小 z（颈）与过高 z（颏前亮面）
  const placed = await page.evaluate(() => {
    const host = window.__solidHost;
    const THREE = host.getTHREE();
    const cam = host.getCamera();
    const g = host.getSceneGroup();
    let root = null;
    g.traverse((o) => {
      if (!root && o.userData && o.userData.type === 'glb') root = o;
    });
    if (!root) root = g.children[0];
    const meshes = [];
    root.traverse((o) => {
      if (o.isMesh && o.geometry) meshes.push(o);
    });
    const raycaster = new THREE.Raycaster();
    const lp = new THREE.Vector3();
    const target = { x: 0, y: 0.048, z: 0.052 };
    let best = null;
    let bestScore = 1e9;
    // 颏区屏幕盒
    for (let v = 0.68; v <= 0.86; v += 0.004) {
      for (let u = 0.44; u <= 0.56; u += 0.004) {
        raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
        const hit = raycaster.intersectObjects(meshes, true)[0];
        if (!hit) continue;
        lp.copy(hit.point);
        root.worldToLocal(lp);
        if (Math.abs(lp.x) > 0.015) continue;
        // 不要太靠后（颈/喉）也不要太靠前太高（颏球亮面）
        if (lp.z < 0.035 || lp.z > 0.07) continue;
        if (lp.y < 0.03 || lp.y > 0.06) continue;
        let nWorld = new THREE.Vector3(0, -0.5, 0.5);
        if (hit.face && hit.face.normal) {
          nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        }
        // 偏好朝下/略后的法线（颏底翻面）
        const down = -nWorld.y;
        const score =
          (lp.x - target.x) ** 2 * 4 +
          (lp.y - target.y) ** 2 +
          (lp.z - target.z) ** 2 +
          Math.max(0, 0.25 - down) * 0.05;
        if (score < bestScore) {
          bestScore = score;
          const localNormal = root
            .worldToLocal(hit.point.clone().add(nWorld))
            .sub(lp.clone())
            .normalize();
          best = {
            localPos: [+lp.x.toFixed(4), +lp.y.toFixed(4), +lp.z.toFixed(4)],
            localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
            baseDist: +hit.distance.toFixed(4),
            nY: +nWorld.y.toFixed(3),
            xyz: [+lp.x.toFixed(3), +lp.y.toFixed(3), +lp.z.toFixed(3)]
          };
        }
      }
    }
    return best;
  });

  console.log('pt5', placed);
  if (!placed) throw new Error('failed to place point 5');

  const file = load203();
  const a5 = (file.data.items[0].annotations || []).find((x) => x.text === '5');
  if (!a5) throw new Error('anno 5 missing');
  a5.localPos = placed.localPos;
  a5.localNormal = placed.localNormal;
  a5.baseDist = placed.baseDist;
  a5.dx = 0;
  a5.dy = 58;
  file.data.id = 'L03';
  file.data.meta.keyPoints = KEY_POINTS;
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  rebuild();

  await page.evaluate(() => {
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'L03');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && /蝴蝶/.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  await page.waitForTimeout(2200);
  for (let k = 0; k < 8; k++) {
    await scrubUI(page);
    await page.waitForTimeout(280);
  }

  const crop = await page.evaluate(() => {
    const s = (window.customScenes || []).find((x) => x && x.id === 'L03');
    const c = (s && s.crop) || {};
    return { x: parseFloat(c.left) || 260, y: parseFloat(c.top) || 70, width: 760, height: 720 };
  });

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await scrubUI(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'L03-light-only.png'), clip: crop });

  await page.evaluate(() => {
    if (window.showAnnotations !== true && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await scrubUI(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'L03-annotated-crop.png'), clip: crop });

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(300);
  const thumb = await page.screenshot({
    type: 'jpeg',
    quality: 72,
    clip: { x: crop.x + 30, y: crop.y + 30, width: 700, height: 700 }
  });
  const f2 = load203();
  f2.data.thumbnail = 'data:image/jpeg;base64,' + thumb.toString('base64');
  f2.data.id = 'L03';
  fs.writeFileSync(f2.full, JSON.stringify(f2.data) + '\n');
  rebuild();
  console.log('OUT', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
