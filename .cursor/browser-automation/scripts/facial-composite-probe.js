/**
 * 用空点档案拍净图 + 几何探针找鼻尖/右眼球锚点，写 probe.json
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const srcJson = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-composite-probe`);
const tmpJson = path.join(outDir, '_empty.json');

const VIEWS = [
  { name: 'eye_r', orbit: '-22deg 88deg auto', target: '-0.032m 0.162m 0.068m', fov: 9 },
  { name: 'eye_r_tight', orbit: '-18deg 90deg auto', target: '-0.030m 0.160m 0.070m', fov: 7 },
  { name: 'brow_r', orbit: '-18deg 75deg auto', target: '-0.030m 0.185m 0.068m', fov: 10 },
  { name: 'nose', orbit: '0deg 95deg auto', target: '0m 0.155m 0.08m', fov: 12 },
  { name: 'nose_up', orbit: '0deg 128deg auto', target: '0m 0.142m 0.07m', fov: 11 },
  { name: 'mouth', orbit: '0deg 100deg auto', target: '0m 0.130m 0.075m', fov: 10 },
  { name: 'ear_r', orbit: '90deg 90deg auto', target: '0.062m 0.160m 0.01m', fov: 14 },
  { name: 'front', orbit: '0deg 90deg auto', target: '0m 0.155m 0.05m', fov: 22 },
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const src = JSON.parse(fs.readFileSync(srcJson, 'utf8'));
  const empty = { ...src, pointsData: [], snapshots: [], timestamp: Date.now() };
  fs.writeFileSync(tmpJson, JSON.stringify(empty, null, 2));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', tmpJson);
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
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const frame = document.getElementById('anno-mobile-frame-overlay');
    if (frame) frame.hidden = true;
  });

  for (const v of VIEWS) {
    await page.evaluate(({ orbit, target, fov }) => {
      const viewer = document.querySelector('#workbench-viewer');
      viewer.setAttribute('camera-target', target);
      viewer.setAttribute('camera-orbit', orbit);
      viewer.setAttribute('field-of-view', `${fov}deg`);
    }, v);
    await page.waitForTimeout(400);
    await page.locator('#workbench-viewer').screenshot({ path: path.join(outDir, `clean_${v.name}.png`) });
    console.log('SHOT', v.name);
  }

  // geometry probe: front view dense scan
  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-orbit', '0deg 90deg auto');
    v.setAttribute('camera-target', '0m 0.155m 0.05m');
    v.setAttribute('field-of-view', '28deg');
  });
  await page.waitForTimeout(500);

  const probe = await page.evaluate(() => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    const hits = [];
    for (let yy = 0.15; yy <= 0.75; yy += 0.012) {
      for (let xx = 0.25; xx <= 0.75; xx += 0.012) {
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy);
        if (!h) continue;
        hits.push({
          sx: xx,
          sy: yy,
          x: h.position.x,
          y: h.position.y,
          z: h.position.z,
          nx: h.normal.x,
          ny: h.normal.y,
          nz: h.normal.z,
        });
      }
    }
    // nose tip: max z near midline
    let noseTip = null;
    for (const h of hits) {
      if (Math.abs(h.x) > 0.015) continue;
      if (h.y < 0.13 || h.y > 0.18) continue;
      if (!noseTip || h.z > noseTip.z) noseTip = h;
    }
    // right eye ball: max z in x<-0.015, y mid face
    let eyeR = null;
    for (const h of hits) {
      if (h.x > -0.015 || h.x < -0.055) continue;
      if (h.y < 0.145 || h.y > 0.185) continue;
      if (!eyeR || h.z > eyeR.z) eyeR = h;
    }
    // left eye for reference
    let eyeL = null;
    for (const h of hits) {
      if (h.x < 0.015 || h.x > 0.055) continue;
      if (h.y < 0.145 || h.y > 0.185) continue;
      if (!eyeL || h.z > eyeL.z) eyeL = h;
    }
    // mouth center: max z near midline lower
    let mouthFront = null;
    for (const h of hits) {
      if (Math.abs(h.x) > 0.02) continue;
      if (h.y < 0.115 || h.y > 0.145) continue;
      if (!mouthFront || h.z > mouthFront.z) mouthFront = h;
    }
    // nasal root: midline high
    let nasion = null;
    for (const h of hits) {
      if (Math.abs(h.x) > 0.012) continue;
      if (h.y < 0.185 || h.y > 0.215) continue;
      if (!nasion || h.z > nasion.z) nasion = h;
    }
    // ear R: large +x
    let earR = null;
    for (const h of hits) {
      if (h.x < 0.05) continue;
      if (h.y < 0.13 || h.y > 0.19) continue;
      if (!earR || h.x > earR.x) earR = h;
    }
    const fmt = (h) =>
      h
        ? {
            pos: `${h.x.toFixed(4)}m ${h.y.toFixed(4)}m ${h.z.toFixed(4)}m`,
            screen: { u: +h.sx.toFixed(3), v: +h.sy.toFixed(3) },
            xyz: { x: h.x, y: h.y, z: h.z },
          }
        : null;
    return {
      nHits: hits.length,
      noseTip: fmt(noseTip),
      eyeR: fmt(eyeR),
      eyeL: fmt(eyeL),
      mouthFront: fmt(mouthFront),
      nasion: fmt(nasion),
      earR: fmt(earR),
    };
  });

  // tighter eye probe from eye camera
  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-orbit', '-20deg 88deg auto');
    v.setAttribute('camera-target', '-0.030m 0.160m 0.070m');
    v.setAttribute('field-of-view', '8deg');
  });
  await page.waitForTimeout(450);
  const eyeProbe = await page.evaluate(() => {
    const viewer = document.querySelector('#workbench-viewer');
    const rect = viewer.getBoundingClientRect();
    let best = null;
    const samples = [];
    for (let yy = 0.25; yy <= 0.75; yy += 0.02) {
      for (let xx = 0.25; xx <= 0.75; xx += 0.02) {
        const h = viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy);
        if (!h) continue;
        const p = h.position;
        if (p.x > -0.01 || p.x < -0.06) continue;
        if (p.y < 0.14 || p.y > 0.19) continue;
        samples.push({ u: xx, v: yy, x: p.x, y: p.y, z: p.z, nz: h.normal.z });
        const score = p.z * 5 + h.normal.z * 2;
        if (!best || score > best.score) {
          best = {
            score,
            pos: `${p.x.toFixed(4)}m ${p.y.toFixed(4)}m ${p.z.toFixed(4)}m`,
            u: xx,
            v: yy,
            xyz: { x: p.x, y: p.y, z: p.z },
          };
        }
      }
    }
    // find medial/lateral extremes at eye y band (canthi candidates)
    const band = samples.filter((s) => Math.abs(s.y - (best ? best.xyz.y : 0.16)) < 0.008 && s.z > (best ? best.xyz.z - 0.012 : 0.05));
    let medial = null; // closer to 0
    let lateral = null; // more negative
    for (const s of band) {
      if (!medial || s.x > medial.x) medial = s;
      if (!lateral || s.x < lateral.x) lateral = s;
    }
    return {
      corneaPeak: best,
      medialCanthusCand: medial && {
        pos: `${medial.x.toFixed(4)}m ${medial.y.toFixed(4)}m ${medial.z.toFixed(4)}m`,
        u: medial.u,
        v: medial.v,
      },
      lateralCanthusCand: lateral && {
        pos: `${lateral.x.toFixed(4)}m ${lateral.y.toFixed(4)}m ${lateral.z.toFixed(4)}m`,
        u: lateral.u,
        v: lateral.v,
      },
      bandN: band.length,
    };
  });

  const report = { ...probe, eyeTight: eyeProbe };
  fs.writeFileSync(path.join(outDir, 'probe.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
