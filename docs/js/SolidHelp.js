(function() {
    // 1. 定义帮助面板的 HTML 和内联样式
    const helpHTML = `
        <style>
            /* 右上角帮助按钮（在汉堡菜单左侧） */
            #solid-global-help-btn {
                position: fixed;
                /* 与汉堡菜单对齐，往左挪一点避免重叠，兼容刘海屏 */
                top: 20px;
                right: 74px; 
                width: 44px;
                height: 44px;
                display: flex;
                justify-content: center;
                align-items: center;
                cursor: pointer;
                z-index: 7002;
                background: transparent;
                color: rgba(255, 255, 255, 0.72);
                font-size: 16px;
                font-weight: 400;
                font-family: serif;
                transition: all 0.3s ease;
                opacity: 0.82;
                transform: translateY(calc(env(safe-area-inset-top, 0px) - 16px));
            }
            #solid-global-help-btn:hover {
                color: #fff;
            }
            
            /* 沉浸模式：同页面内其他UI一起隐藏 */
            body.immersive-mode #solid-global-help-btn { 
                opacity: 0 !important; 
                pointer-events: none !important; 
            }

            /* 帮助面板背景遮罩 */
            #solid-global-help-modal {
                display: none;
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.75);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                z-index: 9999;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 20px;
                opacity: 0;
                transition: opacity 0.3s ease;
            }
            #solid-global-help-modal.show {
                display: flex;
                opacity: 1;
            }

            /* 帮助面板本体 */
            .solid-help-panel {
                background: rgba(20, 20, 20, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 14px;
                width: 100%;
                max-width: 500px;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8);
                overflow: hidden;
            }
            .solid-help-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            }
            .solid-help-title {
                color: #fff;
                font-size: 16px;
                font-weight: 300;
                letter-spacing: 1px;
            }
            .solid-help-close {
                cursor: pointer;
                color: rgba(255, 255, 255, 0.5);
                font-size: 20px;
                width: 28px;
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 6px;
                background: rgba(255, 255, 255, 0.05);
                transition: 0.2s;
            }
            .solid-help-close:hover {
                color: #fff;
                background: rgba(255, 255, 255, 0.12);
            }
            .solid-help-content {
                padding: 20px;
                overflow-y: auto;
                color: rgba(255, 255, 255, 0.8);
                font-size: 13px;
                line-height: 1.6;
                font-weight: 300;
                /* 滚动条美化 */
                scrollbar-width: thin;
                scrollbar-color: rgba(255,255,255,0.2) transparent;
            }
            .solid-help-content::-webkit-scrollbar {
                width: 6px;
            }
            .solid-help-content::-webkit-scrollbar-thumb {
                background-color: rgba(255,255,255,0.2);
                border-radius: 3px;
            }
            .solid-help-content h3 {
                color: #fff;
                font-size: 14px;
                margin: 0 0 8px 0;
                font-weight: 400;
            }
            .solid-help-content p {
                margin: 0 0 16px 0;
            }
            .solid-help-content p:last-child {
                margin-bottom: 0;
            }
        </style>

        <!-- 帮助按钮 -->
        <div id="solid-global-help-btn" title="操作指南">
            <span style="border: 1px solid rgba(255,255,255,0.4); border-radius: 50%; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; transform: translateY(-1px);">?</span>
        </div>

        <!-- 帮助面板 -->
        <div id="solid-global-help-modal">
            <div class="solid-help-panel">
                <div class="solid-help-header">
                    <span class="solid-help-title">操作指南</span>
                    <span class="solid-help-close" id="solid-help-close-btn">×</span>
                </div>
                <div class="solid-help-content">
                    <p>欢迎来到<b>光影画室</b>。这里不急不催，我们只做一件事：<b>把你的“眼睛”慢慢养出来。</b></p>
                    <p>我们相信，学会“看”比直接“画”更重要，用心“观察”比“背理论”更重要，在这里，你将通过身临其境的光影环境、专业的美学指引，培养出真正扎根心底的直觉美感。</p>
                    <h3>旋转视角</h3>
                    <p>单指（或鼠标左键）在画面上拖动，可以旋转视角，从不同角度观察模型与光影关系。</p>

                    <h3>缩放 / 平移</h3>
                    <p>双指捏合可以缩放画面；双指同向滑动（或鼠标右键拖动）可以平移画面。</p>

                    <h3>标注</h3>
                    <p>为了让你吃透光影关系，我们加了各种指示标注。点击标注可以在页面左上角看到更详细的解释。</p>

                    <h3>底部面板—（可收缩）</h3>
                    <p>面板分四个 tab：<br>
                    · <b>主光</b>——调节主灯的高度、角度、远近、色温；<br>
                    · <b>环境光</b>——开关天光（影响暗部和投影的颜色）；<br>
                    · <b>氛围</b>——加雾、调景深；<br>
                    · <b>辅助</b>——切换材质、开色阶分析。<br>
                    每次改动，光影都会实时重新计算，多试几次比记结论有用。</p>

                    <h3>写生模式（眼睛图标）</h3>
                    <p>点击眼睛图标，进入写生模式——所有标注全部隐藏，只剩你和场景。<br>
                    建议：第一遍跟着标注看，第二遍开写生模式自己再看一遍，感觉会完全不同。<br>
                    并且写生模式提供了比实际画室更理想的光影关系，让你更容易理解光影关系，是绝佳的写生素材</p>

                    <h3>渲染按钮</h3>
                    <p>底部有「重新渲染」和「停止渲染」两个按钮。<br>
                    · <b>重新渲染</b>，使光影更逼真，这是本工具的核心价值<br>
                    · 当渲染正在进行时，点击 <b>停止渲染</b> 则可以让你的操作更丝滑</p>

                    <h3>场景切换</h3>
                    <p>点击左上角的"学习场景"按钮，可以呼出弹窗，切换不同的学习场景。建议按顺序从头看，前后的知识是连着的。</p>
                </div>
            </div>
        </div>
    `;

    // 2. 页面加载完成后注入 DOM 和事件
    function initHelp() {
        const container = document.createElement('div');
        container.innerHTML = helpHTML;
        
        while (container.firstChild) {
            document.body.appendChild(container.firstChild);
        }

        const btn = document.getElementById('solid-global-help-btn');
        const modal = document.getElementById('solid-global-help-modal');
        const panel = modal.querySelector('.solid-help-panel');
        const closeBtn = document.getElementById('solid-help-close-btn');

        panel.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        function openHelp() {
            modal.style.display = 'flex';
            requestAnimationFrame(() => {
                modal.classList.add('show');
            });
        }

        function closeHelp() {
            modal.classList.remove('show');
            setTimeout(() => {
                if (!modal.classList.contains('show')) {
                    modal.style.display = 'none';
                }
            }, 300);
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (modal.classList.contains('show')) {
                closeHelp();
            } else {
                openHelp();
            }
        });

        modal.addEventListener('click', closeHelp);
        closeBtn.addEventListener('click', closeHelp);
    }

    // 兼容可能已经完成加载的情况
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initHelp);
    } else {
        initHelp();
    }
})();
