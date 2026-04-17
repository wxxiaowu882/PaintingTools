// Shared preview-mode lighting for Solid consumer & producer pages.
// “Preview mode” means useAdvancedRender === false in hosts.
//
// 生产端页面（如石膏人像沙盒）请与 Solid.html 一致：只 import 本模块并 wiring install/setEnabled/syncShadows，
// 不要在页面内复制地面阴影的 onBeforeCompile / ShaderChunk 改写逻辑。

/**
 * 与 Solid.html 中 shouldSkipEnvProbe 条件一致，供消费端与生产端共用，避免各写一套导致行为分叉。
 * @param {() => { useAdvancedRender?: boolean; isLoadingScene?: boolean; currentSceneData?: unknown; currentSceneIndex?: number }} getFlags
 */
export function solidRasterPreviewShouldSkipEnvProbe(getFlags) {
  return function shouldSkipEnvProbe(_reason) {
    try {
      const w = (typeof getFlags === 'function' ? getFlags() : {}) || {};
      return !!(
        w.useAdvancedRender ||
        w.isLoadingScene ||
        !w.currentSceneData ||
        w.currentSceneIndex == null ||
        w.currentSceneIndex < 0
      );
    } catch (_e) {
      return false;
    }
  };
}

export function createSolidPreviewLightingManager(opts) {
  const THREE = opts && opts.THREE;
  if (!THREE) throw new Error('createSolidPreviewLightingManager: opts.THREE required');

  const getRenderer = opts.getRenderer || (() => opts.renderer);
  const getScene = opts.getScene || (() => opts.scene);
  const getCamera = opts.getCamera || (() => opts.camera);
  const getSceneGroup = opts.getSceneGroup || (() => opts.sceneGroup);
  const getMainLight = opts.getMainLight || (() => opts.mainLight);
  const getGround = opts.getGround || (() => opts.ground);
  const getWalls = opts.getWalls || (() => opts.walls);

  const log = typeof opts.log === 'function' ? opts.log : (() => {});
  const safeDispose = typeof opts.safeDispose === 'function' ? opts.safeDispose : (() => {});

  const getIsMobile = typeof opts.getIsMobile === 'function' ? opts.getIsMobile : (() => !!opts.isMobile);
  const getIsIosHost = typeof opts.getIsIosHost === 'function' ? opts.getIsIosHost : (() => !!opts.isIosHost);
  const getLightState = typeof opts.getLightState === 'function' ? opts.getLightState : (() => opts.lightState || null); // expects { radius?: number }
  const shouldSkipEnvProbe = typeof opts.shouldSkipEnvProbe === 'function' ? opts.shouldSkipEnvProbe : () => false;

  let previewEnabled = true;
  let _receiverPatchLastEnsureAt = 0;
  let _receiverEnsureBusy = false;
  let _receiverWallsSigLast = '';
  let _receiverModelsSigLast = '';

  // ---------- Raster shadow softening params ----------
  // Goal: keep contact edge relatively sharp, then progressively blur farther away from the model footprint
  // (distance in projected ground plane, NOT distance to light).
  //
  // Tuning tips:
  // - Increase `strength` => farther region gets softer (bigger PCF radius multiplier).
  // - Increase `exp`      => near region stays sharper, far region ramps up faster.
  // - `startH/endH` are multipliers of model height (sceneGroup bbox size.y); they control where the ramp begins/ends.
  //   This is more intuitive for typical Solid assets (~20cm–50cm height).
  const RASTER_SHADOW_SOFT_PARAMS = {
    // Directional / Spot: usually matches the “reference photo” look better (longer, smoother tail).
    dirSpot: {
      // More visible defaults (easy to tune down):
      // start smaller => blur begins closer to the model footprint
      // end smaller   => reaches maximum blur sooner (stronger tail)
      // Aggressive “far end melts away” defaults:
      // - endH smaller => reaches maximum blur earlier, so the far edge loses the hard contour.
      // - exp closer to 1 => mid/far region gets blur sooner (less “stuck sharp”).
      startH: 0.10, // start blur after ~0.10x model height
      endH: 0.95,   // reach max blur at ~0.95x model height
      exp: 1.15,
      strengthDesktop: 140.0,
      strengthMobile: 85.0,
    },
    // Point light cube shadow tends to look “grainier”; keep it slightly more conservative.
    point: {
      // Point light: still aggressive, but a bit more conservative than dir/spot.
      startH: 0.10,
      endH: 0.85,
      exp: 1.10,
      strengthDesktop: 110.0,
      strengthMobile: 70.0,
    },
  };

  // Gaussian-like PCF sampling params.
  // If you see “rings / slice stacking”, increase `taps` and/or enable `rotate` to break fixed tap patterns.
  const RASTER_SHADOW_GAUSS_PARAMS = {
    // Desktop default: smoother penumbra, less ring artifacts.
    // Note: implementation supports up to 32 taps.
    desktop: { taps: 24, rotate: 1 },
    // Mobile: fewer taps to keep it fast.
    mobile: { taps: 12, rotate: 1 },
  };

  function _rasterShadowDbgEnabled() {
    try { return typeof window !== 'undefined' && localStorage.getItem('SolidRasterShadowDbg') === '1'; }
    catch (_e) { return false; }
  }

  function _contactPatchEnabled() {
    try {
      if (typeof window === 'undefined') return true;
      if (window.__solidContactPatchEnabled != null) return !!window.__solidContactPatchEnabled;
      return localStorage.getItem('SolidContactPatch') !== '0';
    } catch (_e) {
      return true;
    }
  }

  function _contactPatchDebugAllEnabled() {
    try {
      if (typeof window === 'undefined') return false;
      if (window.__solidContactPatchDebugAll != null) return !!window.__solidContactPatchDebugAll;
      return localStorage.getItem('SolidContactPatchDebugAll') === '1';
    } catch (_e) {
      return false;
    }
  }

  function _contactPatchForceRedEnabled() {
    try {
      if (typeof window === 'undefined') return false;
      if (window.__solidContactPatchForceRed != null) return !!window.__solidContactPatchForceRed;
      return localStorage.getItem('SolidContactPatchForceRed') === '1';
    } catch (_e) {
      return false;
    }
  }

  function _receiverSoftShadowWallsEnabled() {
    // Receiver soft shadows are always enabled in raster preview
    // (except directional path where we explicitly keep legacy projection).
    return true;
  }

  function _receiverSoftShadowModelsEnabled() {
    // Receiver soft shadows are always enabled in raster preview
    // (except directional path where we explicitly keep legacy projection).
    return true;
  }

  const _tmpFootprintV = new THREE.Vector3();

  function _installReceiverSoftShadowPatch(material, sharedUd, cfg) {
    try {
      if (!material || !sharedUd) return false;
      const canPatch = !!(material.isMeshPhysicalMaterial || material.isMeshStandardMaterial);
      if (!canPatch) return false;
      if (!material.userData) material.userData = {};
      const ud = material.userData;
      if (!ud._solidReceiverSoft) ud._solidReceiverSoft = { v: 1 };
      if (!ud.uSolidShadowGaussTaps) ud.uSolidShadowGaussTaps = sharedUd.uSolidShadowGaussTaps || { value: 16.0 };
      if (!ud.uSolidShadowGaussRotate) ud.uSolidShadowGaussRotate = sharedUd.uSolidShadowGaussRotate || { value: 1.0 };

      if (!material.defines) material.defines = {};
      material.defines.SOLID_SHADOW_SOFT_RECEIVER = 1;
      material.defines.SOLID_SHADOW_SOFT_RECEIVER_KIND = cfg && cfg.kindTag ? cfg.kindTag : 0;
      if (material.customProgramCacheKey) {
        // keep existing if any (ground relies on versioning); receiver uses stable key.
      } else {
        material.customProgramCacheKey = function() { return 'solid_shadow_soft_receiver_v1_k' + (cfg && cfg.kindTag ? cfg.kindTag : 0); };
      }

      material.onBeforeCompile = (shader) => {
        try {
          // --- patch shadow chunk wrappers ---
          let fs = shader.fragmentShader;
          const inc = '#include <shadowmap_pars_fragment>';
          if (!(fs && fs.includes(inc) && THREE.ShaderChunk && THREE.ShaderChunk.shadowmap_pars_fragment)) return;
          let chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
          chunk = chunk.replace(
            'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {',
            'float getShadow_orig( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {'
          );
          chunk = chunk.replace(
            'float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {',
            'float getPointShadow_orig( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {'
          );

          const append =
            '\n\nfloat solidHash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }\n' +
            'mat2 solidRot2( float a ) { float s = sin( a ), c = cos( a ); return mat2( c, -s, s, c ); }\n' +
            'float solidShadowSoftCompare( sampler2D shadowMap, vec2 uv, float compareZ, float smoothZ ) {\n' +
            '\tfloat depth = unpackRGBAToDepth( texture2D( shadowMap, uv ) );\n' +
            '\treturn 1.0 - smoothstep( 0.0, smoothZ, compareZ - depth );\n' +
            '}\n' +
            'vec2 solidPoisson24( int i ) {\n' +
            '\tif ( i == 0 ) return vec2( -0.326, -0.406 );\n' +
            '\tif ( i == 1 ) return vec2( -0.840, -0.074 );\n' +
            '\tif ( i == 2 ) return vec2( -0.696,  0.457 );\n' +
            '\tif ( i == 3 ) return vec2( -0.203,  0.621 );\n' +
            '\tif ( i == 4 ) return vec2(  0.962, -0.195 );\n' +
            '\tif ( i == 5 ) return vec2(  0.473, -0.480 );\n' +
            '\tif ( i == 6 ) return vec2(  0.519,  0.767 );\n' +
            '\tif ( i == 7 ) return vec2(  0.185, -0.893 );\n' +
            '\tif ( i == 8 ) return vec2(  0.507,  0.064 );\n' +
            '\tif ( i == 9 ) return vec2(  0.896,  0.412 );\n' +
            '\tif ( i == 10 ) return vec2( -0.322, -0.933 );\n' +
            '\tif ( i == 11 ) return vec2( -0.792, -0.598 );\n' +
            '\tif ( i == 12 ) return vec2( -0.043,  0.280 );\n' +
            '\tif ( i == 13 ) return vec2( -0.155,  0.970 );\n' +
            '\tif ( i == 14 ) return vec2(  0.252,  0.395 );\n' +
            '\tif ( i == 15 ) return vec2( -0.444,  0.106 );\n' +
            '\tif ( i == 16 ) return vec2(  0.727,  0.279 );\n' +
            '\tif ( i == 17 ) return vec2(  0.395, -0.732 );\n' +
            '\tif ( i == 18 ) return vec2( -0.600,  0.780 );\n' +
            '\tif ( i == 19 ) return vec2(  0.043, -0.165 );\n' +
            '\tif ( i == 20 ) return vec2(  0.143,  0.867 );\n' +
            '\tif ( i == 21 ) return vec2(  0.675, -0.160 );\n' +
            '\tif ( i == 22 ) return vec2( -0.325,  0.320 );\n' +
            '\treturn vec2( -0.069, -0.492 );\n' +
            '}\n' +
            'float solidGaussianShadow2D( sampler2D shadowMap, vec2 shadowMapSize, vec4 shadowCoord, float shadowRadius, float shadowBias ) {\n' +
            '\tvec3 sc = shadowCoord.xyz / shadowCoord.w;\n' +
            '\tvec3 sc0 = sc;\n' +
            '\tsc0.z += shadowBias;\n' +
            '\tsc = sc0;\n' +
            '\tbool inFrustum = sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0;\n' +
            '\tbool frustumTest = inFrustum && sc.z <= 1.0;\n' +
            '\tif ( !frustumTest ) return 1.0;\n' +
            '\tvec2 texel = vec2( 1.0 ) / shadowMapSize;\n' +
            '\tfloat tapsF = clamp( uSolidShadowGaussTaps, 4.0, 32.0 );\n' +
            '\tint taps = int( floor( tapsF + 0.5 ) );\n' +
            '\tfloat ang = ( uSolidShadowGaussRotate > 0.5 ) ? ( 6.2831853 * solidHash12( vSolidShadowWorldPos.xz * 0.071 + sc.xy * shadowMapSize.xy * 0.17 ) ) : 0.0;\n' +
            '\tmat2 R = solidRot2( ang );\n' +
            '\tfloat sum = 0.0;\n' +
            '\tfloat wsum = 0.0;\n' +
            '\tfor ( int i = 0; i < 32; i++ ) {\n' +
            '\t\tif ( i >= taps ) break;\n' +
            '\t\tfloat fi = float(i);\n' +
            '\t\tfloat t = (fi + 0.5) / max( 1.0, float(taps) );\n' +
            '\t\tvec2 o = ( R * solidPoisson24( i ) ) * sqrt( clamp( t, 0.001, 1.0 ) );\n' +
            '\t\tvec2 uv = sc.xy + o * texel * shadowRadius;\n' +
            '\t\tif ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) continue;\n' +
            '\t\tfloat rr = dot( o, o );\n' +
            '\t\tfloat w = exp( - rr * 2.4 );\n' +
            '\t\tfloat hardTap = texture2DCompare( shadowMap, uv, sc.z );\n' +
            '\t\tfloat softTap = solidShadowSoftCompare( shadowMap, uv, sc.z, 0.0018 );\n' +
            '\t\tfloat tap = min( hardTap, softTap );\n' +
            '\t\tsum += w * tap;\n' +
            '\t\twsum += w;\n' +
            '\t}\n' +
            '\treturn (wsum > 0.0) ? (sum / wsum) : 1.0;\n' +
            '}\n' +
            'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {\n' +
            '\tfloat dSolidSh = 1e9;\n' +
            '\tfor ( int i = 0; i < 8; i++ ) {\n' +
            '\t\tif ( i >= uSolidShadowAnchorCount ) break;\n' +
            '\t\tdSolidSh = min( dSolidSh, length( vSolidShadowWorldPos.xz - uSolidShadowAnchors[i].xz ) );\n' +
            '\t}\n' +
            '\tfloat tSolidSh = smoothstep( uSolidShadowSoftRange.x, uSolidShadowSoftRange.y, dSolidSh );\n' +
            '\ttSolidSh = pow( clamp( tSolidSh, 0.0, 1.0 ), max( 0.75, uSolidShadowSoftExp ) );\n' +
            '\tshadowRadius *= ( 1.0 + uSolidShadowSoftStrength * tSolidSh );\n' +
            '\treturn solidGaussianShadow2D( shadowMap, shadowMapSize, shadowCoord, shadowRadius, shadowBias );\n' +
            '}\n' +
            'float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {\n' +
            '\treturn getPointShadow_orig( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord, shadowCameraNear, shadowCameraFar );\n' +
            '}\n';

          const endifIdx = chunk.lastIndexOf('#endif');
          if (endifIdx < 0) return;
          chunk = chunk.slice(0, endifIdx) + append + '\n' + chunk.slice(endifIdx);
          fs = fs.replace(inc, chunk);

          shader.uniforms.uSolidShadowAnchorCount = sharedUd.uSolidShadowAnchorCount;
          shader.uniforms.uSolidShadowAnchors = sharedUd.uSolidShadowAnchors;
          shader.uniforms.uSolidShadowSoftRange = sharedUd.uSolidShadowSoftRange;
          shader.uniforms.uSolidShadowSoftStrength = sharedUd.uSolidShadowSoftStrength;
          shader.uniforms.uSolidShadowSoftExp = sharedUd.uSolidShadowSoftExp;
          shader.uniforms.uSolidShadowGaussTaps = ud.uSolidShadowGaussTaps;
          shader.uniforms.uSolidShadowGaussRotate = ud.uSolidShadowGaussRotate;

          // receiver uniforms/varying
          shader.fragmentShader =
            'varying vec3 vSolidShadowWorldPos;\n' +
            'uniform int uSolidShadowAnchorCount;\n' +
            'uniform vec3 uSolidShadowAnchors[8];\n' +
            'uniform vec4 uSolidShadowSoftRange;\n' +
            'uniform float uSolidShadowSoftStrength;\n' +
            'uniform float uSolidShadowSoftExp;\n' +
            'uniform float uSolidShadowGaussTaps;\n' +
            'uniform float uSolidShadowGaussRotate;\n' +
            fs;

          // vertex varying assign
          shader.vertexShader = 'varying vec3 vSolidShadowWorldPos;\n' + shader.vertexShader;
          const assign = '\n\tvSolidShadowWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;';
          if (shader.vertexShader.includes('#include <worldpos_vertex>')) {
            shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>' + assign);
          } else if (shader.vertexShader.includes('#include <begin_vertex>')) {
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>' + assign);
          }
        } catch (_e) {}
      };

      // gaussian params
      try {
        const g = cfg && cfg.gauss ? cfg.gauss : { taps: 16, rotate: 1 };
        ud.uSolidShadowGaussTaps.value = g.taps;
        ud.uSolidShadowGaussRotate.value = g.rotate ? 1.0 : 0.0;
      } catch (_eG) {}

      material.needsUpdate = true;
      return true;
    } catch (_e0) {
      return false;
    }
  }

  function _clearReceiverSoftShadowPatch(material) {
    try {
      if (!material) return false;
      const had = !!(material.defines && (material.defines.SOLID_SHADOW_SOFT_RECEIVER || material.defines.SOLID_SHADOW_SOFT_RECEIVER_KIND != null));
      if (!had) return false;
      // Keep behavior conservative: remove defines + neutralize onBeforeCompile to avoid shader-cache key pitfalls.
      try {
        if (material.defines) {
          delete material.defines.SOLID_SHADOW_SOFT_RECEIVER;
          delete material.defines.SOLID_SHADOW_SOFT_RECEIVER_KIND;
        }
      } catch (_eDef) {}
      try {
        if (material.onBeforeCompile) material.onBeforeCompile = function() {};
      } catch (_eObc) {}
      try { material.needsUpdate = true; } catch (_eNu) {}
      return true;
    } catch (_e) {
      return false;
    }
  }

  function _hasReceiverSoftPatch(material) {
    try {
      return !!(material && material.defines && material.defines.SOLID_SHADOW_SOFT_RECEIVER === 1);
    } catch (_e) {
      return false;
    }
  }

  function _shouldEnsureReceiverSoftPatch() {
    try {
      if (!previewEnabled) return false;
      const mainLight = getMainLight();
      if (!mainLight || mainLight.isDirectionalLight) return false;
      const wantWalls = _receiverSoftShadowWallsEnabled();
      const wantModels = _receiverSoftShadowModelsEnabled();
      if (!wantWalls && !wantModels) return false;

      if (wantWalls) {
        const walls = getWalls();
        if (walls && Array.isArray(walls)) {
          for (let wi = 0; wi < walls.length; wi++) {
            const w = walls[wi];
            if (!w || !w.isMesh || !w.material) continue;
            const mats = Array.isArray(w.material) ? w.material : [w.material];
            for (let mi = 0; mi < mats.length; mi++) {
              const mat = mats[mi];
              if (!mat) continue;
              const canPatch = !!(mat.isMeshPhysicalMaterial || mat.isMeshStandardMaterial);
              if (!canPatch) continue;
              if (!_hasReceiverSoftPatch(mat)) return true;
            }
          }
        }
      }

      if (wantModels) {
        const sg = getSceneGroup();
        if (sg && sg.traverse) {
          let need = false;
          sg.traverse((obj) => {
            if (need) return;
            if (!obj || !obj.isMesh || !obj.receiveShadow) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (let mi = 0; mi < mats.length; mi++) {
              const mat = mats[mi];
              if (!mat) continue;
              const canPatch = !!(mat.isMeshPhysicalMaterial || mat.isMeshStandardMaterial);
              if (!canPatch) continue;
              if (!_hasReceiverSoftPatch(mat)) { need = true; return; }
            }
          });
          if (need) return true;
        }
      }
      return false;
    } catch (_e) {
      return false;
    }
  }

  function _receiverWallsSignature() {
    try {
      const walls = getWalls();
      if (!walls || !Array.isArray(walls)) return 'nw';
      const ids = [];
      for (let wi = 0; wi < walls.length; wi++) {
        const w = walls[wi];
        if (!w || !w.isMesh || !w.material) continue;
        const mats = Array.isArray(w.material) ? w.material : [w.material];
        for (let mi = 0; mi < mats.length; mi++) {
          const mat = mats[mi];
          if (!mat) continue;
          ids.push(String(mat.uuid || ('idx' + wi + '_' + mi)));
        }
      }
      ids.sort();
      return ids.join('|');
    } catch (_e) {
      return 'errw';
    }
  }

  function _receiverModelsSignature() {
    try {
      const sg = getSceneGroup();
      if (!sg || !sg.traverse) return 'nm';
      const ids = [];
      sg.traverse((obj) => {
        if (!obj || !obj.isMesh || !obj.receiveShadow) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (let mi = 0; mi < mats.length; mi++) {
          const mat = mats[mi];
          if (!mat) continue;
          ids.push(String(mat.uuid || ('midx' + mi)));
        }
      });
      ids.sort();
      return ids.join('|');
    } catch (_e) {
      return 'errm';
    }
  }

  /**
   * 地面脚印圆盘：旧版用水平 AABB 外接圆 (0.5*max(sx,sz))，头像等竖高网格会把整头宽度当“脚”，补丁过大。
   * 优先用「底部一条带」内顶点在 xz 上的包围盒，再混合内外接圆；无几何或蒙皮实例则退回较紧的 AABB 混合半径。
   * @returns {{ cx: number, cz: number, r: number } | null}
   */
  function _computeFootprintSphereOnGround(node, groundY, groundEps, tmpBox, tmpSize) {
    try {
      tmpBox.setFromObject(node);
      if (!tmpBox || tmpBox.isEmpty()) return null;
      const minY = (tmpBox.min && tmpBox.min.y != null) ? tmpBox.min.y : 1e9;
      if (minY > groundY + groundEps) return null;

      tmpBox.getSize(tmpSize);
      const sx = Math.abs(tmpSize.x);
      const sz = Math.abs(tmpSize.z);
      const tmpH = tmpBox.max.y - tmpBox.min.y;
      const bminY = tmpBox.min.y;
      const halfMin = 0.5 * Math.min(sx, sz);
      const halfMax = 0.5 * Math.max(sx, sz);
      const rFallback = Math.max(0.04, halfMax);

      let cx = 0.5 * (tmpBox.min.x + tmpBox.max.x);
      let cz = 0.5 * (tmpBox.min.z + tmpBox.max.z);
      // 比纯外接圆紧：长短轴混合（细长物体明显缩小）
      let r = Math.max(0.04, 0.62 * halfMin + 0.38 * halfMax);

      const geom = node.geometry;
      const canSampleVerts =
        geom &&
        geom.attributes &&
        geom.attributes.position &&
        !node.isSkinnedMesh &&
        !node.isInstancedMesh;

      if (canSampleVerts) {
        const posAttr = geom.attributes.position;
        const count = posAttr.count;
        const sliceH = Math.min(Math.max(tmpH * 0.14, 0.025), 0.11);
        const yCut = bminY + sliceH;
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        let nHit = 0;
        let sumX = 0.0;
        let sumZ = 0.0;
        const stride = Math.max(1, Math.floor(count / 14000));
        const m = node.matrixWorld;
        for (let vi = 0; vi < count; vi += stride) {
          _tmpFootprintV.fromBufferAttribute(posAttr, vi).applyMatrix4(m);
          if (_tmpFootprintV.y <= yCut + 1e-5) {
            const vx = _tmpFootprintV.x;
            const vz = _tmpFootprintV.z;
            if (vx < minX) minX = vx;
            if (vx > maxX) maxX = vx;
            if (vz < minZ) minZ = vz;
            if (vz > maxZ) maxZ = vz;
            sumX += vx;
            sumZ += vz;
            nHit++;
          }
        }
        if (nHit >= 3) {
          // 用底部顶点带的均值作为圆心，再取最大半径（对圆锥/圆柱底面更贴合，避免 bbox 中心偏移造成“补丁两侧冒出”）
          const inv = 1.0 / nHit;
          const cxMean = sumX * inv;
          const czMean = sumZ * inv;
          let maxD2 = 0.0;
          for (let vi = 0; vi < count; vi += stride) {
            _tmpFootprintV.fromBufferAttribute(posAttr, vi).applyMatrix4(m);
            if (_tmpFootprintV.y <= yCut + 1e-5) {
              const dx = _tmpFootprintV.x - cxMean;
              const dz = _tmpFootprintV.z - czMean;
              const d2 = dx * dx + dz * dz;
              if (d2 > maxD2) maxD2 = d2;
            }
          }
          const rr = Math.sqrt(Math.max(0.0, maxD2));
          if (rr > 1e-6) {
            cx = cxMean;
            cz = czMean;
            r = Math.min(rFallback, Math.max(0.04, rr));
          }
        } else if (nHit >= 2 && maxX > minX && maxZ > minZ) {
          // 退回：仍用底部顶点带 bbox 的内外接混合（比纯外接圆紧）
          const frx = 0.5 * (maxX - minX);
          const frz = 0.5 * (maxZ - minZ);
          cx = 0.5 * (minX + maxX);
          cz = 0.5 * (minZ + maxZ);
          const rBlend = 0.58 * Math.min(frx, frz) + 0.42 * Math.max(frx, frz);
          r = Math.min(rFallback, Math.max(0.04, rBlend));
        }
      }

      return { cx, cz, r };
    } catch (_eFp) {
      return null;
    }
  }

  // ---------- Shadow soft ground patch (consumer extracted) ----------
  function _fitRasterShadowFrustumForSceneGroup(lightOverride) {
    try {
      const mainLight = lightOverride || getMainLight();
      const sceneGroup = getSceneGroup();
      if (!mainLight || !mainLight.shadow || !mainLight.shadow.camera || !sceneGroup) return;
      const sh = mainLight.shadow;

      const box = new THREE.Box3();
      box.setFromObject(sceneGroup);
      if (box.isEmpty()) return;
      const size = new THREE.Vector3();
      box.getSize(size);
      try { box.expandByScalar(0.35); } catch (_e) {}
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      if (!(sphere.radius > 1e-4)) return;

      const lp = new THREE.Vector3();
      mainLight.getWorldPosition(lp);
      const dist = lp.distanceTo(sphere.center);
      const margin = 3.2;
      let desiredFar = Math.max(10, dist + sphere.radius + margin);

      let grazeMul = 1.0;
      try {
        const dir = new THREE.Vector3();
        if ((mainLight.isDirectionalLight || mainLight.isSpotLight) && mainLight.target) {
          mainLight.target.getWorldPosition(dir);
          dir.sub(lp).normalize();
        } else {
          dir.subVectors(sphere.center, lp).normalize();
        }
        const ay = Math.max(0.12, Math.min(1.0, Math.abs(dir.y)));
        grazeMul = Math.min(3.8, Math.max(1.0, 1.0 / ay));
      } catch (_eG) {}

      desiredFar *= (0.92 + 0.48 * grazeMul);

      const st = getLightState() || {};
      const radius = Number(st.radius) || 18;

      if (mainLight.isSpotLight) {
        const cap = Math.min(175, Math.max(70, radius * 2.75 + 38));
        sh.camera.far = Math.min(cap, Math.max(32, desiredFar * 1.14));
        const n = Math.max(0.18, Math.min(0.85, sh.camera.far * 0.012));
        sh.camera.near = Math.min(n, sh.camera.far * 0.06);
        sh.camera.updateProjectionMatrix();
      } else if (mainLight.isPointLight) {
        const cap = Math.min(175, Math.max(70, radius * 2.75 + 38));
        sh.camera.far = Math.min(cap, Math.max(32, desiredFar * 1.18));
        sh.camera.near = Math.max(0.22, Math.min(1.2, sh.camera.far * 0.015));
        sh.camera.updateProjectionMatrix();
      } else if (mainLight.isDirectionalLight) {
        const capF = Math.min(125, radius * 4.2 + 58);
        sh.camera.far = Math.min(capF, Math.max(28, desiredFar + 18));
        sh.camera.near = Math.max(0.6, Math.min(2.2, sh.camera.far * 0.03));
        try {
          const cam = sh.camera;
          const heAuto = (Math.max(size.x, size.z) * 0.72 + 6.5) * Math.min(2.6, Math.max(1.0, 0.75 + 0.35 * grazeMul));
          const he = Math.max(18, Math.min(78, heAuto));
          cam.left = -he; cam.right = he; cam.top = he; cam.bottom = -he;
        } catch (_eHe) {}
        sh.camera.updateProjectionMatrix();
      }
    } catch (_e) {}
  }

  function syncGroundShadowUniforms() {
    try {
      if (!previewEnabled) return;
      // Keep shadowMap type stable in preview mode.
      // Some hosts may switch shadowMap.type during light moves; PCFSoft ignores shadowRadius in r164,
      // which would make our distance-based softening appear “hard”.
      try {
        const renderer = getRenderer();
        if (renderer && renderer.shadowMap) {
          if (renderer.shadowMap.enabled && renderer.shadowMap.type !== THREE.PCFShadowMap) {
            renderer.shadowMap.type = THREE.PCFShadowMap;
            renderer.shadowMap.needsUpdate = true;
          }
        }
      } catch (_eSmType) {}
      const mainLight = getMainLight();
      const ground = getGround();
      const sceneGroup = getSceneGroup();
      if (!mainLight || !ground || !ground.material || !ground.material.userData) return;
      const ud = ground.material.userData;
      if (!ud.uSolidMainLightPos || !ud.uSolidMainLightDir || !ud.uSolidMainLightType) return;
      if (ud.uSolidContactPatchEnable) ud.uSolidContactPatchEnable.value = _contactPatchEnabled() ? 1.0 : 0.0;
      if (ud.uSolidSphereDebug) ud.uSolidSphereDebug.value = _contactPatchDebugAllEnabled() ? 1.0 : 0.0;
      if (ud.uSolidDbgForceRed) ud.uSolidDbgForceRed.value = _contactPatchForceRedEnabled() ? 1.0 : 0.0;

      // Deterministic auto-heal:
      // - immediate re-arm when receiver material signature changes
      // - throttled safety check for unexpected missing patch
      try {
        if (!_receiverEnsureBusy) {
          const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const mainLight = getMainLight();
          const isDir = !!(mainLight && mainLight.isDirectionalLight);
          const wantWalls = _receiverSoftShadowWallsEnabled();
          const wantModels = _receiverSoftShadowModelsEnabled();
          let changed = false;

          if (!isDir && wantWalls) {
            const sigW = _receiverWallsSignature();
            if (sigW !== _receiverWallsSigLast) {
              _receiverWallsSigLast = sigW;
              changed = true;
            }
          }
          if (!isDir && wantModels) {
            const sigM = _receiverModelsSignature();
            if (sigM !== _receiverModelsSigLast) {
              _receiverModelsSigLast = sigM;
              changed = true;
            }
          }

          const needByThrottle = (now - _receiverPatchLastEnsureAt) > 380 && _shouldEnsureReceiverSoftPatch();
          if (changed || needByThrottle) {
            _receiverEnsureBusy = true;
            try { syncShadows(); } catch (_eReSync) {}
            _receiverPatchLastEnsureAt = now;
            _receiverEnsureBusy = false;
          }
        }
      } catch (_eEnsure) {}

      const lp = new THREE.Vector3();
      mainLight.getWorldPosition(lp);
      ud.uSolidMainLightPos.value.copy(lp);
      if (mainLight.isPointLight) ud.uSolidMainLightType.value = 2;
      else if (mainLight.isSpotLight) ud.uSolidMainLightType.value = 1;
      else ud.uSolidMainLightType.value = 0;

      const d = new THREE.Vector3(0, 1, 0);
      if (ud.uSolidMainLightType.value === 0 && mainLight.target) {
        const t = new THREE.Vector3();
        mainLight.target.getWorldPosition(t);
        d.subVectors(lp, t).normalize();
      }
      ud.uSolidMainLightDir.value.copy(d);

      // Keep sphere-based occlusion data up-to-date every frame.
      // IMPORTANT: this must NOT be limited to builtin spheres; otherwise only spheres get “contact seam” protection.
      // We approximate near-ground casters as spheres on the ground plane (xz footprint).
      if (ud.uSolidSphereCenters && ud.uSolidSphereRadii && ud.uSolidSphereCount) {
        let n = 0;
        let nBuiltin = 0;
        const tmpBox = new THREE.Box3();
        const tmpSize = new THREE.Vector3();
        const tmpCenter = new THREE.Vector3();
        const tmpPos = new THREE.Vector3();
        const tmpScale = new THREE.Vector3();
        const groundY = (ground && ground.position) ? ground.position.y : 0;
        const epsY = 0.12; // tolerant: many assets float slightly; keep in sync with syncShadows()
        // Manual traversal allows early-exit once we've got enough spheres.
        // We do two passes in one walk: (1) builtin spheres (exact center/radius), (2) other near-ground casters (footprint spheres).
        if (sceneGroup) {
          const stack = [sceneGroup];
          const otherCandidates = [];
          while (stack.length) {
            const node = stack.pop();
            if (!node) continue;
            const children = node.children;
            if (children && children.length) {
              for (let i = 0; i < children.length; i++) stack.push(children[i]);
            }
            if (!node.isMesh) continue;
            if (!node.castShadow) continue;

            // Pass #1: keep builtin spheres exact (historical behavior: fixes sphere shadow position/size).
            try {
              if (node.userData && node.userData.type === 'builtin' && node.userData.shape === 'sphere') {
                if (n < 8) {
                  node.getWorldPosition(tmpPos);
                  node.getWorldScale(tmpScale);
                  const r = Math.max(0.0001, Math.abs(tmpScale.y) * 2.0); // SphereGeometry radius=2
                  ud.uSolidSphereCenters.value[n].copy(tmpPos);
                  ud.uSolidSphereRadii.value[n] = r;
                  n++;
                  nBuiltin++;
                }
                continue;
              }
            } catch (_eBs) {}

            // Pass #2: collect others for footprint approximation (filled after spheres).
            if (n < 8) otherCandidates.push(node);
          }

          for (let i = 0; i < otherCandidates.length && n < 8; i++) {
            const node = otherCandidates[i];
            try {
              const fp = _computeFootprintSphereOnGround(node, groundY, epsY, tmpBox, tmpSize);
              if (!fp) continue;
              ud.uSolidSphereCenters.value[n].set(fp.cx, groundY, fp.cz);
              ud.uSolidSphereRadii.value[n] = fp.r;
              n++;
            } catch (_eS) {}
          }
        }
        ud.uSolidSphereCount.value = n;
        if (ud.uSolidBuiltinSphereCount) ud.uSolidBuiltinSphereCount.value = nBuiltin;
      }
    } catch (_e) {}
  }

  function syncShadows() {
    try {
      if (!previewEnabled) return;
      const renderer = getRenderer();
      const scene = getScene();
      const mainLight = getMainLight();
      const ground = getGround();
      const sceneGroup = getSceneGroup();
      const walls = getWalls();

      if (!renderer || !scene || !mainLight) return;
      if (!renderer.shadowMap) return;

      const isMobile = !!getIsMobile();
      const isIosHost = !!getIsIosHost();
      const st = getLightState() || {};

      const dbg = _rasterShadowDbgEnabled();

      const clearGroundSoftPatch = () => {
        try {
          if (!ground || !ground.material) return;
          const m0 = ground.material;
          // three.js built-in `customProgramCacheKey()` may call `onBeforeCompile.toString()`;
          // never set it to undefined, or MeshPhysicalMaterial may crash at render time.
          if (m0.onBeforeCompile) m0.onBeforeCompile = function() {};
          if (m0.userData) {
            delete m0.userData.uSolidShadowAnchorCount;
            delete m0.userData.uSolidShadowAnchors;
            delete m0.userData.uSolidShadowSoftRange;
            delete m0.userData.uSolidShadowSoftStrength;
            delete m0.userData.uSolidShadowSoftExp;
            delete m0.userData.uSolidContactPatchEnable;
            delete m0.userData.uSolidBuiltinSphereCount;
            delete m0.userData._solidShadowSoftVer;
          }
          if (m0.customProgramCacheKey) delete m0.customProgramCacheKey;
          if (m0.defines) {
            delete m0.defines.SOLID_SHADOW_SOFT_GROUND;
            delete m0.defines.SOLID_SHADOW_SOFT_GROUND_VER;
          }
          m0.needsUpdate = true;
        } catch (_eClr) {}
      };

      if ((mainLight && mainLight.isRectAreaLight) || !mainLight.shadow) {
        renderer.shadowMap.enabled = false;
        renderer.shadowMap.needsUpdate = true;
        try { mainLight.castShadow = false; } catch (_e) {}
        clearGroundSoftPatch();
        if (dbg) log('[RasterShadowSoft] skip: rect/no-shadow light');
        return;
      }

      renderer.shadowMap.enabled = true;
      // IMPORTANT: three r164 `SHADOWMAP_TYPE_PCF_SOFT` ignores `shadowRadius`.
      // Our “distance-based blur” is implemented by scaling `shadowRadius` inside getShadow/getPointShadow,
      // so we must use PCFShadowMap here to make the blur visible.
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.shadowMap.needsUpdate = true;
      try { renderer.shadowMap.needsUpdate = true; } catch (_e) {}
      try { if (typeof window !== 'undefined' && window._solidFallbackRenderAt !== undefined) window._solidFallbackRenderAt = 0; } catch (_eFb) {}

      // Physical: point/directional/spot cast shadows on themselves (no shadow proxy light).
      mainLight.castShadow = true;
      const shadowLight = mainLight;
      const sh = shadowLight.shadow;
      const ms = isMobile ? 3072 : 4096;
      const range = Math.min(175, Math.max(96, (Number(st.radius) || 18) * 2.75 + 48));

      if (shadowLight.isSpotLight) {
        sh.mapSize.set(ms, ms);
        // Keep raster shadow kernel stable (avoid patterning on some GPUs).
        // Softness for Spot is handled by our ground shader gaussian PCF.
        sh.radius = 1.4;
        sh.blurSamples = 18;
        sh.camera.near = Math.max(0.26, Math.min(0.6, (Number(st.radius) || 18) * 0.016));
        sh.camera.far = range;
        sh.camera.updateProjectionMatrix();
      } else if (shadowLight.isDirectionalLight) {
        sh.mapSize.set(ms, ms);
        sh.radius = 1.4;
        sh.blurSamples = 18;
        const cam = sh.camera;
        const he = isMobile ? 26 : 32;
        cam.near = 1.3;
        cam.far = Math.min(125, (Number(st.radius) || 18) * 4.2 + 58);
        cam.left = -he; cam.right = he; cam.top = he; cam.bottom = -he;
        cam.updateProjectionMatrix();
      } else if (shadowLight.isPointLight) {
        // Point/cube shadow: increase resolution to reduce aliasing on model surfaces.
        const pms = isMobile ? 1536 : 2048;
        sh.mapSize.set(pms, pms);
        sh.radius = 2.2;
        sh.blurSamples = 24;
        // Tighter near/far to improve depth precision and reduce banding/slice artifacts.
        sh.camera.near = Math.max(0.15, Math.min(1.2, (Number(st.radius) || 18) * 0.02));
        sh.camera.far = range;
        sh.camera.updateProjectionMatrix();
      }

      try { if (sceneGroup) sceneGroup.updateMatrixWorld(true); } catch (_eMw) {}
      _fitRasterShadowFrustumForSceneGroup(shadowLight);

      const _nbBoost = isMobile ? 1.9 : (isIosHost ? 1.4 : 1.0);
      if (shadowLight.isSpotLight) {
        sh.bias = (isMobile || isIosHost) ? -0.000012 : -0.000006;
        // Tighten caster/receiver contact to suppress bright seam lines on pedestal/cylinders.
        sh.normalBias = 0.014 * _nbBoost;
        if (isMobile || isIosHost) sh.normalBias = Math.min(sh.normalBias, 0.022);
      } else if (shadowLight.isDirectionalLight) {
        sh.bias = (isMobile || isIosHost) ? -0.00005 : -0.000025;
        // Same tightening for directional shadows (ground + model receivers).
        sh.normalBias = 0.014 * _nbBoost;
      } else if (shadowLight.isPointLight) {
        // Point/cube shadow: textured surfaces are prone to shadow acne “interference stripes”.
        // Raise normalBias significantly for point lights to suppress self-shadow moiré.
        // (Contact gap is handled elsewhere; we prioritize removing model-surface artifacts here.)
        sh.bias = (isMobile || isIosHost) ? -0.00004 : -0.00003;
        sh.normalBias = (isMobile || isIosHost) ? 0.040 : 0.032;
      }

      if (ground) { ground.receiveShadow = true; ground.castShadow = false; }
      if (walls && Array.isArray(walls)) {
        walls.forEach(w => { if (w) { w.receiveShadow = true; w.castShadow = false; } });
      }
      if (sceneGroup && sceneGroup.traverse) {
        sceneGroup.traverse(obj => {
          if (!obj || !obj.isMesh) return;
          obj.receiveShadow = true;
          obj.castShadow = true;
        });
      }

      // Ground shader patch — keep behavior identical to consumer.
      try {
        if (ground && ground.material && mainLight && mainLight.castShadow) {
          const m = ground.material;
          const canPatch = !!(m.isMeshPhysicalMaterial || m.isMeshStandardMaterial);
          if (!canPatch) return;

          if (!m.userData) m.userData = {};
          if (!m.userData.uSolidShadowAnchorCount) m.userData.uSolidShadowAnchorCount = { value: 0 };
          if (!m.userData.uSolidShadowAnchors) m.userData.uSolidShadowAnchors = { value: Array.from({ length: 8 }, () => new THREE.Vector3(0, 0, 0)) };
          if (!m.userData.uSolidSphereCount) m.userData.uSolidSphereCount = { value: 0 };
          if (!m.userData.uSolidSphereCenters) m.userData.uSolidSphereCenters = { value: Array.from({ length: 8 }, () => new THREE.Vector3()) };
          if (!m.userData.uSolidSphereRadii) m.userData.uSolidSphereRadii = { value: new Float32Array(8) };
          // Sphere-based patch (reference implementation): apply only on ground, gated to dark-side.
          if (!m.userData.uSolidSpherePatchStrength) m.userData.uSolidSpherePatchStrength = { value: 0.95 };
          // Debug toggles (default OFF).
          if (!m.userData.uSolidSphereDebug) m.userData.uSolidSphereDebug = { value: 0.0 };
          if (!m.userData.uSolidDbgForceRed) m.userData.uSolidDbgForceRed = { value: 0.0 };
          m.userData.uSolidSphereDebug.value = _contactPatchDebugAllEnabled() ? 1.0 : 0.0;
          m.userData.uSolidDbgForceRed.value = _contactPatchForceRedEnabled() ? 1.0 : 0.0;
          if (!m.userData.uSolidMainLightType) m.userData.uSolidMainLightType = { value: 0 };
          if (!m.userData.uSolidMainLightPos) m.userData.uSolidMainLightPos = { value: new THREE.Vector3() };
          if (!m.userData.uSolidMainLightDir) m.userData.uSolidMainLightDir = { value: new THREE.Vector3(0, 1, 0) };
          if (!m.userData.uSolidShadowContactPull) m.userData.uSolidShadowContactPull = { value: 0.00065 };
          // Dark-side contact seam leak fix (ground-only; directional/spot use 2D shadow map).
          if (!m.userData.uSolidShadowSeamStrength) m.userData.uSolidShadowSeamStrength = { value: 0.85 };
          if (!m.userData.uSolidShadowSeamPush) m.userData.uSolidShadowSeamPush = { value: 0.00065 };
          if (!m.userData.uSolidShadowSeamRadius) m.userData.uSolidShadowSeamRadius = { value: 1.0 };
          // Scheme A: direction-locked narrow wedge patch (ground-only).
          if (!m.userData.uSolidWedgeEnable) m.userData.uSolidWedgeEnable = { value: 1.0 };
          if (!m.userData.uSolidWedgeStrength) m.userData.uSolidWedgeStrength = { value: 0.65 };
          if (!m.userData.uSolidWedgeWidth) m.userData.uSolidWedgeWidth = { value: 0.18 };
          if (!m.userData.uSolidWedgeLength) m.userData.uSolidWedgeLength = { value: 0.90 };
          if (!m.userData.uSolidWedgeDebug) m.userData.uSolidWedgeDebug = { value: 0.0 };
          if (!m.userData.uSolidShadowSoftRange) m.userData.uSolidShadowSoftRange = { value: new THREE.Vector4(2.8, 28.0, 2.8, 7.8) };
          if (!m.userData.uSolidShadowSoftStrength) m.userData.uSolidShadowSoftStrength = { value: 16.0 };
          if (!m.userData.uSolidShadowSoftExp) m.userData.uSolidShadowSoftExp = { value: 2.25 };
          if (!m.userData.uSolidContactPatchEnable) m.userData.uSolidContactPatchEnable = { value: 1.0 };
          if (!m.userData.uSolidBuiltinSphereCount) m.userData.uSolidBuiltinSphereCount = { value: 0 };
          m.userData.uSolidContactPatchEnable.value = _contactPatchEnabled() ? 1.0 : 0.0;

          m.userData._solidShadowSoftVer = (m.userData._solidShadowSoftVer || 0) + 1;
          const _ver = m.userData._solidShadowSoftVer;
          m.customProgramCacheKey = function() { return 'solid_shadow_soft_ground_v' + _ver; };
          if (!m.defines) m.defines = {};
          m.defines.SOLID_SHADOW_SOFT_GROUND = 1;
          m.defines.SOLID_SHADOW_SOFT_GROUND_VER = _ver;

          // bbox metrics (shared by anchors & softening params)
          let diagXZ = 12.0;
          let heightY = 2.0;
          try {
            if (sceneGroup) {
              const gbox = new THREE.Box3();
              const gsz = new THREE.Vector3();
              gbox.setFromObject(sceneGroup);
              gbox.getSize(gsz);
              diagXZ = Math.max(1.0, Math.sqrt(gsz.x * gsz.x + gsz.z * gsz.z));
              heightY = Math.max(0.25, Number(gsz.y) || 0.25);
            }
          } catch (_eGsz) {}

          // anchors
          try {
            const anchors = m.userData.uSolidShadowAnchors.value;
            const box = new THREE.Box3();
            const c = new THREE.Vector3();
            let nA = 0;
            const groundY = (ground && ground.position) ? ground.position.y : 0;
            // More tolerant: many assets are not perfectly snapped to ground, but we still want anchors.
            const epsY = 0.035;
            if (sceneGroup && sceneGroup.traverse) {
              sceneGroup.traverse((obj) => {
                if (nA >= 8) return;
                if (!obj || !obj.isMesh) return;
                if (!obj.castShadow) return;
                try {
                  box.setFromObject(obj);
                  const minY = (box.min && box.min.y != null) ? box.min.y : 1e9;
                  // Accept meshes that are touching or slightly above/below the ground plane.
                  if (Math.abs(minY - groundY) > epsY && (minY > groundY + epsY)) return;
                  box.getCenter(c);
                  anchors[nA].set(c.x, groundY, c.z);
                  nA++;
                } catch (_eB) {}
              });
            }
            m.userData.uSolidShadowAnchorCount.value = nA;
          } catch (_eA) { try { m.userData.uSolidShadowAnchorCount.value = 0; } catch (_eA2) {} }

          try {
            const mob = (isMobile || isIosHost);
            // Point light uses cube shadow sampling; modifying shadowCoord.z can introduce “slice / sheet” artifacts.
            // Keep contact pull effectively disabled for point lights; sphere occlusion still handles the historical bright-spot case.
            if (mainLight && mainLight.isPointLight) m.userData.uSolidShadowContactPull.value = 0.0;
            else if (mainLight && mainLight.isDirectionalLight) m.userData.uSolidShadowContactPull.value = mob ? 0.00085 : 0.00065;
            else {
              // Spot: small pull to prevent dark-side “contact leak”.
              // iOS/iPad tends to show the gap more due to precision/bias, so give it a bit more.
              if (isIosHost) m.userData.uSolidShadowContactPull.value = 0.00044;
              else m.userData.uSolidShadowContactPull.value = mob ? 0.00030 : 0.00022;
            }
          } catch (_ePull) {}

          // seam fix defaults (keep conservative; only ground)
          try {
            const mob = (isMobile || isIosHost);
            // More push on iOS/mobile where precision tends to show gaps.
            // iPad tends to show jagged seam leaks: use slightly larger radius and push.
            m.userData.uSolidShadowSeamPush.value = isIosHost ? 0.00145 : (mob ? 0.00105 : 0.00065);
            m.userData.uSolidShadowSeamStrength.value = mob ? 0.92 : 0.85;
            m.userData.uSolidShadowSeamRadius.value = isIosHost ? 1.35 : 1.0;
          } catch (_eSeamCfg) {}

          // wedge patch defaults (keep OFF by default; we are switching to sphere-based patch)
          try {
            m.userData.uSolidWedgeEnable.value = 0.0;
            m.userData.uSolidWedgeDebug.value = 0.0;
          } catch (_eWdg) {}

          // softening curve parameters (per light type; keep independent)
          try {
            const isPoint = !!(mainLight && mainLight.isPointLight);
            const cfg = isPoint ? RASTER_SHADOW_SOFT_PARAMS.point : RASTER_SHADOW_SOFT_PARAMS.dirSpot;
            const str = (isMobile || isIosHost) ? cfg.strengthMobile : cfg.strengthDesktop;
            m.userData.uSolidShadowSoftStrength.value = str;
            m.userData.uSolidShadowSoftExp.value = cfg.exp;
            // Keep uSolidShadowSoftRange as the “distance ramp” (x=start, y=end). z/w retained for backward compat.
            try {
              // Use model height as baseline (more intuitive than diagXZ for typical 20cm–50cm assets).
              // start/end are in ground-plane distance units.
              const start = heightY * (Number(cfg.startH) || 0.25);
              const end = heightY * (Number(cfg.endH) || 3.0);
              const near0 = diagXZ * 0.02;
              const near1 = diagXZ * 0.10;
              m.userData.uSolidShadowSoftRange.value.set(start, end, near0, near1);
            } catch (_eSR) {}

            if (dbg) {
              try {
                const lt = isPoint ? 'point' : ((mainLight && mainLight.isDirectionalLight) ? 'dir' : 'spot');
                const r = m.userData.uSolidShadowSoftRange && m.userData.uSolidShadowSoftRange.value ? m.userData.uSolidShadowSoftRange.value : null;
                const msg = `[RasterShadowSoft][dbg] lt=${lt} anchors=${m.userData.uSolidShadowAnchorCount.value} heightY=${heightY.toFixed(3)} diagXZ=${diagXZ.toFixed(3)} start=${r ? r.x.toFixed(3) : '?'} end=${r ? r.y.toFixed(3) : '?'} exp=${m.userData.uSolidShadowSoftExp.value} strength=${m.userData.uSolidShadowSoftStrength.value}`;
                try { log(msg); } catch (_eLg) {}
                try { if (typeof window !== 'undefined' && typeof window.hwLog === 'function') window.hwLog(msg); } catch (_eHw) {}
                try { if (typeof console !== 'undefined' && console.log) console.log(msg); } catch (_eCon) {}
              } catch (_eDbg0) {}
            }
          } catch (_eSoftCfg) {}

          // light info
          try {
            const lp = new THREE.Vector3();
            mainLight.getWorldPosition(lp);
            m.userData.uSolidMainLightPos.value.copy(lp);
            if (mainLight && mainLight.isPointLight) m.userData.uSolidMainLightType.value = 2;
            else if (mainLight && mainLight.isSpotLight) m.userData.uSolidMainLightType.value = 1;
            else m.userData.uSolidMainLightType.value = 0;
            const d = new THREE.Vector3(0, 1, 0);
            if (m.userData.uSolidMainLightType.value === 0) {
              if (mainLight && mainLight.target) {
                const t = new THREE.Vector3();
                mainLight.target.getWorldPosition(t);
                d.subVectors(lp, t).normalize();
              }
            }
            m.userData.uSolidMainLightDir.value.copy(d);
          } catch (_eL) {}

          // spheres（与 syncGroundShadowUniforms 相同：builtin 优先，再其它近地投射体；脚印半径见 _computeFootprintSphereOnGround）
          try {
            let n = 0;
            let nBuiltin = 0;
            const tmpPos = new THREE.Vector3();
            const tmpScale = new THREE.Vector3();
            const tmpBox = new THREE.Box3();
            const tmpSize = new THREE.Vector3();
            const tmpCenter = new THREE.Vector3();
            const groundY = (ground && ground.position) ? ground.position.y : 0;
            const epsY = 0.12; // tolerant: many assets float slightly; keep in sync with syncGroundShadowUniforms()
            if (sceneGroup) {
              const stack = [sceneGroup];
              const otherCandidates = [];
              while (stack.length) {
                const node = stack.pop();
                if (!node) continue;
                const children = node.children;
                if (children && children.length) {
                  for (let ci = 0; ci < children.length; ci++) stack.push(children[ci]);
                }
                if (!node.isMesh) continue;
                if (!node.castShadow) continue;
                try {
                  if (node.userData && node.userData.type === 'builtin' && node.userData.shape === 'sphere') {
                    if (n < 8) {
                      node.getWorldPosition(tmpPos);
                      node.getWorldScale(tmpScale);
                      const r0 = Math.max(0.0001, Math.abs(tmpScale.y) * 2.0);
                      m.userData.uSolidSphereCenters.value[n].copy(tmpPos);
                      m.userData.uSolidSphereRadii.value[n] = r0;
                      n++;
                      nBuiltin++;
                    }
                    continue;
                  }
                } catch (_eBs) {}
                if (n < 8) otherCandidates.push(node);
              }
              for (let si = 0; si < otherCandidates.length && n < 8; si++) {
                const node = otherCandidates[si];
                try {
                  const fp = _computeFootprintSphereOnGround(node, groundY, epsY, tmpBox, tmpSize);
                  if (!fp) continue;
                  m.userData.uSolidSphereCenters.value[n].set(fp.cx, groundY, fp.cz);
                  m.userData.uSolidSphereRadii.value[n] = fp.r;
                  n++;
                } catch (_eS) {}
              }
            }
            m.userData.uSolidSphereCount.value = n;
            m.userData.uSolidBuiltinSphereCount.value = nBuiltin;
          } catch (_eSc) {
            try { m.userData.uSolidSphereCount.value = 0; } catch (_e2) {}
            try { m.userData.uSolidBuiltinSphereCount.value = 0; } catch (_e3) {}
          }

          m.onBeforeCompile = (shader) => {
            let fs = shader.fragmentShader;
            let cnt = 0;
            if (cnt <= 0) {
              try {
                const inc = '#include <shadowmap_pars_fragment>';
                if (fs.includes(inc) && THREE.ShaderChunk && THREE.ShaderChunk.shadowmap_pars_fragment) {
                  let chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
                  // GLSL ES requires all declarations before statements.
                  // We rename original shadow functions and append wrappers that scale `shadowRadius`
                  // based on distance-to-model-footprint, then call the originals.
                  chunk = chunk.replace(
                    'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {',
                    'float getShadow_orig( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {'
                  );
                  chunk = chunk.replace(
                    'float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {',
                    'float getPointShadow_orig( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {'
                  );

                  // 自定义代码必须插在 shadowmap_pars_fragment 最外层 #ifdef USE_SHADOWMAP 的 **最后一个 #endif 之前**。
                  // 若用 chunk += 接在 #endif 之后，WebGL2/GLSL300 下 texture2DCompare 等会脱离块作用域，片元编译失败 → 地面全黑。
                  const solidShadowSoftAppend =
                    '\n\nfloat solidHash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }\n' +
                    'mat2 solidRot2( float a ) { float s = sin( a ), c = cos( a ); return mat2( c, -s, s, c ); }\n' +
                    'float solidWedgeMaskAtAnchor( vec2 p, vec2 a, vec2 dirXZ, float halfW, float len ) {\n' +
                    '\tvec2 d = p - a;\n' +
                    '\tfloat u = dot( d, dirXZ );\n' +
                    '\tfloat v = dot( d, vec2( -dirXZ.y, dirXZ.x ) );\n' +
                    '\tfloat side = smoothstep( 0.0, -len, u );\n' +
                    '\tfloat band = 1.0 - smoothstep( halfW, halfW * 1.6, abs( v ) );\n' +
                    '\treturn side * band;\n' +
                    '}\n' +
                    'float solidWedgeRawMask( vec2 dirXZ ) {\n' +
                    '\tfloat halfW = max( 0.001, uSolidWedgeWidth * 0.5 );\n' +
                    '\tfloat len = max( 0.001, uSolidWedgeLength );\n' +
                    '\tfloat m = 0.0;\n' +
                    '\tfor ( int i = 0; i < 8; i++ ) {\n' +
                    '\t\tif ( i >= uSolidShadowAnchorCount ) break;\n' +
                    '\t\tm = max( m, solidWedgeMaskAtAnchor( vSolidShadowGroundPos.xz, uSolidShadowAnchors[i].xz, dirXZ, halfW, len ) );\n' +
                    '\t}\n' +
                    '\treturn m;\n' +
                    '}\n' +
                    'float solidShadowAvgGate2D( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, vec4 shadowCoord ) {\n' +
                    '\tvec3 sc = shadowCoord.xyz / shadowCoord.w;\n' +
                    '\tsc.z += shadowBias;\n' +
                    '\tif ( sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 ) return 0.0;\n' +
                    '\tvec2 texel = vec2( 1.0 ) / shadowMapSize;\n' +
                    '\tfloat c0 = texture2DCompare( shadowMap, sc.xy, sc.z );\n' +
                    '\tfloat c1 = texture2DCompare( shadowMap, sc.xy + vec2( texel.x, 0.0 ), sc.z );\n' +
                    '\tfloat c2 = texture2DCompare( shadowMap, sc.xy - vec2( texel.x, 0.0 ), sc.z );\n' +
                    '\tfloat c3 = texture2DCompare( shadowMap, sc.xy + vec2( 0.0, texel.y ), sc.z );\n' +
                    '\tfloat c4 = texture2DCompare( shadowMap, sc.xy - vec2( 0.0, texel.y ), sc.z );\n' +
                    '\tfloat avg = ( c0 + c1 + c2 + c3 + c4 ) * 0.2;\n' +
                    '\treturn clamp( ( 0.92 - avg ) / 0.30, 0.0, 1.0 );\n' +
                    '}\n' +
                    'float solidApplyWedgePatch2D( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, vec4 shadowCoord, float sh0 ) {\n' +
                    '\tif ( uSolidContactPatchEnable < 0.5 ) return sh0;\n' +
                    '\tif ( uSolidWedgeEnable < 0.5 ) return sh0;\n' +
                    '\tvec2 dirXZ;\n' +
                    '\tif ( uSolidMainLightType == 0 ) {\n' +
                    '\t\tdirXZ = normalize( vec2( uSolidMainLightDir.x, uSolidMainLightDir.z ) );\n' +
                    '\t} else {\n' +
                    '\t\tvec2 d = normalize( uSolidMainLightPos.xz - vSolidShadowGroundPos.xz );\n' +
                    '\t\tdirXZ = d;\n' +
                    '\t}\n' +
                    '\tif ( dot( dirXZ, dirXZ ) < 1e-6 ) return sh0;\n' +
                    '\tfloat m = solidWedgeRawMask( dirXZ );\n' +
                    '\tif ( m <= 1e-5 ) return sh0;\n' +
                    '\tfloat gate = solidShadowAvgGate2D( shadowMap, shadowMapSize, shadowBias, shadowCoord );\n' +
                    '\tfloat k = clamp( uSolidWedgeStrength, 0.0, 1.0 ) * gate;\n' +
                    '\treturn clamp( sh0 * ( 1.0 - k * m ), 0.0, 1.0 );\n' +
                    '}\n' +
                    'float solidSeamFix2D( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, vec4 shadowCoord, float sh0 ) {\n' +
                    '\tif ( uSolidContactPatchEnable < 0.5 ) return sh0;\n' +
                    '\t// sh0: 1=lit, 0=shadow. Only darken thin bright seams near shadow boundary.\n' +
                    '\tfloat k = clamp( uSolidShadowSeamStrength, 0.0, 1.0 );\n' +
                    '\tif ( k <= 0.0001 ) return sh0;\n' +
                    '\tvec3 sc = shadowCoord.xyz / shadowCoord.w;\n' +
                    '\t// IMPORTANT: decide gate WITHOUT push (avoid lit-side black rim).\n' +
                    '\tvec3 sc0 = sc;\n' +
                    '\tsc0.z += shadowBias;\n' +
                    '\tif ( sc0.x < 0.0 || sc0.x > 1.0 || sc0.y < 0.0 || sc0.y > 1.0 || sc0.z > 1.0 ) return sh0;\n' +
                    '\tvec2 texel = vec2( 1.0 ) / shadowMapSize;\n' +
                    '\tfloat r = clamp( uSolidShadowSeamRadius, 0.5, 2.5 );\n' +
                    '\tvec2 dx = vec2( r, 0.0 ) * texel;\n' +
                    '\tvec2 dy = vec2( 0.0, r ) * texel;\n' +
                    '\tfloat c0 = texture2DCompare( shadowMap, sc0.xy, sc0.z );\n' +
                    '\tfloat c1 = texture2DCompare( shadowMap, sc0.xy + dx, sc0.z );\n' +
                    '\tfloat c2 = texture2DCompare( shadowMap, sc0.xy - dx, sc0.z );\n' +
                    '\tfloat c3 = texture2DCompare( shadowMap, sc0.xy + dy, sc0.z );\n' +
                    '\tfloat c4 = texture2DCompare( shadowMap, sc0.xy - dy, sc0.z );\n' +
                    '\tfloat cMin = min( c0, min( c1, min( c2, min( c3, c4 ) ) ) );\n' +
                    '\tfloat avg = ( c0 + c1 + c2 + c3 + c4 ) * 0.2;\n' +
                    '\tfloat gN = clamp( ( 0.995 - cMin ) / 0.20, 0.0, 1.0 );\n' +
                    '\tfloat gA = clamp( ( 0.93 - avg ) / 0.30, 0.0, 1.0 );\n' +
                    '\tfloat gLegacy = gN * gA;\n' +
                    '\t// Edge gate: only patch on real shadow boundary (max local contrast in 4-neighborhood).\n' +
                    '\tfloat e0 = max( abs( c0 - c1 ), abs( c0 - c2 ) );\n' +
                    '\tfloat e1 = max( abs( c0 - c3 ), abs( c0 - c4 ) );\n' +
                    '\tfloat edge = max( e0, e1 );\n' +
                    '\tfloat gE = clamp( ( edge - 0.012 ) / 0.075, 0.0, 1.0 );\n' +
                    '\tfloat gate = max( gLegacy, gA * gE );\n' +
                    '\t// Only when gate passes, use pushed compare to aggressively close the seam.\n' +
                    '\tvec3 scP = sc0;\n' +
                    '\t// Adaptive push: stronger only where gate is strong (dark-side seam),\n' +
                    '\t// avoids over-darkening near lit-side boundary.\n' +
                    '\tfloat pPush = max( 0.0, uSolidShadowSeamPush ) * ( 0.35 + 0.65 * gate );\n' +
                    '\tscP.z += pPush;\n' +
                    '\t// Use 9-tap min (including diagonals) to fill jagged seam gaps on mobile.\n' +
                    '\tvec2 dd = ( dx + dy ) * 0.70710678;\n' +
                    '\tfloat p0 = texture2DCompare( shadowMap, scP.xy, scP.z );\n' +
                    '\tfloat p1 = texture2DCompare( shadowMap, scP.xy + dx, scP.z );\n' +
                    '\tfloat p2 = texture2DCompare( shadowMap, scP.xy - dx, scP.z );\n' +
                    '\tfloat p3 = texture2DCompare( shadowMap, scP.xy + dy, scP.z );\n' +
                    '\tfloat p4 = texture2DCompare( shadowMap, scP.xy - dy, scP.z );\n' +
                    '\tfloat p5 = texture2DCompare( shadowMap, scP.xy + dd, scP.z );\n' +
                    '\tfloat p6 = texture2DCompare( shadowMap, scP.xy - dd, scP.z );\n' +
                    '\tfloat p7 = texture2DCompare( shadowMap, scP.xy + vec2( dd.x, -dd.y ), scP.z );\n' +
                    '\tfloat p8 = texture2DCompare( shadowMap, scP.xy + vec2( -dd.x, dd.y ), scP.z );\n' +
                    '\tfloat pMin = min( p0, min( p1, min( p2, min( p3, min( p4, min( p5, min( p6, min( p7, p8 ) ) ) ) ) ) ) );\n' +
                    '\t// Contact-band gate (all casters): close thin bright seams near ground contact without affecting far tail.\n' +
                    '\tfloat mC = 0.0;\n' +
                    '\tfor ( int i = 0; i < 8; i++ ) {\n' +
                    '\t\tif ( i >= uSolidSphereCount ) break;\n' +
                    '\t\tfloat rC = max( 0.0001, uSolidSphereRadii[i] );\n' +
                    '\t\tfloat dC = length( vSolidShadowGroundPos.xz - uSolidSphereCenters[i].xz );\n' +
                    '\t\t// For large bases (big radius), widen contact band slightly to cover persistent underside bright seams.\n' +
                    '\t\tfloat isBig = step( 1.25, rC );\n' +
                    '\t\tfloat inMul = mix( 0.92, 0.84, isBig );\n' +
                    '\t\tfloat outMul = mix( 1.18, 1.34, isBig );\n' +
                    '\t\tfloat mm = 1.0 - smoothstep( rC * inMul, rC * outMul, dC );\n' +
                    '\t\tmm = mix( mm, pow( clamp( mm, 0.0, 1.0 ), 0.72 ), isBig );\n' +
                    '\t\tmC = max( mC, mm );\n' +
                    '\t}\n' +
                    '\tmC = clamp( mC, 0.0, 1.0 );\n' +
                    '\t// In contact leaks, avg may look "lit" while cMin still indicates nearby shadow.\n' +
                    '\t// Still require dark-side gate (gA) to avoid lit-side over-trigger (prevents "回潮").\n' +
                    '\tfloat gateC = gN * gA * mC;\n' +
                    '\tfloat gateAll = max( gate, gateC );\n' +
                    '\t// Slightly stronger closure in contact band.\n' +
                    '\tfloat k2 = k * ( 0.85 + 0.75 * mC );\n' +
                    '\treturn min( sh0, mix( sh0, pMin, k2 * gateAll ) );\n' +
                    '}\n' +
                    'float solidShadowSoftCompare( sampler2D shadowMap, vec2 uv, float compareZ, float smoothZ ) {\n' +
                    '\tfloat depth = unpackRGBAToDepth( texture2D( shadowMap, uv ) );\n' +
                    '\t// 1.0=lit, 0.0=shadow. smoothZ is in normalized shadow depth units.\n' +
                    '\treturn 1.0 - smoothstep( 0.0, smoothZ, compareZ - depth );\n' +
                    '}\n' +
                    'vec2 solidPoisson24( int i ) {\n' +
                    '\tif ( i == 0 ) return vec2( -0.326, -0.406 );\n' +
                    '\tif ( i == 1 ) return vec2( -0.840, -0.074 );\n' +
                    '\tif ( i == 2 ) return vec2( -0.696,  0.457 );\n' +
                    '\tif ( i == 3 ) return vec2( -0.203,  0.621 );\n' +
                    '\tif ( i == 4 ) return vec2(  0.962, -0.195 );\n' +
                    '\tif ( i == 5 ) return vec2(  0.473, -0.480 );\n' +
                    '\tif ( i == 6 ) return vec2(  0.519,  0.767 );\n' +
                    '\tif ( i == 7 ) return vec2(  0.185, -0.893 );\n' +
                    '\tif ( i == 8 ) return vec2(  0.507,  0.064 );\n' +
                    '\tif ( i == 9 ) return vec2(  0.896,  0.412 );\n' +
                    '\tif ( i == 10 ) return vec2( -0.322, -0.933 );\n' +
                    '\tif ( i == 11 ) return vec2( -0.792, -0.598 );\n' +
                    '\tif ( i == 12 ) return vec2( -0.043,  0.280 );\n' +
                    '\tif ( i == 13 ) return vec2( -0.155,  0.970 );\n' +
                    '\tif ( i == 14 ) return vec2(  0.252,  0.395 );\n' +
                    '\tif ( i == 15 ) return vec2( -0.444,  0.106 );\n' +
                    '\tif ( i == 16 ) return vec2(  0.727,  0.279 );\n' +
                    '\tif ( i == 17 ) return vec2(  0.395, -0.732 );\n' +
                    '\tif ( i == 18 ) return vec2( -0.600,  0.780 );\n' +
                    '\tif ( i == 19 ) return vec2(  0.043, -0.165 );\n' +
                    '\tif ( i == 20 ) return vec2(  0.143,  0.867 );\n' +
                    '\tif ( i == 21 ) return vec2(  0.675, -0.160 );\n' +
                    '\tif ( i == 22 ) return vec2( -0.325,  0.320 );\n' +
                    '\treturn vec2( -0.069, -0.492 );\n' +
                    '}\n' +
                    'float solidGaussianShadow2D( sampler2D shadowMap, vec2 shadowMapSize, vec4 shadowCoord, float shadowRadius, float shadowBias, float solidPullZ ) {\n' +
                    '\tfloat shadow = 1.0;\n' +
                    '\tvec3 sc = shadowCoord.xyz / shadowCoord.w;\n' +
                    '\t// IMPORTANT: apply bias/pull AFTER perspective divide to avoid “sheet/stripe” artifacts.\n' +
                    '\tvec3 sc0 = sc;\n' +
                    '\tsc0.z += shadowBias;\n' +
                    '\t// Two-worlds solution: only apply contact pull where the fragment is already in shadow.\n' +
                    '\t// This closes dark-side contact leaks without creating a lit-side dark ring.\n' +
                    '\tfloat applyPull = 0.0;\n' +
                    '\tif ( solidPullZ > 0.0 ) {\n' +
                    '\t\t// Use a small neighborhood min: closes tiny gaps in penumbra (esp. iPad precision)\n' +
                    '\t\tfloat c0 = texture2DCompare( shadowMap, sc0.xy, sc0.z );\n' +
                    '\t\tfloat c1 = texture2DCompare( shadowMap, sc0.xy + vec2( 0.5, 0.0 ) / shadowMapSize, sc0.z );\n' +
                    '\t\tfloat c2 = texture2DCompare( shadowMap, sc0.xy + vec2( 0.0, 0.5 ) / shadowMapSize, sc0.z );\n' +
                    '\t\tfloat cMin = min( c0, min( c1, c2 ) );\n' +
                    '\t\t// Continuous gate: strong in shadow/penumbra, fades to 0 when fully lit.\n' +
                    '\t\tapplyPull = clamp( ( 0.985 - cMin ) / 0.22, 0.0, 1.0 );\n' +
                    '\t}\n' +
                    '\tsc = sc0;\n' +
                    '\tsc.z += solidPullZ * applyPull;\n' +
                    '\tbool inFrustum = sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0;\n' +
                    '\tbool frustumTest = inFrustum && sc.z <= 1.0;\n' +
                    '\tif ( !frustumTest ) return 1.0;\n' +
                    '\tvec2 texel = vec2( 1.0 ) / shadowMapSize;\n' +
                    '\tfloat tapsF = clamp( uSolidShadowGaussTaps, 4.0, 32.0 );\n' +
                    '\tint taps = int( floor( tapsF + 0.5 ) );\n' +
                    '\tfloat ang = ( uSolidShadowGaussRotate > 0.5 ) ? ( 6.2831853 * solidHash12( vSolidShadowGroundPos.xz * 0.071 + sc.xy * shadowMapSize.xy * 0.17 ) ) : 0.0;\n' +
                    '\tmat2 R = solidRot2( ang );\n' +
                    '\tfloat sum = 0.0;\n' +
                    '\tfloat wsum = 0.0;\n' +
                    '\tfloat rMax = 1.85;\n' +
                    '\tfor ( int i = 0; i < 32; i++ ) {\n' +
                    '\t\tif ( i >= taps ) break;\n' +
                    '\t\tfloat fi = float(i);\n' +
                    '\t\tfloat t = (fi + 0.5) / max( 1.0, float(taps) );\n' +
                    '\t\t// Scale samples progressively to avoid “ring edge” in penumbra.\n' +
                    '\t\tvec2 o = ( R * solidPoisson24( i ) ) * sqrt( clamp( t, 0.001, 1.0 ) );\n' +
                    '\t\tvec2 uv = sc.xy + o * texel * shadowRadius;\n' +
                    '\t\tif ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) continue;\n' +
                    '\t\tfloat rr = dot( o, o );\n' +
                    '\t\tfloat w = exp( - rr * 2.4 );\n' +
                    '\t\tfloat hardTap = texture2DCompare( shadowMap, uv, sc.z );\n' +
                    '\t\tfloat softTap = solidShadowSoftCompare( shadowMap, uv, sc.z, 0.0018 );\n' +
                    '\t\t// Keep contact from getting brighter (no leak), but smooth the transition.\n' +
                    '\t\tfloat tap = min( hardTap, softTap );\n' +
                    '\t\tsum += w * tap;\n' +
                    '\t\twsum += w;\n' +
                    '\t}\n' +
                    '\tshadow = (wsum > 0.0) ? (sum / wsum) : 1.0;\n' +
                    '\treturn shadow;\n' +
                    '}\n' +
                    '\n' +
                    'float solidSphereOcclusionFaded( vec3 p ) {\n' +
                    '\tif ( uSolidSphereCount <= 0 ) return 1.0;\n' +
                    '\tfloat minEdge = 1e9;\n' +
                    '\tfloat nearR = 2.0;\n' +
                    '\tfor ( int i = 0; i < 8; i++ ) {\n' +
                    '\t\tif ( i >= uSolidSphereCount ) break;\n' +
                    '\t\tfloat r = max( 0.0001, uSolidSphereRadii[i] );\n' +
                    '\t\tfloat d = length( p.xz - uSolidSphereCenters[i].xz );\n' +
                    '\t\tfloat edge = max( 0.0, d - r );\n' +
                    '\t\tif ( edge < minEdge ) { minEdge = edge; nearR = r; }\n' +
                    '\t}\n' +
                    '\t// Narrower footprint than original (avoid lit-side dark rim):\n' +
                    '\tfloat k = 1.0 - smoothstep( nearR * 0.18, nearR * 0.95, minEdge );\n' +
                    '\tk = pow( clamp( k, 0.0, 1.0 ), 1.8 );\n' +
                    '\tfloat occ = solidSphereOcclusion( p );\n' +
                    '\treturn mix( 1.0, occ, k );\n' +
                    '}\n' +
                    'float solidSphereOcclusionBuiltin( vec3 p ) {\n' +
                    '\tif ( uSolidBuiltinSphereCount <= 0 ) return 1.0;\n' +
                    '\tfloat occ = 1.0;\n' +
                    '\tif ( uSolidMainLightType == 0 ) {\n' +
                    '\t\tvec3 rd = normalize( uSolidMainLightDir );\n' +
                    '\t\tfor ( int i = 0; i < 8; i++ ) {\n' +
                    '\t\t\tif ( i >= uSolidBuiltinSphereCount ) break;\n' +
                    '\t\t\tocc = min( occ, solidRaySphereOcc( p, rd, 1e6, uSolidSphereCenters[i], uSolidSphereRadii[i] ) );\n' +
                    '\t\t}\n' +
                    '\t} else {\n' +
                    '\t\tvec3 lp = uSolidMainLightPos;\n' +
                    '\t\tvec3 rd = normalize( lp - p );\n' +
                    '\t\tfloat tMax = length( lp - p );\n' +
                    '\t\tfor ( int i = 0; i < 8; i++ ) {\n' +
                    '\t\t\tif ( i >= uSolidBuiltinSphereCount ) break;\n' +
                    '\t\t\tocc = min( occ, solidRaySphereOcc( p, rd, tMax, uSolidSphereCenters[i], uSolidSphereRadii[i] ) );\n' +
                    '\t\t}\n' +
                    '\t}\n' +
                    '\treturn occ;\n' +
                    '}\n' +
                    'float solidSphereOcclusionFadedBuiltin( vec3 p ) {\n' +
                    '\tif ( uSolidBuiltinSphereCount <= 0 ) return 1.0;\n' +
                    '\tfloat minEdge = 1e9;\n' +
                    '\tfloat nearR = 2.0;\n' +
                    '\tfor ( int i = 0; i < 8; i++ ) {\n' +
                    '\t\tif ( i >= uSolidBuiltinSphereCount ) break;\n' +
                    '\t\tfloat r = max( 0.0001, uSolidSphereRadii[i] );\n' +
                    '\t\tfloat d = length( p.xz - uSolidSphereCenters[i].xz );\n' +
                    '\t\tfloat edge = max( 0.0, d - r );\n' +
                    '\t\tif ( edge < minEdge ) { minEdge = edge; nearR = r; }\n' +
                    '\t}\n' +
                    '\tfloat k = 1.0 - smoothstep( nearR * 0.18, nearR * 0.95, minEdge );\n' +
                    '\tk = pow( clamp( k, 0.0, 1.0 ), 1.8 );\n' +
                    '\tfloat occ = solidSphereOcclusionBuiltin( p );\n' +
                    '\treturn mix( 1.0, occ, k );\n' +
                    '}\n' +
                    'float solidApplyBuiltinSpherePatchGated( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, vec4 shadowCoord, float sh0 ) {\n' +
                    '\tif ( uSolidContactPatchEnable < 0.5 || uSolidBuiltinSphereCount <= 0 ) return sh0;\n' +
                    '\tfloat gate = solidShadowAvgGate2D( shadowMap, shadowMapSize, shadowBias, shadowCoord );\n' +
                    '\tfloat occ = solidSphereOcclusionFadedBuiltin( vSolidShadowGroundPos );\n' +
                    '\tfloat a = clamp( 1.0 - occ, 0.0, 1.0 );\n' +
                    '\tfloat k = gate;\n' +
                    '\tfloat outSh = sh0;\n' +
                    '\toutSh = clamp( outSh * ( 1.0 - k * a ), 0.0, 1.0 );\n' +
                    '\treturn outSh;\n' +
                    '}\n' +
                    'float solidApplySpherePatchGated( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, vec4 shadowCoord, float sh0 ) {\n' +
                    '\tif ( uSolidContactPatchEnable < 0.5 ) return sh0;\n' +
                    '\t// Gate using shadow neighborhood avg (same idea as seam fix): only patch in dark-side.\n' +
                    '\tfloat gate = solidShadowAvgGate2D( shadowMap, shadowMapSize, shadowBias, shadowCoord );\n' +
                    '\tfloat occ = solidSphereOcclusionFaded( vSolidShadowGroundPos );\n' +
                    '\tfloat a = clamp( 1.0 - occ, 0.0, 1.0 );\n' +
                    '\tfloat k = clamp( uSolidSpherePatchStrength, 0.0, 1.0 ) * gate;\n' +
                    '\tfloat outSh = sh0;\n' +
                    '\t// Only darken.\n' +
                    '\toutSh = clamp( outSh * ( 1.0 - k * a ), 0.0, 1.0 );\n' +
                    '\treturn outSh;\n' +
                    '}\n' +
                    '\n' +
                    'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {\n' +
                    '\tif ( uSolidMainLightType == 0 ) {\n' +
                    '\t\tfloat sh0 = getShadow_orig( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord );\n' +
                    '\t\tif ( uSolidContactPatchEnable < 0.5 ) return sh0;\n' +
                    '\t\tsh0 = solidSeamFix2D( shadowMap, shadowMapSize, shadowBias, shadowCoord, sh0 );\n' +
                    '\t\tsh0 = solidApplyBuiltinSpherePatchGated( shadowMap, shadowMapSize, shadowBias, shadowCoord, sh0 );\n' +
                    '\t\treturn min( sh0, solidSphereOcclusionFadedBuiltin( vSolidShadowGroundPos ) );\n' +
                    '\t}\n' +
                    '\tfloat dSolidSh = 1e9;\n' +
                    '\tfor ( int i = 0; i < 8; i++ ) {\n' +
                    '\t\tif ( i >= uSolidShadowAnchorCount ) break;\n' +
                    '\t\tdSolidSh = min( dSolidSh, length( vSolidShadowGroundPos.xz - uSolidShadowAnchors[i].xz ) );\n' +
                    '\t}\n' +
                    '\tfloat solidPullMult = 1.0 + 0.35 * exp( - ( dSolidSh * dSolidSh ) / 2.2 );\n' +
                    '\tfloat solidPull = min( uSolidShadowContactPull * solidPullMult, uSolidShadowContactPull + 0.00012 );\n' +
                    '\tfloat tSolidSh = smoothstep( uSolidShadowSoftRange.x, uSolidShadowSoftRange.y, dSolidSh );\n' +
                    '\ttSolidSh = pow( clamp( tSolidSh, 0.0, 1.0 ), max( 0.75, uSolidShadowSoftExp ) );\n' +
                    '\tshadowRadius *= ( 1.0 + uSolidShadowSoftStrength * tSolidSh );\n' +
                    '\tfloat solidPullUse = ( uSolidContactPatchEnable < 0.5 ) ? 0.0 : solidPull;\n' +
                    '\tfloat shadowOut = solidGaussianShadow2D( shadowMap, shadowMapSize, shadowCoord, shadowRadius, shadowBias, solidPullUse );\n' +
                    '\tif ( uSolidContactPatchEnable < 0.5 ) return shadowOut;\n' +
                    '\tif ( uSolidBuiltinSphereCount <= 0 ) return shadowOut;\n' +
                    '\tfloat occB = solidSphereOcclusionBuiltin( vSolidShadowGroundPos );\n' +
                    '\tfloat kOccB = pow( 1.0 - tSolidSh, 1.8 );\n' +
                    '\tshadowOut = min( shadowOut, mix( 1.0, occB, kOccB ) );\n' +
                    '\treturn shadowOut;\n' +
                    '}\n' +
                    '\n' +
                    'float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {\n' +
                    '\tfloat sh0 = getPointShadow_orig( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord, shadowCameraNear, shadowCameraFar );\n' +
                    '\tif ( uSolidContactPatchEnable < 0.5 ) return sh0;\n' +
                    '\tif ( uSolidBuiltinSphereCount <= 0 ) return sh0;\n' +
                    '\treturn min( sh0, solidSphereOcclusionFadedBuiltin( vSolidShadowGroundPos ) );\n' +
                    '}\n';

                  const endifIdx = chunk.lastIndexOf('#endif');
                  if (endifIdx < 0) {
                    log('[RasterShadowSoft] shadow chunk missing #endif — ground soft shadow skipped');
                    return;
                  }
                  chunk = chunk.slice(0, endifIdx) + solidShadowSoftAppend + '\n' + chunk.slice(endifIdx);

                  fs = fs.replace(inc, chunk);
                  cnt = 1;
                }
              } catch (_eChunk) {}
              if (cnt <= 0) {
                log('[RasterShadowSoft] shadow chunk replace MISS — ground soft shadow skipped');
                return;
              }
            }

            shader.uniforms.uSolidShadowAnchorCount = m.userData.uSolidShadowAnchorCount;
            shader.uniforms.uSolidShadowAnchors = m.userData.uSolidShadowAnchors;
            shader.uniforms.uSolidShadowContactPull = m.userData.uSolidShadowContactPull;
            shader.uniforms.uSolidShadowSeamStrength = m.userData.uSolidShadowSeamStrength;
            shader.uniforms.uSolidShadowSeamPush = m.userData.uSolidShadowSeamPush;
            shader.uniforms.uSolidShadowSeamRadius = m.userData.uSolidShadowSeamRadius;
            shader.uniforms.uSolidWedgeEnable = m.userData.uSolidWedgeEnable;
            shader.uniforms.uSolidWedgeStrength = m.userData.uSolidWedgeStrength;
            shader.uniforms.uSolidWedgeWidth = m.userData.uSolidWedgeWidth;
            shader.uniforms.uSolidWedgeLength = m.userData.uSolidWedgeLength;
            shader.uniforms.uSolidWedgeDebug = m.userData.uSolidWedgeDebug;
            shader.uniforms.uSolidShadowSoftRange = m.userData.uSolidShadowSoftRange;
            shader.uniforms.uSolidShadowSoftStrength = m.userData.uSolidShadowSoftStrength;
            shader.uniforms.uSolidShadowSoftExp = m.userData.uSolidShadowSoftExp;
            shader.uniforms.uSolidContactPatchEnable = m.userData.uSolidContactPatchEnable;
            shader.uniforms.uSolidBuiltinSphereCount = m.userData.uSolidBuiltinSphereCount;
            shader.uniforms.uSolidSphereCount = m.userData.uSolidSphereCount;
            shader.uniforms.uSolidSphereCenters = m.userData.uSolidSphereCenters;
            shader.uniforms.uSolidSphereRadii = m.userData.uSolidSphereRadii;
            shader.uniforms.uSolidSpherePatchStrength = m.userData.uSolidSpherePatchStrength;
            shader.uniforms.uSolidSphereDebug = m.userData.uSolidSphereDebug;
            shader.uniforms.uSolidDbgForceRed = m.userData.uSolidDbgForceRed;
            shader.uniforms.uSolidMainLightType = m.userData.uSolidMainLightType;
            shader.uniforms.uSolidMainLightPos = m.userData.uSolidMainLightPos;
            shader.uniforms.uSolidMainLightDir = m.userData.uSolidMainLightDir;

            shader.fragmentShader =
              'varying vec3 vSolidShadowGroundPos;\n' +
              'uniform int uSolidShadowAnchorCount;\n' +
              'uniform vec3 uSolidShadowAnchors[8];\n' +
              'uniform float uSolidShadowContactPull;\n' +
              'uniform float uSolidShadowSeamStrength;\n' +
              'uniform float uSolidShadowSeamPush;\n' +
              'uniform float uSolidShadowSeamRadius;\n' +
              'uniform float uSolidWedgeEnable;\n' +
              'uniform float uSolidWedgeStrength;\n' +
              'uniform float uSolidWedgeWidth;\n' +
              'uniform float uSolidWedgeLength;\n' +
              'uniform float uSolidWedgeDebug;\n' +
              'uniform vec4 uSolidShadowSoftRange;\n' +
              'uniform float uSolidShadowSoftStrength;\n' +
              'uniform float uSolidShadowSoftExp;\n' +
              'uniform float uSolidContactPatchEnable;\n' +
              'uniform int uSolidBuiltinSphereCount;\n' +
              'uniform float uSolidShadowGaussTaps;\n' +
              'uniform float uSolidShadowGaussRotate;\n' +
              'uniform int uSolidSphereCount;\n' +
              'uniform vec3 uSolidSphereCenters[8];\n' +
              'uniform float uSolidSphereRadii[8];\n' +
              'uniform float uSolidSpherePatchStrength;\n' +
              'uniform float uSolidSphereDebug;\n' +
              'uniform float uSolidDbgForceRed;\n' +
              'uniform int uSolidMainLightType;\n' +
              'uniform vec3 uSolidMainLightPos;\n' +
              'uniform vec3 uSolidMainLightDir;\n' +
              'float solidRaySphereOcc( vec3 ro, vec3 rd, float tMax, vec3 c, float r ) {\n' +
              '  vec3 oc = ro - c;\n' +
              '  float b = dot( oc, rd );\n' +
              '  float cc = dot( oc, oc ) - r * r;\n' +
              '  float h = b * b - cc;\n' +
              '  if ( h < 0.0 ) return 1.0;\n' +
              '  float s = sqrt( h );\n' +
              '  float t = -b - s;\n' +
              '  if ( t < 0.0 ) t = -b + s;\n' +
              '  return ( t > -1e-4 && t < tMax ) ? 0.0 : 1.0;\n' +
              '}\n' +
              'float solidSphereOcclusion( vec3 p ) {\n' +
              '  if ( uSolidSphereCount <= 0 ) return 1.0;\n' +
              '  float occ = 1.0;\n' +
              '  if ( uSolidMainLightType == 0 ) {\n' +
              '    vec3 rd = normalize( uSolidMainLightDir );\n' +
              '    for ( int i = 0; i < 8; i++ ) {\n' +
              '      if ( i >= uSolidSphereCount ) break;\n' +
              '      occ = min( occ, solidRaySphereOcc( p, rd, 1e6, uSolidSphereCenters[i], uSolidSphereRadii[i] ) );\n' +
              '    }\n' +
              '  } else {\n' +
              '    vec3 lp = uSolidMainLightPos;\n' +
              '    vec3 rd = normalize( lp - p );\n' +
              '    float tMax = length( lp - p );\n' +
              '    for ( int i = 0; i < 8; i++ ) {\n' +
              '      if ( i >= uSolidSphereCount ) break;\n' +
              '      occ = min( occ, solidRaySphereOcc( p, rd, tMax, uSolidSphereCenters[i], uSolidSphereRadii[i] ) );\n' +
              '    }\n' +
              '  }\n' +
              '  return occ;\n' +
              '}\n' +
              'float solidContactDebugMask( vec3 p ) {\n' +
              '  if ( uSolidSphereCount <= 0 ) return 0.0;\n' +
              '  float m = 0.0;\n' +
              '  for ( int i = 0; i < 8; i++ ) {\n' +
              '    if ( i >= uSolidSphereCount ) break;\n' +
              '    float r = max( 0.0001, uSolidSphereRadii[i] );\n' +
              '    float d = length( p.xz - uSolidSphereCenters[i].xz );\n' +
              '    // Exaggerated wide band for visual verification.\n' +
              '    float mm = 1.0 - smoothstep( r * 0.65, r * 1.75, d );\n' +
              '    m = max( m, mm );\n' +
              '  }\n' +
              '  return clamp( m, 0.0, 1.0 );\n' +
              '}\n' +
              fs;

            // Debug/Experiment: tint ground red (visual confirmation).
            // IMPORTANT: inject only once; #include tag is removed after first replace.
            try {
              if (shader.fragmentShader) {
                const dbgCode =
                  '\nif ( uSolidDbgForceRed > 0.5 ) {\n' +
                  '  gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );\n' +
                  '}\n' +
                  '\n{\n' +
                  '  float aDbg = 0.0;\n' +
                  '  if ( uSolidSphereDebug > 0.5 ) {\n' +
                  '    aDbg = max( aDbg, solidContactDebugMask( vSolidShadowGroundPos ) );\n' +
                  '  }\n' +
                  '  if ( uSolidSphereDebug > 0.5 ) {\n' +
                  '    if ( aDbg > 1e-4 ) gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );\n' +
                  '    else gl_FragColor = vec4( 0.0, 0.35, 1.0, 1.0 );\n' +
                  '  }\n' +
                  '}\n';

                let injected = false;
                const tags = [
                  '#include <output_fragment>',
                  '#include <opaque_fragment>',
                  '#include <dithering_fragment>',
                ];
                for (let ti = 0; ti < tags.length; ti++) {
                  const tag = tags[ti];
                  if (shader.fragmentShader.includes(tag)) {
                    shader.fragmentShader = shader.fragmentShader.replace(tag, tag + dbgCode);
                    injected = true;
                    break;
                  }
                }
                if (!injected) {
                  // Last-resort: append at end for visibility diagnosis.
                  shader.fragmentShader += dbgCode;
                }
              }
            } catch (_eDbg) {}

            // gaussian PCF params (constants wrapped as uniforms for easy tuning)
            try {
              const mob = (isMobile || isIosHost);
              const g = mob ? RASTER_SHADOW_GAUSS_PARAMS.mobile : RASTER_SHADOW_GAUSS_PARAMS.desktop;
              if (!m.userData.uSolidShadowGaussTaps) m.userData.uSolidShadowGaussTaps = { value: 16.0 };
              if (!m.userData.uSolidShadowGaussRotate) m.userData.uSolidShadowGaussRotate = { value: 1.0 };
              m.userData.uSolidShadowGaussTaps.value = g.taps;
              m.userData.uSolidShadowGaussRotate.value = g.rotate ? 1.0 : 0.0;
              shader.uniforms.uSolidShadowGaussTaps = m.userData.uSolidShadowGaussTaps;
              shader.uniforms.uSolidShadowGaussRotate = m.userData.uSolidShadowGaussRotate;
            } catch (_eGpcf) {}

            shader.vertexShader = 'varying vec3 vSolidShadowGroundPos;\n' + shader.vertexShader;
            // worldpos_vertex 在 USE_SHADOWMAP 等均未定义时会展开为空，此时无 worldPosition；与 begin_vertex 分支统一用 modelMatrix。
            const vSolidGroundAssign = '\n\tvSolidShadowGroundPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;';
            if (shader.vertexShader.includes('#include <worldpos_vertex>')) {
              shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                '#include <worldpos_vertex>' + vSolidGroundAssign
              );
            } else if (shader.vertexShader.includes('#include <begin_vertex>')) {
              shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>' + vSolidGroundAssign
              );
            }
          };

          log('[RasterShadowSoft] ground patch armed v' + _ver);
          m.needsUpdate = true;
        }
      } catch (_eGs) {}

      // ---------- Receiver soft shadow (walls) ----------
      try {
        const walls = getWalls();
        const ground = getGround();
        const mainLight = getMainLight();
        const sharedUd = ground && ground.material && ground.material.userData ? ground.material.userData : null;
        const okShared = !!(sharedUd && sharedUd.uSolidShadowAnchorCount && sharedUd.uSolidShadowAnchors && sharedUd.uSolidShadowSoftRange);
        const shouldSoftWalls = _receiverSoftShadowWallsEnabled() && okShared && walls && Array.isArray(walls) && !(mainLight && mainLight.isDirectionalLight);
        if (walls && Array.isArray(walls) && !shouldSoftWalls) {
          // Ensure we revert to legacy shaders when disabling/when switching to directional.
          for (let wi = 0; wi < walls.length; wi++) {
            const w = walls[wi];
            if (!w || !w.isMesh || !w.material) continue;
            const mats = Array.isArray(w.material) ? w.material : [w.material];
            for (let mi = 0; mi < mats.length; mi++) _clearReceiverSoftShadowPatch(mats[mi]);
          }
        }
        // Directional light: keep legacy projection behavior (no receiver softening).
        if (shouldSoftWalls) {
          const mob = (isMobile || isIosHost);
          const g = mob ? RASTER_SHADOW_GAUSS_PARAMS.mobile : RASTER_SHADOW_GAUSS_PARAMS.desktop;
          for (let wi = 0; wi < walls.length; wi++) {
            const w = walls[wi];
            if (!w || !w.isMesh || !w.material) continue;
            const mats = Array.isArray(w.material) ? w.material : [w.material];
            for (let mi = 0; mi < mats.length; mi++) {
              const mat = mats[mi];
              if (!mat) continue;
              _installReceiverSoftShadowPatch(mat, sharedUd, { kindTag: 1, gauss: g });
            }
          }
        }
      } catch (_eWallSoft) {}

      // ---------- Receiver soft shadow (sceneGroup models) ----------
      try {
        const mainLight = getMainLight();
        const ground = getGround();
        const sharedUd = ground && ground.material && ground.material.userData ? ground.material.userData : null;
        const okShared = !!(sharedUd && sharedUd.uSolidShadowAnchorCount && sharedUd.uSolidShadowAnchors && sharedUd.uSolidShadowSoftRange);
        const sg = getSceneGroup();
        const shouldSoftModels = _receiverSoftShadowModelsEnabled() && okShared && sg && sg.traverse && !(mainLight && mainLight.isDirectionalLight);
        if (sg && sg.traverse && !shouldSoftModels) {
          // Ensure we revert to legacy shaders when disabling/when switching to directional.
          sg.traverse((obj) => {
            try {
              if (!obj || !obj.isMesh) return;
              const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
              for (let mi = 0; mi < mats.length; mi++) _clearReceiverSoftShadowPatch(mats[mi]);
            } catch (_eC) {}
          });
        }
        if (shouldSoftModels) {
          const mob = (isMobile || isIosHost);
          const g = mob ? RASTER_SHADOW_GAUSS_PARAMS.mobile : RASTER_SHADOW_GAUSS_PARAMS.desktop;
          sg.traverse((obj) => {
            try {
              if (!obj || !obj.isMesh) return;
              if (!obj.receiveShadow) return;
              const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
              for (let mi = 0; mi < mats.length; mi++) {
                const mat = mats[mi];
                if (!mat) continue;
                _installReceiverSoftShadowPatch(mat, sharedUd, { kindTag: 2, gauss: g });
              }
            } catch (_eM) {}
          });
        }
      } catch (_eModelSoft) {}
    } catch (_e) {}
  }

  // ---------- Preview env probes (consumer extracted) ----------
  let pmremGen = null;
  let cubeRT = null;
  let cubeCam = null;
  let basePmremRT = null;
  let pmremRTs = [null, null, null];
  let probePositions = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let envProbeTimer = 0;
  let lastRunAt = 0;
  const minIntervalMs = typeof opts.envMinIntervalMs === 'number' ? opts.envMinIntervalMs : 2600;
  const debounceMs = typeof opts.envDebounceMs === 'number' ? opts.envDebounceMs : 220;
  const cubeSize = typeof opts.envCubeSize === 'number' ? opts.envCubeSize : (getIsMobile() ? 48 : 64);
  const probeCount = 3;

  function _disposeEnvProbe() {
    try {
      const scene = getScene();
      const sceneGroup = getSceneGroup();
      const sameAs0 = (basePmremRT && pmremRTs[0] && basePmremRT === pmremRTs[0]);
      if (basePmremRT && !sameAs0) { try { safeDispose(basePmremRT); } catch (_e0) {} }
      basePmremRT = null;
      for (let i = 0; i < pmremRTs.length; i++) {
        if (pmremRTs[i]) { try { safeDispose(pmremRTs[i]); } catch (_e) {} pmremRTs[i] = null; }
      }
      try { if (cubeRT) safeDispose(cubeRT); } catch (_e3) {}
      cubeRT = null;
      cubeCam = null;
      try { if (scene) { scene.environment = null; scene.environmentIntensity = 1; } } catch (_e4) {}
      try {
        if (sceneGroup && sceneGroup.traverse) {
          sceneGroup.traverse((obj) => {
            if (!obj || !obj.isMesh) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (let mi = 0; mi < mats.length; mi++) {
              const m = mats[mi];
              if (!m || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) continue;
              m.envMap = null;
              m.needsUpdate = true;
            }
          });
        }
      } catch (_e5) {}
    } catch (_e) {}
  }

  function _envIntensityForMaterial(m) {
    const r = Math.min(1, Math.max(0, Number(m.roughness) || 0));
    const met = Math.min(1, Math.max(0, Number(m.metalness) || 0));
    let v = 0.16 + (1.0 - r) * 0.38;
    if (met > 0.55) v *= 0.72;
    v = Math.min(0.78, Math.max(0.11, v));
    return v;
  }

  function _computeProbeLayout() {
    const sceneGroup = getSceneGroup();
    const center = new THREE.Vector3(0, 1.0, 0);
    let radius = 3.2;
    try {
      const box = new THREE.Box3();
      box.setFromObject(sceneGroup);
      if (!box.isEmpty()) {
        const c = new THREE.Vector3();
        box.getCenter(c);
        const size = new THREE.Vector3();
        box.getSize(size);
        center.copy(c);
        radius = Math.max(1.2, Math.max(size.x, size.z) * 0.42 + size.y * 0.10);
        center.y = Math.max(0.35, center.y);
      }
    } catch (_e) {}

    const yHi = Math.max(0.9, Math.min(2.8, center.y + radius * 0.22));
    const yLo = Math.max(0.22, Math.min(1.1, center.y * 0.35 + 0.22));
    probePositions[0].set(center.x, yHi, center.z + radius * 0.62);
    probePositions[1].set(center.x + radius * 0.58, yHi, center.z - radius * 0.36);
    probePositions[2].set(center.x - radius * 0.58, yLo, center.z - radius * 0.36);
  }

  function _pickNearestProbeIndex(p) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < probeCount; i++) {
      const d = p.distanceToSquared(probePositions[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function _applyMultiEnvProbesToSceneGroup() {
    const sceneGroup = getSceneGroup();
    if (!sceneGroup || !sceneGroup.traverse) return;
    const tmp = new THREE.Vector3();
    sceneGroup.traverse((obj) => {
      if (!obj || !obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m) continue;
        if (!(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) continue;
        try {
          obj.updateWorldMatrix(true, false);
          const g = (obj.geometry && obj.geometry.boundingSphere) ? obj.geometry.boundingSphere : null;
          if (g) tmp.copy(g.center).applyMatrix4(obj.matrixWorld);
          else obj.getWorldPosition(tmp);
        } catch (_eP) {
          try { obj.getWorldPosition(tmp); } catch (_e2) { tmp.set(0, 1, 0); }
        }
        const idx = _pickNearestProbeIndex(tmp);
        const pm = pmremRTs[idx];
        if (pm && pm.texture) {
          m.envMap = pm.texture;
          m.envMapIntensity = _envIntensityForMaterial(m);
          m.needsUpdate = true;
        }
      }
    });
  }

  function _updateEnvProbeNow(reason) {
    try {
      if (!previewEnabled) return;
      if (shouldSkipEnvProbe(reason)) return;
      const renderer = getRenderer();
      const scene = getScene();
      const camera = getCamera();
      const sceneGroup = getSceneGroup();
      if (!renderer || !scene || !camera || !sceneGroup) return;

      const now = performance.now();
      if (lastRunAt && (now - lastRunAt) < minIntervalMs) return;
      lastRunAt = now;

      if (!pmremGen) pmremGen = new THREE.PMREMGenerator(renderer);
      if (!cubeRT) cubeRT = new THREE.WebGLCubeRenderTarget(cubeSize, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      if (!cubeCam) {
        cubeCam = new THREE.CubeCamera(0.08, 160, cubeRT);
        cubeCam.renderTarget.texture.name = 'SolidRasterEnvCubeRT';
      }

      _computeProbeLayout();
      scene.environment = null;
      scene.environmentIntensity = 1;

      const prevPos = cubeCam.position.clone();
      for (let pi = 0; pi < probeCount; pi++) {
        cubeCam.position.copy(probePositions[pi]);
        cubeCam.updateMatrixWorld(true);
        cubeCam.update(renderer, scene);
        if (pmremRTs[pi]) { try { safeDispose(pmremRTs[pi]); } catch (_eD) {} pmremRTs[pi] = null; }
        pmremRTs[pi] = pmremGen.fromCubemap(cubeRT.texture);
      }
      cubeCam.position.copy(prevPos);
      cubeCam.updateMatrixWorld(true);

      try {
        const baseSrc = pmremRTs[0];
        if (basePmremRT && basePmremRT !== baseSrc) { try { safeDispose(basePmremRT); } catch (_eDb) {} }
        basePmremRT = null;
        if (baseSrc && baseSrc.texture) {
          basePmremRT = baseSrc;
          scene.environment = baseSrc.texture;
          scene.environmentIntensity = getIsMobile() ? 0.22 : 0.26;
        } else {
          scene.environment = null;
          scene.environmentIntensity = 1;
        }
      } catch (_eB) {
        scene.environment = null;
        scene.environmentIntensity = 1;
      }

      _applyMultiEnvProbesToSceneGroup();
      log('[RasterEnvProbe] multi updated (' + (reason || 'unknown') + '), cube=' + cubeSize + ' x3');
    } catch (e) {
      log('[RasterEnvProbe] failed: ' + (e && e.message ? e.message : e));
      _disposeEnvProbe();
    }
  }

  function requestEnvProbe(reason) {
    if (!previewEnabled) return;
    if (envProbeTimer) { clearTimeout(envProbeTimer); envProbeTimer = 0; }
    envProbeTimer = setTimeout(() => {
      envProbeTimer = 0;
      _updateEnvProbeNow(reason);
    }, debounceMs);
  }

  function onSceneChanged(reason) {
    // Scene load/apply may create/replace receiver materials asynchronously.
    // Re-arm shadow receiver patch several times in a short window, so first entry
    // gets soft receivers without requiring a manual light-type toggle.
    try {
      if (previewEnabled) {
        syncShadows();
        try { requestAnimationFrame(() => { try { if (previewEnabled) syncShadows(); } catch (_eRaf1) {} }); } catch (_eRaf0) {}
        try { setTimeout(() => { try { if (previewEnabled) syncShadows(); } catch (_eT1) {} }, 80); } catch (_eT0) {}
        try { setTimeout(() => { try { if (previewEnabled) syncShadows(); } catch (_eT2) {} }, 220); } catch (_eT00) {}
      }
    } catch (_e) {}
    // For now: force a near-term env refresh; layout will adapt to new bounds.
    requestEnvProbe(reason || 'scene_changed');
  }

  function dispose() {
    try {
      if (envProbeTimer) { clearTimeout(envProbeTimer); envProbeTimer = 0; }
    } catch (_e) {}
    _disposeEnvProbe();
  }

  function install() {
    // No-op: kept for future global ShaderChunk guard if needed.
    return true;
  }

  function setEnabled(isPreviewMode) {
    previewEnabled = !!isPreviewMode;
    if (!previewEnabled) {
      // When leaving preview mode, release probe resources to avoid memory peaks.
      dispose();
    }
  }

  return {
    install,
    setEnabled,
    syncShadows,
    syncGroundShadowUniforms,
    /** 与 Solid.html 原 `_solidFitRasterShadowFrustumForSceneGroup` 同源：光源移动后收紧 shadow frustum。 */
    fitRasterShadowFrustumForSceneGroup: (lightOverride) => _fitRasterShadowFrustumForSceneGroup(lightOverride),
    requestEnvProbe,
    onSceneChanged,
    dispose,
  };
}

