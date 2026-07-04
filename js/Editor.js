import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { PlayerFactory } from './Player.js';
import { SplatMesh } from '@sparkjsdev/spark';

export class Editor {
    constructor(app) {
        this.app = app;
        this.objects = [];
        this.selected = null;
        this.history = [];
        this.hIndex = -1;
        this.loader = new GLTFLoader();
        this.clipboard = null;
        this.levels = []; // Array of { name, data, music } level entries
        this.currentLevelIndex = -1; // -1 = unsaved scene
        this.projectName = 'default_project';
        this.pendingCommand = null;
        this.pendingCommandTimeout = null;

        // Raycaster
        this.raycaster = new THREE.Raycaster();
        this.raycaster.params.Line.threshold = 0.2;
        this.mouse = new THREE.Vector2();

        this.mixer = null;
        this.clock = new THREE.Clock();
        this.currentAnim = null;
        this.gameTitle = 'Web 3D Game';
        this.gameSplashSubtitle = '3D Editor Engine'; // Default subtitle
        this.gameSplashImage = null; // Data URL for splash background
        this.gameSplashPromptBg = 'rgba(255,255,255,0.1)'; // Default prompt bg
        this.gameSplashPromptColor = '#ffffff'; // Default prompt text color
        this.gameSplashMusic = null; // Data URL for splash music
        this.gameSplashMusicFilename = ''; // Source filename
        this.startingLevelIndex = 0; // Default Starting Level
        // End Screen
        this.gameEndTitle = '';
        this.gameEndSubtitle = '';
        this.gameEndImage = null;
        this.gameEndVideo = null;
        this.gameEndVideoAspect = 'cover'; // cover | contain | 16/9 | vertical | horizontal
        this.gameEndMusic = null;
        this.gameEndMusicFilename = '';

        // Default Post Processing effects active
        this.gameBloomEffect = false;
        this.gameBloomStrength = 1.5;
        this.gameBloomRadius = 0.4;
        this.gameCyberpunkEffect = false;
        this.gameCyberpunkAberration = 0.3;
        this.gameCyberpunkScanlines = 0.1;
        this.gamePbrActive = false;
    }

    init() {
        const { camera, renderer, viewport } = this.app.sceneManager;

        this.orbit = new OrbitControls(camera, renderer.domElement);
        this.gizmo = new TransformControls(camera, renderer.domElement);
        this.gizmo.size = 0.5;
        const helper = this.gizmo.getHelper();
        helper.userData.isHelper = true;
        helper.name = 'TransformControlsGizmo';

        this.gizmo.setTranslationSnap(0.5);
        this.gizmo.setRotationSnap(THREE.MathUtils.degToRad(5));
        this.gizmo.setScaleSnap(0.1);

        this.app.sceneManager.scene.add(helper);

        this.linkGroup = new THREE.Group();
        this.app.sceneManager.scene.add(this.linkGroup);

        this.addCamera();

        this.gizmo.addEventListener('change', () => this.updateLinks());

        let transformStartData = null;
        this.gizmo.addEventListener('dragging-changed', (e) => {
            this.orbit.enabled = !e.value;
            if (e.value) {
                if (this.gizmo.object) {
                    transformStartData = {
                        p: this.gizmo.object.position.clone(),
                        r: this.gizmo.object.rotation.clone(),
                        s: this.gizmo.object.scale.clone()
                    };
                }
            } else {
                if (this.gizmo.object && transformStartData) {
                    const obj = this.gizmo.object;
                    if (!obj.position.equals(transformStartData.p) || !obj.rotation.equals(transformStartData.r) || !obj.scale.equals(transformStartData.s)) {
                        this.executeAction({
                            type: 'transform',
                            object: obj,
                            from: transformStartData,
                            to: { p: obj.position.clone(), r: obj.rotation.clone(), s: obj.scale.clone() }
                        });
                    }
                }
                this.updateLinks();
                if (this.selected) {
                    this.app.ui.updateProperties();
                }
            }
        });

        viewport.addEventListener('mousedown', (e) => this.onMouseDown(e));
        window.addEventListener('keydown', (e) => {
            if (this.app.game && this.app.game.isPlaying) return;
            if (!e.key) return;

            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

            const keyLower = e.key.toLowerCase();
            if (keyLower === 'f') this.focusSelected();
            if (e.ctrlKey && keyLower === 'z') { e.preventDefault(); this.undo(); }
            if (e.ctrlKey && keyLower === 'y') { e.preventDefault(); this.redo(); }
            if (e.ctrlKey && keyLower === 'c') { e.preventDefault(); this.copy(); }
            if (e.ctrlKey && keyLower === 'v') { e.preventDefault(); this.paste(); }
            if (e.ctrlKey && keyLower === 's') { e.preventDefault(); this.saveProject(); }

            // ---- Blender-style shortcuts (con oggetto selezionato) ----
            if (this.selected) {
                if (keyLower === 's' && !e.ctrlKey) {
                    this.gizmo.setMode('scale');
                    this.gizmo.showX = true; this.gizmo.showY = true; this.gizmo.showZ = true;
                    if (this.app.ui?.setActiveTool) this.app.ui.setActiveTool('btn-scale');
                    this.pendingCommand = null;
                } else if (keyLower === 'r' && !e.ctrlKey) {
                    this.pendingCommand = 'r';
                    clearTimeout(this.pendingCommandTimeout);
                    this.pendingCommandTimeout = setTimeout(() => {
                        if (this.pendingCommand === 'r') this.pendingCommand = null;
                    }, 2000);
                } else if (keyLower === 'g' && !e.ctrlKey) {
                    this.pendingCommand = 'g';
                    clearTimeout(this.pendingCommandTimeout);
                    this.pendingCommandTimeout = setTimeout(() => {
                        if (this.pendingCommand === 'g') this.pendingCommand = null;
                    }, 2000);
                } else if (keyLower === 'x' || keyLower === 'y' || keyLower === 'z') {
                    if (this.pendingCommand === 'r') {
                        this.gizmo.setMode('rotate');
                        this.gizmo.showX = (keyLower === 'x');
                        this.gizmo.showY = (keyLower === 'y');
                        this.gizmo.showZ = (keyLower === 'z');
                        if (this.app.ui?.setActiveTool) this.app.ui.setActiveTool('btn-rot');
                        this.pendingCommand = null;
                    } else if (this.pendingCommand === 'g') {
                        this.gizmo.setMode('translate');
                        this.gizmo.showX = (keyLower === 'x');
                        this.gizmo.showY = (keyLower === 'y');
                        this.gizmo.showZ = (keyLower === 'z');
                        if (this.app.ui?.setActiveTool) this.app.ui.setActiveTool('btn-trans');
                        this.pendingCommand = null;
                    }
                } else if (!e.ctrlKey) {
                    this.pendingCommand = null;
                }
            }
        });

        // Applica effetti grafici di default a SceneManager
        this.app.sceneManager.setBloomEffect(this.gameBloomEffect, this.gameBloomStrength, this.gameBloomRadius);
        this.app.sceneManager.setCyberpunkEffect(this.gameCyberpunkEffect, this.gameCyberpunkAberration, this.gameCyberpunkScanlines);

        // Se non ci sono livelli inizializzati, crea la scena di default (griglia, camera e player)
        setTimeout(() => {
            if (this.levels.length === 0 && this.objects.length === 0) {
                this.setupInitialDefaultScene();
            }
        }, 100);
    }


