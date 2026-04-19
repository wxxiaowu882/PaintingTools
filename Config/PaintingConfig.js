// PaintingTools 全局配置文件（给业务同学看的）
// - 你只需要知道：这里改的是“效果/性能”的取舍，不会影响功能逻辑。
// - 规则：每个配置项都写清楚“改了会怎样、建议怎么改”。

// 光栅阴影“性能模式”配置（只在低配/降级模式生效）
// - 场景在动的时候：阴影可以先糊一点/粗一点，换流畅
// - 场景停下来后：自动回到清晰好看的最终效果
// - 你通常只需要改：恢复时间、交互时的阴影质量档位

export const SOLID_RASTER_SHADOW_PERF = {
  enableDynamicRasterShadowQuality: true, // 总开关：不想要“动时降质量、停后恢复”，就设为 false（效果回到原样）。
  debugLog: false, // 调试开关：设为 true 会在控制台打印“现在是动/静止哪一档”，一般不用开。
  interactWindowMs: 180, // “判定还在动”的时间(ms)：操作停止后，这段时间内仍按“交互档”处理（太小会抖，太大恢复慢）。
  restoreDelayMs: 800, // “停下来多久恢复清晰”(ms)：越小越快变清晰，但可能频繁切换；默认 800ms 比较稳。

  // 阴影质量分档：idle=停着时的最终效果；interactive=拖动/旋转时的临时效果。
  qualityTiers: {
    idle: {
      tapsDesktop: 24, // 电脑端：停着时阴影“细腻程度”（越大越细腻，但更吃性能；建议 16~28）。
      tapsMobile: 24, // 手机端：停着时阴影“细腻程度”（越大越细腻，但更吃性能；建议 8~16）。
      rotate: 1, // 去条纹：1=更不容易出现一圈圈/条纹；0=可能更容易出条纹（一般别关）。
    },
    interactive: {
      tapsDesktop: 12, // 电脑端：动的时候临时阴影质量（越小越流畅，但越“糊/粗”）。建议 8~14。
      tapsMobile: 12, // 手机端：动的时候临时阴影质量（越小越流畅，但越“糊/粗”）。建议 6~10。
      rotate: 1, // 去条纹：建议保持 1。
    },
  },

  // CPU 节流：主要影响“动的时候卡不卡”。一般业务同学不用动；只有明显卡顿才调。
  cpuThrottle: {
    idle: {
      sphereOccluderUpdateMs: 50, // 停着时：阴影辅助计算多久更新一次(ms)。0=每次都算（最准，但更耗）。
      receiverEnsureMs: 380, // 停着时：自动修复多久检查一次(ms)。越小越稳，但更耗。
    },
    interactive: {
      sphereOccluderUpdateMs: 240, // 动的时候：阴影辅助计算多久更新一次(ms)。越大越省性能，但动的时候可能更“跟手性差一点”。
      receiverEnsureMs: 900, // 动的时候：自动修复多久检查一次(ms)。越大越省性能。
    },
  },

  enableDynamicShadowMapSize: false, // 动态阴影分辨率（高级选项）：开了会让“动的时候更省”，但可能偶尔切换时卡一下；默认关。
  shadowMapSizeTiers: {
    idleDesktop: 4096, // 聚光/平行光：停着时(电脑)阴影清晰度（越大越清晰但更吃显卡）。
    interactiveDesktop: 2048, // 聚光/平行光：动的时候(电脑)阴影清晰度（动的时候降一档更流畅）。
    idleMobile: 3072, // 聚光/平行光：停着时(手机)阴影清晰度。
    interactiveMobile: 2048, // 聚光/平行光：动的时候(手机)阴影清晰度。
    idlePointDesktop: 2048, // 点光源：停着时(电脑)阴影清晰度。
    interactivePointDesktop: 1536, // 点光源：动的时候(电脑)阴影清晰度。
    idlePointMobile: 1536, // 点光源：停着时(手机)阴影清晰度。
    interactivePointMobile: 1024, // 点光源：动的时候(手机)阴影清晰度。
  },
};

