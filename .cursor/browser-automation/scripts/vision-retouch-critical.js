/**
 * 视觉复核后的关键点重选（正面/侧视点选，法线强制朝向相机）。
 * 只改看图判定明显错误的点，不跑解剖偏移公式。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const OUT_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解_黄种人女V8.json');
const SRC_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解.json');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-vision-retouch`);

/** 看确认图后定的点选：正面优先判高度，侧视补深度 */
const RETOUCH = [
  // 口轮匝肌：唇前表面中部，不要点到唇下缘内侧
  { text: '口轮匝肌', orbit: '0deg 90deg 0.55m', target: '0m 0.178m 0.12m', fov: 16, click: [0, 2] },
  // 降口角肌：口角外下三角肌腹中部（正面高度 ≈ 口角与颏之间偏上）
  { text: '降口角肌', orbit: '18deg 92deg 0.5m', target: '0.028m 0.155m 0.11m', fov: 15, click: [22, 14] },
  // 降下唇肌：下唇外下、略偏左，仍在前脸
  { text: '降下唇肌', orbit: '-8deg 95deg 0.5m', target: '-0.018m 0.145m 0.12m', fov: 15, click: [-14, 18] },
  // 颏肌：颏垫前表面，严禁下巴底
  { text: '颏肌', orbit: '0deg 98deg 0.48m', target: '0.008m 0.125m 0.12m', fov: 15, click: [4, 22] },
  // 笑肌：口角外侧水平一带
  { text: '笑肌', orbit: '-50deg 95deg 0.55m', target: '-0.055m 0.155m 0.08m', fov: 16, click: [-6, 6] },
  // 提口角肌：口角上方偏内
  { text: '提口角肌', orbit: '-28deg 92deg 0.5m', target: '-0.035m 0.185m 0.1m', fov: 16, click: [-20, 8] },
  // 提上唇肌：鼻翼外下、上唇上方
  { text: '提上唇肌', orbit: '-22deg 90deg 0.5m', target: '-0.03m 0.21m 0.11m', fov: 16, click: [-18, 4] },
  // 降鼻中隔肌：鼻柱基底前
  { text: '降鼻中隔肌', orbit: '0deg 95deg 0.45m', target: '0m 0.19m 0.13m', fov: 14, click: [0, 10] },
  // 鼻小压肌：鼻翼旁前表面
  { text: '鼻小压肌', orbit: '8deg 92deg 0.45m', target: '0.01m 0.21m 0.145m', fov: 14, click: [6, 6] },
  // 颧大肌：颧弓外下到口角的斜带中段
  { text: '颧大肌', orbit: '32deg 92deg 0.55m', target: '0.05m 0.185m 0.09m', fov: 16, click: [24, 12] },
  // 颊肌：颊区中部（口角后侧）
  { text: '颊肌', orbit: '55deg 95deg 0.55m', target: '0.055m 0.17m 0.06m', fov: 18, click: [8, 4] },
];

function parseVec(s) {
  return s.replace(/m/g, '').split(/\s+/).map(Number);
}

function fmt(v) {
  return `${v[0].toFixed(4)}m ${v[1].toFixed(4)}m ${v[2].toFixed(4)}m`;
}

/** model-viewer orbit → 目标指向相机的方向（法线应与此同向） */
function orbitCamFromTarget(orbitStr) {
  const m = /(\-?\d+(?:\.\d+)?)deg\s+(\-?\d+(?:\.\d+)?)deg/.exec(orbitStr);
  if (!m) return [0, 0, 1];
  const theta = (Number(m[1]) * Math.PI) / 180;
  const phi = (Number(m[2]) * Math.PI) / 180;
  return [
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta),
  ];
}

