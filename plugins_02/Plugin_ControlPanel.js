// 【核心解耦】：动态控制面板注入器
window.ControlPanel = {
    inject: function(config) {
        const mode = config.mode || 'consumer';
        const isProducer = (mode === 'producer');

        // 1. 构建 HTML 字符串 (以消费端 Solid.html 为基准，并做极其安全的内联事件保护)
        const htmlString = `
        <div id="main-panel" class="control-panel ${isProducer ? '' : 'minimized'}" style="overflow:visible;">
            <div id="render-progress-bar" style="position:absolute;top:0;left:0;height:1.5px;background:rgba(255,255,255,0.7);width:0%;transition:width 0.1s linear, opacity 0.3s;pointer-events:none;border-radius:12px 0 0 0;"></div> 
            <div onclick="window.togglePanel()" class="flex justify-between items-center cursor-pointer select-none" style="padding:2px 4px; margin:-4px -4px 0 -4px;">
                <div class="flex gap-2" style="position:relative; z-index:10;"> 
                    <button id="btn-rerender" style="display:${isProducer ? 'inline-block' : 'none'}; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.2); color:#fff; padding:3px 6px; border-radius:4px; font-size:9px; cursor:pointer; transition:all 0.3s;" onclick="event.stopPropagation(); window.forceReRender();" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'" title="强制清理缓存并重启物理光追">▷ 重新渲染</button> 
                    <button id="btn-stoprender" style="display:${isProducer ? 'inline-block' : 'none'}; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.2); color:#fff; padding:3px 6px; border-radius:4px; font-size:9px; cursor:pointer; transition:all 0.3s;" onclick="event.stopPropagation(); window.stopRender();" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'" title="完全关闭光追引擎，释放所有显存累加缓冲">□ 停止渲染</button> 
                </div>
                <div class="flex items-center gap-2 flex-1 justify-end"> 
                    <div id="render-status" class="flex items-center gap-1.5 transition-opacity" style="opacity:1;"> 
                        <span id="render-status-text" class="text-[9px] text-white/40 tracking-wider">未渲染</span> 
                    </div> 
                    <div id="toggle-icon" class="text-white/60 text-[18px] flex items-center justify-center" style="width:28px; height:28px; margin-right:0px;">${isProducer ? '✕' : '▲'}</div> 
                </div> 
            </div> 
            <div class="panel-content">
                <div class="flex gap-2 mb-2 border-b border-white/5 pb-2 pt-1" style="position:relative; z-index:105;"> 
                    <div class="flex items-center gap-1 flex-[1]" style="position:relative;">
                        <span class="text-[11px] text-white/50 tracking-wider font-medium">光向</span> 
                        <div class="custom-select-trigger" onclick="window.toggleCustomSelect(event, 'dir-options')" id="dir-trigger">默认顶侧</div>
                        <div class="custom-options" id="dir-options">
                            <div class="custom-option selected" onclick="window.selectCustomOpt('lightDir', '113,45', '默认顶侧', this)">默认顶侧</div> 
                            <div class="custom-option" onclick="window.selectCustomOpt('lightDir', '90,6', '正面光', this)">正面光</div>
                            <div class="custom-option" onclick="window.selectCustomOpt('lightDir', '0,6', '左侧光', this)">左侧光</div> 
                            <div class="custom-option" onclick="window.selectCustomOpt('lightDir', '180,6', '右侧光', this)">右侧光</div>
                            <div class="custom-option" onclick="window.selectCustomOpt('lightDir', '270,6', '背面光', this)">背面光</div> 
                            <div class="custom-option" onclick="window.selectCustomOpt('lightDir', '90,85', '顶面光', this)">顶面光</div>
                            <div class="custom-option" onclick="window.selectCustomOpt('lightDir', '90,-45', '前下底光', this)">前下底光</div> 
                        </div> 
                    </div> 
                    <div class="flex items-center gap-1 flex-[0.9]" style="position:relative;">
                        <span class="text-[11px] text-white/50 tracking-wider font-medium">光源</span> 
                        <div class="custom-select-trigger" onclick="window.toggleCustomSelect(event, 'light-options')" id="light-trigger">聚光灯</div>
                        <div class="custom-options" id="light-options"> 
                            <div class="custom-option selected" onclick="window.selectCustomOpt('light', 'spot', '聚光灯', this)">聚光灯</div>
                            <div class="custom-option" onclick="window.selectCustomOpt('light', 'point', '点光源', this)">点光源</div> 
                            <div class="custom-option" onclick="window.selectCustomOpt('light', 'dir', '平行光', this)">平行光</div>
                            <div class="custom-option" onclick="window.selectCustomOpt('light', 'rect', '面积光', this)">面积光</div> 
                        </div> 
                    </div> 
                    <div class="flex items-center gap-1 flex-[1]" style="position:relative;">
                        <span class="text-[11px] text-white/40 tracking-wider">材质</span> 
                        <div class="custom-select-trigger" onclick="window.toggleCustomSelect(event, 'mat-options')" id="mat-trigger">自带材质</div>
                        <div class="custom-options" id="mat-options"> 
                            <div class="custom-option selected" onclick="window.selectCustomOpt('mat', 'origin', '自带材质', this)">自带材质</div>
                            <div class="custom-option" onclick="window.selectCustomOpt('mat', '0', '哑光石膏', this)">哑光石膏</div>
                            <div class="custom-option" onclick="window.selectCustomOpt('mat', '1', '亮面陶瓷', this)">亮面陶瓷</div> 
                            <div class="custom-option" onclick="window.selectCustomOpt('mat', '2', '镜面金属', this)">镜面金属</div>
                            <div class="custom-option" onclick="window.selectCustomOpt('mat', '3', '透明玻璃', this)">透明玻璃</div> 
                            <div class="custom-option" onclick="window.selectCustomOpt('mat', '4', '磨砂玻璃', this)">磨砂玻璃</div> 
                        </div> 
                    </div> 
                </div>
                <div class="flex justify-between items-center mt-2 mb-2"> 
                    <div class="flex items-center gap-2"> 
                        <span class="text-[11px] text-white/50 tracking-wider mr-1 font-medium">光源调节</span>
                        <span class="text-[9px] env-btn" id="wall-btn" onclick="window.toggleWall()">☐ 背景墙</span> 
                        ${isProducer ? '' : '<span class="text-[9px] env-btn active" id="anno-toggle-btn" onclick="window.toggleAnnotations()">☑ 标注</span>'} 
                    </div> 
                    <div class="flex items-center gap-3">
                        <span onclick="window.resetAll()" class="text-[11px] text-white/40 hover:text-white cursor-pointer transition-colors px-1 font-medium">↺ 重置</span> 
                    </div> 
                </div> 
                <div class="flex gap-3">
                    <div class="slider-row flex-1"><span class="slider-label">方向</span><input type="range" id="lightAzimuth" min="0" max="360" value="113"><span id="azimuthVal" class="slider-val">113</span></div>
                    <div class="slider-row flex-1"><span class="slider-label">高度</span><input type="range" id="lightElevation" min="-90" max="85" value="45"><span id="elevationVal" class="slider-val">45</span></div>
                </div> 
                <div class="flex gap-3">
                    <div class="slider-row flex-1"><span class="slider-label">距离</span><input type="range" id="lightDistance" min="5" max="40" value="21"><span id="distanceVal" class="slider-val">21</span></div>
                    <div class="slider-row flex-1"><span class="slider-label">色温</span><input type="range" id="lightTemp" min="30" max="90" value="38"><span id="tempVal" class="slider-val">3800</span></div>
                </div> 
                <div class="flex gap-3">
                    <div class="slider-row flex-1"><span class="slider-label">大小</span><input type="range" id="lightSize" min="1.0" max="4.0" step="0.1" value="1.9"><span id="sizeVal" class="slider-val">1.9</span></div>
                    <div class="slider-row flex-1"><span class="slider-label">强度</span><input type="range" id="lightIntensity" min="0.8" max="5" step="0.1" value="1.7"><span id="intensityVal" class="slider-val">1.7</span></div>
                </div> 
                <div style="height:1px; background:rgba(255,255,255,0.05); margin:6px 0 8px 0;"></div>
                <div class="flex gap-3">
                    <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label" style="width:auto; margin-right:4px;">画面概括</span><input type="range" id="posterizeSlider" min="0" max="19" step="1" value="0" oninput="window.updatePosterizeVal(this)"><span id="posterizeVal" class="slider-val" style="width:30px;">无</span></div>
                </div>
            </div> 
        </div>`;

        // 【新增】：色阶概括 UI 滑块交互逻辑 (算法映射：1=20阶 -> 19=2阶)
        window.updatePosterizeVal = function(slider) {
            const val = parseInt(slider.value);
            let levels = 0; let text = "无";
            if (val > 0) { levels = 21 - val; text = levels + "阶"; }
            document.getElementById('posterizeVal').innerText = text;
            if(window.changePosterize) window.changePosterize(levels);
            
            // 【核心修复】：强制同步全局变量，保证生产端导出 JSON 时能抓到正确的值！
            window.posterizeLevel = levels;
            window.needsUpdate = true;
        };

        // 2. 注入 DOM
        const container = document.createElement('div');
        container.innerHTML = htmlString;
        document.body.appendChild(container.firstElementChild);
        if(window.hwLog) window.hwLog(`[UI] 控制面板已动态注入 (${mode} 模式)`);
    }
};