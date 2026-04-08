window.PluginManager = { plugins: [], // 【1. 核心状态隔离区 Core.State】统一接管 window.currentEditorMode 等零散状态
    State: { currentMode: 'translate', activePlugin: null }, // 【2. 集中事件路由区 Core.Input】代替 HTML 里的各种 window.addEventListener
    Input: { init: function() { if (this._initialized) return; window.addEventListener('keydown', e => {
        // 消费端：禁止任何标注被 Delete/Backspace 删除（统一总闸，避免逐插件打补丁）
        if (window.__SOLID_CONSUMER__ && (e.key === 'Delete' || e.key === 'Backspace' || e.keyCode === 46 || e.keyCode === 8)) {
            try { e.preventDefault(); } catch(_e) {}
            try { e.stopImmediatePropagation(); } catch(_e) { try { e.stopPropagation(); } catch(__e) {} }
            return true;
        }
        return window.PluginManager.triggerEvent('onKeyDown', e);
    });
    window.addEventListener('keyup', e => window.PluginManager.triggerEvent('onKeyUp', e)); // 我们暂不立刻绑定 pointer 事件，以免与目前 HTML 里的监听直接重复。
    // 待下一步 HTML 瘦身时，我们再开启这里的 pointer 监听。
    this._initialized = true; } }, // 【3. 内存管理池 Core.Memory】统一接管 3D 对象的彻底销毁，杜绝 WebGL 显存泄漏
    Memory: { disposeHierarchy: function(obj) { if (!obj) return; if (obj.parent) obj.parent.remove(obj); obj.traverse(child => { if (child.isMesh) { if (child.geometry) child.geometry.dispose(); if (child.material) {
    if (Array.isArray(child.material)) { child.material.forEach(m => m.dispose()); } else { child.material.dispose(); } } } }); } }, // 升级版装载接口，支持传入 config (如声明该插件绑定的交互模式)
    register: function(pluginName, pluginInstance, config = {}) { if (!this.plugins.some(p => p.name === pluginName)) { this.plugins.push({ name: pluginName, instance: pluginInstance, config: config });
    if (window.hwLog) window.hwLog(`[Core] 成功挂载插件: ${pluginName}`); this.Input.init(); // 只要有插件注册，就自动唤醒核心事件监听
    } }, // 统一生命周期广播 (保留原有功能，用于渲染循环等无差别广播)
    trigger: function(hookName, context) { let interruptMainLoop = false; this.plugins.forEach(p => { if (typeof p.instance[hookName] === 'function') {
    try { if (p.instance[hookName](context) === true) interruptMainLoop = true; }
    catch (e) { if (window.hwLog) window.hwLog(`[Core] 🚨 ${p.name} 崩溃拦截 (${hookName}): ${e.message}`); } } }); return interruptMainLoop; }, // 【新增】精准路由事件分发，彻底解决快捷键和鼠标冲突
    triggerEvent: function(eventName, event) { let handled = false; this.plugins.forEach(p => { if (typeof p.instance[eventName] === 'function') { // 路由规则：1. 全局监听型插件 (未声明 mode) 或 2. 匹配当前激活模式的专属插件
    const isGlobal = !p.config || !p.config.mode; const isActive = p.config && p.config.mode === this.State.currentMode; if (isGlobal || isActive) { try { // 【核心修复】：只有当插件明确返回 true 时，才视为拦截并阻断核心层的后续逻辑
    if (p.instance[eventName](event) === true) { handled = true;
    if (eventName === 'onBeforePointerDown') { const _d = window.diagnosticPanelLog || window.hwLog; if (_d) _d(`[ColorSampleDbg] onBeforePointerDown 拦截 ← 插件「${p.name}」 (PluginManager.State.currentMode=${this.State.currentMode})`); } } }
    catch (e) { if (window.hwLog) window.hwLog(`[Core] 🚨 事件分发崩溃 (${eventName}): ${e.message}`); } } } }); return handled; }, // 【新增】统一的模式切换接口，代替零散的 window.setMode 内部硬编码

    /** 统一解除 Alt+拖拽放置中等交互态；宿主经 setMode 即可，勿逐个 Manager 清理。opts: { reason, nextMode } */
    cancelInteractivePlacing: function(opts) {
        this.plugins.forEach(p => {
            const inst = p.instance;
            if (!inst || typeof inst.cancelInteractivePlacing !== 'function') return;
            try { inst.cancelInteractivePlacing(opts || {}); }
            catch (e) { if (window.hwLog) window.hwLog(`[Core] cancelInteractivePlacing (${p.name}): ${e.message}`); }
        });
    },

    setMode: function(mode) {
        this.cancelInteractivePlacing({ reason: 'mode', nextMode: mode });
        this.State.currentMode = mode;
        if (window.hwLog) window.hwLog(`[Core] 模式已切换为: ${mode}`);
    },

    _syncSolidConsumerDetail: function(ownerInstance, id) {
        if (!window.__SOLID_CONSUMER__ || !window.SolidAnnotationDetail || typeof window.SolidAnnotationDetail.syncFromSelection !== 'function') return;
        let text = '';
        if (id != null && ownerInstance && typeof ownerInstance.getDetailText === 'function') {
            try { text = ownerInstance.getDetailText(id) || ''; } catch (_e) {}
        }
        try { window.SolidAnnotationDetail.syncFromSelection(ownerInstance, id, text); } catch (_e2) {}
    },

    /** 互斥选中：清空其它已注册且带 selectedId 的插件，再让 owner 选中 id（可为 null）。新增可选中插件时无需再枚举其它 Manager。 */
    setExclusiveSelection: function(ownerInstance, id) {
        if (!ownerInstance || ownerInstance.selectedId === undefined) return;
        this.plugins.forEach(p => {
            const inst = p.instance;
            if (!inst || inst.selectedId === undefined || inst === ownerInstance) return;
            inst.selectedId = null;
            if (typeof inst.highlightSelected === 'function') inst.highlightSelected();
        });
        ownerInstance.selectedId = id;
        if (typeof ownerInstance.highlightSelected === 'function') ownerInstance.highlightSelected();
        if (window.needsUpdate !== undefined) window.needsUpdate = true;
        this._syncSolidConsumerDetail(ownerInstance, id);
    },
    
    // 【新增】统一的全局标注反选接口。彻底解耦，由主程序统一调用。
    clearAllSelections: function() {
        let cleared = false;
        this.plugins.forEach(p => {
            if (p.instance && p.instance.selectedId !== undefined && p.instance.selectedId !== null) {
                p.instance.selectedId = null;
                if (typeof p.instance.highlightSelected === 'function') {
                    p.instance.highlightSelected();
                    cleared = true;
                }
            }
        });
        if (cleared && window.needsUpdate !== undefined) window.needsUpdate = true;
        if (window.__SOLID_CONSUMER__ && window.SolidAnnotationDetail && typeof window.SolidAnnotationDetail.clear === 'function') {
            try { window.SolidAnnotationDetail.clear(); } catch (_e) {}
        }
    }
};