// 追光渲染（PathTracer）质量配置
// - 这部分决定“清晰度/降噪/速度”的平衡。
// - 通俗理解：
//   1) targetSamples 越大：最终更干净，但达到最终画质更慢。
//   2) renderScale 越大：更清晰，但更吃显卡/更容易掉帧。
//   3) bounces 越大：反弹光更真实，但算得更慢。
//   4) filterGlossyFactor 越小：高光噪点更少，但会稍微变“糊”。
// - 调参建议：
//   - 先改 targetSamples（最稳妥），再改 renderScale，最后再动 bounces。
export const SOLID_PATH_TRACER_QUALITY = {
  // 消费端（Solid.html）：偏展示效果，追求最终观感。
  consumer: {
    useAntiSpeckleProfile: true, // 是否使用“抗噪实验档”。true 更干净但更重；false 更均衡更稳。
    desktopRenderScaleCap: 0.64, // 桌面端 renderScale 的安全上限：用于降低首帧编译/显存压力。
    bounces: 3, // 光线最多反弹次数：越高越真实（尤其暗部与间接光），但耗时明显增加。常用 2~4。
    multipleImportanceSampling: true, // 多重重要性采样：通常建议保持 true，可明显降低噪点；关闭后可能更快但更脏。
    // 两套质量档：可按业务诉求在 default / antiSpeckle 之间切换。
    profiles: {
      // 默认均衡档：速度与画质折中。
      default: {
        targetSamples: 200, // 目标采样数：达到这个值后基本收敛。越高越干净，等待越久。
        renderScaleMobile: 0.42, // 手机端内部渲染比例：越高越清晰但更慢（建议 0.35~0.5）。
        renderScaleDesktop: 0.75, // 桌面端内部渲染比例：越高越清晰但更吃显卡（建议 0.6~0.85）。
        filterGlossyFactor: 1, // 高光抗噪强度：越小越去噪（会更柔和），1 基本不额外模糊。
        expRamp: 24, // 曝光爬坡样本阈值：在前 N 个样本内做曝光平滑过渡，减轻“首帧忽明忽暗”。
        expLo: 0.55, // 低样本阶段曝光：前期噪点多时稍微压暗，减少刺眼闪烁。
        expHi: 0.7, // 收敛后曝光：达到较高样本后回到最终亮度。
        toneMappingExposureBase: 0.7, // 进入追光时的基础曝光：用于初始化与重置后的默认亮度。
      },
      // 抗噪档：更高采样、更激进降噪，适合“质量优先”。
      antiSpeckle: {
        targetSamples: 380, // 抗噪档采样数更高：最终更干净，但收敛时间会更长。
        renderScaleMobile: 0.45, // 抗噪档手机渲染比例：略升一点清晰度，代价是更吃性能。
        renderScaleDesktop: 0.82, // 抗噪档桌面渲染比例：更高细节，建议仅在中高配设备开启。
        filterGlossyFactor: 0.78, // 抗噪档高光去噪更强：能抑制“亮点噪斑”，但会轻微损失锐利感。
        expRamp: 28, // 抗噪档曝光爬坡区间：给更多样本做平滑，减少亮度跳变。
        expLo: 0.63, // 抗噪档低样本曝光：前期更稳，不容易炸白。
        expHi: 0.74, // 抗噪档高样本曝光：最终亮度目标。
        toneMappingExposureBase: 0.72, // 抗噪档基础曝光：略高以保证最终层次感。
      },
    },
  },

  // 生产端（Solid_Portrait_Create.html）：偏编辑交互，追求流畅与稳定。
  producer: {
    bounces: 3, // 编辑端反弹次数：一般不建议超过 3，否则交互时明显变慢。
    multipleImportanceSampling: true, // 同上，编辑端也建议保持 true，减少“看起来脏”的主观感受。
    renderScaleMobile: 0.38, // 编辑端手机 renderScale：偏低保证拖拽/旋转跟手。
    renderScaleDesktop: 0.62, // 编辑端桌面 renderScale：平衡“能看清”与“可交互”。
    filterGlossyFactor: 1.0, // 编辑端高光抗噪：默认 1.0 保持材质边缘锐度。
    targetSamplesMobile: 120, // 编辑端手机目标采样：不追求最终极致收敛，够看即可。
    targetSamplesDesktop: 160, // 编辑端桌面目标采样：桌面略高，保证材质判断更稳定。
    toneMappingExposureBase: 0.7, // 编辑端预览曝光（常态）。
    toneMappingExposureWarmup: 0.4, // 初始少采样阶段临时压暗，减少闪白/噪点感知。
    warmupSampleThreshold: 4, // 小于该采样数时用 warmup 曝光。
  },
};

