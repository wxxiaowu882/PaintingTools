/**
 * 206 / L06：正顶光 · 顶纵交界
 *
 * 知识库（贰·大面交界）：
 * - 光源在正上方时，「光照边际」=「顶面与纵面」转换处
 * - 顶纵三点：额结节、颅侧结节、枕后突隆（定高、定宽、定后界）
 * - 侧面观：枕后突隆最低，颅侧结节略高于额结节
 *
 * 经验（对齐 205）：
 * - 本关研究交界线本身，不写「柔亮少影」类观感命名
 * - 大半侧取景，便于看见顶纵交界脊；锁光可转视角
 * - 验收以 AI 读图为准（点须在可见顶纵交界缘，勿沉进大暗顶面或漂到脸侧剪影）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const sharp = require('sharp');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-206`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

const MODEL = '/docs/model/石膏头像_男中青年_大本 蝙蝠侠 布鲁斯韦恩_头像_opt.glb';

function load206() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('206_') && n.endsWith('.json'));
  if (!f) throw new Error('missing 206');
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}

function rebuildAggregate() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+[A-Za-z]?_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  fs.writeFileSync(
    path.join(jsonDir, '沙盒_头部造型规律.json'),
    JSON.stringify(files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')))) + '\n'
  );
  return files.length;
}

function plainToRich(text) {
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (/^【/.test(t) || /^[①②③④⑤⑥⑦⑧⑨]+\./.test(t) || /^\d+\./.test(t)) {
        return '<strong>' + line + '</strong>';
      }
      return line;
    })
    .join('<br>');
}

function bezSeg(id, a, b) {
  if (!a || !b) return null;
  return {
    id,
    color: '#9a9a9a',
    kind: 'bezier',
    strokeWidth: 2.2,
    capR: 1,
    opacity: 0.78,
    points: [
      {
        pos: [...a.localPos],
        norm: [...a.localNormal],
        handleOut: [
          (b.localPos[0] - a.localPos[0]) * 0.22,
          (b.localPos[1] - a.localPos[1]) * 0.2,
          (b.localPos[2] - a.localPos[2]) * 0.22
        ]
      },
      {
        pos: [...b.localPos],
        norm: [...b.localNormal],
        handleIn: [
          (a.localPos[0] - b.localPos[0]) * 0.22,
          (a.localPos[1] - b.localPos[1]) * 0.2,
          (a.localPos[2] - b.localPos[2]) * 0.22
        ]
      }
    ]
  };
}

function seed206(data) {
  data.id = 'L06';
  data.name = '【光位】正顶光 · 顶纵交界';
  // 左侧大半侧：能看见额—颅侧—枕后这条顶纵交界脊
  data.camera = {
    pos: [-4.35, 1.05, 3.65],
    target: [0.0, 0.95, -0.02],
    zoom: 0.56,
    fov: 15
  };
  // 正顶光：elevation 高；面积中等，交界可读
  data.light = {
    type: 'point',
    azimuth: 90,
    elevation: 86,
    distance: 16,
    temp: 34,
    size: 12,
    intensity: 2.15
  };
  data.env = {
    ...(data.env || {}),
    hasWall: false,
    defaultMat: 'origin',
    groundColor: '#bdb8b0',
    skyColor: '#0d0d0f',
    skyLightScale: 0.42,
    lightIndicatorEnabled: false,
    noInterModelShadow: false
  };
  data.crop = {
    display: 'block',
    left: '420px',
    top: '70px',
    width: '760px',
    height: '760px'
  };
  data.items = [
    {
      type: 'glb',
      url: MODEL,
      pos: [0, 0, 0],
      rot: [0, 0, 0],
      scale: [5.8, 5.8, 5.8],
      mat: 'origin',
      annotations: [],
      dashedLines: []
    }
  ];
  data.meta = {
    line: 'light',
    slot: 'L06',
    status: 'seeded',
    detail: '正顶光：顶面与纵面转换的明暗交界。大半侧取景，钉额结节—颅侧结节—枕后突隆。',
    keyPoints: '【打底中】'
  };
  return data;
}

function lumAt(data, W, x, y) {
  const i = (y * W + x) * 3;
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

/** 顶光：头体上半，暗（顶）→亮（侧面）的半影缘；本取景头朝右时偏上缘 */
function findTopEdgeY(data, W, H, x, preferY) {
  const y0 = Math.max(4, Math.floor(H * 0.06));
  const y1 = Math.min(H - 5, Math.floor(H * 0.55));
  let headYs = [];
  for (let y = y0; y <= y1; y++) {
    if (lumAt(data, W, x, y) > 28) headYs.push(y);
  }
  if (headYs.length < 8) return preferY != null ? preferY : Math.round(H * 0.22);
  const top = headYs[0];
  const bot = headYs[headYs.length - 1];
  // 在头体上段找亮→暗（上暗下亮：顶面暗、侧面亮）或暗→亮的最大梯度
  let bestY = preferY != null ? preferY : top + 8;
  let bestScore = -1e9;
  const step = 3;
  for (let y = top + 4; y <= Math.min(bot - 4, top + Math.floor((bot - top) * 0.55)); y++) {
    const L = lumAt(data, W, x, y);
    const Lup = lumAt(data, W, x, y - step);
    const Ldn = lumAt(data, W, x, y + step);
    // 上更暗、下更亮 → 顶纵交界常见
    const grad = Ldn - Lup;
    if (grad < 1.5) continue;
    let score = grad * 2.2;
    if (preferY != null) score -= Math.abs(y - preferY) * 0.08;
    if (score > bestScore) {
      bestScore = score;
      bestY = y;
    }
  }
  if (bestScore < 0) bestY = top + 10;
  return Math.max(top + 2, Math.min(bot - 2, bestY));
}

