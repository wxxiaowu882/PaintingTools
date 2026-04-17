// PaintingTools 全局配置文件（给业务同学看的）
// - 你只需要知道：这里改的是“效果/性能”的取舍，不会影响功能逻辑。
// - 规则：每个配置项都写清楚“改了会怎样、建议怎么改”。

// 光栅阴影“性能模式”配置（只在低配/降级模式生效）
// - 场景在动的时候：阴影可以先糊一点/粗一点，换流畅
// - 场景停下来后：自动回到清晰好看的最终效果
// - 你通常只需要改：恢复时间、交互时的阴影质量档位

export const SOLID_RASTER_SHADOW_PERF = {
  // 总开关：不想要“动时降质量、停后恢复”，就设为 false（效果回到原样）。
  enableDynamicRasterShadowQuality: true,

  // 调试开关：设为 true 会在控制台打印“现在是动/静止哪一档”，一般不用开。
  debugLog: false,

  // “判定还在动”的时间(ms)：操作停止后，这段时间内仍按“交互档”处理（太小会抖，太大恢复慢）。
  interactWindowMs: 180,

  // “停下来多久恢复清晰”(ms)：越小越快变清晰，但可能频繁切换；默认 800ms 比较稳。
  restoreDelayMs: 800,

  // 阴影质量分档：idle=停着时的最终效果；interactive=拖动/旋转时的临时效果。
  qualityTiers: {
    idle: {
      // 电脑端：停着时阴影“细腻程度”（越大越细腻，但更吃性能；建议 16~28）。
      tapsDesktop: 24,
      // 手机端：停着时阴影“细腻程度”（越大越细腻，但更吃性能；建议 8~16）。
      tapsMobile: 12,
      // 去条纹：1=更不容易出现一圈圈/条纹；0=可能更容易出条纹（一般别关）。
      rotate: 1,
    },
    interactive: {
      // 电脑端：动的时候临时阴影质量（越小越流畅，但越“糊/粗”）。建议 8~14。
      tapsDesktop: 12,
      // 手机端：动的时候临时阴影质量（越小越流畅，但越“糊/粗”）。建议 6~10。
      tapsMobile: 8,
      // 去条纹：建议保持 1。
      rotate: 1,
    },
  },

  // CPU 节流：主要影响“动的时候卡不卡”。一般业务同学不用动；只有明显卡顿才调。
  cpuThrottle: {
    idle: {
      // 停着时：阴影辅助计算多久更新一次(ms)。0=每次都算（最准，但更耗）。
      sphereOccluderUpdateMs: 50,
      // 停着时：自动修复多久检查一次(ms)。越小越稳，但更耗。
      receiverEnsureMs: 380,
    },
    interactive: {
      // 动的时候：阴影辅助计算多久更新一次(ms)。越大越省性能，但动的时候可能更“跟手性差一点”。
      sphereOccluderUpdateMs: 240,
      // 动的时候：自动修复多久检查一次(ms)。越大越省性能。
      receiverEnsureMs: 900,
    },
  },

  // 动态阴影分辨率（高级选项）：开了会让“动的时候更省”，但可能偶尔切换时卡一下；默认关。
  enableDynamicShadowMapSize: false,
  shadowMapSizeTiers: {
    // 聚光/平行光：停着时(电脑)阴影清晰度（越大越清晰但更吃显卡）。
    idleDesktop: 4096,
    // 聚光/平行光：动的时候(电脑)阴影清晰度（动的时候降一档更流畅）。
    interactiveDesktop: 2048,
    // 聚光/平行光：停着时(手机)阴影清晰度。
    idleMobile: 3072,
    // 聚光/平行光：动的时候(手机)阴影清晰度。
    interactiveMobile: 2048,
    // 点光源：停着时(电脑)阴影清晰度。
    idlePointDesktop: 2048,
    // 点光源：动的时候(电脑)阴影清晰度。
    interactivePointDesktop: 1536,
    // 点光源：停着时(手机)阴影清晰度。
    idlePointMobile: 1536,
    // 点光源：动的时候(手机)阴影清晰度。
    interactivePointMobile: 1024,
  },
};

