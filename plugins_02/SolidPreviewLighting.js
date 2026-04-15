// Shared preview-mode lighting for Solid consumer & producer pages.
// “Preview mode” means useAdvancedRender === false in hosts.

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

  // ---------- Shadow soft ground patch (consumer extracted) ----------
  function _fitRasterShadowFrustumForSceneGroup() {
    try {
      const mainLight = getMainLight();
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

      if (ud.uSolidSphereCenters && ud.uSolidSphereRadii && ud.uSolidSphereCount) {
        let n = 0;
        const tmpPos = new THREE.Vector3();
        const tmpScale = new THREE.Vector3();
        if (sceneGroup && sceneGroup.traverse) {
          sceneGroup.traverse((obj) => {
            if (n >= 8) return;
            if (!obj || !obj.isMesh) return;
            if (!obj.userData || obj.userData.type !== 'builtin' || obj.userData.shape !== 'sphere') return;
            try {
              obj.getWorldPosition(tmpPos);
              obj.getWorldScale(tmpScale);
              const r = Math.max(0.0001, Math.abs(tmpScale.y) * 2.0);
              ud.uSolidSphereCenters.value[n].copy(tmpPos);
              ud.uSolidSphereRadii.value[n] = r;
              n++;
            } catch (_eS) {}
          });
        }
        ud.uSolidSphereCount.value = n;
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

      mainLight.castShadow = true;
      const sh = mainLight.shadow;
      const ms = isMobile ? 3072 : 4096;
      const range = Math.min(175, Math.max(96, (Number(st.radius) || 18) * 2.75 + 48));

      if (mainLight.isSpotLight) {
        sh.mapSize.set(ms, ms);
        sh.radius = 1.4;
        sh.blurSamples = 18;
        sh.camera.near = Math.max(0.26, Math.min(0.6, (Number(st.radius) || 18) * 0.016));
        sh.camera.far = range;
        sh.camera.updateProjectionMatrix();
      } else if (mainLight.isDirectionalLight) {
        sh.mapSize.set(ms, ms);
        sh.radius = 1.4;
        sh.blurSamples = 18;
        const cam = sh.camera;
        const he = isMobile ? 26 : 32;
        cam.near = 1.3;
        cam.far = Math.min(125, (Number(st.radius) || 18) * 4.2 + 58);
        cam.left = -he; cam.right = he; cam.top = he; cam.bottom = -he;
        cam.updateProjectionMatrix();
      } else if (mainLight.isPointLight) {
        const pms = isMobile ? 896 : 1408;
        sh.mapSize.set(pms, pms);
        sh.radius = 1.5;
        sh.blurSamples = 12;
        sh.camera.near = 0.5;
        sh.camera.far = range;
        sh.camera.updateProjectionMatrix();
      }

      try { if (sceneGroup) sceneGroup.updateMatrixWorld(true); } catch (_eMw) {}
      _fitRasterShadowFrustumForSceneGroup();

      const _nbBoost = isMobile ? 1.9 : (isIosHost ? 1.4 : 1.0);
      if (mainLight.isSpotLight) {
        sh.bias = (isMobile || isIosHost) ? -0.000012 : -0.000006;
        sh.normalBias = 0.022 * _nbBoost;
        if (isMobile || isIosHost) sh.normalBias = Math.min(sh.normalBias, 0.028);
      } else if (mainLight.isDirectionalLight) {
        sh.bias = (isMobile || isIosHost) ? -0.00005 : -0.000025;
        sh.normalBias = 0.025 * _nbBoost;
      } else if (mainLight.isPointLight) {
        sh.bias = -0.000015;
        const _ptNbBoost = isMobile ? 1.12 : (isIosHost ? 1.08 : 1.0);
        sh.normalBias = 0.014 * _ptNbBoost;
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
          if (!m.userData.uSolidMainLightType) m.userData.uSolidMainLightType = { value: 0 };
          if (!m.userData.uSolidMainLightPos) m.userData.uSolidMainLightPos = { value: new THREE.Vector3() };
          if (!m.userData.uSolidMainLightDir) m.userData.uSolidMainLightDir = { value: new THREE.Vector3(0, 1, 0) };
          if (!m.userData.uSolidShadowContactPull) m.userData.uSolidShadowContactPull = { value: 0.00065 };
          if (!m.userData.uSolidShadowSoftRange) m.userData.uSolidShadowSoftRange = { value: new THREE.Vector4(2.8, 28.0, 2.8, 7.8) };
          if (!m.userData.uSolidShadowSoftStrength) m.userData.uSolidShadowSoftStrength = { value: 16.0 };
          if (!m.userData.uSolidShadowSoftExp) m.userData.uSolidShadowSoftExp = { value: 2.25 };

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
            if (mainLight && mainLight.isPointLight) m.userData.uSolidShadowContactPull.value = mob ? 0.00175 : 0.00105;
            else if (mainLight && mainLight.isDirectionalLight) m.userData.uSolidShadowContactPull.value = mob ? 0.00085 : 0.00065;
            else m.userData.uSolidShadowContactPull.value = mob ? 0.00095 : 0.00075;
          } catch (_ePull) {}

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

          // spheres
          try {
            let n = 0;
            const tmpPos = new THREE.Vector3();
            const tmpScale = new THREE.Vector3();
            if (sceneGroup && sceneGroup.traverse) {
              sceneGroup.traverse((obj) => {
                if (n >= 8) return;
                if (!obj || !obj.isMesh) return;
                if (!obj.userData || obj.userData.type !== 'builtin' || obj.userData.shape !== 'sphere') return;
                try {
                  obj.getWorldPosition(tmpPos);
                  obj.getWorldScale(tmpScale);
                  const r = Math.max(0.0001, Math.abs(tmpScale.y) * 2.0);
                  m.userData.uSolidSphereCenters.value[n].copy(tmpPos);
                  m.userData.uSolidSphereRadii.value[n] = r;
                  n++;
                } catch (_eS) {}
              });
            }
            m.userData.uSolidSphereCount.value = n;
          } catch (_eSc) { try { m.userData.uSolidSphereCount.value = 0; } catch (_e2) {} }

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

                  // Gaussian sampling helpers must live inside this shadow chunk so `texture2DCompare` is in scope.
                  chunk += `\n\nfloat solidHash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }\nmat2 solidRot2( float a ) { float s = sin( a ), c = cos( a ); return mat2( c, -s, s, c ); }\nfloat solidGaussianShadow2D( sampler2D shadowMap, vec2 shadowMapSize, vec4 shadowCoord, float shadowRadius ) {\n\tfloat shadow = 1.0;\n\tvec3 sc = shadowCoord.xyz / shadowCoord.w;\n\tbool inFrustum = sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0;\n\tbool frustumTest = inFrustum && sc.z <= 1.0;\n\tif ( !frustumTest ) return 1.0;\n\tvec2 texel = vec2( 1.0 ) / shadowMapSize;\n\tfloat tapsF = clamp( uSolidShadowGaussTaps, 4.0, 32.0 );\n\tint taps = int( floor( tapsF + 0.5 ) );\n\tfloat ang = ( uSolidShadowGaussRotate > 0.5 ) ? ( 6.2831853 * solidHash12( vSolidShadowGroundPos.xz * 0.071 + sc.xy * 7.1 ) ) : 0.0;\n\tmat2 R = solidRot2( ang );\n\tfloat sum = 0.0;\n\tfloat wsum = 0.0;\n\t// Continuous disk (spiral) sampling + Gaussian weights to avoid ring / slice artifacts.\n\t// r uses sqrt distribution so samples are uniform over area.\n\tfloat rMax = 1.85;\n\tfor ( int i = 0; i < 32; i++ ) {\n\t\tif ( i >= taps ) break;\n\t\tfloat fi = float(i);\n\t\tfloat t = (fi + 0.5) / max( 1.0, float(taps) );\n\t\tfloat r = sqrt( t ) * rMax;\n\t\tfloat a = (fi + 0.5) * 2.3999632;\n\t\tvec2 o = R * vec2( cos(a), sin(a) ) * r;\n\t\tvec2 uv = sc.xy + o * texel * shadowRadius;\n\t\tfloat w = exp( - (r*r) * 1.6 );\n\t\tsum += w * texture2DCompare( shadowMap, uv, sc.z );\n\t\twsum += w;\n\t}\n\tshadow = (wsum > 0.0) ? (sum / wsum) : 1.0;\n\treturn shadow;\n}\n`;

                  chunk += `\n\nfloat getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {\n\tfloat dSolidSh = 1e9;\n\tfor ( int i = 0; i < 8; i++ ) {\n\t\tif ( i >= uSolidShadowAnchorCount ) break;\n\t\tdSolidSh = min( dSolidSh, length( vSolidShadowGroundPos.xz - uSolidShadowAnchors[i].xz ) );\n\t}\n\tfloat solidPullMult = 1.0 + 0.35 * exp( - ( dSolidSh * dSolidSh ) / 2.2 );\n\tfloat solidPull = min( uSolidShadowContactPull * solidPullMult, uSolidShadowContactPull + 0.00035 );\n\tshadowCoord.z += solidPull;\n\tfloat tSolidSh = smoothstep( uSolidShadowSoftRange.x, uSolidShadowSoftRange.y, dSolidSh );\n\ttSolidSh = pow( clamp( tSolidSh, 0.0, 1.0 ), max( 0.75, uSolidShadowSoftExp ) );\n\tshadowRadius *= ( 1.0 + uSolidShadowSoftStrength * tSolidSh );\n\tfloat shadowOut = solidGaussianShadow2D( shadowMap, shadowMapSize, shadowCoord, shadowRadius );\n\t// Sphere occlusion fix should only affect near-contact region; fade it out toward the far soft tail.\n\tfloat occ = solidSphereOcclusion( vSolidShadowGroundPos );\n\tfloat kOcc = pow( 1.0 - tSolidSh, 1.8 );\n\tshadowOut = min( shadowOut, mix( 1.0, occ, kOcc ) );\n\treturn shadowOut;\n}\n\nfloat getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {\n\tfloat dSolidSh = 1e9;\n\tfor ( int i = 0; i < 8; i++ ) {\n\t\tif ( i >= uSolidShadowAnchorCount ) break;\n\t\tdSolidSh = min( dSolidSh, length( vSolidShadowGroundPos.xz - uSolidShadowAnchors[i].xz ) );\n\t}\n\tfloat solidPullMult = 1.0 + 0.55 * exp( - ( dSolidSh * dSolidSh ) / 2.2 );\n\tfloat solidPull = min( uSolidShadowContactPull * solidPullMult, uSolidShadowContactPull + 0.00055 );\n\tshadowCoord.z += solidPull;\n\tfloat tSolidSh = smoothstep( uSolidShadowSoftRange.x, uSolidShadowSoftRange.y, dSolidSh );\n\ttSolidSh = pow( clamp( tSolidSh, 0.0, 1.0 ), max( 0.75, uSolidShadowSoftExp ) );\n\tshadowRadius *= ( 1.0 + uSolidShadowSoftStrength * tSolidSh );\n\t// Point light shadow uses a different projection; keep original sampling, only scale radius and apply sphere fix fade.\n\tfloat shadowOut = getPointShadow_orig( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord, shadowCameraNear, shadowCameraFar );\n\tfloat occ = solidSphereOcclusion( vSolidShadowGroundPos );\n\tfloat kOcc = pow( 1.0 - tSolidSh, 1.8 );\n\tshadowOut = min( shadowOut, mix( 1.0, occ, kOcc ) );\n\treturn shadowOut;\n}\n`;

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
            shader.uniforms.uSolidShadowSoftRange = m.userData.uSolidShadowSoftRange;
            shader.uniforms.uSolidShadowSoftStrength = m.userData.uSolidShadowSoftStrength;
            shader.uniforms.uSolidShadowSoftExp = m.userData.uSolidShadowSoftExp;
            shader.uniforms.uSolidSphereCount = m.userData.uSolidSphereCount;
            shader.uniforms.uSolidSphereCenters = m.userData.uSolidSphereCenters;
            shader.uniforms.uSolidSphereRadii = m.userData.uSolidSphereRadii;
            shader.uniforms.uSolidMainLightType = m.userData.uSolidMainLightType;
            shader.uniforms.uSolidMainLightPos = m.userData.uSolidMainLightPos;
            shader.uniforms.uSolidMainLightDir = m.userData.uSolidMainLightDir;

            shader.fragmentShader =
              'varying vec3 vSolidShadowGroundPos;\n' +
              'uniform int uSolidShadowAnchorCount;\n' +
              'uniform vec3 uSolidShadowAnchors[8];\n' +
              'uniform float uSolidShadowContactPull;\n' +
              'uniform vec4 uSolidShadowSoftRange;\n' +
              'uniform float uSolidShadowSoftStrength;\n' +
              'uniform float uSolidShadowSoftExp;\n' +
              'uniform float uSolidShadowGaussTaps;\n' +
              'uniform float uSolidShadowGaussRotate;\n' +
              'uniform int uSolidSphereCount;\n' +
              'uniform vec3 uSolidSphereCenters[8];\n' +
              'uniform float uSolidSphereRadii[8];\n' +
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
              fs;

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
            if (shader.vertexShader.includes('#include <worldpos_vertex>')) {
              shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                '#include <worldpos_vertex>\n\tvSolidShadowGroundPos = worldPosition.xyz;'
              );
            } else if (shader.vertexShader.includes('#include <begin_vertex>')) {
              shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\n\tvSolidShadowGroundPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;'
              );
            }
          };

          log('[RasterShadowSoft] ground patch armed v' + _ver);
          m.needsUpdate = true;
        }
      } catch (_eGs) {}
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
    // For now: just force a near-term env refresh; layout will adapt to new bounds.
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
    requestEnvProbe,
    onSceneChanged,
    dispose,
  };
}