async function scrubUI(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    const hide = (el) => {
      if (!el) return;
      el.style.display = 'none';
      el.style.opacity = '0';
    };
    hide(document.getElementById('scene-loader'));
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const t = (el.textContent || '').trim();
      if (/^(正在计算光影|首帧渲染中|光影探针|已进入写生)/.test(t) && t.length < 50) hide(el);
    });
  });
}

async function boot(page) {
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    window.isTestingPerformance = false;
    if ((!window.customScenes || !window.customScenes.length) && window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(
    () => (window.customScenes || []).length > 0 && window.__solidHost && window.__solidHost.getCamera(),
    null,
    { timeout: 90000 }
  );
}

async function openL06(page) {
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'L06');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && String(s.name || '').includes('顶纵'));
    if (i < 0) throw new Error('L06 not found');
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  for (let i = 0; i < 80; i++) {
    const n = await page.evaluate(() => {
      let c = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) c++;
        });
      } catch (_e) {}
      return c;
    });
    if (n > 0) break;
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
  await page.waitForTimeout(1800);
}

/** 解剖锚：在网格上搜额结节 / 颅侧结节 / 枕后突隆 */
async function pickAnatomy(page) {
  return page.evaluate(() => {
    const host = window.__solidHost;
    const THREE = host.getTHREE();
    const g = host.getSceneGroup();
    let root = null;
    g.traverse((o) => {
      if (!root && o.userData && o.userData.type === 'glb') root = o;
    });
    if (!root) root = g.children[0];
    const meshes = [];
    root.traverse((o) => {
      if (o.isMesh && o.geometry) meshes.push(o);
    });

    const samples = [];
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (const mesh of meshes) {
      const geo = mesh.geometry;
      if (!geo.attributes || !geo.attributes.position) continue;
      const pos = geo.attributes.position;
      const nor = geo.attributes.normal;
      const idx = geo.index;
      const count = idx ? idx.count : pos.count;
      const step = Math.max(1, Math.floor(count / 12000));
      for (let i = 0; i < count; i += step) {
        const vi = idx ? idx.getX(i) : i;
        v.fromBufferAttribute(pos, vi);
        mesh.localToWorld(v);
        root.worldToLocal(v);
        if (nor) {
          n.fromBufferAttribute(nor, vi);
          n.transformDirection(mesh.matrixWorld);
          const q = new THREE.Quaternion();
          root.getWorldQuaternion(q);
          n.applyQuaternion(q.clone().invert());
        } else {
          n.set(-1, 0.2, 0);
        }
        // 只要头颅上半、偏 -x 侧（与大半侧取景同侧）
        if (v.y < 0.14 || v.y > 0.34) continue;
        if (v.x > 0.02) continue;
        samples.push({
          x: v.x,
          y: v.y,
          z: v.z,
          nx: n.x,
          ny: n.y,
          nz: n.z
        });
      }
    }

    function best(fn) {
      let b = null;
      let bs = -1e9;
      for (const s of samples) {
        const sc = fn(s);
        if (sc > bs) {
          bs = sc;
          b = s;
        }
      }
      return b;
    }

    // ① 额结节：前额高点偏前（+z），略侧
    const p1 = best((s) => s.z * 3.2 + s.y * 1.5 - Math.abs(s.x + 0.03) * 0.8 + (s.z > 0.02 ? 1 : 0));
    // ② 颅侧结节：最宽（-|x|），中后
    const p2 = best((s) => -s.x * 4.5 + s.y * 0.8 - Math.abs(s.z + 0.04) * 0.6);
    // ③ 枕后突隆：最后（-z），高度低于颅侧
    const p3 = best((s) => -s.z * 4.2 + s.y * 0.5 - Math.abs(s.x + 0.05) * 0.5 + (s.y < 0.24 ? 0.8 : 0));

    function toHit(s) {
      if (!s) return null;
      const len = Math.hypot(s.nx, s.ny, s.nz) || 1;
      return {
        localPos: [+s.x.toFixed(4), +s.y.toFixed(4), +s.z.toFixed(4)],
        localNormal: [+(s.nx / len).toFixed(3), +(s.ny / len).toFixed(3), +(s.nz / len).toFixed(3)]
      };
    }

    return {
      ok: !!(p1 && p2 && p3),
      sampleCount: samples.length,
      anchors: [
        { id: '1', name: '额结节', ...toHit(p1) },
        { id: '2', name: '颅侧结节', ...toHit(p2) },
        { id: '3', name: '枕后突隆', ...toHit(p3) }
      ]
    };
  });
}