function faceCamera(n, orbitStr) {
  const toCam = orbitCamFromTarget(orbitStr);
  const dot = n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2];
  if (dot < 0) return [-n[0], -n[1], -n[2]];
  return n;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  const src = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
  const byText = Object.fromEntries(data.pointsData.map((p) => [p.text, p]));
  const srcBy = Object.fromEntries(src.pointsData.map((p) => [p.text, p]));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', OUT_JSON);
  await page.waitForFunction(
    () => /23/.test((document.getElementById('point-count') || {}).innerText || ''),
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(2800);
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
  });

  const results = [];

  for (const spec of RETOUCH) {
    const p = byText[spec.text];
    if (!p) {
      results.push({ text: spec.text, ok: false, error: 'missing' });
      continue;
    }

    await page.evaluate(
      ({ orbit, target, fov }) => {
        const v = document.querySelector('#workbench-viewer');
        v.setAttribute('camera-target', target);
        v.setAttribute('camera-orbit', orbit);
        v.setAttribute('field-of-view', `${fov}deg`);
      },
      { orbit: spec.orbit, target: spec.target, fov: spec.fov }
    );
    await page.waitForTimeout(800);

    const safe = spec.text.replace(/[^\w\u4e00-\u9fff]+/g, '_');
    await page.screenshot({ path: path.join(outDir, `aim-${safe}.png`), fullPage: true });

    const hit = await page.evaluate(({ dx, dy }) => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      const cx = rect.left + rect.width / 2 + dx;
      const cy = rect.top + rect.height / 2 + dy;
      const tries = [];
      for (let r = 0; r <= 14; r += 2) {
        for (let a = 0; a < 8; a++) {
          const rad = (a * Math.PI) / 4;
          tries.push([Math.round(r * Math.cos(rad)), Math.round(r * Math.sin(rad))]);
        }
      }
      let best = null;
      for (const [ox, oy] of tries) {
        const h = viewer.positionAndNormalFromPoint(cx + ox, cy + oy);
        if (!h) continue;
        // 偏好更靠前（+z）的命中，避免点到底面/内侧
        const score = h.position.z * 3 + h.normal.z * 1.5 - Math.abs(h.normal.y) * 0.3;
        if (!best || score > best.score) {
          best = {
            score,
            pos: [h.position.x, h.position.y, h.position.z],
            norm: [h.normal.x, h.normal.y, h.normal.z],
            screen: { x: cx + ox, y: cy + oy },
          };
        }
      }
      return best;
    }, { dx: spec.click[0], dy: spec.click[1] });

    if (!hit) {
      results.push({ text: spec.text, ok: false, error: 'miss' });
      continue;
    }

    let n = hit.norm;
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / len, n[1] / len, n[2] / len];
    // 聚焦用 atan2(nx,nz)/acos(ny)：法线必须朝向点选时的相机外侧
    n = faceCamera(n, spec.orbit);

    p.pos = fmt(hit.pos);
    p.norm = fmt(n);
    results.push({
      text: spec.text,
      ok: true,
      pos: p.pos,
      norm: p.norm,
      click: spec.click,
      score: hit.score,
    });
  }

  data.timestamp = Date.now();
  fs.writeFileSync(OUT_JSON, JSON.stringify(data, null, 2) + '\n', 'utf8');

  // 重新导入 → 逐点聚焦确认 + 正面总览
  await page.setInputFiles('#file-input', OUT_JSON);
  await page.waitForTimeout(2800);
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.visibility = '';
        el.style.opacity = '0.3';
      }
    });
  });

  for (const spec of RETOUCH) {
    await page.evaluate((text) => {
      const inp = [...document.querySelectorAll('#points-list .point-text-input')].find(
        (el) => el.value === text
      );
      inp?.parentElement.querySelector('.point-name')?.click();
    }, spec.text);
    await page.waitForTimeout(850);
    const safe = spec.text.replace(/[^\w\u4e00-\u9fff]+/g, '_');
    await page.screenshot({ path: path.join(outDir, `ok-${safe}.png`), fullPage: true });
  }

  // 正面高度核对（口周）
  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-orbit', '0deg 90deg 0.7m');
    v.setAttribute('camera-target', '0m 0.18m 0.08m');
    v.setAttribute('field-of-view', '24deg');
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, 'zz-front-mouth.png'), fullPage: true });

  const failed = results.filter((r) => !r.ok);
  const report = {
    ok: failed.length === 0,
    fixed: results.filter((r) => r.ok).length,
    failed,
    outDir: path.relative(repoRoot, outDir),
    results,
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  await browser.close();
  console.log(JSON.stringify({ ok: report.ok, fixed: report.fixed, failed, outDir: report.outDir }, null, 2));
  if (!report.ok) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
