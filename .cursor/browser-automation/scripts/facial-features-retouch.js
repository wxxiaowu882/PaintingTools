/**
 * 五官标注微调：对照网上解剖资料 + 造型规律文档，重拾表面点位。
 *
 * 依据摘要：
 * - 耳：耳轮脚几乎水平穿入耳甲，把耳甲分为上艇下腔；三角凹在对耳轮上下脚之间；
 *   舟状凹在耳轮与对耳轮之间；前缺口≈耳屏上切迹；凹入缺口≈耳屏切迹（屏间切迹）。
 * - 鼻：鼻根=额鼻最凹；鼻梁=中线棱；鼻头=尖端半球；鼻翼=两侧半圆；
 *   鼻底=底面三角；鼻中隔/小柱居中分隔鼻孔；鼻翼脚=鼻翼落颜面处。
 * - 唇：人中沟+人中脊；人中切迹=人中底端 V/唇谷；唇峰=丘比特弓峰；
 *   唇珠=上唇中央结节；翼状凹在唇珠两侧；口角窝在口角内收处；唇颏沟在下唇与颏之间。
 * - 眼：睑眉沟在眉下与上睑交会；睑上沟=重睑皱襞；卧蚕紧贴下睑缘带状隆起；
 *   睑下沟在卧蚕下方浅凹；角膜最前突，虹膜为其下色盘，巩白在虹膜外侧眼白。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-retouch`);
const jsonDir = path.join(repoRoot, 'docs', 'json', '结构_五官');
const DEFAULT_COLOR = '#c2c2c2';

/** 相对模型屏幕包围盒的 uv（原点左上），并指定合适相机 */
const PLANS = {
  '01 耳朵详解.json': {
    key: 'ear',
    defaultOrbit: '18deg 90deg auto',
    defaultFov: 24,
    points: [
      // 耳轮脚：水平穿入耳甲的那道脊（分艇/腔）
      { text: '耳轮脚', orbit: '12deg 92deg auto', fov: 20, u: 0.38, v: 0.46 },
      // 耳轮：最上外缘卷边
      { text: '耳轮', orbit: '28deg 82deg auto', fov: 24, u: 0.66, v: 0.16 },
      // 耳垂：最下无软骨软组织
      { text: '耳垂', orbit: '18deg 98deg auto', fov: 24, u: 0.52, v: 0.91 },
      // 对耳轮：主脊中段（Y 的竖干）
      { text: '对耳轮', orbit: '22deg 92deg auto', fov: 20, u: 0.56, v: 0.54 },
      // 上脚：向前上分叉
      { text: '对耳轮上脚', orbit: '18deg 80deg auto', fov: 20, u: 0.50, v: 0.24 },
      // 下脚：较锐、偏水平
      { text: '对耳轮下脚', orbit: '14deg 88deg auto', fov: 20, u: 0.40, v: 0.33 },
      // 耳屏：外耳道前遮挡突起
      { text: '耳屏', orbit: '5deg 94deg auto', fov: 20, u: 0.20, v: 0.54 },
      // 对耳屏：与耳屏相对、耳垂上方小突
      { text: '对耳屏', orbit: '18deg 98deg auto', fov: 20, u: 0.46, v: 0.71 },
      // 凹入缺口：耳屏与对耳屏之间的屏间切迹
      { text: '凹入缺口', orbit: '12deg 96deg auto', fov: 18, u: 0.32, v: 0.64 },
      // 前缺口：耳屏与耳轮脚之间的耳屏上切迹
      { text: '前缺口', orbit: '5deg 90deg auto', fov: 18, u: 0.26, v: 0.42 },
      // 耳甲腔：耳轮脚下方大凹，朝向外耳道
      { text: '耳甲腔', orbit: '14deg 94deg auto', fov: 18, u: 0.34, v: 0.58 },
      // 耳甲艇：耳轮脚上方小凹
      { text: '耳甲艇', orbit: '14deg 88deg auto', fov: 18, u: 0.40, v: 0.38 },
      // 三角凹：对耳轮上下脚之间
      { text: '三角凹', orbit: '20deg 78deg auto', fov: 18, u: 0.48, v: 0.20 },
      // 舟状凹：耳轮与对耳轮之间长沟
      { text: '舟状凹', orbit: '32deg 88deg auto', fov: 20, u: 0.72, v: 0.36 },
    ],
  },
  '02 鼻子详解.json': {
    key: 'nose',
    defaultOrbit: '0deg 90deg auto',
    defaultFov: 26,
    points: [
      { text: '鼻根', orbit: '0deg 82deg auto', fov: 24, u: 0.50, v: 0.08 },
      { text: '鼻梁', orbit: '0deg 88deg auto', fov: 24, u: 0.50, v: 0.34 },
      { text: '鼻头', orbit: '0deg 96deg auto', fov: 20, u: 0.50, v: 0.58 },
      // 鼻翼：半圆形外侧壁最鼓处（右翼）
      { text: '鼻翼', orbit: '28deg 98deg auto', fov: 20, u: 0.78, v: 0.64 },
      // 鼻底：仰视底面三角中央（两孔之间偏上的底面）
      { text: '鼻底', orbit: '0deg 125deg auto', fov: 22, u: 0.50, v: 0.70 },
      // 鼻中隔/小柱：两孔之间的柱
      { text: '鼻中隔', orbit: '0deg 128deg auto', fov: 18, u: 0.50, v: 0.86 },
      // 鼻孔：左鼻孔开口内缘
      { text: '鼻孔', orbit: '8deg 128deg auto', fov: 18, u: 0.34, v: 0.78 },
      // 鼻翼脚：鼻翼落颜面的附着脚
      { text: '鼻翼脚', orbit: '22deg 122deg auto', fov: 18, u: 0.74, v: 0.88 },
    ],
  },
  '03 嘴巴详解.json': {
    key: 'mouth',
    defaultOrbit: '0deg 95deg auto',
    defaultFov: 24,
    points: [
      { text: '人中', orbit: '0deg 88deg auto', fov: 18, u: 0.50, v: 0.14 },
      { text: '人中脊', orbit: '10deg 88deg auto', fov: 18, u: 0.62, v: 0.16 },
      // 人中切迹：人中底端 V / 唇谷
      { text: '人中切迹', orbit: '0deg 92deg auto', fov: 16, u: 0.50, v: 0.28 },
      // 唇峰：右侧丘比特弓峰
      { text: '唇峰', orbit: '12deg 92deg auto', fov: 16, u: 0.62, v: 0.30 },
      { text: '唇珠', orbit: '0deg 96deg auto', fov: 16, u: 0.50, v: 0.42 },
      { text: '翼状凹', orbit: '14deg 96deg auto', fov: 16, u: 0.66, v: 0.42 },
      { text: '下唇圆形隆起', orbit: '14deg 100deg auto', fov: 16, u: 0.64, v: 0.58 },
      { text: '沟状凹', orbit: '0deg 100deg auto', fov: 16, u: 0.50, v: 0.54 },
      // 口唇外圈脊：上唇白唇-红唇交界脊（唇弓线，勿点到红唇体心）
      { text: '口唇外圈脊状隆起线', orbit: '0deg 90deg auto', fov: 18, u: 0.50, v: 0.30 },
      { text: '口角窝', orbit: '38deg 100deg auto', fov: 18, u: 0.88, v: 0.48 },
      { text: '唇颏沟', orbit: '0deg 108deg auto', fov: 18, u: 0.50, v: 0.76 },
    ],
  },
  '04 眼眉详解.json': {
    key: 'eye',
    defaultOrbit: '12deg 86deg auto',
    defaultFov: 24,
    points: [
      // 眉弓隆起：眉头上方骨性瓜子突
      { text: '眉弓隆起', orbit: '5deg 72deg auto', fov: 20, u: 0.26, v: 0.08 },
      // 眉：眉峰附近毛发区
      { text: '眉', orbit: '18deg 76deg auto', fov: 20, u: 0.52, v: 0.14 },
      // 睑眉沟：眉下与上睑交会的谷
      { text: '睑眉沟', orbit: '14deg 80deg auto', fov: 18, u: 0.50, v: 0.26 },
      // 睑上沟：重睑皱襞
      { text: '睑上沟', orbit: '16deg 84deg auto', fov: 16, u: 0.54, v: 0.36 },
      // 上眼睑：重睑下、睑缘上的睑板前皮肤
      { text: '上眼睑', orbit: '16deg 86deg auto', fov: 16, u: 0.54, v: 0.44 },
      // 下眼睑：下睑缘带
      { text: '下眼睑', orbit: '16deg 94deg auto', fov: 16, u: 0.54, v: 0.60 },
      { text: '内眦', orbit: '0deg 90deg auto', fov: 14, u: 0.14, v: 0.52 },
      { text: '外眦', orbit: '35deg 90deg auto', fov: 14, u: 0.88, v: 0.48 },
      // 眼球：球体面（略偏巩白侧，避免与虹膜完全重合）
      { text: '眼球', orbit: '18deg 88deg auto', fov: 14, u: 0.60, v: 0.50 },
      // 虹膜：色盘中央区
      { text: '虹膜', orbit: '18deg 88deg auto', fov: 12, u: 0.50, v: 0.50 },
      // 角膜：最前突的透明罩（略朝相机）
      { text: '角膜', orbit: '22deg 88deg auto', fov: 12, u: 0.52, v: 0.48 },
      // 巩白：虹膜鼻侧或颞侧眼白
      { text: '巩白', orbit: '12deg 88deg auto', fov: 12, u: 0.28, v: 0.50 },
      // 卧蚕：紧贴下睑缘的带状肌肉隆起
      { text: '卧蚕', orbit: '18deg 96deg auto', fov: 14, u: 0.54, v: 0.66 },
      // 睑下沟：卧蚕下方浅凹（非泪沟）
      { text: '睑下沟', orbit: '18deg 102deg auto', fov: 14, u: 0.52, v: 0.80 },
    ],
  },
};

