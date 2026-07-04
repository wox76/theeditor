import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PixelShader } from './postprocessing/PixelShader.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CyberpunkShader } from './postprocessing/CyberpunkShader.js';

export class SceneManager {
    constructor(app) {
        this.app = app;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.viewport = document.getElementById('viewport');
        this.composer = null;
        this.pixelPass = null;
        this.bloomPass = null;
        this.cyberpunkPass = null;
        this.outputPass = null;
        this.usePixelShader = false;
        this.useBloom = false;
        this.useCyberpunk = false;
        this.pbrExposure = 1.0;
        this.hasSplatEnv = false; // When true, bypass composer for Spark compatibility
        this.skyboxData = null;
        this.skyboxFilename = '';
        this.skyboxTexture = null;
        this.skyboxIntensity = 1.0;
        this.skyboxVisible = true;
    }

    init() {
        // Scene Setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xe5e5ea);

        // Camera Setup
        this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
        this.camera.position.set(5, 5, 5);

        // Renderer Setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.shadowMap.enabled = false;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.viewport.appendChild(this.renderer.domElement);

        // Post Processing
        this.composer = new EffectComposer(this.renderer);
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        this.pixelPass = new ShaderPass(PixelShader);
        this.pixelPass.uniforms['resolution'].value = new THREE.Vector2(window.innerWidth, window.innerHeight);
        this.pixelPass.uniforms['pixelSize'].value = 6;
        this.pixelPass.enabled = false;
        this.composer.addPass(this.pixelPass);

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            1.5, // strength
            0.4, // radius
            0.85 // threshold
        );
        this.bloomPass.enabled = false;
        this.composer.addPass(this.bloomPass);

