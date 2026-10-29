/**
 * 手绘工坊 · 童画师吴晓 - 全局公共菜单组件（「视觉维度」仅作历史/副称）
 * 功能：动态样式注入、DOM构建、当前页自动高亮、页面平滑跳转、跨页面历史路由控制(移动端自愈增强版)
 */
(function() {
    // 冷启动 / 返回到 #menu：先盖一层黑底，避免底页闪一帧再出菜单
    (function bootMenuCoverIfNeeded() {
        if (typeof location === 'undefined' || location.hash !== '#menu') return;
        if (document.getElementById('global-menu-boot-cover')) return;
        var c = document.createElement('div');
        c.id = 'global-menu-boot-cover';
        c.setAttribute('aria-hidden', 'true');
        c.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#050505;pointer-events:none;';
        var root = document.body || document.documentElement;
        if (root) root.appendChild(c);
        else document.addEventListener('DOMContentLoaded', function () {
            if (!document.getElementById('global-menu-boot-cover')) {
                (document.body || document.documentElement).appendChild(c);
            }
        });
    })();

    function removeMenuBootCover() {
        var c = document.getElementById('global-menu-boot-cover');
        if (c && c.parentNode) c.parentNode.removeChild(c);
    }

    // === 1. 数据驱动：菜单配置 ===
    // 站内跳转一律无 .html 后缀（与线上隐藏后缀一致）；Solid 文件名大小写敏感，用 /Solid
    const menuConfig = [
        { type: 'header', text: 'TOOLS ARCHIVE' },
        { id: '00', text: '首页 · Home', url: '/index', color: '#FCD34D' },
        
        { type: 'category', text: '造型基础' },
        { id: '01', text: '几何体 · 静物', url: '/Solid?sandbox=geometry', color: '#3B82F6' },
        
        { type: 'category', text: '肖像' },
        { id: '02', text: '头骨 · 骨点 · 肌肉', url: '/Portrait_c?lib=anatomy', color: '#A855F7' },
        { id: '03', text: '五官', url: '/Portrait_c?lib=facial', color: '#C026D3' },
        { id: '04', text: '头部造型规律', url: '/Solid?sandbox=headform', color: '#D946EF' },
        { id: '05', text: '肖像光影沙盒', url: '/Solid?sandbox=portrait', color: '#F43F5E' },
        { id: '06', text: '吴晓的作品', url: '/Gallery', color: '#EC4899' },
        { id: '07', text: '课程预约', url: '', disabled: true, tag: 'Coming Soon' },
        { id: '07b', text: '会员 · 兑换', url: '/member', color: '#E8C547' },

        { type: 'category', text: '实用工具' },
        { id: '08', text: '色阶分析 · 网格构图', url: '/GR', color: '#3B82F6' },
        { id: '09', text: '智能调色 · 颜料管理', url: '/XStudio', color: '#A855F7' },
        { id: '10', text: 'AR 线稿描摹', url: '/ARSketch', color: '#22C55E' },

        { type: 'category', text: '游戏' },
        { id: '11', text: '色感训练 · 光谱行者', url: '/games/ChromaWalker', color: '#F59E0B' },

        { type: 'category', text: '安装', cat: 'install' },
        { id: '12', text: '安卓 App 下载', url: '/docs/app/', color: '#94A3B8', hideInAndroidShell: true },

        { type: 'footer', text: '© 2026 手绘工坊 · 童画师吴晓' }
    ];

    function isAndroidShell() {
        try {
            if (window.__SHELL_VERSION__) return true;
            if (document.documentElement && document.documentElement.classList.contains('wuxiao-android-shell')) return true;
        } catch (_e) {}
        return false;
    }

    function menuItemsForEnv() {
        if (!isAndroidShell()) return menuConfig;
        // App 内已安装，不展示下载入口；若「安装」分类下无其它项则一并隐藏
        var out = [];
        for (var i = 0; i < menuConfig.length; i++) {
            var it = menuConfig[i];
            if (it && it.hideInAndroidShell) continue;
            if (it && it.type === 'category' && it.cat === 'install') {
                var hasChild = false;
                for (var j = i + 1; j < menuConfig.length; j++) {
                    var n = menuConfig[j];
                    if (!n || n.type === 'category' || n.type === 'footer' || n.type === 'header') break;
                    if (n.hideInAndroidShell) continue;
                    hasChild = true;
                    break;
                }
                if (!hasChild) continue;
            }
            out.push(it);
        }
        return out;
    }

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

            /* App 壳内：隐藏安卓下载入口（壳 class 可能晚于菜单构建） */
            html.wuxiao-android-shell .menu-item[data-menu-url="/docs/app/"],
            html.wuxiao-android-shell .menu-item[data-menu-url="/docs/app"],
            html.wuxiao-android-shell .menu-category[data-menu-cat="install"],
            html.wuxiao-android-shell .index-about-app { display: none !important; }

            /* 菜单遮罩层 */
            #global-menu-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.95); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
                z-index: 2147483647; 
                opacity: 0; visibility: hidden; transition: opacity 0.4s ease, visibility 0.4s;
                display: flex; align-items: center; justify-content: center; pointer-events: none;
            }
            #global-menu-overlay.active { opacity: 1; visibility: visible; pointer-events: auto; }
            /* 返回 / 冷启动到菜单态：取消淡入，避免先露底页 */
            #global-menu-overlay.instant {
                transition: none !important;
            }

            /* 返回箭头 (调整 margin-bottom 为 25px，配合 15px gap 刚好凑成 40px) */
            .global-menu-wrapper .back-arrow {
                color: rgba(255,255,255,0.48);
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
            .global-menu-wrapper .menu-header { font-size: 11px; color: rgba(255,255,255,0.38); letter-spacing: 5px; margin-bottom: 5px; }
            .global-menu-wrapper .menu-category { font-size: 12px; color: rgba(255,255,255,0.55); letter-spacing: 3px; margin-top: 24px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.08); text-transform: uppercase;}
            .global-menu-wrapper .menu-footer { margin-top: 36px; font-size: 10px; color: rgba(255,255,255,0.28); letter-spacing: 2px; text-align: left; }

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

            .global-menu-wrapper .menu-item .num { font-size: 14px; color: rgba(255,255,255,0.38); flex-shrink: 0; transition: color 0.3s;}
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
                color: rgba(255, 255, 255, 0.32);
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

    /**
     * 菜单路径键：多段路径保留层级（docs/app），避免 `/docs/app/` 因尾斜杠
     * pop 出空串被当成 `index`，从而在首页误判「安卓下载」为当前页、只关菜单不跳转。
     */
    function menuPathKey(p) {
        let s = String(p || '').split('?')[0];
        s = s.replace(/\/+$/, '') || '/';
        const parts = s.split('/').filter(Boolean).map(function (seg) {
            let x = seg.toLowerCase();
            if (x.endsWith('.html')) x = x.slice(0, -5);
            return x;
        });
        if (!parts.length) return 'index';
        if (parts.length === 1) return parts[0] || 'index';
        return parts.join('/');
    }

    /** 手势/浏览器回退落到 #menu 时：高亮「上次从菜单进的栏目」，而非菜单底下那页 */
    let _preferLastMenuNav = false;
    var PT_LAST_MENU_NAV = 'pt_last_menu_nav';

    function rememberMenuNav(url) {
        try { sessionStorage.setItem(PT_LAST_MENU_NAV, String(url || '')); } catch (_e) {}
    }

    function readLastMenuNav() {
        try { return sessionStorage.getItem(PT_LAST_MENU_NAV) || ''; } catch (_e) { return ''; }
    }

    /** 菜单项 URL 是否匹配「当前地址栏」真实页面（决定点该项是关菜单还是跳转） */
    function isMenuItemCurrent(item) {
        if (!item || item.disabled || !item.url) return false;
        return menuUrlMatchesLocation(item.url, window.location.pathname, window.location.search || '');
    }

    function menuUrlMatchesLocation(itemUrl, pathname, search) {
        const base = menuPathKey(itemUrl);
        if (base !== menuPathKey(pathname)) return false;
        const qMark = String(itemUrl).indexOf('?');
        const curParams = new URLSearchParams(search || '');
        if (qMark < 0) {
            if (base === 'solid') {
                const s = (curParams.get('sandbox') || 'geometry').toLowerCase();
                return s === 'geometry';
            }
            return !search || search === '?';
        }
        const want = new URLSearchParams(String(itemUrl).slice(qMark));
        for (const pair of want) {
            const k = pair[0];
            const v = pair[1];
            let cur = curParams.get(k);
            if (k === 'sandbox' && (cur == null || cur === '') && v === 'geometry') cur = 'geometry';
            if ((cur || '') !== v) return false;
        }
        return true;
    }

    /** 下划线高亮：回退进菜单时优先上次栏目；否则跟当前 URL */
    function isMenuItemActive(item) {
        if (!item || item.disabled || !item.url) return false;
        if (_preferLastMenuNav) {
            const last = readLastMenuNav();
            if (last) {
                const q = last.indexOf('?');
                const pathPart = q >= 0 ? last.slice(0, q) : last;
                const searchPart = q >= 0 ? last.slice(q) : '';
                return menuUrlMatchesLocation(item.url, pathPart, searchPart);
            }
        }
        return isMenuItemCurrent(item);
    }

    /** 打开菜单时刷新下划线（O(菜单项)，不重建 DOM） */
    function refreshGlobalMenuActiveStates() {
        const nodes = document.querySelectorAll('.global-menu-wrapper .menu-item[data-menu-url]');
        if (!nodes.length) return;
        const byUrl = Object.create(null);
        for (let i = 0; i < menuConfig.length; i++) {
            const it = menuConfig[i];
            if (it && it.url) byUrl[it.url] = it;
        }
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            const url = el.getAttribute('data-menu-url') || '';
            const item = byUrl[url];
            if (!item) continue;
            const on = isMenuItemActive(item);
            el.classList.toggle('active', on);
            const line = el.querySelector('.hover-line');
            if (line) line.style.width = on ? '100%' : '';
        }
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

        menuItemsForEnv().forEach(item => {
            const el = document.createElement('div');

            if (item.type === 'header') {
                el.className = 'menu-header nav-font-hairline';
                el.innerText = item.text;
            } else if (item.type === 'category') {
                // 分类标题使用极细体
                el.className = 'menu-category nav-font-hairline';
                if (item.cat) el.setAttribute('data-menu-cat', item.cat);
                el.innerText = item.text;
            } else if (item.type === 'footer') {
                el.className = 'menu-footer nav-font-hairline';
                el.innerText = item.text;
            } else {
                const isActive = isMenuItemActive(item);

                // 所有菜单项强制使用 nav-font-hairline (100)
                el.className = `menu-item nav-font-hairline ${isActive ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`;
                el.setAttribute('data-menu-url', item.url || '');
                let html = `<span class="num nav-font-hairline">${item.id}</span><span class="txt">${item.text}</span>`;

                if (item.disabled) {
                    html += `<span class="tag">${item.tag}</span>`;
                } else {
                    html += `<div class="hover-line" style="background:${item.color}; ${isActive ? 'width:100%;' : ''}"></div>`;
                    el.onclick = () => {
                        // 关菜单仅当「真在当前页」；回退高亮的上次栏目仍可再点进入
                        if (isMenuItemCurrent(item)) {
                            window.toggleMenu();
                            setTimeout(function () {
                                try { if (typeof window.__solidOnGlobalMenuClosed === 'function') window.__solidOnGlobalMenuClosed(); } catch (_eAct) {}
                            }, 80);
                        } else if (/^\/docs\/app\/?/i.test(item.url) || item.hardNavigate) {
                            rememberMenuNav(item.url);
                            window.location.assign(item.url);
                        } else {
                            rememberMenuNav(item.url);
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
    // 用独立标记：hashchange 多趟 sync 时 class 可能已被摘掉，不能只靠 classList 判断「刚关闭」
    let _globalMenuUiOpen = false;

    function _notifySolidMenuClosed() {
        if (typeof window.__solidOnGlobalMenuClosed !== 'function') return;
        // history.back 异步清 hash；稍后再通知，避免与多趟 sync 抢状态
        setTimeout(function () {
            try { window.__solidOnGlobalMenuClosed(); } catch (_eSolidMenu) {}
        }, 30);
    }

    function syncMenuWithHash(opts) {
        const overlay = document.getElementById('global-menu-overlay');
        if (!overlay) return;
        const instant = !!(opts && opts.instant);
        
        const shouldBeActive = (window.location.hash === '#menu');
        const btns = document.querySelectorAll('#menu-trigger, #menu-trigger-overlay, .menu-open');

        if (shouldBeActive) {
            _globalMenuUiOpen = true;
            if (instant) overlay.classList.add('instant');
            overlay.classList.add('active');
            // 列表页/沙盒 URL 已在当前页：打开菜单时同步高亮（进课前后同一 pathname）
            refreshGlobalMenuActiveStates();
            btns.forEach(btn => btn.classList.add('menu-open'));
            removeMenuBootCover();
            // 两帧后摘掉 instant，下次用户点开菜单仍可淡入
            if (instant) {
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () {
                        overlay.classList.remove('instant');
                    });
                });
            }
            // [新增] 菜单打开时校准底部箭头状态
            if (window._updateMenuScrollIndicator) {
                setTimeout(window._updateMenuScrollIndicator, 50);
                setTimeout(window._updateMenuScrollIndicator, 400); // 等待动画完成再次测算
            }
        } else {
            const closing = _globalMenuUiOpen || overlay.classList.contains('active');
            _globalMenuUiOpen = false;
            overlay.classList.remove('active');
            overlay.classList.remove('instant');
            removeMenuBootCover();
            btns.forEach(btn => {
                btn.classList.remove('menu-open');
                if (typeof btn.blur === 'function') btn.blur(); 
            });
            // Solid 等页：关菜单后若仍未选课，须回课表，禁止空舞台（点当前沙盒菜单项也会走这里）
            if (closing) _notifySolidMenuClosed();
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
            // 用户主动打开菜单：高亮跟当前 URL，不用「回退上次栏目」
            _preferLastMenuNav = false;
            if (window.location.hash !== '#menu') {
                history.pushState({ menu: true }, '', '#menu');
            }
            syncMenuWithHash();
        }
    };

    window.zoomAndNavigate = function(url) {
        // 保留 #menu 历史格：从菜单进新页后返回可回到「上一页 + 菜单开」
        // （不再 replaceState 抹掉 #menu）
        const overlay = document.getElementById('global-menu-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            overlay.classList.remove('instant');
        }
        document.querySelectorAll('#menu-trigger, #menu-trigger-overlay, .menu-open').forEach(btn => btn.classList.remove('menu-open'));
        _globalMenuUiOpen = false;

        // Portrait / Solid 等自带首屏加载层：禁止整页淡出变黑，否则用户会先看一会儿纯黑再见到进度条
        var u = String(url || '');
        var skipFade = /\/Portrait_c(\?|$)/i.test(u) || /\/Solid(\?|$)/i.test(u) || /\/Portrait(\?|$)/i.test(u);
        if (skipFade) {
            window.location.href = url;
            return;
        }

        document.body.style.transition = "opacity 0.5s ease";
        document.body.style.opacity = "0";
        
        setTimeout(function() {
            window.location.href = url;
        }, 400); 
    };

    // === 5. 全局后退监听与页面唤醒修复 (多重自愈体系) ===
    function triggerMultiPassSync(instantFirst) {
        if (instantFirst && location.hash === '#menu') {
            syncMenuWithHash({ instant: true });
        }
        requestAnimationFrame(function () { syncMenuWithHash({ instant: !!instantFirst }); });
        setTimeout(function () { syncMenuWithHash({ instant: !!instantFirst }); }, 50);
        setTimeout(syncMenuWithHash, 150);
        setTimeout(syncMenuWithHash, 300);
        setTimeout(syncMenuWithHash, 600);
    }

    window.addEventListener('popstate', function(e) {
        // 历史回退落到 #menu：用上次菜单目标高亮下划线
        _preferLastMenuNav = (location.hash === '#menu');
        triggerMultiPassSync(true);
    });

    window.addEventListener('hashchange', function(e) {
        if (location.hash === '#menu') {
            // hashchange 也可能来自回退；若无 push 标记则保持 prefer（popstate 已设）
        } else {
            _preferLastMenuNav = false;
        }
        triggerMultiPassSync(location.hash === '#menu');
    });

    window.addEventListener('pageshow', function(e) {
        if (e.persisted || (window.performance && window.performance.navigation.type === 2)) {
            document.body.style.transition = "none";
            document.body.style.opacity = "1";
            setTimeout(() => { document.body.style.transition = "opacity 0.5s ease"; }, 50);
            const ui = document.getElementById('ui-layer');
            if (ui) ui.style.opacity = '1';
            // bfcache 回退到 #menu
            if (location.hash === '#menu') _preferLastMenuNav = true;
        }
        triggerMultiPassSync(location.hash === '#menu');
    });

    // === 6. 自动执行挂载 ===
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            injectStyles(); buildMenuDOM(); triggerMultiPassSync(location.hash === '#menu');
        });
    } else {
        injectStyles(); buildMenuDOM(); triggerMultiPassSync(location.hash === '#menu');
    }

    // 菜单右上角身份条（接 MembershipAccess）
    (function loadIdentityChrome() {
        if (document.querySelector('script[data-pt-identity-chrome]')) return;
        var s = document.createElement('script');
        s.src = '/docs/js/membership/IdentityChrome.js';
        s.async = true;
        s.setAttribute('data-pt-identity-chrome', '1');
        document.head.appendChild(s);
    })();

})();