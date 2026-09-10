/**
 * 眉/睑分层：档案内嵌拉近相机 + 屏幕 uv 快拾（避免 y 带粗扫把多点压成同一命中）。
 * 右眼（x<0）；高度序：眉弓/眉 > 睑眉沟 > 睑上沟 > 上眼睑 > 虹膜。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-brow-uv`);

// 与 eye-fast-uv 同一已验证眼区相机（探针：虹膜 v≈0.40 / y≈0.2055）
const BROW_CAM = {
  orbit: '-18deg 88deg 0.30m',
  target: '-0.032m 0.192m 0.068m',
  fov: '16deg',
};

/**
 * u/v 相对 viewer 画布（原点左上）。
 * 探针中线 u=0.48：v0.20→y0.232 / v0.28→y0.222 / v0.34→y0.214 / v0.40→y0.205
 * 鼻侧 u 更大，外眦侧 u 更小。
 */
const PICKS = [
  // 眉脊：以睑眉沟 v0.28/y0.222 为下界，眉毛在其略上
  { text: '眉弓隆起', u: 0.56, v: 0.20, yMin: 0.226, yMax: 0.238 },
  { text: '眉头', u: 0.58, v: 0.25, yMin: 0.222, yMax: 0.232 },
  { text: '眉毛最浓处', u: 0.48, v: 0.25, yMin: 0.220, yMax: 0.230 },
  { text: '眉峰', u: 0.42, v: 0.25, yMin: 0.222, yMax: 0.232 },
  // 沟与睑（睑眉沟已贴眉下缘，保持；上睑略压向睑缘）
  { text: '睑眉沟', u: 0.50, v: 0.28, yMin: 0.216, yMax: 0.226 },
  { text: '睑上沟', u: 0.50, v: 0.33, yMin: 0.210, yMax: 0.220 },
  { text: '上眼睑', u: 0.50, v: 0.36, yMin: 0.207, yMax: 0.214 },
];

const SOLO = ['眉头', '眉峰', '眉弓隆起', '睑眉沟', '睑上沟', '上眼睑'];

function faceCam(n, orbit) {
  const m = /(-?\d+(?:\.\d+)?)deg\s+(-?\d+(?:\.\d+)?)deg/.exec(orbit);
  if (!m) return n;
  const theta = (Number(m[1]) * Math.PI) / 180;
  const phi = (Number(m[2]) * Math.PI) / 180;
  const toCam = [Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta)];
  const dot = n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2];
  if (dot < 0) return [-n[0], -n[1], -n[2]];
  return n;
}

