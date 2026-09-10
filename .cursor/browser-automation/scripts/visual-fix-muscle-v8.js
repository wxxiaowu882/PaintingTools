/**
 * 浏览器视觉修正：黄种人女 V8 肌肉标注
 * - 用原档案法线对准「正确观看侧」
 * - 经 model-viewer 对热点屏幕位置重拾射线 → 写回 pos/norm
 * - 关键点位截图供 AI 视觉抽检
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
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-visual-fix-v8`);

const FOCUS_SHOTS = ['额肌', '颞肌', '口轮匝肌', '咬肌', '枕肌', '颧大肌', '降眉间肌'];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parseVec3m(str) {
  return String(str)
    .replace(/m/g, '')
    .trim()
    .split(/\s+/)
    .map(Number);
}

function formatVec3m(v) {
  return `${Number(v[0]).toFixed(4)}m ${Number(v[1]).toFixed(4)}m ${Number(v[2]).toFixed(4)}m`;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const src = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
  const cur = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  assert(src.pointsData.length === 23 && cur.pointsData.length === 23, '点数应为 23');

  // 工作副本：保留 V8 modelSrc，先用当前 pos，法线稍后重拾
  const work = {
    ...cur,
    modelSrc: NEW_MODEL_SRC,
    pointsData: cur.pointsData.map((p, i) => ({
      ...p,
      // 临时用法线来自原档案，便于首次对准正确观看侧
      norm: src.pointsData[i].norm,
      _srcNorm: src.pointsData[i].norm,
      _srcPos: src.pointsData[i].pos,
    })),
  };
  const workPath = path.join(outDir, '_work-import.json');
  fs.writeFileSync(
    workPath,
    JSON.stringify(
      {
        ...work,
        pointsData: work.pointsData.map(({ _srcNorm, _srcPos, ...rest }) => rest),
      },
      null,
      2
    ),
    'utf8'
  );

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageUrl = `${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`;
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#workbench-viewer', { timeout: 20000 });
  await page.waitForSelector('#file-input', { state: 'attached', timeout: 10000 });
  await page.setInputFiles('#file-input', workPath);

  await page.waitForFunction(
    () => {
      const v = document.querySelector('#workbench-viewer');
      const srcAttr = (v && v.getAttribute('src')) || '';
      const countText = (document.getElementById('point-count') || {}).innerText || '';
      return srcAttr.includes('黄种人_女_V8') && /23/.test(countText);
    },
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(3000);

  await page.screenshot({ path: path.join(outDir, '00-loaded.png'), fullPage: true });

  const srcById = Object.fromEntries(src.pointsData.map((p) => [p.id, p]));

  const fixReport = [];

  for (const p of work.pointsData) {
    const srcP = srcById[p.id];
    const [snx, sny, snz] = parseVec3m(srcP.norm);
    const theta = (Math.atan2(snx, snz) * 180) / Math.PI;
    const phi = (Math.acos(Math.min(1, Math.max(-1, sny))) * 180) / Math.PI;

    // 1) 用原法线对准观看侧，目标对准当前点
    await page.evaluate(
      ({ pos, theta, phi }) => {
        const viewer = document.querySelector('#workbench-viewer');
        viewer.setAttribute('camera-target', pos);
        viewer.setAttribute('camera-orbit', `${theta}deg ${phi}deg auto`);
        viewer.setAttribute('field-of-view', '25deg');
      },
      { pos: p.pos, theta, phi }
    );
    await page.waitForTimeout(700);

    // 2) 在热点屏幕位置重拾；若法线与原法线反向则翻转/外侧再拾
    const hit = await page.evaluate(
      ({ id, srcNormStr, theta, phi }) => {
        const viewer = document.querySelector('#workbench-viewer');
        const srcNorm = srcNormStr.replace(/m/g, '').split(/\s+/).map(Number);

        // Inline script vars live in classic script scope — not on window.
        // Recover by reading current hotspot attributes and list.
        const nameEl = [...document.querySelectorAll('#points-list .point-name')].find(
          (el) => parseInt(el.getAttribute('data-id'), 10) === id
        );
        if (!nameEl) return { ok: false, error: 'list item missing' };
        const slotGuess = `hotspot-${id}`;
        let hs = viewer.querySelector(`[slot="${slotGuess}"]`);
        if (!hs) {
          // try any hotspot — match by annotation text
          const text = (nameEl.parentElement.querySelector('.point-text-input') || {}).value;
          hs = [...viewer.querySelectorAll('.preview-hotspot')].find((el) => {
            const t = el.querySelector('.HotspotAnnotation');
            return t && t.innerText === text;
          });
        }
        if (!hs) return { ok: false, error: 'hotspot missing' };

        function rayAt(cx, cy) {
          return viewer.positionAndNormalFromPoint(cx, cy);
        }

        function fmt(v) {
          return `${v.x.toFixed(4)}m ${v.y.toFixed(4)}m ${v.z.toFixed(4)}m`;
        }
        function fmtN(v) {
          const len = Math.hypot(v.x, v.y, v.z) || 1;
          return `${(v.x / len).toFixed(4)}m ${(v.y / len).toFixed(4)}m ${(v.z / len).toFixed(4)}m`;
        }
        function dot3(a, b) {
          return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        }

        // Ensure camera on correct side using src normal
        const posAttr = hs.getAttribute('data-position') || nameEl.getAttribute('data-pos');
        viewer.setAttribute('camera-target', posAttr);
        viewer.setAttribute('camera-orbit', `${theta}deg ${phi}deg auto`);

        const rect = hs.getBoundingClientRect();
        let cx = rect.left + rect.width / 2;
        let cy = rect.top + rect.height / 2;

        let hit = rayAt(cx, cy);
        // 热点可能被面板挡住：向视口中心方向试探
        if (!hit) {
          const vw = viewer.getBoundingClientRect();
          const midX = vw.left + vw.width / 2;
          const midY = vw.top + vw.height / 2;
          for (let t = 0.1; t <= 0.9 && !hit; t += 0.1) {
            hit = rayAt(cx + (midX - cx) * t, cy + (midY - cy) * t);
          }
        }
        if (!hit) return { ok: false, error: 'ray miss', cx, cy };

        let n = [hit.normal.x, hit.normal.y, hit.normal.z];
        const nlen = Math.hypot(n[0], n[1], n[2]) || 1;
        n = [n[0] / nlen, n[1] / nlen, n[2] / nlen];
        // 若与原法线反向，翻转（双面网格内侧）
        if (dot3(n, srcNorm) < 0) {
          n = [-n[0], -n[1], -n[2]];
          // 再沿原法线外侧微偏屏幕重拾，尽量落到外表面
          const pull = 12;
          const hx = cx + srcNorm[0] * pull;
          const hy = cy - srcNorm[1] * pull; // screen y down
          const hit2 = rayAt(hx, hy);
          if (hit2) {
            hit = hit2;
            n = [hit.normal.x, hit.normal.y, hit.normal.z];
            const l2 = Math.hypot(n[0], n[1], n[2]) || 1;
            n = [n[0] / l2, n[1] / l2, n[2] / l2];
            if (dot3(n, srcNorm) < 0) n = [-n[0], -n[1], -n[2]];
          }
        }

        const newPos = fmt(hit.position);
        const newNorm = `${n[0].toFixed(4)}m ${n[1].toFixed(4)}m ${n[2].toFixed(4)}m`;

        // 写回 DOM hotspot
        hs.setAttribute('data-position', newPos);
        hs.setAttribute('data-normal', newNorm);
        nameEl.setAttribute('data-pos', newPos);
        nameEl.setAttribute('data-norm', newNorm);

        return {
          ok: true,
          newPos,
          newNorm,
          dotSrc: dot3(n, srcNorm),
          screen: { cx, cy },
        };
      },
      { id: p.id, srcNormStr: srcP.norm, theta, phi }
    );

    if (!hit.ok) {
      fixReport.push({ id: p.id, text: p.text, ok: false, error: hit.error || hit });
      continue;
    }

    // 同步到页面内存中的 pointsData：通过改 codeOutput / 触发已有机制较难；
    // 直接注入：把 generateCode 结果解析不现实。改用暴露钩子——
    // 在页面执行：遍历可能的全局。
    const synced = await page.evaluate(
      ({ id, newPos, newNorm }) => {
        // 经典 script 的 pointsData 不在 window。用 DOM 列表 + 导出文本框旁路：
        // 找到并 monkey-patch：重写所有 hotspot 后，调用页面内 generateCode 需要 pointsData。
        // 尝试从 Function constructor 拿不到。
        // 方案：把修正写入 window.__fixedPoints 累积，最后一次性组装 JSON。
        window.__fixedPoints = window.__fixedPoints || {};
        window.__fixedPoints[id] = { pos: newPos, norm: newNorm };
        return true;
      },
      { id: p.id, newPos: hit.newPos, newNorm: hit.newNorm }
    );

    p.pos = hit.newPos;
    p.norm = hit.newNorm;
    fixReport.push({
      id: p.id,
      text: p.text,
      ok: true,
      newPos: hit.newPos,
      newNorm: hit.newNorm,
      dotSrc: hit.dotSrc,
    });

    // 用新法线再聚焦一次
    await page.evaluate(
      ({ pos, norm }) => {
        const viewer = document.querySelector('#workbench-viewer');
        const [nx, ny, nz] = norm.replace(/m/g, '').split(/\s+/).map(Number);
        viewer.setAttribute('camera-target', pos);
        viewer.setAttribute(
          'camera-orbit',
          `${(Math.atan2(nx, nz) * 180) / Math.PI}deg ${(Math.acos(Math.min(1, Math.max(-1, ny))) * 180) / Math.PI}deg auto`
        );
      },
      { pos: hit.newPos, norm: hit.newNorm }
    );
    await page.waitForTimeout(500);

    if (FOCUS_SHOTS.includes(p.text)) {
      const safe = p.text.replace(/[^\w\u4e00-\u9fff]+/g, '_');
      await page.screenshot({
        path: path.join(outDir, `focus-${String(p.id).padStart(2, '0')}-${safe}.png`),
        fullPage: true,
      });
    }
  }

  // 写回最终 JSON
  const out = {
    ...cur,
    timestamp: Date.now(),
    modelSrc: NEW_MODEL_SRC,
    pointsData: cur.pointsData.map((p) => {
      const fixed = fixReport.find((f) => f.id === p.id && f.ok);
      if (!fixed) return p;
      return { ...p, pos: fixed.newPos, norm: fixed.newNorm };
    }),
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + '\n', 'utf8');

  // 再导入验证 + 口轮匝肌聚焦截图
  await page.setInputFiles('#file-input', OUT_JSON);
  await page.waitForTimeout(2500);

  const mouth = out.pointsData.find((p) => p.text === '口轮匝肌');
  if (mouth) {
    await page.evaluate(
      ({ pos, norm }) => {
        const viewer = document.querySelector('#workbench-viewer');
        const [nx, ny, nz] = norm.replace(/m/g, '').split(/\s+/).map(Number);
        viewer.setAttribute('camera-target', pos);
        viewer.setAttribute(
          'camera-orbit',
          `${(Math.atan2(nx, nz) * 180) / Math.PI}deg ${(Math.acos(Math.min(1, Math.max(-1, ny))) * 180) / Math.PI}deg auto`
        );
        viewer.setAttribute('field-of-view', '22deg');
      },
      { pos: mouth.pos, norm: mouth.norm }
    );
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, 'verify-口轮匝肌.png'), fullPage: true });
  }

  await page.evaluate(() => {
    const viewer = document.querySelector('#workbench-viewer');
    viewer.setAttribute('camera-orbit', '0deg 90deg auto');
    viewer.setAttribute('camera-target', '0m 0.22m 0.05m');
    viewer.setAttribute('field-of-view', '28deg');
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'verify-front.png'), fullPage: true });

  const failed = fixReport.filter((f) => !f.ok);
  const flippedFixed = fixReport.filter((f) => f.ok && f.dotSrc > 0).length;

  const report = {
    ok: failed.length === 0,
    outJson: path.relative(repoRoot, OUT_JSON),
    fixed: fixReport.filter((f) => f.ok).length,
    failed,
    agreeWithSrcNormal: flippedFixed,
    outDir: path.relative(repoRoot, outDir),
    points: fixReport,
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
    throw new Error('部分点位重拾失败');
  }
  console.log('PASS visual-fix-muscle-v8');
})().catch((e) => {
  console.error('FAIL', e);
  process.exitCode = 1;
});
