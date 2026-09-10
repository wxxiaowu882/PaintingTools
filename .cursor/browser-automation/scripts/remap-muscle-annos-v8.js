/**
 * 肌肉标注换模：欧版 → 黄种人女 V8
 * - 另存 docs/json/结构_头骨骨点肌肉/03 肌肉详解_黄种人女V8.json
 * - 先探测同名网格同索引是否真对应；若不对应（常见于 Draco/导出重排），
 *   则在索引池网格上用「旧点世界坐标 → 新模型最近顶点」做空间迁移（仍贴对应解剖区）
 * - 硬指标自测 + Playwright 视觉截图
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;

const SRC_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解.json');
const OUT_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解_黄种人女V8.json');
const OLD_GLB = path.join(repoRoot, 'docs', 'model', '头部肌肉_20260324204416_opt.glb');
const NEW_GLB = path.join(
  repoRoot,
  'docs',
  'model',
  '头部肌肉_黄种人_女_V8_std_opt_20260905111512.glb'
);
const NEW_MODEL_SRC = '../docs/model/头部肌肉_黄种人_女_V8_std_opt_20260905111512.glb';

const MAX_NEW_SURFACE_MM = 0.5;
const EXCLUDE_NAME_RE = /static|pupil|euro pupil|melns/i;
/** 同索引探测：至少多少比例「同索引=最近」才视为真同拓扑 */
const TOPO_AGREE_MIN = 0.5;

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-remap-muscle-v8`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function parseVec3m(str) {
  const parts = String(str)
    .replace(/m/g, '')
    .trim()
    .split(/\s+/)
    .map(Number);
  assert(parts.length === 3 && parts.every((n) => Number.isFinite(n)), `坏坐标: ${str}`);
  return parts;
}

function formatVec3m(v) {
  return `${v[0].toFixed(4)}m ${v[1].toFixed(4)}m ${v[2].toFixed(4)}m`;
}

function dist3(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dy, dz);
}

function decompressGlb(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const r = spawnSync(
    'npx',
    ['--yes', '@gltf-transform/cli@4', 'copy', src, dst],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: true,
      timeout: 180000,
    }
  );
  if (r.status !== 0) {
    throw new Error(
      `gltf-transform copy 失败 (${src}):\n${r.stdout || ''}\n${r.stderr || ''}`
    );
  }
  assert(fs.existsSync(dst), `解压产物不存在: ${dst}`);
}

function loadGlb(filePath) {
  const buf = fs.readFileSync(filePath);
  assert(buf.toString('utf8', 0, 4) === 'glTF', `非 GLB: ${filePath}`);
  let offset = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (offset + 8 <= buf.length) {
    const chunkLen = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    const data = buf.subarray(offset + 8, offset + 8 + chunkLen);
    offset += 8 + chunkLen;
    if (chunkType === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (chunkType === 0x004e4942) bin = Buffer.from(data);
  }
  assert(json, `无 JSON chunk: ${filePath}`);
  return { json, bin };
}

function readAccessorVec3(json, bin, accessorIndex) {
  const acc = json.accessors[accessorIndex];
  assert(acc && acc.type === 'VEC3', `accessor ${accessorIndex} 非 VEC3`);
  assert(acc.componentType === 5126, `accessor ${accessorIndex} 非 FLOAT`);
  assert('bufferView' in acc, `accessor ${accessorIndex} 无 bufferView（可能仍含 Draco）`);
  const bv = json.bufferViews[acc.bufferView];
  const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || 12;
  const out = new Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    const o = byteOffset + i * stride;
    out[i] = [bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)];
  }
  return out;
}

function collectWorldMeshes(glb) {
  const { json, bin } = glb;
  const meshes = {};
  for (const node of json.nodes || []) {
    if (node.mesh === undefined) continue;
    const name = node.name || json.meshes[node.mesh].name || `mesh_${node.mesh}`;
    const mesh = json.meshes[node.mesh];
    const prim = mesh.primitives[0];
    assert(prim && prim.attributes && prim.attributes.POSITION != null, `${name} 无 POSITION`);
    if (prim.extensions && prim.extensions.KHR_draco_mesh_compression) {
      throw new Error(`${name} 仍含 Draco，解压失败`);
    }
    const positions = readAccessorVec3(json, bin, prim.attributes.POSITION);
    let normals = null;
    if (prim.attributes.NORMAL != null) {
      normals = readAccessorVec3(json, bin, prim.attributes.NORMAL);
    }
    const sc = node.scale || [1, 1, 1];
    const tr = node.translation || [0, 0, 0];
    assert(!node.rotation, `${name} 含 rotation，当前脚本未处理`);
    const worldPos = positions.map((p) => [
      p[0] * sc[0] + tr[0],
      p[1] * sc[1] + tr[1],
      p[2] * sc[2] + tr[2],
    ]);
    let worldNrm = null;
    if (normals) {
      worldNrm = normals.map((n) => {
        const x = n[0] / sc[0];
        const y = n[1] / sc[1];
        const z = n[2] / sc[2];
        const len = Math.hypot(x, y, z) || 1;
        return [x / len, y / len, z / len];
      });
    }
    meshes[name] = {
      count: worldPos.length,
      positions: worldPos,
      normals: worldNrm,
    };
  }
  return meshes;
}

/** 同名且都可参与贴合的肌肉网格（可不要求顶点数相等） */
function buildIndexPool(oldMeshes, newMeshes) {
  const pool = [];
  for (const name of Object.keys(oldMeshes)) {
    if (EXCLUDE_NAME_RE.test(name)) continue;
    if (!newMeshes[name]) continue;
    if (newMeshes[name].count < 3) continue;
    pool.push(name);
  }
  pool.sort();
  assert(pool.length > 0, '索引池为空');
  return pool;
}

function probeSameIndexTopology(oldMeshes, newMeshes, poolNames) {
  const candidates = poolNames.filter(
    (n) => oldMeshes[n] && newMeshes[n] && oldMeshes[n].count === newMeshes[n].count
  );
  if (!candidates.length) {
    return { ok: false, reason: '无等顶点数同名网格', agreeRatio: 0, mesh: null };
  }
  candidates.sort((a, b) => newMeshes[b].count - newMeshes[a].count);
  const mesh = candidates[0];
  const ao = oldMeshes[mesh].positions;
  const an = newMeshes[mesh].positions;
  const N = Math.min(200, ao.length);
  let agree = 0;
  let sum = 0;
  let mx = 0;
  for (let k = 0; k < N; k++) {
    const i = (k * 9973) % ao.length;
    let bj = 0;
    let bd = Infinity;
    for (let j = 0; j < an.length; j++) {
      const d = dist3(ao[i], an[j]);
      if (d < bd) {
        bd = d;
        bj = j;
      }
    }
    if (bj === i) agree++;
    const d0 = dist3(ao[i], an[i]);
    sum += d0;
    if (d0 > mx) mx = d0;
  }
  const agreeRatio = agree / N;
  return {
    ok: agreeRatio >= TOPO_AGREE_MIN,
    mesh,
    sampleN: N,
    agree,
    agreeRatio: +agreeRatio.toFixed(4),
    meanSameIndexDispM: +(sum / N).toFixed(4),
    maxSameIndexDispM: +mx.toFixed(4),
    reason:
      agreeRatio >= TOPO_AGREE_MIN
        ? '同索引与空间最近一致，可用索引迁移'
        : '同索引与空间最近不一致（顶点重排），改用空间最近投影',
  };
}

function nearestOnPool(meshes, poolNames, point) {
  let best = null;
  for (const name of poolNames) {
    const arr = meshes[name].positions;
    for (let i = 0; i < arr.length; i++) {
      const d = dist3(arr[i], point);
      if (!best || d < best.dist) {
        best = { mesh: name, index: i, dist: d, pos: arr[i] };
      }
    }
  }
  return best;
}

function nearestVertex(mesh, point) {
  let bi = 0;
  let bd = Infinity;
  const arr = mesh.positions;
  for (let i = 0; i < arr.length; i++) {
    const d = dist3(arr[i], point);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return { index: bi, dist: bd, pos: arr[bi] };
}

async function browserVisualSelftest(newJsonPath, report) {
  const pageUrl = `${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    report.browser = { ok: false, error: `chromium launch failed: ${e.message}` };
    return false;
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#workbench-viewer', { timeout: 20000 });
    await page.waitForSelector('#file-input', { state: 'attached', timeout: 10000 });

    await page.setInputFiles('#file-input', newJsonPath);

    await page.waitForFunction(
      () => {
        const v = document.querySelector('#workbench-viewer');
        const src = (v && (v.getAttribute('src') || '')) || '';
        const countEl = document.getElementById('point-count');
        const countText = (countEl && countEl.innerText) || '';
        return src.includes('黄种人_女_V8') && /23/.test(countText);
      },
      null,
      { timeout: 120000 }
    );

    await page.waitForFunction(
      () => {
        const v = document.querySelector('#workbench-viewer');
        return v && typeof v.loaded !== 'undefined' ? v.loaded : !!v.getAttribute('src');
      },
      null,
      { timeout: 120000 }
    );
    await page.waitForTimeout(2500);

    const frontShot = path.join(outDir, '01-front.png');
    await page.screenshot({ path: frontShot, fullPage: true });

    await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      if (v) {
        v.setAttribute('camera-orbit', '-45deg 90deg auto');
        v.setAttribute('camera-target', 'auto auto auto');
      }
    });
    await page.waitForTimeout(1500);
    const sideShot = path.join(outDir, '02-oblique.png');
    await page.screenshot({ path: sideShot, fullPage: true });

    const info = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      return {
        src: v ? v.getAttribute('src') : null,
        pointCount: document.getElementById('point-count')
          ? document.getElementById('point-count').innerText
          : null,
        hotspotCount: v ? v.querySelectorAll('.preview-hotspot').length : 0,
      };
    });

    const ok =
      info.hotspotCount === 23 &&
      /23/.test(info.pointCount || '') &&
      String(info.src || '').includes('黄种人_女_V8');

    report.browser = {
      ok,
      info,
      screenshots: [frontShot, sideShot].map((p) => path.relative(repoRoot, p)),
    };
    return ok;
  } catch (e) {
    report.browser = { ok: false, error: String(e && e.stack ? e.stack : e) };
    try {
      await page.screenshot({ path: path.join(outDir, '99-error.png'), fullPage: true });
    } catch (_) {
      /* ignore */
    }
    return false;
  } finally {
    await browser.close();
  }
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const report = {
    ok: false,
    stamp,
    outDir: path.relative(repoRoot, outDir),
    checks: {},
    points: [],
    pool: [],
    topology: null,
    mode: null,
  };

  assert(fs.existsSync(SRC_JSON), `缺少源 JSON: ${SRC_JSON}`);
  assert(fs.existsSync(OLD_GLB), `缺少旧 GLB: ${OLD_GLB}`);
  assert(fs.existsSync(NEW_GLB), `缺少新 GLB: ${NEW_GLB}`);

  const srcHashBefore = sha256File(SRC_JSON);
  const srcJson = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
  assert(Array.isArray(srcJson.pointsData) && srcJson.pointsData.length === 23, '源标注不是 23 点');

  const tmpOld = path.join(outDir, '_old_nodraco.glb');
  const tmpNew = path.join(outDir, '_new_nodraco.glb');
  console.log('解压 Draco…');
  decompressGlb(OLD_GLB, tmpOld);
  decompressGlb(NEW_GLB, tmpNew);

  console.log('解析网格…');
  const oldMeshes = collectWorldMeshes(loadGlb(tmpOld));
  const newMeshes = collectWorldMeshes(loadGlb(tmpNew));
  const pool = buildIndexPool(oldMeshes, newMeshes);
  report.pool = pool.map((n) => ({
    name: n,
    oldVerts: oldMeshes[n].count,
    newVerts: newMeshes[n].count,
    sameCount: oldMeshes[n].count === newMeshes[n].count,
  }));
  console.log('索引池', report.pool);

  const topo = probeSameIndexTopology(oldMeshes, newMeshes, pool);
  report.topology = topo;
  report.mode = topo.ok ? 'same_index' : 'spatial_nearest_on_new';
  console.log('拓扑探测', topo, 'mode=', report.mode);

  const outPoints = [];
  for (const p of srcJson.pointsData) {
    assert(p.type === 'point', `非 point 类型: id=${p.id}`);
    const oldPos = parseVec3m(p.pos);

    let meshName;
    let index;
    let newPos;
    let newNrm;
    let oldSurfaceMm;
    let method;

    if (topo.ok) {
      const hit = nearestOnPool(oldMeshes, pool, oldPos);
      assert(hit, `未命中旧索引池: id=${p.id}`);
      assert(
        oldMeshes[hit.mesh].count === newMeshes[hit.mesh].count,
        `网格 ${hit.mesh} 顶点数不等，无法索引迁移`
      );
      meshName = hit.mesh;
      index = hit.index;
      newPos = newMeshes[meshName].positions[index];
      newNrm = newMeshes[meshName].normals
        ? newMeshes[meshName].normals[index]
        : [0, 0, 1];
      oldSurfaceMm = hit.dist * 1000;
      method = 'same_index';
    } else {
      const hitNew = nearestOnPool(newMeshes, pool, oldPos);
      assert(hitNew, `未命中新索引池: id=${p.id}`);
      const hitOld = nearestOnPool(oldMeshes, pool, oldPos);
      meshName = hitNew.mesh;
      index = hitNew.index;
      newPos = hitNew.pos;
      newNrm = newMeshes[meshName].normals
        ? newMeshes[meshName].normals[index]
        : [0, 0, 1];
      oldSurfaceMm = hitOld ? hitOld.dist * 1000 : null;
      method = 'spatial_nearest_on_new';
    }

    const verify = nearestVertex(newMeshes[meshName], newPos);
    const entry = {
      id: p.id,
      text: p.text,
      method,
      mesh: meshName,
      index,
      oldSurfaceMm: oldSurfaceMm == null ? null : +oldSurfaceMm.toFixed(4),
      transferDispMm: +(dist3(oldPos, newPos) * 1000).toFixed(4),
      newSurfaceMm: +(verify.dist * 1000).toFixed(4),
      oldPos,
      newPos,
      newNorm: newNrm,
    };
    report.points.push(entry);

    outPoints.push({
      ...p,
      pos: formatVec3m(newPos),
      norm: formatVec3m(newNrm),
    });
  }

  const byText = Object.fromEntries(report.points.map((x) => [x.text, x]));
  if (byText['枕肌']) {
    report.checks.occipitalisBack = byText['枕肌'].newPos[2] < 0;
  }
  if (byText['颞肌']) {
    report.checks.temporalisLateral = Math.abs(byText['颞肌'].newPos[0]) > 0.04;
  }

  const outJson = {
    ...srcJson,
    timestamp: Date.now(),
    modelSrc: NEW_MODEL_SRC,
    pointsData: outPoints,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(outJson, null, 2) + '\n', 'utf8');

  const srcHashAfter = sha256File(SRC_JSON);
  report.checks.srcUnchanged = srcHashBefore === srcHashAfter;
  report.checks.srcHash = srcHashBefore;

  const written = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  report.checks.outExists = fs.existsSync(OUT_JSON);
  report.checks.pointCount23 = written.pointsData.length === 23;
  report.checks.modelSrc = written.modelSrc === NEW_MODEL_SRC;
  report.checks.allInPool = report.points.every((x) => pool.includes(x.mesh));
  report.checks.maxNewSurfaceMm = Math.max(...report.points.map((x) => x.newSurfaceMm));
  report.checks.surfaceOk = report.checks.maxNewSurfaceMm < MAX_NEW_SURFACE_MM;
  report.checks.maxTransferDispMm = Math.max(...report.points.map((x) => x.transferDispMm));

  assert(report.checks.srcUnchanged, '原 JSON 被改动了');
  assert(report.checks.outExists, '新 JSON 未写出');
  assert(report.checks.pointCount23, '新 JSON 点数不是 23');
  assert(report.checks.modelSrc, `modelSrc 不对: ${written.modelSrc}`);
  assert(report.checks.allInPool, '存在未落在索引池网格上的点');
  assert(
    report.checks.surfaceOk,
    `新贴面距超标: max=${report.checks.maxNewSurfaceMm}mm (阈值 ${MAX_NEW_SURFACE_MM}mm)`
  );
  assert(report.checks.occipitalisBack !== false, '枕肌未落在后脑（z<0），迁移可能错位');
  assert(report.checks.temporalisLateral !== false, '颞肌未落在外侧，迁移可能错位');

  try {
    fs.unlinkSync(tmpOld);
    fs.unlinkSync(tmpNew);
  } catch (_) {
    /* ignore */
  }

  console.log('浏览器视觉自测…');
  const browserOk = await browserVisualSelftest(OUT_JSON, report);
  report.checks.browserOk = browserOk;

  report.ok = !!(
    report.checks.srcUnchanged &&
    report.checks.pointCount23 &&
    report.checks.surfaceOk &&
    report.checks.allInPool &&
    report.checks.occipitalisBack !== false &&
    report.checks.temporalisLateral !== false &&
    browserOk
  );

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        mode: report.mode,
        topology: report.topology,
        outJson: path.relative(repoRoot, OUT_JSON),
        maxNewSurfaceMm: report.checks.maxNewSurfaceMm,
        maxTransferDispMm: report.checks.maxTransferDispMm,
        anatomyChecks: {
          occipitalisBack: report.checks.occipitalisBack,
          temporalisLateral: report.checks.temporalisLateral,
        },
        browser: report.browser,
        report: path.relative(repoRoot, path.join(outDir, 'report.json')),
      },
      null,
      2
    )
  );

  if (!report.ok) {
    process.exitCode = 1;
    throw new Error('自测未全部通过，见 report.json');
  }
  console.log('PASS remap-muscle-annos-v8');
})().catch((err) => {
  console.error('FAIL', err);
  process.exitCode = 1;
});
