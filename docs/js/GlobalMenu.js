/**
 * 视觉维度 / 手绘工坊 - 全局公共菜单组件
 * 功能：动态样式注入、DOM构建、当前页自动高亮、页面平滑跳转、跨页面历史路由控制(移动端自愈增强版)
 */
(function() {
    // === 1. 数据驱动：菜单配置 ===
    const menuConfig = [
        { type: 'header', text: 'TOOLS ARCHIVE' },
        { id: '00', text: '首页 · Home', url: 'index.html', color: '#FCD34D' },
        
        { type: 'category', text: '造型基础' },
        { id: '01', text: '几何体 · 静物', url: 'solid.html', color: '#3B82F6' },
        
        { type: 'category', text: '肖像' },
        { id: '02', text: '头骨 · 骨点 · 肌肉', url: 'Portrait_abc.html', color: '#A855F7' },
        { id: '03', text: '头部造型规律', url: 'Portrait_abc.html', color: '#D946EF' },
        { id: '04', text: '肖像光影沙盒', url: 'Portrait.html', color: '#F43F5E' },
        { id: '05', text: '吴晓的作品', url: 'Gallery.html', color: '#EC4899' },
        { id: '06', text: '课程预约', url: '', disabled: true, tag: 'Coming Soon' },

        { type: 'category', text: '实用工具' },
        { id: '07', text: '色阶图生成 · 网格起型', url: 'GR.html', color: '#3B82F6' },
        { id: '08', text: '智能调色 · 颜料管理', url: 'XStudio.html', color: '#A855F7' },
        { id: '09', text: 'AR 线稿描摹', url: 'ARSketch.html', color: '#22C55E' },

        { type: 'category', text: '游戏' },
        { id: '10', text: '色感训练 · 光谱行者', url: 'games/ChromaWalker.html', color: '#F59E0B' },

        { type: 'footer', text: '© 2026 Hand-painted Workshop' }
    ];

    // === 2. 动态样式注入 ===
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* 强制隔离盒模型：解决 ARSketch 等页面高度溢出问题 */
            .global-menu-wrapper, .global-menu-wrapper * {
                box-sizing: border-box !important;
            }

            /* 全局菜单字体保护 */
            .global-menu-wrapper .nav-font-hairline { font-weight: 100 !important; font-family: 'Inter', sans-serif !important; }
            .global-menu-wrapper .nav-font-thin { font-weight: 200 !important; font-family: 'Inter', sans-serif !important; }

            /* 菜单遮罩层 */
            #global-menu-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.95); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
                z-index: 2147483647; 
                opacity: 0; visibility: hidden; transition: opacity 0.4s ease, visibility 0.4s;
                display: flex; align-items: center; justify-content: center; pointer-events: none;
            }
            #global-menu-overlay.active { opacity: 1; visibility: visible; pointer-events: auto; }

            /* 返回箭头 (调整 margin-bottom 为 25px，配合 15px gap 刚好凑成 40px) */
            .global-menu-wrapper .back-arrow {
                color: rgba(255,255,255,0.4);
                cursor: pointer; transition: color 0.3s, transform 0.3s; z-index: 10;
                margin-bottom: 25px; align-self: flex-start;
                display: flex; align-items: center; /* 确保图标自身绝对居中对齐 */
            }
            .global-menu-wrapper .back-arrow:hover { color: #fff; transform: translateX(-5px); }

            /* 滚动容器 (彻底解决 iOS 负边距吞噬顶部 Bug) */
            .global-menu-wrapper .menu-scroll-container {
                width: 100%; height: 100%; overflow-y: auto; overflow-x: hidden;
                padding: 0 20px;
                -webkit-overflow-scrolling: touch; -ms-overflow-style: none; scrollbar-width: none;
            }
            .global-menu-wrapper .menu-scroll-container::-webkit-scrollbar { display: none; }
            
            /* 菜单内容体 (去除动态的 8vh，让上下边距精准对齐) */
            .global-menu-wrapper .menu-container { 
                width: 380px; max-width: 100%; 
                display: flex; flex-direction: column; gap: 15px; text-align: left; 
                margin: 40px auto; 
                margin-top: calc(env(safe-area-inset-top) + 40px);
                margin-bottom: calc(env(safe-area-inset-bottom) + 40px);
            }

            /* 文本标记样式 (增大字号和字距) */
            .global-menu-wrapper .menu-header { font-size: 11px; color: rgba(255,255,255,0.3); letter-spacing: 5px; margin-bottom: 5px; }
            .global-menu-wrapper .menu-category { font-size: 12px; color: rgba(255,255,255,0.5); letter-spacing: 3px; margin-top: 24px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.08); text-transform: uppercase;}
            .global-menu-wrapper .menu-footer { margin-top: 36px; font-size: 10px; color: rgba(255,255,255,0.2); letter-spacing: 2px; text-align: left; }

            /* 菜单项基础样式 (增大气场) */
            .global-menu-wrapper .menu-item {
                display: flex; align-items: baseline; gap: 20px; padding-bottom: 16px;
                border-bottom: 1px solid rgba(255,255,255,0.1); color: #fff; text-decoration: none;
                cursor: pointer; position: relative; transition: all 0.3s;
            }
            
            /* [新增] 限制原生悬停仅在 PC 触发，避免移动端“黏性悬停”残影 */
            @media (hover: hover) and (pointer: fine) {
                .global-menu-wrapper .menu-item:hover { border-bottom-color: rgba(255,255,255,0.4); }
                .global-menu-wrapper .menu-item:hover .hover-line { width: 100%; }
            }
            
            /* [新增] 移动端瞬时触摸反馈专属样式 */
            .global-menu-wrapper .menu-item.touch-active { border-bottom-color: rgba(255,255,255,0.4); }
            .global-menu-wrapper .menu-item.touch-active .hover-line { width: 100%; }

            .global-menu-wrapper .menu-item .num { font-size: 14px; color: rgba(255,255,255,0.3); flex-shrink: 0; transition: color 0.3s;}
            .global-menu-wrapper .menu-item .txt { font-size: 22px; letter-spacing: 2px; color: #e5e5e5; transition: color 0.3s; }
            
            /* 激活状态 (保持优雅，仅略微提亮加粗) */
            .global-menu-wrapper .menu-item.active .txt { color: #fff; font-weight: 200; }
            .global-menu-wrapper .menu-item.active { border-bottom-color: rgba(255,255,255,0.5); }
            .global-menu-wrapper .hover-line { position: absolute; bottom: -1px; right: 0; width: 0; height: 1px; transition: width 0.3s ease; }
            .global-menu-wrapper .menu-item.active .hover-line { width: 100%; }

            /* 不可用状态 */
            .global-menu-wrapper .menu-item.disabled { opacity: 0.4; cursor: not-allowed; }
            .global-menu-wrapper .menu-item.disabled:hover { border-bottom-color: rgba(255,255,255,0.1); }
            .global-menu-wrapper .menu-item.disabled .tag { font-size: 9px; border: 1px solid rgba(255,255,255,0.2); padding: 2px 4px; border-radius: 4px; margin-left: auto; }

            /* ========================================================= */
            /* [终极修复] 解决移动端 "Sticky Hover" (黏性悬停) 导致的残影 */
            @media (hover: none), (pointer: coarse) {
                #menu-trigger:hover:not(.menu-open) .line-1 { transform: none !important; }
                #menu-trigger:hover:not(.menu-open) .line-2 { opacity: 1 !important; }
                #menu-trigger:hover:not(.menu-open) .line-3 { transform: none !important; }
            }
            /* ========================================================= */

            /* [新增] 底部优雅的滚动提示箭头 */
            #menu-scroll-indicator {
                position: absolute;
                bottom: max(4vh, calc(env(safe-area-inset-bottom) + 20px));
                left: 50%;
                margin-left: -12px;
                width: 24px;
                height: 24px;
                color: rgba(255, 255, 255, 0.25);
                z-index: 2147483648;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.8s ease;
                animation: menu-elegant-bounce 2.5s infinite cubic-bezier(0.4, 0, 0.2, 1);
            }
            #menu-scroll-indicator.show { opacity: 1; }
            @keyframes menu-elegant-bounce {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(6px); }
            }
        `;
        document.head.appendChild(style);
    }

    // === 3. DOM 构建与事件绑定 ===
    function buildMenuDOM() {
        if (document.getElementById('global-menu-overlay')) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'global-menu-wrapper';

        const overlay = document.createElement('div');
        overlay.id = 'global-menu-overlay';

        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'menu-scroll-container';

        const container = document.createElement('div');
        container.className = 'menu-container';

        const backArrow = document.createElement('div');
        backArrow.className = 'back-arrow';
        backArrow.onclick = window.toggleMenu;
        backArrow.title = '关闭菜单';
        backArrow.innerHTML = '<svg width="60" height="24" viewBox="0 0 60 24" fill="none" style="display:block;"><path d="M0.5 12L10 1M0.5 12L60 12M0.5 12L10 23" stroke="currentColor" stroke-width="0.5"/></svg>';
        container.appendChild(backArrow);

        const currentPath = window.location.pathname.split('/').pop() || 'index.html';

        menuConfig.forEach(item => {
            const el = document.createElement('div');

            if (item.type === 'header') {
                el.className = 'menu-header nav-font-hairline';
                el.innerText = item.text;
            } else if (item.type === 'category') {
                // 分类标题使用极细体
                el.className = 'menu-category nav-font-hairline';
                el.innerText = item.text;
            } else if (item.type === 'footer') {
                el.className = 'menu-footer nav-font-hairline';
                el.innerText = item.text;
            } else {
                const itemFileName = item.url.split('/').pop();
                const isActive = !item.disabled && (itemFileName === currentPath || (currentPath === '' && itemFileName === 'index.html'));

                // 所有菜单项强制使用 nav-font-hairline (100)
                el.className = `menu-item nav-font-hairline ${isActive ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`;
                let html = `<span class="num nav-font-hairline">${item.id}</span><span class="txt">${item.text}</span>`;

                if (item.disabled) {
                    html += `<span class="tag">${item.tag}</span>`;
                } else {
                    html += `<div class="hover-line" style="background:${item.color}; ${isActive ? 'width:100%;' : ''}"></div>`;
                    el.onclick = () => {
                        if (isActive) {
                            window.toggleMenu(); 
                        } else {
                            window.zoomAndNavigate(item.url);
                        }
                    };
                    // [新增] 移动端指尖触摸瞬时反馈监听
                    el.addEventListener('touchstart', () => el.classList.add('touch-active'), {passive: true});
                    el.addEventListener('touchend', () => el.classList.remove('touch-active'));
                    el.addEventListener('touchcancel', () => el.classList.remove('touch-active'));
                    // 手指滑动时立即剥离悬停效果
                    el.addEventListener('touchmove', () => el.classList.remove('touch-active'), {passive: true});
                }

                if (isActive && !item.disabled) {
                    html = html.replace('class="num', `style="color:${item.color}" class="num`);
                }

                el.innerHTML = html;
            }
            container.appendChild(el);
        });

        scrollContainer.appendChild(container);
        
        // 修复漏掉的关键挂载：将滚动容器放入遮罩层中！
        overlay.appendChild(scrollContainer);
        
        // [新增] 插入底部智能提示箭头
        const scrollIndicator = document.createElement('div');
        scrollIndicator.id = 'menu-scroll-indicator';
        scrollIndicator.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        overlay.appendChild(scrollIndicator);

        wrapper.appendChild(overlay);
        document.body.appendChild(wrapper);

        // [新增] 箭头显示隐藏的计算逻辑
        window._updateMenuScrollIndicator = function() {
            if(!scrollContainer || !scrollIndicator) return;
            // 判断是否滚动到底部 (容差20px避免浮点误差)
            if (scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight > 20) {
                scrollIndicator.classList.add('show');
            } else {
                scrollIndicator.classList.remove('show');
            }
        };

        // 绑定滚动与缩放监听
        scrollContainer.addEventListener('scroll', window._updateMenuScrollIndicator, {passive: true});
        window.addEventListener('resize', window._updateMenuScrollIndicator);
    }

    // === 4. 核心路由与状态管理 ===
    let lastTriggerBtn = null; 

    function syncMenuWithHash() {
        const overlay = document.getElementById('global-menu-overlay');
        if (!overlay) return;
        
        const shouldBeActive = (window.location.hash === '#menu');
        const btns = document.querySelectorAll('#menu-trigger, #menu-trigger-overlay, .menu-open');

        if (shouldBeActive) {
            overlay.classList.add('active');
            btns.forEach(btn => btn.classList.add('menu-open'));
            // [新增] 菜单打开时校准底部箭头状态
            if (window._updateMenuScrollIndicator) {
                setTimeout(window._updateMenuScrollIndicator, 50);
                setTimeout(window._updateMenuScrollIndicator, 400); // 等待动画完成再次测算
            }
        } else {
            overlay.classList.remove('active');
            btns.forEach(btn => {
                btn.classList.remove('menu-open');
                if (typeof btn.blur === 'function') btn.blur(); 
            });
        }
    }

    window.toggleMenu = function(e) {
        if (e && e.currentTarget) lastTriggerBtn = e.currentTarget;

        const overlay = document.getElementById('global-menu-overlay');
        if (!overlay) return;

        if (overlay.classList.contains('active')) {
            if (window.location.hash === '#menu') {
                history.back();
            } else {
                syncMenuWithHash(); 
            }
        } else {
            if (window.location.hash !== '#menu') {
                history.pushState({ menu: true }, '', '#menu');
            }
            syncMenuWithHash();
        }
    };

    window.zoomAndNavigate = function(url) {
        if (window.location.hash === '#menu') {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }

        const overlay = document.getElementById('global-menu-overlay');
        if (overlay) overlay.classList.remove('active');
        document.querySelectorAll('#menu-trigger, #menu-trigger-overlay, .menu-open').forEach(btn => btn.classList.remove('menu-open'));

        document.body.style.transition = "opacity 0.5s ease";
        document.body.style.opacity = "0";
        
        setTimeout(function() {
            window.location.href = url;
        }, 400); 
    };

    // === 5. 全局后退监听与页面唤醒修复 (多重自愈体系) ===
    function triggerMultiPassSync() {
        requestAnimationFrame(syncMenuWithHash);
        setTimeout(syncMenuWithHash, 50);
        setTimeout(syncMenuWithHash, 150);
        setTimeout(syncMenuWithHash, 300);
        setTimeout(syncMenuWithHash, 600);
    }

    window.addEventListener('popstate', function(e) {
        triggerMultiPassSync();
    });

    window.addEventListener('hashchange', function(e) {
        triggerMultiPassSync();
    });

    window.addEventListener('pageshow', function(e) {
        if (e.persisted || (window.performance && window.performance.navigation.type === 2)) {
            document.body.style.transition = "none";
            document.body.style.opacity = "1";
            setTimeout(() => { document.body.style.transition = "opacity 0.5s ease"; }, 50);
            const ui = document.getElementById('ui-layer');
            if (ui) ui.style.opacity = '1';
        }
        triggerMultiPassSync();
    });

    // === 6. 自动执行挂载 ===
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            injectStyles(); buildMenuDOM(); triggerMultiPassSync();
        });
    } else {
        injectStyles(); buildMenuDOM(); triggerMultiPassSync();
    }

})();