async function projectAndNudge(page, anchors, crop, raw, W, H) {
  const projected = await page.evaluate((anchors) => {
    const host = window.__solidHost;
    const THREE = host.getTHREE();
    const cam = host.getCamera();
    const g = host.getSceneGroup();
    let root = null;
    g.traverse((o) => {
      if (!root && o.userData && o.userData.type === 'glb') root = o;
    });
    if (!root) root = g.children[0];
    const canvas =
      document.querySelector('canvas') ||
      (host.getRenderer && host.getRenderer().domElement);
    const rect = canvas.getBoundingClientRect();
    return anchors.map((a) => {
      const world = root.localToWorld(new THREE.Vector3(...a.localPos));
      const ndc = world.clone().project(cam);
      const u = (ndc.x + 1) / 2;
      const v = (1 - ndc.y) / 2;
      return {
        id: a.id,
        name: a.name,
        u,
        v,
        pageX: rect.left + u * rect.width,
        pageY: rect.top + v * rect.height,
        localPos: a.localPos,
        localNormal: a.localNormal
      };
    });
  }, anchors);

  const nudged = [];
  for (const p of projected) {
    let px = Math.round(((p.pageX - crop.x) / crop.width) * W);
    let py = Math.round(((p.pageY - crop.y) / crop.height) * H);
    px = Math.max(8, Math.min(W - 9, px));
    py = Math.max(8, Math.min(H - 9, py));
    const edgeY = findTopEdgeY(raw, W, H, px, py);
    // 与解剖投影折中，保住三点身份
    const yMix = Math.round(py * 0.45 + edgeY * 0.55);
    const pageX = crop.x + px + 0.5;
    const pageY = crop.y + yMix + 0.5;
    const u = (pageX - crop.canvas.left) / crop.canvas.width;
    const v = (pageY - crop.canvas.top) / crop.canvas.height;
    nudged.push({
      id: p.id,
      name: p.name,
      u,
      v,
      px,
      py: yMix,
      preferY: py,
      edgeY,
      L: +lumAt(raw, W, px, yMix).toFixed(1),
      localPos: p.localPos,
      localNormal: p.localNormal
    });
  }
  return nudged;
}

