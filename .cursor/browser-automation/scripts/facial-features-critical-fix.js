/**
 * 五官关键偏差点定点纠偏（看图 + 解剖资料）。
 * 只改列出的点，其余保留。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonDir = path.join(repoRoot, 'docs', 'json', '结构_五官');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-critical`);

/**
 * click: 相对画布中心的像素偏移 [dx, dy]，向下为正
 * preferZ: 是否在候选里偏好更大 z
 */
const FIXES = {
  '01 耳朵详解.json': {
    key: 'ear',
    items: [
      // 对耳轮上脚：落在上脚脊上，勿落入三角凹
      { text: '对耳轮上脚', orbit: '20deg 82deg auto', fov: 18, click: [8, -70], preferZ: true },
      // 三角凹：上下脚之间的三角窝底
      { text: '三角凹', orbit: '18deg 78deg auto', fov: 18, click: [-6, -95], preferZ: false },
      // 前缺口：耳屏与耳轮脚之间的切迹（贴耳前缘，勿飘到脸侧皮肤）
      { text: '前缺口', orbit: '8deg 90deg auto', fov: 18, click: [-55, -25], preferZ: true },
      // 对耳轮下脚：锐利下脚脊
      { text: '对耳轮下脚', orbit: '14deg 88deg auto', fov: 18, click: [-20, -40], preferZ: true },
      // 耳轮脚：水平脊中段
      { text: '耳轮脚', orbit: '12deg 92deg auto', fov: 16, click: [-25, -5], preferZ: true },
    ],
  },
  '02 鼻子详解.json': {
    key: 'nose',
    items: [
      // 鼻梁回中线
      { text: '鼻梁', orbit: '0deg 88deg auto', fov: 22, click: [0, -40], preferZ: true },
      // 鼻翼：右翼最鼓外侧壁（要朝前的面，勿点到后侧）
      { text: '鼻翼', orbit: '20deg 95deg auto', fov: 18, click: [55, 35], preferZ: true },
      // 鼻底：仰视两孔之间偏上的底面中央
      { text: '鼻底', orbit: '0deg 128deg auto', fov: 20, click: [0, 55], preferZ: true },
      // 鼻孔：左孔开口内
      { text: '鼻孔', orbit: '5deg 130deg auto', fov: 16, click: [-28, 62], preferZ: true },
      // 鼻中隔：小柱中央
      { text: '鼻中隔', orbit: '0deg 130deg auto', fov: 16, click: [0, 78], preferZ: true },
      // 鼻翼脚：右翼落颜面脚
      { text: '鼻翼脚', orbit: '18deg 125deg auto', fov: 16, click: [48, 72], preferZ: true },
    ],
  },
  '03 嘴巴详解.json': {
    key: 'mouth',
    items: [
      // 人中切迹：人中底端 V / 唇谷
      { text: '人中切迹', orbit: '0deg 92deg auto', fov: 14, click: [0, -35], preferZ: true },
      // 口唇外圈脊：上唇红白交界（唇弓中央略上，勿与人中切迹重合）
      { text: '口唇外圈脊状隆起线', orbit: '0deg 90deg auto', fov: 14, click: [-40, -30], preferZ: true },
      // 口角窝：口角内收凹陷（贴口角，勿飘到颊块外缘）
      { text: '口角窝', orbit: '25deg 98deg auto', fov: 16, click: [95, 15], preferZ: true },
      // 沟状凹：下唇中央两圆形隆起汇合处
      { text: '沟状凹', orbit: '0deg 100deg auto', fov: 14, click: [0, 25], preferZ: true },
      // 翼状凹：唇珠右侧凹陷
      { text: '翼状凹', orbit: '10deg 96deg auto', fov: 14, click: [40, 0], preferZ: true },
    ],
  },
  '04 眼眉详解.json': {
    key: 'eye',
    items: [
      // 眉弓隆起：眉头上方骨突（勿太高到额）
      { text: '眉弓隆起', orbit: '5deg 74deg auto', fov: 16, click: [-55, -95], preferZ: true },
      // 眉：落在眉峰毛发区
      { text: '眉', orbit: '18deg 78deg auto', fov: 16, click: [10, -85], preferZ: true },
      // 内眦：真正内眼角（勿点到鼻梁）
      { text: '内眦', orbit: '5deg 90deg auto', fov: 12, click: [-70, 8], preferZ: true },
      // 巩白：虹膜鼻侧眼白（在内眦与虹膜之间）
      { text: '巩白', orbit: '10deg 88deg auto', fov: 12, click: [-35, 5], preferZ: true },
      // 虹膜：色盘中央
      { text: '虹膜', orbit: '18deg 88deg auto', fov: 10, click: [-5, 2], preferZ: true },
      // 角膜：最前突点（略朝相机，略高于虹膜中心）
      { text: '角膜', orbit: '22deg 86deg auto', fov: 10, click: [0, -4], preferZ: true },
      // 眼球：颞侧球体面
      { text: '眼球', orbit: '25deg 88deg auto', fov: 12, click: [35, 2], preferZ: true },
      // 卧蚕：紧贴下睑缘下方带状隆起
      { text: '卧蚕', orbit: '16deg 96deg auto', fov: 12, click: [5, 42], preferZ: true },
      // 睑下沟：卧蚕下方浅凹
      { text: '睑下沟', orbit: '16deg 102deg auto', fov: 12, click: [0, 70], preferZ: true },
    ],
  },
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = {};

  for (const [fileName, pack] of Object.entries(FIXES)) {
    const jsonPath = path.join(jsonDir, fileName);
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const byText = Object.fromEntries(data.pointsData.map((p) => [p.text, p]));
    console.log('\n===', fileName, '===');

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForSelector('#file-input', { state: 'attached' });
    await page.setInputFiles('#file-input', jsonPath);
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.visibility = 'hidden';
      });
      const frame = document.getElementById('anno-mobile-frame-overlay');
      if (frame) frame.hidden = true;
    });

    const sceneRes = [];
    for (const spec of pack.items) {
      const p = byText[spec.text];
      if (!p) {
        sceneRes.push({ text: spec.text, ok: false, error: 'missing' });
        continue;
      }
      await page.evaluate(({ orbit, fov }) => {
        const v = document.querySelector('#workbench-viewer');
        v.setAttribute('camera-target', 'auto auto auto');
        v.setAttribute('camera-orbit', orbit);
        v.setAttribute('field-of-view', `${fov}deg`);
      }, { orbit: spec.orbit, fov: spec.fov });
      await page.waitForTimeout(600);

      const hit = await page.evaluate(({ dx, dy, preferZ }) => {
        const viewer = document.querySelector('#workbench-viewer');
        const rect = viewer.getBoundingClientRect();
        const cx0 = rect.left + rect.width / 2 + dx;
        const cy0 = rect.top + rect.height / 2 + dy;
        const ring = [
          [0, 0], [0, -3], [0, 3], [-3, 0], [3, 0],
          [-6, 6], [6, 6], [-6, -6], [6, -6],
          [0, -10], [0, 10], [-10, 0], [10, 0],
          [-14, 4], [14, 4], [-4, 14], [4, -14],
        ];
        let best = null;
        for (const [ox, oy] of ring) {
          const h = viewer.positionAndNormalFromPoint(cx0 + ox, cy0 + oy);
          if (!h) continue;
          let nx = h.normal.x;
          let ny = h.normal.y;
          let nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          const score = preferZ === false ? -h.position.z : h.position.z + nz * 0.015;
          if (!best || score > best.score) {
            best = {
              score,
              pos: `${h.position.x.toFixed(4)}m ${h.position.y.toFixed(4)}m ${h.position.z.toFixed(4)}m`,
              norm: `${nx.toFixed(4)}m ${ny.toFixed(4)}m ${nz.toFixed(4)}m`,
            };
          }
        }
        return best ? { ok: true, ...best } : { ok: false };
      }, { dx: spec.click[0], dy: spec.click[1], preferZ: spec.preferZ !== false });

      if (!hit.ok) {
        sceneRes.push({ text: spec.text, ok: false, error: 'miss' });
        console.log('  MISS', spec.text);
        continue;
      }
      p.pos = hit.pos;
      p.norm = hit.norm;
      sceneRes.push({ text: spec.text, ok: true, pos: hit.pos });
      console.log('  FIX', spec.text, hit.pos);
    }

    data.timestamp = Date.now();
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    results[fileName] = sceneRes;

    // 验收图
    await page.evaluate(() => {
      const inp = document.querySelector('#file-input');
      if (inp) inp.value = '';
    });
    await page.setInputFiles('#file-input', jsonPath);
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      document.querySelectorAll('#workbench-viewer .preview-hotspot').forEach((el) => {
        el.classList.add('show-text');
      });
    });
    const dir = path.join(outDir, pack.key);
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'after.png') });
    await page.close();
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2));
  console.log('\nDONE', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
