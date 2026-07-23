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
        this.selectedObjects = [];
        this.selectionGroup = null;
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
        this.gameAmbientColor = '#ffffff';
        this.gameAmbientIntensity = 1.5;
        // Viewport Grid defaults
        this.gridSize = 40;
        this.gridDivisions = 40;
        this.gridCenterColor = '#555555';
        this.gridColor = '#888888';
        // Primary Post Processing defaults
        this.gamePixelEffect = false;
        this.gamePixelSize = 6;
        this.gameBloomEffect = false;
        this.gameBloomStrength = 1.5;
        this.gameBloomRadius = 0.4;
        this.gameCyberpunkEffect = false;
        this.gameCyberpunkAberration = 0.004;
        this.gameCyberpunkScanlines = 0.2;
        this.setupBlenderSync();
    }

    init() {
        const { camera, renderer, viewport } = this.app.sceneManager;

        this.orbit = new OrbitControls(camera, renderer.domElement);
        this.gizmo = new TransformControls(camera, renderer.domElement);
        this.gizmo.size = 0.5;
        const helper = this.gizmo.getHelper();
        helper.userData.isHelper = true;
        helper.name = 'TransformControlsGizmo';

        this.gizmo.setTranslationSnap(null);
        this.gizmo.setRotationSnap(null);
        this.gizmo.setScaleSnap(null);

        this.app.sceneManager.scene.add(helper);

        this.gizmoPivot = new THREE.Object3D();
        this.app.sceneManager.scene.add(this.gizmoPivot);
        this.gizmoCentered = false;

        this.linkGroup = new THREE.Group();
        this.app.sceneManager.scene.add(this.linkGroup);

        this.addCamera();

        this.gizmo.addEventListener('change', () => {
            if (this.selected && this.gizmoCentered && this.pivotInitialPos) {
                const deltaPos = new THREE.Vector3().subVectors(this.gizmoPivot.position, this.pivotInitialPos);
                this.selected.position.copy(this.actorInitialPos).add(deltaPos);
                this.selected.rotation.copy(this.gizmoPivot.rotation);
                this.selected.scale.copy(this.gizmoPivot.scale);
            }
            this.updateLinks();
            if (this.app.sceneManager) {
                this.app.sceneManager.resetPathTracing();
            }
        });

        let transformStartData = null;
        this.gizmo.addEventListener('dragging-changed', (e) => {
            this.orbit.enabled = !e.value;
            if (e.value) {
                if (this.selected) {
                    if (this.gizmoCentered) {
                        this.pivotInitialPos = this.gizmoPivot.position.clone();
                        this.actorInitialPos = this.selected.position.clone();
                        this.pivotInitialRot = this.gizmoPivot.rotation.clone();
                        this.actorInitialRot = this.selected.rotation.clone();
                        this.pivotInitialScl = this.gizmoPivot.scale.clone();
                        this.actorInitialScl = this.selected.scale.clone();
                    } else {
                        transformStartData = {
                            p: this.gizmo.object.position.clone(),
                            r: this.gizmo.object.rotation.clone(),
                            s: this.gizmo.object.scale.clone()
                        };
                    }
                }
            } else {
                if (this.selected && this.gizmoCentered) {
                    this.executeAction({
                        type: 'transform',
                        object: this.selected,
                        from: { p: this.actorInitialPos.clone(), r: this.actorInitialRot.clone(), s: this.actorInitialScl.clone() },
                        to: { p: this.selected.position.clone(), r: this.selected.rotation.clone(), s: this.selected.scale.clone() }
                    });
                } else if (this.gizmo.object && transformStartData && !Array.isArray(transformStartData)) {
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
                if (this.app.sceneManager) {
                    this.app.sceneManager.updateEnvironmentMap();
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

        // Se non ci sono livelli inizializzati, crea il primo livello vuoto con il Player
        setTimeout(() => {
            if (!Array.isArray(this.levels)) this.levels = [];
            if (!Array.isArray(this.objects)) this.objects = [];
            if (this.levels.length === 0) {
                this.levels.push({
                    name: "Level 1",
                    data: "[]",
                    music: "",
                    musicFilename: ""
                });
                this.currentLevelIndex = 0;
            }
            if (this.objects.length === 0) {
                this.setupInitialDefaultScene();
            }
            if (this.app.ui && this.app.ui.renderLevelList) this.app.ui.renderLevelList();
        }, 150);
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
        } else if (action.type === 'multi_transform') {
            action.actions.forEach(act => {
                const data = isUndo ? act.from : act.to;
                act.object.position.copy(data.p);
                act.object.rotation.copy(data.r);
                act.object.scale.copy(data.s);
            });
        } else if (action.type === 'delete') {
            if (isUndo) {
                // Restore deleted objects. Sort items by index ascending to insert correctly.
                const sorted = [...action.items].sort((a, b) => a.index - b.index);
                sorted.forEach(item => {
                    if (item.index > -1) {
                        this.objects.splice(item.index, 0, item.object);
                    } else {
                        this.objects.push(item.object);
                    }
                    if (item.parent) {
                        item.parent.add(item.object);
                    } else {
                        this.app.sceneManager.scene.add(item.object);
                    }
                });
                if (action.items.length > 0) {
                    if (action.items.length === 1) {
                        this.select(action.items[0].object);
                    } else {
                        this.selectedObjects = action.items.map(item => item.object);
                        this.select(action.items[0].object);
                    }
                }
            } else {
                // Redo deletion
                action.items.forEach(item => {
                    if (item.parent) item.parent.remove(item.object);
                    else this.app.sceneManager.scene.remove(item.object);
                    const idx = this.objects.indexOf(item.object);
                    if (idx > -1) this.objects.splice(idx, 1);
                });
                this.gizmo.detach();
                this.selected = null;
                this.selectedObjects = [];
            }
            this.app.ui.rebuildLibrary();
            this.updateSplatMode();
        } else if (action.type === 'add') {
            if (isUndo) {
                // Remove added object
                if (action.object.parent) action.object.parent.remove(action.object);
                else this.app.sceneManager.scene.remove(action.object);
                const idx = this.objects.indexOf(action.object);
                if (idx > -1) this.objects.splice(idx, 1);
                this.gizmo.detach();
                this.selected = null;
                this.selectedObjects = [];
            } else {
                // Re-add object
                this.objects.push(action.object);
                this.app.sceneManager.scene.add(action.object);
                this.select(action.object);
            }
            this.app.ui.rebuildLibrary();
            this.updateSplatMode();
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
        const pos = new THREE.Vector3();
        this.selected.getWorldPosition(pos);
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
            let root = target;
            while (root && !this.objects.includes(root) && root.parent) {
                root = root.parent;
            }
            if (root && this.objects.includes(root)) {
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

            if (this.gizmoCentered && !this.gizmo.dragging) {
                const dir = new THREE.Vector3();
                this.app.sceneManager.camera.getWorldDirection(dir);
                this.gizmoPivot.position.copy(this.app.sceneManager.camera.position).addScaledVector(dir, 8);
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
        this.selectedObjects = obj ? [obj] : [];
        this.updateSelectionGroup();

        this.selected = obj;
        if (obj) {
            if (this.gizmoCentered) {
                const dir = new THREE.Vector3();
                this.app.sceneManager.camera.getWorldDirection(dir);
                this.gizmoPivot.position.copy(this.app.sceneManager.camera.position).addScaledVector(dir, 8);
                this.gizmoPivot.rotation.copy(obj.rotation);
                this.gizmoPivot.scale.copy(obj.scale);
                this.gizmo.attach(this.gizmoPivot);
            } else {
                this.gizmo.attach(obj);
            }
            this.gizmo.showX = true;
            this.gizmo.showY = true;
            this.gizmo.showZ = true;
        } else {
            this.gizmo.detach();
        }
        this.setupMixer(obj);
        this.app.ui.update();
    }

    selectMulti(obj, shiftKey, ctrlKey) {
        if (!obj) {
            this.select(null);
            return;
        }

        if (ctrlKey) {
            const idx = this.selectedObjects.indexOf(obj);
            if (idx > -1) {
                this.selectedObjects.splice(idx, 1);
            } else {
                this.selectedObjects.push(obj);
            }
        } else if (shiftKey) {
            const lastSelected = this.selected;
            const lastIdx = this.objects.indexOf(lastSelected);
            const clickIdx = this.objects.indexOf(obj);
            if (lastIdx > -1 && clickIdx > -1) {
                const start = Math.min(lastIdx, clickIdx);
                const end = Math.max(lastIdx, clickIdx);
                for (let i = start; i <= end; i++) {
                    const target = this.objects[i];
                    if (!this.selectedObjects.includes(target)) {
                        this.selectedObjects.push(target);
                    }
                }
            } else {
                this.selectedObjects = [obj];
            }
        } else {
            this.selectedObjects = [obj];
        }

        this.selected = this.selectedObjects.length > 0 ? this.selectedObjects[this.selectedObjects.length - 1] : null;

        this.updateSelectionGroup();

        if (this.selectedObjects.length === 0) {
            this.gizmo.detach();
        } else if (this.selectedObjects.length === 1) {
            this.gizmo.attach(this.selected);
            this.gizmo.showX = true;
            this.gizmo.showY = true;
            this.gizmo.showZ = true;
        }

        this.setupMixer(this.selected);
        this.app.ui.update();
    }

    updateSelectionGroup() {
        if (this.selectionGroup) {
            this.gizmo.detach();
            const tempChildren = [...this.selectionGroup.children];
            tempChildren.forEach(child => {
                this.app.sceneManager.scene.attach(child);
            });
            this.app.sceneManager.scene.remove(this.selectionGroup);
            this.selectionGroup = null;
        }

        if (this.selectedObjects && this.selectedObjects.length > 1) {
            this.selectionGroup = new THREE.Group();
            this.selectionGroup.name = "TempSelectionGroup";

            const center = new THREE.Vector3();
            this.selectedObjects.forEach(obj => {
                const pos = new THREE.Vector3();
                obj.getWorldPosition(pos);
                center.add(pos);
            });
            center.divideScalar(this.selectedObjects.length);

            this.selectionGroup.position.copy(center);
            this.app.sceneManager.scene.add(this.selectionGroup);

            this.selectedObjects.forEach(obj => {
                this.selectionGroup.attach(obj);
            });

            this.gizmo.attach(this.selectionGroup);
            this.gizmo.showX = true;
            this.gizmo.showY = true;
            this.gizmo.showZ = true;
        }
    }

    setRotationSnap(enabled) {
        this.gizmo.setRotationSnap(enabled ? THREE.MathUtils.degToRad(15) : null);
    }

    setTranslationSnap(enabled) {
        this.gizmo.setTranslationSnap(enabled ? 1.0 : null);
    }

    setScaleSnap(enabled) {
        this.gizmo.setScaleSnap(enabled ? 0.25 : null);
    }

    toggleGizmoCenter() {
        this.gizmoCentered = !this.gizmoCentered;
        this.gizmo.detach();
        if (this.selected) {
            if (this.gizmoCentered) {
                const dir = new THREE.Vector3();
                this.app.sceneManager.camera.getWorldDirection(dir);
                this.gizmoPivot.position.copy(this.app.sceneManager.camera.position).addScaledVector(dir, 8);
                this.gizmoPivot.rotation.copy(this.selected.rotation);
                this.gizmoPivot.scale.copy(this.selected.scale);
                this.gizmo.attach(this.gizmoPivot);
            } else {
                this.gizmo.attach(this.selected);
            }
        }
    }

    deleteSelected() {
        const deletedActions = [];

        if (this.selectedObjects && this.selectedObjects.length > 0) {
            const list = [...this.selectedObjects];
            if (this.selectionGroup) {
                this.gizmo.detach();
                this.app.sceneManager.scene.remove(this.selectionGroup);
                this.selectionGroup = null;
            }
            list.forEach(o => {
                const parent = o.parent;
                const idx = this.objects.indexOf(o);
                deletedActions.push({
                    object: o,
                    parent: parent,
                    index: idx
                });
                if (parent) parent.remove(o);
                else this.app.sceneManager.scene.remove(o);
                if (idx > -1) this.objects.splice(idx, 1);
            });
            this.gizmo.detach();
            this.selected = null;
            this.selectedObjects = [];
        } else if (this.selected) {
            const o = this.selected;
            const parent = o.parent;
            const idx = this.objects.indexOf(o);
            deletedActions.push({
                object: o,
                parent: parent,
                index: idx
            });
            if (parent) parent.remove(o);
            else this.app.sceneManager.scene.remove(o);
            if (idx > -1) this.objects.splice(idx, 1);
            this.gizmo.detach();
            this.selected = null;
        }

        if (deletedActions.length > 0) {
            this.executeAction({
                type: 'delete',
                items: deletedActions
            });
        }

        this.app.ui.rebuildLibrary();
        this.app.ui.update();
        this.updateSplatMode();
    }

    addObject(obj, record = true) {
        this.objects.push(obj);
        this.app.sceneManager.scene.add(obj);
        this.select(obj);
        this.updateSplatMode();

        if (record) {
            this.executeAction({
                type: 'add',
                object: obj
            });
        }
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
            this.updateMaterialSettings(this.selected);

            this.setupMixer(this.selected);
            this.app.ui.update();
            if (onLoaded) onLoaded(m);
        });
    }

    reloadModel(obj, url, onLoaded) {
        return new Promise((resolve) => {
            if (!url) {
                resolve(null);
                return;
            }

            const isImage = typeof url === 'string' && (url.startsWith('data:image/') || url.match(/\.(png|jpg|jpeg)$/i));
            if (isImage) {
                let fetchUrl = url;
                if (typeof url === 'string' && !url.startsWith('data:')) {
                    fetchUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
                }

                const old = obj.getObjectByName('model');
                if (old) obj.remove(old);

                const textureLoader = new THREE.TextureLoader();
                textureLoader.load(fetchUrl, (texture) => {
                    const image = texture.image;
                    let aspect = 1.0;
                    if (image && image.width && image.height) {
                        aspect = image.width / image.height;
                    }
                    
                    const height = 1.2;
                    const width = height * aspect;
                    const geo = new THREE.PlaneGeometry(width, height);
                    const mat = new THREE.MeshStandardMaterial({
                        map: texture,
                        transparent: true,
                        side: THREE.DoubleSide
                    });
                    
                    const m = new THREE.Mesh(geo, mat);
                    m.name = 'model';
                    
                    if (obj.userData.modelOffset) m.position.fromArray(obj.userData.modelOffset);
                    else m.position.set(0, 0, 0);

                    if (obj.userData.modelRotation) m.rotation.fromArray(obj.userData.modelRotation);
                    if (obj.userData.modelScale) m.scale.fromArray(obj.userData.modelScale);
                    
                    obj.add(m);

                    if (this.selected === obj) {
                        this.app.ui.updateProperties();
                    }
                    if (onLoaded) onLoaded(m);
                    resolve(m);
                }, undefined, (err) => {
                    console.error("Error loading texture", fetchUrl, err);
                    resolve(null);
                });
            } else {
                if (!this._glbPromises) this._glbPromises = new Map();
                
                // Use base url as cache key so all objects in the scene share a single GLB loading Promise!
                let gltfPromise = this._glbPromises.get(url);
                if (!gltfPromise) {
                    let fetchUrl = url;
                    if (typeof url === 'string' && !url.startsWith('data:')) {
                        fetchUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
                    }
                    gltfPromise = new Promise((res, rej) => {
                        this.loader.load(fetchUrl, res, undefined, rej);
                    });
                    this._glbPromises.set(url, gltfPromise);
                }

                gltfPromise.then((gltf) => {
                    if (gltf.scene && typeof gltf.scene.updateMatrixWorld === 'function') {
                        gltf.scene.updateMatrixWorld(true);
                    }

                    const old = obj.getObjectByName('model');
                    if (old) obj.remove(old);

                    // If obj was created as a Mesh with placeholder geometry (e.g. BoxGeometry for Model), clear its geometry and material.
                    // BUT preserve geometry and wireframe material for Triggers (Analyze, Collision, Dialog, etc.) as their collision box.
                    const isTriggerObj = obj.userData.isTrigger || ['Analyze', 'Collision', 'Dialog', 'PowerUp', 'Objective', 'CutScene', 'SoundEffect', 'EmbedHTML', 'Catcher', 'catcher_base'].includes(obj.userData.type);
                    if (!isTriggerObj) {
                        if (obj.geometry) {
                            obj.geometry.dispose();
                            delete obj.geometry;
                        }
                        if (obj.material) {
                            if (Array.isArray(obj.material)) {
                                obj.material.forEach(mat => mat && mat.dispose && mat.dispose());
                            } else if (obj.material.dispose) {
                                obj.material.dispose();
                            }
                            delete obj.material;
                        }
                    }
                    
                    let m;
                    if (obj.userData.glbNodeName) {
                        const nodeName = obj.userData.glbNodeName;
                        const allNames = [];
                        gltf.scene.traverse(c => { if (c.name) allNames.push(c.name); });
                        console.log(`[Editor] reloadModel: loading URL "${url}" for node "${nodeName}". Available nodes in GLB:`, allNames);
                        let targetNode = gltf.scene.getObjectByName(nodeName);
                        if (!targetNode) {
                             // Try sanitized version (dots and spaces replaced by underscores as the glTF exporter does)
                             const sanitized = nodeName.replace(/[\s\.]/g, '_');
                             targetNode = gltf.scene.getObjectByName(sanitized);
                         }
                         if (!targetNode) {
                             // Try version with dots and spaces completely removed
                             const noDots = nodeName.replace(/[\s\.]/g, '');
                             targetNode = gltf.scene.getObjectByName(noDots);
                         }
                         if (!targetNode) {
                             // Traverse fallback for case-insensitive, sanitized, or partial match
                             const searchNameLower = nodeName.toLowerCase();
                             const searchClean = searchNameLower.replace(/[\s\._-]/g, '');
                             gltf.scene.traverse(child => {
                                 if (!targetNode && child.name) {
                                     const cNameLower = child.name.toLowerCase();
                                     const cClean = cNameLower.replace(/[\s\._-]/g, '');
                                     if (cNameLower === searchNameLower || cClean === searchClean || (searchClean.length > 2 && cClean.length > 2 && (cClean.includes(searchClean) || searchClean.includes(cClean)))) {
                                         targetNode = child;
                                     }
                                 }
                             });
                         }
                        
                        if (targetNode) {
                            const hasMesh = targetNode.isMesh || (targetNode.getObjectByProperty && targetNode.getObjectByProperty('isMesh', true));
                            if (hasMesh) {
                                if (targetNode.isMesh && !targetNode.isSkinnedMesh && (!targetNode.children || targetNode.children.length === 0)) {
                                    m = new THREE.Mesh(targetNode.geometry, targetNode.material);
                                } else {
                                    try {
                                        m = SkeletonUtils.clone(targetNode);
                                    } catch (e) {
                                        m = targetNode.clone();
                                    }
                                }
                                obj.updateMatrixWorld(true);
                                const invObjMatrix = obj.matrixWorld.clone().invert();
                                const localMatrix = invObjMatrix.multiply(targetNode.matrixWorld);
                                m.matrix.copy(localMatrix);
                                m.matrix.decompose(m.position, m.quaternion, m.scale);
                                m.rotation.setFromQuaternion(m.quaternion);
                            } else {
                                m = new THREE.Group();
                            }
                        }
                    }
                    if (!m) {
                        if (obj.userData.glbNodeName) {
                            console.warn(`[Editor] Node "${obj.userData.glbNodeName}" not found in GLB. Falling back to full GLB scene.`);
                        }
                        try {
                            m = SkeletonUtils.clone(gltf.scene);
                        } catch (e) {
                            m = gltf.scene.clone();
                        }
                    }
                    m.name = 'model';

                let useSmartOffset = !obj.userData.modelOffset;
                if (obj.userData.modelOffset && (obj.userData.type === 'Enemy' || obj.userData.isPlayer)) {
                    if (Math.abs(obj.userData.modelOffset[1]) < 0.001) useSmartOffset = true;
                }

                if (!useSmartOffset) {
                    m.position.fromArray(obj.userData.modelOffset);
                } else {
                    if (obj.userData.type === 'Model') {
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

                // Restore child transforms if available
                if (obj.userData.childTransforms) {
                    obj.userData.childTransforms.forEach(t => {
                        let childObj = null;
                        m.traverse(c => {
                            if (c.name === t.name || c.uuid === t.uuid) {
                                childObj = c;
                            }
                        });
                        if (childObj) {
                            childObj.position.fromArray(t.p);
                            childObj.rotation.fromArray(t.r);
                            childObj.scale.fromArray(t.s);
                        }
                    });
                }
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
                this.updateMaterialSettings(obj);

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
          }
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

        if (type === 'Camera') {
            const camObj = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1), new THREE.MeshBasicMaterial({ color: 0x555555, wireframe: true }));
            camObj.name = name || ("Camera_" + this.objects.length);
            camObj.userData = { isCamera: true, fov: 60, type: '8WAY' };
            camObj.add(new THREE.PerspectiveCamera(60, 1, 0.1, 100));
            camObj.position.copy(pos).y += 1;
            this.addObject(camObj);
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
                wrapper.name = name || ("Model_" + this.objects.length);
                wrapper.userData = { isAsset: true, type: 'Model', glbSource: data, glbFilename: name || 'Model' };
                if (defaultAnim) wrapper.userData.defaultAnim = defaultAnim;

                m.position.y = 0;
                wrapper.add(m);
                wrapper.animations = gltf.animations;
                wrapper.userData.anims = gltf.animations.map(a => a.name);

                wrapper.userData.alphaMode = 'mask';
                wrapper.userData.alphaTest = 0.5;
                wrapper.userData.doubleSide = true;
                this.updateMaterialSettings(wrapper);

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
            case 'CutScene':
                geo = new THREE.BoxGeometry(1, 1, 1);
                mat = new THREE.MeshBasicMaterial({ color: 0x0099ff, wireframe: true, transparent: true, opacity: 0.3 });
                break;
            case 'SoundEffect':
                geo = new THREE.BoxGeometry(1, 1, 1);
                mat = new THREE.MeshBasicMaterial({ color: 0xff66aa, wireframe: true, transparent: true, opacity: 0.3 });
                break;
            case 'EmbedHTML':
                geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
                mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true, transparent: true, opacity: 0.8 });
                break;
            case 'Objective':
                geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
                mat = new THREE.MeshBasicMaterial({ color: 0xffcc00, wireframe: true, transparent: true, opacity: 0.8 });
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
            mesh.userData.activationTouch = false;
            mesh.userData.showHint = true;
            mesh.userData.hintDistance = 3.5;
            mesh.userData.hintSize = 44;
            mesh.userData.hintBgColor = '#33cccc';
            mesh.userData.hintTextColor = '#000000';
            mesh.userData.glbSource = data || null;
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

        if (type === 'CutScene') {
            mesh.userData.videoSource = '';
            mesh.userData.videoFilename = '';
            mesh.userData.triggerOnLevelStart = false;
            mesh.userData.triggerOnCollision = true;
            mesh.userData.skippable = true;
            mesh.userData.skipKey = 'Escape';
            mesh.userData.appearEffect = 'immediate';
            mesh.userData.isTrigger = true;
        }

        if (type === 'SoundEffect') {
            mesh.userData.audioSource = '';
            mesh.userData.audioFilename = '';
            mesh.userData.triggerOnLevelStart = false;
            mesh.userData.triggerOnCollision = true;
            mesh.userData.isTrigger = true;
        }

        if (type === 'EmbedHTML') {
            mesh.userData.embedUrl = 'https://example.com';
            mesh.userData.activationMode = 'collision';
            mesh.userData.activationKey = 'e';
            mesh.userData.showHint = true;
            mesh.userData.isTrigger = true;
        }

        if (type === 'Objective') {
            mesh.userData.objectiveText = 'Raggiungi';
            mesh.userData.actionType = 'alert';
            mesh.userData.actionValue = 'Obiettivo completato!';
            mesh.userData.actionTargets = [];
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
        if (data) {
            mesh.userData.glbSource = data;
            this.reloadModel(mesh, data);
        }
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
            clone.name = (prefix) + "." + (num.toString().padStart(padding, '0'));
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
        try {
            const sm = this.app.sceneManager;
            const data = {
                scene: this.objects.map(o => {
                    if (o.userData && o.userData.isPlayer) {
                        o.userData.initialPosition = o.position.toArray();
                        o.userData.initialRotation = [o.rotation.x, o.rotation.y, o.rotation.z];
                    }
                    const safeUserData = {};
                    if (o.userData) {
                        for (const key in o.userData) {
                            const val = o.userData[key];
                            if (typeof val === 'function') continue;
                            try {
                                JSON.stringify(val);
                                safeUserData[key] = val;
                            } catch (e) {
                                console.warn(`Skipping key ${key} from userData serialization due to error:`, e);
                            }
                        }
                    }
                    const objData = { name: o.name, p: o.position.toArray(), r: o.rotation.toArray(), s: o.scale.toArray(), userData: safeUserData };
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
                gamePBR: sm ? (sm.renderer.toneMapping !== THREE.NoToneMapping) : true,
                gameShadows: sm ? sm.renderer.shadowMap.enabled : true,
                gameReflections: sm ? !!sm.scene.environment : true,
                gameExposure: sm ? sm.pbrExposure : 1.0,
                gameAmbientColor: sm ? sm.ambientColor : '#ffffff',
                gameAmbientIntensity: sm ? sm.ambientIntensity : 1.5,
                gamePixelEffect: sm ? sm.usePixelShader : false,
                gamePixelSize: sm && sm.pixelPass ? sm.pixelPass.uniforms['pixelSize'].value : 6,
                gameBloomEffect: sm ? !!sm.useBloom : false,
                gameBloomStrength: sm ? (sm.bloomIntensity !== undefined ? sm.bloomIntensity : 0.5) : 0.5,
                gameBloomRadius: sm ? (sm.bloomRadius !== undefined ? sm.bloomRadius : 0.4) : 0.4,
                gameCyberpunkEffect: sm ? sm.useCyberpunk : false,
                gameCyberpunkAberration: sm && sm.cyberpunkPass ? sm.cyberpunkPass.uniforms['aberrationAmount'].value : 0.004,
                gameCyberpunkScanlines: sm && sm.cyberpunkPass ? sm.cyberpunkPass.uniforms['scanlineIntensity'].value : 0.2,
                gameSkyboxData: sm ? sm.skyboxData : null,
                gameSkyboxFilename: sm ? sm.skyboxFilename : "",
                gameSkyboxIntensity: sm ? (sm.hdrIntensity !== undefined ? sm.hdrIntensity : 1.5) : 1.5,
                gameSkyboxRotation: sm ? (sm.hdrRotation !== undefined ? sm.hdrRotation : 0) : 0,
                gameSkyboxVisible: sm ? sm.skyboxVisible : true,
                gameFogType: sm ? sm.fogType : 'none',
                gameFogColor: sm ? sm.fogColor : '#e5e5ea',
                gameFogDensity: sm ? sm.fogDensity : 0.015,
                gameFogNear: sm ? sm.fogNear : 1,
                gameFogFar: sm ? sm.fogFar : 100,
                gameSSAOActive: sm ? sm.useSSAO : false,
                gameSSAORadius: sm ? (sm.ssaoRadius * 150.0) : 16,
                gameSSAOIntensity: sm ? sm.ssaoIntensity : 1.0,
                gameSSRActive: sm ? sm.useSSR : false,
                gameSSRIntensity: sm ? (sm.ssrIntensity !== undefined ? sm.ssrIntensity : 0.45) : 0.45,
                gameSSGI: sm ? sm.realismSSGI : null,
                gameRealismSSR: sm ? sm.realismSSR : null,
                gameRealismAO: sm ? sm.realismAO : null,
                gameMotionBlur: sm ? sm.realismMotionBlur : null,
                gameAAMode: sm ? sm.realismAAMode : 'Disabled',
                gameVignetteStrength: sm ? sm.vignetteStrength : 1.0,
                gamePathTracingActive: sm ? sm.usePathTracing : false,
                keyframes: (sm && Array.isArray(sm.keyframes)) ? sm.keyframes.map(k => ({
                    actorId: k.actorId,
                    time: k.time,
                    pos: { x: k.pos.x, y: k.pos.y, z: k.pos.z },
                    rot: { x: k.rot.x, y: k.rot.y, z: k.rot.z },
                    scl: { x: k.scl.x, y: k.scl.y, z: k.scl.z }
                })) : [],
                viewportCameraPosition: this.orbit ? this.orbit.object.position.toArray() : [0, 5, 10],
                viewportCameraTarget: this.orbit ? this.orbit.target.toArray() : [0, 0, 0]
            };
            return JSON.stringify(data);
        } catch (e) {
            console.error("CRITICAL ERROR IN getLevelSerializedData:", e);
            return JSON.stringify({ scene: [], library: [] });
        }
    }

    /** Save current scene as a new level slot */
    saveCurrentAsLevel(name) {
        const levelName = name || "Level " + (this.levels.length + 1);
        const serialized = this.getLevelSerializedData();
        this.levels.push({ name: levelName, data: serialized, music: '' });
        this.currentLevelIndex = this.levels.length - 1;
        if (this.app.ui.renderLevelList) this.app.ui.renderLevelList();
    }

    /** Update an existing level slot with current scene */
    updateLevel(index) {
        if (index < 0 || index >= this.levels.length) return;
        
        // Costruisci l'oggetto completo comprensivo di scene e library
        const serialized = this.getLevelSerializedData();
        this.levels[index].data = serialized;
        
        if (this.app.ui.renderLevelList) this.app.ui.renderLevelList();
        
        const levelName = this.levels[index].name;
        // Persisti fisicamente sul disco passando true per saltare il sync ridondante ed evitare loop
        this.saveProject(true, "💾 Scena corrente salvata in \"" + (levelName) + "\" con successo!");
    }

    /** Load a level by index into the editor */
    async loadLevelByIndex(index) {
        if (index < 0 || index >= this.levels.length) {
            console.warn('Level index out of range:', index);
            return;
        }
        const level = this.levels[index];
        if (this.app.ui && this.app.ui.showLoading) {
            this.app.ui.showLoading(`Caricamento livello "${level.name || (index + 1)}"...`);
        }
        try {
            let rootData = null;
            // Se in memoria non abbiamo i dati del livello, scarichiamoli dal file su disco tramite server
            if (!level.data) {
                let filename = level.externalFilename || level.name.toLowerCase().replace(/\s+/g, '_');
                if (!filename.endsWith('.json')) {
                    filename += '.json';
                }
                console.log("[Editor] Scaricamento del file di livello: " + (filename));
                const res = await fetch("./projects/" + (this.projectName) + "/levels/" + (filename) + "?t=" + (Date.now()));
                if (res.ok) {
                    rootData = await res.json();
                    level.data = JSON.stringify(rootData);
                } else {
                    console.warn("[Editor] Impossibile caricare il file di livello da disco, inizializzo vuoto.");
                    rootData = { scene: [], library: [] };
                }
            } else {
                if (typeof level.data === 'string') {
                    try {
                        rootData = JSON.parse(level.data);
                    } catch (e) {
                        console.error("[Editor] Errore parsing level.data:", e);
                        rootData = { scene: [], library: [] };
                    }
                } else if (typeof level.data === 'object' && level.data !== null) {
                    rootData = level.data;
                } else {
                    rootData = { scene: [], library: [] };
                }
            }

            const sceneData = rootData.scene || rootData;
            
            if (rootData.format === 'wscene') {
                await this.loadWSceneData(rootData);
                this.currentLevelIndex = index;
                if (this.app.ui.renderLevelList) this.app.ui.renderLevelList();
                return;
            }

            this.clearScene();
            if (this.app.ui.restoreLibrary) this.app.ui.restoreLibrary(rootData.library || []);
            
            // Ripristina le impostazioni di rendering di SceneManager se presenti
            if (this.app.sceneManager) {
                if (rootData.gamePBR !== undefined) this.app.sceneManager.setPBROutput(rootData.gamePBR);
                if (rootData.gameShadows !== undefined) this.app.sceneManager.setShadows(rootData.gameShadows);
                if (rootData.gameReflections !== undefined) this.app.sceneManager.setReflections(rootData.gameReflections);
                if (rootData.gameExposure !== undefined) this.app.sceneManager.setExposure(rootData.gameExposure);
                if (rootData.gameAmbientColor !== undefined) {
                    this.app.sceneManager.setAmbientColor(rootData.gameAmbientColor);
                    this.gameAmbientColor = rootData.gameAmbientColor;
                }
                if (rootData.gameAmbientIntensity !== undefined) {
                    this.app.sceneManager.setAmbientIntensity(rootData.gameAmbientIntensity);
                    this.gameAmbientIntensity = rootData.gameAmbientIntensity;
                }
                
                // Pixel effect
                if (rootData.gamePixelEffect !== undefined) {
                    this.app.sceneManager.setPixelEffect(rootData.gamePixelEffect, rootData.gamePixelSize || 6);
                }
                
                // Bloom effect
                if (rootData.gameBloomEffect !== undefined) {
                    this.app.sceneManager.setBloomEffect(rootData.gameBloomEffect, rootData.gameBloomStrength, rootData.gameBloomRadius);
                }
                
                // Cyberpunk effect
                if (rootData.gameCyberpunkEffect !== undefined) {
                    this.app.sceneManager.setCyberpunkEffect(rootData.gameCyberpunkEffect, rootData.gameCyberpunkAberration, rootData.gameCyberpunkScanlines);
                }
                
                // Skybox
                if (rootData.gameSkyboxData !== undefined) {
                    this.app.sceneManager.setSkybox(rootData.gameSkyboxData, rootData.gameSkyboxFilename || "");
                }
                if (rootData.gameSkyboxIntensity !== undefined) {
                    this.app.sceneManager.setSkyboxIntensity(rootData.gameSkyboxIntensity);
                }
                if (rootData.gameSkyboxVisible !== undefined) {
                    this.app.sceneManager.setSkyboxVisibility(rootData.gameSkyboxVisible);
                }

                // Fog
                if (rootData.gameFogType !== undefined) {
                    this.app.sceneManager.setFog(
                        rootData.gameFogType,
                        rootData.gameFogColor,
                        rootData.gameFogDensity,
                        rootData.gameFogNear,
                        rootData.gameFogFar
                    );
                }
                // SSAO
                if (rootData.gameSSAOActive !== undefined) {
                    const radius = rootData.gameSSAORadius !== undefined ? rootData.gameSSAORadius : 16;
                    const intensity = rootData.gameSSAOIntensity !== undefined ? rootData.gameSSAOIntensity : 1.0;
                    this.app.sceneManager.setSSAO(rootData.gameSSAOActive, radius, intensity);
                }
                // SSR
                if (rootData.gameSSRActive !== undefined || rootData.gameSSREffect !== undefined) {
                    const active = rootData.gameSSRActive !== undefined ? rootData.gameSSRActive : rootData.gameSSREffect;
                    const intensity = rootData.gameSSRIntensity !== undefined ? parseFloat(rootData.gameSSRIntensity) : 0.45;
                    this.app.sceneManager.setSSR(active, intensity);
                }
                // Vignette Strength
                if (rootData.gameVignetteStrength !== undefined) {
                    this.app.sceneManager.vignetteStrength = rootData.gameVignetteStrength;
                    this.app.sceneManager.updateEnvironment();
                }

                // Realism Effects (0beqz) Restoration
                if (rootData.gameSSGI) {
                    this.app.sceneManager.setRealismSSGI(
                        rootData.gameSSGI.enabled,
                        rootData.gameSSGI.distance,
                        rootData.gameSSGI.thickness,
                        rootData.gameSSGI.steps,
                        rootData.gameSSGI.denoise
                    );
                }
                if (rootData.gameRealismSSR) {
                    this.app.sceneManager.setRealismSSR(
                        rootData.gameRealismSSR.enabled,
                        rootData.gameRealismSSR.intensity
                    );
                }
                if (rootData.gameRealismAO) {
                    this.app.sceneManager.setRealismAO(
                        rootData.gameRealismAO.enabled,
                        rootData.gameRealismAO.type,
                        rootData.gameRealismAO.radius
                    );
                }
                if (rootData.gameMotionBlur) {
                    this.app.sceneManager.setRealismMotionBlur(
                        rootData.gameMotionBlur.enabled,
                        rootData.gameMotionBlur.intensity
                    );
                }
                if (rootData.gameAAMode) {
                    this.app.sceneManager.setRealismAAMode(rootData.gameAAMode);
                }
                // Path Tracing
                // Path Tracing
                if (rootData.gamePathTracingActive !== undefined) {
                    this.app.sceneManager.setPathTracing(rootData.gamePathTracingActive);
                }

                // Keyframes Sequencer
                if (rootData.keyframes !== undefined) {
                    this.app.sceneManager.keyframes = rootData.keyframes.map(k => ({
                        actorId: k.actorId,
                        time: k.time,
                        pos: new THREE.Vector3(k.pos.x, k.pos.y, k.pos.z),
                        rot: new THREE.Euler(k.rot.x, k.rot.y, k.rot.z),
                        scl: new THREE.Vector3(k.scl.x, k.scl.y, k.scl.z)
                    }));
                } else {
                    this.app.sceneManager.keyframes = [];
                }
                if (this.app.ui && this.app.ui.updateSequencerUI) {
                    this.app.ui.updateSequencerUI();
                }
            }

            // Attendiamo il completamento del ripristino di tutti i modelli asincroni
            const restorePromises = this._restoreSceneData(sceneData);
            if (restorePromises && restorePromises.length > 0) {
                await Promise.all(restorePromises);
            }

            // Ripristina la camera OrbitControls del viewport
            if (rootData.viewportCameraPosition && this.orbit) {
                this.orbit.object.position.fromArray(rootData.viewportCameraPosition);
            }
            if (rootData.viewportCameraTarget && this.orbit) {
                this.orbit.target.fromArray(rootData.viewportCameraTarget);
                this.orbit.update();
            }

            // Se dopo il caricamento non c'è alcun Player in scena, creane uno di default
            const hasPlayer = this.objects.some(o => o.userData && o.userData.isPlayer);
            if (!hasPlayer) {
                const player = PlayerFactory.createPlayer(this.objects.length);
                player.position.set(0, 1, 0);
                this.addObject(player, false);
            }

            this.currentLevelIndex = index;
            if (this.app.ui.renderLevelList) this.app.ui.renderLevelList();
            this.app.ui.rebuildLibrary();
            if (this.app.ui.collapseAll) this.app.ui.collapseAll();
            this.app.ui.update();
            this.updateLinks();
        } catch (err) { 
            console.error('Error loading level:', err); 
        } finally {
            if (this.app.ui && this.app.ui.hideLoading) {
                this.app.ui.hideLoading();
            }
        }
    }

    /** Internal: restore scene from data array */
    _restoreSceneData(sceneData) {
        const promises = [];
        if (!Array.isArray(sceneData)) {
            console.warn("[Editor] _restoreSceneData: sceneData non è un array valido, reimpostato a vuoto.");
            sceneData = [];
        }
        sceneData.forEach((d) => {
            let obj;
            const uData = d.userData || {};
            if (!uData.isPlayer && (uData.type === 'Player' || uData.typology)) uData.isPlayer = true;
            if (!uData.isCamera && d.name.includes("Camera")) uData.isCamera = true;

            const KNOWN_GAME_TYPES = [
                'Enemy', 'Bonus', 'Boss', 'Catcher', 'catcher_target', 'Spawn', 'Goal',
                'PowerUp', 'Analyze', 'Dialog', 'Collision', 'CutScene', 'SoundEffect',
                'EmbedHTML', 'Objective', 'PointLight', 'SpotLight', 'DirectionalLight', 'SplatEnv'
            ];

            const rawType = uData.type || d.type || 'Model';
            const isKnownGameType = KNOWN_GAME_TYPES.includes(rawType);

            console.log(`[Woxengine DEBUG] Restoring object "${d.name}": rawType="${rawType}", isKnownGameType=${isKnownGameType}, glbNodeName="${uData.glbNodeName || d.glbNodeName}"`);

            if (uData.isPlayer) {
                const r = d.geo?.radius !== undefined ? d.geo.radius : 0.3;
                const h = d.geo?.height !== undefined ? d.geo.height : 1.2;
                obj = new THREE.Mesh(new THREE.CapsuleGeometry(r, h, 4, 8), new THREE.MeshStandardMaterial({ color: 0x4caf50, transparent: true, opacity: 0.5, wireframe: true }));
            } else if (uData.isCamera) {
                obj = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1), new THREE.MeshBasicMaterial({ color: 0x555555, wireframe: true }));
                obj.add(new THREE.PerspectiveCamera(uData.fov || 60, 1, 0.1, 100));
            } else if (!isKnownGameType || rawType === 'Model') {
                obj = new THREE.Group();
                uData.type = 'Model';
                uData.isAsset = true;
                if (!uData.glbSource) {
                    const lvlIdx = this.currentLevelIndex >= 0 ? this.currentLevelIndex : 0;
                    uData.glbSource = "projects/" + (this.projectName || 'default_project') + "/assets/blender_sync_" + lvlIdx + ".glb";
                }
                if (!uData.glbNodeName) {
                    uData.glbNodeName = d.glbNodeName || d.name;
                }
            } else {
                const type = rawType;
                if (type === 'SplatEnv') {
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
                        case 'CutScene': {
                            const cw = (d.geo && d.geo.width !== undefined) ? d.geo.width : 1.0;
                            const ch = (d.geo && d.geo.height !== undefined) ? d.geo.height : 1.0;
                            const cd = (d.geo && d.geo.depth !== undefined) ? d.geo.depth : 1.0;
                            geo = new THREE.BoxGeometry(cw, ch, cd);
                            mat = new THREE.MeshBasicMaterial({ color: 0x0099ff, wireframe: true, transparent: true, opacity: 0.3 }); break;
                        }
                        case 'SoundEffect': {
                            const cw = (d.geo && d.geo.width !== undefined) ? d.geo.width : 1.0;
                            const ch = (d.geo && d.geo.height !== undefined) ? d.geo.height : 1.0;
                            const cd = (d.geo && d.geo.depth !== undefined) ? d.geo.depth : 1.0;
                            geo = new THREE.BoxGeometry(cw, ch, cd);
                            mat = new THREE.MeshBasicMaterial({ color: 0xff66aa, wireframe: true, transparent: true, opacity: 0.3 }); break;
                        }
                        case 'EmbedHTML': {
                            const ew = (d.geo && d.geo.width !== undefined) ? d.geo.width : 1.5;
                            const eh = (d.geo && d.geo.height !== undefined) ? d.geo.height : 1.5;
                            const ed = (d.geo && d.geo.depth !== undefined) ? d.geo.depth : 1.5;
                            geo = new THREE.BoxGeometry(ew, eh, ed);
                            mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true, transparent: true, opacity: 0.8 }); break;
                        }
                        case 'Objective': {
                            const ow = (d.geo && d.geo.width !== undefined) ? d.geo.width : 1.5;
                            const oh = (d.geo && d.geo.height !== undefined) ? d.geo.height : 1.5;
                            const od = (d.geo && d.geo.depth !== undefined) ? d.geo.depth : 1.5;
                            geo = new THREE.BoxGeometry(ow, oh, od);
                            mat = new THREE.MeshBasicMaterial({ color: 0xffcc00, wireframe: true, transparent: true, opacity: 0.8 }); break;
                        }
                        case 'PointLight': geo = new THREE.SphereGeometry(0.2); mat = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true }); isLight = true; break;
                        case 'SpotLight': geo = new THREE.ConeGeometry(0.2, 0.5, 4); mat = new THREE.MeshBasicMaterial({ color: 0xffffaa, wireframe: true }); isLight = true; break;
                        case 'DirectionalLight': geo = new THREE.BoxGeometry(0.4, 0.4, 0.4); mat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }); isLight = true; break;
                        default:
                            console.warn(`[Woxengine WARNING] Unknown type "${type}" for object "${d.name}", defaulting to Group Model.`);
                            geo = null;
                    }
                    if (geo) {
                        obj = new THREE.Mesh(geo, mat);
                    } else {
                        obj = new THREE.Group();
                        uData.type = 'Model';
                        uData.isAsset = true;
                    }

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
            }

            obj.name = d.name;
            if (uData.isPlayer && uData.initialPosition && Array.isArray(uData.initialPosition) && uData.initialPosition.every(v => typeof v === 'number' && !isNaN(v))) {
                obj.position.fromArray(uData.initialPosition);
            } else if (d.p && Array.isArray(d.p) && d.p.every(v => typeof v === 'number' && !isNaN(v))) {
                obj.position.fromArray(d.p);
            }
            if (d.q && Array.isArray(d.q) && d.q.length === 4 && d.q.every(v => typeof v === 'number' && !isNaN(v))) {
                obj.quaternion.fromArray(d.q);
            } else if (d.r && Array.isArray(d.r) && d.r.every(v => typeof v === 'number' && !isNaN(v))) {
                obj.rotation.fromArray(d.r);
            }
            if (d.s && Array.isArray(d.s) && d.s.every(v => typeof v === 'number' && !isNaN(v))) {
                obj.scale.fromArray(d.s);
            }
            obj.userData = uData;

            // Self-healing: recupera il glbSource mancante basandosi sul glbFilename
            if (uData.type === 'Model' && !uData.glbSource && uData.glbFilename) {
                if (uData.glbFilename === 'scene.glb') {
                    const lvlIdx = this.currentLevelIndex >= 0 ? this.currentLevelIndex : 0;
                    uData.glbSource = "projects/" + (this.projectName || 'default_project') + "/assets/blender_sync_" + lvlIdx + ".glb";
                } else {
                    uData.glbSource = "projects/" + (this.projectName || 'default_project') + "/assets/" + uData.glbFilename;
                }
            }

            // Self-healing: se è un modello GLB personalizzato ma manca glbFilename, cercalo nella libreria caricata
            if (uData.type === 'Model' && uData.glbSource && !uData.glbFilename) {
                if (this.app.ui && this.app.ui.library) {
                    const getB64 = (s) => {
                        if (!s || typeof s !== 'string') return '';
                        const idx = s.indexOf(',');
                        return idx !== -1 ? s.substring(idx + 1) : s;
                    };
                    const targetB64 = getB64(uData.glbSource);
                    const libItem = this.app.ui.library.find(item => item.type === 'Model' && getB64(item.data) === targetB64);
                    if (libItem) {
                        uData.glbFilename = libItem.name;
                    }
                }
                if (!uData.glbFilename) {
                    if (obj.name && !obj.name.match(/_[0-9]+$/)) {
                        uData.glbFilename = obj.name;
                    } else {
                        uData.glbFilename = 'Model';
                    }
                }
            }
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
            } else {
                this.updateMaterialSettings(obj);
            }
        });
        this.updateSplatMode();
        return promises;
    }

    saveProject(skipSync = false, customMsg = null) {
        // Sync current active level before saving project file
        if (!skipSync && this.currentLevelIndex >= 0) {
            this.updateLevel(this.currentLevelIndex);
            return;
        }

        // Dynamically save nested child transforms
        this.objects.forEach(o => {
            const childTransforms = [];
            o.traverse(child => {
                if (child === o) return;
                if (child.userData && child.userData.isHelper) return;
                if (child.name === 'TransformControlsGizmo') return;
                childTransforms.push({
                    name: child.name,
                    uuid: child.uuid,
                    p: child.position.toArray(),
                    r: child.rotation.toArray(),
                    s: child.scale.toArray()
                });
            });
            o.userData.childTransforms = childTransforms;
        });

        const data = {
            scene: this.objects.map(o => {
                if (o.userData && o.userData.isPlayer) {
                    o.userData.initialPosition = o.position.toArray();
                    o.userData.initialRotation = [o.rotation.x, o.rotation.y, o.rotation.z];
                }
                const safeUserData = {};
                if (o.userData) {
                    for (const key in o.userData) {
                        const val = o.userData[key];
                        if (typeof val === 'function') continue;
                        try {
                            JSON.stringify(val);
                            safeUserData[key] = val;
                        } catch (e) {
                            console.warn(`Skipping key ${key} from userData serialization due to error:`, e);
                        }
                    }
                }
                const objData = { name: o.name, p: o.position.toArray(), r: o.rotation.toArray(), s: o.scale.toArray(), userData: safeUserData };
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
            levels: (this.levels || []).map(lvl => ({
                name: lvl.name,
                music: lvl.music || '',
                musicFilename: lvl.musicFilename || '',
                isExternal: !!lvl.isExternal,
                externalFilename: lvl.externalFilename || ''
            })),
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

        // Salva localmente sul server tramite chiamata API POST
        const projectName = this.projectName || 'default_project';
        const levelPayloads = this.levels.map((lvl, index) => {
            // Calcolo pulito del filename
            let filename = lvl.externalFilename || lvl.name.toLowerCase().replace(/\s+/g, '_');
            if (!filename.endsWith('.json')) {
                filename += '.json';
            }

            // Se è il livello corrente, prendiamo gli oggetti in tempo reale
            if (index === this.currentLevelIndex) {
                return {
                    filename: filename,
                    data: this.getLevelSerializedData()
                };
            }
            return {
                filename: filename,
                data: lvl.data
            };
        });

        let bodyPayload = "";
        try {
            bodyPayload = JSON.stringify({
                projectName: projectName,
                projectData: {
                    projectName: projectName,
                    gameTitle: data.gameTitle,
                    gameSplashSubtitle: data.gameSplashSubtitle,
                    gameSplashImage: data.gameSplashImage,
                    gameSplashMusic: data.gameSplashMusic,
                    gameSplashMusicFilename: data.gameSplashMusicFilename,
                    startingLevelIndex: data.startingLevelIndex,
                    currentLevelIndex: data.currentLevelIndex,
                    gameEndTitle: data.gameEndTitle,
                    gameEndSubtitle: data.gameEndSubtitle,
                    gameEndImage: data.gameEndImage,
                    gameEndVideo: data.gameEndVideo,
                    gameEndVideoAspect: data.gameEndVideoAspect,
                    gameEndMusic: data.gameEndMusic,
                    gameEndMusicFilename: data.gameEndMusicFilename,
                    library: data.library,
                    levels: this.levels.map((lvl, index) => ({
                        name: lvl.name,
                        music: lvl.music || '',
                        musicFilename: lvl.musicFilename || '',
                        isExternal: !!lvl.isExternal,
                        externalFilename: lvl.externalFilename || ''
                    }))
                },
                levels: levelPayloads
            });
        } catch (e) {
            console.error("CRITICAL SERIALIZATION ERROR IN SAVEPROJECT:", e);
            if (this.app.ui && this.app.ui.showToast) {
                this.app.ui.showToast("❌ Errore critico di serializzazione JSON: " + e.message, 4000);
            }
            return;
        }

        fetch('/api/save-project', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyPayload
        })
        .then(res => res.json())
        .then(resData => {
            if (resData.success) {
                console.log("[Editor] Progetto e livelli salvati correttamente sul server locale!");
                // Rinfresca la UI o mostra un feedback visivo leggero
                if (this.app.ui && this.app.ui.showToast) {
                    const msg = customMsg || "💾 Progetto salvato con successo sul filesystem!";
                    this.app.ui.showToast(msg, 2000);
                }
            } else {
                console.error("[Editor] Errore nel salvataggio del progetto:", resData.error);
                alert("Errore salvataggio progetto: " + resData.error);
            }
        })
        .catch(err => {
            console.error("[Editor] Impossibile contattare il server per il salvataggio:", err);
            // Fallback: scarica file project.json nel browser se il server è irraggiungibile
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
            a.download = 'project.json'; a.click();
        });
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

        const color = obj.userData.materialColor;
        const metalness = obj.userData.materialMetalness !== undefined ? parseFloat(obj.userData.materialMetalness) : undefined;
        const roughness = obj.userData.materialRoughness !== undefined ? parseFloat(obj.userData.materialRoughness) : undefined;
        const clearcoat = obj.userData.materialClearcoat !== undefined ? parseFloat(obj.userData.materialClearcoat) : 0.0;
        const clearcoatRoughness = obj.userData.materialClearcoatRoughness !== undefined ? parseFloat(obj.userData.materialClearcoatRoughness) : 0.0;
        const transmission = obj.userData.materialTransmission !== undefined ? parseFloat(obj.userData.materialTransmission) : 0.0;
        const thickness = obj.userData.materialThickness !== undefined ? parseFloat(obj.userData.materialThickness) : 0.0;
        const emissive = obj.userData.materialEmissive;
        const emissiveIntensity = obj.userData.materialEmissiveIntensity !== undefined ? parseFloat(obj.userData.materialEmissiveIntensity) : undefined;
        const specular = obj.userData.materialSpecular !== undefined ? parseFloat(obj.userData.materialSpecular) : 0.5;
        const subsurface = obj.userData.materialSubsurfaceScattering !== undefined ? parseFloat(obj.userData.materialSubsurfaceScattering) : 0.0;

        obj.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                
                const updatedMaterials = materials.map((mat) => {
                    mat.transparent = (alphaMode !== 'opaque');
                    if (alphaMode === 'mask') {
                        mat.alphaTest = alphaTest;
                        mat.depthWrite = true;
                    } else if (alphaMode === 'blend') {
                        mat.alphaTest = 0;
                        mat.depthWrite = false;
                    } else {
                        mat.alphaTest = 0;
                        mat.depthWrite = true;
                    }
                    mat.side = doubleSide ? THREE.DoubleSide : THREE.FrontSide;

                    let activeMat = mat;
                    if (transmission > 0 || clearcoat > 0 || subsurface > 0 || specular !== 0.5) {
                        if (!mat.isMeshPhysicalMaterial) {
                            const prevMat = mat;
                            activeMat = new THREE.MeshPhysicalMaterial();
                            
                            // Safe copy common properties to avoid Vector2.copy errors on missing maps/vectors
                            activeMat.name = prevMat.name || '';
                            if (prevMat.color && activeMat.color) activeMat.color.copy(prevMat.color);
                            activeMat.roughness = prevMat.roughness !== undefined ? prevMat.roughness : 1.0;
                            activeMat.metalness = prevMat.metalness !== undefined ? prevMat.metalness : 0.0;
                            activeMat.opacity = prevMat.opacity !== undefined ? prevMat.opacity : 1.0;
                            activeMat.transparent = !!prevMat.transparent;
                            activeMat.depthWrite = prevMat.depthWrite !== false;
                            activeMat.depthTest = prevMat.depthTest !== false;
                            activeMat.side = prevMat.side !== undefined ? prevMat.side : THREE.FrontSide;
                            
                            if (prevMat.map) activeMat.map = prevMat.map;
                            if (prevMat.normalMap) {
                                activeMat.normalMap = prevMat.normalMap;
                                if (prevMat.normalScale && activeMat.normalScale) activeMat.normalScale.copy(prevMat.normalScale);
                            }
                            if (prevMat.roughnessMap) activeMat.roughnessMap = prevMat.roughnessMap;
                            if (prevMat.metalnessMap) activeMat.metalnessMap = prevMat.metalnessMap;
                            if (prevMat.aoMap) {
                                activeMat.aoMap = prevMat.aoMap;
                                activeMat.aoMapIntensity = prevMat.aoMapIntensity !== undefined ? prevMat.aoMapIntensity : 1.0;
                            }
                            if (prevMat.emissiveMap) activeMat.emissiveMap = prevMat.emissiveMap;
                            if (prevMat.emissive && activeMat.emissive) activeMat.emissive.copy(prevMat.emissive);
                            activeMat.emissiveIntensity = prevMat.emissiveIntensity !== undefined ? prevMat.emissiveIntensity : 1.0;
                            if (prevMat.alphaMap) activeMat.alphaMap = prevMat.alphaMap;
                        }
                        activeMat.clearcoat = clearcoat;
                        activeMat.clearcoatRoughness = clearcoatRoughness;
                        activeMat.transmission = transmission;
                        activeMat.thickness = Math.max(thickness, subsurface);
                        if (subsurface > 0) {
                            activeMat.transmission = Math.max(transmission, subsurface * 0.5);
                        }
                        activeMat.specularIntensity = specular;
                    } else {
                        if (activeMat.specularIntensity !== undefined) {
                            activeMat.specularIntensity = specular;
                        }
                    }

                    // Apply settings safely to activeMat ONLY if explicitly defined
                    if (color !== undefined && activeMat.color && typeof activeMat.color.set === 'function') {
                        activeMat.color.set(color);
                    }
                    if (metalness !== undefined && activeMat.metalness !== undefined) {
                        activeMat.metalness = metalness;
                    }
                    if (roughness !== undefined && activeMat.roughness !== undefined) {
                        activeMat.roughness = roughness;
                    }
                    if (emissive !== undefined && activeMat.emissive && typeof activeMat.emissive.set === 'function') {
                        activeMat.emissive.set(emissive);
                    }
                    if (emissiveIntensity !== undefined && activeMat.emissiveIntensity !== undefined) {
                        activeMat.emissiveIntensity = emissiveIntensity;
                    }

                    // Ensure reflection map is linked
                    if (this.app.sceneManager) {
                        if (this.app.sceneManager.scene.environment) {
                            activeMat.envMap = this.app.sceneManager.scene.environment;
                        }
                        activeMat.envMapIntensity = this.app.sceneManager.hdrIntensity !== undefined ? this.app.sceneManager.hdrIntensity : 1.0;
                    }

                    activeMat.needsUpdate = true;
                    return activeMat;
                });

                child.material = Array.isArray(child.material) ? updatedMaterials : updatedMaterials[0];
            }
        });
        if (this.app.sceneManager) {
            this.app.sceneManager.resetPathTracing();
        }
    }

    clearScene() {
        this.select(null);
        if (this.gizmo) this.gizmo.detach();
        if (this._glbPromises) this._glbPromises.clear();

        // Collect all objects in the scene graph that are user objects / helpers / cameras / players
        const toRemove = [];
        if (this.app.sceneManager && this.app.sceneManager.scene) {
            this.app.sceneManager.scene.traverse((child) => {
                if (child === this.app.sceneManager.scene) return;
                const uData = child.userData || {};
                if (uData.isAsset || uData.isCamera || uData.isPlayer || uData.type) {
                    toRemove.push(child);
                } else if (child.name === 'ArrowHelper' || child.name === 'model' || child.name === 'light_source') {
                    toRemove.push(child);
                }
            });
        }

        // Also remove all tracked objects in this.objects
        if (Array.isArray(this.objects)) {
            this.objects.forEach(o => {
                if (o && o.parent) o.parent.remove(o);
            });
        }

        toRemove.forEach(o => {
            if (o && o.parent) o.parent.remove(o);
        });

        if (this.linkGroup) this.linkGroup.clear();

        this.objects = [];
        this.history = [];
        this.hIndex = -1;

        if (this.app.sceneManager && this.app.sceneManager.scene) {
            this.app.sceneManager.scene.children.forEach(c => {
                if (c && c.type === 'GridHelper') c.visible = true;
            });
        }

        if (this.app.ui && this.app.ui.update) this.app.ui.update();
    }

    setupInitialDefaultScene() {
        this.clearScene();
        this.addCamera();

        // 1. Aggiungi Player di default
        const player = PlayerFactory.createPlayer(this.objects.length);
        player.position.set(0, 1, 0);
        this.addObject(player, false);

        this.app.ui.rebuildLibrary();
        this.app.ui.update();
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

                // Case 0: .wscene format
                if (rootData.format === 'wscene') {
                    const name = file.name.replace(/\.(json|wscene)$/i, '') || "WScene Level " + (this.levels.length + 1);
                    this.levels.push({
                        name: name,
                        data: JSON.stringify(rootData),
                        music: '',
                        musicFilename: ''
                    });
                    if (this.app.ui.renderLevelList) this.app.ui.renderLevelList();
                    console.log("Livello WScene importato: \"" + name + "\"");
                    this.loadLevelByIndex(this.levels.length - 1);
                    return;
                }

                // Case 1: It's a full project with multiple levels
                if (Array.isArray(rootData.levels) && rootData.levels.length > 0) {
                    const baseName = file.name.replace(/\.json$/i, '');
                    const startIdx = this.levels.length;
                    rootData.levels.forEach((lvl, i) => {
                        this.levels.push({
                            name: lvl.name || (baseName) + " – " + (i + 1),
                            data: typeof lvl.data === 'string' ? lvl.data : JSON.stringify(lvl.data),
                            music: lvl.music || '',
                            musicFilename: lvl.musicFilename || ''
                        });
                    });
                    if (this.app.ui.renderLevelList) this.app.ui.renderLevelList();
                    console.log("Importati " + (rootData.levels.length) + " livelli da \"" + (file.name) + "\"");
                    return;
                }

                // Case 2: Single-scene JSON
                const sceneData = rootData.scene || rootData;
                const name = file.name.replace(/\.json$/i, '') || "Level " + (this.levels.length + 1);

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
                console.log("Livello importato: \"" + (name) + "\" (" + (payload.scene.length) + " oggetti)");

            } catch (err) {
                console.error('Errore nel parsing del JSON livello:', err);
                alert('Errore: file JSON non valido.');
            }
        };
        reader.readAsText(file);
    }

    async loadWSceneData(wsceneData) {
        if (!wsceneData) return;
        try {
            console.log("[Editor] Caricamento dati .wscene...", wsceneData);
            if (this._glbPromises) this._glbPromises.clear();
            else this._glbPromises = new Map();
            
            // Backup Player and Camera state to maintain editor-made configurations
            let backupPlayer = null;
            let backupCamera = null;
            
            const existingPlayer = this.objects.find(o => o.userData && o.userData.isPlayer);
            if (existingPlayer) {
                backupPlayer = {
                    p: existingPlayer.position.toArray(),
                    r: [existingPlayer.rotation.x, existingPlayer.rotation.y, existingPlayer.rotation.z, existingPlayer.rotation.order],
                    s: existingPlayer.scale.toArray(),
                    userData: JSON.parse(JSON.stringify(existingPlayer.userData))
                };
            }
            
            const existingCamera = this.objects.find(o => o.userData && o.userData.isCamera);
            if (existingCamera) {
                backupCamera = {
                    p: existingCamera.position.toArray(),
                    r: [existingCamera.rotation.x, existingCamera.rotation.y, existingCamera.rotation.z, existingCamera.rotation.order],
                    s: existingCamera.scale.toArray(),
                    userData: JSON.parse(JSON.stringify(existingCamera.userData))
                };
            }

            // 1. Pulisci la scena
            this.clearScene();
            
            // 2. Ripristina la libreria
            if (this.app.ui && this.app.ui.restoreLibrary) {
                const library = wsceneData.library || [];
                let glbData = wsceneData.glbSource;
                let glbName = glbData ? glbData.substring(glbData.lastIndexOf('/') + 1) : 'scene.glb';
                
                if (wsceneData.glb) {
                    glbData = wsceneData.glb;
                    glbName = 'scene.glb';
                }
                
                if (glbData) {
                    if (!library.some(item => item.data === glbData || item.name === glbName)) {
                        library.push({
                            name: glbName,
                            type: 'Model',
                            data: glbData
                        });
                    }
                }
                this.app.ui.restoreLibrary(library);
            }
            
            // 3. Ripristina impostazioni globali del livello
            const ls = wsceneData.levelSettings || {};
            const sm = this.app.sceneManager;
            if (sm) {
                if (ls.gamePBR !== undefined) sm.setPBROutput(ls.gamePBR);
                if (ls.gameShadows !== undefined) sm.setShadows(ls.gameShadows);
                if (ls.gameReflections !== undefined) sm.setReflections(ls.gameReflections);
                if (ls.gameExposure !== undefined) sm.setExposure(ls.gameExposure);
                if (ls.gameAmbientColor !== undefined) {
                    sm.setAmbientColor(ls.gameAmbientColor);
                    this.gameAmbientColor = ls.gameAmbientColor;
                }
                if (ls.gameAmbientIntensity !== undefined) {
                    sm.setAmbientIntensity(ls.gameAmbientIntensity);
                    this.gameAmbientIntensity = ls.gameAmbientIntensity;
                }
                if (ls.gameBloomEffect !== undefined && typeof sm.setBloomEffect === 'function') {
                    const bSt = (ls.gameBloomStrength !== undefined && !isNaN(parseFloat(ls.gameBloomStrength))) ? parseFloat(ls.gameBloomStrength) : 0.5;
                    const bRd = (ls.gameBloomRadius !== undefined && !isNaN(parseFloat(ls.gameBloomRadius))) ? parseFloat(ls.gameBloomRadius) : 0.4;
                    sm.setBloomEffect(!!ls.gameBloomEffect, bSt, bRd);
                }
                if (ls.gameSSAOEffect !== undefined && typeof sm.setSSAOEffect === 'function') {
                    sm.setSSAOEffect(ls.gameSSAOEffect, ls.gameSSAODistance || 0.2);
                }
                if (ls.gameSSREffect !== undefined || ls.gameSSRActive !== undefined) {
                    const active = ls.gameSSREffect !== undefined ? ls.gameSSREffect : ls.gameSSRActive;
                    const intensity = ls.gameSSRIntensity !== undefined ? parseFloat(ls.gameSSRIntensity) : 0.45;
                    sm.setSSR(active, intensity);
                }
            }
            
            // 4. Ripristina gli oggetti della scena
            const sceneObjects = (wsceneData.objects || []).map(obj => {
                const uData = obj.userData || {};
                const type = obj.type || uData.type || 'Model';
                
                if (type === 'Model' || uData.glbSource || uData.glbNodeName || (!uData.isCamera && !uData.isPlayer && type !== 'PointLight' && type !== 'SpotLight' && type !== 'DirectionalLight')) {
                    uData.type = uData.type || 'Model';
                    uData.isAsset = true;
                    uData.glbSource = uData.glbSource || wsceneData.glbSource || wsceneData.glb;
                    uData.glbFilename = uData.glbFilename || 'scene.glb';
                    uData.glbNodeName = obj.glbNodeName || uData.glbNodeName || obj.name;
                } else {
                    uData.type = type;
                    uData.isAsset = true;
                }
                
                return {
                    name: obj.name,
                    p: obj.p || obj.position || [0, 0, 0],
                    q: obj.q || (uData ? uData.q : null),
                    r: obj.r || obj.rotation || [0, 0, 0],
                    s: obj.s || obj.scale || [1, 1, 1],
                    userData: uData
                };
            });
            
            const restorePromises = this._restoreSceneData(sceneObjects);
            if (restorePromises && restorePromises.length > 0) {
                await Promise.all(restorePromises);
            }
            
            // Restore backed up Player and Camera configurations
            if (backupPlayer) {
                const newPlayer = this.objects.find(o => o.userData && o.userData.isPlayer);
                if (newPlayer) {
                    newPlayer.position.fromArray(backupPlayer.p);
                    newPlayer.rotation.fromArray(backupPlayer.r);
                    newPlayer.scale.fromArray(backupPlayer.s);
                    newPlayer.userData = backupPlayer.userData;
                    // Rebuild capsule geometry if dimensions changed
                    if (backupPlayer.userData.geo) {
                        const r = backupPlayer.userData.geo.radius !== undefined ? backupPlayer.userData.geo.radius : 0.3;
                        const h = backupPlayer.userData.geo.height !== undefined ? backupPlayer.userData.geo.height : 1.2;
                        newPlayer.geometry.dispose();
                        newPlayer.geometry = new THREE.CapsuleGeometry(r, h, 4, 8);
                    }
                }
            }
            if (backupCamera) {
                const newCamera = this.objects.find(o => o.userData && o.userData.isCamera);
                if (newCamera) {
                    newCamera.position.fromArray(backupCamera.p);
                    newCamera.rotation.fromArray(backupCamera.r);
                    newCamera.scale.fromArray(backupCamera.s);
                    newCamera.userData = backupCamera.userData;
                    const threeCam = newCamera.getObjectByProperty('type', 'PerspectiveCamera') || newCamera.children.find(c => c.isCamera);
                    if (threeCam && backupCamera.userData.fov) {
                        threeCam.fov = backupCamera.userData.fov;
                        threeCam.updateProjectionMatrix();
                    }
                }
            }

            // Se non c'è il Player, creane uno di default
            const hasPlayer = this.objects.some(o => o.userData && o.userData.isPlayer);
            if (!hasPlayer) {
                const player = PlayerFactory.createPlayer(this.objects.length);
                player.position.set(0, 0.9, 0);
                this.addObject(player, false);
            }
            
            if (this.app.ui) {
                this.app.ui.rebuildLibrary();
                if (this.app.ui.collapseAll) this.app.ui.collapseAll();
                this.app.ui.update();
            }
            this.updateLinks();
            
            console.log("[Editor] Dati .wscene caricati con successo!");
        } catch (err) {
            console.error("[Editor] Errore in loadWSceneData:", err);
        }
    }

    setupBlenderSync() {
        const streamUrl = `/api/blender-sync-stream`;
        console.log(`[Editor] Apertura connessione Blender Live-Sync stream su ${streamUrl}`);
        
        const eventSource = new EventSource(streamUrl);
        
        eventSource.onmessage = async (event) => {
            try {
                if (!event || !event.data) return;
                let payload;
                try {
                    payload = JSON.parse(event.data);
                } catch (err) {
                    return;
                }
                if (!payload || typeof payload !== 'object') return;
                const { projectName, levelIndex, wscene, projectConfig } = payload;
                
                const activeProj = this.projectName || 'default_project';
                const isMatch = (projectName === activeProj) || (activeProj === 'default_project') || (projectName === 'default_project');
                
                if (isMatch) {
                    console.log(`[Editor] Ricevuto live sync da Blender per il progetto "${projectName}" (Progetto attivo Editor: "${activeProj}")`);
                    
                    // Se il server ha inviato la configurazione aggiornata dei livelli del progetto
                    if (projectConfig && Array.isArray(projectConfig.levels)) {
                        const existingLevels = Array.isArray(this.levels) ? this.levels : [];
                        this.levels = projectConfig.levels.map((lvl, idx) => ({
                            name: lvl.name,
                            music: lvl.music || '',
                            musicFilename: lvl.musicFilename || '',
                            isExternal: !!lvl.isExternal,
                            externalFilename: lvl.externalFilename || '',
                            data: existingLevels[idx] ? existingLevels[idx].data : undefined
                        }));
                    }
                    
                    // Assicurati che lo slot del livello esista e aggiornalo in memoria
                    if (!Array.isArray(this.levels)) this.levels = [];
                    if (levelIndex >= 0) {
                        if (!this.levels[levelIndex]) {
                            this.levels[levelIndex] = {
                                name: `Blender Sync ${levelIndex + 1}`,
                                music: '',
                                musicFilename: ''
                            };
                        }
                        // Clean base64 GLB payload before stringifying to prevent V8 memory explosion & Chrome crash
                        const wsceneCopy = Object.assign({}, wscene);
                        delete wsceneCopy.glb;
                        this.levels[levelIndex].data = JSON.stringify(wsceneCopy);
                        this.currentLevelIndex = levelIndex;
                    }
                    
                    await this.loadWSceneData(wscene);
                    
                    if (this.app.ui) {
                        if (this.app.ui.renderLevelList) this.app.ui.renderLevelList();
                        if (this.app.ui.showToast) {
                            this.app.ui.showToast(`🔄 Scena aggiornata da Blender per Livello ${levelIndex + 1}!`);
                        }
                    }
                } else {
                    console.warn(`[Editor] Live sync ignorato: ricevuto per "${projectName}", ma l'editor è su "${activeProj}"`);
                }
            } catch (e) {
                console.error("[Editor] Errore elaborazione messaggio blender-sync:", e);
            }
        };
        
        eventSource.onerror = (err) => {
            console.warn("[Editor] Errore connessione Blender Sync SSE. In attesa di riconnessione...", err);
        };
    }
}
