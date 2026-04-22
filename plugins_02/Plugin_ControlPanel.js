// 【极致体验打磨版】：卡片化分区、绝对防遮挡、触控热区放大、Base 原生手感复原
window.ControlPanel = {
    inject: function(config) {
        const mode = config.mode || 'consumer';
        const isProducer = (mode === 'producer');
        const showRenderButtons = (typeof config.showRenderButtons === 'boolean') ? config.showRenderButtons : isProducer;

        const htmlString = `
            <div id="main-panel" class="control-panel ${isProducer ? '' : 'minimized'}" style="overflow:visible; padding: 10px 12px; margin: 0 !important; bottom: 10px !important; width: 98% !important; max-width: 400px;">
                
                <div id="render-progress-bar" style="position:absolute;top:0;left:0;height:2px;background:rgba(255,255,255,0.45);width:0%;transition:width 0.12s linear, opacity 0.25s;pointer-events:none;border-radius:12px 12px 0 0;"></div>
                <div id="render-toast" style="position:absolute; top:-34px; left:8px; padding:6px 10px; border-radius:999px; background:rgba(0,0,0,0.55); border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.85); font-size:10px; letter-spacing:1px; opacity:0; transform:translateY(6px); pointer-events:none; transition:opacity .25s ease, transform .25s ease;">正在开启渲染…</div>
                
                <div class="flex justify-between items-center select-none" style="padding:0px 2px; margin:0px; cursor:pointer;" onclick="window.togglePanel()">
                    <div class="flex gap-2" style="position:relative; z-index:1;"> 
                        <button id="btn-rerender" style="display:${showRenderButtons ? 'inline-block' : 'none'}; background:transparent; border:1px solid rgba(255,255,255,0.2); color:#fff; padding:3px 6px; border-radius:4px; font-size:10px; cursor:pointer; transition:all 0.2s;" onclick="event.stopPropagation(); if(window.forceReRender)window.forceReRender()" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">▷ 开启渲染</button> 
                        <button id="btn-stoprender" style="display:${showRenderButtons ? 'inline-block' : 'none'}; background:transparent; border:1px solid rgba(255,255,255,0.2); color:#fff; padding:3px 6px; border-radius:4px; font-size:10px; cursor:pointer; transition:all 0.2s;" onclick="event.stopPropagation(); if(window.stopRender)window.stopRender()" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">□ 停止渲染</button> 
                    </div>
                    <div class="flex items-center gap-2 flex-1 justify-end">
                        <div id="render-status" style="display:none;">
                            <span id="render-status-text" style="display:none;">未渲染</span>
                        </div>
                        <button type="button" id="btn-anno-eye" title="隐藏标注" aria-pressed="true" style="display:${isProducer ? 'none' : 'inline-flex'}; align-items:center; justify-content:center; width:26px; height:26px; margin:0; padding:0; border:none; background:transparent; color:rgba(255,255,255,0.72); cursor:pointer; border-radius:6px; flex-shrink:0; transition:color .15s, background .15s, opacity .15s;" onclick="event.stopPropagation(); if(window.toggleAnnotations) window.toggleAnnotations();" onmouseover="this.style.color='rgba(255,255,255,0.95)'; this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.color='rgba(255,255,255,0.72)'; this.style.background='transparent'">
                            <span class="anno-eye-on" style="display:inline-flex; line-height:0;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></span>
                            <span class="anno-eye-off" style="display:none; line-height:0;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></span>
                        </button>
                        <span onclick="event.stopPropagation(); window.resetAll()" class="text-[11px] text-white/70 hover:text-white cursor-pointer transition-colors px-1" style="font-weight:500;">↺ 重置</span>
                        <div id="toggle-icon" class="text-white/80 flex items-center justify-center cursor-pointer" style="width:24px; height:24px; font-size:12px; margin-left:4px;">${isProducer ? '✕' : '▲'}</div> 
                    </div>
                </div>

                <div class="panel-content" style="margin-top: 8px;">
                    
                    <style>
                        /* 真正的无缝文件夹 Tab 融合 */
                        /* 左右负边距 -12px，与外部容器内边距完美抵消，绝对贴边 */
                        .tab-nav { display: flex; position: relative; z-index: 20; padding: 0; margin: 0 -12px; }
                        .tab-btn { flex: 1; text-align: center; padding: 6px 0; font-size: 11px; color: rgba(255,255,255,0.65); cursor: pointer; border: 1px solid transparent; border-bottom: none; border-radius: 8px 8px 0 0; position: relative; transition: 0.2s; letter-spacing: 1px; margin-bottom: -1px; }
                        .tab-btn.active { color: #fff; background: rgba(30,30,30,0.95); border-color: rgba(255,255,255,0.08); border-bottom: 2px solid rgba(30,30,30,0.95); font-weight: 500; }
                        
                        /* 核心修改：
                           1. margin: 0 -12px -10px -12px; 完美抵消父级 12px 的左右边距和 10px 底部边距，100% 绝对重合外框！
                           2. border-radius: 0 0 12px 12px; 底部圆角绝对贴合主控面板的 12px 大圆角！
                           3. 彻底去掉 border-top，让 Tab 按钮和内容区黑色背景完全无缝融为一体！
                           4. z-index: 20; 提升层级，彻底解决下拉菜单弹出时被上方按钮遮挡的问题！*/
                        .tab-container { background: rgba(30,30,30,0.95); border: none; border-radius: 0 0 12px 12px; padding: 8px 6px; margin: 0 -12px -10px -12px; position: relative; z-index: 20; }
                        
                        /* 强制放大所有下拉框的文字 */
                        .custom-select-trigger { font-size: 13px !important; padding: 4px 6px !important; }
                        .custom-option { font-size: 13px !important; padding: 6px 10px !important; }
                        
                        /* 强制清零间隔，极大压缩行距 */
                        .tab-content { display: none; flex-direction: column; gap: 0px; }
                        .tab-content.active { display: flex; }
                        
                        /* 强制提亮继承自原生 HTML 的暗色文字 */
                        .slider-label { color: rgba(255,255,255,0.7) !important; }
                        .slider-val { color: rgba(255,255,255,0.9) !important; }
                        
                        /* 压缩滑块占用的纵向高度 */
                        input[type=range] { flex: 1; margin: 0 6px; -webkit-appearance: none; background: transparent; height: 22px; min-width: 0; outline: none; }
                        input[type=range]::-webkit-slider-runnable-track { height: 2px; background: rgba(255,255,255,0.25); border-radius: 1px; pointer-events: none; }
                        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; height: 20px; width: 20px; border-radius: 50%; background: #fff; margin-top: -9px; cursor: grab; box-shadow: 0 1px 6px rgba(0,0,0,0.6); }
                        
                        /* 卡片化模块包装，极大压缩间距 */
                        .module-card { background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.03); border-radius: 4px; padding: 4px 6px; margin-bottom: 2px; }
                        .module-card:last-child { margin-bottom: 0; }
                        .module-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
                        .module-title { font-size: 11px; color: rgba(255,255,255,0.8); font-weight: bold; display: flex; align-items: center; cursor: pointer; }
                        
                        /* 方形大热区取色器 */
                        .color-wrapper { flex: none; width: 32px; height: 32px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.28); border-radius: 6px; overflow: hidden; display: flex; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.35); }
                        .color-wrapper input[type="color"] { width: 100%; height: 100%; border: none; padding: 0; background: transparent; cursor: pointer; opacity: 1; }
                        .color-wrapper input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
                        .color-wrapper input[type="color"]::-webkit-color-swatch { border: none; border-radius: 2px; }
                    </style>

                    <div class="tab-nav">
                        <div id="btn-tab-light" class="tab-btn active" onclick="window.switchTab('light')">主光</div>
                        <div id="btn-tab-env" class="tab-btn" onclick="window.switchTab('env')">环境光</div>
                        <div id="btn-tab-atmos" class="tab-btn" onclick="window.switchTab('atmos')">氛围</div>
                        <div id="btn-tab-assist" class="tab-btn" onclick="window.switchTab('assist')">辅助</div>
                    </div>

                    <div class="tab-container">
                        <div id="content-tab-light" class="tab-content active">
                            <div class="flex gap-2 mb-2" style="position:relative; z-index:105;">
                                <div class="flex items-center gap-2 flex-1" style="position:relative;">
                                    <span class="slider-label" style="width:auto;">光向</span>
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
                                <div class="flex items-center gap-2 flex-[0.9]" style="position:relative;">
                                    <span class="slider-label" style="width:auto;">光源</span>
                                    <div class="custom-select-trigger" onclick="window.toggleCustomSelect(event, 'light-options')" id="light-trigger">聚光灯</div>
                                    <div class="custom-options" id="light-options"> 
                                        <div class="custom-option selected" onclick="window.selectCustomOpt('light', 'spot', '聚光灯', this)">聚光灯</div>
                                        <div class="custom-option" onclick="window.selectCustomOpt('light', 'point', '点光源', this)">点光源</div> 
                                        <div class="custom-option" onclick="window.selectCustomOpt('light', 'dir', '平行光', this)">平行光</div>
                                        <div class="custom-option" onclick="window.selectCustomOpt('light', 'rect', '面积光', this)">面积光</div> 
                                    </div>
                                </div>
                            </div>
                            
                            <div class="flex gap-2" style="margin-bottom:6px;">
                                <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label">方向</span><input type="range" id="lightAzimuth" min="0" max="360" value="113"><span id="azimuthVal" class="slider-val">113</span></div>
                                <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label">高度</span><input type="range" id="lightElevation" min="-90" max="85" value="45"><span id="elevationVal" class="slider-val">45</span></div>
                            </div> 
                            <div class="flex gap-2" style="margin-bottom:6px;">
                                <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label">距离</span><input type="range" id="lightDistance" min="5" max="40" value="21"><span id="distanceVal" class="slider-val">21</span></div>
                                <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label">色温</span><input type="range" id="lightTemp" min="30" max="90" value="38"><span id="tempVal" class="slider-val">3800</span></div>
                            </div> 
                            <div class="flex gap-2">
                                <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label">大小</span><input type="range" id="lightSize" min="1.0" max="25.0" step="0.1" value="1.9"><span id="sizeVal" class="slider-val">1.9</span></div>
                                <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label">强度</span><input type="range" id="lightIntensity" min="0.2" max="8" step="0.1" value="1.7"><span id="intensityVal" class="slider-val">1.7</span></div>
                            </div>
                        </div>

                        <div id="content-tab-env" class="tab-content">
                            <div style="display:flex; flex-direction:row; align-items:center; justify-content:space-around; padding: 10px 4px; pointer-events:none;">
                                <div style="display:flex; align-items:center; pointer-events:auto;">
                                    <label class="flex items-center cursor-pointer mb-0" style="margin-right:6px;" onmouseenter="const c=document.getElementById('wall-btn-checkbox'); if(c) c.checked=!!window.hasWall;">
                                        <input type="checkbox" id="wall-btn-checkbox" onchange="window.toggleWall()" class="flat-checkbox" style="width:14px; height:14px; margin-right:4px;"> 
                                        <span style="color:rgba(255,255,255,0.8); font-size:11px; font-weight:bold; white-space:nowrap;">背景墙</span>
                                    </label>
                                    <span id="wall-btn" style="display:none;"></span>
                                    <div class="color-wrapper" style="width:28px; height:28px; flex:none;"><input type="color" id="env-wall-color" value="#cccccc" oninput="window.setEnvColor('wall', this.value)"></div>
                                </div>
                                <div style="display:flex; align-items:center; gap:6px; pointer-events:auto;">
                                    <span style="font-size:11px; color:rgba(255,255,255,0.65); white-space:nowrap;">地面</span>
                                    <div class="color-wrapper" style="width:28px; height:28px; flex:none;"><input type="color" id="env-ground-color" value="#cccccc" oninput="window.setEnvColor('ground', this.value)"></div>
                                </div>
                            </div>
                            <div class="slider-row" style="margin-bottom:0; margin-top:4px; align-items:center; padding:0 4px 8px; pointer-events:auto; width:100%; box-sizing:border-box;">
                                <span class="slider-label" style="width:22px; flex:none; text-align:right;">天光</span>
                                <div class="color-wrapper" style="width:28px; height:28px; flex:none;"><input type="color" id="env-sky-color" value="#0d0d0f" oninput="window.setEnvColor('sky', this.value)"></div>
                                <div id="sky-env-light-slot" style="flex:1; min-width:0; display:flex; align-items:center; gap:4px;"></div>
                            </div>
                        </div>

                        <div id="content-tab-atmos" class="tab-content">
                            <div class="module-card">
                                <div class="flex items-center justify-between mb-2" style="position:relative; z-index:104;">
                                    <label class="module-title mb-0" style="margin-right:8px;">
                                        <input type="checkbox" id="fogEnable" onchange="window.toggleFogAdvanced(this.checked)" class="flat-checkbox" style="width:14px; height:14px; margin-right:6px;"> 空气透视
                                    </label>
                                    <div id="fog-extra-controls" style="display:none; gap:6px; align-items:center;">
                                        <div style="position:relative; flex:none; width:88px;">
                                            <div class="custom-select-trigger" onclick="window.toggleCustomSelect(event, 'fog-type-options')" id="fog-type-trigger" style="padding:2px 6px !important; font-size:11px !important;">基础平流雾</div>
                                            <div class="custom-options" id="fog-type-options" style="min-width:88px;">
                                                <div class="custom-option selected" onclick="window.selectFogType('basic', '基础平流雾', this)" style="padding:4px 8px !important; font-size:11px !important;">基础平流雾</div>
                                                <div class="custom-option" onclick="window.selectFogType('noise', '扰动体积雾', this)" style="padding:4px 8px !important; font-size:11px !important;">扰动体积雾</div>
                                                <div class="custom-option" onclick="window.selectFogType('height', '高度沉淀雾', this)" style="padding:4px 8px !important; font-size:11px !important;">高度沉淀雾</div>
                                                <div class="custom-option" onclick="window.selectFogType('animated', '动态流云雾', this)" style="padding:4px 8px !important; font-size:11px !important;">动态流云雾</div>
                                            </div>
                                        </div>
                                        <div class="color-wrapper" style="flex:none; width:22px; height:22px;"><input type="color" id="fogColorPicker" value="#ffffff" onchange="window.updateFogUI()" style="opacity:1; cursor:pointer;" disabled></div>
                                    </div>
                                </div>
                                <div class="slider-row" style="margin-bottom:0;">
                                    <span class="slider-label" style="width:28px;">浓度</span>
                                    <input type="range" id="fogSlider" min="0" max="0.3" step="0.001" value="0.02" oninput="window.onFogSliderInput()" style="opacity:0.3;">
                                    <span id="fogVal" class="slider-val" style="width:22px;">0.02</span>
                                </div>
                                <div id="fog-advanced-panel" style="display:none; flex-direction:column; gap:2px; margin-top:2px; padding-top:0; border-top:none;">
                                    <div id="fog-params-noise" style="display:none; gap:6px;">
                                        <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label" style="width:28px;">扰动</span><input type="range" id="fogParam1_noise" min="0" max="5" step="0.1" value="2.5" oninput="window.updateFogUI()"><span id="fogVal1_noise" class="slider-val" style="width:16px;">2.5</span></div>
                                        <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label" style="width:28px;">大小</span><input type="range" id="fogParam2_noise" min="0.1" max="3" step="0.1" value="1.2" oninput="window.updateFogUI()"><span id="fogVal2_noise" class="slider-val" style="width:16px;">1.2</span></div>
                                    </div>
                                    <div id="fog-params-height" style="display:none; gap:6px;">
                                        <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label" style="width:28px;">高度</span><input type="range" id="fogParam1_height" min="-5" max="15" step="0.1" value="1.5" oninput="window.updateFogUI()"><span id="fogVal1_height" class="slider-val" style="width:16px;">1.5</span></div>
                                        <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label" style="width:28px;">衰减</span><input type="range" id="fogParam2_height" min="0.1" max="5" step="0.1" value="0.8" oninput="window.updateFogUI()"><span id="fogVal2_height" class="slider-val" style="width:16px;">0.8</span></div>
                                    </div>
                                    <div id="fog-params-animated" style="display:none; gap:8px;">
                                        <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label" style="width:28px;">速度</span><input type="range" id="fogParam1_animated" min="0" max="5" step="0.1" value="1.0" oninput="window.updateFogUI()"><span id="fogVal1_animated" class="slider-val" style="width:16px;">1.0</span></div>
                                        <div class="slider-row flex-1" style="margin-bottom:0;"><span class="slider-label" style="width:28px;">强度</span><input type="range" id="fogParam2_animated" min="0" max="5" step="0.1" value="2.0" oninput="window.updateFogUI()"><span id="fogVal2_animated" class="slider-val" style="width:16px;">2.0</span></div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="module-card">
                                <div class="module-header mb-1">
                                    <label class="module-title mb-0">
                                        <input type="checkbox" id="dofEnable" onchange="window.toggleDoF(this.checked)" class="flat-checkbox" style="width:14px; height:14px; margin-right:6px;"> 景深虚实
                                    </label>
                                </div>
                                <div style="display:flex; gap:6px; align-items:stretch; width:100%; box-sizing:border-box;">
                                    <div class="slider-row dof-slider-col" style="margin-bottom:0; flex:1 1 0; min-width:0;">
                                        <span class="slider-label" style="width:28px; flex:none;">光圈</span>
                                        <input type="range" id="dofApertureSlider" min="0.1" max="16" step="0.1" value="2.8" oninput="window.onDoFSliderInput()" style="opacity:0.3; flex:1; min-width:0;">
                                        <span id="dofApertureVal" class="slider-val" style="width:30px; flex:none;">f/2.8</span>
                                    </div>
                                    <div id="dof-advanced-panel" style="display:none; flex:1 1 0; min-width:0; margin:0; padding:0; border:none;">
                                        <div class="slider-row dof-slider-col" style="margin-bottom:0;">
                                            <span class="slider-label" style="width:28px; flex:none;">焦距</span>
                                            <input type="range" id="dofFocusSlider" min="0.1" max="40" step="0.1" value="10" oninput="window.onDoFSliderInput()" style="flex:1; min-width:0;">
                                            <span id="dofFocusVal" class="slider-val" style="width:30px; flex:none;">10.0</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div id="content-tab-assist" class="tab-content">
                            <div class="module-card" style="display:flex; flex-direction:column; gap:12px;">
                                <div class="flex items-center" style="gap:6px; position:relative; z-index:103;">
                                    <span style="color:rgba(255,255,255,0.8); font-size:11px; font-weight:bold; white-space:nowrap; width:50px;">模型材质</span> 
                                    <div style="position:relative; flex:none; min-width:80px;">
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
                                
                                <div class="slider-row mb-0" style="align-items:center;">
                                    <label class="flex items-center cursor-pointer mb-0" style="width:auto; margin-right:4px;">
                                        <input type="checkbox" id="posterizeEnable" onchange="window.togglePosterize(this.checked)" class="flat-checkbox" style="width:14px; height:14px; margin-right:6px;"> 
                                        <span style="color:rgba(255,255,255,0.8); font-size:11px; font-weight:bold; white-space:nowrap;">色阶概括</span>
                                    </label>
                                    <input type="range" id="posterizeSlider" min="0" max="19" step="1" value="0" oninput="window.onPosterizeSliderInput(this)" onchange="window.onPosterizeSliderInput(this)" style="opacity:0.3; margin-left:0;">
                                    <span id="posterizeVal" class="slider-val" style="width:30px;">无</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div> 
            </div>`; 
            
        const container = document.createElement('div'); container.innerHTML = htmlString; document.body.appendChild(container.firstElementChild); 

        // C2：短提示（仅点击“重新渲染”时出现）
        function showRenderToast(text) {
            const t = document.getElementById('render-toast');
            if (!t) return;
            t.textContent = text || '渲染中…';
            t.style.opacity = '1';
            t.style.transform = 'translateY(0px)';
            if (t.__hideTimer) clearTimeout(t.__hideTimer);
            t.__hideTimer = setTimeout(() => {
                t.style.opacity = '0';
                t.style.transform = 'translateY(6px)';
            }, 3000);
        }

        // 若宿主后续再定义 forceReRender，此处依然能兜底 toast（按钮调用的是 window.forceReRender）
        const _origForceReRender = window.forceReRender;
        window.forceReRender = function() {
            showRenderToast('正在开启渲染…');
            if (typeof _origForceReRender === 'function') return _origForceReRender.apply(this, arguments);
        };

        window.switchTab = function(tabName) {
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
            const activeBtn = document.getElementById('btn-tab-' + tabName);
            if (activeBtn) activeBtn.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            const activeContent = document.getElementById('content-tab-' + tabName);
            if (activeContent) activeContent.classList.add('active');
        };

        // 防回归约束：主滑块（fog/posterize）不允许再由入口层置 disabled。
        // 这里只做交互状态收敛：强制保持可拖动，checkbox 仅决定视觉与功能开关。
        function syncAtmosAndPosterizeSliderInteractivity() {
            const fogCheckbox = document.getElementById('fogEnable');
            const fogSlider = document.getElementById('fogSlider');
            if (fogSlider) {
                fogSlider.disabled = false;
                fogSlider.style.opacity = (fogCheckbox && fogCheckbox.checked) ? '1' : '0.3';
            }
            const posterizeCheckbox = document.getElementById('posterizeEnable');
            const posterizeSlider = document.getElementById('posterizeSlider');
            if (posterizeSlider) {
                posterizeSlider.disabled = false;
                posterizeSlider.style.opacity = (posterizeCheckbox && posterizeCheckbox.checked) ? '1' : '0.3';
            }
        }
        window.syncAtmosAndPosterizeSliderInteractivity = syncAtmosAndPosterizeSliderInteractivity;

        function __ensurePosterizeEnabledBySlider() {
            const checkbox = document.getElementById('posterizeEnable');
            const slider = document.getElementById('posterizeSlider');
            if (!checkbox || !slider) return;
            if (checkbox.checked) return;
            checkbox.checked = true;
            slider.disabled = false;
            slider.style.opacity = '1';
            syncAtmosAndPosterizeSliderInteractivity();
        }
        window.updatePosterizeVal = function(slider) { 
            const val = parseInt(slider.value); let levels = 0; let text = "无"; 
            if (val > 0) { levels = 21 - val; text = levels + "阶"; }
            document.getElementById('posterizeVal').innerText = text; 
            if(window.hwLog) window.hwLog(`[UI-触发] 色阶滑块拖动: val=${val}, levels=${levels}`);
            if(window.changePosterize) window.changePosterize(levels); 
            window.posterizeLevel = levels; window.needsUpdate = true; 
        }; 
        window.onPosterizeSliderInput = function(slider) {
            __ensurePosterizeEnabledBySlider();
            window.updatePosterizeVal(slider);
        };
        
        window.togglePosterize = function(checked) { 
            const slider = document.getElementById('posterizeSlider'); const valDisp = document.getElementById('posterizeVal'); 
            if(window.hwLog) window.hwLog(`[UI-触发] 色阶Checkbox点击: checked=${checked}`);
            if(slider) { 
                slider.style.opacity = checked ? '1' : '0.3'; 
                const savedVal = slider.value; const savedText = valDisp ? valDisp.innerText : "无"; 
                if (!checked) { 
                    if(window.changePosterize) window.changePosterize(0); 
                    slider.value = savedVal; if(valDisp) valDisp.innerText = savedText; 
                } else { 
                    window.updatePosterizeVal(slider); 
                } 
            } 
            syncAtmosAndPosterizeSliderInteractivity();
        };
        
        if(typeof window.currentFogType === 'undefined') window.currentFogType = 'basic';
        window.toggleFogAdvanced = function(checked) { 
            const slider = document.getElementById('fogSlider'); const panel = document.getElementById('fog-advanced-panel');
            const colorPicker = document.getElementById('fogColorPicker');
            const extraControls = document.getElementById('fog-extra-controls');
            if(slider) { slider.style.opacity = checked ? '1' : '0.3'; }
            if(colorPicker) { colorPicker.disabled = !checked; }
            if(extraControls) {
                extraControls.style.display = checked ? 'flex' : 'none';
                extraControls.style.pointerEvents = checked ? 'auto' : 'none';
            }
            if(panel) { panel.style.display = checked ? 'flex' : 'none'; }
            syncAtmosAndPosterizeSliderInteractivity();
            window.updateFogUI(); 
        };
        
        window.selectFogType = function(type, text, el) {
            if(el) { el.parentElement.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected')); el.classList.add('selected'); }
            const trigger = document.getElementById('fog-type-trigger'); if(trigger) trigger.innerText = text;
            ['noise', 'height', 'animated'].forEach(t => { const p = document.getElementById('fog-params-' + t); if(p) p.style.display = 'none'; });
            if(type !== 'basic') { const activeP = document.getElementById('fog-params-' + type); if(activeP) activeP.style.display = 'flex'; }
            window.currentFogType = type; window.updateFogUI();
        };

        // 拖动更顺滑：对 fog/doF 的 UI→uniform 更新做 rAF 合帧（同一帧内多次 input 只更新一次）
        let _fogRaf = 0;
        let _fogPending = null;
        function _flushFogUI() {
            _fogRaf = 0;
            const p = _fogPending;
            _fogPending = null;
            if (!p) return;

            const valDisp = document.getElementById('fogVal');
            if (valDisp) valDisp.innerText = p.density.toFixed(2);
            if (p.type && p.type !== 'basic') {
                const d1 = document.getElementById('fogVal1_' + p.type); if (d1) d1.innerText = p.p1.toFixed(1);
                const d2 = document.getElementById('fogVal2_' + p.type); if (d2) d2.innerText = p.p2.toFixed(1);
            }

            if (window.changeAtmosphere) window.changeAtmosphere(p.enabled, p.density, { type: p.type, color: p.color, p1: p.p1, p2: p.p2 });
        }

        window.updateFogUI = function() {
            const checkbox = document.getElementById('fogEnable'); const checked = checkbox ? checkbox.checked : false;
            const slider = document.getElementById('fogSlider'); const val = slider ? parseFloat(slider.value) : 0.02;
            const colorPicker = document.getElementById('fogColorPicker'); const color = colorPicker ? colorPicker.value : '#ffffff';
            let p1 = 0, p2 = 0;
            const t = window.currentFogType || 'basic';
            if (t !== 'basic') {
                const s1 = document.getElementById('fogParam1_' + t); const s2 = document.getElementById('fogParam2_' + t);
                if (s1) p1 = parseFloat(s1.value);
                if (s2) p2 = parseFloat(s2.value);
            }

            _fogPending = { enabled: checked, density: val, color: color, type: t, p1: p1, p2: p2 };
            if (_fogRaf) return;
            _fogRaf = requestAnimationFrame(_flushFogUI);
        };
        window.onFogSliderInput = function() {
            const checkbox = document.getElementById('fogEnable');
            if (checkbox && !checkbox.checked) {
                checkbox.checked = true;
                window.toggleFogAdvanced(true);
            }
            syncAtmosAndPosterizeSliderInteractivity();
            window.updateFogUI();
        };

        window.toggleDoF = function(checked) {
            const apertureSlider = document.getElementById('dofApertureSlider');
            const panel = document.getElementById('dof-advanced-panel');
            if(apertureSlider) { apertureSlider.style.opacity = checked ? '1' : '0.3'; }
            if(panel) {
                panel.style.display = checked ? 'flex' : 'none';
                panel.style.flex = '1 1 0';
                panel.style.minWidth = '0';
            }
            window.updateDoFUI();
        };

        let _dofRaf = 0;
        let _dofPending = null;
        function _flushDoFUI() {
            _dofRaf = 0;
            const p = _dofPending;
            _dofPending = null;
            if (!p) return;
            const aVal = document.getElementById('dofApertureVal'); if (aVal) aVal.innerText = 'f/' + p.aperture.toFixed(1);
            const fVal = document.getElementById('dofFocusVal'); if (fVal) fVal.innerText = p.focus.toFixed(1);
            if (window.changeDoF) window.changeDoF(p.enabled, p.aperture, p.focus);
        }

        window.updateDoFUI = function() {
            const checkbox = document.getElementById('dofEnable'); const checked = checkbox ? checkbox.checked : false;
            const aSlider = document.getElementById('dofApertureSlider'); const aperture = aSlider ? parseFloat(aSlider.value) : 2.8;
            const fSlider = document.getElementById('dofFocusSlider'); const focus = fSlider ? parseFloat(fSlider.value) : 10;
            _dofPending = { enabled: checked, aperture: aperture, focus: focus };
            if (_dofRaf) return;
            _dofRaf = requestAnimationFrame(_flushDoFUI);
        };
        window.onDoFSliderInput = function() {
            const checkbox = document.getElementById('dofEnable');
            if (checkbox && !checkbox.checked) {
                checkbox.checked = true;
                window.toggleDoF(true);
            }
            window.updateDoFUI();
        };
        syncAtmosAndPosterizeSliderInteractivity();
        
        if(window.hwLog) window.hwLog(`[UI] 控制面板已动态注入 (${mode} 模式)`); 
    } 
};