        this.cyberpunkPass = new ShaderPass(CyberpunkShader);
        this.cyberpunkPass.uniforms['resolution'].value = new THREE.Vector2(window.innerWidth, window.innerHeight);
        this.cyberpunkPass.enabled = false;
        this.composer.addPass(this.cyberpunkPass);

        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);

        // Helpers
        this.scene.add(new THREE.AmbientLight(0xffffff, 1.5));
        this.dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        this.dirLight.position.set(5, 10, 7);
        this.dirLight.castShadow = false;
        this.dirLight.shadow.mapSize.width = 2048;
        this.dirLight.shadow.mapSize.height = 2048;
        this.dirLight.shadow.camera.near = 0.5;
        this.dirLight.shadow.camera.far = 50;
        this.dirLight.shadow.camera.left = -20;
        this.dirLight.shadow.camera.right = 20;
        this.dirLight.shadow.camera.top = 20;
        this.dirLight.shadow.camera.bottom = -20;
        this.dirLight.shadow.bias = -0.001;
        this.scene.add(this.dirLight);

        // Grid (scura per risaltare su sfondo chiaro)
        const grid = new THREE.GridHelper(40, 40, 0x555555, 0x888888);
        this.scene.add(grid);

        // Custom X and Z axes (Red and Blue)
        const xLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-20, 0, 0), new THREE.Vector3(20, 0, 0)]);
        const xLine = new THREE.Line(xLineGeo, new THREE.LineBasicMaterial({ color: 0xff3b30, linewidth: 2 }));
        this.scene.add(xLine);

        const zLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -20), new THREE.Vector3(0, 0, 20)]);
        const zLine = new THREE.Line(zLineGeo, new THREE.LineBasicMaterial({ color: 0x007aff, linewidth: 2 }));
        this.scene.add(zLine);

        // Floor (chiaro auto-illuminato)
        const planeGeo = new THREE.PlaneGeometry(100, 100);
        const planeMat = new THREE.MeshBasicMaterial({ color: 0xe5e5ea });
        const floor = new THREE.Mesh(planeGeo, planeMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.01; // Just below grid
        floor.name = "Floor";
        this.scene.add(floor);

        // Resize Observer
        const res = new ResizeObserver(() => this.onResize());
        res.observe(this.viewport);

        this.onResize(); // Initial sizing
    }

    /** Called by Editor when a SplatEnv is added/removed. Bypasses EffectComposer. */
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
        if (this.composer) {
            this.composer.setSize(width, height);
            if (this.pixelPass) {
                this.pixelPass.uniforms['resolution'].value.set(width, height);
            }
            if (this.cyberpunkPass) {
                this.cyberpunkPass.uniforms['resolution'].value.set(width, height);
            }
        }
    }

    update() {
        if (this.renderer && this.scene && this.camera) {
            // Spark SplatMesh requires direct renderer.render() - bypass composer when SplatEnv is present
            if (this.hasSplatEnv) {
                this.renderer.render(this.scene, this.camera);
            } else if ((this.usePixelShader || this.useBloom || this.useCyberpunk) && this.composer) {
                this.composer.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        }
    }

    setPixelEffect(enabled, size) {
        this.usePixelShader = enabled;
        if (this.pixelPass) {
            this.pixelPass.enabled = enabled;
            if (size) this.pixelPass.uniforms['pixelSize'].value = size;
        }
    }

    setBloomEffect(enabled, strength, radius) {
        this.useBloom = enabled;
        if (this.bloomPass) {
            this.bloomPass.enabled = enabled;
            if (strength !== undefined) this.bloomPass.strength = strength;
            if (radius !== undefined) this.bloomPass.radius = radius;
        }
    }

    setCyberpunkEffect(enabled, aberration, scanlines) {
        this.useCyberpunk = enabled;
        if (this.cyberpunkPass) {
            this.cyberpunkPass.enabled = enabled;
            if (aberration !== undefined) this.cyberpunkPass.uniforms['aberrationAmount'].value = aberration;
            if (scanlines !== undefined) this.cyberpunkPass.uniforms['scanlineIntensity'].value = scanlines;
        }
    }

    setExposure(val) {
        this.pbrExposure = val;
        this.renderer.toneMappingExposure = val;
    }

    setPBROutput(enabled) {
        if (enabled) {
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = this.pbrExposure;
        } else {
            this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
            this.renderer.toneMapping = THREE.NoToneMapping;
        }

        this.scene.traverse((child) => {
            if (child.isMesh && child.material) child.material.needsUpdate = true;
        });
    }

    setShadows(enabled) {
        this.renderer.shadowMap.enabled = enabled;
        if (this.dirLight) this.dirLight.castShadow = enabled;

        this.scene.traverse((child) => {
            if (child.isMesh) {
                let isHelper = false;
                let curr = child;
                while (curr) {
                    if (curr.name === 'TransformControlsGizmo' || curr.type === 'TransformControls' || curr.type === 'GridHelper' || curr.type === 'AxesHelper' || curr.name === 'ArrowHelper' ||
                        (curr.userData && curr.userData.isAsset && ['PointLight', 'SpotLight', 'DirectionalLight'].includes(curr.userData.type))) {
                        isHelper = true;
                        break;
                    }
                    curr = curr.parent;
                }

                if (isHelper) {
                    child.castShadow = false;
                    child.receiveShadow = false;
                } else {
                    child.castShadow = enabled;
                    child.receiveShadow = enabled;
                }
                if (child.material) child.material.needsUpdate = true;
            } else if (child.isLight && child.name === 'light_source') {
                const parentWantsShadows = child.parent && child.parent.userData && child.parent.userData.castShadow !== false;
                child.castShadow = enabled && parentWantsShadows;
            }
        });

        const floor = this.scene.getObjectByName('Floor');
        if (floor) {
            floor.receiveShadow = enabled;
            floor.castShadow = false;
            if (floor.material) floor.material.needsUpdate = true;
        }
    }

    setReflections(enabled) {
        if (enabled) {
            if (!this.pmremGenerator) {
                this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
                this.pmremGenerator.compileEquirectangularShader();
            }
            if (!this.roomEnvironment) {
                this.roomEnvironment = new RoomEnvironment();
            }
            this.scene.environment = this.pmremGenerator.fromScene(this.roomEnvironment).texture;
        } else {
            this.scene.environment = null;
            if (this.pmremGenerator) {
                this.pmremGenerator.dispose();
                this.pmremGenerator = null;
            }
        }

        this.scene.traverse((child) => {
            if (child.isMesh && child.material) child.material.needsUpdate = true;
        });
    }

    setSkybox(dataUrlOrNull, filename) {
        this.skyboxData = dataUrlOrNull;
        this.skyboxFilename = filename || '';

        if (!dataUrlOrNull) {
            if (this.skyboxTexture) {
                this.skyboxTexture.dispose();
                this.skyboxTexture = null;
            }
            this.scene.background = new THREE.Color(0x222222);
            this.scene.environment = null;
            this.scene.traverse((child) => {
                if (child.isMesh && child.material) child.material.needsUpdate = true;
            });
            return;
        }

        const isHDR = filename.toLowerCase().endsWith('.hdr') || dataUrlOrNull.startsWith('data:image/vnd.radial') || dataUrlOrNull.startsWith('data:application/octet-stream');

        const applyTexture = (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            if (isHDR) {
                texture.colorSpace = THREE.LinearSRGBColorSpace;
            } else {
                texture.colorSpace = THREE.SRGBColorSpace;
            }
            this.scene.background = this.skyboxVisible ? texture : new THREE.Color(0x222222);
            this.scene.environment = texture;

            // Set intensities
            this.scene.environmentIntensity = this.skyboxIntensity;
            this.scene.backgroundIntensity = this.skyboxIntensity;

            if (this.skyboxTexture) this.skyboxTexture.dispose();
            this.skyboxTexture = texture;

            this.scene.traverse((child) => {
                if (child.isMesh && child.material) child.material.needsUpdate = true;
            });
        };

        if (isHDR) {
            import('three/addons/loaders/RGBELoader.js').then(({ RGBELoader }) => {
                new RGBELoader().load(dataUrlOrNull, (texture) => {
                    applyTexture(texture);
                }, undefined, (err) => {
                    console.error('Error loading HDR skybox:', err);
                });
            }).catch(err => {
                console.error('Failed to import RGBELoader:', err);
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
        this.skyboxIntensity = intensity;
        this.scene.environmentIntensity = intensity;
        this.scene.backgroundIntensity = intensity;
        this.scene.traverse((child) => {
            if (child.isMesh && child.material) child.material.needsUpdate = true;
        });
    }

    setSkyboxVisibility(visible) {
        this.skyboxVisible = visible;
        if (this.skyboxTexture) {
            this.scene.background = visible ? this.skyboxTexture : new THREE.Color(0x222222);
        } else {
            this.scene.background = new THREE.Color(0x222222);
        }
    }
}
