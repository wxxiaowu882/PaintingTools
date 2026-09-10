/**
 * 精确视觉重贴：估目标点 → 相机对准 → 在视口采样射线 →
 * 取「离目标最近且法线与原法线同向」的命中（不再只看法线分）。
 * 对降口角肌等口周点用手调解剖偏移。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;

const SRC_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解.json');
const OUT_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解_黄种人女V8.json');
const NEW_MODEL_SRC = '../docs/model/头部肌肉_黄种人_女_V8_std_opt_20260905111512.glb';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-precise-repick-v8`);

/** 相对口轮匝肌的手调偏移（米）——按亚洲女模口周观感 */
const ANCHOR_OFFSETS = {
  降口角肌: [0.028, -0.022, -0.012], // 口角外下，不要贴到下颌底
  降下唇肌: [-0.018, -0.028, -0.008],
  提上唇肌: [-0.028, 0.012, -0.018], // 左侧鼻唇沟上
  提口角肌: [-0.032, -0.002, -0.022],
  笑肌: [-0.048, -0.018, -0.045],
  颧大肌: [0.048, -0.002, -0.035],
  颧小肌: [0.036, 0.008, -0.028],
  颊肌: [0.042, -0.012, -0.048],
  咬肌: [0.072, -0.012, -0.085],
  眼轮匝肌: [0.042, 0.038, -0.022],
  提上唇鼻翼肌: [0.018, 0.032, -0.012],
  颞肌: [0.082, 0.1, -0.09],
  额肌: [0.04, 0.145, -0.035],
  降眉间肌: [0.0, 0.08, -0.008],
  降眉肌: [-0.018, 0.09, -0.01],
  鼻肌横部: [0.0, 0.045, 0.002],
  降鼻中隔肌: [0.0, 0.006, -0.002],
  口轮匝肌: [0.0, 0.0, 0.0],
  颏肌: [0.008, -0.052, -0.005],
  鼻小压肌: [0.006, 0.022, 0.008],
  鼻前扩张肌: [-0.012, 0.026, 0.004],
  鼻肌翼部: [0.016, 0.02, -0.006],
  枕肌: [0.042, 0.07, -0.255],
};

const CONFIRM = [
  '降口角肌',
  '提上唇肌',
  '口轮匝肌',
  '咬肌',
  '颧大肌',
  '笑肌',
  '颊肌',
  '额肌',
  '枕肌',
  '降下唇肌',
];

