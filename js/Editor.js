import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { PlayerFactory } from './Player.js';

export class Editor {
    constructor(app) {
        this.app = app;
        this.objects = [];
        this.selected = null;
        this.history = [];
        this.hIndex = -1;
        this.loader = new GLTFLoader();
        this.clipboard = null;

        // Raycaster
        this.raycaster = new THREE.Raycaster();
        this.raycaster.params.Line.threshold = 0.2;
        this.mouse = new THREE.Vector2();

        this.mixer = null;
        this.clock = new THREE.Clock();
        this.currentAnim = null;
    }

    init() {
        const { camera, renderer, viewport } = this.app.sceneManager;

        this.orbit = new OrbitControls(camera, renderer.domElement);
        this.gizmo = new TransformControls(camera, renderer.domElement);
        this.gizmo.size = 0.5;
        this.gizmo.userData.isHelper = true; // Mark as helper to ignore in game raycasts

        // Enable Snapping by default
        this.gizmo.setTranslationSnap(0.5);
        this.gizmo.setRotationSnap(THREE.MathUtils.degToRad(5));
        this.gizmo.setScaleSnap(0.1);

        this.app.sceneManager.scene.add(this.gizmo);

        this.linkGroup = new THREE.Group();
        this.app.sceneManager.scene.add(this.linkGroup);

        this.addCamera();

        this.gizmo.addEventListener('change', () => this.updateLinks());

        let transformStartData = null;
        this.gizmo.addEventListener('dragging-changed', (e) => {
            this.orbit.enabled = !e.value;
            if (e.value) {
                // Drag Start
                if (this.gizmo.object) {
                    transformStartData = {
                        p: this.gizmo.object.position.clone(),
                        r: this.gizmo.object.rotation.clone(),
                        s: this.gizmo.object.scale.clone()
                    };
                }
            } else {
                // Drag End
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
            if (e.key.toLowerCase() === 'f') this.focusSelected();
            if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); }
            if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
            if (e.ctrlKey && e.key.toLowerCase() === 'c') { e.preventDefault(); this.copy(); }
            if (e.ctrlKey && e.key.toLowerCase() === 'v') { e.preventDefault(); this.paste(); }
            if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveProject(); }
        });
    }

    copy() {
        if (!this.selected) return;
        try {
            this.clipboard = SkeletonUtils.clone(this.selected);
        } catch (e) {
            this.clipboard = this.selected.clone();
        }
        // Deep copy userData to avoid reference issues
        this.clipboard.userData = JSON.parse(JSON.stringify(this.selected.userData));
        this.clipboard.applyMatrix4(this.selected.matrixWorld); // Bake transform? No, position/rot are copied by clone usually.
        // Wait, clone copies local transform. matrixWorld isn't needed.
        // Just need to ensure rotation/position are correct.
        this.clipboard.position.copy(this.selected.position);
        this.clipboard.rotation.copy(this.selected.rotation);
        this.clipboard.scale.copy(this.selected.scale);
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

        // Restore ArrowHelper if needed (cloning might lose it or duplicate it weirdly?)
        // SkeletonUtils.clone usually clones children too.
        // ArrowHelper is a child.

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
            // Force gizmo update if attached
            if (this.gizmo.object === action.object) {
                // Detach/Attach forces refresh? Or just position update handles it.
                // TransformControls updates automatically usually.
            }
        }
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

        // Clean up ArrowHelper
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
        const hits = this.raycaster.intersectObjects(this.app.sceneManager.scene.children, true);

        if (hits.length) {
            let target = hits[0].object;
            // Find the root parent that is in our tracked objects list
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
        if (obj) this.gizmo.attach(obj);
        else this.gizmo.detach();
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

        const type = this.selected.userData.type;
        const data = this.selected.userData.glbSource || null;
        const isAsset = this.selected.userData.isAsset;

        this.app.sceneManager.scene.remove(this.selected);
        const idx = this.objects.indexOf(this.selected);
        if (idx > -1) this.objects.splice(idx, 1);
        this.gizmo.detach();
        this.selected = null;

        this.app.ui.rebuildLibrary();
        this.app.ui.update();
    }

    addObject(obj) {
        this.objects.push(obj);
        this.app.sceneManager.scene.add(obj);
        this.select(obj);
    }

    loadGLB(url, onLoaded) {
        if (!this.selected) return;
        this.loader.load(url, (gltf) => {
            const old = this.selected.getObjectByName('model');
            if (old) this.selected.remove(old);

            const m = gltf.scene;
            m.name = 'model';

            // Default Scale 1
            m.scale.set(1, 1, 1);

            // Smart Offset: Bottom of hitbox
            let height = 2.0;
            if (this.selected.geometry?.parameters) {
                const p = this.selected.geometry.parameters;
                if (p.height) height = p.height + (p.radius ? p.radius * 2 : 0); // Capsule or Box
            }
            m.position.y = -height / 2;

            this.selected.add(m);
            this.selected.animations = gltf.animations;
            this.selected.userData.anims = gltf.animations.map(a => a.name);
            this.selected.userData.glbSource = url;

            this.autoMapPlayerAnimations(this.selected);

            // Apply material fixes
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
        this.loader.load(url, (gltf) => {
            const old = obj.getObjectByName('model');
            if (old) obj.remove(old);
            const m = gltf.scene;
            m.name = 'model';

            // Smart Offset if not saved OR if saved offset is 0 (suspicious) for grounded entities
            let useSmartOffset = !obj.userData.modelOffset;
            if (obj.userData.modelOffset && (obj.userData.type === 'Enemy' || obj.userData.isPlayer)) {
                if (Math.abs(obj.userData.modelOffset[1]) < 0.001) useSmartOffset = true;
            }

            if (!useSmartOffset) {
                m.position.fromArray(obj.userData.modelOffset);
            } else {
                // For 'Model' type (Group), default to 0 offset if no geometry parameters
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

            // Restore rotation/scale
            if (obj.userData.modelRotation) m.rotation.fromArray(obj.userData.modelRotation);

            if (obj.userData.modelScale) {
                m.scale.fromArray(obj.userData.modelScale);
            } else {
                // Default scale 1 for Model, 0.5 for legacy/others
                if (obj.userData.type === 'Model') m.scale.set(1, 1, 1);
                else m.scale.set(0.5, 0.5, 0.5);
            }

            obj.add(m);
            obj.animations = gltf.animations;
            if (obj.userData.isPlayer) {
                obj.userData.anims = gltf.animations.map(a => a.name);
                this.autoMapPlayerAnimations(obj);
            } else if (obj.userData.type === 'Model' || obj.userData.type === 'Enemy' || obj.userData.type === 'Bonus') {
                // Ensure anims list is available for all animated types
                obj.userData.anims = gltf.animations.map(a => a.name);
            }

            // Apply material fixes
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

    spawnAsset(type, data, clientX, clientY, defaultAnim = null) {
        const rect = this.app.sceneManager.viewport.getBoundingClientRect();
        this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.app.sceneManager.camera);

        // Improved target filtering for recursive raycast
        const targets = this.app.sceneManager.scene.children.filter(o => {
            if (o.userData.isHelper || o.userData.isCamera) return false;
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

        if (type === 'Model' && data) {
            this.loader.load(data, (gltf) => {
                const m = gltf.scene;
                const wrapper = new THREE.Group();
                wrapper.position.copy(pos); // Place exactly at hit point
                wrapper.name = "Model_" + this.objects.length;
                wrapper.userData = { isAsset: true, type: 'Model', glbSource: data };
                if (defaultAnim) wrapper.userData.defaultAnim = defaultAnim;

                m.position.y = 0;
                wrapper.add(m);
                wrapper.animations = gltf.animations;
                wrapper.userData.anims = gltf.animations.map(a => a.name);

                wrapper.add(m);
                wrapper.animations = gltf.animations;
                wrapper.userData.anims = gltf.animations.map(a => a.name);

                // Defaults
                wrapper.userData.alphaMode = 'mask';
                wrapper.userData.alphaTest = 0.5;
                wrapper.userData.doubleSide = true;
                this.updateMaterialSettings(m);

                this.addObject(wrapper);
            });
            return;
        }

        let geo, mat = new THREE.MeshStandardMaterial({ color: 0x888888, wireframe: true, transparent: true, opacity: 0.5 });
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
            case 'Collision':
                geo = new THREE.BoxGeometry(1, 1, 1);
                mat = new THREE.MeshBasicMaterial({ color: 0x22ff22, wireframe: true, transparent: true, opacity: 0.3 });
                break;
            default: geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        }
        const mesh = new THREE.Mesh(geo, mat);

        // Calculate offset for basic shapes
        let heightOffset = 0.5;
        if (geo.parameters) {
            if (geo.parameters.height) heightOffset = geo.parameters.height / 2;
            else if (geo.parameters.radius) heightOffset = geo.parameters.radius;
        }
        mesh.position.copy(pos).y += heightOffset;

        mesh.name = type + "_" + this.objects.length;
        mesh.userData = { isAsset: true, type: type };

        if (type === 'Bonus') {
            mesh.userData.radius = 1.0;
            mesh.userData.points = 100;
            mesh.userData.disappearOnCollect = true;
        }

        if (type === 'Collision') {
            mesh.userData.actionType = 'restart'; // Default action
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

        // Position
        const rect = this.app.sceneManager.viewport.getBoundingClientRect();
        this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.app.sceneManager.camera);

        const targets = this.app.sceneManager.scene.children.filter(o => {
            if (o.userData.isHelper || o.userData.isCamera) return false;
            if (o.type.includes('Light') || o.type.includes('Camera') || o.type === 'GridHelper' || o.type === 'TransformControls') return false;
            return true;
        });

        const hits = this.raycaster.intersectObjects(targets, true);
        let pos = new THREE.Vector3(0, 0, 0);
        if (hits.length > 0) pos.copy(hits[0].point);
        else this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pos);

        // Adjust Y
        if (clone.userData.isPlayer) {
            pos.y += 1;
        } else if (clone.userData.type !== 'Model') {
            // Basic shapes offset
            let heightOffset = 0.5;
            if (clone.geometry && clone.geometry.parameters) {
                const p = clone.geometry.parameters;
                if (p.height) heightOffset = p.height / 2;
                else if (p.radius) heightOffset = p.radius;
            }
            pos.y += heightOffset;
        }
        clone.position.copy(pos);

        // Name
        const match = source.name.match(/^(.*?)[\._]?(\d+)$/);
        if (match) {
            const prefix = match[1];
            const num = parseInt(match[2]) + 1;
            const padding = Math.max(match[2].length, 3);
            clone.name = `${prefix}.${num.toString().padStart(padding, '0')}`;
        } else {
            clone.name = source.name + ".001";
        }

        // Clean up ArrowHelper
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

    saveProject() {
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
                    objData.geo = {
                        radius: p.radius,
                        height: p.height !== undefined ? p.height : p.length,
                        width: p.width,
                        depth: p.depth
                    };
                }
                return objData;
            }),
            library: this.app.ui.library || []
        };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
        a.download = 'project.json'; a.click();
    }

    loadProject(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const rootData = JSON.parse(e.target.result);
                const sceneData = rootData.scene || rootData;
                this.clearScene();
                if (this.app.ui.restoreLibrary) this.app.ui.restoreLibrary(rootData.library || []);

                // Ensure Player is always the first asset in the library
                const playerExists = this.app.ui.library.find(item => item.type === 'Player');
                if (!playerExists) {
                    this.app.ui.createAssetCard('Player', 'Player', null, true);
                    // Move to front if needed (createAssetCard appends, so we might need to re-sort or just trust the manual call first)
                    const last = this.app.ui.library.pop();
                    this.app.ui.library.unshift(last);
                    this.app.ui.restoreLibrary(this.app.ui.library);
                }

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
                        } else {
                            let geo, mat = new THREE.MeshStandardMaterial({ color: 0x888888, wireframe: true, transparent: true, opacity: 0.5 });
                            switch (type) {
                                case 'Enemy':
                                    const ew = (d.geo && d.geo.width !== undefined) ? d.geo.width : 0.8;
                                    const eh = (d.geo && d.geo.height !== undefined) ? d.geo.height : 0.8;
                                    const ed = (d.geo && d.geo.depth !== undefined) ? d.geo.depth : 0.8;
                                    geo = new THREE.BoxGeometry(ew, eh, ed);
                                    mat.color.setHex(0xff6600);
                                    break;
                                case 'Bonus':
                                    const radius = uData.radius || 0.4;
                                    geo = new THREE.SphereGeometry(radius);
                                    mat.color.setHex(0xFFD700);
                                    break;
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
                                    uData.isAsset = true; // Ensure PowerUps are tracked as assets
                                    break;
                                case 'Collision':
                                    const cw = (d.geo && d.geo.width !== undefined) ? d.geo.width : 1.0;
                                    const ch = (d.geo && d.geo.height !== undefined) ? d.geo.height : 1.0;
                                    const cd = (d.geo && d.geo.depth !== undefined) ? d.geo.depth : 1.0;
                                    geo = new THREE.BoxGeometry(cw, ch, cd);
                                    mat = new THREE.MeshBasicMaterial({ color: 0x22ff22, wireframe: true, transparent: true, opacity: 0.3 });
                                    break;
                                default: geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
                            }
                            obj = new THREE.Mesh(geo, mat);
                        }
                    } else obj = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x888888 }));

                    obj.name = d.name; obj.position.fromArray(d.p); obj.rotation.fromArray(d.r); obj.scale.fromArray(d.s);
                    obj.userData = uData;

                    if (d.modelOffset) obj.userData.modelOffset = d.modelOffset;
                    if (d.modelRotation) obj.userData.modelRotation = d.modelRotation;
                    if (d.modelScale) obj.userData.modelScale = d.modelScale;

                    // Restore Helpers
                    if (obj.userData.type === 'Enemy') {
                        const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 1.5, 0xff0000);
                        arrow.name = 'ArrowHelper';
                        obj.add(arrow);
                    } else if (obj.userData.type === 'catcher_target') {
                        const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 1.5, 0xffff00);
                        arrow.name = 'ArrowHelper';
                        obj.add(arrow);
                    }

                    this.objects.push(obj); this.app.sceneManager.scene.add(obj);

                    if (obj.userData.glbSource) {
                        this.reloadModel(obj, obj.userData.glbSource, (m) => {
                            if (this.selected === obj && obj.userData.isPlayer) this.app.ui.generateThumbnail(m, 'glb-preview-img');
                        });
                    }
                });

                this.app.ui.rebuildLibrary();
                this.app.ui.update();
                this.updateLinks();
            } catch (err) { console.error(err); }
        };
        reader.readAsText(file);
    }

    updateMaterialSettings(obj) {
        if (!obj) return;
        const alphaMode = obj.userData.alphaMode || 'mask'; // mask, blend, opaque
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
                    child.material.depthWrite = false; // Usually better for blending to avoid sorting artifacts, though can cause order issues
                } else {
                    // Opaque
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
        this.objects.forEach(o => this.app.sceneManager.scene.remove(o));
        this.objects = []; this.history = []; this.hIndex = -1;
    }
}
