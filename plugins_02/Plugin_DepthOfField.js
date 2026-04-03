import * as THREE from 'three';

window.DoFManager = {
    enabled: false,
    focusDistance: 10,
    aperture: 2.8,
    lastTapTime: 0,
    tapPos: new THREE.Vector2(),
    raycaster: new THREE.Raycaster(),

    init: function(camera, scene, domElement) {
        this.camera = camera;
        this.scene = scene;
        this.domElement = domElement;

        domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
    },

    onPointerDown: function(e) {
        if (!this.enabled) return;
        const now = performance.now();
        const timeDiff = now - this.lastTapTime;
        
        if (timeDiff > 0 && timeDiff < 300) {
            const dx = e.clientX - this.tapPos.x;
            const dy = e.clientY - this.tapPos.y;
            if (Math.sqrt(dx*dx + dy*dy) < 15) {
                this.doRaycast(e.clientX, e.clientY);
            }
        }
        this.lastTapTime = now;
        this.tapPos.set(e.clientX, e.clientY);
    },

    doRaycast: function(clientX, clientY) {
        const rect = this.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1
        );

        this.raycaster.setFromCamera(mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);
        
        if (intersects.length > 0) {
            const hit = intersects[0];
            this.focusDistance = hit.distance;
            
            if (window.updateDoFUIFromRaycaster) window.updateDoFUIFromRaycaster(this.focusDistance);
            if (window.changeDoF) window.changeDoF(this.enabled, this.aperture, this.focusDistance);
        }
    },

    updateParams: function(enabled, aperture, focusDistance) {
        this.enabled = enabled;
        this.aperture = aperture;
        this.focusDistance = focusDistance;

        // 【终极破局】：彻底放弃向底层光追引擎强行注入物理参数的黑盒操作！
        // 因为光追引擎会严格校验数据，导致渲染态景深消失。
        // 我们将全面采用外层的 32-tap Vogel 后期管线进行景深渲染，实现真正的 100% 动静一致！
        
        if (window.needsUpdate !== undefined) window.needsUpdate = true;
        if (typeof window.lightMoved !== 'undefined') window.lightMoved = true;
    }
};

if (window.PluginManager) window.PluginManager.register('dof', window.DoFManager);