function parseVec3m(str) {
  return String(str)
    .replace(/m/g, '')
    .trim()
    .split(/\s+/)
    .map(Number);
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const src = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
  const cur = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  const mouth = cur.pointsData.find((p) => p.text === '口轮匝肌');
  const mouthPos = parseVec3m(mouth.pos);

  const plan = cur.pointsData.map((p, i) => {
    const sp = src.pointsData[i];
    const sn = parseVec3m(sp.norm);
    const off = ANCHOR_OFFSETS[p.text];
    if (!off) throw new Error(`缺少偏移: ${p.text}`);
    const target = add(mouthPos, off);
    const theta = (Math.atan2(sn[0], sn[2]) * 180) / Math.PI;
    const phi = (Math.acos(Math.min(1, Math.max(-1, sn[1]))) * 180) / Math.PI;
    return { id: p.id, text: p.text, target, theta, phi, srcNorm: sn };
  });

  const workPath = path.join(outDir, '_import.json');
  fs.writeFileSync(workPath, JSON.stringify({ ...cur, modelSrc: NEW_MODEL_SRC }, null, 2), 'utf8');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached', timeout: 15000 });
  await page.setInputFiles('#file-input', workPath);
  await page.waitForFunction(
    () => {
      const v = document.querySelector('#workbench-viewer');
      return (
        v &&
        (v.getAttribute('src') || '').includes('黄种人_女_V8') &&
        /23/.test((document.getElementById('point-count') || {}).innerText || '')
      );
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
  });

  const fixes = [];

  for (const t of plan) {
    await page.evaluate(
      ({ target, theta, phi }) => {
        const viewer = document.querySelector('#workbench-viewer');
        const posStr = `${target[0].toFixed(4)}m ${target[1].toFixed(4)}m ${target[2].toFixed(4)}m`;
        viewer.setAttribute('camera-target', posStr);
        viewer.setAttribute('camera-orbit', `${theta}deg ${phi}deg auto`);
        viewer.setAttribute('field-of-view', '18deg');
      },
      { target: t.target, theta: t.theta, phi: t.phi }
    );
    await page.waitForTimeout(650);

    const picked = await page.evaluate(
      ({ target, srcNorm }) => {
        const viewer = document.querySelector('#workbench-viewer');
        const rect = viewer.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        function ray(x, y) {
          return viewer.positionAndNormalFromPoint(x, y);
        }
        function dot(a, b) {
          return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        }
        function dist(a, b) {
          return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        }
        function norm3(v) {
          const l = Math.hypot(v[0], v[1], v[2]) || 1;
          return [v[0] / l, v[1] / l, v[2] / l];
        }

        const samples = [];
        for (let dy = -40; dy <= 40; dy += 8) {
          for (let dx = -40; dx <= 40; dx += 8) {
            samples.push([dx, dy]);
          }
        }
        samples.push([0, 0]);

        let best = null;
        for (const [dx, dy] of samples) {
          const h = ray(cx + dx, cy + dy);
          if (!h) continue;
          let n = norm3([h.normal.x, h.normal.y, h.normal.z]);
          if (dot(n, srcNorm) < 0) n = [-n[0], -n[1], -n[2]];
          const p = [h.position.x, h.position.y, h.position.z];
          const d = dist(p, target);
          const ndot = dot(n, srcNorm);
          // 主目标：靠近估点；法线同向作门槛
          if (ndot < 0.15) continue;
          if (!best || d < best.d) {
            best = { d, ndot, p, n };
          }
        }
        if (!best) return { ok: false, error: 'no hit near target' };
        return {
          ok: true,
          pos: `${best.p[0].toFixed(4)}m ${best.p[1].toFixed(4)}m ${best.p[2].toFixed(4)}m`,
          norm: `${best.n[0].toFixed(4)}m ${best.n[1].toFixed(4)}m ${best.n[2].toFixed(4)}m`,
          distMm: +(best.d * 1000).toFixed(2),
          ndot: +best.ndot.toFixed(3),
        };
      },
      { target: t.target, srcNorm: t.srcNorm }
    );

    if (!picked.ok) {
      fixes.push({ id: t.id, text: t.text, ok: false, error: picked.error, target: t.target });
      continue;
    }

    await page.evaluate(
      ({ id, pos, norm }) => {
        const viewer = document.querySelector('#workbench-viewer');
        const hs = viewer.querySelector(`[slot="hotspot-${id}"]`);
        const nameEl = [...document.querySelectorAll('#points-list .point-name')].find(
          (el) => parseInt(el.getAttribute('data-id'), 10) === id
        );
        if (hs) {
          hs.setAttribute('data-position', pos);
          hs.setAttribute('data-normal', norm);
        }
        if (nameEl) {
          nameEl.setAttribute('data-pos', pos);
          nameEl.setAttribute('data-norm', norm);
        }
      },
      { id: t.id, pos: picked.pos, norm: picked.norm }
    );

    fixes.push({
      id: t.id,
      text: t.text,
      ok: true,
      pos: picked.pos,
      norm: picked.norm,
      distMm: picked.distMm,
      ndot: picked.ndot,
      target: t.target,
    });
  }

  const byId = Object.fromEntries(fixes.filter((f) => f.ok).map((f) => [f.id, f]));
  const out = {
    ...cur,
    timestamp: Date.now(),
    modelSrc: NEW_MODEL_SRC,
    pointsData: cur.pointsData.map((p) => {
      const f = byId[p.id];
      return f ? { ...p, pos: f.pos, norm: f.norm } : p;
    }),
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + '\n', 'utf8');

  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.visibility = '';
        el.style.opacity = '0.45';
      }
    });
  });

  await page.setInputFiles('#file-input', OUT_JSON);
  await page.waitForTimeout(2800);

  for (const name of CONFIRM) {
    await page.evaluate((text) => {
      const inp = [...document.querySelectorAll('#points-list .point-text-input')].find(
        (el) => el.value === text
      );
      if (!inp) return;
      inp.parentElement.querySelector('.point-name')?.click();
    }, name);
    await page.waitForTimeout(900);
    const safe = name.replace(/[^\w\u4e00-\u9fff]+/g, '_');
    await page.screenshot({ path: path.join(outDir, `confirm-${safe}.png`), fullPage: true });
  }

  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-orbit', '0deg 90deg auto');
    v.setAttribute('camera-target', '0m 0.2m 0.08m');
    v.setAttribute('field-of-view', '26deg');
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, 'confirm-front.png'), fullPage: true });

  const failed = fixes.filter((f) => !f.ok);
  const report = {
    ok: failed.length === 0,
    fixed: fixes.filter((f) => f.ok).length,
    failed,
    outDir: path.relative(repoRoot, outDir),
    points: fixes,
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  await browser.close();
  console.log(JSON.stringify({ ok: report.ok, fixed: report.fixed, failed, outDir: report.outDir }, null, 2));
  if (!report.ok) process.exitCode = 1;
  else console.log('PASS precise-repick-v8');
})().catch((e) => {
  console.error('FAIL', e);
  process.exitCode = 1;
});