function fmt(v) {
  return `${v.toFixed(4)}m`;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const by = Object.fromEntries(data.pointsData.map((p) => [p.text, p]));
  const irisY = parseFloat(by['虹膜'].pos.split(/\s+/)[1]);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });

  const emptyPath = path.join(outDir, '_empty.json');
  fs.writeFileSync(
    emptyPath,
    JSON.stringify({ ...data, pointsData: [], snapshots: [], timestamp: Date.now(), camera: { ...BROW_CAM } }, null, 2)
  );
  await page.setInputFiles('#file-input', emptyPath);
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && (v.getAttribute('src') || '').includes('石膏');
  }, null, { timeout: 180000 });
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.35);
    });
    if (ok) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const frame = document.getElementById('anno-mobile-frame-overlay');
    if (frame) frame.hidden = true;
  });
  await page.evaluate((c) => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-target', c.target);
    v.setAttribute('camera-orbit', c.orbit);
    v.setAttribute('field-of-view', c.fov);
    try {
      v.cameraTarget = c.target;
      v.cameraOrbit = c.orbit;
      v.fieldOfView = c.fov;
      if (v.jumpCameraToGoal) v.jumpCameraToGoal();
    } catch (_e) {}
  }, BROW_CAM);
  await page.waitForTimeout(450);
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean.png') });

  const hits = await page.evaluate((picks) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const out = [];
    for (const spec of picks) {
      const cx = rect.left + rect.width * spec.u;
      const cy = rect.top + rect.height * spec.v;
      const yMin = spec.yMin != null ? spec.yMin : 0.205;
      const yMax = spec.yMax != null ? spec.yMax : 0.245;
      let best = null;
      for (let rad = 0; rad <= 16; rad += 2) {
        const nAng = rad === 0 ? 1 : 8;
        for (let a = 0; a < nAng; a++) {
          const ang = (a * Math.PI) / 4;
          const ox = rad === 0 ? 0 : Math.round(rad * Math.cos(ang));
          const oy = rad === 0 ? 0 : Math.round(rad * Math.sin(ang));
          const h = viewer.positionAndNormalFromPoint(cx + ox, cy + oy);
          if (!h) continue;
          const p = h.position;
          if (p.x > -0.005 || p.x < -0.075) continue; // 右眼带
          if (p.z < 0.04) continue;
          if (p.y < yMin || p.y > yMax) continue;
          let nx = h.normal.x;
          let ny = h.normal.y;
          let nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          const yMid = (yMin + yMax) * 0.5;
          const score = p.z * 3 + nz * 2 - Math.abs(p.y - yMid) * 8 - rad * 0.03;
          if (!best || score > best.score) {
            best = { score, pos: [p.x, p.y, p.z], norm: [nx, ny, nz], u: spec.u, v: spec.v };
          }
        }
      }
      out.push({ text: spec.text, hit: best });
    }
    return out;
  }, PICKS);

  const report = { irisY, picks: [] };
  for (const row of hits) {
    if (!row.hit) {
      console.log('NOHIT', row.text);
      report.picks.push({ text: row.text, ok: false });
      continue;
    }
    const pt = by[row.text];
    if (!pt) {
      console.log('MISSING_PT', row.text);
      continue;
    }
    const n = faceCam(row.hit.norm, BROW_CAM.orbit);
    const pos = row.hit.pos.map(fmt).join(' ');
    const norm = n.map(fmt).join(' ');
    console.log('FIX', row.text, pt.pos, '->', pos, `uv=${row.hit.u},${row.hit.v}`);
    pt.pos = pos;
    pt.norm = norm;
    report.picks.push({ text: row.text, ok: true, from: pt.pos, to: pos, uv: [row.hit.u, row.hit.v] });
  }

  // 高度序软约束：若睑沟/睑上沟/上睑相对错位，按 y 微调排序提示（不自动改）
  const order = ['眉弓隆起', '眉头', '眉峰', '眉毛最浓处', '睑眉沟', '睑上沟', '上眼睑', '虹膜'];
  const ys = order.map((t) => {
    const p = by[t];
    if (!p) return null;
    return { t, y: parseFloat(p.pos.split(/\s+/)[1]) };
  }).filter(Boolean);
  report.yOrder = ys;
  console.log('Y_ORDER', ys.map((x) => `${x.t}:${x.y.toFixed(4)}`).join(' > '));

  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

  for (const name of SOLO) {
    const pt = by[name];
    if (!pt) continue;
    const tmp = path.join(outDir, `_solo_${name}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({ ...data, pointsData: [{ ...pt, id: 1 }], camera: { ...BROW_CAM }, timestamp: Date.now() }, null, 2)
    );
    await page.evaluate(() => {
      const i = document.getElementById('file-input');
      if (i) i.value = '';
    });
    await page.setInputFiles('#file-input', tmp);
    await page.waitForFunction((e) => {
      const i = document.querySelector('#points-list .point-text-input');
      return i && i.value === e;
    }, name, { timeout: 60000 });
    await page.waitForTimeout(300);
    await page.evaluate((c) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-target', c.target);
      v.setAttribute('camera-orbit', c.orbit);
      v.setAttribute('field-of-view', c.fov);
      try {
        v.cameraTarget = c.target;
        v.cameraOrbit = c.orbit;
        v.fieldOfView = c.fov;
        if (v.jumpCameraToGoal) v.jumpCameraToGoal();
      } catch (_e) {}
    }, BROW_CAM);
    await page.waitForTimeout(280);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `solo_${name}.png`) });
  }

  console.log(JSON.stringify({ ok: true, outDir }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