async function hitUv(page, u, v, preferLocal) {
  return page.evaluate(
    ({ u, v, preferLocal }) => {
      const host = window.__solidHost;
      const THREE = host.getTHREE();
      const cam = host.getCamera();
      const g = host.getSceneGroup();
      let root = null;
      g.traverse((o) => {
        if (!root && o.userData && o.userData.type === 'glb') root = o;
      });
      if (!root) root = g.children[0];
      const meshes = [];
      root.traverse((o) => {
        if (o.isMesh && o.geometry) meshes.push(o);
      });
      const raycaster = new THREE.Raycaster();
      const prefer = new THREE.Vector3(...preferLocal);
      let best = null;
      let bestScore = 1e9;
      for (let dv = -0.02; dv <= 0.02; dv += 0.004) {
        for (let du = -0.025; du <= 0.025; du += 0.004) {
          raycaster.setFromCamera(new THREE.Vector2((u + du) * 2 - 1, -((v + dv) * 2 - 1)), cam);
          const hits = raycaster.intersectObjects(meshes, true);
          if (!hits.length) continue;
          const hit = hits[0];
          const lp = root.worldToLocal(hit.point.clone());
          // 顶纵交界应在头颅上半，勿落到鼻额脸侧剪影
          if (lp.y < 0.12) continue;
          if (lp.z > 0.09 && Math.abs(lp.x) < 0.025) continue;
          const dist = lp.distanceTo(prefer);
          const score = dist + Math.max(0, 0.1 - lp.y) * 2;
          if (score < bestScore) {
            bestScore = score;
            let nWorld = new THREE.Vector3(0, 1, 0);
            if (hit.face && hit.face.normal) {
              nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
            }
            const localNormal = root
              .worldToLocal(hit.point.clone().add(nWorld))
              .sub(lp.clone())
              .normalize();
            best = {
              localPos: [+lp.x.toFixed(4), +lp.y.toFixed(4), +lp.z.toFixed(4)],
              localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
              baseDist: +hit.distance.toFixed(4),
              score: +score.toFixed(4)
            };
          }
        }
      }
      return best;
    },
    { u, v, preferLocal }
  );
}

