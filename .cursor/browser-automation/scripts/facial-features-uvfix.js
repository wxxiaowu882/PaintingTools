/**
 * 仅对「偏差明确」的少数点做包围盒 uv 纠偏（不用画布中心点击，避免 FOV 漂移）。
 * 在 facial-features-retouch 基线之上运行。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonDir = path.join(repoRoot, 'docs', 'json', '结构_五官');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-uvfix`);

const FIXES = {
  '01 耳朵详解.json': [
    // 耳屏必须落在耳屏软骨突上，勿落到底座平面：略靠右、略靠上
    { text: '耳屏', orbit: '8deg 92deg auto', fov: 18, u: 0.24, v: 0.52 },
    // 耳垂落在耳垂体心，勿落到底座
    { text: '耳垂', orbit: '18deg 98deg auto', fov: 20, u: 0.50, v: 0.86 },
    // 前缺口：耳屏上切迹（耳屏与耳轮脚之间）
    { text: '前缺口', orbit: '6deg 90deg auto', fov: 16, u: 0.28, v: 0.44 },
  ],
  '02 鼻子详解.json': [
    // 鼻梁：鼻根与鼻头之间中段中线
    { text: '鼻梁', orbit: '0deg 88deg auto', fov: 22, u: 0.50, v: 0.36 },
    // 鼻头：最前突半球顶点
    { text: '鼻头', orbit: '0deg 98deg auto', fov: 18, u: 0.50, v: 0.60 },
    // 鼻翼：右翼最鼓处（偏侧视，取前向面）
    { text: '鼻翼', orbit: '22deg 96deg auto', fov: 18, u: 0.76, v: 0.62 },
    // 鼻孔：左孔腔口
    { text: '鼻孔', orbit: '5deg 128deg auto', fov: 16, u: 0.36, v: 0.76 },
    // 鼻底：仰视底面中央（两孔之间偏上）
    { text: '鼻底', orbit: '0deg 126deg auto', fov: 18, u: 0.50, v: 0.68 },
    // 鼻中隔：小柱
    { text: '鼻中隔', orbit: '0deg 130deg auto', fov: 16, u: 0.50, v: 0.84 },
  ],
  '03 嘴巴详解.json': [
    // 人中切迹：人中底端 V
    { text: '人中切迹', orbit: '0deg 92deg auto', fov: 14, u: 0.50, v: 0.27 },
    // 口唇外圈脊：右侧唇峰处的红白交界脊（与人中切迹错开）
    { text: '口唇外圈脊状隆起线', orbit: '8deg 90deg auto', fov: 14, u: 0.62, v: 0.30 },
    // 口角窝：贴口角内收凹，勿飘到颊块外缘
    { text: '口角窝', orbit: '28deg 98deg auto', fov: 16, u: 0.84, v: 0.48 },
    // 唇珠：上唇中央结节
    { text: '唇珠', orbit: '0deg 96deg auto', fov: 14, u: 0.50, v: 0.42 },
    // 翼状凹：唇珠右侧
    { text: '翼状凹', orbit: '12deg 96deg auto', fov: 14, u: 0.66, v: 0.42 },
  ],
  '04 眼眉详解.json': [
    // 内眦：内眼角（在鼻梁与虹膜之间，贴睑裂内侧角）
    { text: '内眦', orbit: '2deg 90deg auto', fov: 12, u: 0.20, v: 0.52 },
    // 巩白：虹膜鼻侧眼白
    { text: '巩白', orbit: '8deg 88deg auto', fov: 12, u: 0.32, v: 0.50 },
    // 虹膜 / 角膜略错开
    { text: '虹膜', orbit: '16deg 88deg auto', fov: 10, u: 0.50, v: 0.51 },
    { text: '角膜', orbit: '20deg 86deg auto', fov: 10, u: 0.52, v: 0.48 },
    // 眼球：颞侧球体面
    { text: '眼球', orbit: '28deg 88deg auto', fov: 12, u: 0.68, v: 0.50 },
    // 眉弓隆起 / 眉：保持在上部
    { text: '眉弓隆起', orbit: '5deg 72deg auto', fov: 18, u: 0.28, v: 0.10 },
    { text: '眉', orbit: '16deg 76deg auto', fov: 18, u: 0.50, v: 0.14 },
    // 卧蚕 / 睑下沟层次
    { text: '卧蚕', orbit: '16deg 96deg auto', fov: 12, u: 0.52, v: 0.66 },
    { text: '睑下沟', orbit: '16deg 102deg auto', fov: 12, u: 0.50, v: 0.80 },
  ],
};

(async () => {
  // 等基线 retouch 写完（若仍在跑，短暂轮询点数）
  for (let i = 0; i < 90; i++) {
    const eye = JSON.parse(fs.readFileSync(path.join(jsonDir, '04 眼眉详解.json'), 'utf8'));
    const brow = eye.pointsData.find((p) => p.text === '眉弓隆起');
    if (brow && Number(brow.pos.split(' ')[1]) > 0.22) break; // y 已回到眉区
    await new Promise((r) => setTimeout(r, 2000));
  }

  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const report = {};

  for (const [fileName, specs] of Object.entries(FIXES)) {
    const jsonPath = path.join(jsonDir, fileName);
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const byText = Object.fromEntries(data.pointsData.map((p) => [p.text, p]));
    console.log('\n=== uvfix', fileName, '===');

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForSelector('#file-input', { state: 'attached' });
    await page.setInputFiles('#file-input', jsonPath);
    await page.waitForTimeout(3200);
    await page.evaluate(() => {
      ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.visibility = 'hidden';
      });
      const frame = document.getElementById('anno-mobile-frame-overlay');
      if (frame) frame.hidden = true;
    });

    const boundsCache = new Map();
    async function getBounds(orbit, fov) {
      const key = `${orbit}|${fov}`;
      if (boundsCache.has(key)) return boundsCache.get(key);
      await page.evaluate(({ orbit, fov }) => {
        const v = document.querySelector('#workbench-viewer');
        v.setAttribute('camera-target', 'auto auto auto');
        v.setAttribute('camera-orbit', orbit);
        v.setAttribute('field-of-view', `${fov}deg`);
      }, { orbit, fov });
      await page.waitForTimeout(500);
      const bounds = await page.evaluate(() => {
        const viewer = document.querySelector('#workbench-viewer');
        const rect = viewer.getBoundingClientRect();
        const step = 0.035;
        let minX = 1, minY = 1, maxX = 0, maxY = 0, any = false;
        for (let yy = 0.05; yy <= 0.95; yy += step) {
          for (let xx = 0.05; xx <= 0.95; xx += step) {
            const cx = rect.left + rect.width * xx;
            const cy = rect.top + rect.height * yy;
            if (viewer.positionAndNormalFromPoint(cx, cy)) {
              any = true;
              minX = Math.min(minX, xx); minY = Math.min(minY, yy);
              maxX = Math.max(maxX, xx); maxY = Math.max(maxY, yy);
            }
          }
        }
        return any ? { minX, minY, maxX, maxY } : null;
      });
      boundsCache.set(key, bounds);
      return bounds;
    }

    const sceneRes = [];
    for (const spec of specs) {
      const p = byText[spec.text];
      if (!p) {
        sceneRes.push({ text: spec.text, ok: false, error: 'missing' });
        continue;
      }
      const bounds = await getBounds(spec.orbit, spec.fov);
      if (!bounds) {
        sceneRes.push({ text: spec.text, ok: false, error: 'no-bounds' });
        continue;
      }
      const hit = await page.evaluate(({ u, v, bounds }) => {
        const viewer = document.querySelector('#workbench-viewer');
        const rect = viewer.getBoundingClientRect();
        const sx = bounds.minX + (bounds.maxX - bounds.minX) * u;
        const sy = bounds.minY + (bounds.maxY - bounds.minY) * v;
        const baseX = rect.left + rect.width * sx;
        const baseY = rect.top + rect.height * sy;
        const tries = [[0,0],[0,-3],[0,3],[-3,0],[3,0],[-6,6],[6,6],[-6,-6],[6,-6],[0,-10],[0,10],[-10,0],[10,0]];
        let best = null;
        for (const [ox, oy] of tries) {
          const h = viewer.positionAndNormalFromPoint(baseX + ox, baseY + oy);
          if (!h) continue;
          let nx = h.normal.x, ny = h.normal.y, nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len; ny /= len; nz /= len;
          const score = h.position.z + nz * 0.02;
          if (!best || score > best.score) {
            best = {
              score,
              pos: `${h.position.x.toFixed(4)}m ${h.position.y.toFixed(4)}m ${h.position.z.toFixed(4)}m`,
              norm: `${nx.toFixed(4)}m ${ny.toFixed(4)}m ${nz.toFixed(4)}m`,
            };
          }
        }
        return best ? { ok: true, ...best } : { ok: false };
      }, { u: spec.u, v: spec.v, bounds });

      if (!hit.ok) {
        sceneRes.push({ text: spec.text, ok: false });
        console.log('  MISS', spec.text);
        continue;
      }
      p.pos = hit.pos;
      p.norm = hit.norm;
      sceneRes.push({ text: spec.text, ok: true, pos: hit.pos });
      console.log('  OK', spec.text, hit.pos);
    }

    data.timestamp = Date.now();
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');
    report[fileName] = sceneRes;

    await page.evaluate(() => {
      const inp = document.querySelector('#file-input');
      if (inp) inp.value = '';
    });
    await page.setInputFiles('#file-input', jsonPath);
    await page.waitForTimeout(2800);
    await page.evaluate(() => {
      document.querySelectorAll('#workbench-viewer .preview-hotspot').forEach((el) => el.classList.add('show-text'));
    });
    const key = fileName.match(/\d+/)[0];
    const names = { '01': 'ear', '02': 'nose', '03': 'mouth', '04': 'eye' };
    const dir = path.join(outDir, names[key] || key);
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'after.png') });
    await page.close();
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('DONE', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
