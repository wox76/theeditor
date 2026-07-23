import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export class Engine3D {
    constructor(containerEl, onSelectionChanged, onUpdatePT) {
        this.container = containerEl;
        this.onSelectionChanged = onSelectionChanged;
        this.onUpdatePT = onUpdatePT;

        this.actors = [];
        this.mixers = [];
        this.clock = new THREE.Clock();
        this.selectedActor = null;
        this.renderMode = 'realtime'; // 'realtime' (PBR) or 'pathtracing'
        this.isPlaying = false;
        
        // Snapping Settings
        this.gridSnap = false;
        this.angleSnap = false;
        this.scaleSnap = false;

        // Path Tracing State
        this.ptSamples = 0;
        this.ptAccumTargets = [];
        this.ptRenderQuad = null;
        this.ptScene = null;
        this.ptCamera = null;
        this.maxPtSamples = 200;
        
        // Environment & Post-Process Settings
        this.fogColor = '#101216';
        this.fogDensity = 0.015;
        this.ambientIntensity = 0.2;
        this.bloomIntensity = 1.5;
        this.ssaoIntensity = 1.0;
        this.vignetteStrength = 1.0;
        this.sunPitch = 30; // Sun elevation degrees
        this.hdrIntensity = 1.0;
        this.hdrRotation = 0; // Degrees
        this.undoStack = [];
        this.gizmoCentered = false;
        this.gizmoPivot = new THREE.Object3D();

        // Animation Sequencer State
        this.keyframes = []; // Array of { actorId, time (0-100), pos, rot, scl }
        this.isSeqPlaying = false;
        this.seqTime = 0; // 0 to 100%
        this.seqLoop = true;

        this.initThree();
        this.initGridAndCompass();
        this.initAtmosphere();
        this.initControls();
        this.initPostProcessing();
        this.initPathTracer();
        this.setupDefaultScene();
        this.animate();

        window.addEventListener('resize', () => this.onResize());
    }

    initThree() {
        // Create an isolated Shadow DOM inside canvas-holder to guard WebGL from extensions
        const shadow = this.container.attachShadow({ mode: 'open' });
        
        // Dynamic style to stretch canvas in shadow DOM
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

        this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.fogColor);
        
        this.camera = new THREE.PerspectiveCamera(45, this.container.clientWidth / this.container.clientHeight, 0.1, 200);
        this.camera.position.set(10, 8, 15);

        this.ambientLight = new THREE.AmbientLight(0xffffff, this.ambientIntensity);
        this.scene.add(this.ambientLight);

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
    }

    initGridAndCompass() {
        this.gridHelper = new THREE.GridHelper(80, 80, 0xec6602, 0x2b2c30);
        this.gridHelper.position.y = -1.99;
        this.scene.add(this.gridHelper);

        this.compassCanvas = document.getElementById('compass-canvas');
        this.compassCtx = this.compassCanvas.getContext('2d');
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
                
                // Noise helper for star drawing
                float hash(vec3 p) {
                    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
                    p += dot(p.xyz, p.yzx + 19.19);
                    return fract(p.x * p.y * p.z);
                }

                void main() {
                    vec3 dir = normalize(vWorldPosition);
                    float sunElevation = sunDirection.y;
                    
                    vec3 skyColor = vec3(0.0);
                    
                    // Day Sky Gradient
                    vec3 dayZenith = vec3(0.05, 0.35, 0.85);
                    vec3 dayHorizon = vec3(0.7, 0.85, 0.95);
                    
                    // Sunset / Sunrise Gradient
                    vec3 sunsetZenith = vec3(0.08, 0.04, 0.15);
                    vec3 sunsetHorizon = vec3(0.95, 0.45, 0.1);
                    
                    // Night Sky
                    vec3 nightZenith = vec3(0.005, 0.005, 0.015);
                    vec3 nightHorizon = vec3(0.02, 0.01, 0.04);
                    
                    if (sunElevation > 0.1) {
                        // Fully Day
                        float mixRatio = clamp(dir.y, 0.0, 1.0);
                        skyColor = mix(dayHorizon, dayZenith, mixRatio);
                        
                        // Add glow around sun
                        float sunSpot = max(0.0, dot(dir, normalize(sunDirection)));
                        skyColor += vec3(1.0, 0.95, 0.85) * pow(sunSpot, 40.0) * 0.6;
                    } else if (sunElevation > -0.1) {
                        // Sunset transition
                        float t = (sunElevation - (-0.1)) / 0.2; // 0 to 1
                        float mixRatio = clamp(dir.y, 0.0, 1.0);
                        
                        vec3 targetSky = mix(sunsetHorizon, sunsetZenith, mixRatio);
                        vec3 sourceSky = mix(dayHorizon, dayZenith, mixRatio);
                        skyColor = mix(targetSky, sourceSky, t);
                        
                        // Sunset sun spot
                        float sunSpot = max(0.0, dot(dir, normalize(sunDirection)));
                        skyColor += vec3(1.0, 0.5, 0.1) * pow(sunSpot, 30.0) * (1.0 - t * 0.4);
                    } else {
                        // Night Mode + Stars
                        float mixRatio = clamp(dir.y, 0.0, 1.0);
                        skyColor = mix(nightHorizon, nightZenith, mixRatio);
                        
                        // Drawing procedurally generated stars
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

        // Real-time reflections capture camera & buffer
        this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, {
            generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter
        });
        this.cubeCamera = new THREE.CubeCamera(0.1, 200, this.cubeRenderTarget);
        this.cubeCamera.position.set(0, 0, 0); // centered capture
        this.scene.add(this.cubeCamera);
    }

    initControls() {
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        this.orbitControls.addEventListener('change', () => {
            this.resetPathTracing();
            if (this.gizmoCentered && this.selectedActor && !this.transformControls.dragging) {
                const dir = new THREE.Vector3();
                this.camera.getWorldDirection(dir);
                this.gizmoPivot.position.copy(this.camera.position).addScaledVector(dir, 8);
            }
        });

        this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
        this.transformControls.size = 0.75;
        this.scene.add(this.transformControls);
        this.scene.add(this.gizmoPivot);

        this.transformControls.addEventListener('change', () => {
            if (this.selectedActor) {
                if (this.gizmoCentered && this.pivotInitialPos) {
                    const deltaPos = new THREE.Vector3().subVectors(this.gizmoPivot.position, this.pivotInitialPos);
                    this.selectedActor.object.position.copy(this.actorInitialPos).add(deltaPos);
                    this.selectedActor.object.rotation.copy(this.gizmoPivot.rotation);
                    this.selectedActor.object.scale.copy(this.gizmoPivot.scale);
                }
                this.syncActorTransformToUI(this.selectedActor);
                this.resetPathTracing();
            }
        });
        
        this.transformControls.addEventListener('dragging-changed', (event) => {
            this.orbitControls.enabled = !event.value;
            if (event.value) {
                if (this.selectedActor) {
                    this.pivotInitialPos = this.gizmoPivot.position.clone();
                    this.actorInitialPos = this.selectedActor.object.position.clone();
                    
                    this.pivotInitialRot = this.gizmoPivot.rotation.clone();
                    this.actorInitialRot = this.selectedActor.object.rotation.clone();
        this.pivotInitialScl = this.gizmoPivot.scale.clone();
                    this.actorInitialScl = this.selectedActor.object.scale.clone();
                }
            } else {
                // Dragging finished! Update environment reflection map
                this.updateEnvironmentMap();
                this.saveUndoState();
            }
        });

        this.renderer.domElement.addEventListener('pointerdown', (e) => this.onViewportClick(e));
    }

    initPostProcessing() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.sceneRenderTarget = new THREE.WebGLRenderTarget(width, height, {
            depthTexture: new THREE.DepthTexture(),
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter
        });

        this.ssaoRenderTarget = new THREE.WebGLRenderTarget(width, height);
        this.bloomThresholdTarget = new THREE.WebGLRenderTarget(width / 2, height / 2);
        this.bloomBlurTarget = new THREE.WebGLRenderTarget(width / 2, height / 2);

        this.postScene = new THREE.Scene();
        this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        // SSAO shadow edges pass
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
                    vec2 texelSize = 1.0 / resolution;
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
                    float R = ssaoRadius * 150.0; // Scaled to look fantastic with the UI's radius input bounds
                    
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
                            float dist2 = dot(v, v);
                            float dist = sqrt(dist2);
                            
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
                ssaoRadius: { value: 0.006 }
            }
        });

        // Extract bright areas
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
                varying vec2 vUv;
                void main() {
                    vec2 texelSize = 1.0 / vec2(textureSize(tInput, 0));
                    vec4 color = vec4(0.0);
                    float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
                    
                    color += texture2D(tInput, vUv) * weights[0];
                    for(int i = 1; i < 5; i++) {
                        vec2 offset = direction * float(i) * texelSize * 1.5;
                        color += texture2D(tInput, vUv + offset) * weights[i];
                        color += texture2D(tInput, vUv - offset) * weights[i];
                    }
                    gl_FragColor = color;
                }
            `,
            uniforms: {
                tInput: { value: null },
                direction: { value: new THREE.Vector2(1, 0) }
            }
        });

        // Atmospheric composition with multi-lights fog scattering
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
                uniform float bloomIntensity;
                uniform float vignetteStrength;
                uniform bool ssaoEnabled;
                
                uniform mat4 projectionInverse;
                uniform mat4 viewInverse;

                uniform int numLights;
                uniform vec3 lightPositions[10];
                uniform vec3 lightColors[10];
                uniform float lightRanges[10];

                varying vec2 vUv;

                vec3 getViewPosition(vec2 coord, float depth) {
                    vec4 ndc = vec4(coord * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
                    vec4 viewPos = projectionInverse * ndc;
                    return viewPos.xyz / viewPos.w;
                }

                void main() {
                    vec4 diffuse = texture2D(tDiffuse, vUv);
                    float depth = texture2D(tDepth, vUv).r;
                    float ao = ssaoEnabled ? texture2D(tSSAO, vUv).r : 1.0;
                    vec3 bloom = texture2D(tBloom, vUv).rgb;

                    vec3 baseColor = diffuse.rgb * ao;

                    if (depth >= 1.0) {
                        gl_FragColor = vec4(baseColor + bloom * bloomIntensity, 1.0);
                        return;
                    }

                    vec3 viewPos = getViewPosition(vUv, depth);
                    vec3 worldPos = (viewInverse * vec4(viewPos, 1.0)).xyz;
                    vec3 camWorldPos = (viewInverse * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

                    float dist = length(worldPos - camWorldPos);
                    
                    float fogFactor = 1.0 - exp(-dist * fogDensity);
                    fogFactor = clamp(fogFactor, 0.0, 1.0);

                    // Scatter active scene lights inside the fog
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
                    finalColor += scattering + bloom * bloomIntensity;

                    // Vignette shading
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
                
                fogColor: { value: new THREE.Color(this.fogColor) },
                fogDensity: { value: this.fogDensity },
                bloomIntensity: { value: this.bloomIntensity },
                vignetteStrength: { value: this.vignetteStrength },
                ssaoEnabled: { value: true },
                
                projectionInverse: { value: new THREE.Matrix4() },
                viewInverse: { value: new THREE.Matrix4() },

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
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        this.ptAccumTargets = [
            new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType }),
            new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType })
        ];

        this.ptDenoiseTarget = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType });

        // High fidelity Raymarching Path Tracer with refraction (transmission / IOR) support
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
                uniform vec3 spherePBR[10]; // x=roughness, y=metalness, z=clearcoat
                uniform vec4 sphereEmissive[10];
                uniform vec4 sphereGlass[10]; // x=transmission, y=ior, z=iridescence, w=unused

                uniform int numBoxes;
                uniform vec3 boxPos[10];
                uniform vec3 boxSize[10];
                uniform vec3 boxColor[10];
                uniform vec3 boxPBR[10];
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
                        
                        // Fast hash for stars
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
                    vec3 pbr;
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

                    float tGround = -(ro.y + 2.0) / rd.y;
                    if(tGround > 0.0 && tGround < hit.t) {
                        hit.t = tGround;
                        hit.normal = vec3(0.0, 1.0, 0.0);
                        vec3 wPos = ro + tGround * rd;
                        float grid = mod(floor(wPos.x) + floor(wPos.z), 2.0);
                        hit.color = vec3(0.3) + vec3(0.15) * grid;
                        hit.pbr = vec3(0.7, 0.0, 0.0);
                        hit.emissive = vec3(0.0);
                        hit.glass = vec4(0.0, 1.5, 0.0, 0.0);
                    }

                    return hit;
                }

                // Fresnel Schlick approximation
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

                        float rnd = hash(seed); seed.x += 0.17;
                        
                        if (transmission > 0.0 && rnd < transmission) {
                            // Glass Refraction
                            float cosTheta = dot(-rd, hit.normal);
                            float eta = cosTheta > 0.0 ? 1.0 / ior : ior; // Entering or leaving glass
                            vec3 norm = cosTheta > 0.0 ? hit.normal : -hit.normal;
                            
                            float fresnel = fresnelSchlick(abs(cosTheta), ior);
                            float bounceSelect = hash(seed + 0.4);
                            
                            if (bounceSelect < fresnel) {
                                // Reflective bounce on glass surface
                                rd = reflect(rd, norm);
                            } else {
                                // Refractive bounce through glass
                                rd = refract(rd, norm, eta);
                                if (length(rd) < 0.1) {
                                    rd = reflect(rd, norm); // Total Internal Reflection
                                }
                            }
                            
                            // Rough glass distortion
                            rd = normalize(mix(rd, norm + randomSphereDirection(seed), roughness * 0.3));
                            ro = ro + hit.t * rd + rd * 0.002; // offset ray through boundary
                        } else {
                            // Standard PBR bounce (Metalness / Roughness / Diffuse)
                            ro = ro + hit.t * rd + hit.normal * 0.001;
                            
                            vec3 diffuseDir = normalize(hit.normal + randomSphereDirection(seed));
                            vec3 specularDir = reflect(rd, hit.normal);
                            specularDir = normalize(mix(specularDir, diffuseDir, roughness));
                            
                            float specularChance = mix(0.04, 0.95, metalness);
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

        // Joint Bilateral denoiser shader (Guided by Depth to keep crisp geometric silhouettes)
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
                            
                            // NaN / Infinity check for neighbor color (NaN != NaN is true)
                            if (neighborColor.r != neighborColor.r || neighborColor.g != neighborColor.g || neighborColor.b != neighborColor.b ||
                                neighborDepth != neighborDepth) {
                                continue;
                            }
                            
                            // Spatial Gaussian weight
                            float dSpatial = dot(offset * resolution, offset * resolution);
                            float wSpatial = exp(clamp(-dSpatial / 12.0, -30.0, 0.0));
                            
                            // Range Color difference weight
                            float dRangeColor = dot(neighborColor.rgb - centerColor.rgb, neighborColor.rgb - centerColor.rgb);
                            float wRangeColor = exp(clamp(-dRangeColor / 0.15, -30.0, 0.0));
                            
                            // Depth boundary weight (extremely high at geometry edges to prevent blurring outlines)
                            float dDepth = abs(neighborDepth - centerDepth) * 2000.0;
                            float wDepth = exp(clamp(-dDepth * dDepth, -30.0, 0.0));
                            
                            float w = wSpatial * wRangeColor * wDepth;
                            colorSum += neighborColor * w;
                            weightSum += w;
                        }
                    }

                    // NaN guard for output
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

    setupDefaultScene() {
        const floorGeo = new THREE.PlaneGeometry(100, 100);
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.8, metalness: 0.1 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -2;
        floor.receiveShadow = true;
        this.scene.add(floor);
        this.registerActor(floor, "Floor Grid", "mesh");

        const dirLight = new THREE.DirectionalLight(0xfff7e6, 2.5);
        dirLight.position.set(15, 22, 10);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.bias = -0.0004;
        dirLight.shadow.radius = 4.0;
        this.scene.add(dirLight);
        this.registerActor(dirLight, "Main Sun Light", "dir-light");

        // Primary Glass sphere demonstrating high-quality refraction
        const glassSphereGeo = new THREE.SphereGeometry(1.5, 32, 32);
        const glassSphereMat = new THREE.MeshPhysicalMaterial({ 
            color: 0xffffff, 
            roughness: 0.05, 
            metalness: 0.0,
            transmission: 1.0, 
            ior: 1.5,
            thickness: 1.0
        });
        const glass = new THREE.Mesh(glassSphereGeo, glassSphereMat);
        glass.position.set(-3, 0.5, -2);
        glass.castShadow = true;
        this.scene.add(glass);
        this.registerActor(glass, "Refractive Glass Sphere", "mesh");

        const goldBoxGeo = new THREE.BoxGeometry(2, 2, 2);
        const goldBoxMat = new THREE.MeshPhysicalMaterial({ 
            color: 0xd4af37, 
            roughness: 0.15, 
            metalness: 0.95,
            clearcoat: 1.0 
        });
        const goldBox = new THREE.Mesh(goldBoxGeo, goldBoxMat);
        goldBox.position.set(2, 0, 1);
        goldBox.castShadow = true;
        this.scene.add(goldBox);
        this.registerActor(goldBox, "Gold Cube", "mesh");

        const pLight = new THREE.PointLight(0x06b6d4, 5, 20);
        pLight.position.set(3, 4, -2);
        pLight.castShadow = true;
        this.scene.add(pLight);
        this.registerActor(pLight, "Neon Point Light", "point-light");

        this.updateSunPosition();
        if(this.onSelectionChanged) this.onSelectionChanged();
        this.saveUndoState();
    }

    updateSunPosition() {
        const sun = this.actors.find(a => a.type === 'dir-light');
        if (sun) {
            const rad = THREE.MathUtils.degToRad(this.sunPitch);
            sun.object.position.set(20 * Math.cos(rad), 20 * Math.sin(rad), 10);
            this.skyMaterial.uniforms.sunDirection.value.copy(sun.object.position).normalize();
            
            // Adjust scene background based on sun elevation
            if (this.sunPitch < 0) {
                this.fogColor = '#06070a';
            } else if (this.sunPitch < 15) {
                this.fogColor = '#1f1324'; // sunset tint
            } else {
                this.fogColor = '#101216'; // standard fog
            }
            const fogColorInput = document.getElementById('env-fog-color');
            if (fogColorInput) {
                fogColorInput.value = this.fogColor;
            }
            this.updateEnvironment();
            this.updateEnvironmentMap();
        }
    }

    updateEnvironmentMap() {
        if (!this.cubeCamera) return;

        // Hide meshes that are too close to the origin (like the main chrome sphere) to prevent self-occlusion
        // and hide transform controls/helpers so they aren't visible in reflections.
        const originalVisibilities = [];
        this.scene.children.forEach(child => {
            if (child.isMesh && child !== this.skyDome) {
                // If it is closer than 3.0 units to the origin, hide it
                const dist = child.position.distanceTo(new THREE.Vector3(0, 0, 0));
                if (dist < 3.0) {
                    originalVisibilities.push({ obj: child, visible: child.visible });
                    child.visible = false;
                }
            }
        });

        if (this.transformControls) {
            originalVisibilities.push({ obj: this.transformControls, visible: this.transformControls.visible });
            this.transformControls.visible = false;
        }

        // Render reflection texture map from centered CubeCamera
        this.cubeCamera.update(this.renderer, this.scene);

        // Restore visibilities
        originalVisibilities.forEach(ov => {
            ov.obj.visible = ov.visible;
        });

        // Set environment map to enable PBR glossy/metallic reflections
        this.scene.environment = this.cubeRenderTarget.texture;
    }

    registerActor(object, name, type) {
        const actor = {
            id: object.uuid,
            name: name,
            type: type,
            object: object
        };
        this.actors.push(actor);
        return actor;
    }

    addActor(type) {
        let obj, name;
        if (type === 'cube') {
            obj = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, roughness: 0.5, metalness: 0.0 }));
            name = "Cube Mesh";
        } else if (type === 'sphere') {
            obj = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 32), new THREE.MeshPhysicalMaterial({ color: 0xfacc15, roughness: 0.5, metalness: 0.0 }));
            name = "Sphere Mesh";
        } else if (type === 'cylinder') {
            obj = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2, 32), new THREE.MeshPhysicalMaterial({ color: 0xa855f7, roughness: 0.5, metalness: 0.0 }));
            name = "Cylinder Mesh";
        } else if (type === 'plane') {
            obj = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshPhysicalMaterial({ color: 0x64748b, roughness: 0.8, metalness: 0.1 }));
            obj.rotation.x = -Math.PI / 2;
            name = "Plane Mesh";
        } else if (type === 'dir-light') {
            obj = new THREE.DirectionalLight(0xffffff, 1.5);
            obj.position.set(5, 10, 5);
            name = "Directional Light";
        } else if (type === 'point-light') {
            obj = new THREE.PointLight(0xffaa44, 2, 20);
            obj.position.set(0, 4, 0);
            name = "Point Light";
        } else if (type === 'spot-light') {
            obj = new THREE.SpotLight(0xffffff, 5, 30, Math.PI / 6, 0.5, 1);
            obj.position.set(0, 6, 0);
            name = "Spot Light";
        }

        if (obj) {
            obj.castShadow = true;
            if (obj.shadow) {
                obj.shadow.radius = 4.0;
                obj.shadow.blurRadius = 4.0;
            }
            this.scene.add(obj);
            const actor = this.registerActor(obj, name, type.includes('light') ? 'light' : 'mesh');
            this.selectActor(actor);
            this.updateEnvironmentMap();
            this.resetPathTracing();
            if(this.onSelectionChanged) this.onSelectionChanged();
            this.saveUndoState();
        }
    }

    importGLB(file) {
        const reader = new FileReader();
        reader.readAsArrayBuffer(file);
        reader.onload = (event) => {
            const contents = event.target.result;
            const loader = new GLTFLoader();
            loader.parse(contents, '', (gltf) => {
                const model = gltf.scene;
                
                // Enable shadows on all child meshes
                model.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });

                this.scene.add(model);
                
                // Register as actor
                const actorName = file.name.replace(/\.[^/.]+$/, "");
                const actor = this.registerActor(model, actorName, "mesh");
                
                // Set up animations if any exist
                if (gltf.animations && gltf.animations.length > 0) {
                    const mixer = new THREE.AnimationMixer(model);
                    gltf.animations.forEach(clip => {
                        mixer.clipAction(clip).play();
                    });
                    this.mixers.push(mixer);
                    actor.mixer = mixer; // bind mixer to actor for cleanup
                }

                // Select the imported actor automatically
                this.selectActor(actor);
                this.updateEnvironmentMap();
                this.resetPathTracing();
                
                if(this.onSelectionChanged) this.onSelectionChanged();
            }, (error) => {
                console.error("GLB Load Error: ", error);
                alert("Error loading GLB file!");
            });
        };
    }

    spawnGLB(contents, fileName, positionVec, rotationVec, scaleVec, customName) {
        console.log(`[spawnGLB] Starting to parse GLB: ${fileName}`);
        const loader = new GLTFLoader();
        loader.parse(contents.slice(0), '', (gltf) => {
            const model = gltf.scene;
            console.log(`[spawnGLB] GLB parsed successfully: ${fileName}`);
            
            // Set identification tags for serialization
            model.userData.isGLB = true;
            model.userData.assetName = fileName;

            let meshCount = 0;
            model.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    meshCount++;
                }
            });
            console.log(`[spawnGLB] Traversed model. Found ${meshCount} meshes.`);

            if (positionVec) {
                model.position.copy(positionVec);
                console.log(`[spawnGLB] Set position:`, model.position);
            }
            if (rotationVec) {
                model.rotation.set(rotationVec.x, rotationVec.y, rotationVec.z);
                console.log(`[spawnGLB] Set rotation:`, model.rotation);
            }
            if (scaleVec) {
                model.scale.copy(scaleVec);
                console.log(`[spawnGLB] Set scale:`, model.scale);
            } else {
                console.log(`[spawnGLB] No scaleVec provided, default scale:`, model.scale);
            }

            this.scene.add(model);
            console.log(`[spawnGLB] Added model to scene. UUID: ${model.uuid}`);

            const actorName = customName || fileName.replace(/\.[^/.]+$/, "");
            const actor = this.registerActor(model, actorName, "mesh");
            console.log(`[spawnGLB] Registered actor: ${actor.name}`);

            if (gltf.animations && gltf.animations.length > 0) {
                const mixer = new THREE.AnimationMixer(model);
                gltf.animations.forEach(clip => {
                    mixer.clipAction(clip).play();
                });
                this.mixers.push(mixer);
                actor.mixer = mixer;
                console.log(`[spawnGLB] Set up animations.`);
            }

            this.selectActor(actor);
            this.updateEnvironmentMap();
            this.resetPathTracing();
            if (this.onSelectionChanged) this.onSelectionChanged();
            this.saveUndoState();
        }, (error) => {
            console.error("GLB Spawn Error: ", error);
            alert("Error spawning GLB!");
        });
    }

    spawnAssetAtViewportCoords(fileName, buffer, clientX, clientY) {
        const bounds = this.renderer.domElement.getBoundingClientRect();
        const mouseX = ((clientX - bounds.left) / bounds.width) * 2 - 1;
        const mouseY = -((clientY - bounds.top) / bounds.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), this.camera);

        const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 2);
        const targetPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(floorPlane, targetPoint);

        this.spawnGLB(buffer, fileName, targetPoint);
    }

    loadHDR(file) {
        const url = URL.createObjectURL(file);
        const loader = new RGBELoader();
        loader.load(url, (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;

            // Dispose existing background and environment if they were textures
            if (this.scene.background && this.scene.background.dispose && !(this.scene.background instanceof THREE.Color)) {
                this.scene.background.dispose();
            }
            if (this.scene.environment && this.scene.environment.dispose) {
                this.scene.environment.dispose();
            }

            // Generate high dynamic range reflection maps via PMREMGenerator
            const pmrem = new THREE.PMREMGenerator(this.renderer);
            const envMap = pmrem.fromEquirectangular(texture).texture;

            // Remove procedural skyDome temporarily if user loads custom HDR
            if (this.skyDome) {
                this.skyDome.visible = false;
            }

            // In Three.js, scene.background should be the Equirectangular texture to support rotation, 
            // and scene.environment should be the pre-filtered PMREM map.
            this.scene.background = texture;
            this.scene.environment = envMap;

            pmrem.dispose();
            // Note: We do not dispose 'texture' because it's now used as scene.background
            URL.revokeObjectURL(url);

            this.updateEnvironment(); // Trigger rotation & intensity application immediately
            this.resetPathTracing();
            alert("Custom HDR Map Applied Successfully!");
        }, undefined, (err) => {
            console.error("HDR Loading Error: ", err);
            alert("Error loading HDR file!");
            URL.revokeObjectURL(url);
        });
    }
    exportSceneJSON() {
        const sceneData = {
            environment: {
                sunPitch: this.sunPitch,
                fogDensity: this.fogDensity,
                fogColor: this.fogColor,
                ambientIntensity: this.ambientIntensity,
                bloomIntensity: this.bloomIntensity,
                ssaoEnabled: this.ssaoEnabled,
                ssaoRadius: this.ssaoRadius,
                ssaoIntensity: this.ssaoIntensity,
                vignetteStrength: this.vignetteStrength,
                hdrIntensity: this.hdrIntensity,
                hdrRotation: this.hdrRotation
            },
            actors: []
        };

        this.actors.forEach(actor => {
            if (actor.name === "Floor Grid") return; // Keep default floor grid

            const obj = actor.object;
            const actorData = {
                id: actor.id,
                name: actor.name,
                type: actor.type,
                position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
                scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z }
            };

            if (actor.type === 'mesh') {
                let geomType = 'cube';
                if (obj.userData && (obj.userData.isGLB || obj.userData.isPlaceholder)) {
                    geomType = 'glb';
                    actorData.assetName = obj.userData.assetName;
                    if (obj.userData.originalScale) {
                        actorData.scale = obj.userData.originalScale;
                    }
                } else if (obj.geometry) {
                    if (obj.geometry.type === 'BoxGeometry') geomType = 'cube';
                    else if (obj.geometry.type === 'SphereGeometry') geomType = 'sphere';
                    else if (obj.geometry.type === 'CylinderGeometry') geomType = 'cylinder';
                    else if (obj.geometry.type === 'PlaneGeometry') geomType = 'plane';
                }
                actorData.geomType = geomType;

                if (obj.material) {
                    const mat = obj.material;
                    actorData.material = {
                        color: '#' + mat.color.getHexString(),
                        roughness: mat.roughness,
                        metalness: mat.metalness,
                        emissive: '#' + mat.emissive.getHexString(),
                        emissiveIntensity: mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 0,
                        clearcoat: mat.clearcoat !== undefined ? mat.clearcoat : 0,
                        transmission: mat.transmission !== undefined ? mat.transmission : 0,
                        ior: mat.ior !== undefined ? mat.ior : 1.5,
                        iridescence: mat.iridescence !== undefined ? mat.iridescence : 0
                    };
                }
            } else if (actor.type.includes('light')) {
                let subType = 'point';
                if (obj.isDirectionalLight) subType = 'dir';
                else if (obj.isSpotLight) subType = 'spot';

                actorData.subType = subType;
                actorData.light = {
                    color: '#' + obj.color.getHexString(),
                    intensity: obj.intensity,
                    distance: obj.distance,
                    castShadow: obj.castShadow,
                    shadowRadius: obj.shadow ? obj.shadow.radius : 4.0
                };
            }

            sceneData.actors.push(actorData);
        });

        return JSON.stringify(sceneData, null, 4);
    }

    importSceneJSON(jsonString) {
        console.log("=== IMPORT SCENE JSON STARTED ===");
        try {
            const data = JSON.parse(jsonString);
            console.log("Parsed JSON Data successfully. Environment:", data.environment, "Actors count:", data.actors ? data.actors.length : 0);

            // Clear current custom actors
            this.transformControls.detach();
            console.log("Removing current actors from scene. Current actors list:", this.actors.map(a => a.name));
            this.actors.filter(a => a.name !== "Floor Grid").forEach(a => {
                const inScene = this.scene.children.includes(a.object);
                console.log(`Removing actor: ${a.name}. Is in scene.children: ${inScene}. UUID: ${a.object ? a.object.uuid : 'null'}`);
                this.scene.remove(a.object);
                console.log("Removed actor object from scene:", a.name);
            });
            this.actors = this.actors.filter(a => a.name === "Floor Grid");

            // Apply environment
            const env = data.environment || {};
            this.sunPitch = env.sunPitch !== undefined ? env.sunPitch : 30;
            this.fogDensity = env.fogDensity !== undefined ? env.fogDensity : 0.015;
            this.fogColor = env.fogColor || '#101216';
            this.ambientIntensity = env.ambientIntensity !== undefined ? env.ambientIntensity : 0.2;
            this.bloomIntensity = env.bloomIntensity !== undefined ? env.bloomIntensity : 1.5;
            this.ssaoEnabled = env.ssaoEnabled !== undefined ? env.ssaoEnabled : true;
            this.ssaoRadius = env.ssaoRadius !== undefined ? env.ssaoRadius : 0.006;
            this.ssaoIntensity = env.ssaoIntensity !== undefined ? env.ssaoIntensity : 1.0;
            this.vignetteStrength = env.vignetteStrength !== undefined ? env.vignetteStrength : 1.0;
            this.hdrIntensity = env.hdrIntensity !== undefined ? env.hdrIntensity : 1.0;
            this.hdrRotation = env.hdrRotation !== undefined ? env.hdrRotation : 0;

            // Reset procedural skyDome visibility and background mapping
            if (this.skyDome) {
                this.skyDome.visible = true;
            }
            this.scene.background = new THREE.Color(this.fogColor);
            this.scene.environment = null; // Clear previous PMREM reflection cache

            this.updateSunPosition();
            this.updateEnvironment();

            // Reconstruct actors
            const actorsToLoad = data.actors || [];
            actorsToLoad.forEach(act => {
                let obj = null;

                if (act.type === 'mesh') {
                    let geo;
                    if (act.geomType === 'glb') {
                        let buffer = null;
                        let resolvedAssetName = act.assetName;
                        if (window.assetLibrary && act.assetName) {
                            const target = act.assetName.replace(/\.[^/.]+$/, "").toLowerCase().trim();
                            for (let key in window.assetLibrary) {
                                if (key.replace(/\.[^/.]+$/, "").toLowerCase().trim() === target) {
                                    buffer = window.assetLibrary[key];
                                    resolvedAssetName = key;
                                    break;
                                }
                            }
                        }
                        if (buffer) {
                            const pos = new THREE.Vector3(act.position.x, act.position.y, act.position.z);
                            const rot = new THREE.Euler(act.rotation.x, act.rotation.y, act.rotation.z);
                            const scl = new THREE.Vector3(act.scale.x, act.scale.y, act.scale.z);
                            this.spawnGLB(buffer, resolvedAssetName, pos, rot, scl, act.name);
                            return; // spawnGLB will register it asynchronously
                        } else {
                            // Spawn placeholder translucent box
                            geo = new THREE.BoxGeometry(2, 2, 2);
                            const mat = new THREE.MeshBasicMaterial({
                                color: 0xa855f7,
                                wireframe: false,
                                transparent: true,
                                opacity: 0.5
                            });
                            obj = new THREE.Mesh(geo, mat);
                            obj.userData.isPlaceholder = true;
                            obj.userData.assetName = act.assetName;
                            obj.userData.originalScale = act.scale ? { x: act.scale.x, y: act.scale.y, z: act.scale.z } : { x: 1, y: 1, z: 1 };
                        }
                    } else {
                        if (act.geomType === 'sphere') geo = new THREE.SphereGeometry(1, 32, 32);
                        else if (act.geomType === 'cylinder') geo = new THREE.CylinderGeometry(1, 1, 2, 32);
                        else if (act.geomType === 'plane') geo = new THREE.PlaneGeometry(5, 5);
                        else geo = new THREE.BoxGeometry(2, 2, 2);
                    }

                    if (act.geomType !== 'glb') {
                        const mat = new THREE.MeshPhysicalMaterial();
                        if (act.material) {
                            const m = act.material;
                            if (m.color !== undefined) mat.color.set(m.color);
                            if (m.roughness !== undefined) mat.roughness = m.roughness;
                            if (m.metalness !== undefined) mat.metalness = m.metalness;
                            if (m.emissive !== undefined) mat.emissive.set(m.emissive);
                            if (m.emissiveIntensity !== undefined) mat.emissiveIntensity = m.emissiveIntensity;
                            if (m.clearcoat !== undefined) mat.clearcoat = m.clearcoat;
                            if (m.transmission !== undefined) mat.transmission = m.transmission;
                            if (m.ior !== undefined) mat.ior = m.ior;
                            if (m.iridescence !== undefined) mat.iridescence = m.iridescence;
                        }

                        obj = new THREE.Mesh(geo, mat);
                        obj.castShadow = true;
                        obj.receiveShadow = true;
                    }

                } else if (act.type.includes('light')) {
                    const l = act.light || {};
                    const col = new THREE.Color(l.color || '#ffffff');
                    
                    const subType = act.subType || (act.type === 'dir-light' ? 'dir' : (act.type === 'spot-light' ? 'spot' : 'point'));

                    if (subType === 'dir') {
                        obj = new THREE.DirectionalLight(col, l.intensity);
                        obj.shadow.mapSize.width = 2048;
                        obj.shadow.mapSize.height = 2048;
                        obj.shadow.bias = -0.0004;
                    } else if (subType === 'point') {
                        obj = new THREE.PointLight(col, l.intensity, l.distance);
                    } else if (subType === 'spot') {
                        obj = new THREE.SpotLight(col, l.intensity, l.distance || 30, Math.PI / 6, 0.5, 1);
                    }

                    if (obj) {
                        obj.castShadow = l.castShadow;
                        if (obj.shadow) {
                            obj.shadow.radius = l.shadowRadius !== undefined ? l.shadowRadius : 4.0;
                            obj.shadow.blurRadius = obj.shadow.radius;
                        }
                    }
                }

                if (obj) {
                    if (act.position !== undefined) obj.position.set(act.position.x, act.position.y, act.position.z);
                    if (act.rotation !== undefined) obj.rotation.set(act.rotation.x, act.rotation.y, act.rotation.z);
                    
                    if (act.scale !== undefined && !obj.userData.isPlaceholder) {
                        obj.scale.set(act.scale.x, act.scale.y, act.scale.z);
                    } else {
                        obj.scale.set(1, 1, 1);
                    }

                    this.scene.add(obj);
                    this.registerActor(obj, act.name, act.type);
                }
            });

            this.updateEnvironmentMap();
            this.resetPathTracing();
            if (this.onSelectionChanged) this.onSelectionChanged();
            console.log("Scene JSON imported successfully! Active actors in outliner:", this.actors.map(a => a.name));
            console.log("Active children in THREE.Scene:", this.scene.children.map(c => c.name || (c.type + " [" + c.uuid + "]")));
            console.log("=== IMPORT SCENE JSON COMPLETED ===");
            
            // Sync environment sliders back to UI
            const pitchInput = document.getElementById('env-sun-pitch');
            if (pitchInput) {
                pitchInput.value = this.sunPitch;
                document.getElementById('val-sun-pitch').textContent = `${this.sunPitch}°`;
            }
            const fogInput = document.getElementById('env-fog-density');
            if (fogInput) {
                fogInput.value = this.fogDensity;
                document.getElementById('val-fog-density').textContent = this.fogDensity.toFixed(3);
            }
            const ambInput = document.getElementById('env-ambient-intensity');
            if (ambInput) {
                ambInput.value = this.ambientIntensity;
                document.getElementById('val-ambient-intensity').textContent = this.ambientIntensity.toFixed(2);
            }
            const bloomInput = document.getElementById('env-bloom-intensity');
            if (bloomInput) {
                bloomInput.value = this.bloomIntensity;
                document.getElementById('val-bloom-intensity').textContent = this.bloomIntensity.toFixed(1);
            }
            const ssaoEnabledInput = document.getElementById('env-ssao-enabled');
            if (ssaoEnabledInput) {
                ssaoEnabledInput.checked = this.ssaoEnabled;
            }
            const ssaoRadiusInput = document.getElementById('env-ssao-radius');
            if (ssaoRadiusInput) {
                ssaoRadiusInput.value = this.ssaoRadius;
                document.getElementById('val-ssao-radius').textContent = this.ssaoRadius.toFixed(3);
            }
            const ssaoIntensityInput = document.getElementById('env-ssao-intensity');
            if (ssaoIntensityInput) {
                ssaoIntensityInput.value = this.ssaoIntensity;
                document.getElementById('val-ssao-intensity').textContent = this.ssaoIntensity.toFixed(1);
            }
            const vignetteInput = document.getElementById('env-vignette');
            if (vignetteInput) {
                vignetteInput.value = this.vignetteStrength;
                document.getElementById('val-vignette').textContent = this.vignetteStrength.toFixed(1);
            }
            const hdrIntensityInput = document.getElementById('env-hdr-intensity');
            if (hdrIntensityInput) {
                hdrIntensityInput.value = this.hdrIntensity;
                document.getElementById('val-hdr-intensity').textContent = this.hdrIntensity.toFixed(2);
            }
            const hdrRotationInput = document.getElementById('env-hdr-rotation');
            if (hdrRotationInput) {
                hdrRotationInput.value = this.hdrRotation;
                document.getElementById('val-hdr-rotation').textContent = `${this.hdrRotation}°`;
            }
        } catch (e) {
            console.error("Failed to load scene JSON", e);
            alert("Error parsing level JSON!");
        }
    }

    saveUndoState() {
        const state = this.exportSceneJSON();
        // Prevent duplicate consecutive states
        if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === state) {
            return;
        }
        this.undoStack.push(state);
        if (this.undoStack.length > 50) { // Limit stack size
            this.undoStack.shift();
        }
        console.log(`[UndoSystem] State saved. History size: ${this.undoStack.length}`);
    }

    undo() {
        if (this.undoStack.length <= 1) {
            console.log("[UndoSystem] No more states to undo.");
            return;
        }
        // Pop the current state
        this.undoStack.pop();
        // Get the previous state
        const prevState = this.undoStack[this.undoStack.length - 1];
        console.log(`[UndoSystem] Performing Undo. Remaining history: ${this.undoStack.length}`);
        
        // Import the state
        this.importSceneJSON(prevState);
    }

    focusActor(actor) {
        if (!actor) return;
        const obj = actor.object;

        // Calculate bounding box and center of the actor
        const box = new THREE.Box3().setFromObject(obj);
        const center = new THREE.Vector3();
        box.getCenter(center);

        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        
        // Calculate appropriate focal distance based on mesh size
        const distance = Math.max(maxDim * 2.2, 4.0);

        // Get camera view vector to target pos
        const dir = new THREE.Vector3().subVectors(this.camera.position, center).normalize();
        if (dir.lengthSq() === 0) {
            dir.set(0, 1, 2).normalize(); // Fallback vector
        }

        // Snap camera position to the targeted offset
        this.camera.position.copy(center).addScaledVector(dir, distance);
        this.orbitControls.target.copy(center);
        this.orbitControls.update();
        
        this.resetPathTracing();
    }

    deleteActor(actor) {
        if (!actor) return;
        if (actor.name === "Floor Grid") return;

        this.transformControls.detach();
        this.scene.remove(actor.object);
        
        // Clean up associated animation mixers
        if (actor.mixer) {
            const idx = this.mixers.indexOf(actor.mixer);
            if (idx > -1) this.mixers.splice(idx, 1);
        }

        // Remove associated keyframes
        this.keyframes = this.keyframes.filter(k => k.actorId !== actor.id);
        
        this.actors = this.actors.filter(a => a.id !== actor.id);
        this.selectedActor = null;
        this.updateEnvironmentMap();
        this.resetPathTracing();
        if(this.onSelectionChanged) this.onSelectionChanged();
        this.saveUndoState();
    }

    selectActor(actor) {
        this.selectedActor = actor;
        if (actor) {
            if (this.gizmoCentered) {
                const dir = new THREE.Vector3();
                this.camera.getWorldDirection(dir);
                this.gizmoPivot.position.copy(this.camera.position).addScaledVector(dir, 8);
                this.gizmoPivot.rotation.copy(actor.object.rotation);
                this.gizmoPivot.scale.copy(actor.object.scale);
                this.transformControls.attach(this.gizmoPivot);
            } else {
                this.transformControls.attach(actor.object);
            }
        } else {
            this.transformControls.detach();
        }
        if(this.onSelectionChanged) this.onSelectionChanged();
    }

    toggleSnapping(type) {
        if (type === 'grid') {
            this.gridSnap = !this.gridSnap;
            this.transformControls.setTranslationSnap(this.gridSnap ? 1.0 : null);
        } else if (type === 'angle') {
            this.angleSnap = !this.angleSnap;
            this.transformControls.setRotationSnap(this.angleSnap ? THREE.MathUtils.degToRad(15) : null);
        } else if (type === 'scale') {
            this.scaleSnap = !this.scaleSnap;
            this.transformControls.setScaleSnap(this.scaleSnap ? 0.25 : null);
        }
    }

    toggleGizmoCenter() {
        this.gizmoCentered = !this.gizmoCentered;
        this.transformControls.detach();
        if (this.selectedActor) {
            if (this.gizmoCentered) {
                const dir = new THREE.Vector3();
                this.camera.getWorldDirection(dir);
                this.gizmoPivot.position.copy(this.camera.position).addScaledVector(dir, 8);
                this.gizmoPivot.rotation.copy(this.selectedActor.object.rotation);
                this.gizmoPivot.scale.copy(this.selectedActor.object.scale);
                this.transformControls.attach(this.gizmoPivot);
            } else {
                this.transformControls.attach(this.selectedActor.object);
            }
        }
    }

    applyMaterialPreset(preset) {
        if (!this.selectedActor || this.selectedActor.type !== 'mesh') return;
        const mat = this.selectedActor.object.material;
        
        if (preset === 'glass') {
            mat.color.set(0xffffff);
            mat.roughness = 0.02;
            mat.metalness = 0.0;
            mat.transmission = 1.0;
            mat.ior = 1.5;
            mat.thickness = 1.0;
            mat.iridescence = 0.0;
        } else if (preset === 'gold') {
            mat.color.set(0xd4af37);
            mat.roughness = 0.15;
            mat.metalness = 0.95;
            mat.transmission = 0.0;
            mat.clearcoat = 1.0;
            mat.iridescence = 0.0;
        } else if (preset === 'hologram') {
            mat.color.set(0x06b6d4);
            mat.roughness = 0.1;
            mat.metalness = 0.1;
            mat.emissive.set(0x06b6d4);
            mat.emissiveIntensity = 4.0;
            mat.transmission = 0.0;
            mat.iridescence = 0.8;
        } else if (preset === 'ruby') {
            mat.color.set(0xb91c1c);
            mat.roughness = 0.05;
            mat.metalness = 0.0;
            mat.transmission = 0.9;
            mat.ior = 1.77;
            mat.thickness = 1.2;
            mat.iridescence = 0.2;
        }

        mat.needsUpdate = true;
        this.resetPathTracing();
        if(this.onSelectionChanged) this.onSelectionChanged();
    }

    onViewportClick(event) {
        if (this.transformControls.dragging) return;

        const bounds = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        this.mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Match both meshes and groups (GLB) to be raycasted recursively
        const meshes = this.actors
            .filter(a => a.type === 'mesh' && a.name !== "Floor Grid")
            .map(a => a.object);
            
        const intersects = this.raycaster.intersectObjects(meshes, true);

        if (intersects.length > 0) {
            let hitObj = intersects[0].object;
            let actor = null;
            
            // Traverse parent hierarchy to find matching root actor (important for GLB groups)
            while (hitObj) {
                actor = this.actors.find(a => a.object === hitObj);
                if (actor) break;
                hitObj = hitObj.parent;
            }
            
            if (actor) {
                this.selectActor(actor);
            } else {
                this.selectActor(null);
            }
        } else {
            this.selectActor(null);
        }
    }

    updateEnvironment() {
        if (this.scene.background instanceof THREE.Color) {
            this.scene.background.set(this.fogColor);
        } else if (!this.scene.background) {
            this.scene.background = new THREE.Color(this.fogColor);
        }

        // Apply custom HDR intensity and rotation if present (with safe guards for older Three.js versions)
        if (this.scene.background && !(this.scene.background instanceof THREE.Color)) {
            this.scene.backgroundIntensity = this.hdrIntensity;
            if (this.scene.backgroundRotation) {
                this.scene.backgroundRotation.y = this.hdrRotation * (Math.PI / 180);
            } else if (this.scene.background.offset) {
                this.scene.background.offset.x = this.hdrRotation / 360;
            }
        }
        if (this.scene.environment) {
            this.scene.environmentIntensity = this.hdrIntensity;
            if (this.scene.environmentRotation) {
                this.scene.environmentRotation.y = this.hdrRotation * (Math.PI / 180);
            }
        }
        
        this.ambientLight.intensity = this.ambientIntensity;
        this.compositeMaterial.uniforms.fogColor.value.set(this.fogColor);
        this.compositeMaterial.uniforms.fogDensity.value = this.fogDensity;
        this.compositeMaterial.uniforms.bloomIntensity.value = this.bloomIntensity;
        this.compositeMaterial.uniforms.vignetteStrength.value = this.vignetteStrength;
        this.compositeMaterial.uniforms.ssaoEnabled.value = this.ssaoEnabled;
        this.ssaoMaterial.uniforms.intensity.value = this.ssaoIntensity;
        this.ssaoMaterial.uniforms.ssaoRadius.value = this.ssaoRadius;
        this.resetPathTracing();
    }

    syncActorTransformToUI(actor) {
        const pos = actor.object.position;
        const rot = actor.object.rotation;
        const scale = actor.object.scale;

        document.getElementById('pos-x').value = pos.x.toFixed(1);
        document.getElementById('pos-y').value = pos.y.toFixed(1);
        document.getElementById('pos-z').value = pos.z.toFixed(1);

        document.getElementById('rot-x').value = Math.round(rot.x * (180/Math.PI));
        document.getElementById('rot-y').value = Math.round(rot.y * (180/Math.PI));
        document.getElementById('rot-z').value = Math.round(rot.z * (180/Math.PI));

        document.getElementById('scale-x').value = scale.x.toFixed(1);
        document.getElementById('scale-y').value = scale.y.toFixed(1);
        document.getElementById('scale-z').value = scale.z.toFixed(1);
    }

    resetPathTracing() {
        this.ptSamples = 0;
        if(this.onUpdatePT) this.onUpdatePT(this.ptSamples, this.renderMode);
    }

    setPreset(presetName) {
        this.actors.filter(a => a.name !== "Floor Grid").forEach(a => this.scene.remove(a.object));
        this.actors = this.actors.filter(a => a.name === "Floor Grid");
        this.selectActor(null);

        // Reset procedural skyDome visibility and clean up custom HDR mapping
        if (this.skyDome) {
            this.skyDome.visible = true;
        }
        if (this.scene.background && this.scene.background.dispose && !(this.scene.background instanceof THREE.Color)) {
            this.scene.background.dispose();
        }
        if (this.scene.environment && this.scene.environment.dispose) {
            this.scene.environment.dispose();
        }
        this.scene.background = new THREE.Color(this.fogColor);
        this.scene.environment = null;

        if (presetName === 'scifi') {
            this.fogColor = '#0b0c10';
            this.fogDensity = 0.025;
            this.ambientIntensity = 0.05;
            this.bloomIntensity = 2.0;
            this.sunPitch = -20; // sunset/night

            const cube1 = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshPhysicalMaterial({ color: 0xff00ff, emissive: new THREE.Color(0xff00ff), emissiveIntensity: 8.0, roughness: 0.1 }));
            cube1.position.set(-3, 0.5, -2);
            this.scene.add(cube1);
            this.registerActor(cube1, "Neon Violet Cube", "mesh");

            const sphere1 = new THREE.Mesh(new THREE.SphereGeometry(2, 32, 32), new THREE.MeshPhysicalMaterial({ color: 0x00ffff, emissive: new THREE.Color(0x00ffff), emissiveIntensity: 9.0, roughness: 0.05 }));
            sphere1.position.set(3, 0, 1);
            this.scene.add(sphere1);
            this.registerActor(sphere1, "Neon Cyan Sphere", "mesh");

            const pLight = new THREE.PointLight(0xff00ff, 15, 30);
            pLight.position.set(-3, 5, -2);
            this.scene.add(pLight);
            this.registerActor(pLight, "Neon Violet Light", "point-light");

        } else if (presetName === 'outdoor') {
            this.fogColor = '#1f2937';
            this.fogDensity = 0.05;
            this.ambientIntensity = 0.3;
            this.bloomIntensity = 1.0;
            this.sunPitch = 45;

            const dLight = new THREE.DirectionalLight(0xfef08a, 3.0);
            dLight.position.set(10, 20, 10);
            dLight.castShadow = true;
            this.scene.add(dLight);
            this.registerActor(dLight, "Sunlight", "dir-light");

            for(let i = 0; i < 3; i++) {
                const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 6, 16), new THREE.MeshPhysicalMaterial({ color: 0x78350f, roughness: 0.9 }));
                cyl.position.set(-4 + i * 4, 1, -3 + Math.sin(i)*2);
                this.scene.add(cyl);
                this.registerActor(cyl, `Tree Trunk ${i}`, "mesh");
            }
        } else if (presetName === 'studio') {
            this.fogColor = '#121214';
            this.fogDensity = 0.005;
            this.ambientIntensity = 0.1;
            this.bloomIntensity = 1.5;
            this.sunPitch = 30;

            const sphere = new THREE.Mesh(new THREE.SphereGeometry(2.5, 32, 32), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.95, clearcoat: 1.0 }));
            sphere.position.set(0, 0.5, 0);
            this.scene.add(sphere);
            this.registerActor(sphere, "Chrome Studio Sphere", "mesh");

            const sLight1 = new THREE.SpotLight(0xef4444, 25, 40, Math.PI/4, 0.5);
            sLight1.position.set(-8, 8, 8);
            sLight1.castShadow = true;
            this.scene.add(sLight1);
            this.registerActor(sLight1, "Red Studio Light", "spot-light");

            const sLight2 = new THREE.SpotLight(0x3b82f6, 25, 40, Math.PI/4, 0.5);
            sLight2.position.set(8, 8, 8);
            sLight2.castShadow = true;
            this.scene.add(sLight2);
            this.registerActor(sLight2, "Blue Studio Light", "spot-light");
        }

        this.updateSunPosition();
        this.resetPathTracing();
        if(this.onSelectionChanged) this.onSelectionChanged();
    }

    drawCompass() {
        if (!this.compassCtx) return;
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

    updatePathTracerUniforms() {
        const spheres = [];
        const boxes = [];
        let ambientIntensity = this.ambientIntensity;

        this.actors.forEach(actor => {
            const obj = actor.object;
            if (!obj.visible) return;

            if (actor.type === 'mesh' && actor.name !== "Floor Grid") {
                if (!obj.material) return; // Skip complex GLB groups with no root material in the path tracer
                const color = obj.material.color || new THREE.Color(0xffffff);
                const roughness = obj.material.roughness !== undefined ? obj.material.roughness : 0.5;
                const metalness = obj.material.metalness !== undefined ? obj.material.metalness : 0.0;
                const clearcoat = obj.material.clearcoat !== undefined ? obj.material.clearcoat : 0.0;
                const emissive = obj.material.emissive || new THREE.Color(0x000000);
                const emissiveIntensity = obj.material.emissiveIntensity !== undefined ? obj.material.emissiveIntensity : 0.0;
                
                // Advanced physical glass values
                const transmission = obj.material.transmission !== undefined ? obj.material.transmission : 0.0;
                const ior = obj.material.ior !== undefined ? obj.material.ior : 1.5;
                const iridescence = obj.material.iridescence !== undefined ? obj.material.iridescence : 0.0;

                if (obj.geometry.type === 'SphereGeometry') {
                    spheres.push({
                        pos: obj.position.clone(),
                        radius: obj.geometry.parameters.radius * obj.scale.x,
                        color: color.clone(),
                        pbr: new THREE.Vector3(roughness, metalness, clearcoat),
                        emissive: new THREE.Vector4(emissive.r, emissive.g, emissive.b, emissiveIntensity),
                        glass: new THREE.Vector4(transmission, ior, iridescence, 0.0)
                    });
                } else {
                    obj.geometry.computeBoundingBox();
                    const size = new THREE.Vector3();
                    obj.geometry.boundingBox.getSize(size).multiply(obj.scale);
                    
                    boxes.push({
                        pos: obj.position.clone(),
                        size: size,
                        color: color.clone(),
                        pbr: new THREE.Vector3(roughness, metalness, clearcoat),
                        emissive: new THREE.Vector4(emissive.r, emissive.g, emissive.b, emissiveIntensity),
                        glass: new THREE.Vector4(transmission, ior, iridescence, 0.0)
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

        // Pad spheres and boxes arrays to exactly 10 elements to prevent Three.js uniform array upload crashes
        while (spherePosRadius.length < 10) {
            spherePosRadius.push(new THREE.Vector4());
            sphereColor.push(new THREE.Color());
            spherePBR.push(new THREE.Vector3());
            sphereEmissive.push(new THREE.Vector4());
            sphereGlass.push(new THREE.Vector4());
        }
        while (boxPos.length < 10) {
            boxPos.push(new THREE.Vector3());
            boxSize.push(new THREE.Vector3());
            boxColor.push(new THREE.Color());
            boxPBR.push(new THREE.Vector3());
            boxEmissive.push(new THREE.Vector4());
            boxGlass.push(new THREE.Vector4());
        }

        const uniforms = this.ptMaterial.uniforms;
        uniforms.numSpheres.value = spheres.length;
        uniforms.spherePosRadius.value = spherePosRadius;
        uniforms.sphereColor.value = sphereColor;
        uniforms.spherePBR.value = spherePBR;
        uniforms.sphereEmissive.value = sphereEmissive;
        uniforms.sphereGlass.value = sphereGlass;

        uniforms.numBoxes.value = boxes.length;
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

        const sun = this.actors.find(a => a.type === 'dir-light');
        if (sun) {
            uniforms.sunDirection.value.copy(sun.object.position).normalize();
        } else {
            uniforms.sunDirection.value.set(1, 1, 1).normalize();
        }
    }

    renderRealtimePBR() {
        this.renderer.setRenderTarget(this.sceneRenderTarget);
        this.renderer.render(this.scene, this.camera);

        // 1. Render SSAO Pass
        this.postQuad.material = this.ssaoMaterial;
        this.ssaoMaterial.uniforms.tDepth.value = this.sceneRenderTarget.depthTexture;
        
        const size = new THREE.Vector2();
        this.renderer.getSize(size);
        this.ssaoMaterial.uniforms.resolution.value.copy(size);
        this.ssaoMaterial.uniforms.projection.value.copy(this.camera.projectionMatrix);
        this.ssaoMaterial.uniforms.projectionInverse.value.copy(this.camera.projectionMatrixInverse);

        this.renderer.setRenderTarget(this.ssaoRenderTarget);
        this.renderer.render(this.postScene, this.postCamera);

        // 2. Render Bloom Threshold Pass
        this.postQuad.material = this.bloomThresholdMaterial;
        this.bloomThresholdMaterial.uniforms.tDiffuse.value = this.sceneRenderTarget.texture;
        this.renderer.setRenderTarget(this.bloomThresholdTarget);
        this.renderer.render(this.postScene, this.postCamera);

        // 3. Render Bloom Blur Horizontal
        this.postQuad.material = this.blurMaterial;
        this.blurMaterial.uniforms.tInput.value = this.bloomThresholdTarget.texture;
        this.blurMaterial.uniforms.direction.value.set(1, 0);
        this.renderer.setRenderTarget(this.bloomBlurTarget);
        this.renderer.render(this.postScene, this.postCamera);
        
        // 4. Render Bloom Blur Vertical
        this.postQuad.material = this.blurMaterial;
        this.blurMaterial.uniforms.tInput.value = this.bloomBlurTarget.texture;
        this.blurMaterial.uniforms.direction.value.set(0, 1);
        this.renderer.setRenderTarget(this.bloomThresholdTarget); 
        this.renderer.render(this.postScene, this.postCamera);

        // 5. Restore Composite Material and Render to Screen
        this.postQuad.material = this.compositeMaterial;
        this.renderer.setRenderTarget(null);
        
        const uniforms = this.compositeMaterial.uniforms;
        uniforms.tDiffuse.value = this.sceneRenderTarget.texture;
        uniforms.tDepth.value = this.sceneRenderTarget.depthTexture;
        uniforms.tSSAO.value = this.ssaoRenderTarget.texture;
        uniforms.tBloom.value = this.bloomThresholdTarget.texture;
        uniforms.projectionInverse.value.copy(this.camera.projectionMatrixInverse);
        uniforms.viewInverse.value.copy(this.camera.matrixWorld);

        const scatterLights = this.actors.filter(a => a.type === 'light');
        const lightPositions = [];
        const lightColors = [];
        const lightRanges = [];

        scatterLights.forEach(l => {
            const light = l.object;
            lightPositions.push(light.position.clone());
            lightColors.push(light.color.clone().multiplyScalar(light.intensity));
            lightRanges.push(light.distance !== undefined ? light.distance : 40);
        });

        // Pad light arrays to exactly 10 elements to prevent Three.js uniform array upload crashes
        while (lightPositions.length < 10) {
            lightPositions.push(new THREE.Vector3());
            lightColors.push(new THREE.Color());
            lightRanges.push(0.0);
        }

        uniforms.numLights.value = scatterLights.length;
        uniforms.lightPositions.value = lightPositions;
        uniforms.lightColors.value = lightColors;
        uniforms.lightRanges.value = lightRanges;

        this.renderer.render(this.postScene, this.postCamera);
    }

    renderPathTracer() {
        if (this.ptSamples >= this.maxPtSamples) return;

        // Perform depth prepass to get a fresh depth map for guided denoising
        const originalBg = this.scene.background;
        this.scene.background = null; // transparent or clear background for depth capture
        this.renderer.setRenderTarget(this.sceneRenderTarget);
        this.renderer.render(this.scene, this.camera);
        this.scene.background = originalBg; // restore

        this.updatePathTracerUniforms();

        const writeTarget = this.ptAccumTargets[this.ptSamples % 2];
        const readTarget = this.ptAccumTargets[(this.ptSamples + 1) % 2];

        this.ptMaterial.uniforms.accumTexture.value = readTarget.texture;
        
        this.renderer.setRenderTarget(writeTarget);
        this.renderer.render(this.ptScene, this.ptCamera);

        // Apply Guided Joint Bilateral Denoiser
        this.ptRenderQuad.material = this.denoiseMaterial;
        this.denoiseMaterial.uniforms.tInput.value = writeTarget.texture;
        this.denoiseMaterial.uniforms.tDepth.value = this.sceneRenderTarget.depthTexture;
        
        const size = new THREE.Vector2();
        this.renderer.getSize(size);
        this.denoiseMaterial.uniforms.resolution.value.copy(size);
        
        this.renderer.setRenderTarget(this.ptDenoiseTarget);
        this.renderer.render(this.ptScene, this.ptCamera);

        // Restore path tracer material
        this.ptRenderQuad.material = this.ptMaterial;

        this.renderer.setRenderTarget(null);
        this.postQuad.material = new THREE.MeshBasicMaterial({ map: this.ptDenoiseTarget.texture });
        this.renderer.render(this.postScene, this.postCamera);
        
        this.postQuad.material = this.compositeMaterial;

        this.ptSamples++;
        if(this.onUpdatePT) this.onUpdatePT(this.ptSamples, this.renderMode);
    }

    interpolateSequencer() {
        if (this.keyframes.length === 0) return;

        // Group keyframes by actorId
        const tracks = {};
        this.keyframes.forEach(k => {
            if (!tracks[k.actorId]) tracks[k.actorId] = [];
            tracks[k.actorId].push(k);
        });

        Object.keys(tracks).forEach(actorId => {
            const actor = this.actors.find(a => a.id === actorId);
            if (!actor) return;

            const list = tracks[actorId].sort((a, b) => a.time - b.time);
            
            // Find keyframes wrapping current seqTime
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

            // Interpolate position/rotation/scale
            let factor = 0;
            if (nextK.time !== prevK.time) {
                factor = (this.seqTime - prevK.time) / (nextK.time - prevK.time);
            }

            actor.object.position.lerpVectors(prevK.pos, nextK.pos, factor);
            
            // Quaternion interpolation for smooth rotations
            const q1 = new THREE.Quaternion().setFromEuler(prevK.rot);
            const q2 = new THREE.Quaternion().setFromEuler(nextK.rot);
            q1.slerp(q2, factor);
            actor.object.rotation.setFromQuaternion(q1);

            actor.object.scale.lerpVectors(prevK.scl, nextK.scl, factor);
        });

        this.resetPathTracing();
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        try {
            const delta = this.clock.getDelta();
            this.mixers.forEach(mixer => mixer.update(delta));

            this.orbitControls.update();
            this.drawCompass();

            // Increment Sequencer Clock
            if (this.isSeqPlaying) {
                this.seqTime += 0.3; // Animation speed step
                if (this.seqTime > 100) {
                    if (this.seqLoop) {
                        this.seqTime = 0;
                    } else {
                        this.seqTime = 100;
                        this.isSeqPlaying = false;
                    }
                }
                this.interpolateSequencer();
                
                // Update UI playhead
                const playhead = document.getElementById('timeline-playhead');
                if (playhead) {
                    playhead.style.left = `${this.seqTime}%`;
                }
            }

            if (this.isPlaying) {
                this.actors.forEach(actor => {
                    if (actor.type === 'mesh' && actor.name !== "Floor Grid") {
                        if (actor.object && actor.object.rotation) {
                            actor.object.rotation.y += 0.005;
                            actor.object.rotation.x += 0.002;
                        }
                    }
                });
                this.resetPathTracing();
            }

            if (this.renderMode === 'realtime') {
                this.renderRealtimePBR();
            } else {
                this.renderPathTracer();
            }
        } catch (err) {
            console.error("CRITICAL RENDER LOOP ERROR:", err);
        }
    }

    onResize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        
        this.sceneRenderTarget.setSize(w, h);
        this.ssaoRenderTarget.setSize(w, h);
        this.bloomThresholdTarget.setSize(w / 2, h / 2);
        this.bloomBlurTarget.setSize(w / 2, h / 2);

        this.ptAccumTargets[0].setSize(w, h);
        this.ptAccumTargets[1].setSize(w, h);
        this.ptDenoiseTarget.setSize(w, h);
        
        this.resetPathTracing();
    }
}
