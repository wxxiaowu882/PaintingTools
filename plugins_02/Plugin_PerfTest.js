import * as THREE from 'three'; window.PerfTester = { isTesting: false, testDone: false, state: 'init', idleFrames: 0, maxIdleFrames: 2, targetSamples: 2, startTime: 0,
    lastFrameTime: 0, // 新增：用于跟踪上一帧的时间，实现防挂机
    compileWaitFrames: 0, testMesh: null, originalRenderScale: 0.75, _auditPathTracer: null, originalBounces: undefined, onProgress: null, lastReportedPhase: '',
    _emitPhase: function (phase) { if (phase === this.lastReportedPhase) return; this.lastReportedPhase = phase; if (typeof this.onProgress === 'function') { try { this.onProgress(phase); } catch (_e) {} } },
    _syncPerfPhase: function (pathTracer) { const s = pathTracer.samples; if (s === 0) this._emitPhase('shader_compile'); else if (s === 1) this._emitPhase('sample_1'); else this._emitPhase('sample_2'); },
    start: function(scene, camera, pathTracer, isMobile, onSuccess, onFail) { this.isTesting = true; this.testDone = false; this.state = 'idle';
    this.idleFrames = 0; this.compileWaitFrames = 0; this.onSuccess = onSuccess; this.onFail = onFail; this.isMobile = isMobile; window.hwLog("[PerfTest] 初始化性能测试独立模块..."); // 【回调最初的奇迹】：必须恢复 0.1 的极低分辨率 Hack！
    // 事实证明，这正是让设备瞬间秒杀 Shader 编译的核心武器。
    // 去掉它会导致显卡在全分辨率下默默卡死，从而引发长达 60s 的 0 帧超时！
    this.originalRenderScale = pathTracer.renderScale || (isMobile ? 0.42 : 0.75); this._auditPathTracer = pathTracer; this.originalBounces = pathTracer.bounces != null ? pathTracer.bounces : 3; pathTracer.bounces = Math.min(2, this.originalBounces); pathTracer.renderScale = 0.1; const testGeo = new THREE.BoxGeometry(1, 1, 1); const testMat = new THREE.MeshPhysicalMaterial({ color: 0x888888 });
    this.testMesh = new THREE.Mesh(testGeo, testMat); this.testMesh.position.set(0, 0, 0); scene.add(this.testMesh); // 【核心修复 1】：必须把场景和相机正式喂给光追引擎，构建初始 BVH 树。
    // 之前遗漏了这步，导致底层引擎没有拿到几何数据，陷入永远无法完成编译的假死状态！
    camera.updateMatrixWorld(); pathTracer.setScene(scene, camera); if(typeof pathTracer.updateMaterials === 'function') pathTracer.updateMaterials();
    if(typeof pathTracer.updateLights === 'function') pathTracer.updateLights(); pathTracer.reset(); // 必须重置，否则引擎不知道场景已变，会死锁在第0帧！
    window.hwLog("[PerfTest] 极简测试体(Box)已挂载并同步状态，等待 UI 渲染缓冲 (" + this.maxIdleFrames + "帧)..."); this.lastReportedPhase = ''; this._emitPhase('scene_connect'); }, update: function(pathTracer) { if (!this.isTesting || this.testDone) return; if (this.state === 'idle') { this._emitPhase('ui_buffer'); this.idleFrames++;
    if (this.idleFrames >= this.maxIdleFrames) { this._emitPhase('gpu_dispatch'); this.state = 'testing'; window.hwLog(`[PerfTest] 缓冲结束，正式向 GPU 发起光追测试指令 (目标: ${this.targetSamples}帧)...`); }
    return; }
    if (this.state === 'testing') { const currentSamples = pathTracer.samples; const tStart = performance.now(); try { pathTracer.renderSample(); } catch (e) { window.hwLog(`[PerfTest] 渲染核爆异常: ${e.message}`); this.fail();
    return; }
    const duration = performance.now() - tStart; const now = performance.now(); // 【新增】：全局防切屏/防挂机保护盾
    if (document.hidden) { this.lastFrameTime = now; return; // 页面在后台时，完全冻结测试逻辑
    }
    // 【核心修复 3】：仅在纯渲染阶段(>0帧)才检测帧率异常！
    // 第 1 帧编译 Shader 本来就会阻塞主线程数秒，如果此时触发丢弃，会导致计时逻辑彻底混乱
    if (currentSamples > 0 && this.lastFrameTime !== 0 && (now - this.lastFrameTime > 1000)) { window.hwLog(`[PerfTest] 探测到页面切换或系统级卡顿，冻结计时并丢弃被污染的帧数据...`); this.startTime += (now - this.lastFrameTime); this.lastFrameTime = now; return; }
    this.lastFrameTime = now; if (currentSamples === 0) { if (pathTracer.samples === 0) { if (this.compileWaitFrames === 0) { this.startTime = now; window.hwLog("[PerfTest] 底层 Shader 编译中，此阶段阻塞较高，请耐心等待..."); }
    this.compileWaitFrames++; const limit = this.isMobile ? 45000 : 60000; // 放宽编译等待上限
    if (now - this.startTime > limit) { window.hwLog(`[PerfTest] 审计未通过: Shader 编译真实运算超时 (>${limit/1000}s)，触发系统降级`); this.fail(); return; } } else if (pathTracer.samples === 1) { const totalCompileTime = now - this.startTime; window.hwLog(`[PerfTest] 第 1 帧(含Shader编译)就绪! 共拦截 ${this.compileWaitFrames} 个空转帧，总耗时: ${totalCompileTime.toFixed(1)}ms`); } }
    else if (currentSamples > 0) { const maxLimit = this.isMobile ? 3500 : 6000; // 放宽单帧渲染时间上限
    if (duration > maxLimit) { window.hwLog(`[PerfTest] 审计未通过: 单帧纯渲染耗时过长 (${duration.toFixed(1)}ms，阈值 ${maxLimit}ms)，触发系统降级`); this.fail(); return; }
    if (currentSamples === 1 && pathTracer.samples === 2) { window.hwLog(`[PerfTest] 第 2 帧纯GPU渲染顺利完成，耗时: ${duration.toFixed(1)}ms`); } }
    this._syncPerfPhase(pathTracer);
    if (pathTracer.samples >= this.targetSamples) { window.hwLog(`[PerfTest] 性能审计完美通过！正在移交控制权...`); this.success(pathTracer); } } }, success: function(pathTracer) { this.cleanup(); pathTracer.renderScale = this.originalRenderScale;
    pathTracer.reset(); window.hwLog(`[PerfTest] 测试结束，恢复高清分辨率: ${this.originalRenderScale}`); if (this.onSuccess) this.onSuccess(); }, fail: function() { this.cleanup(); if (this.onFail) this.onFail(); }, cleanup: function() { this.isTesting = false;
    this.testDone = true; this.lastReportedPhase = ''; if (this._auditPathTracer) { this._auditPathTracer.bounces = this.originalBounces; } this._auditPathTracer = null; this.originalBounces = undefined; if (this.testMesh) { if (this.testMesh.parent) this.testMesh.parent.remove(this.testMesh); if (this.testMesh.geometry) this.testMesh.geometry.dispose(); if (this.testMesh.material) this.testMesh.material.dispose();
    this.testMesh = null; } } }; // 【接入标准插件规范】
    window.PerfTester.onUpdate = function(context) { if (this.isTesting && context.pathTracer) { this.update(context.pathTracer); return true; }
    return false; }; if (window.PluginManager) window.PluginManager.register('Performance_Auditor', window.PerfTester);
