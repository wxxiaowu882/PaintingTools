/**
 * 导出对齐+拧形后的欧版烘焙 GLB 与工坊用映射表 map.json
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { applyNormalizePoint } from './procrustes.js';
import { patchGlbAssetExtras } from '../../js/export-glb.js';
import {
  isEuroJunkOverlayName,
  prepareEuroMeshesForExport,
  cloneMaterialForExport,
} from './euro-render-prep.js?v=20260829-display18';

const EXTRAS_KEY = 'paintingtools';
const EXTRAS_MUSCLE_MAP_KEY = 'euroMuscleMap';

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function sanitizeBase(name) {
  const s = (name || 'euro_baked').replace(/[^\w\u4e00-\u9fff\-]+/g, '_').replace(/_+/g, '_');
  return s.slice(0, 56) || 'euro_baked';
}

/**
 * @param {object} opts
 * @param {object[]} opts.points 路标 editor points
 * @param {object} opts.norm computeBottomCenterNormalize 结果
 * @param {object|null} opts.warpSnapshot
 * @param {string} [opts.note]
 */
export function buildMuscleMapJson({ points, norm, warpSnapshot, note }) {
  if (!norm) throw new Error('缺少 GNM normalize');
  const byKey = new Map();
  for (const p of points || []) {
    if (!p?.pairKey) continue;
    if (!byKey.has(p.pairKey)) byKey.set(p.pairKey, {});
    byKey.get(p.pairKey)[p.side === 'euro' ? 'euro' : 'gnm'] = p;
  }
  const dstByKey = new Map();
  if (warpSnapshot?.used?.length && warpSnapshot?.dst?.length) {
    for (let i = 0; i < warpSnapshot.used.length; i++) {
      dstByKey.set(warpSnapshot.used[i], warpSnapshot.dst[i]);
    }
  }
  const pairs = [];
  for (const [id, sides] of byKey) {
    if (!sides.gnm || !sides.euro) continue;
    const gnmNative = sides.gnm.pos.slice(0, 3);
    const P = applyNormalizePoint(gnmNative, norm);
    const dst = dstByKey.get(id);
    const Q = dst ? dst.slice(0, 3) : P.slice(0, 3);
    pairs.push({
      id,
      label: sides.gnm.name || sides.euro.name || id,
      gnmNative,
      P,
      Q,
    });
  }
  return {
    version: 1,
    note: note || '',
    createdAt: new Date().toISOString(),
    targetHeightCm: 30,
    align: 'bottomCenter',
    norm: {
      scale: norm.scale,
      offset: norm.offset.slice(0, 3),
      heightCm: norm.heightCm ?? 30,
    },
    pairCount: pairs.length,
    pairs,
  };
}

/**
 * 将 euroPivot 下网格烘焙到世界坐标并导出 GLB + map.json
 */
export async function exportBakedEuroPack({
  euroPivot,
  points,
  norm,
  warpSnapshot,
  note,
  requireWarp = true,
  onStatus,
}) {
  if (!euroPivot?.children?.length) throw new Error('欧版未就绪');
  if (requireWarp && (!warpSnapshot?.dst?.length || warpSnapshot.dst.length < 4)) {
    throw new Error('请先点「拧」并确认拧形有效后再导出烘焙包');
  }

  const map = buildMuscleMapJson({ points, norm, warpSnapshot, note });
  if (map.pairs.length < 4) {
    throw new Error(`映射点对不足（${map.pairs.length}），需至少 4 对已配对路标`);
  }

  euroPivot.updateMatrixWorld(true);
  const exportRoot = new THREE.Group();
  exportRoot.name = 'EuroMuscle_Baked';

  euroPivot.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    if (isEuroJunkOverlayName(obj.name) || isEuroJunkOverlayName(obj.parent?.name)) return;
    prepareEuroMeshesForExport(obj);
    const geo = obj.geometry.clone();
    geo.applyMatrix4(obj.matrixWorld);
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const clonedMats = mats.map((m) => cloneMaterialForExport(m));
    const mesh = new THREE.Mesh(geo, clonedMats.length === 1 ? clonedMats[0] : clonedMats);
    prepareEuroMeshesForExport(mesh);
    mesh.name = obj.name || 'EuroMesh';
    exportRoot.add(mesh);
  });

  if (!exportRoot.children.length) throw new Error('未找到可导出的欧版网格');

  onStatus?.('正在序列化烘焙 GLB…');
  const exporter = new GLTFExporter();
  const glbBuffer = await new Promise((resolve, reject) => {
    exporter.parse(
      exportRoot,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('GLTFExporter 未返回二进制'));
      },
      (err) => reject(err),
      { binary: true, onlyVisible: false, truncateDrawRange: true }
    );
  });

  const base = sanitizeBase(note);
  const patched = patchGlbAssetExtras(glbBuffer, {
    [EXTRAS_KEY]: {
      [EXTRAS_MUSCLE_MAP_KEY]: map,
    },
  });
  downloadBlob(new Blob([patched], { type: 'model/gltf-binary' }), `${base}_baked.glb`);
  await new Promise((r) => setTimeout(r, 350));
  downloadBlob(
    new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' }),
    `${base}_map.json`
  );

  exportRoot.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m?.dispose?.();
    }
  });

  onStatus?.(`已导出 ${base}_baked.glb + ${base}_map.json（${map.pairCount} 对映射点）`);
  return { base, map, bytes: glbBuffer.byteLength };
}
