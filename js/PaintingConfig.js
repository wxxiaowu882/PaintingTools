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

// 光栅“互照近似”配置（非重型GI）：用于模拟墙/地/模型之间的微妙反射影响。
export const SOLID_RASTER_BOUNCE_APPROX = {
  enabled: true, // 总开关：false=完全关闭互照近似并回退到当前纯环境反射逻辑。
  qualityPreset: 'balanced', // 一键档位：'low'|'balanced'|'high'，只改这一行即可切整套强度策略。
  interactiveScale: 0.72, // 交互时强度缩放：拖拽/旋转时自动乘这个系数，保证流畅与稳定。
  mobileScale: 0.78, // 移动端额外缩放：手机默认再降一点，减少发灰和性能波动。
  nonPbrFallback: false, // 非PBR兜底：true 时也会给 Phong/Lambert 注入轻量互照（默认保守关闭）。
  presets: {
    low: {
      baseIntensity: 0.045, // 基础互照能量：越大暗部越“活”，但过高会漂灰。
      energyClampMin: 0.0, // 能量下限：通常保持 0 即可。
      energyClampMax: 0.075, // 能量上限：防止补偿过强导致“假亮”。
      darkBandStart: 0.22, // 暗部起始阈值（0~1）：越小覆盖范围越大。
      darkBandEnd: 0.68, // 暗部结束阈值（0~1）：与 start 共同控制作用带宽。
      groundBounceWeight: 1.0, // 地面反照贡献权重：影响模型下半部的柔和回光感。
      wallBounceWeight: 0.85, // 墙面反照贡献权重：影响侧面/背光侧的环境互照感。
      modelBounceWeight: 0.55, // 模型间互照权重：多物体场景中的互相“串光”强度。
      colorBleedSaturation: 0.35, // 颜色互染饱和度：越大墙地颜色越会“染”到模型暗部。
      receiverScaleGround: 0.45, // 地面作为接收体的强度缩放：通常低于模型，避免地面发脏。
      receiverScaleWall: 0.52, // 墙面作为接收体的强度缩放：略高于地面，保留空间包裹感。
      receiverScaleModel: 1.0, // 模型作为接收体的强度缩放：主受益对象，建议保持 1。
      emissiveGain: 0.9, // 写入 emissiveIntensity 的增益：越高互照越明显。
      maxModelColorSamples: 28, // 统计模型平均颜色采样数：越大越稳定但更耗CPU。
    },
    balanced: {
      baseIntensity: 0.07, // 均衡档基础互照能量：兼顾“机制感”和写生审美。
      energyClampMin: 0.0, // 能量下限：通常保持 0。
      energyClampMax: 0.115, // 能量上限：限制过亮，避免暗部失去体积。
      darkBandStart: 0.18, // 暗部起始阈值：中等覆盖，主要作用在半暗/暗部。
      darkBandEnd: 0.72, // 暗部结束阈值：与 start 形成柔和过渡带。
      groundBounceWeight: 1.0, // 地面贡献权重。
      wallBounceWeight: 0.95, // 墙面贡献权重。
      modelBounceWeight: 0.7, // 模型间贡献权重。
      colorBleedSaturation: 0.48, // 颜色互染强度：保留微妙冷暖互染但不过分。
      receiverScaleGround: 0.56, // 地面接收体缩放。
      receiverScaleWall: 0.64, // 墙面接收体缩放。
      receiverScaleModel: 1.0, // 模型接收体缩放。
      emissiveGain: 1.0, // emissive 增益。
      maxModelColorSamples: 36, // 模型颜色采样数。
    },
    high: {
      baseIntensity: 0.095, // 高质档基础互照能量：更接近真实互照，但更需限幅控制。
      energyClampMin: 0.0, // 能量下限。
      energyClampMax: 0.145, // 能量上限：高质档也要控住，避免“提亮滤镜感”。
      darkBandStart: 0.14, // 暗部起始阈值：覆盖更广，细节更丰富。
      darkBandEnd: 0.78, // 暗部结束阈值：让半明部也有少量互照连续性。
      groundBounceWeight: 1.0, // 地面贡献权重。
      wallBounceWeight: 1.05, // 墙面贡献权重：高质档略高，增强空间包裹感。
      modelBounceWeight: 0.9, // 模型间贡献权重：多物体时互照更可见。
      colorBleedSaturation: 0.62, // 颜色互染强度：高质档可更明显，但仍保持克制。
      receiverScaleGround: 0.66, // 地面接收体缩放。
      receiverScaleWall: 0.76, // 墙面接收体缩放。
      receiverScaleModel: 1.05, // 模型接收体缩放：略高以强调结构体块。
      emissiveGain: 1.08, // emissive 增益。
      maxModelColorSamples: 48, // 模型颜色采样数。
    },
  },
};

