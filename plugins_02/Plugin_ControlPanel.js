// 【核心解耦】：动态控制面板注入器
window.ControlPanel = { inject: function(config) { const mode = config.mode || 'consumer'; const isProducer = (mode === 'producer'); // 1. 构建 HTML 字符串 (以消费端 Solid.html 为基准，并做极其安全的内联事件保护)
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
                    <div class="flex gap-3" style="flex-direction:column; gap:8px;">
                        <div class="slider-row flex-1" style="margin-bottom:0; align-items:center;">
                            <label style="display:flex; align-items:center; cursor:pointer; width:70px; margin-right:4px;">
                                <input type="checkbox" id="posterizeEnable" onchange="window.togglePosterize(this.checked)" style="margin-right:4px;"> <span class="slider-label" style="width:auto; margin-right:0;">画面概括</span>
                            </label>
                            <input type="range" id="posterizeSlider" min="0" max="19" step="1" value="0" oninput="window.updatePosterizeVal(this)" disabled style="opacity:0.5;">
                            <span id="posterizeVal" class="slider-val" style="width:30px;">无</span>
                        </div>
                        <div class="slider-row flex-1" style="margin-bottom:0; align-items:center;">
                            <label style="display:flex; align-items:center; cursor:pointer; width:70px; margin-right:4px;">
                                <input type="checkbox" id="fogEnable" onchange="window.toggleFog(this.checked)" style="margin-right:4px;"> <span class="slider-label" style="width:auto; margin-right:0;">空气透视</span>
                            </label>
                            <input type="range" id="fogSlider" min="0" max="0.3" step="0.001" value="0.02" oninput="window.updateFogUI()" disabled style="opacity:0.5;">
                            <span id="fogVal" class="slider-val" style="width:30px;">0.02</span>
                        </div>
                        <div id="fog-advanced-panel" style="display:none; flex-direction:column; gap:8px; margin-top:4px; padding:8px; background:rgba(0,0,0,0.3); border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                            <div style="display:flex; gap:8px; align-items:center;">
                                <input type="color" id="fogColorPicker" value="#ffffff" onchange="window.updateFogUI()" style="width:24px; height:24px; padding:0; border:none; background:none; cursor:pointer; border-radius:4px;" title="雾气色彩">
                                <div class="custom-select-trigger" onclick="window.toggleCustomSelect(event, 'fog-type-options')" id="fog-type-trigger" style="flex:1;">☁️ 基础平流雾</div>
                                <div class="custom-options" id="fog-type-options">
                                    <div class="custom-option selected" onclick="window.selectFogType('basic', '☁️ 基础平流雾', this)">☁️ 基础平流雾</div>
                                    <div class="custom-option" onclick="window.selectFogType('noise', '🌫️ 扰动体积雾', this)">🌫️ 扰动体积雾</div>
                                    <div class="custom-option" onclick="window.selectFogType('height', '⛰️ 高度沉淀雾', this)">⛰️ 高度沉淀雾</div>
                                    <div class="custom-option" onclick="window.selectFogType('animated', '🌬️ 动态流云雾', this)">🌬️ 动态流云雾</div>
                                </div>
                            </div>
                            <div id="fog-params-noise" style="display:none; flex-direction:column; gap:8px;">
                                <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label" style="width:45px; text-align:left;">扰动强度</span><input type="range" id="fogParam1_noise" min="0" max="5" step="0.1" value="2.5" oninput="window.updateFogUI()"><span id="fogVal1_noise" class="slider-val" style="width:24px;">2.5</span></div>
                                <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label" style="width:45px; text-align:left;">雾团大小</span><input type="range" id="fogParam2_noise" min="0.1" max="3" step="0.1" value="1.2" oninput="window.updateFogUI()"><span id="fogVal2_noise" class="slider-val" style="width:24px;">1.2</span></div>
                            </div>
                            <div id="fog-params-height" style="display:none; flex-direction:column; gap:8px;">
                                <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label" style="width:45px; text-align:left;">沉淀高度</span><input type="range" id="fogParam1_height" min="-5" max="15" step="0.1" value="1.5" oninput="window.updateFogUI()"><span id="fogVal1_height" class="slider-val" style="width:24px;">1.5</span></div>
                                <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label" style="width:45px; text-align:left;">边缘衰减</span><input type="range" id="fogParam2_height" min="0.1" max="5" step="0.1" value="0.8" oninput="window.updateFogUI()"><span id="fogVal2_height" class="slider-val" style="width:24px;">0.8</span></div>
                            </div>
                            <div id="fog-params-animated" style="display:none; flex-direction:column; gap:8px;">
                                <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label" style="width:45px; text-align:left;">飘动速度</span><input type="range" id="fogParam1_animated" min="0" max="5" step="0.1" value="1.0" oninput="window.updateFogUI()"><span id="fogVal1_animated" class="slider-val" style="width:24px;">1.0</span></div>
                                <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label" style="width:45px; text-align:left;">扰动强度</span><input type="range" id="fogParam2_animated" min="0" max="5" step="0.1" value="2.0" oninput="window.updateFogUI()"><span id="fogVal2_animated" class="slider-val" style="width:24px;">2.0</span></div>
                            </div>
                        </div>
                        
                        <div class="slider-row flex-1" style="margin-bottom:0; align-items:center; margin-top:8px;">
                            <label style="display:flex; align-items:center; cursor:pointer; width:70px; margin-right:4px;">
                                <input type="checkbox" id="dofEnable" onchange="window.toggleDoF(this.checked)" style="margin-right:4px;"> <span class="slider-label" style="width:auto; margin-right:0;">景深虚实</span>
                            </label>
                            <span class="slider-label" style="width:30px; text-align:right;">光圈</span>
                            <input type="range" id="dofApertureSlider" min="0.1" max="16" step="0.1" value="2.8" oninput="window.updateDoFUI()" disabled style="opacity:0.5; margin:0 4px;">
                            <span id="dofApertureVal" class="slider-val" style="width:32px;">f/2.8</span>
                        </div>
                        <div id="dof-advanced-panel" style="display:none; flex-direction:column; gap:8px; margin-top:4px; padding:8px; background:rgba(0,0,0,0.3); border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                            <div class="slider-row flex-1" style="margin-bottom:0;">
                                <span class="slider-label" style="width:45px; text-align:left;">对焦距离</span>
                                <input type="range" id="dofFocusSlider" min="0.1" max="40" step="0.1" value="10" oninput="window.updateDoFUI()">
                                <span id="dofFocusVal" class="slider-val" style="width:24px;">10.0</span>
                            </div>
                            <div style="font-size:9px; color:#aaa; text-align:center; padding-top:2px;">💡 提示：开启后，双击模型表面可自动对焦</div>
                        </div>
                    </div>
                </div> 
            </div>`; // 【新增】：色阶概括 UI 滑块交互逻辑 (算法映射：1=20阶 -> 19=2阶)
    window.updatePosterizeVal = function(slider) { const val = parseInt(slider.value); let levels = 0; let text = "无"; if (val > 0) { levels = 21 - val; text = levels + "阶"; }
    document.getElementById('posterizeVal').innerText = text; if(window.changePosterize) window.changePosterize(levels); // 【核心修复】：强制同步全局变量，保证生产端导出 JSON 时能抓到正确的值！
    window.posterizeLevel = levels; window.needsUpdate = true; }; 
    window.togglePosterize = function(checked) { const slider = document.getElementById('posterizeSlider'); const valDisp = document.getElementById('posterizeVal'); if(slider) { slider.disabled = !checked; slider.style.opacity = checked ? '1' : '0.5'; const savedVal = slider.value; const savedText = valDisp ? valDisp.innerText : "无"; if (!checked) { if(window.changePosterize) window.changePosterize(0); slider.value = savedVal; if(valDisp) valDisp.innerText = savedText; } else { window.updatePosterizeVal(slider); } } };
    window.currentFogType = 'basic';
    window.toggleFog = function(checked) { 
        const slider = document.getElementById('fogSlider'); const panel = document.getElementById('fog-advanced-panel');
        if(slider) { slider.disabled = !checked; slider.style.opacity = checked ? '1' : '0.5'; }
        if(panel) { panel.style.display = checked ? 'flex' : 'none'; }
        window.updateFogUI(); 
    };
    window.selectFogType = function(type, text, el) {
        if(el) { el.parentElement.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected')); el.classList.add('selected'); }
        const trigger = document.getElementById('fog-type-trigger'); if(trigger) trigger.innerText = text;
        ['noise', 'height', 'animated'].forEach(t => { const p = document.getElementById('fog-params-' + t); if(p) p.style.display = 'none'; });
        if(type !== 'basic') { const activeP = document.getElementById('fog-params-' + type); if(activeP) activeP.style.display = 'flex'; }
        window.currentFogType = type; window.updateFogUI();
    };
    window.updateFogUI = function() {
        const checkbox = document.getElementById('fogEnable'); const checked = checkbox ? checkbox.checked : false;
        const slider = document.getElementById('fogSlider'); const val = slider ? parseFloat(slider.value) : 0.02;
        const valDisp = document.getElementById('fogVal'); if(valDisp && slider) valDisp.innerText = val.toFixed(2);
        const colorPicker = document.getElementById('fogColorPicker'); const color = colorPicker ? colorPicker.value : '#ffffff';
        let p1 = 0, p2 = 0;
        if(window.currentFogType !== 'basic') {
            const s1 = document.getElementById('fogParam1_' + window.currentFogType); const s2 = document.getElementById('fogParam2_' + window.currentFogType);
            if(s1) { p1 = parseFloat(s1.value); const d1 = document.getElementById('fogVal1_' + window.currentFogType); if(d1) d1.innerText = p1.toFixed(1); }
            if(s2) { p2 = parseFloat(s2.value); const d2 = document.getElementById('fogVal2_' + window.currentFogType); if(d2) d2.innerText = p2.toFixed(1); }
        }
        if(window.changeAtmosphere) window.changeAtmosphere(checked, val, { type: window.currentFogType, color: color, p1: p1, p2: p2 });
    };

    // 【新增】：景深虚实 (DoF) 联控逻辑
    window.toggleDoF = function(checked) {
        const apertureSlider = document.getElementById('dofApertureSlider');
        const panel = document.getElementById('dof-advanced-panel');
        if(apertureSlider) { apertureSlider.disabled = !checked; apertureSlider.style.opacity = checked ? '1' : '0.5'; }
        if(panel) { panel.style.display = checked ? 'flex' : 'none'; }
        window.updateDoFUI();
    };

    window.updateDoFUI = function() {
        const checkbox = document.getElementById('dofEnable'); const checked = checkbox ? checkbox.checked : false;
        const aSlider = document.getElementById('dofApertureSlider'); const aperture = aSlider ? parseFloat(aSlider.value) : 2.8;
        const aVal = document.getElementById('dofApertureVal'); if(aVal) aVal.innerText = 'f/' + aperture.toFixed(1);
        
        const fSlider = document.getElementById('dofFocusSlider'); const focus = fSlider ? parseFloat(fSlider.value) : 10;
        const fVal = document.getElementById('dofFocusVal'); if(fVal) fVal.innerText = focus.toFixed(1);
        
        // 桥接 API：待后续打通底层时生效，由于加了安全判定，当前拨动滑块不会报错
        if(window.changeDoF) window.changeDoF(checked, aperture, focus);
    };
    // 2. 注入 DOM
    const container = document.createElement('div'); container.innerHTML = htmlString; document.body.appendChild(container.firstElementChild); if(window.hwLog) window.hwLog(`[UI] 控制面板已动态注入 (${mode} 模式)`); } };