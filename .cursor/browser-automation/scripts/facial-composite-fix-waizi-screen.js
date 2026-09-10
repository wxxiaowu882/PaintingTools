/**
 * 诊断：当前外眦落在屏幕哪；再按「外眼角」屏幕 uv 重拾。
 * 不点列表聚焦（避免法线带飞相机）。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-waizi-screen`);

const EYE_CAM = { orbit: '-12deg 90deg auto', target: '-0.034m 0.176m 0.068m', fov: 8 };

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

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });

  // 先空点净图
  const emptyPath = path.join(outDir, '_empty.json');
  fs.writeFileSync(emptyPath, JSON.stringify({ ...data, pointsData: [], snapshots: [], timestamp: Date.now() }, null, 2));
  await page.setInputFiles('#file-input', emptyPath);
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    return v && (v.getAttribute('src') || '').includes('石膏');
  }, null, { timeout: 180000 });
  for (let i = 0; i < 30; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.4);
    });
    if (ok) break;
    await page.waitForTimeout(200);
  }
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
    v.setAttribute('field-of-view', `${c.fov}deg`);
  }, EYE_CAM);
  await page.waitForTimeout(450);
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'clean_eye.png') });

  // 诊断：旧外眦世界坐标对应屏幕 uv
  const old = data.pointsData.find((p) => p.text === '外眦');
  const [ox, oy, oz] = old.pos.replace(/m/g, '').split(/\s+/).map(Number);
  const iris = data.pointsData.find((p) => p.text === '虹膜');
  const [ix, iy, iz] = iris.pos.replace(/m/g, '').split(/\s+/).map(Number);

  const diag = await page.evaluate(({ ox, oy, oz, ix, iy, iz }) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    let oldUv = null;
    let irisUv = null;
    let bestOld = 1e9;
    let bestIris = 1e9;
    const samples = [];
    for (let yy = 0.15; yy <= 0.85; yy += 0.02) {
      for (let xx = 0.15; xx <= 0.85; xx += 0.02) {
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy);
        if (!h) continue;
        const p = h.position;
        const dOld = Math.hypot(p.x - ox, p.y - oy, p.z - oz);
        const dIris = Math.hypot(p.x - ix, p.y - iy, p.z - iz);
        if (dOld < bestOld) {
          bestOld = dOld;
          oldUv = { u: xx, v: yy, d: dOld, pos: [p.x, p.y, p.z] };
        }
        if (dIris < bestIris) {
          bestIris = dIris;
          irisUv = { u: xx, v: yy, d: dIris, pos: [p.x, p.y, p.z] };
        }
        // 收集眼裂候选：与虹膜同高、更靠画面左侧（颞侧）
        if (Math.abs(p.y - iy) < 0.01 && p.x < ix - 0.004 && p.x > ix - 0.03 && p.z > iz - 0.02) {
          samples.push({ u: xx, v: yy, x: p.x, y: p.y, z: p.z, nz: h.normal.z });
        }
      }
    }
    return { oldUv, irisUv, lateralN: samples.length, samples: samples.slice(0, 40) };
  }, { ox, oy, oz, ix, iy, iz });

  fs.writeFileSync(path.join(outDir, 'diag.json'), JSON.stringify(diag, null, 2));
  console.log('DIAG', JSON.stringify(diag.oldUv), JSON.stringify(diag.irisUv));

  // 在虹膜屏幕位置左侧（颞侧）沿睑裂拾外眦
  const pick = await page.evaluate(({ irisUv }) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    if (!irisUv) return null;
    let best = null;
    // 从虹膜 uv 向左扫（减小 u）
    for (let du = 0.02; du <= 0.22; du += 0.012) {
      for (let dv = -0.06; dv <= 0.06; dv += 0.012) {
        const u = irisUv.u - du;
        const v = irisUv.v + dv;
        if (u < 0.05 || u > 0.95 || v < 0.05 || v > 0.95) continue;
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * u, rect.top + rect.height * v);
        if (!h) continue;
        const p = h.position;
        let nx = h.normal.x,
          ny = h.normal.y,
          nz = h.normal.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        // 外眦：略低于/平于虹膜，更负 x，z 不要掉太多
        if (p.x > irisUv.pos[0] - 0.006) continue;
        if (p.y > irisUv.pos[1] + 0.008 || p.y < irisUv.pos[1] - 0.015) continue;
        if (p.z < irisUv.pos[2] - 0.025) continue;
        const score = p.z * 5 + nz * 3 - Math.abs(p.y - irisUv.pos[1]) * 15 - Math.abs(du - 0.1) * 2;
        if (!best || score > best.score) {
          best = {
            score,
            u,
            v,
            pos: [p.x, p.y, p.z],
            norm: [nx, ny, nz],
          };
        }
      }
    }
    return best;
  }, { irisUv: diag.irisUv });

  if (!pick) {
    console.log('NOHIT');
    process.exit(1);
  }

  const n = faceCam(pick.norm, EYE_CAM.orbit);
  const newPos = `${pick.pos[0].toFixed(4)}m ${pick.pos[1].toFixed(4)}m ${pick.pos[2].toFixed(4)}m`;
  const newNorm = `${n[0].toFixed(4)}m ${n[1].toFixed(4)}m ${n[2].toFixed(4)}m`;
  console.log('FIX 外眦', old.pos, '->', newPos, 'uv', pick.u.toFixed(3), pick.v.toFixed(3));
  old.pos = newPos;
  old.norm = newNorm;
  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');

  // 单点验证：不点聚焦
  const soloPath = path.join(outDir, '_solo_waizi.json');
  fs.writeFileSync(
    soloPath,
    JSON.stringify({ ...data, pointsData: [{ ...old, id: 1 }], snapshots: [], timestamp: Date.now() }, null, 2)
  );
  await page.evaluate(() => {
    const input = document.getElementById('file-input');
    if (input) input.value = '';
  });
  await page.setInputFiles('#file-input', soloPath);
  await page.waitForFunction(
    () => {
      const inp = document.querySelector('#points-list .point-text-input');
      return inp && inp.value === '外眦';
    },
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(500);
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
    v.setAttribute('field-of-view', `${c.fov}deg`);
  }, EYE_CAM);
  await page.waitForTimeout(400);
  await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'solo_外眦.png') });

  // 内眦同样从虹膜向右（鼻侧）扫
  const neiziPick = await page.evaluate(({ irisUv }) => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    if (!irisUv) return null;
    let best = null;
    for (let du = 0.02; du <= 0.18; du += 0.012) {
      for (let dv = -0.05; dv <= 0.08; dv += 0.012) {
        const u = irisUv.u + du;
        const v = irisUv.v + dv;
        if (u < 0.05 || u > 0.95) continue;
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * u, rect.top + rect.height * v);
        if (!h) continue;
        const p = h.position;
        if (p.x < irisUv.pos[0] + 0.005 || p.x > irisUv.pos[0] + 0.024) continue;
        if (p.y > irisUv.pos[1] + 0.008 || p.y < irisUv.pos[1] - 0.015) continue;
        if (p.z < irisUv.pos[2] - 0.02) continue;
        let nx = h.normal.x,
          ny = h.normal.y,
          nz = h.normal.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        const score = p.z * 5 + nz * 3 - Math.abs(p.y - (irisUv.pos[1] - 0.002)) * 12;
        if (!best || score > best.score) best = { score, u, v, pos: [p.x, p.y, p.z], norm: [nx, ny, nz] };
      }
    }
    return best;
  }, { irisUv: diag.irisUv });

  // 需要重新加载全量再写内眦——当前页是单点。直接改 JSON。
  if (neiziPick) {
    const full = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const pt = full.pointsData.find((p) => p.text === '内眦');
    const nn = faceCam(neiziPick.norm, EYE_CAM.orbit);
    const np = `${neiziPick.pos[0].toFixed(4)}m ${neiziPick.pos[1].toFixed(4)}m ${neiziPick.pos[2].toFixed(4)}m`;
    console.log('FIX 内眦', pt.pos, '->', np);
    pt.pos = np;
    pt.norm = `${nn[0].toFixed(4)}m ${nn[1].toFixed(4)}m ${nn[2].toFixed(4)}m`;
    full.timestamp = Date.now();
    fs.writeFileSync(jsonPath, JSON.stringify(full, null, 2) + '\n');

    const soloN = path.join(outDir, '_solo_neizi.json');
    fs.writeFileSync(
      soloN,
      JSON.stringify({ ...full, pointsData: [{ ...pt, id: 1 }], snapshots: [], timestamp: Date.now() }, null, 2)
    );
    await page.evaluate(() => {
      const input = document.getElementById('file-input');
      if (input) input.value = '';
    });
    await page.setInputFiles('#file-input', soloN);
    await page.waitForFunction(() => {
      const inp = document.querySelector('#points-list .point-text-input');
      return inp && inp.value === '内眦';
    }, null, { timeout: 120000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.visibility = 'hidden';
      });
    });
    await page.evaluate((c) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-target', c.target);
      v.setAttribute('camera-orbit', c.orbit);
      v.setAttribute('field-of-view', `${c.fov}deg`);
    }, EYE_CAM);
    await page.waitForTimeout(350);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'solo_内眦.png') });
  }

  // 虹膜单点对照
  {
    const full = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const pt = full.pointsData.find((p) => p.text === '虹膜');
    const soloI = path.join(outDir, '_solo_iris.json');
    fs.writeFileSync(
      soloI,
      JSON.stringify({ ...full, pointsData: [{ ...pt, id: 1 }], snapshots: [], timestamp: Date.now() }, null, 2)
    );
    await page.evaluate(() => {
      const input = document.getElementById('file-input');
      if (input) input.value = '';
    });
    await page.setInputFiles('#file-input', soloI);
    await page.waitForFunction(() => {
      const inp = document.querySelector('#points-list .point-text-input');
      return inp && inp.value === '虹膜';
    }, null, { timeout: 120000 });
    await page.waitForTimeout(400);
    await page.evaluate((c) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-target', c.target);
      v.setAttribute('camera-orbit', c.orbit);
      v.setAttribute('field-of-view', `${c.fov}deg`);
    }, EYE_CAM);
    await page.waitForTimeout(350);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, 'solo_虹膜.png') });
  }

  console.log(JSON.stringify({ ok: true, outDir, waizi: newPos, pickUv: { u: pick.u, v: pick.v } }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
