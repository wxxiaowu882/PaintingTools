/**
 * 五官标注：按文档名词 + 多视角视觉，表面点位写入 结构_五官/*.json
 * 方案 1A+2A：只写 text，desc 空，不做快照。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-annotate`);
const jsonDir = path.join(repoRoot, 'docs', 'json', '结构_五官');

const DEFAULT_COLOR = '#c2c2c2';

/**
 * 每个点：orbit / fov / 相对「模型屏幕包围盒」的 uv（0-1，原点左上）
 * 仅标注文档有、且模型上看得见的部位。
 */
const PLANS = {
  '01 耳朵详解.json': {
    key: 'ear',
    // 侧视最能看清耳廓结构
    defaultOrbit: '20deg 90deg auto',
    defaultFov: 26,
    points: [
      { text: '耳轮脚', orbit: '15deg 90deg auto', fov: 24, u: 0.42, v: 0.48 },
      { text: '耳轮', orbit: '25deg 85deg auto', fov: 26, u: 0.62, v: 0.22 },
      { text: '耳垂', orbit: '20deg 95deg auto', fov: 26, u: 0.55, v: 0.88 },
      { text: '对耳轮', orbit: '25deg 90deg auto', fov: 24, u: 0.58, v: 0.52 },
      { text: '对耳轮上脚', orbit: '20deg 82deg auto', fov: 24, u: 0.52, v: 0.28 },
      { text: '对耳轮下脚', orbit: '18deg 88deg auto', fov: 24, u: 0.48, v: 0.36 },
      { text: '耳屏', orbit: '10deg 92deg auto', fov: 24, u: 0.28, v: 0.55 },
      { text: '对耳屏', orbit: '20deg 95deg auto', fov: 24, u: 0.48, v: 0.72 },
      { text: '凹入缺口', orbit: '15deg 95deg auto', fov: 22, u: 0.36, v: 0.66 },
      { text: '前缺口', orbit: '8deg 90deg auto', fov: 22, u: 0.30, v: 0.42 },
      { text: '耳甲腔', orbit: '18deg 92deg auto', fov: 22, u: 0.40, v: 0.58 },
      { text: '耳甲艇', orbit: '18deg 88deg auto', fov: 22, u: 0.44, v: 0.42 },
      { text: '三角凹', orbit: '22deg 80deg auto', fov: 22, u: 0.50, v: 0.24 },
      { text: '舟状凹', orbit: '30deg 88deg auto', fov: 24, u: 0.68, v: 0.40 },
    ],
  },
  '02 鼻子详解.json': {
    key: 'nose',
    defaultOrbit: '0deg 90deg auto',
    defaultFov: 28,
    points: [
      { text: '鼻根', orbit: '0deg 85deg auto', fov: 26, u: 0.50, v: 0.12 },
      { text: '鼻梁', orbit: '0deg 88deg auto', fov: 26, u: 0.50, v: 0.38 },
      { text: '鼻头', orbit: '0deg 95deg auto', fov: 24, u: 0.50, v: 0.62 },
      { text: '鼻翼', orbit: '25deg 95deg auto', fov: 24, u: 0.72, v: 0.68 },
      { text: '鼻底', orbit: '0deg 115deg auto', fov: 26, u: 0.50, v: 0.78 },
      { text: '鼻中隔', orbit: '0deg 120deg auto', fov: 22, u: 0.50, v: 0.82 },
      { text: '鼻孔', orbit: '15deg 125deg auto', fov: 22, u: 0.38, v: 0.80 },
      { text: '鼻翼脚', orbit: '20deg 120deg auto', fov: 22, u: 0.68, v: 0.84 },
    ],
  },
  '03 嘴巴详解.json': {
    key: 'mouth',
    defaultOrbit: '0deg 95deg auto',
    defaultFov: 26,
    points: [
      { text: '人中', orbit: '0deg 90deg auto', fov: 22, u: 0.50, v: 0.18 },
      { text: '人中脊', orbit: '8deg 90deg auto', fov: 22, u: 0.58, v: 0.20 },
      { text: '人中切迹', orbit: '0deg 92deg auto', fov: 20, u: 0.50, v: 0.28 },
      { text: '唇峰', orbit: '10deg 92deg auto', fov: 20, u: 0.58, v: 0.32 },
      { text: '唇珠', orbit: '0deg 95deg auto', fov: 20, u: 0.50, v: 0.42 },
      { text: '翼状凹', orbit: '12deg 95deg auto', fov: 20, u: 0.62, v: 0.42 },
      { text: '下唇圆形隆起', orbit: '12deg 98deg auto', fov: 20, u: 0.60, v: 0.58 },
      { text: '沟状凹', orbit: '0deg 98deg auto', fov: 20, u: 0.50, v: 0.55 },
      { text: '口唇外圈脊状隆起线', orbit: '0deg 92deg auto', fov: 22, u: 0.50, v: 0.34 },
      { text: '口角窝', orbit: '35deg 98deg auto', fov: 22, u: 0.82, v: 0.50 },
      { text: '唇颏沟', orbit: '0deg 105deg auto', fov: 22, u: 0.50, v: 0.72 },
    ],
  },
  '04 眼眉详解.json': {
    key: 'eye',
    defaultOrbit: '15deg 85deg auto',
    defaultFov: 26,
    points: [
      { text: '眉弓隆起', orbit: '10deg 75deg auto', fov: 24, u: 0.28, v: 0.14 },
      { text: '眉', orbit: '15deg 78deg auto', fov: 24, u: 0.45, v: 0.18 },
      { text: '睑眉沟', orbit: '15deg 82deg auto', fov: 22, u: 0.48, v: 0.30 },
      { text: '睑上沟', orbit: '18deg 85deg auto', fov: 20, u: 0.52, v: 0.40 },
      { text: '上眼睑', orbit: '18deg 86deg auto', fov: 20, u: 0.52, v: 0.46 },
      { text: '下眼睑', orbit: '18deg 92deg auto', fov: 20, u: 0.52, v: 0.62 },
      { text: '内眦', orbit: '5deg 90deg auto', fov: 18, u: 0.22, v: 0.52 },
      { text: '外眦', orbit: '30deg 90deg auto', fov: 18, u: 0.82, v: 0.50 },
      { text: '眼球', orbit: '20deg 88deg auto', fov: 18, u: 0.55, v: 0.52 },
      { text: '虹膜', orbit: '20deg 88deg auto', fov: 16, u: 0.52, v: 0.52 },
      { text: '角膜', orbit: '25deg 88deg auto', fov: 16, u: 0.54, v: 0.50 },
      { text: '巩白', orbit: '18deg 88deg auto', fov: 16, u: 0.38, v: 0.50 },
      { text: '卧蚕', orbit: '20deg 95deg auto', fov: 18, u: 0.52, v: 0.68 },
      { text: '睑下沟', orbit: '20deg 98deg auto', fov: 18, u: 0.50, v: 0.76 },
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
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.waitForSelector('#workbench-viewer', { timeout: 20000 });

  const report = {};

  const only = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()) : null;

  for (const [fileName, plan] of Object.entries(PLANS)) {
    if (only && !only.includes(plan.key)) {
      console.log('skip', plan.key);
      continue;
    }
    const jsonPath = path.join(jsonDir, fileName);
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log('\n===', fileName, '===');

    await page.setInputFiles('#file-input', jsonPath);
    await page.waitForFunction(
      () => {
        const v = document.querySelector('#workbench-viewer');
        return v && v.getAttribute('src') && v.getAttribute('src').length > 5;
      },
      null,
      { timeout: 120000 }
    );
    await page.waitForTimeout(2800);

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
      await page.waitForTimeout(500);
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
        misses.push({ text: spec.text, error: 'no-model-bounds' });
        console.log('  MISS', spec.text, 'no-model-bounds');
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
          [0, 0], [0, -4], [0, 4], [-4, 0], [4, 0],
          [-6, 6], [6, 6], [-6, -6], [6, -6],
          [0, -10], [0, 10], [-10, 0], [10, 0],
        ];
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
          return {
            ok: true,
            pos: `${h.position.x.toFixed(4)}m ${h.position.y.toFixed(4)}m ${h.position.z.toFixed(4)}m`,
            norm: `${nx.toFixed(4)}m ${ny.toFixed(4)}m ${nz.toFixed(4)}m`,
          };
        }
        return { ok: false, error: 'miss' };
      }, { u: spec.u, v: spec.v, bounds });

      if (!hit.ok) {
        misses.push({ text: spec.text, error: hit.error, detail: hit });
        console.log('  MISS', spec.text, hit.error);
        continue;
      }

      points.push(makePoint(nextId++, hit, spec.text));
      console.log('  OK', spec.text, hit.pos);
    }

    data.pointsData = points;
    data.timestamp = Date.now();
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

    if (process.env.SKIP_SHOT !== '1') {
      try {
        const sceneDir = path.join(outDir, plan.key);
        fs.mkdirSync(sceneDir, { recursive: true });
        await page.evaluate(
          ({ orbit, fov }) => {
            const v = document.querySelector('#workbench-viewer');
            v.setAttribute('camera-orbit', orbit);
            v.setAttribute('field-of-view', `${fov}deg`);
            v.querySelectorAll('.preview-hotspot').forEach((el) => el.classList.add('show-text'));
          },
          { orbit: plan.defaultOrbit, fov: plan.defaultFov }
        );
        // 直接在当前页注入点位展示较难；用已写盘 JSON 再导入（同路径先清空）
        await page.evaluate(() => {
          const inp = document.querySelector('#file-input');
          if (inp) inp.value = '';
        });
        await page.setInputFiles('#file-input', jsonPath);
        await page.waitForTimeout(3500);
        await page.evaluate(() => {
          document.querySelectorAll('#workbench-viewer .preview-hotspot').forEach((el) => {
            el.classList.add('show-text');
          });
        });
        await page.screenshot({ path: path.join(sceneDir, 'annotated.png'), timeout: 15000 });
      } catch (shotErr) {
        console.warn('screenshot step failed (json already saved):', shotErr.message);
      }
    }

    report[fileName] = {
      placed: points.map((p) => p.text),
      misses,
      count: points.length,
    };
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\nDONE', outDir);
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
