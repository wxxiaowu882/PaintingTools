/**
 * 视觉解剖重贴：以口轮匝肌为锚，按原档案相对偏移估目标点，
 * 浏览器对准后从视口中心射线贴面；关键点聚焦截图确认。
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
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-anatomical-repick-v8`);

const FOCUS_SHOTS = [
  '降口角肌',
  '提上唇肌',
  '口轮匝肌',
  '颧大肌',
  '咬肌',
  '额肌',
  '颞肌',
  '枕肌',
  '降下唇肌',
  '笑肌',
  '颊肌',
];

function parseVec3m(str) {
  return String(str)
    .replace(/m/g, '')
    .trim()
    .split(/\s+/)
    .map(Number);
}

function formatVec3m(v) {
  return `${v[0].toFixed(4)}m ${v[1].toFixed(4)}m ${v[2].toFixed(4)}m`;
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const src = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
  const cur = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));

  const srcMouth = src.pointsData.find((p) => p.text === '口轮匝肌');
  const curMouth = cur.pointsData.find((p) => p.text === '口轮匝肌');
  if (!srcMouth || !curMouth) throw new Error('缺少口轮匝肌锚点');

  const srcMouthPos = parseVec3m(srcMouth.pos);
  const curMouthPos = parseVec3m(curMouth.pos);

  // 估目标：新口轮匝肌 + 原相对偏移（保持解剖布局）
  const targets = cur.pointsData.map((p, i) => {
    const sp = src.pointsData[i];
    const srcPos = parseVec3m(sp.pos);
    const offset = sub(srcPos, srcMouthPos);
    const target = add(curMouthPos, offset);
    const sn = parseVec3m(sp.norm);
    const theta = (Math.atan2(sn[0], sn[2]) * 180) / Math.PI;
    const phi = (Math.acos(Math.min(1, Math.max(-1, sn[1]))) * 180) / Math.PI;
    return {
      id: p.id,
      text: p.text,
      target,
      theta,
      phi,
      srcNorm: sp.norm,
    };
  });

  // 先写一份带目标的临时导入（仍用当前 pos，稍后覆盖）
  const workPath = path.join(outDir, '_import.json');
  fs.writeFileSync(
    workPath,
    JSON.stringify({ ...cur, modelSrc: NEW_MODEL_SRC }, null, 2),
    'utf8'
  );

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

  // 半透明面板，中心射线不被挡
  await page.evaluate(() => {
    const L = document.getElementById('snapshot-panel');
    const R = document.getElementById('console-panel');
    const D = document.getElementById('debug-log-panel');
    if (L) L.style.visibility = 'hidden';
    if (R) R.style.visibility = 'hidden';
    if (D) D.style.visibility = 'hidden';
  });

  await page.screenshot({ path: path.join(outDir, '00-before.png'), fullPage: true });

  const fixes = [];

  for (const t of targets) {
    const hit = await page.evaluate(
      ({ target, theta, phi, srcNormStr }) => {
        const viewer = document.querySelector('#workbench-viewer');
        const srcNorm = srcNormStr.replace(/m/g, '').split(/\s+/).map(Number);
        const posStr = `${target[0].toFixed(4)}m ${target[1].toFixed(4)}m ${target[2].toFixed(4)}m`;

        viewer.setAttribute('camera-target', posStr);
        viewer.setAttribute('camera-orbit', `${theta}deg ${phi}deg 0.55m`);
        viewer.setAttribute('field-of-view', '20deg');

        // 同步等一帧由外层 wait 处理
        return { posStr, srcNorm, theta, phi };
      },
      {
        target: t.target,
        theta: t.theta,
        phi: t.phi,
        srcNormStr: t.srcNorm,
      }
    );

    await page.waitForTimeout(450);

    const picked = await page.evaluate(({ srcNorm }) => {
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
      function norm3(v) {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      }

      // 中心 + 小范围搜索，避免刚好穿空
      const offsets = [[0, 0], [0, -8], [0, 8], [-8, 0], [8, 0], [-6, -6], [6, -6], [-6, 6], [6, 6]];
      let best = null;
      for (const [dx, dy] of offsets) {
        const h = ray(cx + dx, cy + dy);
        if (!h) continue;
        let n = norm3([h.normal.x, h.normal.y, h.normal.z]);
        if (dot(n, srcNorm) < 0) n = [-n[0], -n[1], -n[2]];
        const score = dot(n, srcNorm);
        if (!best || score > best.score) {
          best = {
            score,
            pos: [h.position.x, h.position.y, h.position.z],
            norm: n,
          };
        }
      }
      if (!best) return { ok: false, error: 'center ray miss' };
      return {
        ok: true,
        pos: `${best.pos[0].toFixed(4)}m ${best.pos[1].toFixed(4)}m ${best.pos[2].toFixed(4)}m`,
        norm: `${best.norm[0].toFixed(4)}m ${best.norm[1].toFixed(4)}m ${best.norm[2].toFixed(4)}m`,
        score: best.score,
      };
    }, { srcNorm: parseVec3m(t.srcNorm) });

    if (!picked.ok) {
      fixes.push({ id: t.id, text: t.text, ok: false, error: picked.error });
      continue;
    }

    // 更新 DOM hotspot，便于后续截图看到新位置
    await page.evaluate(
      ({ id, pos, norm }) => {
        const viewer = document.querySelector('#workbench-viewer');
        const nameEl = [...document.querySelectorAll('#points-list .point-name')].find(
          (el) => parseInt(el.getAttribute('data-id'), 10) === id
        );
        let hs = viewer.querySelector(`[slot="hotspot-${id}"]`);
        if (!hs && nameEl) {
          const text = (nameEl.parentElement.querySelector('.point-text-input') || {}).value;
          hs = [...viewer.querySelectorAll('.preview-hotspot')].find((el) => {
            const a = el.querySelector('.HotspotAnnotation');
            return a && a.innerText === text;
          });
        }
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
      score: picked.score,
      target: t.target,
    });
  }

  // 写回 JSON
  const byId = Object.fromEntries(fixes.filter((f) => f.ok).map((f) => [f.id, f]));
  const out = {
    ...cur,
    timestamp: Date.now(),
    modelSrc: NEW_MODEL_SRC,
    pointsData: cur.pointsData.map((p) => {
      const f = byId[p.id];
      if (!f) return p;
      return { ...p, pos: f.pos, norm: f.norm };
    }),
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + '\n', 'utf8');

  // 重新导入并做视觉确认
  await page.evaluate(() => {
    const L = document.getElementById('snapshot-panel');
    const R = document.getElementById('console-panel');
    const D = document.getElementById('debug-log-panel');
    if (L) L.style.visibility = '';
    if (R) R.style.visibility = '';
    if (D) D.style.visibility = '';
  });

  await page.setInputFiles('#file-input', OUT_JSON);
  await page.waitForTimeout(2800);

  await page.evaluate(() => {
    const L = document.getElementById('snapshot-panel');
    const R = document.getElementById('console-panel');
    if (L) L.style.opacity = '0.4';
    if (R) R.style.opacity = '0.4';
  });

  for (const name of FOCUS_SHOTS) {
    const ok = await page.evaluate((text) => {
      const inp = [...document.querySelectorAll('#points-list .point-text-input')].find(
        (el) => el.value === text
      );
      if (!inp) return false;
      const nameEl = inp.parentElement.querySelector('.point-name');
      if (!nameEl) return false;
      nameEl.click();
      return true;
    }, name);
    await page.waitForTimeout(850);
    const safe = name.replace(/[^\w\u4e00-\u9fff]+/g, '_');
    await page.screenshot({
      path: path.join(outDir, `confirm-${safe}.png`),
      fullPage: true,
    });
    if (!ok) console.warn('未点到', name);
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
    outJson: path.relative(repoRoot, OUT_JSON),
    outDir: path.relative(repoRoot, outDir),
    points: fixes,
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  await browser.close();
  console.log(JSON.stringify({ ok: report.ok, fixed: report.fixed, failed, outDir: report.outDir }, null, 2));
  if (!report.ok) process.exitCode = 1;
  else console.log('PASS anatomical-repick-v8');
})().catch((e) => {
  console.error('FAIL', e);
  process.exitCode = 1;
});