async function main() {
  const file = load206();
  file.data = seed206(file.data);
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  console.log('seeded', file.f, file.data.camera, file.data.light);
  console.log('merged', rebuildAggregate());

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);

  await boot(page);
  await openL06(page);
  for (let k = 0; k < 6; k++) {
    await scrubUI(page);
    await page.waitForTimeout(160);
  }

  const crop = await page.evaluate(() => {
    const s = (window.customScenes || []).find((x) => x && x.id === 'L06');
    const c = (s && s.crop) || {};
    const canvas =
      document.querySelector('canvas') ||
      (window.__solidHost && window.__solidHost.getRenderer && window.__solidHost.getRenderer().domElement);
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.round(parseFloat(c.left) || 420),
      y: Math.round(parseFloat(c.top) || 70),
      width: Math.round(parseFloat(c.width) || 760),
      height: Math.round(parseFloat(c.height) || 760),
      canvas: { left: r.left, top: r.top, width: r.width, height: r.height }
    };
  });

  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await scrubUI(page);
  await page.waitForTimeout(600);
  const probePath = path.join(outDir, 'L06-probe-light.png');
  await page.screenshot({ path: probePath, clip: crop, timeout: 45000 });
  await page.screenshot({ path: path.join(outDir, 'L06-clean.png'), timeout: 45000 });

  const anat = await pickAnatomy(page);
  fs.writeFileSync(path.join(outDir, 'L06-anatomy.json'), JSON.stringify(anat, null, 2));
  console.log('anatomy', anat.ok, anat.sampleCount, anat.anchors);
  if (!anat.ok) throw new Error('anatomy pick fail');

  const { data, info } = await sharp(probePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const uvHits = await projectAndNudge(page, anat.anchors, crop, data, W, H);
  console.log('uvHits', JSON.stringify(uvHits, null, 2));

  // overlay
  {
    const overlay = Buffer.from(data);
    for (const h of uvHits) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const xx = h.px + dx;
          const yy = h.py + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const i = (yy * W + xx) * 3;
          overlay[i] = 255;
          overlay[i + 1] = 40;
          overlay[i + 2] = 40;
        }
      }
    }
    await sharp(overlay, { raw: { width: W, height: H, channels: 3 } })
      .png()
      .toFile(path.join(outDir, 'L06-edge-overlay.png'));
  }

  const annotations = [];
  const placed = [];
  const dxList = [70, 86, 78];
  const dyList = [-20, 0, 24];
  for (let i = 0; i < uvHits.length; i++) {
    const h = uvHits[i];
    let hit = await hitUv(page, h.u, h.v, h.localPos);
    if (!hit || hit.score > 0.12) {
      hit = {
        localPos: [...h.localPos],
        localNormal: [...h.localNormal],
        baseDist: 6.2,
        score: hit ? hit.score : 999,
        fallback: true
      };
    }
    annotations.push({
      id: 'anno_l06_' + h.id,
      annotationKind: 'leader',
      text: h.id,
      detailText: '',
      collapsed: false,
      color: '#bfbfbf',
      dx: dxList[i],
      dy: dyList[i],
      dxN: dxList[i] * 0.0007,
      dyN: dyList[i] * 0.0007,
      dxW: dxList[i] * 0.0025,
      dyW: dyList[i] * 0.0025,
      localPos: hit.localPos,
      localNormal: hit.localNormal,
      baseDist: hit.baseDist,
      baseScale: 5.8,
      labelShape: 'circle',
      occludeDot: -0.35
    });
    placed.push({ id: h.id, name: h.name, ...hit, edge: h });
  }

  const byId = Object.fromEntries(annotations.map((a) => [a.text.trim(), a]));
  const dashedLines = [
    bezSeg('dash_l06_1', byId['1'], byId['2']),
    bezSeg('dash_l06_2', byId['2'], byId['3'])
  ].filter(Boolean);

  const keyPoints = [
    '本关只看光：正顶光——光线几乎从头顶正上方下来。本场景研究的是「顶面与纵面」交界，而不是脸侧剪影或阴阳对半那种左右交界。',
    '交界主要跟「光线和头的夹角」有关：请转动场景，换角度看这条交界。请不要在操作面板中改变光线相关的设置；若不小心改了，点「重置」恢复即可。',
    '',
    '知识库说：光源在正上方时，「光照边际」就是顶面与纵面转换的位置。顶纵交界可先抓三个关键点：额结节定高、颅侧结节定宽、枕后突隆定后界。',
    '大半侧取景，是为了把这条交界脊看清楚。侧面观里，枕后突隆往往最低，颅侧结节略高于额结节。',
    '',
    '【交界 · 顶纵三点】',
    '①.额结节',
    '②.颅侧结节',
    '③.枕后突隆',
    '',
    '圆标钉在交界缘经过的关键转折上；虚线串起主走向。可点击眼睛图标隐藏标注，更干净地观察明暗交界。'
  ].join('\n');

  const fresh = load206();
  fresh.data.items[0].annotations = annotations;
  fresh.data.items[0].dashedLines = dashedLines;
  fresh.data.meta.status = 'seeded';
  fresh.data.meta.detail =
    '正顶光：顶面与纵面转换的明暗交界。大半侧取景，钉额结节—颅侧结节—枕后突隆（知识库顶纵三点）。';
  fresh.data.meta.keyPoints = keyPoints;
  fresh.data.meta.keyPointsRich = plainToRich(keyPoints);
  fs.writeFileSync(fresh.full, JSON.stringify(fresh.data) + '\n');
  console.log('merged', rebuildAggregate());
  fs.writeFileSync(path.join(outDir, 'L06-pick.json'), JSON.stringify({ placed, uvHits }, null, 2));

  await boot(page);
  await openL06(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  for (let k = 0; k < 5; k++) {
    await scrubUI(page);
    await page.waitForTimeout(160);
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'L06-annotated.png'), timeout: 45000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