function makePoint(id, hit, text) {
  return {
    id,
    type: 'point',
    slot: `hotspot-${id}`,
    pos: hit.pos,
    norm: hit.norm,
    text,
    color: DEFAULT_COLOR,
    hidden: false,
    showTextOnLoad: true,
    desc: '',
    customData: {},
  };
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const only = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()) : null;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.waitForSelector('#workbench-viewer', { timeout: 20000 });

  const report = {};

  for (const [fileName, plan] of Object.entries(PLANS)) {
    if (only && !only.includes(plan.key)) {
      console.log('skip', plan.key);
      continue;
    }
    const jsonPath = path.join(jsonDir, fileName);
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log('\n=== retouch', fileName, '===');

    await page.evaluate(() => {
      const inp = document.querySelector('#file-input');
      if (inp) inp.value = '';
    });
    await page.setInputFiles('#file-input', jsonPath);
    await page.waitForFunction(
      () => {
        const v = document.querySelector('#workbench-viewer');
        return v && v.getAttribute('src') && v.getAttribute('src').length > 5;
      },
      null,
      { timeout: 120000 }
    );
    await page.waitForTimeout(2500);

    await page.evaluate(() => {
      ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.visibility = 'hidden';
      });
      const frame = document.getElementById('anno-mobile-frame-overlay');
      if (frame) frame.hidden = true;
    });

    const points = [];
    const misses = [];
    let nextId = 1;
    const boundsCache = new Map();

    async function getBounds(orbit, fov) {
      const key = `${orbit}|${fov}`;
      if (boundsCache.has(key)) return boundsCache.get(key);
      await page.evaluate(
        ({ orbit, fov }) => {
          const v = document.querySelector('#workbench-viewer');
          v.setAttribute('camera-target', 'auto auto auto');
          v.setAttribute('camera-orbit', orbit);
          v.setAttribute('field-of-view', `${fov}deg`);
        },
        { orbit, fov }
      );
      await page.waitForTimeout(550);
      const bounds = await page.evaluate(() => {
        const viewer = document.querySelector('#workbench-viewer');
        const rect = viewer.getBoundingClientRect();
        const step = 0.035;
        let minX = 1;
        let minY = 1;
        let maxX = 0;
        let maxY = 0;
        let any = false;
        for (let yy = 0.05; yy <= 0.95; yy += step) {
          for (let xx = 0.05; xx <= 0.95; xx += step) {
            const cx = rect.left + rect.width * xx;
            const cy = rect.top + rect.height * yy;
            if (viewer.positionAndNormalFromPoint(cx, cy)) {
              any = true;
              if (xx < minX) minX = xx;
              if (yy < minY) minY = yy;
              if (xx > maxX) maxX = xx;
              if (yy > maxY) maxY = yy;
            }
          }
        }
        return any ? { minX, minY, maxX, maxY } : null;
      });
      boundsCache.set(key, bounds);
      return bounds;
    }

    for (const spec of plan.points) {
      const orbit = spec.orbit || plan.defaultOrbit;
      const fov = spec.fov || plan.defaultFov;
      const bounds = await getBounds(orbit, fov);
      if (!bounds) {
        misses.push({ text: spec.text, error: 'no-bounds' });
        console.log('  MISS', spec.text);
        continue;
      }

      const hit = await page.evaluate(({ u, v, bounds }) => {
        const viewer = document.querySelector('#workbench-viewer');
        const rect = viewer.getBoundingClientRect();
        const sx = bounds.minX + (bounds.maxX - bounds.minX) * u;
        const sy = bounds.minY + (bounds.maxY - bounds.minY) * v;
        const baseX = rect.left + rect.width * sx;
        const baseY = rect.top + rect.height * sy;
        const tries = [
          [0, 0], [0, -3], [0, 3], [-3, 0], [3, 0],
          [-5, 5], [5, 5], [-5, -5], [5, -5],
          [0, -8], [0, 8], [-8, 0], [8, 0],
          [-12, 4], [12, 4], [-4, 12], [4, -12],
        ];
        let best = null;
        for (const [ox, oy] of tries) {
          const h = viewer.positionAndNormalFromPoint(baseX + ox, baseY + oy);
          if (!h) continue;
          let nx = h.normal.x;
          let ny = h.normal.y;
          let nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          // 偏好更靠前（更大 z）的表面，减少点到凹底背面
          const score = h.position.z + nz * 0.02;
          if (!best || score > best.score) {
            best = {
              score,
              pos: `${h.position.x.toFixed(4)}m ${h.position.y.toFixed(4)}m ${h.position.z.toFixed(4)}m`,
              norm: `${nx.toFixed(4)}m ${ny.toFixed(4)}m ${nz.toFixed(4)}m`,
            };
          }
        }
        return best ? { ok: true, ...best } : { ok: false, error: 'miss' };
      }, { u: spec.u, v: spec.v, bounds });

      if (!hit.ok) {
        misses.push({ text: spec.text, error: hit.error });
        console.log('  MISS', spec.text);
        continue;
      }
      points.push(makePoint(nextId++, hit, spec.text));
      console.log('  OK', spec.text, hit.pos);
    }

    data.pointsData = points;
    data.timestamp = Date.now();
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    report[fileName] = { count: points.length, placed: points.map((p) => p.text), misses };
  }

  // 每场景新开页验收截图
  for (const [fileName, plan] of Object.entries(PLANS)) {
    if (only && !only.includes(plan.key)) continue;
    const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page2.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page2.waitForSelector('#file-input', { state: 'attached' });
    await page2.setInputFiles('#file-input', path.join(jsonDir, fileName));
    await page2.waitForTimeout(3500);
    await page2.evaluate(({ orbit, fov }) => {
      ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.visibility = 'hidden';
      });
      const frame = document.getElementById('anno-mobile-frame-overlay');
      if (frame) frame.hidden = true;
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-orbit', orbit);
      v.setAttribute('field-of-view', `${fov}deg`);
      v.querySelectorAll('.preview-hotspot').forEach((el) => el.classList.add('show-text'));
    }, { orbit: plan.defaultOrbit, fov: plan.defaultFov });
    await page2.waitForTimeout(900);
    const sceneDir = path.join(outDir, plan.key);
    fs.mkdirSync(sceneDir, { recursive: true });
    await page2.screenshot({ path: path.join(sceneDir, 'annotated.png') });
    await page2.close();
    console.log('shot', plan.key);
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\nDONE', outDir);
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
