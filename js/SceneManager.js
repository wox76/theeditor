import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PixelShader } from './postprocessing/PixelShader.js';

export class SceneManager {
    constructor(app) {
        this.app = app;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.viewport = document.getElementById('viewport');
        this.composer = null;
        this.pixelPass = null;
        this.outputPass = null;
        this.usePixelShader = false;
    }

    init() {
        // Scene Setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x222222);

        // Camera Setup
        this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
        this.camera.position.set(5, 5, 5);

        // Renderer Setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
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
        
        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);

        // Helpers
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(5, 10, 7);
        this.scene.add(dirLight);

        // Grid
        const grid = new THREE.GridHelper(20, 20, 0x444444, 0x333333);
        this.scene.add(grid);

        // Custom X and Z axes (Red and Blue)
        const xLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-10, 0, 0), new THREE.Vector3(10, 0, 0)]);
        const xLine = new THREE.Line(xLineGeo, new THREE.LineBasicMaterial({ color: 0xff0000 }));
        this.scene.add(xLine);

        const zLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -10), new THREE.Vector3(0, 0, 10)]);
        const zLine = new THREE.Line(zLineGeo, new THREE.LineBasicMaterial({ color: 0x0000ff }));
        this.scene.add(zLine);

        // Floor
        const planeGeo = new THREE.PlaneGeometry(100, 100);
        const planeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
        const floor = new THREE.Mesh(planeGeo, planeMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.01; // Just below grid
        floor.name = "Floor";
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Resize Observer
        const res = new ResizeObserver(() => this.onResize());
        res.observe(this.viewport);
        
        this.onResize(); // Initial sizing
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
        }
    }

    update() {
        if (this.renderer && this.scene && this.camera) {
            if (this.usePixelShader && this.composer) {
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
}