/**
 * 光栅预览：屏幕空间 GTAO（Ground Truth Ambient Occlusion）
 * - 仅 `useAdvancedRender === false` 时由宿主（Solid / Portrait）走 EffectComposer；与 PathTracer 真值层分离。
 * - `blendIntensity` 控制 AO 乘到整幅画面的强度：略低于 1 可减轻「直射区被二次压暗」观感（仍非严格分离直射/间接的物理分解）。
 * - `resolutionScale*`：GTAO 内部分辨率相对画布比例，<1 省 GPU、略糊。
 * - 与空气透视/景深：`SolidRasterPreviewComposer` 在雾或景深开启时走 forward render（不叠 GTAO），以便 AtmosphereManager 的 renderer 补丁能生效；关雾关景深后仍走本配置的 GTAO 链。
 */
export const SOLID_RASTER_PREVIEW_AO = {
  enabled: true,
  blendIntensity: 0.62, // 0~1：越大缝/角越暗，过大易让受光面发闷。
  resolutionScaleDesktop: 1.0,
  resolutionScaleMobile: 0.55,
  /** 轨道拖拽时跳过 composer，直接 forward render，减轻交互尖峰 */
  skipComposerWhileInteracting: true,
  /** GTAO 核参数（与 three.js webgl_postprocessing_gtao 示例同源命名） */
  radius: 0.22,
  distanceExponent: 1.1,
  thickness: 1.0,
  scale: 1.0,
  samples: 12,
  distanceFallOff: 1.0,
  screenSpaceRadius: false,
  pdLumaPhi: 10,
  pdDepthPhi: 2,
  pdNormalPhi: 3,
  pdRadius: 6,
  pdRadiusExponent: 2,
  pdRings: 2,
  pdSamples: 12,
  /** SH（SOLID_RASTER_IRRADIANCE_PROBES）同开时略降 GTAO 叠加强度，减轻与低频漫反射「双压暗」（仍非严格的直射/间接分解）。 */
  blendIntensityScaleWhenIrradianceSh: 0.9,
};

/**
 * 光栅预览合成预设：改此处后刷新页面即可做 A/B。
 * - balanced：默认（尊重各块 enabled 与 blend 数值）。
 * - ao_only：关掉 SH 路径，仅 PMREM + GTAO + 直射，AO 主导缝/角。
 * - ao_soft_sh：保留 SH，略压 diffuse 与 AO，减轻叠暗。
 */
export const SOLID_RASTER_PREVIEW_LIGHTING_PRESET = 'ao_only';

export function getSolidRasterPreviewLightingDerived() {
  const preset = String(SOLID_RASTER_PREVIEW_LIGHTING_PRESET || 'balanced');
  const irr = SOLID_RASTER_IRRADIANCE_PROBES || {};
  const baseSh = !!irr.enabled;
  if (preset === 'ao_only') {
    return {
      shActive: false,
      aoBlendMultiplier: 1.06,
      diffuseMixMultiplier: 1,
    };
  }
  if (preset === 'ao_soft_sh') {
    return {
      shActive: baseSh,
      aoBlendMultiplier: 0.9,
      diffuseMixMultiplier: 0.88,
    };
  }
  return {
    shActive: baseSh,
    aoBlendMultiplier: 1,
    diffuseMixMultiplier: 1,
  };
}