    copy() {
        if (!this.selected) return;
        try {
            this.clipboard = SkeletonUtils.clone(this.selected);
        } catch (e) {
            this.clipboard = this.selected.clone();
        }
        this.clipboard.position.copy(this.selected.position);
        this.clipboard.rotation.copy(this.selected.rotation);
        this.clipboard.scale.copy(this.selected.scale);
        if (this.selected.animations) this.clipboard.animations = this.selected.animations;
        this.clipboard.userData = JSON.parse(JSON.stringify(this.selected.userData));
    }

    paste() {
        if (!this.clipboard) return;

        let clone;
        try {
            clone = SkeletonUtils.clone(this.clipboard);
        } catch (e) {
            clone = this.clipboard.clone();
        }

        clone.userData = JSON.parse(JSON.stringify(this.clipboard.userData));
        clone.position.add(new THREE.Vector3(1, 0, 1));
        clone.name = this.clipboard.name + "_Copy";
        if (this.clipboard.animations) clone.animations = this.clipboard.animations;

        const oldArrow = clone.getObjectByName('ArrowHelper');
        if (oldArrow) clone.remove(oldArrow);

        if (clone.userData.type === 'Enemy') {
            const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 1.5, 0xff0000);
            arrow.name = 'ArrowHelper';
            clone.add(arrow);
        }

