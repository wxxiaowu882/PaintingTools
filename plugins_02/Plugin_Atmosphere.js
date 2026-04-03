import * as THREE from 'three';

window.AtmosphereManager = {
    ptTarget: null,
    depthTarget: null,
    postScene: null,
    postCamera: null,
    postMaterial: null,
    mainScene: null,
    fogTime: 0,
    lastTime: 0,

    init: function(renderer, camera, scene) {
        this.mainScene = scene; 
        
        const dpr = renderer.getPixelRatio() || 1;
        const w = window.innerWidth * dpr;
        const h = window.innerHeight * dpr;

        this.ptTarget = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
        
        this.depthTarget = new THREE.WebGLRenderTarget(w, h);
        this.depthTarget.depthTexture = new THREE.DepthTexture();
        this.depthTarget.depthTexture.type = THREE.FloatType;

        this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.postScene = new THREE.Scene();

        this.postMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: this.ptTarget.texture },
                tDepth: { value: this.depthTarget.depthTexture },
                cameraNear: { value: camera.near },
                cameraFar: { value: camera.far },
                cameraProjectionMatrixInverse: { value: new THREE.Matrix4() },
                cameraWorldMatrix: { value: new THREE.Matrix4() },
                fogEnabled: { value: false }, 
                fogColor: { value: new THREE.Color(0xffffff) },
                fogDensity: { value: 0.02 },
                fogType: { value: 0 },
                fogParam1: { value: 0.0 },
                fogParam2: { value: 0.0 },
                time: { value: 0.0 },
                dofEnabled: { value: false }, 
                focusDistance: { value: 10.0 },
                aperture: { value: 2.8 },
                isPreview: { value: true },
                // 【修复核心】：改名为 uExposure，彻底避开 Three.js 的 toneMappingExposure 保留字冲突！
                uExposure: { value: 0.7 } 
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                #include <packing>
                varying vec2 vUv; uniform sampler2D tDiffuse; uniform sampler2D tDepth;
                uniform float cameraNear; uniform float cameraFar;
                uniform mat4 cameraProjectionMatrixInverse; uniform mat4 cameraWorldMatrix;
                
                uniform bool fogEnabled; uniform vec3 fogColor; uniform float fogDensity; 
                uniform int fogType; uniform float fogParam1; uniform float fogParam2; uniform float time;
                
                uniform bool dofEnabled; uniform float focusDistance; uniform float aperture;
                uniform bool isPreview; uniform float uExposure;

                float hash12(vec2 p) {
                    vec3 p3  = fract(vec3(p.xyx) * .1031);
                    p3 += dot(p3, p3.yzx + 33.33);
                    return fract((p3.x + p3.y) * p3.z);
                }

                float hashnoise(vec3 p) { p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
                float noise(vec3 x) {
                    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(mix(hashnoise(i + vec3(0,0,0)), hashnoise(i + vec3(1,0,0)), f.x), mix(hashnoise(i + vec3(0,1,0)), hashnoise(i + vec3(1,1,0)), f.x), f.y),
                               mix(mix(hashnoise(i + vec3(0,0,1)), hashnoise(i + vec3(1,0,1)), f.x), mix(hashnoise(i + vec3(0,1,1)), hashnoise(i + vec3(1,1,1)), f.x), f.y), f.z);
                }

                vec3 getFoggedColor(vec2 uv) {
                    vec3 color = texture2D(tDiffuse, uv).rgb;
                    if (!fogEnabled) return color;
                    
                    float dTex = texture2D(tDepth, uv).x;
                    float vZ = perspectiveDepthToViewZ(dTex, cameraNear, cameraFar);
                    float rDepth = viewZToOrthographicDepth(vZ, cameraNear, cameraFar) * (cameraFar - cameraNear);
                    
                    float fFactor = 0.0; float cDens = fogDensity;
                    if (fogType == 0) { fFactor = 1.0 - exp( - (cDens * rDepth) * (cDens * rDepth) ); } 
                    else if (fogType == 1) {
                        float scale = max(0.1, fogParam2); float n = noise(vec3(uv * 10.0 / scale, rDepth * 0.15 / scale)); 
                        cDens = fogDensity * (1.0 + fogParam1 * (n - 0.4)); cDens = max(0.0, cDens);
                        fFactor = 1.0 - exp( - (cDens * rDepth) * (cDens * rDepth) );
                    } else if (fogType == 2) {
                        vec4 ndc = vec4(uv * 2.0 - 1.0, dTex * 2.0 - 1.0, 1.0);
                        vec4 viewPos = cameraProjectionMatrixInverse * ndc; viewPos /= viewPos.w;
                        vec4 worldPos = cameraWorldMatrix * viewPos;
                        float hFactor = exp( -max(0.0, worldPos.y - fogParam1) * max(0.1, fogParam2) ); cDens = fogDensity * hFactor;
                        fFactor = 1.0 - exp( - (cDens * rDepth) * (cDens * rDepth) );
                    } else if (fogType == 3) {
                        float speed = time * fogParam1 * 0.5; float n = noise(vec3(uv * 6.0 + speed, rDepth * 0.15 - speed * 0.5));
                        cDens = fogDensity * (1.0 + fogParam2 * (n - 0.4)); cDens = max(0.0, cDens);
                        fFactor = 1.0 - exp( - (cDens * rDepth) * (cDens * rDepth) );
                    }
                    return mix(color, fogColor, clamp(fFactor, 0.0, 1.0));
                }

                void main() {
                    float fragCoordZ = texture2D(tDepth, vUv).x;
                    float viewZ = perspectiveDepthToViewZ(fragCoordZ, cameraNear, cameraFar);
                    float realDepth = viewZToOrthographicDepth(viewZ, cameraNear, cameraFar) * (cameraFar - cameraNear);
                    float alpha = texture2D(tDiffuse, vUv).a;
                    
                    vec4 finalColor = vec4(0.0);
                    if (dofEnabled) {
                        float coc = abs(realDepth - focusDistance) / max(realDepth, 0.1);
                        float blurAmount = clamp(coc * (1.0 / max(aperture, 0.1)) * 0.015, 0.0, 0.025); 
                        
                        if (blurAmount > 0.001) {
                            vec3 bColor = vec3(0.0);
                            float tot = 0.0;
                            float rndAngle = hash12(vUv * (100.0 + time)) * 6.283185;
                            float cA = cos(rndAngle); float sA = sin(rndAngle);
                            mat2 rotMat = mat2(cA, -sA, sA, cA);

                            for(int i = 0; i < 16; i++) {
                                float r = sqrt(float(i) + 0.5) / sqrt(16.0);
                                float theta = float(i) * 2.3999632;
                                vec2 jitteredOffset = rotMat * (vec2(cos(theta), sin(theta)) * r * blurAmount);
                                bColor += getFoggedColor(vUv + jitteredOffset);
                                tot += 1.0;
                            }
                            finalColor = vec4(bColor / tot, alpha);
                        } else {
                            finalColor = vec4(getFoggedColor(vUv), alpha);
                        }
                    } else {
                        finalColor = vec4(getFoggedColor(vUv), alpha);
                    }

                    vec3 outColor = finalColor.rgb;
                    outColor = max(outColor, vec3(0.0));

                    if (!isPreview) {
                        outColor *= uExposure; // 替换为安全的 uExposure
                        outColor = clamp((outColor * (2.51 * outColor + 0.03)) / (outColor * (2.43 * outColor + 0.59) + 0.14), 0.0, 1.0);
                    }

                    vec3 srgbCondition = step(outColor, vec3(0.0031308));
                    vec3 srgbHigher = pow(outColor, vec3(0.41666)) * 1.055 - vec3(0.055);
                    vec3 srgbLower = outColor * 12.92;
                    
                    outColor = mix(srgbHigher, srgbLower, srgbCondition);

                    gl_FragColor = vec4(outColor, finalColor.a);
                }
            `
        });
        this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial));

        if (!renderer._hasAtmospherePatch) {
            const originalRender = renderer.render;
            renderer.render = function(sceneToRender, cameraToRender) {
                const now = performance.now();
                if (!window.AtmosphereManager.lastTime) window.AtmosphereManager.lastTime = now;
                const delta = (now - window.AtmosphereManager.lastTime) / 1000.0;
                window.AtmosphereManager.lastTime = now;

                if (window.AtmosphereManager.mainScene && sceneToRender === window.AtmosphereManager.mainScene && this.getRenderTarget() === null) {
                    const isFog = window.AtmosphereManager.postMaterial.uniforms.fogEnabled.value;
                    const isDof = window.AtmosphereManager.postMaterial.uniforms.dofEnabled.value;
                    
                    if (isFog || isDof) {
                        window.AtmosphereManager.fogTime += delta;

                        this.setRenderTarget(window.AtmosphereManager.ptTarget);
                        const oldBg = sceneToRender.background;
                        if(isFog) {
                            const uiColor = window.AtmosphereManager.postMaterial.uniforms.fogColor.value;
                            sceneToRender.background = uiColor;
                        }
                        originalRender.call(this, sceneToRender, cameraToRender);
                        sceneToRender.background = oldBg;

                        sceneToRender.background = null;
                        this.setRenderTarget(window.AtmosphereManager.depthTarget);
                        originalRender.call(this, sceneToRender, cameraToRender);
                        sceneToRender.background = oldBg;
                        
                        window.AtmosphereManager.postMaterial.uniforms.time.value = window.AtmosphereManager.fogTime;
                        // 更新安全命名的 uExposure
                        window.AtmosphereManager.postMaterial.uniforms.uExposure.value = renderer.toneMappingExposure;
                        window.AtmosphereManager.postMaterial.uniforms.isPreview.value = true;

                        this.setRenderTarget(null);
                        originalRender.call(this, window.AtmosphereManager.postScene, window.AtmosphereManager.postCamera);
                        return;
                    }
                }
                originalRender.call(this, sceneToRender, cameraToRender);
            };
            renderer._hasAtmospherePatch = true;
        }
    },

    updateParams: function(enabled, density, config) {
        if (this.postMaterial) {
            this.postMaterial.uniforms.fogEnabled.value = enabled;
            this.postMaterial.uniforms.fogDensity.value = density;
            if (config && typeof config === 'object') {
                if (config.color) this.postMaterial.uniforms.fogColor.value.set(config.color);
                const typeMap = { 'basic': 0, 'noise': 1, 'height': 2, 'animated': 3 };
                this.postMaterial.uniforms.fogType.value = typeMap[config.type] !== undefined ? typeMap[config.type] : 0;
                this.postMaterial.uniforms.fogParam1.value = config.p1 || 0;
                this.postMaterial.uniforms.fogParam2.value = config.p2 || 0;
            }
        }
    },

    updateDoFParams: function(enabled, aperture, focusDistance) {
        if (this.postMaterial) {
            this.postMaterial.uniforms.dofEnabled.value = enabled;
            this.postMaterial.uniforms.aperture.value = aperture;
            this.postMaterial.uniforms.focusDistance.value = focusDistance;
        }
    },

    resize: function(renderer) {
        if(this.ptTarget) {
            const dpr = renderer.getPixelRatio() || 1;
            const w = window.innerWidth * dpr;
            const h = window.innerHeight * dpr;
            this.ptTarget.setSize(w, h);
            this.depthTarget.setSize(w, h);
        }
    },

    render: function(pathTracer, renderer, scene, camera) {
        if (!this.ptTarget) return false;

        window.AtmosphereManager.lastTime = performance.now();

        renderer.setRenderTarget(this.ptTarget);
        pathTracer.renderSample();

        const oldBg = scene.background; 
        scene.background = null; 
        renderer.setRenderTarget(this.depthTarget);
        renderer.render(scene, camera); 
        
        if (this.postMaterial) {
            this.postMaterial.uniforms.time.value = this.fogTime;
            // 更新安全命名的 uExposure
            this.postMaterial.uniforms.uExposure.value = renderer.toneMappingExposure;
            this.postMaterial.uniforms.isPreview.value = false;
            this.postMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
            this.postMaterial.uniforms.cameraWorldMatrix.value.copy(camera.matrixWorld);
        }

        scene.background = oldBg;
        renderer.setRenderTarget(null);
        renderer.render(this.postScene, this.postCamera);
        
        return true;
    }
};

if (window.PluginManager) window.PluginManager.register('atmosphere', window.AtmosphereManager);