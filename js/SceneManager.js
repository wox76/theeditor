import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as POSTPROCESSING from 'postprocessing';
import { 
    SSGIEffect, 
    SSREffect, 
    TRAAEffect, 
    MotionBlurEffect, 
    HBAOEffect, 
    VelocityDepthNormalPass 
} from 'realism-effects';

export class SceneManager {
    constructor(app) {
        this.app = app;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.viewport = document.getElementById('viewport');
        
        // Custom features state
        this.hasSplatEnv = false;

        // Realism Effects pipeline state (0beqz)
        this.composer = null;
        this.velocityDepthNormalPass = null;
        this.ssgiEffect = null;
        this.ssrEffect = null;
        this.hbaoEffect = null;
        this.motionBlurEffect = null;
        this.traaEffect = null;

        this.realismSSGI = {
            enabled: false,
            distance: 10,
            thickness: 5,
            steps: 20,
            denoiseIterations: 1
        };
        this.realismSSR = {
            enabled: false,
            intensity: 1.0
        };
        this.realismAO = {
            enabled: false,
            type: 'HBAO',
            radius: 10
        };
        this.realismMotionBlur = {
            enabled: false,
            intensity: 1.0
        };
        this.realismAAMode = 'Disabled'; // 'TRAA', 'SMAA', 'FXAA', 'Disabled'
        
        // Environment & Post-Process Settings
        this.fogType = 'none';
        this.fogColor = '#101216';
        this.fogDensity = 0.015;
        this.fogNear = 1;
        this.fogFar = 100;
        
        this.ambientColor = '#b58aa5';
        this.ambientIntensity = 0.6;
        this.ambientLight = null;
        
        this.bloomIntensity = 0.5;
        this.bloomRadius = 0.4;
        this.ssaoIntensity = 1.0;
        this.ssaoRadius = 0.006;
        this.vignetteStrength = 1.0;
        
        this.sunPitch = 30; // Sun elevation degrees
        this.hdrIntensity = 0.8;
        this.hdrRotation = 0; // Degrees
        this.skyDome = null;
        this.skyMaterial = null;
        
        // Cube Camera Reflections
        this.cubeRenderTarget = null;
        this.cubeCamera = null;
        this.useReflections = false;
        
        // Custom Post-process passes targets
        this.sceneRenderTarget = null;
        this.ssaoRenderTarget = null;
        this.bloomThresholdTarget = null;
        this.bloomBlurTarget = null;
        
        this.postScene = null;
        this.postCamera = null;
        this.postQuad = null;
        
        // Custom Raymarching Path Tracer
        this.usePathTracing = false;
        this.ptSamples = 0;
        this.ptAccumTargets = [];
        this.ptDenoiseTarget = null;
        this.ptScene = null;
        this.ptCamera = null;
        this.ptRenderQuad = null;
        this.maxPtSamples = 200;
        
        // Grid properties
        this.gridSize = 40;
        this.gridDivisions = 40;
        this.gridCenterColor = '#555555';
        this.gridColor = '#888888';
        this.gridHelperRef = null;
        
        this.pbrExposure = 1.0;
        this.skyboxData = null;
        this.skyboxFilename = '';
        this.skyboxTexture = null;
        this.skyboxVisible = true;
    }