        this.addObject(clone);
        this.app.ui.rebuildLibrary();
    }

    executeAction(action) {
        if (this.hIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.hIndex + 1);
        }
        this.history.push(action);
        this.hIndex++;
    }

    undo() {
        if (this.hIndex < 0) return;
        const action = this.history[this.hIndex];
        this.applyAction(action, true);
        this.hIndex--;
        this.app.ui.update();
    }

    redo() {
        if (this.hIndex >= this.history.length - 1) return;
        this.hIndex++;
        const action = this.history[this.hIndex];
        this.applyAction(action, false);
        this.app.ui.update();
    }

    applyAction(action, isUndo) {
        if (action.type === 'transform') {
            const data = isUndo ? action.from : action.to;
            action.object.position.copy(data.p);
            action.object.rotation.copy(data.r);
            action.object.scale.copy(data.s);
        }
    }

    enableOrbit(enabled) {
        if (this.orbit) {
            this.orbit.enabled = enabled;
            this.orbit.update();
        }
    }

    focusSelected() {
        if (!this.selected) return;
        const pos = this.selected.position;
        this.orbit.target.copy(pos);
        const offset = new THREE.Vector3(5, 5, 5);
        this.app.sceneManager.camera.position.copy(pos).add(offset);
        this.orbit.update();
    }

    onMouseDown(e) {
        if (this.gizmo.axis !== null) return;

        const rect = this.app.sceneManager.viewport.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.app.sceneManager.camera);
        const targets = this.app.sceneManager.scene.children.filter(c => c.userData && c.userData.type !== 'SplatEnv');
        const hits = this.raycaster.intersectObjects(targets, true);

        if (hits.length) {
            let target = hits[0].object;
            while (target && !this.objects.includes(target) && target.parent) {
                target = target.parent;
            }
            if (target && this.objects.includes(target)) {
                this.select(target);
            }
        }
    }

    update() {
        const dt = this.clock.getDelta();
        if (this.mixer) this.mixer.update(dt);

        if (this.selected) {
            const targetAnim = this.selected.userData.animIdle || this.selected.userData.defaultAnim;
            if (targetAnim !== this.currentAnim) {
                this.playAnimation(targetAnim);
            }
        }
    }

    setupMixer(obj) {
        this.mixer = null;
        this.currentAnim = null;
        if (!obj) return;

        let anims = obj.animations;
        if ((!anims || anims.length === 0) && obj.getObjectByName('model')) {
            anims = obj.getObjectByName('model').animations;
        }

        if (anims && anims.length > 0) {
            const model = obj.getObjectByName('model') || obj;
            this.mixer = new THREE.AnimationMixer(model);
            const targetAnim = obj.userData.animIdle || obj.userData.defaultAnim;
            if (targetAnim) {
                this.playAnimation(targetAnim);
            }
        }
    }

    playAnimation(name) {
        this.currentAnim = name;
        if (!this.mixer) return;
        this.mixer.stopAllAction();
        if (!name) return;

        let clips = this.selected.animations;
        if ((!clips || clips.length === 0) && this.selected.getObjectByName('model')) {
            clips = this.selected.getObjectByName('model').animations;
        }

        if (!clips) return;

        const clip = clips.find(c => c.name === name);
        if (clip) {
            const action = this.mixer.clipAction(clip);
            action.play();
        }
    }

    select(obj) {
        this.selected = obj;
        if (obj) {
            this.gizmo.attach(obj);
            this.gizmo.showX = true;
            this.gizmo.showY = true;
            this.gizmo.showZ = true;
        } else {
            this.gizmo.detach();
        }
        this.setupMixer(obj);
        this.app.ui.update();
    }

    setRotationSnap(enabled) {
        this.gizmo.setRotationSnap(enabled ? THREE.MathUtils.degToRad(5) : null);
    }

    setTranslationSnap(enabled) {
        this.gizmo.setTranslationSnap(enabled ? 0.5 : null);
    }

    setScaleSnap(enabled) {
        this.gizmo.setScaleSnap(enabled ? 0.1 : null);
    }

    deleteSelected() {
        if (!this.selected) return;

        this.app.sceneManager.scene.remove(this.selected);
        const idx = this.objects.indexOf(this.selected);
        if (idx > -1) this.objects.splice(idx, 1);
        this.gizmo.detach();
        this.selected = null;

        this.app.ui.rebuildLibrary();
        this.app.ui.update();
        this.updateSplatMode();
    }

    addObject(obj) {
        this.objects.push(obj);
        this.app.sceneManager.scene.add(obj);
        this.select(obj);
        this.updateSplatMode();
    }

    updateSplatMode() {
        const hasSplat = this.objects.some(o => o.userData.type === 'SplatEnv');
        this.app.sceneManager.setSplatMode(hasSplat);
    }

    loadGLB(url, onLoaded) {
        if (!this.selected) return;
        this.loader.load(url, (gltf) => {
            const old = this.selected.getObjectByName('model');
            if (old) this.selected.remove(old);

            const m = gltf.scene;
            m.name = 'model';
            m.scale.set(1, 1, 1);

            let height = 2.0;
            if (this.selected.geometry?.parameters) {
                const p = this.selected.geometry.parameters;
                if (p.height) height = p.height + (p.radius ? p.radius * 2 : 0);
            }
            m.position.y = -height / 2;

            this.selected.add(m);
            this.selected.animations = gltf.animations;
            this.selected.userData.anims = gltf.animations.map(a => a.name);
            this.selected.userData.glbSource = url;

            this.autoMapPlayerAnimations(this.selected);

            this.selected.userData.alphaMode = this.selected.userData.alphaMode || 'mask';
            this.selected.userData.alphaTest = this.selected.userData.alphaTest !== undefined ? this.selected.userData.alphaTest : 0.5;
            this.selected.userData.doubleSide = this.selected.userData.doubleSide !== undefined ? this.selected.userData.doubleSide : true;
            this.updateMaterialSettings(m);

            this.setupMixer(this.selected);
            this.app.ui.update();
            if (onLoaded) onLoaded(m);
        });
    }

    reloadModel(obj, url, onLoaded) {
        return new Promise((resolve) => {
            this.loader.load(url, (gltf) => {
                const old = obj.getObjectByName('model');
                if (old) obj.remove(old);
                const m = gltf.scene;
                m.name = 'model';

                let useSmartOffset = !obj.userData.modelOffset;
                if (obj.userData.modelOffset && (obj.userData.type === 'Enemy' || obj.userData.isPlayer)) {
                    if (Math.abs(obj.userData.modelOffset[1]) < 0.001) useSmartOffset = true;
                }

                if (!useSmartOffset) {
                    m.position.fromArray(obj.userData.modelOffset);
                } else {
                    if (obj.userData.type === 'Model' && !obj.geometry) {
                        m.position.set(0, 0, 0);
                    } else {
                        let height = 2.0;
                        if (obj.geometry?.parameters) {
                            const p = obj.geometry.parameters;
                            if (p.height !== undefined) height = p.height + (p.radius ? p.radius * 2 : 0);
                            else if (p.length !== undefined) height = p.length + (p.radius ? p.radius * 2 : 0);
                        }
                        m.position.set(0, -height / 2, 0);
                    }
                }

                if (obj.userData.modelRotation) m.rotation.fromArray(obj.userData.modelRotation);

                if (obj.userData.modelScale) {
                    m.scale.fromArray(obj.userData.modelScale);
                } else {
                    if (obj.userData.type === 'Model') m.scale.set(1, 1, 1);
                    else m.scale.set(0.5, 0.5, 0.5);
                }

                obj.add(m);
                obj.animations = gltf.animations;
                if (obj.userData.isPlayer) {
                    obj.userData.anims = gltf.animations.map(a => a.name);
                    this.autoMapPlayerAnimations(obj);
                } else if (obj.userData.type === 'Model' || obj.userData.type === 'Enemy' || obj.userData.type === 'Bonus') {
                    obj.userData.anims = gltf.animations.map(a => a.name);
                }

                if (obj.userData.type === 'Model') {
                    obj.userData.alphaMode = obj.userData.alphaMode || 'mask';
                    obj.userData.alphaTest = obj.userData.alphaTest !== undefined ? obj.userData.alphaTest : 0.5;
                    obj.userData.doubleSide = obj.userData.doubleSide !== undefined ? obj.userData.doubleSide : true;
                }
                this.updateMaterialSettings(m);

                if (this.selected === obj) {
                    this.setupMixer(obj);
                    this.app.ui.updateProperties();
                }
                if (onLoaded) onLoaded(m);
                resolve(m);
            }, undefined, (err) => {
                console.error("Error loading models", url, err);
                resolve(null);
            });
        });
    }

    autoMapPlayerAnimations(player) {
        if (!player || !player.userData.isPlayer || !player.userData.actions || !player.userData.anims) return;

        const anims = player.userData.anims;
        const findAnim = (keywords) => {
            const lowerAnims = anims.map(a => a.toLowerCase());
            for (let kw of keywords) {
                const idx = lowerAnims.findIndex(a => a.includes(kw));
                if (idx !== -1) return anims[idx];
            }
            return '';
        };

        player.userData.actions.forEach(action => {
            if (action.anim && anims.includes(action.anim)) return;

            let keywords = [];
            const type = action.type.toLowerCase();
            const name = action.name.toLowerCase();

            if (type === 'idle') keywords = ['idle', 'wait', 'stand'];
            else if (type === 'walk') keywords = ['walk', 'move', 'run'];
            else if (type === 'run') keywords = ['run', 'sprint', 'dash'];
            else if (type === 'jump') keywords = ['jump', 'leap', 'air'];
            else if (type === 'death') keywords = ['death', 'die', 'dead'];
            else if (type === 'attack') keywords = ['attack', 'hit', 'punch', 'kick'];

            keywords.unshift(name);

            const match = findAnim(keywords);
            if (match) action.anim = match;
        });

        if (this.app.ui) this.app.ui.updateProperties();
    }

    spawnAsset(type, data, clientX, clientY, defaultAnim = null, name = null) {
        const rect = this.app.sceneManager.viewport.getBoundingClientRect();
        this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.app.sceneManager.camera);

        const targets = this.app.sceneManager.scene.children.filter(o => {
            if (o.userData.isHelper || o.userData.isCamera || o.userData.type === 'SplatEnv') return false;
            if (o.type.includes('Light') || o.type.includes('Camera') || o.type === 'GridHelper' || o.type === 'TransformControls') return false;
            return true;
        });

        const hits = this.raycaster.intersectObjects(targets, true);
        let pos = new THREE.Vector3(0, 0, 0);
        if (hits.length > 0) pos.copy(hits[0].point);
        else this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pos);

        if (type === 'Player') {
            const p = PlayerFactory.createPlayer(this.objects.length);
            p.position.copy(pos).y += 1;
            this.addObject(p);
            this.app.ui.rebuildLibrary();
            return;
        }

        if (type === 'SplatEnv' && data) {
            const wrapper = new THREE.Group();
            wrapper.position.copy(pos);
            wrapper.name = name || ('SplatEnv_' + this.objects.length);
            wrapper.userData = {
                isAsset: true,
                type: 'SplatEnv',
                splatSource: data,
                glbFilename: name || 'splat',
                hasCollision: false
            };
            try {
                const blobUrl = this._dataUrlToBlobUrl(data);
                const sm = new SplatMesh({
                    url: blobUrl,
                    renderer: this.app.sceneManager.renderer,
                    camera: this.app.sceneManager.camera
                });
                sm.name = 'splatMesh';
                sm.quaternion.set(1, 0, 0, 0);
                sm.scale.set(1, 1, 1);
                sm.frustumCulled = false;
                sm.castShadow = false;
                sm.receiveShadow = false;
                sm.matrixAutoUpdate = false;
                wrapper.add(sm);
                console.log('[SplatEnv] SplatMesh created.');
            } catch (err) {
                console.warn('[SplatEnv] SplatMesh creation failed:', err);
            }
            this.addObject(wrapper);
            this.focusSelected();
            this.app.ui.rebuildLibrary();
            return;
        }

        if (type === 'Model' && data) {
            this.loader.load(data, (gltf) => {
                const m = gltf.scene;
                const wrapper = new THREE.Group();
                wrapper.position.copy(pos);
                wrapper.name = "Model_" + this.objects.length;
                wrapper.userData = { isAsset: true, type: 'Model', glbSource: data };
                if (defaultAnim) wrapper.userData.defaultAnim = defaultAnim;

                m.position.y = 0;
                wrapper.add(m);
                wrapper.animations = gltf.animations;
                wrapper.userData.anims = gltf.animations.map(a => a.name);

                wrapper.userData.alphaMode = 'mask';
                wrapper.userData.alphaTest = 0.5;
                wrapper.userData.doubleSide = true;
                this.updateMaterialSettings(m);

                this.addObject(wrapper);
            });
            return;
        }

        let geo, mat = new THREE.MeshStandardMaterial({ color: 0x888888, wireframe: true, transparent: true, opacity: 0.5 });
        let isLight = false;

        switch (type) {
            case 'Enemy':
                geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
                mat.color.setHex(0xff6600);
                break;
            case 'Bonus': geo = new THREE.SphereGeometry(1.0); mat.color.setHex(0xFFD700); break;
            case 'Boss': geo = new THREE.BoxGeometry(1.5, 1.5, 1.5); mat.color.setHex(0xcc0000); break;
            case 'Catcher': geo = new THREE.CylinderGeometry(0.5, 0.5, 0.2); mat.color.setHex(0x5500aa); break;
            case 'Spawn': geo = new THREE.ConeGeometry(0.5, 1, 4); mat.color.setHex(0xaa5500); break;
            case 'Goal': geo = new THREE.BoxGeometry(1, 0.1, 1); mat.color.setHex(0xD4AF37); break;
            case 'PowerUp': geo = new THREE.BoxGeometry(0.5, 0.5, 0.5); mat.color.setHex(0x00cccc); break;
            case 'Analyze':
                geo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
                mat = new THREE.MeshBasicMaterial({ color: 0x33cccc, wireframe: true, transparent: true, opacity: 0.8 });
                break;
            case 'Dialog':
                geo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
                mat = new THREE.MeshBasicMaterial({ color: 0x7733cc, wireframe: true, transparent: true, opacity: 0.8 });
                break;
            case 'Collision':
                geo = new THREE.BoxGeometry(1, 1, 1);
                mat = new THREE.MeshBasicMaterial({ color: 0x22ff22, wireframe: true, transparent: true, opacity: 0.3 });
                break;
            case 'PointLight':
                geo = new THREE.SphereGeometry(0.2);
                mat = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true });
                isLight = true;
                break;
            case 'SpotLight':
                geo = new THREE.ConeGeometry(0.2, 0.5, 4);
                mat = new THREE.MeshBasicMaterial({ color: 0xffffaa, wireframe: true });
                isLight = true;
                break;
            case 'DirectionalLight':
                geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
                mat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
                isLight = true;
                break;
            default: geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        }
        const mesh = new THREE.Mesh(geo, mat);

        let heightOffset = 0.5;
        if (geo.parameters) {
            if (geo.parameters.height) heightOffset = geo.parameters.height / 2;
            else if (geo.parameters.radius) heightOffset = geo.parameters.radius;
        }
        mesh.position.copy(pos).y += heightOffset;

        mesh.name = type + "_" + this.objects.length;
        mesh.userData = { isAsset: true, type: type };

        if (isLight) {
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.userData.color = mat.color.getHex();
            mesh.userData.intensity = 1.0;
            mesh.userData.distance = (type === 'DirectionalLight') ? 0 : 10;

            let lightObj;
            const shadowsEnabled = this.app.sceneManager.renderer.shadowMap.enabled;

            if (type === 'PointLight') {
                lightObj = new THREE.PointLight(0xffffff, 1.0, 10);
            } else if (type === 'SpotLight') {
                lightObj = new THREE.SpotLight(0xffffff, 1.0, 10, Math.PI / 4, 0.5, 1);
                lightObj.target.position.set(0, -1, 0);
                mesh.add(lightObj.target);
            } else if (type === 'DirectionalLight') {
                lightObj = new THREE.DirectionalLight(0xffffff, 1.0);
            }

            if (lightObj) {
                lightObj.name = 'light_source';
                lightObj.castShadow = shadowsEnabled;

                mesh.userData.castShadow = true;
                mesh.userData.shadowRes = 1024;
                mesh.userData.shadowBias = -0.001;
                mesh.userData.shadowNormalBias = 0;
                mesh.userData.shadowRadius = 1;
                mesh.userData.shadowCamNear = 0.5;
                mesh.userData.shadowCamFar = 500;

                lightObj.shadow.mapSize.width = 1024;
                lightObj.shadow.mapSize.height = 1024;
                lightObj.shadow.bias = -0.001;
                lightObj.shadow.normalBias = 0;
                lightObj.shadow.radius = 1;
                lightObj.shadow.camera.near = 0.5;
                lightObj.shadow.camera.far = 500;

                if (type === 'DirectionalLight') {
                    mesh.userData.shadowCamSize = 10;
                    lightObj.shadow.camera.left = -10;
                    lightObj.shadow.camera.right = 10;
                    lightObj.shadow.camera.top = 10;
                    lightObj.shadow.camera.bottom = -10;
                }
                mesh.add(lightObj);
            }
        }

        if (type === 'Bonus') {
            mesh.userData.radius = 1.0;
            mesh.userData.points = 100;
            mesh.userData.disappearOnCollect = true;
        }

        if (type === 'Analyze') {
            mesh.userData.objectName = 'Oggetto da Analizzare';
            mesh.userData.objectDescription = 'Descrizione dell\'oggetto...';
            mesh.userData.activationKey = 'e';
            mesh.userData.activationTouch = true;
            mesh.userData.glbSource = null;
            mesh.userData.imageSource = null;
            mesh.userData.isTrigger = true;
        }

        if (type === 'Dialog') {
            mesh.userData.dialogQuestion = 'Scrivi qui la tua domanda...';
            mesh.userData.dialogAnswers = [];
            mesh.userData.dialogBgColor = '#19191e';
            mesh.userData.dialogTextColor = '#ffffff';
            mesh.userData.dialogAccentColor = '#eb7b33';
            mesh.userData.dialogFont = "'Segoe UI', sans-serif";
            mesh.userData.dialogAvatar = null;
            mesh.userData.isTrigger = true;
        }

        if (type === 'Collision') {
            mesh.userData.actionType = 'restart';
            mesh.userData.actionValue = '';
            mesh.userData.oneShot = true;
            mesh.userData.isTrigger = true;
        }

        if (type === 'Enemy') {
            mesh.userData.hp = 3;
            mesh.userData.moveStyle = 'forward';
            mesh.userData.speed = 2.0;
            mesh.userData.patrolRange = 3.0;
            mesh.userData.hasPhysics = false;
            mesh.userData.isTrigger = true;
            mesh.userData.canStomp = true;

            const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 1.5, 0xff0000);
            arrow.name = 'ArrowHelper';
            mesh.add(arrow);
        }

        if (type === 'Catcher') {
            mesh.userData.type = 'catcher_base';
            mesh.userData.id = 'catcher_' + Date.now();
            mesh.userData.filterType = 'all';
            mesh.userData.filterTag = '';
            mesh.userData.isTrigger = true;
        }

        this.addObject(mesh);
        this.app.ui.rebuildLibrary();
        this.updateLinks();
    }

    addCamera() {
        const camObj = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1), new THREE.MeshBasicMaterial({ color: 0x555555, wireframe: true }));
        camObj.name = "Main Camera";
        camObj.userData = { isCamera: true, fov: 60, type: '8WAY' };
        camObj.add(new THREE.PerspectiveCamera(60, 1, 0.1, 100));
        this.addObject(camObj);
    }

    addCatcherTarget() {
        const base = this.selected;
        if (!base || base.userData.type !== 'catcher_base') return;

        const geo = new THREE.PlaneGeometry(1, 1);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({ color: 0xaa00ff, side: THREE.DoubleSide });
        const target = new THREE.Mesh(geo, mat);

        target.name = "Catcher Target";
        target.userData = {
            isAsset: true,
            type: 'catcher_target',
            parentId: base.userData.id,
            isTrigger: true
        };
        target.position.copy(base.position).add(new THREE.Vector3(5, 0, 0));

        const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 1.5, 0xffff00);
        arrow.name = 'ArrowHelper';
        target.add(arrow);

        this.addObject(target);
        this.app.ui.rebuildLibrary();
        this.updateLinks();
    }

    updateLinks() {
        this.linkGroup.clear();

        const bases = this.objects.filter(o => o.userData.type === 'catcher_base');
        const tops = this.objects.filter(o => o.userData.type === 'catcher_target');

        tops.forEach(top => {
            const base = bases.find(b => b.userData.id === top.userData.parentId);
            if (base) {
                const dir = new THREE.Vector3().subVectors(top.position, base.position);
                const len = dir.length();
                if (len > 0) {
                    dir.normalize();
                    const arrow = new THREE.ArrowHelper(dir, base.position, len, 0xaa00ff, 0.5, 0.3);
                    this.linkGroup.add(arrow);
                }
            }
        });
    }

    duplicateObject(source, clientX, clientY) {
        let clone;
        try {
            clone = SkeletonUtils.clone(source);
        } catch (e) {
            clone = source.clone();
        }
        clone.userData = JSON.parse(JSON.stringify(source.userData));
        if (source.animations) clone.animations = source.animations;

        const rect = this.app.sceneManager.viewport.getBoundingClientRect();
        this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.app.sceneManager.camera);

        const targets = this.app.sceneManager.scene.children.filter(o => {
            if (o.userData.isHelper || o.userData.isCamera || o.userData.type === 'SplatEnv') return false;
            if (o.type.includes('Light') || o.type.includes('Camera') || o.type === 'GridHelper' || o.type === 'TransformControls') return false;
            return true;
        });

        const hits = this.raycaster.intersectObjects(targets, true);
        let pos = new THREE.Vector3(0, 0, 0);
        if (hits.length > 0) pos.copy(hits[0].point);
        else this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pos);

        if (clone.userData.isPlayer) {
            pos.y += 1;
        } else if (clone.userData.type !== 'Model') {
            let heightOffset = 0.5;
            if (clone.geometry && clone.geometry.parameters) {
                const p = clone.geometry.parameters;
                if (p.height) heightOffset = p.height / 2;
                else if (p.radius) heightOffset = p.radius;
            }
            pos.y += heightOffset;
        }
        clone.position.copy(pos);

        const match = source.name.match(/^(.*?)[\._]?(\d+)$/);
        if (match) {
            const prefix = match[1];
            const num = parseInt(match[2]) + 1;
            const padding = Math.max(match[2].length, 3);
            clone.name = `${prefix}.${num.toString().padStart(padding, '0')}`;
        } else {
            clone.name = source.name + ".001";
        }

        const oldArrow = clone.getObjectByName('ArrowHelper');
        if (oldArrow) clone.remove(oldArrow);

        if (clone.userData.type === 'Enemy') {
            const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 1.5, 0xff0000);
            arrow.name = 'ArrowHelper';
            clone.add(arrow);
        }

        this.addObject(clone);
        this.app.ui.rebuildLibrary();
    }

    // ====== LEVEL MANAGEMENT ======

    /** Serialize current scene to JSON string */
    getLevelSerializedData() {
        const data = {
            scene: this.objects.map(o => {
                const objData = { name: o.name, p: o.position.toArray(), r: o.rotation.toArray(), s: o.scale.toArray(), userData: o.userData };
                const model = o.getObjectByName('model');
                if (model) {
                    objData.modelOffset = model.position.toArray();
                    objData.modelRotation = model.rotation.toArray();
                    objData.modelScale = model.scale.toArray();
                }
                if (o.geometry?.parameters) {
                    const p = o.geometry.parameters;
                    objData.geo = { radius: p.radius, height: p.height !== undefined ? p.height : p.length, width: p.width, depth: p.depth };
                }
                return objData;
            }),
            library: this.app.ui.library || []
        };
        return JSON.stringify(data);
    }

    /** Save current scene as a new level slot */
    saveCurrentAsLevel(name) {
        const levelName = name || `Level ${this.levels.length + 1}`;
        const serialized = this.getLevelSerializedData();
        this.levels.push({ name: levelName, data: serialized, music: '' });
        this.currentLevelIndex = this.levels.length - 1;
        if (this.app.ui.renderLevelList) this.app.ui.renderLevelList();
    }

    /** Update an existing level slot with current scene */
    updateLevel(index) {
        if (index < 0 || index >= this.levels.length) return;
        this.levels[index].data = this.getLevelSerializedData();
        if (this.app.ui.renderLevelList) this.app.ui.renderLevelList();
    }

    /** Load a level by index into the editor */
    loadLevelByIndex(index) {
        if (index < 0 || index >= this.levels.length) {
            console.warn('Level index out of range:', index);
            return;
        }
        const level = this.levels[index];
        try {
            const rootData = JSON.parse(level.data);
            const sceneData = rootData.scene || rootData;
            this.clearScene();
            if (this.app.ui.restoreLibrary) this.app.ui.restoreLibrary(rootData.library || []);
            this._restoreSceneData(sceneData);
            this.currentLevelIndex = index;
            if (this.app.ui.renderLevelList) this.app.ui.renderLevelList();
            this.app.ui.rebuildLibrary();
            this.app.ui.update();
            this.updateLinks();
        } catch (err) { console.error('Error loading level:', err); }
    }

    /** Internal: restore scene from data array */
    _restoreSceneData(sceneData) {
        const promises = [];
        sceneData.forEach((d) => {
            let obj;
            const uData = d.userData || {};
            if (!uData.isPlayer && (uData.type === 'Player' || uData.typology)) uData.isPlayer = true;
            if (!uData.isCamera && d.name.includes("Camera")) uData.isCamera = true;

            if (uData.isPlayer) {
                const r = d.geo?.radius || 0.5, h = d.geo?.height || 1.0;
                obj = new THREE.Mesh(new THREE.CapsuleGeometry(r, h, 4, 8), new THREE.MeshStandardMaterial({ color: 0x4caf50, transparent: true, opacity: 0.5, wireframe: true }));
            } else if (uData.isCamera) {
                obj = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1), new THREE.MeshBasicMaterial({ color: 0x555555, wireframe: true }));
                obj.add(new THREE.PerspectiveCamera(uData.fov || 60, 1, 0.1, 100));
            } else if (uData.isAsset) {
                const type = uData.type;
                if (type === 'Model') {
                    obj = new THREE.Group();
                } else if (type === 'SplatEnv') {
                    obj = new THREE.Group();
                } else {
                    let geo, mat = new THREE.MeshStandardMaterial({ color: 0x888888, wireframe: true, transparent: true, opacity: 0.5 });
                    let isLight = false;
                    switch (type) {
                        case 'Enemy': {
                            const ew = (d.geo && d.geo.width !== undefined) ? d.geo.width : 0.8;
                            const eh = (d.geo && d.geo.height !== undefined) ? d.geo.height : 0.8;
                            const ed = (d.geo && d.geo.depth !== undefined) ? d.geo.depth : 0.8;
                            geo = new THREE.BoxGeometry(ew, eh, ed); mat.color.setHex(0xff6600); break;
                        }
                        case 'Bonus': {
                            const radius = uData.radius || 0.4;
                            geo = new THREE.SphereGeometry(radius); mat.color.setHex(0xFFD700); break;
                        }
                        case 'Boss': geo = new THREE.BoxGeometry(1.5, 1.5, 1.5); mat.color.setHex(0xcc0000); break;
                        case 'Catcher': geo = new THREE.CylinderGeometry(0.5, 0.5, 0.2); mat.color.setHex(0x5500aa); break;
                        case 'catcher_target':
                            geo = new THREE.PlaneGeometry(1, 1);
                            geo.rotateX(-Math.PI / 2);
                            mat.color.setHex(0xaa00ff);
                            mat.side = THREE.DoubleSide;
                            break;
                        case 'Spawn': geo = new THREE.ConeGeometry(0.5, 1, 4); mat.color.setHex(0xaa5500); break;
                        case 'Goal': geo = new THREE.BoxGeometry(1, 0.1, 1); mat.color.setHex(0xD4AF37); break;
                        case 'PowerUp':
                            geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
                            mat.color.setHex(0x00cccc);
                            uData.isAsset = true;
                            break;
                        case 'Analyze':
                            geo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
                            mat = new THREE.MeshBasicMaterial({ color: 0x33cccc, wireframe: true, transparent: true, opacity: 0.8 });
                            break;
                        case 'Dialog':
                            geo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
                            mat = new THREE.MeshBasicMaterial({ color: 0x7733cc, wireframe: true, transparent: true, opacity: 0.8 });
                            break;
                        case 'Collision': {
                            const cw = (d.geo && d.geo.width !== undefined) ? d.geo.width : 1.0;
                            const ch = (d.geo && d.geo.height !== undefined) ? d.geo.height : 1.0;
                            const cd = (d.geo && d.geo.depth !== undefined) ? d.geo.depth : 1.0;
                            geo = new THREE.BoxGeometry(cw, ch, cd);
                            mat = new THREE.MeshBasicMaterial({ color: 0x22ff22, wireframe: true, transparent: true, opacity: 0.3 }); break;
                        }
                        case 'PointLight': geo = new THREE.SphereGeometry(0.2); mat = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true }); isLight = true; break;
                        case 'SpotLight': geo = new THREE.ConeGeometry(0.2, 0.5, 4); mat = new THREE.MeshBasicMaterial({ color: 0xffffaa, wireframe: true }); isLight = true; break;
                        case 'DirectionalLight': geo = new THREE.BoxGeometry(0.4, 0.4, 0.4); mat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }); isLight = true; break;
                        default: geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
                    }
                    obj = new THREE.Mesh(geo, mat);
                    if (isLight) {
                        obj.castShadow = false; obj.receiveShadow = false;
                        let lightObj;
                        const shadowsEnabled = this.app.sceneManager?.renderer?.shadowMap?.enabled || false;
                        const lColor = uData.color !== undefined ? uData.color : mat.color.getHex();
                        const lIntensity = uData.intensity !== undefined ? uData.intensity : 1.0;
                        const lDistance = uData.distance !== undefined ? uData.distance : 10;
                        if (type === 'PointLight') { lightObj = new THREE.PointLight(lColor, lIntensity, lDistance); }
                        else if (type === 'SpotLight') { const lAngle = uData.angle !== undefined ? uData.angle : Math.PI / 4; const lPenumbra = uData.penumbra !== undefined ? uData.penumbra : 0.5; lightObj = new THREE.SpotLight(lColor, lIntensity, lDistance, lAngle, lPenumbra, 1); lightObj.target.position.set(0, -1, 0); obj.add(lightObj.target); }
                        else if (type === 'DirectionalLight') { lightObj = new THREE.DirectionalLight(lColor, lIntensity); }
                        if (lightObj) {
                            lightObj.name = 'light_source';
                            lightObj.castShadow = uData.castShadow !== undefined ? uData.castShadow && shadowsEnabled : shadowsEnabled;
                            lightObj.shadow.mapSize.width = uData.shadowRes !== undefined ? uData.shadowRes : 1024;
                            lightObj.shadow.mapSize.height = uData.shadowRes !== undefined ? uData.shadowRes : 1024;
                            lightObj.shadow.bias = uData.shadowBias !== undefined ? uData.shadowBias : -0.001;
                            lightObj.shadow.normalBias = uData.shadowNormalBias !== undefined ? uData.shadowNormalBias : 0;
                            lightObj.shadow.radius = uData.shadowRadius !== undefined ? uData.shadowRadius : 1;
                            lightObj.shadow.camera.near = uData.shadowCamNear !== undefined ? uData.shadowCamNear : 0.5;
                            lightObj.shadow.camera.far = uData.shadowCamFar !== undefined ? uData.shadowCamFar : 500;
                            if (type === 'DirectionalLight') { const cSize = uData.shadowCamSize || 10; lightObj.shadow.camera.left = -cSize; lightObj.shadow.camera.right = cSize; lightObj.shadow.camera.top = cSize; lightObj.shadow.camera.bottom = -cSize; }
                            obj.add(lightObj);
                        }
                    }
                }
            } else obj = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x888888 }));

            obj.name = d.name; obj.position.fromArray(d.p); obj.rotation.fromArray(d.r); obj.scale.fromArray(d.s);
            obj.userData = uData;
            if (d.modelOffset) obj.userData.modelOffset = d.modelOffset;
            if (d.modelRotation) obj.userData.modelRotation = d.modelRotation;
            if (d.modelScale) obj.userData.modelScale = d.modelScale;

            if (obj.userData.type === 'Enemy') { const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 1.5, 0xff0000); arrow.name = 'ArrowHelper'; obj.add(arrow); }
            else if (obj.userData.type === 'catcher_target') { const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 1.5, 0xffff00); arrow.name = 'ArrowHelper'; obj.add(arrow); }

            this.objects.push(obj); this.app.sceneManager.scene.add(obj);

            if (obj.userData.type === 'SplatEnv' && obj.userData.splatSource) {
                this.reloadSplat(obj);
            } else if (obj.userData.glbSource) {
                promises.push(this.reloadModel(obj, obj.userData.glbSource, (m) => {
                    if (this.selected === obj && obj.userData.isPlayer) this.app.ui.generateThumbnail(m, 'glb-preview-img');
                }));
            }
        });
        this.updateSplatMode();
        return promises;
    }

    saveProject() {
        // Sync current active level before saving project file
        if (this.currentLevelIndex >= 0) {
            this.updateLevel(this.currentLevelIndex);
        }

        const data = {
            scene: this.objects.map(o => {
                const objData = { name: o.name, p: o.position.toArray(), r: o.rotation.toArray(), s: o.scale.toArray(), userData: o.userData };
                const model = o.getObjectByName('model');
                if (model) {
                    objData.modelOffset = model.position.toArray();
                    objData.modelRotation = model.rotation.toArray();
                    objData.modelScale = model.scale.toArray();
                }
                if (o.geometry?.parameters) {
                    const p = o.geometry.parameters;
                    objData.geo = { radius: p.radius, height: p.height !== undefined ? p.height : p.length, width: p.width, depth: p.depth };
                }
                return objData;
            }),
            library: this.app.ui.library || [],
            levels: this.levels || [],
            gameTitle: this.gameTitle || 'Web 3D Game',
            gameSplashSubtitle: this.gameSplashSubtitle || '3D Editor Engine',
            gameSplashImage: this.gameSplashImage || null,
            gameSplashPromptBg: this.gameSplashPromptBg || 'rgba(255,255,255,0.1)',
            gameSplashPromptColor: this.gameSplashPromptColor || '#ffffff',
            gameSplashMusic: this.gameSplashMusic || null,
            gameSplashMusicFilename: this.gameSplashMusicFilename || '',
            currentLevelIndex: this.currentLevelIndex,
            startingLevelIndex: this.startingLevelIndex,
            gameEndTitle: this.gameEndTitle || '',
            gameEndSubtitle: this.gameEndSubtitle || '',
            gameEndImage: this.gameEndImage || null,
            gameEndVideo: this.gameEndVideo || null,
            gameEndVideoAspect: this.gameEndVideoAspect || 'cover',
            gameEndMusic: this.gameEndMusic || null,
            gameEndMusicFilename: this.gameEndMusicFilename || ''
        };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
        a.download = 'project.json'; a.click();
    }

    loadProject(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const rootData = JSON.parse(e.target.result);
                const sceneData = rootData.scene || rootData;
                this.clearScene();
                if (this.app.ui.restoreLibrary) this.app.ui.restoreLibrary(rootData.library || []);

                // Restore levels
                this.levels = rootData.levels || [];
                this.currentLevelIndex = (rootData.currentLevelIndex !== undefined) ? rootData.currentLevelIndex : -1;
                this.gameTitle = rootData.gameTitle || 'Web 3D Game';
                this.gameSplashSubtitle = rootData.gameSplashSubtitle || '3D Editor Engine';
                this.gameSplashImage = rootData.gameSplashImage || null;
                this.gameSplashPromptBg = rootData.gameSplashPromptBg || 'rgba(255,255,255,0.1)';
                this.gameSplashPromptColor = rootData.gameSplashPromptColor || '#ffffff';
                this.gameSplashMusic = rootData.gameSplashMusic || null;
                this.gameSplashMusicFilename = rootData.gameSplashMusicFilename || '';
                this.startingLevelIndex = rootData.startingLevelIndex !== undefined ? rootData.startingLevelIndex : 0;
                this.gameEndTitle = rootData.gameEndTitle || '';
                this.gameEndSubtitle = rootData.gameEndSubtitle || '';
                this.gameEndImage = rootData.gameEndImage || null;
                this.gameEndVideo = rootData.gameEndVideo || null;
                this.gameEndVideoAspect = rootData.gameEndVideoAspect || 'cover';
                this.gameEndMusic = rootData.gameEndMusic || null;
                this.gameEndMusicFilename = rootData.gameEndMusicFilename || '';
                if (this.app.ui.renderLevelList) this.app.ui.renderLevelList();

                // Ensure Player is always the first asset in the library
                const playerExists = this.app.ui.library.find(item => item.type === 'Player');
                if (!playerExists) {
                    this.app.ui.createAssetCard('Player', 'Player', null, true);
                    const last = this.app.ui.library.pop();
                    this.app.ui.library.unshift(last);
                    this.app.ui.restoreLibrary(this.app.ui.library);
                }

                const promises = this._restoreSceneData(sceneData);
                await Promise.all(promises);

                this.app.ui.rebuildLibrary();
                this.app.ui.update();
                this.updateLinks();
            } catch (err) { console.error(err); }
        };
        reader.readAsText(file);
    }

    _dataUrlToBlobUrl(dataUrl) {
        const arr = dataUrl.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        const n = bstr.length;
        const u8arr = new Uint8Array(n);
        for (let i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
        return URL.createObjectURL(new Blob([u8arr], { type: mime }));
    }

    reloadSplat(obj) {
        if (!obj || !obj.userData.splatSource) return;
        const old = obj.getObjectByName('splatMesh');
        if (old) obj.remove(old);
        try {
            const blobUrl = this._dataUrlToBlobUrl(obj.userData.splatSource);
            const sm = new SplatMesh({
                url: blobUrl,
                renderer: this.app.sceneManager.renderer,
                camera: this.app.sceneManager.camera
            });
            sm.name = 'splatMesh';
            sm.quaternion.set(1, 0, 0, 0);
            sm.frustumCulled = false;
            obj.add(sm);
            console.log('[SplatEnv] reloadSplat OK');
        } catch (err) {
            console.warn('[SplatEnv] reloadSplat failed:', err);
        }
    }

    updateMaterialSettings(obj) {
        if (!obj) return;
        const alphaMode = obj.userData.alphaMode || 'mask';
        const alphaTest = obj.userData.alphaTest !== undefined ? obj.userData.alphaTest : 0.5;
        const doubleSide = obj.userData.doubleSide !== undefined ? obj.userData.doubleSide : true;

        obj.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.transparent = (alphaMode !== 'opaque');
                if (alphaMode === 'mask') {
                    child.material.alphaTest = alphaTest;
                    child.material.depthWrite = true;
                } else if (alphaMode === 'blend') {
                    child.material.alphaTest = 0;
                    child.material.depthWrite = false;
                } else {
                    child.material.alphaTest = 0;
                    child.material.depthWrite = true;
                }
                child.material.side = doubleSide ? THREE.DoubleSide : THREE.FrontSide;
                child.material.needsUpdate = true;
            }
        });
    }

    clearScene() {
        this.select(null);
        if (this.gizmo) this.gizmo.detach();

        const toRemove = [];
        this.app.sceneManager.scene.traverse((child) => {
            if (child.userData && child.userData.isAsset) toRemove.push(child);
            if (child.name === 'ArrowHelper') toRemove.push(child);
        });
        
        toRemove.forEach(o => {
            if (o.parent) o.parent.remove(o);
        });

        this.objects.forEach(o => {
            if (o.parent) o.parent.remove(o);
        });

        if (this.linkGroup) this.linkGroup.clear();

        this.objects = [];
        this.history = [];
        this.hIndex = -1;

        this.app.sceneManager.scene.children.forEach(c => {
            if (c.type === 'GridHelper') c.visible = true;
        });

        this.app.ui.update();
    }

    setupInitialDefaultScene() {
        this.clearScene();
        this.addCamera();
        const player = PlayerFactory.createPlayer(this.objects.length);
        player.position.set(0, 1, 0);
        this.addObject(player);
        this.app.ui.rebuildLibrary();
        this.app.ui.update();
    }

    async loadLevelByIndex(index) {
        if (index < 0 || index >= this.levels.length) return;
        this.currentLevelIndex = index;
        const level = this.levels[index];
        this.clearScene();

        let sceneData = level.data;
        try {
            if (typeof sceneData === 'string') {
                const parsed = JSON.parse(sceneData);
                sceneData = parsed.scene || parsed;
            } else if (sceneData && sceneData.scene) {
                sceneData = sceneData.scene;
            }
        } catch (e) {
            console.error("Malformed level data", e);
            sceneData = [];
        }

        const promises = this._restoreSceneData(sceneData);
        await Promise.all(promises);

        if (this.app.ui.renderLevelList) this.app.ui.renderLevelList();
        this.app.ui.rebuildLibrary();
        this.app.ui.update();
        if (this.updateLinks) this.updateLinks();
    }

    /**
     * Import an external JSON file as a new level (or multiple levels).
     * Supports:
     *   - Full project JSON (with .levels[] array) → imports all levels
     *   - Single-scene JSON (with .scene[] or array root) → adds as one new level
     */
    importLevelFromJSON(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const rootData = JSON.parse(e.target.result);

                // Case 1: It's a full project with multiple levels
                if (Array.isArray(rootData.levels) && rootData.levels.length > 0) {
                    const baseName = file.name.replace(/\.json$/i, '');
                    const startIdx = this.levels.length;
                    rootData.levels.forEach((lvl, i) => {
                        this.levels.push({
                            name: lvl.name || `${baseName} – ${i + 1}`,
                            data: typeof lvl.data === 'string' ? lvl.data : JSON.stringify(lvl.data),
                            music: lvl.music || '',
                            musicFilename: lvl.musicFilename || ''
                        });
                    });
                    if (this.app.ui.renderLevelList) this.app.ui.renderLevelList();
                    console.log(`Importati ${rootData.levels.length} livelli da "${file.name}"`);
                    return;
                }

                // Case 2: Single-scene JSON
                const sceneData = rootData.scene || rootData;
                const name = file.name.replace(/\.json$/i, '') || `Level ${this.levels.length + 1}`;

                // Build the level payload: keep the library if present
                const payload = {
                    scene: Array.isArray(sceneData) ? sceneData : [],
                    library: rootData.library || []
                };

                this.levels.push({
                    name: name,
                    data: JSON.stringify(payload),
                    music: '',
                    musicFilename: ''
                });

                if (this.app.ui.renderLevelList) this.app.ui.renderLevelList();
                console.log(`Livello importato: "${name}" (${payload.scene.length} oggetti)`);

            } catch (err) {
                console.error('Errore nel parsing del JSON livello:', err);
                alert('Errore: file JSON non valido.');
            }
        };
        reader.readAsText(file);
    }
}