// 光栅预览：空间 L2 球谐漫反射（与多 Cube 环境探针配套，非路径追踪）
// - 通俗：在「模型 + 地面 + 墙」上按世界位置混合多套 SH，逼近漫反射半球积分的低频部分；高光仍主要走 envMap/PMREM。
// - 与 SOLID_RASTER_PREVIEW_AO：同开时易叠暗，用 `diffuseMixScaleWhenScreenAo` 略压 SH 权重，避免缝内死黑。
// 性能：`debounceMaxMs` 防止加载阶段连续 request 把探针饿死；`shPixelStride` 降低 readPixels 之后的 CPU 积分量；换场景会重置节流（见 SolidPreviewLighting）。
// 观感：`diffuseMix` / `envIblDiffuseScale` / `diffuseMixScaleWhenScreenAo` 决定「是否发灰、发亮」。
export const SOLID_RASTER_IRRADIANCE_PROBES = {
  enabled: true, // 总开关：false 时不算 SH、不注入 shader，仅保留现有多 PMREM 行为。
  diffuseMix: 0.52, // SH 漫反射注入强度：与 GTAO 同开时略低于旧默认，减轻与屏幕 AO 叠暗。
  envIblDiffuseScale: 0.5, // 压低 MeshStandard/Physical 的 iblIrradiance，减轻与 SH 重复计数。
  /** SOLID_RASTER_PREVIEW_AO.enabled 时，将有效 diffuseMix 乘该系数（仅 JS 侧 uniform，不重编 shader）。 */
  diffuseMixScaleWhenScreenAo: 0.9,
  weightPower: 2.2, // 探针混合：反距离权重的指数，越大越接近「最近探针」。
  minWeight: 0.08, // 混合下限，避免某探针权重为 0 导致不连续。
  cubeSizeIdle: 56, // 静止立方体贴图边长：64→56 略减 GPU+readPixels 量，仍够 SH 低频。
  cubeSizeInteractive: 32, // 交互时边长：略小于 40，减轻拖拽/轨道时每轮 3×Cube+PMREM 的尖峰。
  minIntervalMsIdle: 2800, // 静止时最短刷新间隔(ms)。
  minIntervalMsInteractive: 5600, // 交互时更长间隔，减少与轨道抢同一帧的尖峰。
  freezeShWhileInteractive: true, // true=交互时不重算 SH 系数（沿用上一轮），只跑 cube+PMREM。
  /** 探针调度：仅 debounce 时，若短时间大量 request，会一直推迟；设上限后最迟也会执行一轮。 */
  envDebounceMs: 200,
  debounceMaxMs: 850,
  /** 从 cubemap 积 SH 时对像素步进采样：1=最准最慢，2≈1/4 像素循环量，3 更快略噪。 */
  shPixelStride: 2,
  /** 上一轮 SH 无效(readPixels/尺寸失败)时，允许用更短间隔重试，避免长时间停留在「无 SH」状态。 */
  shRetryMinIntervalMs: 420,
  /**
   * 地面接触区对「探针间接漫反射」的近似压暗（非 SSAO，不能替代离线 AO）。
   * 低阶 SH 无法表达缝里的高频遮挡；仅用「离地高度」线性 smoothstep 在 h→0 处梯度弱，仍像「远近」而非「开口变小、单位面积入射变少」。
   * 用缝宽启发式 gapRaw = H/(H+h) 再 pow：h 很小时 gap→1，随缝变宽平滑下降，更接近「立体角/入射功率」直觉。
   * norBindPow：用 max(法线朝地项, gap^α) 绑定权重，减轻接触环带插值法线偏弱导致的「缝仍亮」。
   * crevice*：在 occ 之外再乘一条纯 gap 的线，大关系上强制缝内 SH/IBL 远弱于开口区（宁可粗，不可亮缝）。
   */
  groundShOcclusionEnabled: true,
  groundShOcclusionHeight: 0.2, // 特征缝宽 H；略大则「近地一条带」都按缝处理，大关系更稳
  groundShOcclusionCavityPow: 3.45, // solidNearGr = gapRaw^pow，越大贴缝越暗
  groundShOcclusionNorBindPow: 0.34, // ndEff = max(nd, gapRaw^该值)，建议 0.25~0.45
  groundShOcclusionNormalExp: 2.55,
  groundShOcclusionMinFactor: 0.003, // occ 全满时 SH 乘子下限（易出噪则回调到 0.01）
  groundShOcclusionAmount: 1.0,
  groundShCrevicePow: 2.65, // pow(gapRaw,·) 专用于 crevice 线
  groundShCreviceShMul: 0.028, // 缝内再乘到 SH 上（相对开口区）
  groundShCreviceIblMul: 0.14,
  groundShCreviceAmount: 1.0, // 0 关闭 crevice 线，仅保留 occ
  /** 同上几何权重，额外压低 iblIrradiance（IBL 也常把亮地卷进底侧）。 */
  groundIblOcclusionAmount: 0.62,
  groundIblOcclusionMinFactor: 0.12,
};

// 消费端 Solid.html / 生产端 Solid_Portrait_Create.html 共用：排错日志 + #debug-log-panel
// false：hwLog/addHwLog/diagnosticPanelLog 不输出（含 console）、排错面板强制隐藏；true：输出并显示面板。
export const SOLID_DEBUG_PANEL = {
  enabled: false,
};