    init() {
        // Scene Setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.fogColor);

        // Camera Setup
        this.camera = new THREE.PerspectiveCamera(45, this.viewport.clientWidth / this.viewport.clientHeight, 0.1, 200);
        this.camera.position.set(5, 5, 5);

        // Create isolated Shadow DOM inside viewport to guard WebGL canvas from extensions
        let shadow = this.viewport.shadowRoot;
        if (!shadow) {
            shadow = this.viewport.attachShadow({ mode: 'open' });
        } else {
            shadow.innerHTML = '';
        }

        const style = document.createElement('style');
        style.textContent = `
            canvas {
                width: 100%;
                height: 100%;
                display: block;
                outline: none;
            }
        `;
        shadow.appendChild(style);

        const canvas = document.createElement('canvas');
        shadow.appendChild(canvas);

        // Add a slot to allow rendering of light DOM overlay children (like the floating toolbar)
        const slot = document.createElement('slot');
        shadow.appendChild(slot);

        // WebGL2 context acquisition with robust hardware fallbacks
        let gl = null;
        const optionsList = [
            { antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false, depth: true },
            { antialias: true, alpha: false, stencil: false, depth: true },
            { antialias: true, stencil: false, depth: true },
            { stencil: false, depth: true },
            { powerPreference: 'default' },
            {}
        ];

        for (const opts of optionsList) {
            try {
                gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
                if (gl) break;
            } catch (e) {}
        }

        try {
            if (gl) {
                this.renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl, antialias: true });
            } else {
                console.warn("[SceneManager] Direct WebGL context acquisition returned null, attempting default WebGLRenderer fallback");
                this.renderer = new THREE.WebGLRenderer({ canvas: canvas });
            }
        } catch (e) {
            console.error("[SceneManager] Failed to create WebGLRenderer with gl context, retrying default:", e);
            try {
                this.renderer = new THREE.WebGLRenderer({ canvas: canvas });
            } catch (err) {
                console.error("[SceneManager] Critical WebGLRenderer error:", err);
            }
        }
        this.renderer.shadowMap.enabled = true;
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(this.viewport.clientWidth, this.viewport.clientHeight);

        this.ambientLight = new THREE.AmbientLight(this.ambientColor, this.ambientIntensity);
        this.scene.add(this.ambientLight);

        // Helpers (directional light mimicking Main Sun Light)
        this.dirLight = new THREE.DirectionalLight(0xfff7e6, 1.0);
        this.dirLight.position.set(15, 22, 10);
        this.dirLight.castShadow = true;
        this.dirLight.shadow.mapSize.width = 2048;
        this.dirLight.shadow.mapSize.height = 2048;
        this.dirLight.shadow.bias = -0.0005;
        this.dirLight.shadow.normalBias = 0.05;
        this.dirLight.shadow.radius = 4.0;
        this.dirLight.shadow.camera.left = -60;
        this.dirLight.shadow.camera.right = 60;
        this.dirLight.shadow.camera.top = 60;
        this.dirLight.shadow.camera.bottom = -60;
        this.dirLight.shadow.camera.near = 0.5;
        this.dirLight.shadow.camera.far = 150;
        this.scene.add(this.dirLight);

        // Default grid
        this.updateGrid(this.gridSize, this.gridDivisions, this.gridCenterColor, this.gridColor);

        // Compass initialization
        this.compassCanvas = document.getElementById('compass-canvas');
        if (this.compassCanvas) {
            this.compassCtx = this.compassCanvas.getContext('2d');
        }

        // Initialize features
        this.initAtmosphere();
        this.initPostProcessing();
        this.initPathTracer();
        this.updateSunPosition();

        // Resize Observer
        const res = new ResizeObserver(() => this.onResize());
        res.observe(this.viewport);

        this.rebuildRealismPipeline();
        this.onResize();
    }

    initAtmosphere() {
        // Procedural Dynamic Sky Shader Dome
        this.skyMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vWorldPosition;
                uniform vec3 sunDirection;
                
                float hash(vec3 p) {
                    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
                    p += dot(p.xyz, p.yzx + 19.19);
                    return fract(p.x * p.y * p.z);
                }

                void main() {
                    vec3 dir = normalize(vWorldPosition);
                    float sunElevation = sunDirection.y;
                    
                    vec3 skyColor = vec3(0.0);
                    
                    vec3 dayZenith = vec3(0.05, 0.35, 0.85);
                    vec3 dayHorizon = vec3(0.7, 0.85, 0.95);
                    
                    vec3 sunsetZenith = vec3(0.08, 0.04, 0.15);
                    vec3 sunsetHorizon = vec3(0.95, 0.45, 0.1);
                    
                    vec3 nightZenith = vec3(0.005, 0.005, 0.015);
                    vec3 nightHorizon = vec3(0.02, 0.01, 0.04);
                    
                    if (sunElevation > 0.1) {
                        float mixRatio = clamp(dir.y, 0.0, 1.0);
                        skyColor = mix(dayHorizon, dayZenith, mixRatio);
                        float sunSpot = max(0.0, dot(dir, normalize(sunDirection)));
                        skyColor += vec3(1.0, 0.95, 0.85) * pow(sunSpot, 40.0) * 0.6;
                    } else if (sunElevation > -0.1) {
                        float t = (sunElevation - (-0.1)) / 0.2;
                        float mixRatio = clamp(dir.y, 0.0, 1.0);
                        vec3 targetSky = mix(sunsetHorizon, sunsetZenith, mixRatio);
                        vec3 sourceSky = mix(dayHorizon, dayZenith, mixRatio);
                        skyColor = mix(targetSky, sourceSky, t);
                        float sunSpot = max(0.0, dot(dir, normalize(sunDirection)));
                        skyColor += vec3(1.0, 0.5, 0.1) * pow(sunSpot, 30.0) * (1.0 - t * 0.4);
                    } else {
                        float mixRatio = clamp(dir.y, 0.0, 1.0);
                        skyColor = mix(nightHorizon, nightZenith, mixRatio);
                        if (dir.y > 0.0) {
                            float starVal = hash(floor(dir * 180.0));
                            if (starVal > 0.994) {
                                float starPulse = starVal * abs(sin(starVal * 100.0));
                                skyColor += vec3(starPulse * 0.8);
                            }
                        }
                    }

                    gl_FragColor = vec4(skyColor, 1.0);
                }
            `,
            uniforms: {
                sunDirection: { value: new THREE.Vector3(1, 1, 1) }
            },
            side: THREE.BackSide
        });

        const skyGeo = new THREE.SphereGeometry(150, 32, 15);
        this.skyDome = new THREE.Mesh(skyGeo, this.skyMaterial);
        this.scene.add(this.skyDome);

        this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, {
            generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter
        });
        this.cubeCamera = new THREE.CubeCamera(0.1, 200, this.cubeRenderTarget);
        this.cubeCamera.position.set(0, 0, 0);
        this.scene.add(this.cubeCamera);

        this.useReflections = true;
        this.updateEnvironmentMap();
    }

    initPostProcessing() {
        const width = this.viewport.clientWidth || 1024;
        const height = this.viewport.clientHeight || 768;

        this.sceneRenderTarget = new THREE.WebGLRenderTarget(width, height, {
            depthTexture: new THREE.DepthTexture(),
            type: THREE.HalfFloatType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter
        });

        this.ssaoRenderTarget = new THREE.WebGLRenderTarget(width, height);
        this.bloomThresholdTarget = new THREE.WebGLRenderTarget(width / 2, height / 2, { type: THREE.HalfFloatType });
        this.bloomBlurTarget = new THREE.WebGLRenderTarget(width / 2, height / 2, { type: THREE.HalfFloatType });

        this.postScene = new THREE.Scene();
        this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        // SSAO material
        this.ssaoMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDepth;
                uniform mat4 projection;
                uniform mat4 projectionInverse;
                uniform vec2 resolution;
                uniform float intensity;
                uniform float ssaoRadius;
                varying vec2 vUv;

                float rand(vec2 co) {
                    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
                }

                vec3 getViewPosition(vec2 uv) {
                    float depth = texture2D(tDepth, uv).r;
                    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
                    vec4 viewPos = projectionInverse * ndc;
                    return viewPos.xyz / viewPos.w;
                }

                vec3 getViewNormal(vec2 uv, vec3 viewPos) {
                    vec2 texelSize = 2.5 / resolution;
                    vec3 p_r = getViewPosition(uv + vec2(texelSize.x, 0.0));
                    vec3 p_d = getViewPosition(uv + vec2(0.0, texelSize.y));
                    vec3 p_l = getViewPosition(uv + vec2(-texelSize.x, 0.0));
                    vec3 p_u = getViewPosition(uv + vec2(0.0, -texelSize.y));
                    
                    vec3 hDeriv = (abs(p_r.z - viewPos.z) < abs(p_l.z - viewPos.z)) ? (p_r - viewPos) : (viewPos - p_l);
                    vec3 vDeriv = (abs(p_d.z - viewPos.z) < abs(p_u.z - viewPos.z)) ? (p_d - viewPos) : (viewPos - p_u);
                    
                    vec3 normal = normalize(cross(hDeriv, vDeriv));
                    if (normal.z < 0.0) normal = -normal;
                    return normal;
                }

                vec3 getOffset(int i) {
                    if (i == 0) return vec3( 0.33,  0.54,  0.30);
                    if (i == 1) return vec3(-0.17,  0.13,  0.72);
                    if (i == 2) return vec3(-0.38, -0.65,  0.34);
                    if (i == 3) return vec3( 0.18, -0.61,  0.49);
                    if (i == 4) return vec3( 0.42,  0.12,  0.56);
                    if (i == 5) return vec3(-0.41,  0.49,  0.19);
                    if (i == 6) return vec3(-0.02, -0.12,  0.34);
                    if (i == 7) return vec3( 0.01,  0.22,  0.14);
                    if (i == 8) return vec3( 0.54, -0.29,  0.12);
                    if (i == 9) return vec3(-0.62, -0.19,  0.30);
                    if (i == 10) return vec3( 0.11,  0.74,  0.21);
                    if (i == 11) return vec3(-0.12, -0.44,  0.64);
                    if (i == 12) return vec3( 0.39, -0.11,  0.71);
                    if (i == 13) return vec3(-0.25,  0.31,  0.48);
                    if (i == 14) return vec3( 0.11, -0.17,  0.75);
                    return vec3(0.0, 0.0, 1.0);
                }

                void main() {
                    vec3 viewPos = getViewPosition(vUv);
                    
                    float depth = texture2D(tDepth, vUv).r;
                    if (depth >= 1.0) {
                        gl_FragColor = vec4(1.0);
                        return;
                    }

                    vec3 normal = getViewNormal(vUv, viewPos);
                    
                    float ao = 0.0;
                    float R = ssaoRadius * 150.0;
                    
                    float noise = rand(vUv * resolution);
                    float angle = noise * 6.2831853;
                    float cosA = cos(angle);
                    float sinA = sin(angle);
                    mat2 rotMat = mat2(cosA, -sinA, sinA, cosA);
                    
                    for(int i = 0; i < 15; i++) {
                        vec3 offset = getOffset(i);
                        offset.xy = rotMat * offset.xy;
                        offset *= sign(dot(offset, normal));
                        
                        float scale = float(i) / 15.0;
                        scale = mix(0.1, 1.0, scale * scale);
                        vec3 samplePos = viewPos + offset * R * scale;
                        
                        vec4 offsetProj = projection * vec4(samplePos, 1.0);
                        vec2 sampleUV = (offsetProj.xy / offsetProj.w) * 0.5 + 0.5;
                        
                        if (sampleUV.x >= 0.0 && sampleUV.x <= 1.0 && sampleUV.y >= 0.0 && sampleUV.y <= 1.0) {
                            vec3 sampleRealPos = getViewPosition(sampleUV);
                            vec3 v = sampleRealPos - viewPos;
                            float dist = length(v);
                            
                            if (dist < R) {
                                float bias = 0.02;
                                float dotVal = dot(normalize(v), normal);
                                float attenuation = clamp(1.0 - dist / R, 0.0, 1.0);
                                ao += max(0.0, dotVal - bias) * attenuation;
                            }
                        }
                    }

                    ao = clamp(1.0 - (ao / 15.0) * intensity * 2.5, 0.0, 1.0);
                    gl_FragColor = vec4(vec3(ao), 1.0);
                }
            `,
            uniforms: {
                tDepth: { value: null },
                projection: { value: new THREE.Matrix4() },
                projectionInverse: { value: new THREE.Matrix4() },
                resolution: { value: new THREE.Vector2(width, height) },
                intensity: { value: this.ssaoIntensity },
                ssaoRadius: { value: this.ssaoRadius }
            }
        });

        // Bloom threshold
        this.bloomThresholdMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                varying vec2 vUv;
                void main() {
                    vec4 color = texture2D(tDiffuse, vUv);
                    float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
                    if (brightness > 0.75) {
                        gl_FragColor = color;
                    } else {
                        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                    }
                }
            `,
            uniforms: {
                tDiffuse: { value: null }
            }
        });

        // Blur Material
        this.blurMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tInput;
                uniform vec2 direction;
                uniform float radius;
                varying vec2 vUv;
                void main() {
                    vec2 texelSize = 1.0 / vec2(textureSize(tInput, 0));
                    vec4 color = vec4(0.0);
                    float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
                    
                    color += texture2D(tInput, vUv) * weights[0];
                    for(int i = 1; i < 5; i++) {
                        vec2 offset = direction * float(i) * texelSize * radius * 3.75;
                        color += texture2D(tInput, vUv + offset) * weights[i];
                        color += texture2D(tInput, vUv - offset) * weights[i];
                    }
                    gl_FragColor = color;
                }
            `,
            uniforms: {
                tInput: { value: null },
                direction: { value: new THREE.Vector2(1, 0) },
                radius: { value: this.bloomRadius }
            }
        });

        // Composite Material
        this.compositeMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform sampler2D tDepth;
                uniform sampler2D tSSAO;
                uniform sampler2D tBloom;
                
                uniform vec3 fogColor;
                uniform float fogDensity;
                uniform int fogType;
                uniform float fogNear;
                uniform float fogFar;
                uniform float bloomIntensity;
                uniform float vignetteStrength;
                uniform bool ssaoEnabled;
                uniform float pbrExposure;
                uniform bool pbrEnabled;
                uniform bool ssrEnabled;
                uniform float ssrIntensity;
                
                uniform mat4 projectionInverse;
                uniform mat4 viewInverse;
                uniform mat4 projectionMatrixUniform;
                uniform vec2 resolution;
 
                uniform int numLights;
                uniform vec3 lightPositions[10];
                uniform vec3 lightColors[10];
                uniform float lightRanges[10];
 
                varying vec2 vUv;
 
                float rand(vec2 co) {
                    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
                }

                vec3 getViewPosition(vec2 coord, float depth) {
                    vec4 ndc = vec4(coord * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
                    vec4 viewPos = projectionInverse * ndc;
                    return viewPos.xyz / viewPos.w;
                }

                vec3 getViewNormal(vec2 uv, float depth) {
                    vec3 viewPos = getViewPosition(uv, depth);
                    vec2 texelSize = 2.5 / resolution;
                    
                    vec3 p_r = getViewPosition(uv + vec2(texelSize.x, 0.0), texture2D(tDepth, uv + vec2(texelSize.x, 0.0)).r);
                    vec3 p_d = getViewPosition(uv + vec2(0.0, texelSize.y), texture2D(tDepth, uv + vec2(0.0, texelSize.y)).r);
                    vec3 p_l = getViewPosition(uv + vec2(-texelSize.x, 0.0), texture2D(tDepth, uv + vec2(-texelSize.x, 0.0)).r);
                    vec3 p_u = getViewPosition(uv + vec2(0.0, -texelSize.y), texture2D(tDepth, uv + vec2(0.0, -texelSize.y)).r);
                    
                    vec3 hDeriv = (abs(p_r.z - viewPos.z) < abs(p_l.z - viewPos.z)) ? (p_r - viewPos) : (viewPos - p_l);
                    vec3 vDeriv = (abs(p_d.z - viewPos.z) < abs(p_u.z - viewPos.z)) ? (p_d - viewPos) : (viewPos - p_u);
                    
                    vec3 normal = normalize(cross(hDeriv, vDeriv));
                    if (normal.z < 0.0) normal = -normal;
                    return normal;
                }

                vec2 projectToUV(vec3 p) {
                    vec4 proj = projectionMatrixUniform * vec4(p, 1.0);
                    vec3 ndc = proj.xyz / proj.w;
                    return ndc.xy * 0.5 + 0.5;
                }

                vec3 getSSRColor(vec3 pos, vec3 normal, out float hitMask) {
                    hitMask = 0.0;
                    vec3 viewDir = normalize(pos);
                    vec3 reflectDir = reflect(viewDir, normal);
                    
                    if (reflectDir.z > 0.0) return vec3(0.0);
                    
                    // Jitter the step size per pixel to break up banding/lines
                    float dither = rand(vUv * vec2(12.9898, 78.233)) * 0.03;
                    float stepSize = 0.08 + dither;
                    vec3 currentPos = pos + normal * 0.05;
                    vec3 prevPos = currentPos;
                    
                    for (int i = 0; i < 48; i++) {
                        prevPos = currentPos;
                        currentPos += reflectDir * stepSize;
                        
                        vec2 uv = projectToUV(currentPos);
                        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
                        
                        float dDepth = texture2D(tDepth, uv).r;
                        if (dDepth >= 1.0) continue;
                        
                        vec3 samplePos = getViewPosition(uv, dDepth);
                        
                        float depthDiff = currentPos.z - samplePos.z;
                        if (i > 1 && depthDiff < 0.0 && depthDiff > -0.6) {
                            // Binary search refinement for sub-pixel accuracy
                            vec3 minPos = prevPos;
                            vec3 maxPos = currentPos;
                            for (int b = 0; b < 5; b++) {
                                vec3 midPos = mix(minPos, maxPos, 0.5);
                                vec2 midUv = projectToUV(midPos);
                                float midDepth = texture2D(tDepth, midUv).r;
                                vec3 midSample = getViewPosition(midUv, midDepth);
                                if (midPos.z - midSample.z < 0.0) {
                                    maxPos = midPos;
                                } else {
                                    minPos = midPos;
                                }
                            }
                            
                            vec2 finalUv = projectToUV(maxPos);
                            hitMask = 1.0;
                            float edgeFade = min(1.0, 10.0 * min(min(finalUv.x, 1.0 - finalUv.x), min(finalUv.y, 1.0 - finalUv.y)));
                            hitMask *= clamp(edgeFade, 0.0, 1.0);
                            
                            // Fresnel term for realistic reflection falloff
                            float fresnel = pow(1.0 - clamp(dot(-viewDir, normal), 0.0, 1.0), 5.0);
                            hitMask *= mix(0.15, 1.0, fresnel);
                            
                            return texture2D(tDiffuse, finalUv).rgb;
                        }
                    }
                    return vec3(0.0);
                }

                vec3 ACESFilm(vec3 x) {
                    float a = 2.51;
                    float b = 0.03;
                    float c = 2.43;
                    float d = 0.59;
                    float e = 0.14;
                    return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
                }
 
                void main() {
                    vec4 diffuse = texture2D(tDiffuse, vUv);
                    float depth = texture2D(tDepth, vUv).r;
                    
                    float ao = 1.0;
                    if (ssaoEnabled) {
                        float aoSum = 0.0;
                        float weightSum = 0.0;
                        // 3x3 bilateral blur to smooth SSAO noise
                        for (int x = -1; x <= 1; x++) {
                            for (int y = -1; y <= 1; y++) {
                                vec2 offset = vec2(float(x), float(y)) / resolution;
                                float sampleAo = texture2D(tSSAO, vUv + offset).r;
                                float sampleDepth = texture2D(tDepth, vUv + offset).r;
                                float depthDiff = abs(depth - sampleDepth);
                                float w = exp(-depthDiff * 400.0);
                                aoSum += sampleAo * w;
                                weightSum += w;
                            }
                        }
                        ao = aoSum / (weightSum + 0.0001);
                    }
                    
                    vec3 bloom = texture2D(tBloom, vUv).rgb;
                    vec3 baseColor = diffuse.rgb * ao;
 
                    if (depth >= 1.0) {
                        vec3 bgCol = baseColor + bloom * bloomIntensity;
                        bgCol *= pbrExposure;
                        if (pbrEnabled) {
                            bgCol = ACESFilm(bgCol);
                        }
                        gl_FragColor = vec4(bgCol, 1.0);
                        return;
                    }
 
                    vec3 viewPos = getViewPosition(vUv, depth);
                    vec3 worldPos = (viewInverse * vec4(viewPos, 1.0)).xyz;
                    vec3 camWorldPos = (viewInverse * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
 
                    float dist = length(worldPos - camWorldPos);
                    float fogFactor = 0.0;
                    if (fogType == 1) {
                        fogFactor = (dist - fogNear) / (fogFar - fogNear);
                    } else if (fogType == 2) {
                        fogFactor = 1.0 - exp(-dist * fogDensity);
                    }
                    fogFactor = clamp(fogFactor, 0.0, 1.0);
 
                    vec3 scattering = vec3(0.0);
                    vec3 viewDir = normalize(worldPos - camWorldPos);
 
                    for (int i = 0; i < 10; i++) {
                        if (i >= numLights) break;
                        vec3 lightPos = lightPositions[i];
                        vec3 lightCol = lightColors[i];
                        float range = lightRanges[i];
 
                        vec3 lightDir = lightPos - camWorldPos;
                        float rayProj = dot(lightDir, viewDir);
                        rayProj = clamp(rayProj, 0.0, dist);
 
                        vec3 closestPoint = camWorldPos + viewDir * rayProj;
                        float dLight = length(lightPos - closestPoint);
                        
                        if (dLight < range) {
                            float attenuation = pow(clamp(1.0 - dLight / range, 0.0, 1.0), 3.0);
                            scattering += lightCol * attenuation * 0.06 * fogFactor;
                        }
                    }
 
                    vec3 finalColor = mix(baseColor, fogColor, fogFactor);
                    
                    if (ssrEnabled) {
                        float hitMask = 0.0;
                        vec3 normal = getViewNormal(vUv, depth);
                        vec3 ssrColor = getSSRColor(viewPos, normal, hitMask);
                        finalColor = mix(finalColor, ssrColor, hitMask * clamp(ssrIntensity, 0.0, 1.0));
                    }

                    finalColor += scattering + bloom * bloomIntensity;
 
                    finalColor *= pbrExposure;
                    if (pbrEnabled) {
                        finalColor = ACESFilm(finalColor);
                    }
 
                    vec2 uv = vUv - 0.5;
                    float vignette = 1.0 - dot(uv, uv) * vignetteStrength;
                    finalColor *= clamp(vignette, 0.0, 1.0);
 
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            uniforms: {
                tDiffuse: { value: null },
                tDepth: { value: null },
                tSSAO: { value: null },
                tBloom: { value: null },
                resolution: { value: new THREE.Vector2() },
                
                fogColor: { value: new THREE.Color(this.fogColor) },
                fogDensity: { value: this.fogDensity },
                fogType: { value: 0 },
                fogNear: { value: this.fogNear },
                fogFar: { value: this.fogFar },
                bloomIntensity: { value: this.bloomIntensity },
                vignetteStrength: { value: this.vignetteStrength },
                ssaoEnabled: { value: true },
                pbrExposure: { value: 1.0 },
                pbrEnabled: { value: true },
                ssrEnabled: { value: false },
                ssrIntensity: { value: 0.45 },
                
                projectionInverse: { value: new THREE.Matrix4() },
                viewInverse: { value: new THREE.Matrix4() },
                projectionMatrixUniform: { value: new THREE.Matrix4() },
 
                numLights: { value: 0 },
                lightPositions: { value: [] },
                lightColors: { value: [] },
                lightRanges: { value: [] }
            }
        });
 
        this.postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial);
        this.postScene.add(this.postQuad);
    }

    initPathTracer() {
        const width = this.viewport.clientWidth || 1024;
        const height = this.viewport.clientHeight || 768;
        
        this.ptAccumTargets = [
            new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType }),
            new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType })
        ];

        this.ptDenoiseTarget = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType });

        // Custom WebGL Path Tracer shader
        this.ptMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec2 resolution;
                uniform float frame;
                uniform sampler2D accumTexture;
                uniform mat4 cameraMatrix;
                uniform float cameraFov;

                uniform int numSpheres;
                uniform vec4 spherePosRadius[10]; 
                uniform vec3 sphereColor[10];
                uniform vec4 spherePBR[10];
                uniform vec4 sphereEmissive[10];
                uniform vec4 sphereGlass[10];

                uniform int numBoxes;
                uniform vec3 boxPos[10];
                uniform vec3 boxSize[10];
                uniform vec3 boxColor[10];
                uniform vec4 boxPBR[10];
                uniform vec4 boxEmissive[10];
                uniform vec4 boxGlass[10];

                uniform vec3 ambientLight;
                uniform vec3 sunDirection;

                varying vec2 vUv;

                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
                }

                vec3 getSkyColor(vec3 dir, vec3 sunDir) {
                    float sunElevation = sunDir.y;
                    vec3 skyColor = vec3(0.0);
                    
                    vec3 dayZenith = vec3(0.05, 0.35, 0.85);
                    vec3 dayHorizon = vec3(0.7, 0.85, 0.95);
                    vec3 sunsetZenith = vec3(0.08, 0.04, 0.15);
                    vec3 sunsetHorizon = vec3(0.95, 0.45, 0.1);
                    vec3 nightZenith = vec3(0.005, 0.005, 0.015);
                    vec3 nightHorizon = vec3(0.02, 0.01, 0.04);
                    
                    if (sunElevation > 0.1) {
                        float mixRatio = clamp(dir.y, 0.0, 1.0);
                        skyColor = mix(dayHorizon, dayZenith, mixRatio);
                        float sunSpot = max(0.0, dot(dir, normalize(sunDir)));
                        skyColor += vec3(1.0, 0.95, 0.85) * pow(sunSpot, 40.0) * 1.5;
                    } else if (sunElevation > -0.1) {
                        float t = (sunElevation - (-0.1)) / 0.2;
                        float mixRatio = clamp(dir.y, 0.0, 1.0);
                        vec3 targetSky = mix(sunsetHorizon, sunsetZenith, mixRatio);
                        vec3 sourceSky = mix(dayHorizon, dayZenith, mixRatio);
                        skyColor = mix(targetSky, sourceSky, t);
                        float sunSpot = max(0.0, dot(dir, normalize(sunDir)));
                        skyColor += vec3(1.0, 0.5, 0.1) * pow(sunSpot, 30.0) * (1.0 - t * 0.4) * 1.5;
                    } else {
                        float mixRatio = clamp(dir.y, 0.0, 1.0);
                        skyColor = mix(nightHorizon, nightZenith, mixRatio);
                        float p = fract(sin(dot(floor(dir * 180.0), vec3(443.8975, 397.2973, 491.1871))) * 43758.5453);
                        if (dir.y > 0.0 && p > 0.994) {
                            skyColor += vec3(p * 0.8);
                        }
                    }
                    return skyColor;
                }

                vec3 randomSphereDirection(inout vec2 seed) {
                    float u = hash(seed); seed.x += 0.13;
                    float v = hash(seed); seed.y += 0.17;
                    float theta = u * 2.0 * 3.14159265;
                    float phi = acos(2.0 * v - 1.0);
                    return vec3(sin(phi)*cos(theta), sin(phi)*sin(theta), cos(phi));
                }

                float intersectSphere(vec3 ro, vec3 rd, vec3 pos, float r, out vec3 normal) {
                    vec3 oc = ro - pos;
                    float b = dot(oc, rd);
                    float c = dot(oc, oc) - r * r;
                    float h = b * b - c;
                    if (h < 0.0) return -1.0;
                    h = sqrt(h);
                    float t = -b - h;
                    if (t < 0.0) t = -b + h;
                    if (t < 0.0) return -1.0;
                    normal = (ro + t * rd - pos) / r;
                    return t;
                }

                float intersectBox(vec3 ro, vec3 rd, vec3 pos, vec3 size, out vec3 normal) {
                    vec3 rad = size * 0.5;
                    vec3 m = 1.0 / rd;
                    vec3 n = m * (ro - pos);
                    vec3 k = abs(m) * rad;
                    vec3 t1 = -n - k;
                    vec3 t2 = -n + k;
                    float tN = max(max(t1.x, t1.y), t1.z);
                    float tF = min(min(t2.x, t2.y), t2.z);
                    if (tN > tF || tF < 0.0) return -1.0;
                    
                    if (tN == t1.x) normal = vec3(-sign(rd.x), 0.0, 0.0);
                    else if (tN == t1.y) normal = vec3(0.0, -sign(rd.y), 0.0);
                    else normal = vec3(0.0, 0.0, -sign(rd.z));
                    
                    return tN;
                }

                struct Hit {
                    float t;
                    vec3 normal;
                    vec3 color;
                    vec4 pbr;
                    vec3 emissive;
                    vec4 glass;
                };

                Hit sceneIntersect(vec3 ro, vec3 rd) {
                    Hit hit;
                    hit.t = 1e10;

                    for(int i = 0; i < 10; i++) {
                        if (i >= numSpheres) break;
                        vec3 normal;
                        float t = intersectSphere(ro, rd, spherePosRadius[i].xyz, spherePosRadius[i].w, normal);
                        if (t > 0.0 && t < hit.t) {
                            hit.t = t;
                            hit.normal = normal;
                            hit.color = sphereColor[i];
                            hit.pbr = spherePBR[i];
                            hit.emissive = sphereEmissive[i].rgb * sphereEmissive[i].w;
                            hit.glass = sphereGlass[i];
                        }
                    }

                    for(int i = 0; i < 10; i++) {
                        if (i >= numBoxes) break;
                        vec3 normal;
                        float t = intersectBox(ro, rd, boxPos[i], boxSize[i], normal);
                        if (t > 0.0 && t < hit.t) {
                            hit.t = t;
                            hit.normal = normal;
                            hit.color = boxColor[i];
                            hit.pbr = boxPBR[i];
                            hit.emissive = boxEmissive[i].rgb * boxEmissive[i].w;
                            hit.glass = boxGlass[i];
                        }
                    }

                    float tGround = -(ro.y + 0.01) / rd.y;
                    if(tGround > 0.0 && tGround < hit.t) {
                        hit.t = tGround;
                        hit.normal = vec3(0.0, 1.0, 0.0);
                        vec3 wPos = ro + tGround * rd;
                        float grid = mod(floor(wPos.x) + floor(wPos.z), 2.0);
                        hit.color = vec3(0.3) + vec3(0.15) * grid;
                        hit.pbr = vec4(0.7, 0.0, 0.0, 0.5);
                        hit.emissive = vec3(0.0);
                        hit.glass = vec4(0.0, 1.5, 0.0, 0.0);
                    }

                    return hit;
                }

                float fresnelSchlick(float cosTheta, float ior) {
                    float r0 = (1.0 - ior) / (1.0 + ior);
                    r0 = r0 * r0;
                    return r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);
                }

                void main() {
                    vec2 seed = vUv + frame * 0.033;
                    vec2 offset = vec2(hash(seed), hash(seed + 0.5)) - 0.5;
                    vec2 uv = (gl_FragCoord.xy + offset) / resolution;
                    vec2 d = uv * 2.0 - 1.0;
                    d.x *= resolution.x / resolution.y;

                    float scale = tan(cameraFov * 0.5 * 3.14159265 / 180.0);
                    vec3 rd = normalize(vec3(d.x * scale, d.y * scale, -1.0));
                    rd = (cameraMatrix * vec4(rd, 0.0)).xyz;
                    vec3 ro = (cameraMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

                    vec3 radiance = vec3(0.0);
                    vec3 throughput = vec3(1.0);

                    for(int bounce = 0; bounce < 5; bounce++) {
                        Hit hit = sceneIntersect(ro, rd);
                        if (hit.t > 1e9) {
                            radiance += throughput * getSkyColor(rd, sunDirection);
                            break;
                        }

                        radiance += throughput * hit.emissive;

                        float transmission = hit.glass.x;
                        float ior = hit.glass.y;
                        float roughness = hit.pbr.x;
                        float metalness = hit.pbr.y;
                        float specular = hit.pbr.w;

                        float rnd = hash(seed); seed.x += 0.17;
                        
                        if (transmission > 0.0 && rnd < transmission) {
                            float cosTheta = dot(-rd, hit.normal);
                            float eta = cosTheta > 0.0 ? 1.0 / ior : ior;
                            vec3 norm = cosTheta > 0.0 ? hit.normal : -hit.normal;
                            
                            float fresnel = fresnelSchlick(abs(cosTheta), ior);
                            float bounceSelect = hash(seed + 0.4);
                            
                            if (bounceSelect < fresnel) {
                                rd = reflect(rd, norm);
                            } else {
                                rd = refract(rd, norm, eta);
                                if (length(rd) < 0.1) {
                                    rd = reflect(rd, norm);
                                } else {
                                    float sss = hit.glass.w;
                                    if (sss > 0.0 && hash(seed + 0.82) < sss) {
                                        rd = randomSphereDirection(seed);
                                        if (dot(rd, norm) > 0.0) {
                                            rd = -rd;
                                        }
                                    }
                                }
                            }
                            rd = normalize(mix(rd, norm + randomSphereDirection(seed), roughness * 0.3));
                            ro = ro + hit.t * rd + rd * 0.002;
                        } else {
                            ro = ro + hit.t * rd + hit.normal * 0.001;
                            vec3 diffuseDir = normalize(hit.normal + randomSphereDirection(seed));
                            vec3 specularDir = reflect(rd, hit.normal);
                            specularDir = normalize(mix(specularDir, diffuseDir, roughness));
                            
                            float specularChance = mix(0.08 * specular, 0.95, metalness);
                            float selectBounce = hash(seed + 0.13);
                            
                            if (selectBounce < specularChance) {
                                rd = specularDir;
                                throughput *= hit.color;
                            } else {
                                rd = diffuseDir;
                                throughput *= hit.color * (1.0 - metalness);
                            }
                        }

                        float p = max(throughput.x, max(throughput.y, throughput.z));
                        if(hash(seed + float(bounce)) > p) break;
                        throughput /= p;
                    }

                    vec4 prev = texture2D(accumTexture, vUv);
                    float weight = 1.0 / (frame + 1.0);
                    vec3 finalColor = mix(prev.rgb, radiance, weight);
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            uniforms: {
                resolution: { value: new THREE.Vector2() },
                frame: { value: 0 },
                accumTexture: { value: null },
                cameraMatrix: { value: new THREE.Matrix4() },
                cameraFov: { value: 45 },
                
                numSpheres: { value: 0 },
                spherePosRadius: { value: [] },
                sphereColor: { value: [] },
                spherePBR: { value: [] },
                sphereEmissive: { value: [] },
                sphereGlass: { value: [] },
                
                numBoxes: { value: 0 },
                boxPos: { value: [] },
                boxSize: { value: [] },
                boxColor: { value: [] },
                boxPBR: { value: [] },
                boxEmissive: { value: [] },
                boxGlass: { value: [] },

                ambientLight: { value: new THREE.Color() },
                sunDirection: { value: new THREE.Vector3() }
            }
        });

        // Joint Bilateral Denoise
        this.denoiseMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tInput;
                uniform sampler2D tDepth;
                uniform vec2 resolution;
                varying vec2 vUv;

                float readDepth(vec2 uv) {
                    return texture2D(tDepth, uv).r;
                }

                void main() {
                    vec2 texel = 1.0 / resolution;
                    vec4 centerColor = texture2D(tInput, vUv);
                    float centerDepth = readDepth(vUv);
                    
                    float weightSum = 1.0;
                    vec4 colorSum = centerColor;

                    for(int x = -3; x <= 3; x++) {
                        for(int y = -3; y <= 3; y++) {
                            if(x == 0 && y == 0) continue;
                            vec2 offset = vec2(float(x), float(y)) * texel;
                            vec2 sampleUv = vUv + offset;
                            
                            vec4 neighborColor = texture2D(tInput, sampleUv);
                            float neighborDepth = readDepth(sampleUv);
                            
                            if (neighborColor.r != neighborColor.r || neighborColor.g != neighborColor.g || neighborColor.b != neighborColor.b ||
                                neighborDepth != neighborDepth) {
                                continue;
                            }
                            
                            float dSpatial = dot(offset * resolution, offset * resolution);
                            float wSpatial = exp(clamp(-dSpatial / 12.0, -30.0, 0.0));
                            
                            float dRangeColor = dot(neighborColor.rgb - centerColor.rgb, neighborColor.rgb - centerColor.rgb);
                            float wRangeColor = exp(clamp(-dRangeColor / 0.15, -30.0, 0.0));
                            
                            float dDepth = abs(neighborDepth - centerDepth) * 2000.0;
                            float wDepth = exp(clamp(-dDepth * dDepth, -30.0, 0.0));
                            
                            float w = wSpatial * wRangeColor * wDepth;
                            colorSum += neighborColor * w;
                            weightSum += w;
                        }
                    }

                    vec4 result = colorSum / weightSum;
                    if (result.r != result.r || result.g != result.g || result.b != result.b) {
                        result = centerColor;
                    }
                    gl_FragColor = result;
                }
            `,
            uniforms: {
                tInput: { value: null },
                tDepth: { value: null },
                resolution: { value: new THREE.Vector2(width, height) }
            }
        });

        this.ptScene = new THREE.Scene();
        this.ptCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.ptRenderQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.ptMaterial);
        this.ptScene.add(this.ptRenderQuad);
    }

    setSplatMode(active) {
        this.hasSplatEnv = active;
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        const width = this.viewport.clientWidth;
        const height = this.viewport.clientHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);

        if (this.sceneRenderTarget) this.sceneRenderTarget.setSize(width, height);
        if (this.ssaoRenderTarget) this.ssaoRenderTarget.setSize(width, height);
        if (this.bloomThresholdTarget) this.bloomThresholdTarget.setSize(width / 2, height / 2);
        if (this.bloomBlurTarget) this.bloomBlurTarget.setSize(width / 2, height / 2);
        if (this.velocityDepthNormalPass) this.velocityDepthNormalPass.setSize(width, height);
        if (this.composer) this.composer.setSize(width, height);

        if (this.ptAccumTargets && this.ptAccumTargets.length === 2) {
            this.ptAccumTargets[0].setSize(width, height);
            this.ptAccumTargets[1].setSize(width, height);
        }
        if (this.ptDenoiseTarget) this.ptDenoiseTarget.setSize(width, height);

        const resEl = document.getElementById('res-counter');
        if (resEl) {
            resEl.textContent = `${width}x${height}`;
        }
        
        this.resetPathTracing();
    }

    cleanSceneChildren() {
        if (!this.scene) return;
        this.scene.traverse(node => {
            if (node && node.children && Array.isArray(node.children)) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    if (!node.children[i]) {
                        console.warn(`[Woxengine Safety Fix] Removed undefined child from node "${node.name}"`);
                        node.children.splice(i, 1);
                    }
                }
            }
        });
    }

    ensureBoundingSpheres() {
        if (!this.scene) return;
        this.scene.traverse(o => {
            if ((o.isMesh || o.isLine || o.isPoints) && o.geometry) {
                if (!o.geometry.boundingSphere) {
                    try {
                        o.geometry.computeBoundingSphere();
                    } catch (e) {}
                    if (!o.geometry.boundingSphere) {
                        o.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
                    }
                }
            }
        });
    }

    update() {
        if (!this.renderer || !this.scene || !this.camera) return;

        this.cleanSceneChildren();
        this.ensureBoundingSpheres();
        this.drawCompass();

        // Increment Sequencer Clock
        if (this.isSeqPlaying) {
            this.seqTime += 0.3;
            if (this.seqTime > 100) {
                if (this.seqLoop) {
                    this.seqTime = 0;
                } else {
                    this.seqTime = 100;
                    this.isSeqPlaying = false;
                }
            }
            this.interpolateSequencer();
            
            const playhead = document.getElementById('timeline-playhead');
            if (playhead) {
                playhead.style.left = `${this.seqTime}%`;
            }
        }

        if (this.usePathTracing) {
            this.renderPathTracer();
        } else if (this.hasSplatEnv) {
            try {
                this.renderer.render(this.scene, this.camera);
            } catch (e) {
                console.warn("[SceneManager] Splat render error:", e);
            }
        } else {
            this.renderRealtimePBR();
        }
    }

    interpolateSequencer() {
        if (!this.keyframes || this.keyframes.length === 0) return;

        const tracks = {};
        this.keyframes.forEach(k => {
            if (!tracks[k.actorId]) tracks[k.actorId] = [];
            tracks[k.actorId].push(k);
        });

        Object.keys(tracks).forEach(actorId => {
            let obj = null;
            this.scene.traverse(child => {
                if (child.uuid === actorId || child.name === actorId) {
                    obj = child;
                }
            });
            if (!obj) return;

            const list = tracks[actorId].sort((a, b) => a.time - b.time);
            let prevK = list[0];
            let nextK = list[list.length - 1];

            for (let i = 0; i < list.length; i++) {
                if (list[i].time <= this.seqTime) {
                    prevK = list[i];
                }
                if (list[i].time >= this.seqTime) {
                    nextK = list[i];
                    break;
                }
            }

            let factor = 0;
            if (nextK.time !== prevK.time) {
                factor = (this.seqTime - prevK.time) / (nextK.time - prevK.time);
            }

            obj.position.lerpVectors(prevK.pos, nextK.pos, factor);
            const q1 = new THREE.Quaternion().setFromEuler(prevK.rot);
            const q2 = new THREE.Quaternion().setFromEuler(nextK.rot);
            q1.slerp(q2, factor);
            obj.rotation.setFromQuaternion(q1);
            obj.scale.lerpVectors(prevK.scl, nextK.scl, factor);
        });

        this.resetPathTracing();
    }

    drawCompass() {
        if (!this.compassCtx || !this.camera) return;
        const ctx = this.compassCtx;
        ctx.clearRect(0, 0, 64, 64);
        
        const cx = 32;
        const cy = 32;

        const drawAxis = (axisVec, label, color) => {
            const screenX = cx + axisVec.x * 20;
            const screenY = cy - axisVec.y * 20;
            
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(screenX, screenY);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = color;
            ctx.font = 'bold 9px Inter';
            ctx.fillText(label, screenX - 3, screenY - 3);
        };

        drawAxis(new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion), 'X', '#ef4444');
        drawAxis(new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion), 'Y', '#22c55e');
        drawAxis(new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion), 'Z', '#3b82f6');
    }

    updateSunPosition() {
        const rad = THREE.MathUtils.degToRad(this.sunPitch);
        this.dirLight.position.set(20 * Math.cos(rad), 20 * Math.sin(rad), 10);
        if (this.skyMaterial) {
            this.skyMaterial.uniforms.sunDirection.value.copy(this.dirLight.position).normalize();
        }
        
        if (this.sunPitch < 0) {
            this.fogColor = '#06070a';
        } else if (this.sunPitch < 15) {
            this.fogColor = '#1f1324'; // Sunset tint
        } else {
            this.fogColor = '#101216';
        }

        const fogColorInput = document.getElementById('game-fog-color');
        if (fogColorInput) {
            fogColorInput.value = this.fogColor;
        }
        this.updateEnvironment();
        this.updateEnvironmentMap();
    }

    applyEnvironmentToMaterials() {
        if (!this.scene || !this.scene.environment) return;
        const intensity = (this.hdrIntensity !== undefined && this.hdrIntensity !== null) ? this.hdrIntensity : 1.5;
        this.scene.environmentIntensity = intensity;
    }

    setupRoomEnvironment() {
        if (!this.renderer) return;
        if (!this.roomEnvironmentTexture) {
            try {
                const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
                pmremGenerator.compileEquirectangularShader();
                const roomEnv = new RoomEnvironment(this.renderer);
                this.roomEnvironmentTexture = pmremGenerator.fromScene(roomEnv).texture;
                pmremGenerator.dispose();
            } catch (e) {
                console.warn("[SceneManager] Failed to generate RoomEnvironment texture:", e);
            }
        }
        if (!this.skyboxTexture && this.roomEnvironmentTexture) {
            this.scene.environment = this.roomEnvironmentTexture;
            this.scene.environmentIntensity = this.hdrIntensity !== undefined ? this.hdrIntensity : 0.8;
            this.applyEnvironmentToMaterials();
        }
    }

    updateEnvironmentMap() {
        if (this.skyboxTexture) {
            this.scene.environment = this.skyboxTexture;
            this.applyEnvironmentToMaterials();
            return;
        }

        // If no custom skybox is uploaded, use RoomEnvironment for beautiful ambient PBR reflections
        this.setupRoomEnvironment();
    }

    updateEnvironment() {
        if (this.scene.background instanceof THREE.Color) {
            this.scene.background.set(this.fogColor);
        } else if (!this.scene.background) {
            this.scene.background = new THREE.Color(this.fogColor);
        }

        // Apply custom HDR intensity and rotation safely
        const safeIntensity = (typeof this.hdrIntensity === 'number' && !isNaN(this.hdrIntensity)) ? this.hdrIntensity : 0.8;
        const safeRotationDeg = (typeof this.hdrRotation === 'number' && !isNaN(this.hdrRotation)) ? this.hdrRotation : 0;
        const safeRotationRad = safeRotationDeg * (Math.PI / 180);

        if (this.scene.background && !(this.scene.background instanceof THREE.Color)) {
            this.scene.backgroundIntensity = safeIntensity;
            if (this.scene.backgroundRotation) {
                this.scene.backgroundRotation.y = safeRotationRad;
            }
        }
        if (this.scene.environment) {
            this.scene.environmentIntensity = safeIntensity;
            if (this.scene.environmentRotation) {
                this.scene.environmentRotation.y = safeRotationRad;
            }
        }
        
        const safeAmbient = (typeof this.ambientIntensity === 'number' && !isNaN(this.ambientIntensity)) ? this.ambientIntensity : 0.6;
        this.ambientLight.intensity = safeAmbient;
        
        if (this.fogType === 'linear') {
            this.scene.fog = new THREE.Fog(this.fogColor, this.fogNear !== undefined ? this.fogNear : 1.0, this.fogFar !== undefined ? this.fogFar : 100.0);
        } else if (this.fogType === 'exponential' || this.fogType === 'exp') {
            this.scene.fog = new THREE.FogExp2(this.fogColor, this.fogDensity !== undefined ? this.fogDensity : 0.015);
        } else {
            this.scene.fog = null;
        }

        if (this.compositeMaterial) {
            this.compositeMaterial.uniforms.fogColor.value.set(this.fogColor);
            this.compositeMaterial.uniforms.fogDensity.value = this.fogDensity;
            
            let fTypeInt = 0;
            if (this.fogType === 'linear') fTypeInt = 1;
            else if (this.fogType === 'exponential' || this.fogType === 'exp') fTypeInt = 2;
            this.compositeMaterial.uniforms.fogType.value = fTypeInt;
            this.compositeMaterial.uniforms.fogNear.value = this.fogNear !== undefined ? this.fogNear : 1.0;
            this.compositeMaterial.uniforms.fogFar.value = this.fogFar !== undefined ? this.fogFar : 100.0;

            this.compositeMaterial.uniforms.bloomIntensity.value = this.bloomIntensity;
            this.compositeMaterial.uniforms.vignetteStrength.value = this.vignetteStrength;
            this.compositeMaterial.uniforms.ssaoEnabled.value = (this.ssaoIntensity > 0);
            this.compositeMaterial.uniforms.pbrExposure.value = this.pbrExposure !== undefined ? this.pbrExposure : 1.0;
            this.compositeMaterial.uniforms.pbrEnabled.value = this.pbrEnabled !== false;
            this.compositeMaterial.uniforms.ssrEnabled.value = !!this.useSSR;
            this.compositeMaterial.uniforms.ssrIntensity.value = (this.ssrIntensity !== undefined ? this.ssrIntensity : 0.45);
        }

        if (this.ssaoMaterial) {
            this.ssaoMaterial.uniforms.intensity.value = this.ssaoIntensity;
            this.ssaoMaterial.uniforms.ssaoRadius.value = this.ssaoRadius;
        }
        
        this.resetPathTracing();
    }

    rebuildRealismPipeline() {
        if (!this.renderer || !this.scene || !this.camera) return;

        try {
            const width = this.viewport.clientWidth || window.innerWidth;
            const height = this.viewport.clientHeight || window.innerHeight;

            if (!this.composer) {
                this.composer = new POSTPROCESSING.EffectComposer(this.renderer, {
                    frameBufferType: THREE.HalfFloatType
                });
            } else {
                while (this.composer.passes.length > 0) {
                    this.composer.removePass(this.composer.passes[0]);
                }
            }

            this.composer.setSize(width, height);

            // 1. VelocityDepthNormalPass
            if (!this.velocityDepthNormalPass) {
                this.velocityDepthNormalPass = new VelocityDepthNormalPass(this.scene, this.camera);
            }
            this.velocityDepthNormalPass.setSize(width, height);
            this.composer.addPass(this.velocityDepthNormalPass);

            // 2. Base scene RenderPass (always required)
            const renderPass = new POSTPROCESSING.RenderPass(this.scene, this.camera);
            this.composer.addPass(renderPass);

            // 3. Main Realism Effects (SSGI / SSR / HBAO / Bloom)
            const mainEffects = [];

            if (this.realismSSGI.enabled) {
                this.ssgiEffect = new SSGIEffect(this.composer, this.scene, this.camera, {
                    velocityDepthNormalPass: this.velocityDepthNormalPass,
                    distance: this.realismSSGI.distance,
                    thickness: this.realismSSGI.thickness,
                    steps: this.realismSSGI.steps,
                    denoiseIterations: this.realismSSGI.denoiseIterations
                });
                mainEffects.push(this.ssgiEffect);
            } else if (this.realismSSR.enabled) {
                this.ssrEffect = new SSREffect(this.composer, this.scene, this.camera, {
                    velocityDepthNormalPass: this.velocityDepthNormalPass,
                    intensity: this.realismSSR.intensity
                });
                mainEffects.push(this.ssrEffect);
            }

            if (this.realismAO.enabled) {
                this.hbaoEffect = new HBAOEffect(this.composer, this.camera, this.scene);
                mainEffects.push(this.hbaoEffect);
            }

            if (this.useBloom) {
                const bloomEffect = new POSTPROCESSING.BloomEffect({
                    intensity: this.bloomIntensity,
                    mipmapBlur: true,
                    luminanceSmoothing: 0.5,
                    luminanceThreshold: 0.75
                });
                mainEffects.push(bloomEffect);
            }

            if (mainEffects.length > 0) {
                this.composer.addPass(new POSTPROCESSING.EffectPass(this.camera, ...mainEffects));
            }

            // 4. AA & Motion Blur Pass
            const postEffects = [];
            if (this.realismMotionBlur.enabled) {
                this.motionBlurEffect = new MotionBlurEffect(this.velocityDepthNormalPass, {
                    intensity: this.realismMotionBlur.intensity
                });
                postEffects.push(this.motionBlurEffect);
            }

            if (this.realismAAMode === 'TRAA') {
                this.traaEffect = new TRAAEffect(this.scene, this.camera, this.velocityDepthNormalPass);
                postEffects.push(this.traaEffect);
            } else if (this.realismAAMode === 'SMAA') {
                const smaa = new POSTPROCESSING.SMAAEffect();
                postEffects.push(smaa);
            } else if (this.realismAAMode === 'FXAA') {
                const fxaa = new POSTPROCESSING.FXAAEffect();
                postEffects.push(fxaa);
            }

            if (postEffects.length > 0) {
                this.composer.addPass(new POSTPROCESSING.EffectPass(this.camera, ...postEffects));
            }

            // Ensure the final pass in composer renders directly to the canvas screen
            if (this.composer.passes.length > 0) {
                this.composer.passes.forEach(p => p.renderToScreen = false);
                this.composer.passes[this.composer.passes.length - 1].renderToScreen = true;
            }
        } catch (e) {
            console.error("[SceneManager] Error rebuilding Realism Effects pipeline:", e);
        }
    }

    setRealismSSGI(enabled, distance, thickness, steps, denoise) {
        this.realismSSGI.enabled = !!enabled;
        if (distance !== undefined && distance !== null) this.realismSSGI.distance = parseFloat(distance);
        if (thickness !== undefined && thickness !== null) this.realismSSGI.thickness = parseFloat(thickness);
        if (steps !== undefined && steps !== null) this.realismSSGI.steps = parseInt(steps);
        if (denoise !== undefined && denoise !== null) this.realismSSGI.denoiseIterations = parseInt(denoise);
        this.rebuildRealismPipeline();
    }

    setRealismSSR(enabled, intensity) {
        this.realismSSR.enabled = !!enabled;
        if (intensity !== undefined && intensity !== null) this.realismSSR.intensity = parseFloat(intensity);
        this.rebuildRealismPipeline();
    }

    setRealismAO(enabled, type, radius) {
        this.realismAO.enabled = !!enabled;
        if (type !== undefined && type !== null) this.realismAO.type = type;
        if (radius !== undefined && radius !== null) this.realismAO.radius = parseFloat(radius);
        this.rebuildRealismPipeline();
    }

    setRealismMotionBlur(enabled, intensity) {
        this.realismMotionBlur.enabled = !!enabled;
        if (intensity !== undefined && intensity !== null) this.realismMotionBlur.intensity = parseFloat(intensity);
        this.rebuildRealismPipeline();
    }

    setRealismAAMode(mode) {
        this.realismAAMode = mode || 'Disabled';
        this.rebuildRealismPipeline();
    }

    renderRealtimePBR() {
        const isRealismActive = this.realismSSGI.enabled || 
                                this.realismSSR.enabled || 
                                this.realismAO.enabled || 
                                this.realismMotionBlur.enabled || 
                                (this.realismAAMode && this.realismAAMode !== 'Disabled');

        if (isRealismActive && this.composer) {
            try {
                this.composer.render();
                return;
            } catch (e) {
                console.warn("[SceneManager] Realism EffectComposer render fallback:", e);
            }
        }

        // Render base scene fallback
        try {
            this.renderer.setRenderTarget(this.sceneRenderTarget);
            this.renderer.render(this.scene, this.camera);
        } catch (e) {
            console.warn("[SceneManager] PBR base scene render error:", e);
        }

        // 1. SSAO Pass
        this.postQuad.material = this.ssaoMaterial;
        this.ssaoMaterial.uniforms.tDepth.value = this.sceneRenderTarget.depthTexture;
        
        const size = new THREE.Vector2();
        this.renderer.getSize(size);
        this.ssaoMaterial.uniforms.resolution.value.copy(size);
        this.ssaoMaterial.uniforms.projection.value.copy(this.camera.projectionMatrix);
        this.ssaoMaterial.uniforms.projectionInverse.value.copy(this.camera.projectionMatrixInverse);

        this.renderer.setRenderTarget(this.ssaoRenderTarget);
        this.renderer.render(this.postScene, this.postCamera);

        // 2. Bloom Threshold Pass
        this.postQuad.material = this.bloomThresholdMaterial;
        this.bloomThresholdMaterial.uniforms.tDiffuse.value = this.sceneRenderTarget.texture;
        this.renderer.setRenderTarget(this.bloomThresholdTarget);
        this.renderer.render(this.postScene, this.postCamera);

        // 3. Bloom Blur Horizontal
        this.postQuad.material = this.blurMaterial;
        this.blurMaterial.uniforms.tInput.value = this.bloomThresholdTarget.texture;
        this.blurMaterial.uniforms.direction.value.set(1, 0);
        this.renderer.setRenderTarget(this.bloomBlurTarget);
        this.renderer.render(this.postScene, this.postCamera);
        
        // 4. Bloom Blur Vertical
        this.postQuad.material = this.blurMaterial;
        this.blurMaterial.uniforms.tInput.value = this.bloomBlurTarget.texture;
        this.blurMaterial.uniforms.direction.value.set(0, 1);
        this.renderer.setRenderTarget(this.bloomThresholdTarget); 
        this.renderer.render(this.postScene, this.postCamera);

        // 5. Composite Pass
        this.postQuad.material = this.compositeMaterial;
        this.renderer.setRenderTarget(null);
        
        const uniforms = this.compositeMaterial.uniforms;
        uniforms.tDiffuse.value = this.sceneRenderTarget.texture;
        uniforms.tDepth.value = this.sceneRenderTarget.depthTexture;
        uniforms.tSSAO.value = this.ssaoRenderTarget.texture;
        uniforms.tBloom.value = this.bloomThresholdTarget.texture;
        uniforms.projectionInverse.value.copy(this.camera.projectionMatrixInverse);
        uniforms.viewInverse.value.copy(this.camera.matrixWorld);
        uniforms.projectionMatrixUniform.value.copy(this.camera.projectionMatrix);
        uniforms.resolution.value.copy(size);

        // Fetch scene lights dynamically
        const scatterLights = [];
        this.scene.traverse(child => {
            if (child.isLight && (child.isPointLight || child.isSpotLight) && child.visible) {
                scatterLights.push(child);
            }
            // Check for emissive meshes to treat as virtual lights
            if (child.isMesh && child.visible && child.material && !child.userData.isHelper) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    if (mat.emissive) {
                        const r = mat.emissive.r;
                        const g = mat.emissive.g;
                        const b = mat.emissive.b;
                        const intensity = mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 1.0;
                        if ((r > 0.01 || g > 0.01 || b > 0.01) && intensity > 0.01) {
                            const worldPos = new THREE.Vector3();
                            child.getWorldPosition(worldPos);
                            
                            // Estimate range based on intensity
                            const range = Math.max(5.0, intensity * 8.0);
                            
                            scatterLights.push({
                                isVirtual: true,
                                getWorldPosition: (targetVec) => targetVec.copy(worldPos),
                                color: new THREE.Color(r, g, b),
                                intensity: intensity * 1.5,
                                distance: range
                            });
                        }
                    }
                });
            }
        });

        const lightPositions = [];
        const lightColors = [];
        const lightRanges = [];

        scatterLights.forEach(light => {
            const worldPos = new THREE.Vector3();
            light.getWorldPosition(worldPos);
            lightPositions.push(worldPos);
            lightColors.push(light.color.clone().multiplyScalar(light.intensity));
            lightRanges.push(light.distance !== undefined && light.distance > 0 ? light.distance : 40);
        });

        while (lightPositions.length < 10) {
            lightPositions.push(new THREE.Vector3());
            lightColors.push(new THREE.Color());
            lightRanges.push(0.0);
        }

        uniforms.numLights.value = Math.min(scatterLights.length, 10);
        uniforms.lightPositions.value = lightPositions;
        uniforms.lightColors.value = lightColors;
        uniforms.lightRanges.value = lightRanges;

        this.renderer.render(this.postScene, this.postCamera);
    }

    updatePathTracerUniforms() {
        const spheres = [];
        const boxes = [];
        let ambientIntensity = this.ambientIntensity;

        this.scene.traverse(obj => {
            if (!obj.visible) return;
            if (obj.isMesh && obj !== this.skyDome && obj.name !== "CustomGridHelper" && obj.name !== "Floor" && !obj.name.includes("Helper") && !obj.name.includes("Transform")) {
                if (!obj.material) return;
                 const color = obj.material.color || new THREE.Color(0xffffff);
                 const roughness = obj.material.roughness !== undefined ? obj.material.roughness : 0.5;
                 const metalness = obj.material.metalness !== undefined ? obj.material.metalness : 0.0;
                 const clearcoat = obj.material.clearcoat !== undefined ? obj.material.clearcoat : 0.0;
                 const emissive = obj.material.emissive || new THREE.Color(0x000000);
                 const emissiveIntensity = obj.material.emissiveIntensity !== undefined ? obj.material.emissiveIntensity : 0.0;
                 
                 const transmission = obj.material.transmission !== undefined ? obj.material.transmission : 0.0;
                 const ior = obj.material.ior !== undefined ? obj.material.ior : 1.5;
                 const iridescence = obj.material.iridescence !== undefined ? obj.material.iridescence : 0.0;
 
                 let p = obj;
                 while (p && p.parent && (!p.userData || p.userData.type !== 'Model')) {
                     p = p.parent;
                 }
                 const specular = (p && p.userData && p.userData.materialSpecular !== undefined) ? p.userData.materialSpecular : 0.5;
                 const subsurface = (p && p.userData && p.userData.materialSubsurfaceScattering !== undefined) ? p.userData.materialSubsurfaceScattering : 0.0;
 
                 const worldPos = new THREE.Vector3();
                 obj.getWorldPosition(worldPos);
 
                 if (obj.geometry.type === 'SphereGeometry') {
                     spheres.push({
                         pos: worldPos,
                         radius: obj.geometry.parameters.radius * obj.scale.x,
                         color: color.clone(),
                         pbr: new THREE.Vector4(roughness, metalness, clearcoat, specular),
                         emissive: new THREE.Vector4(emissive.r, emissive.g, emissive.b, emissiveIntensity),
                         glass: new THREE.Vector4(transmission, ior, iridescence, subsurface)
                     });
                 } else {
                     obj.geometry.computeBoundingBox();
                     const size = new THREE.Vector3();
                     obj.geometry.boundingBox.getSize(size).multiply(obj.scale);
                     
                     boxes.push({
                         pos: worldPos,
                         size: size,
                         color: color.clone(),
                         pbr: new THREE.Vector4(roughness, metalness, clearcoat, specular),
                         emissive: new THREE.Vector4(emissive.r, emissive.g, emissive.b, emissiveIntensity),
                         glass: new THREE.Vector4(transmission, ior, iridescence, subsurface)
                     });
                 }
            }
        });

        const spherePosRadius = [];
        const sphereColor = [];
        const spherePBR = [];
        const sphereEmissive = [];
        const sphereGlass = [];

        spheres.forEach(s => {
            spherePosRadius.push(new THREE.Vector4(s.pos.x, s.pos.y, s.pos.z, s.radius));
            sphereColor.push(s.color);
            spherePBR.push(s.pbr);
            sphereEmissive.push(s.emissive);
            sphereGlass.push(s.glass);
        });

        const boxPos = [];
        const boxSize = [];
        const boxColor = [];
        const boxPBR = [];
        const boxEmissive = [];
        const boxGlass = [];

        boxes.forEach(b => {
            boxPos.push(b.pos);
            boxSize.push(b.size);
            boxColor.push(b.color);
            boxPBR.push(b.pbr);
            boxEmissive.push(b.emissive);
            boxGlass.push(b.glass);
        });

        while (spherePosRadius.length < 10) {
            spherePosRadius.push(new THREE.Vector4());
            sphereColor.push(new THREE.Color());
            spherePBR.push(new THREE.Vector4());
            sphereEmissive.push(new THREE.Vector4());
            sphereGlass.push(new THREE.Vector4());
        }
        while (boxPos.length < 10) {
            boxPos.push(new THREE.Vector3());
            boxSize.push(new THREE.Vector3());
            boxColor.push(new THREE.Color());
            boxPBR.push(new THREE.Vector4());
            boxEmissive.push(new THREE.Vector4());
            boxGlass.push(new THREE.Vector4());
        }

        const uniforms = this.ptMaterial.uniforms;
        uniforms.numSpheres.value = Math.min(spheres.length, 10);
        uniforms.spherePosRadius.value = spherePosRadius;
        uniforms.sphereColor.value = sphereColor;
        uniforms.spherePBR.value = spherePBR;
        uniforms.sphereEmissive.value = sphereEmissive;
        uniforms.sphereGlass.value = sphereGlass;

        uniforms.numBoxes.value = Math.min(boxes.length, 10);
        uniforms.boxPos.value = boxPos;
        uniforms.boxSize.value = boxSize;
        uniforms.boxColor.value = boxColor;
        uniforms.boxPBR.value = boxPBR;
        uniforms.boxEmissive.value = boxEmissive;
        uniforms.boxGlass.value = boxGlass;

        const size = new THREE.Vector2();
        this.renderer.getSize(size);
        uniforms.resolution.value.copy(size);
        uniforms.cameraFov.value = this.camera.fov;
        uniforms.cameraMatrix.value.copy(this.camera.matrixWorld);
        uniforms.frame.value = this.ptSamples;
        uniforms.ambientLight.value.set(this.fogColor).multiplyScalar(ambientIntensity);
        uniforms.sunDirection.value.copy(this.dirLight.position).normalize();
    }

    renderPathTracer() {
        if (this.ptSamples >= this.maxPtSamples) return;

        const originalBg = this.scene.background;
        this.scene.background = null;
        this.renderer.setRenderTarget(this.sceneRenderTarget);
        this.renderer.render(this.scene, this.camera);
        this.scene.background = originalBg;

        this.updatePathTracerUniforms();

        const writeTarget = this.ptAccumTargets[this.ptSamples % 2];
        const readTarget = this.ptAccumTargets[(this.ptSamples + 1) % 2];

        this.ptMaterial.uniforms.accumTexture.value = readTarget.texture;
        
        this.renderer.setRenderTarget(writeTarget);
        this.renderer.render(this.ptScene, this.ptCamera);

        this.ptRenderQuad.material = this.denoiseMaterial;
        this.denoiseMaterial.uniforms.tInput.value = writeTarget.texture;
        this.denoiseMaterial.uniforms.tDepth.value = this.sceneRenderTarget.depthTexture;
        
        const size = new THREE.Vector2();
        this.renderer.getSize(size);
        this.denoiseMaterial.uniforms.resolution.value.copy(size);
        
        this.renderer.setRenderTarget(this.ptDenoiseTarget);
        this.renderer.render(this.ptScene, this.ptCamera);

        this.ptRenderQuad.material = this.ptMaterial;

        this.renderer.setRenderTarget(null);
        this.postQuad.material = new THREE.MeshBasicMaterial({ map: this.ptDenoiseTarget.texture });
        this.renderer.render(this.postScene, this.postCamera);
        
        this.postQuad.material = this.compositeMaterial;

        this.ptSamples++;

        const overlayEl = document.getElementById('path-tracing-overlay');
        const ptSamplesEl = document.getElementById('pt-samples');
        if (ptSamplesEl) {
            ptSamplesEl.textContent = `Samples: ${this.ptSamples} / ${this.maxPtSamples}`;
        }
        if (overlayEl) {
            if (this.ptSamples < this.maxPtSamples) {
                overlayEl.classList.remove('hidden');
            } else {
                overlayEl.classList.add('hidden');
            }
        }
    }

    resetPathTracing() {
        this.ptSamples = 0;
        const ptSamplesEl = document.getElementById('pt-samples');
        if (ptSamplesEl) {
            ptSamplesEl.textContent = `Samples: 0 / ${this.maxPtSamples}`;
        }
    }

    setPixelEffect(enabled, size) {
        // Stashed/no-op since we use custom composite pass now, or simple toggle
    }

    setBloomEffect(enabled, strength, radius) {
        this.useBloom = !!enabled;
        if (strength !== undefined && strength !== null && !isNaN(parseFloat(strength))) {
            this.bloomIntensity = parseFloat(strength);
        }
        if (radius !== undefined && radius !== null && !isNaN(parseFloat(radius))) {
            this.bloomRadius = parseFloat(radius);
            if (this.blurMaterial && this.blurMaterial.uniforms && this.blurMaterial.uniforms.radius) {
                this.blurMaterial.uniforms.radius.value = parseFloat(radius);
            }
        }
        this.updateEnvironment();
    }

    setCyberpunkEffect(enabled, aberration, scanlines) {
        // Stashed/no-op for composite compatibility
    }

    setExposure(val) {
        this.pbrExposure = val;
        this.renderer.toneMappingExposure = val;
        this.updateEnvironment();
    }

    setPBROutput(enabled) {
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.pbrEnabled = enabled;
        this.scene.traverse((child) => {
            if (child.isMesh && child.material) child.material.needsUpdate = true;
        });
        this.updateEnvironment();
    }

    setShadows(enabled) {
        this.renderer.shadowMap.enabled = enabled;
        this.dirLight.castShadow = enabled;
        this.scene.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = enabled;
                child.receiveShadow = enabled;
                if (child.material) child.material.needsUpdate = true;
            }
        });
    }

    setReflections(enabled) {
        this.useReflections = enabled;
        if (!enabled) {
            this.scene.environment = null;
        } else {
            this.updateEnvironmentMap();
        }
    }

    setSkybox(dataUrlOrNull, filename) {
        this.skyboxData = dataUrlOrNull;
        this.skyboxFilename = filename || '';

        if (!dataUrlOrNull) {
            if (this.skyboxTexture) {
                this.skyboxTexture.dispose();
                this.skyboxTexture = null;
            }
            if (this.skyDome) this.skyDome.visible = true;
            this.scene.background = new THREE.Color(this.fogColor);
            this.setupRoomEnvironment();
            return;
        }

        const isHDR = filename.toLowerCase().endsWith('.hdr');
        const applyTexture = (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            if (isHDR) {
                texture.colorSpace = THREE.LinearSRGBColorSpace;
            } else {
                texture.colorSpace = THREE.SRGBColorSpace;
            }

            if (this.skyDome) this.skyDome.visible = false;
            this.scene.background = this.skyboxVisible ? texture : new THREE.Color(this.fogColor);
            this.scene.environment = texture;

            const intensity = (this.hdrIntensity !== undefined && this.hdrIntensity !== null) ? this.hdrIntensity : 1.5;
            this.scene.environmentIntensity = intensity;
            this.scene.backgroundIntensity = intensity;

            if (this.skyboxTexture && this.skyboxTexture !== texture) {
                this.skyboxTexture.dispose();
            }
            this.skyboxTexture = texture;
            this.resetPathTracing();
        };

        if (isHDR) {
            new RGBELoader().load(dataUrlOrNull, (texture) => {
                applyTexture(texture);
            }, undefined, (err) => {
                console.error('Error loading HDR skybox:', err);
            });
        } else {
            new THREE.TextureLoader().load(dataUrlOrNull, (texture) => {
                applyTexture(texture);
            }, undefined, (err) => {
                console.error('Error loading image skybox:', err);
            });
        }
    }

    setSkyboxIntensity(intensity) {
        this.hdrIntensity = intensity;
        this.scene.environmentIntensity = intensity;
        this.scene.backgroundIntensity = intensity;
        this.applyEnvironmentToMaterials();
        this.updateEnvironment();
    }

    setSkyboxVisibility(visible) {
        this.skyboxVisible = visible;
        if (this.skyboxTexture) {
            this.scene.background = visible ? this.skyboxTexture : new THREE.Color(this.fogColor);
        } else {
            this.scene.background = new THREE.Color(this.fogColor);
        }
    }

    updateGrid(size, divisions, centerColor, gridColor) {
        this.gridSize = size || 40;
        this.gridDivisions = divisions || 40;
        this.gridCenterColor = centerColor || '#555555';
        this.gridColor = gridColor || '#888888';

        if (this.gridHelperRef) {
            this.scene.remove(this.gridHelperRef);
        }

        this.gridHelperRef = new THREE.GridHelper(this.gridSize, this.gridDivisions, new THREE.Color(this.gridCenterColor), new THREE.Color(this.gridColor));
        this.gridHelperRef.name = "CustomGridHelper";
        this.scene.add(this.gridHelperRef);
    }

    setAmbientColor(colorHex) {
        this.ambientColor = colorHex;
        if (this.ambientLight) {
            this.ambientLight.color.set(colorHex);
        }
    }

    setAmbientIntensity(intensity) {
        const val = (intensity !== undefined && intensity !== null && !isNaN(parseFloat(intensity))) ? parseFloat(intensity) : 1.5;
        this.ambientIntensity = val;
        if (this.ambientLight) {
            this.ambientLight.intensity = val;
        }
    }

    setFog(type, colorHex, density, near, far) {
        this.fogType = type || 'none';
        if (colorHex !== undefined) this.fogColor = colorHex;
        if (density !== undefined) this.fogDensity = density;
        if (near !== undefined) this.fogNear = near;
        if (far !== undefined) this.fogFar = far;
        this.updateEnvironment();
    }

    setSSAO(enabled, radius, intensity) {
        this.useSSAO = enabled;
        if (intensity !== undefined) {
            this.ssaoIntensity = enabled ? intensity : 0.0;
        } else {
            this.ssaoIntensity = enabled ? 1.0 : 0.0;
        }
        if (radius !== undefined) this.ssaoRadius = radius / 150.0; // scale standard slider value to PBR custom value
        this.updateEnvironment();
    }

    setSSR(enabled, intensity) {
        this.useSSR = !!enabled;
        if (intensity !== undefined && intensity !== null && !isNaN(parseFloat(intensity))) {
            this.ssrIntensity = parseFloat(intensity);
        }
        this.updateEnvironment();
    }

    setPathTracing(enabled) {
        this.usePathTracing = enabled;
        const ptOverlay = document.getElementById('path-tracing-overlay');
        if (ptOverlay) {
            if (enabled) {
                ptOverlay.classList.remove('hidden');
            } else {
                ptOverlay.classList.add('hidden');
            }
        }
        this.resetPathTracing();
    }
}
