window.PluginManager = {
    plugins: [],
    // 【1. 核心状态隔离区 Core.State】统一接管 window.currentEditorMode 等零散状态
    State: { currentMode: 'translate', activePlugin: null },
    // 【2. 集中事件路由区 Core.Input】代替 HTML 里的各种 window.addEventListener
    Input: {
        init: function() {
            if (this._initialized) return;
            window.addEventListener('keydown', e => window.PluginManager.triggerEvent('onKeyDown', e));
            window.addEventListener('keyup', e => window.PluginManager.triggerEvent('onKeyUp', e));
            // 我们暂不立刻绑定 pointer 事件，以免与目前 HTML 里的监听直接重复。
            // 待下一步 HTML 瘦身时，我们再开启这里的 pointer 监听。
            this._initialized = true;
        }
    },
    // 【3. 内存管理池 Core.Memory】(占位，未来集中处理 dispose 避免泄漏)
    Memory: { register: function(obj) {} },

    // 升级版装载接口，支持传入 config (如声明该插件绑定的交互模式)
    register: function(pluginName, pluginInstance, config = {}) {
        if (!this.plugins.some(p => p.name === pluginName)) {
            this.plugins.push({ name: pluginName, instance: pluginInstance, config: config });
            if (window.hwLog) window.hwLog(`[Core] 成功挂载插件: ${pluginName}`);
            this.Input.init(); // 只要有插件注册，就自动唤醒核心事件监听
        }
    },

    // 统一生命周期广播 (保留原有功能，用于渲染循环等无差别广播)
    trigger: function(hookName, context) {
        let interruptMainLoop = false;
        this.plugins.forEach(p => {
            if (typeof p.instance[hookName] === 'function') {
                try { if (p.instance[hookName](context) === true) interruptMainLoop = true; } 
                catch (e) { if (window.hwLog) window.hwLog(`[Core] 🚨 ${p.name} 崩溃拦截 (${hookName}): ${e.message}`); }
            }
        });
        return interruptMainLoop;
    },

    // 【新增】精准路由事件分发，彻底解决快捷键和鼠标冲突
    triggerEvent: function(eventName, event) {
        let handled = false;
        this.plugins.forEach(p => {
            if (typeof p.instance[eventName] === 'function') {
                // 路由规则：1. 全局监听型插件 (未声明 mode) 或 2. 匹配当前激活模式的专属插件
                const isGlobal = !p.config || !p.config.mode;
                const isActive = p.config && p.config.mode === this.State.currentMode;
                if (isGlobal || isActive) {
                    try { 
                        // 【核心修复】：只有当插件明确返回 true 时，才视为拦截并阻断核心层的后续逻辑
                        if (p.instance[eventName](event) === true) {
                            handled = true; 
                        }
                    } 
                    catch (e) { if (window.hwLog) window.hwLog(`[Core] 🚨 事件分发崩溃 (${eventName}): ${e.message}`); }
                }
            }
        });
        return handled;
    },
    
    // 【新增】统一的模式切换接口，代替零散的 window.setMode 内部硬编码
    setMode: function(mode) {
        this.State.currentMode = mode;
        if (window.hwLog) window.hwLog(`[Core] 模式已切换为: ${mode}`);
    }
};