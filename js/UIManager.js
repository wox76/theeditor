import { PlayerFactory } from './Player.js';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class UIManager {
    constructor(app) {
        this.app = app;
        this.actionTypes = ['Idle', 'Walk', 'Run', 'Jump', 'Death', 'Attack', 'Shooting'];
        this.library = []; 
        this.isDropping = false;
        this.thumbRenderer = null;
    }

    init() {
        this.setupToolbar();
        this.setupPanels();
        this.setupInputs();
        this.setupResizers();
        this.setupAssetManager();
        this.setupEquipPreview();
    }

    rebuildLibrary() {
        const newLib = [];
        this.app.editor.objects.forEach(obj => {
             if (obj.userData.isAsset || obj.userData.isPlayer) {
                 const name = obj.name;
                 const type = obj.userData.type || (obj.userData.isPlayer ? 'Player' : 'Unknown');
                 const data = obj.userData.glbSource || null;
                 const defaultAnim = obj.userData.defaultAnim || null;
                 
                 const exists = newLib.find(i => i.name === name && i.type === type && i.data === data);
                 if (!exists) {
                     newLib.push({ name, type, data, defaultAnim });
                 }
             }
        });
        
        const playerIdx = newLib.findIndex(i => i.type === 'Player');
        if (playerIdx > 0) {
            const p = newLib.splice(playerIdx, 1)[0];
            newLib.unshift(p);
        }
        
        this.library = newLib;
        this.restoreLibrary(this.library);
    }

    restoreLibrary(libraryData) {
        this.library = [];
        const content = document.getElementById('asset-content');
        content.innerHTML = '';
        if (libraryData) {
            libraryData.forEach(item => this.createAssetCard(item.name, item.type, item.data, true, item.defaultAnim));
        }
    }

    setupAssetManager() {
        const btnAdd = document.getElementById('btn-add-asset-trigger');
        const menu = document.getElementById('asset-menu');
        const viewport = document.getElementById('viewport');

        btnAdd.onclick = (e) => {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
            const rect = btnAdd.getBoundingClientRect();
            menu.style.left = rect.left + 'px';
            menu.style.bottom = (window.innerHeight - rect.top) + 'px';
        };

        window.addEventListener('click', () => menu.style.display = 'none');

        menu.querySelectorAll('.asset-menu-item').forEach(item => {
            item.onclick = (e) => {
                const type = e.target.dataset.type;
                if (type === 'Player') {
                    this.createAssetCard('Player', 'Player', null, true);
                } else if (type === 'load') {
                    const input = document.createElement('input');
                    input.type = 'file'; input.accept = '.glb,.gltf';
                    input.onchange = (ev) => {
                        const file = ev.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (f) => this.createAssetCard(file.name, 'Model', f.target.result, true);
                            reader.readAsDataURL(file);
                        }
                    };
                    input.click();
                } else this.createAssetCard(type, type, null, true);
            };
        });

        viewport.addEventListener('dragover', (e) => e.preventDefault());
        viewport.addEventListener('drop', (e) => {
            e.preventDefault();
            if (this.isDropping) return;
            this.isDropping = true;
            setTimeout(() => this.isDropping = false, 100);

            const type = e.dataTransfer.getData('asset-type');
            const data = e.dataTransfer.getData('asset-data');
            const name = e.dataTransfer.getData('asset-name');
            const defaultAnim = e.dataTransfer.getData('asset-default-anim');
            
            if (name) {
                 const sourceObj = this.app.editor.objects.find(o => o.name === name);
                 if (sourceObj) {
                     this.app.editor.duplicateObject(sourceObj, e.clientX, e.clientY);
                     return;
                 }
            }

            if (type) this.app.editor.spawnAsset(type, data, e.clientX, e.clientY, defaultAnim);
        });
    }

    createAssetCard(name, type, data = null, addToLibraryArray = false, defaultAnim = null) {
        if (addToLibraryArray) {
            const exists = this.library.find(item => item.name === name && item.type === type && item.data === data);
            if (!exists) this.library.push({ name, type, data, defaultAnim });
        }

        const content = document.getElementById('asset-content');
        const card = document.createElement('div');
        // ... (rest of function)
        card.className = 'asset-card'; card.draggable = true;
        
        let color = '#555', icon = '📦';
        if (type === 'Enemy') color = '#ff6600', icon = '👿';
        if (type === 'Bonus') color = '#FFD700', icon = '⭐';
        if (type === 'Boss') color = '#cc0000', icon = '👹';
        if (type === 'Catcher') color = '#5500aa', icon = '🥅';
        if (type === 'Spawn') color = '#aa5500', icon = '🏁';
        if (type === 'Goal') color = '#D4AF37', icon = '🏆';
        if (type === 'PowerUp') color = '#00cccc', icon = '⚡';
        if (type === 'Collision') color = '#22ff22', icon = '🚧';
        if (type === 'Model') color = '#2f5d8e', icon = '🧊';

        card.style.borderColor = color;
        const thumbId = `thumb-${Math.floor(Math.random()*1000000)}`;
        card.innerHTML = `
            <div class="asset-icon" id="icon-${thumbId}">${icon}</div>
            <div style="font-size:9px; font-weight:bold; color:#888; margin-top:4px;">${type}</div>
            <div class="asset-label" style="color:${color}">${name}</div>
        `;

        if (data) {
            new GLTFLoader().load(data, (gltf) => {
                const iconDiv = card.querySelector('.asset-icon');
                // Ensure iconDiv still exists (card might be removed)
                if (iconDiv) {
                    const imgId = `img-${thumbId}`;
                    iconDiv.innerHTML = `<img id="${imgId}" style="width:100%; height:100%; object-fit:contain;">`;
                    this.generateThumbnail(gltf.scene, imgId);
                }
            });
        }

        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('asset-type', type);
            e.dataTransfer.setData('asset-name', name);
            if (data) e.dataTransfer.setData('asset-data', data);
            if (defaultAnim) e.dataTransfer.setData('asset-default-anim', defaultAnim);
        });
        content.appendChild(card);
    }

    removeAsset(type, data) {
        if (type === 'Player') return; // Always keep Player

        const idx = this.library.findIndex(item => item.type === type && item.data === data);
        if (idx > -1) {
            this.library.splice(idx, 1);
            // Refresh UI
            this.restoreLibrary(this.library);
        }
    }

    setupResizers() {
        this.initResizer('resizer-left', 'x', 'left-panel', false);
        this.initResizer('resizer-right', 'x', 'right-panel', true);
        this.initResizer('resizer-bottom', 'y', 'asset-manager', true);
        this.initResizer('resizer-split', 'y', 'outliner-panel', false);
    }

    initResizer(resizerId, dir, targetId, inverse) {
        const resizer = document.getElementById(resizerId), target = document.getElementById(targetId);
        if (!resizer || !target) return;
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startX = e.clientX, startY = e.clientY, startW = target.offsetWidth, startH = target.offsetHeight;
            const onMove = (mv) => {
                if (dir === 'x') target.style.width = Math.max(50, startW + (inverse ? startX - mv.clientX : mv.clientX - startX)) + 'px';
                else target.style.height = Math.max(50, startH + (inverse ? startY - mv.clientY : mv.clientY - startY)) + 'px';
            };
            const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
            document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        });
    }

    setupToolbar() {
        document.getElementById('btn-undo').onclick = () => this.app.editor.undo();
        document.getElementById('btn-trans').onclick = () => { this.app.editor.gizmo.setMode('translate'); this.setActiveTool('btn-trans'); };
        document.getElementById('btn-rot').onclick = () => { this.app.editor.gizmo.setMode('rotate'); this.setActiveTool('btn-rot'); };
        document.getElementById('btn-scale').onclick = () => { this.app.editor.gizmo.setMode('scale'); this.setActiveTool('btn-scale'); };
        document.getElementById('btn-delete').onclick = () => this.app.editor.deleteSelected();
        document.getElementById('btn-save').onclick = () => this.app.editor.saveProject();
        
        document.getElementById('snap-trans').onchange = (e) => this.app.editor.setTranslationSnap(e.target.checked);
        document.getElementById('snap-rot').onchange = (e) => this.app.editor.setRotationSnap(e.target.checked);
        document.getElementById('snap-scale').onchange = (e) => this.app.editor.setScaleSnap(e.target.checked);

        // Global Key Listener
        window.addEventListener('keydown', (e) => {
            if (this.app.game && this.app.game.isPlaying) {
                if (e.key === ' ' || e.code === 'Space') e.preventDefault();
                if (e.key === 'Escape') {
                    this.app.game.stop();
                    const btnPlay = document.getElementById('btn-play');
                    if (btnPlay) btnPlay.classList.remove('play-active');
                }
                return; 
            }
            if (e.key === 'Delete') this.app.editor.deleteSelected();
        });

        const btnPlay = document.getElementById('btn-play');
        btnPlay.onclick = (e) => {
            e.currentTarget.blur();
            if (this.app.game.isPlaying) {
                this.app.game.stop();
                btnPlay.classList.remove('play-active');
            } else {
                this.app.game.start();
                btnPlay.classList.add('play-active');
            }
        };
        
        document.getElementById('project-load-input').onchange = (e) => {
            const file = e.target.files[0];
            if (file) { this.app.editor.loadProject(file); e.target.value = ''; }
        };
    }

    setActiveTool(id) {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        const el = document.getElementById(id); if(el) el.classList.add('active');
    }

    setupPanels() {
        document.getElementById('btn-game-props').onclick = () => { this.app.editor.select(null); document.getElementById('section-game').classList.remove('hidden'); };
        document.getElementById('btn-import').onclick = () => document.getElementById('glb-input').click();
        document.getElementById('glb-input').onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const dataUrl = ev.target.result;
                    const container = document.getElementById('glb-preview-container'), nameInput = document.getElementById('glb-filename');
                    if (container) container.style.display = 'flex';
                    if (nameInput) nameInput.value = file.name;
                    if (this.app.editor.selected) this.app.editor.selected.userData.glbFilename = file.name;
                    this.app.editor.loadGLB(dataUrl, (m) => this.generateThumbnail(m, 'glb-preview-img'));
                };
                reader.readAsDataURL(file);
            }
        };
        const btnAlign = document.getElementById('btn-align-view');
        if (btnAlign) {
            btnAlign.onclick = () => {
                const selected = this.app.editor.selected;
                if (selected && selected.userData.isCamera) {
                    const editorCam = this.app.sceneManager.camera;
                    selected.position.copy(editorCam.position);
                    selected.quaternion.copy(editorCam.quaternion);
                    
                    // Also align internal camera object
                    const internalCam = selected.children.find(c => c.isCamera);
                    if (internalCam) {
                        internalCam.rotation.set(0, 0, 0); // Reset internal to match parent wrapper
                    }
                    
                    this.updateProperties(); // Refresh UI
                }
            };
        }
        const btnAddAction = document.getElementById('btn-add-action');
        if (btnAddAction) btnAddAction.onclick = (e) => { e.stopPropagation(); if (this.app.editor.selected?.userData.isPlayer) this.addAction(this.app.editor.selected); };
    }

    setupInputs() {
        document.getElementById('obj-name-input').onchange = (e) => { 
            if (this.app.editor.selected) { 
                this.app.editor.selected.name = e.target.value; 
                this.updateOutliner(); 
                this.rebuildLibrary();
            } 
        };
        
        const axes = ['x', 'y', 'z'];
        axes.forEach(axis => {
            const p = document.getElementById(`t-p${axis}`); if(p) p.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.position[axis] = parseFloat(e.target.value); };
            const r = document.getElementById(`t-r${axis}`); if(r) r.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.rotation[axis] = THREE.MathUtils.degToRad(parseFloat(e.target.value)); };
            const s = document.getElementById(`t-s${axis}`); if(s) s.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.scale[axis] = parseFloat(e.target.value); };
        });

        document.getElementById('p-typology').onchange = (e) => { 
            if (this.app.editor.selected?.userData.isPlayer) { 
                const player = this.app.editor.selected;
                const oldType = player.userData.typology || 'platform';
                const newType = e.target.value;

                // 1. Save current actions to current typology slot
                if (!player.userData.typologyActions) player.userData.typologyActions = {};
                player.userData.typologyActions[oldType] = JSON.parse(JSON.stringify(player.userData.actions || []));

                // 2. Switch typology
                player.userData.typology = newType;

                // 3. Load or Create default actions for new typology
                if (player.userData.typologyActions[newType]) {
                    player.userData.actions = JSON.parse(JSON.stringify(player.userData.typologyActions[newType]));
                } else {
                    // Create Defaults based on typology
                    const defaults = [];
                    if (newType === 'platform') {
                        defaults.push({ name: 'Walk Right', key: 'd', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Walk Left', key: 'a', type: 'Walk', anim: '', mirror: true, active: true });
                        defaults.push({ name: 'Jump', key: ' ', type: 'Jump', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Shoot', key: 'f', type: 'Shooting', anim: '', mirror: false, active: true });
                    } else if (newType === '8WAY') {
                        // 8WAY (Commando style)
                        defaults.push({ name: 'Walk Forward', key: 'w', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Walk Backward', key: 's', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Walk Right', key: 'd', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Walk Left', key: 'a', type: 'Walk', anim: '', mirror: true, active: true });
                        defaults.push({ name: 'Jump', key: ' ', type: 'Jump', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Shoot', key: 'f', type: 'Shooting', anim: '', mirror: false, active: true });
                    } else {
                        // FPS/TPS
                        defaults.push({ name: 'Forward', key: 'w', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Backward', key: 's', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Left', key: 'a', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Right', key: 'd', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Jump', key: ' ', type: 'Jump', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Shoot', key: 'f', type: 'Shooting', anim: '', mirror: false, active: true });
                    }
                    player.userData.actions = defaults;
                }

                this.app.editor.autoMapPlayerAnimations(player);
                this.updateProperties(); 
            } 
        };
        
        // Define ALL variables first
        const pRadius = document.getElementById('p-radius');
        const pHeight = document.getElementById('p-height');
        const pJump = document.getElementById('p-jump');
        const pSpeed = document.getElementById('p-speed');
        const pModelY = document.getElementById('p-modely');
        const btnEditModel = document.getElementById('btn-edit-model-y');

        if (pSpeed) pSpeed.oninput = (e) => { if (this.app.editor.selected?.userData.isPlayer) this.app.editor.selected.userData.speed = parseFloat(e.target.value); };
        if (pJump) pJump.oninput = (e) => { if (this.app.editor.selected?.userData.isPlayer) this.app.editor.selected.userData.jumpForce = parseFloat(e.target.value); };

        const pDoubleJump = document.getElementById('p-doublejump');
        if (pDoubleJump) pDoubleJump.onchange = (e) => { if (this.app.editor.selected?.userData.isPlayer) this.app.editor.selected.userData.doubleJump = e.target.checked; };

        // Pixel Effect Bindings
        const gamePixelEffect = document.getElementById('game-pixel-effect');
        const gamePixelSize = document.getElementById('game-pixel-size');
        if (gamePixelEffect && gamePixelSize) {
            gamePixelEffect.onchange = (e) => {
                this.app.sceneManager.setPixelEffect(e.target.checked, parseFloat(gamePixelSize.value));
            };
            gamePixelSize.onchange = (e) => {
                if (gamePixelEffect.checked) {
                    this.app.sceneManager.setPixelEffect(true, parseFloat(e.target.value));
                }
            };
        }

        if (pModelY && btnEditModel) {
            pModelY.oninput = (e) => {
                if (this.app.editor.selected?.userData.isPlayer) {
                    const model = this.app.editor.selected.getObjectByName('model');
                    if (model) model.position.y = parseFloat(e.target.value);
                }
            };
            btnEditModel.onclick = (e) => {
                const selected = this.app.editor.selected; if (!selected?.userData.isPlayer) return;
                const model = selected.getObjectByName('model'); if (!model) return;
                const isActive = e.currentTarget.classList.toggle('active');
                this.app.editor.gizmo.attach(isActive ? model : selected);
            };
            this.app.editor.gizmo.addEventListener('change', () => {
                if (document.getElementById('btn-edit-model-y').classList.contains('active')) {
                    const model = this.app.editor.gizmo.object;
                    if (model) document.getElementById('p-modely').value = model.position.y.toFixed(2);
                }
            });
        }
        
        if (pRadius && pHeight) {
            const updateCapsule = () => {
                if (this.app.editor.selected?.userData.isPlayer) {
                    const r = parseFloat(pRadius.value);
                    const h = parseFloat(pHeight.value);
                    if (!isNaN(r) && !isNaN(h) && r > 0 && h > 0) {
                        const oldParams = this.app.editor.selected.geometry.parameters;
                        const oldBottom = -((oldParams.length || oldParams.height)/2 + oldParams.radius);
                        const newBottom = -(h/2 + r);
                        const delta = newBottom - oldBottom;

                        this.app.editor.selected.geometry.dispose();
                        this.app.editor.selected.geometry = new THREE.CapsuleGeometry(r, h, 4, 8);
                        
                        const model = this.app.editor.selected.getObjectByName('model');
                        if (model) {
                            model.position.y += delta;
                            const el = document.getElementById('p-modely');
                            if (el) el.value = model.position.y.toFixed(2);
                        }
                    }
                }
            };
            pRadius.onchange = updateCapsule;
            pHeight.onchange = updateCapsule;
        }

        // Generic Property Binder
        const bindProp = (id, key, targetType, parser = v => v) => {
            const el = document.getElementById(id);
            if (el) el.onchange = (e) => {
                if (this.app.editor.selected?.userData.type === targetType) {
                    this.app.editor.selected.userData[key] = parser(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
                }
            };
        };

        // Generic Asset Loader
        const setupLoader = (btnId, type, prefix) => {
            const btn = document.getElementById(btnId);
            if (btn) btn.onclick = () => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = '.glb,.gltf';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file && this.app.editor.selected?.userData.type === type) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            this.app.editor.selected.userData.glbFilename = file.name;
                            this.app.editor.loadGLB(ev.target.result, (m) => {
                                this.generateThumbnail(m, `${prefix}-glb-preview-img`);
                                document.getElementById(`${prefix}-glb-preview-container`).style.display = 'flex';
                                this.updateProperties();
                            });
                        };
                        reader.readAsDataURL(file);
                    }
                };
                input.click();
            };
        };

        // Generic Model Edit
        const setupModelEdit = (btnId, inputId) => {
            const btn = document.getElementById(btnId);
            if (btn) btn.onclick = (e) => {
                const selected = this.app.editor.selected; if (!selected) return;
                const model = selected.getObjectByName('model'); if (!model) return;
                const isActive = e.currentTarget.classList.toggle('active');
                this.app.editor.gizmo.attach(isActive ? model : selected);
            };
            this.app.editor.gizmo.addEventListener('change', () => {
                if (document.getElementById(btnId)?.classList.contains('active')) {
                    const model = this.app.editor.gizmo.object;
                    if (model && document.getElementById(inputId)) {
                        document.getElementById(inputId).value = model.position.y.toFixed(2);
                    }
                }
            });
            const inp = document.getElementById(inputId);
            if (inp) inp.oninput = (e) => {
                const model = this.app.editor.selected?.getObjectByName('model');
                if (model) model.position.y = parseFloat(e.target.value);
            };
        };

        // Enemy
        bindProp('e-hp', 'hp', 'Enemy', parseInt);
        bindProp('e-movestyle', 'moveStyle', 'Enemy');
        const eMoveStyle = document.getElementById('e-movestyle');
        if (eMoveStyle) eMoveStyle.addEventListener('change', (e) => {
             const panel = document.getElementById('panel-enemy-follower');
             if (panel) panel.classList.toggle('hidden', e.target.value !== 'follower');
        });

        bindProp('e-speed', 'speed', 'Enemy', parseFloat);
        bindProp('e-patrol', 'patrolRange', 'Enemy', parseFloat);
        bindProp('e-physics', 'hasPhysics', 'Enemy');
        bindProp('e-freeze', 'isFrozen', 'Enemy');
        bindProp('e-can-stomp', 'canStomp', 'Enemy');
                bindProp('e-anim-idle', 'animIdle', 'Enemy');
                bindProp('e-anim-move', 'animMove', 'Enemy');
                bindProp('e-anim-hit', 'animHit', 'Enemy');
                bindProp('e-anim-death', 'animDeath', 'Enemy');
                bindProp('e-no-col', 'noCollision', 'Enemy');
        
                // Follower Properties        bindProp('e-f-target', 'followerTarget', 'Enemy');
        bindProp('e-f-proximity', 'followerProximity', 'Enemy', parseFloat);
        bindProp('e-f-stop-dist', 'followerStopDist', 'Enemy', parseFloat);
        bindProp('e-f-stop-col', 'followerStopCol', 'Enemy');
        ['x', 'y', 'z'].forEach(axis => {
            bindProp(`e-f-t${axis}`, `followerTrans${axis.toUpperCase()}`, 'Enemy');
            bindProp(`e-f-r${axis}`, `followerRot${axis.toUpperCase()}`, 'Enemy');
        });

        setupLoader('btn-enemy-import', 'Enemy', 'e');
        setupModelEdit('btn-edit-e-modely', 'e-modely');

        // Bonus
        bindProp('b-points', 'points', 'Bonus', parseInt);
        const bRadius = document.getElementById('b-radius');
        if (bRadius) {
            bRadius.onchange = (e) => {
                const sel = this.app.editor.selected;
                if (sel?.userData.type === 'Bonus') {
                    const newR = parseFloat(e.target.value);
                    if (!isNaN(newR) && newR > 0) {
                        sel.userData.radius = newR;
                        if (sel.geometry && sel.geometry.type === 'SphereGeometry') {
                            sel.geometry.dispose();
                            sel.geometry = new THREE.SphereGeometry(newR);
                        }
                    }
                }
            };
        }
        bindProp('b-movestyle', 'moveStyle', 'Bonus');
        bindProp('b-speed', 'speed', 'Bonus', parseFloat);
        bindProp('b-patrol', 'patrolRange', 'Bonus', parseFloat);
        bindProp('b-anim-idle', 'animIdle', 'Bonus');
        bindProp('b-anim-collect', 'animCollect', 'Bonus');
        bindProp('b-disappear', 'disappearOnCollect', 'Bonus');
        bindProp('b-no-col', 'noCollision', 'Bonus');
        setupLoader('btn-bonus-import', 'Bonus', 'b');
        setupModelEdit('btn-edit-b-modely', 'b-modely');

        // Boss
        bindProp('bs-hp', 'hp', 'Boss', parseInt);
        bindProp('bs-no-col', 'noCollision', 'Boss');
        setupLoader('btn-boss-import', 'Boss', 'bs');
        setupModelEdit('btn-edit-bs-modely', 'bs-modely');

        // PowerUp
        bindProp('pu-type', 'powerType', 'PowerUp');
        const puType = document.getElementById('pu-type');
        if (puType) {
            puType.addEventListener('change', (e) => {
                const panelGun = document.getElementById('panel-pu-gun');
                const panelLantern = document.getElementById('panel-pu-lantern');
                if (panelGun) panelGun.classList.toggle('hidden', e.target.value !== 'gun');
                if (panelLantern) panelLantern.classList.toggle('hidden', e.target.value !== 'lantern');
            });
        }
        bindProp('pu-bullet-power', 'bulletPower', 'PowerUp', parseInt);
        bindProp('pu-lantern-freeze', 'lanternFreezeDuration', 'PowerUp', parseFloat);
        const btnPuBullet = document.getElementById('btn-pu-bullet-import');
        if (btnPuBullet) {
            btnPuBullet.onclick = () => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = '.glb,.gltf';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file && this.app.editor.selected?.userData.type === 'PowerUp') {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            this.app.editor.selected.userData.bulletGlb = ev.target.result;
                            this.app.editor.selected.userData.bulletFilename = file.name;
                            document.getElementById('pu-bullet-filename').innerText = file.name;
                        };
                        reader.readAsDataURL(file);
                    }
                };
                input.click();
            };
        }
        
        bindProp('pu-dur', 'duration', 'PowerUp', parseFloat);
        bindProp('pu-anim', 'defaultAnim', 'PowerUp');
        bindProp('pu-anim-equip', 'equipAnim', 'PowerUp');
        bindProp('pu-no-col', 'noCollision', 'PowerUp');
        bindProp('pu-offx', 'equipOffsetX', 'PowerUp', parseFloat);
        bindProp('pu-offy', 'equipOffsetY', 'PowerUp', parseFloat);
        bindProp('pu-offz', 'equipOffsetZ', 'PowerUp', parseFloat);
        ['x', 'y', 'z'].forEach(axis => {
            const el = document.getElementById(`pu-rot${axis}`);
            if (el) el.onchange = (e) => {
                if (this.app.editor.selected?.userData.type === 'PowerUp') {
                    if (!this.app.editor.selected.userData.equipRotation) this.app.editor.selected.userData.equipRotation = [0, 0, 0];
                    const val = THREE.MathUtils.degToRad(parseFloat(e.target.value));
                    const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
                    this.app.editor.selected.userData.equipRotation[idx] = val;
                }
            };
        });
        setupLoader('btn-powerup-import', 'PowerUp', 'pu');
        setupModelEdit('btn-edit-pu-modely', 'pu-modely');

        // PowerUp Height & Scale
        const puHeight = document.getElementById('pu-height');
        if (puHeight) {
            puHeight.onchange = (e) => {
                const sel = this.app.editor.selected;
                if (sel?.userData.type === 'PowerUp') {
                    const newH = parseFloat(e.target.value);
                    if (!isNaN(newH) && newH > 0) {
                        const oldParams = sel.geometry.parameters;
                        const oldH = oldParams.height || 0.5;
                        const delta = (newH - oldH) / 2;

                        sel.geometry.dispose();
                        sel.geometry = new THREE.BoxGeometry(oldParams.width || 0.5, newH, oldParams.depth || 0.5);
                        
                        sel.position.y += delta;
                        const model = sel.getObjectByName('model');
                        if (model) {
                            model.position.y -= delta;
                            const el = document.getElementById('pu-modely');
                            if (el) el.value = model.position.y.toFixed(2);
                        }
                    }
                }
            };
        }
        const puModelScale = document.getElementById('pu-model-scale');
        if (puModelScale) {
            puModelScale.oninput = (e) => {
                const m = this.app.editor.selected?.getObjectByName('model');
                if (m) m.scale.setScalar(parseFloat(e.target.value));
            };
        }

        // Collision
        bindProp('col-action', 'actionType', 'Collision');
        bindProp('col-value', 'actionValue', 'Collision');
        
        const btnAddColTarget = document.getElementById('btn-col-add-target');
        if (btnAddColTarget) {
            btnAddColTarget.onclick = () => {
                const sel = this.app.editor.selected;
                const input = document.getElementById('col-target-input');
                if (sel?.userData.type === 'Collision' && input.value) {
                    if (!sel.userData.actionTargets) sel.userData.actionTargets = [];
                    if (!sel.userData.actionTargets.includes(input.value)) {
                        sel.userData.actionTargets.push(input.value);
                        this.renderCollisionTargets(sel);
                        this.updateCollisionAnimList(input.value); // Suggest animations from this target
                        input.value = '';
                    }
                }
            };
        }

        bindProp('col-oneshot', 'oneShot', 'Collision');

        // Spawn
        bindProp('sp-rate', 'spawnRate', 'Spawn', parseFloat);
        setupLoader('btn-spawn-import', 'Spawn', 'sp');
        setupModelEdit('btn-edit-sp-modely', 'sp-modely');

        // Goal
        bindProp('g-no-col', 'noCollision', 'Goal');
        setupLoader('btn-goal-import', 'Goal', 'g');
        setupModelEdit('btn-edit-g-modely', 'g-modely');

        // Catcher
        bindProp('c-filter-type', 'filterType', 'catcher_base');
        bindProp('c-filter-tag', 'filterTag', 'catcher_base');
        bindProp('c-move-type', 'moveType', 'catcher_base');
        bindProp('c-key', 'keyTrigger', 'catcher_base');
        setupLoader('btn-catcher-import', 'catcher_base', 'c');
        setupModelEdit('btn-edit-c-modely', 'c-modely');
        const btnAddTarget = document.getElementById('btn-add-catcher-target');
        if (btnAddTarget) btnAddTarget.onclick = () => this.app.editor.addCatcherTarget();

        // Model
        bindProp('m-anim-default', 'defaultAnim', 'Model');
        bindProp('m-no-col', 'noCollision', 'Model');
        setupLoader('btn-model-import', 'Model', 'm');
        setupModelEdit('btn-edit-m-modely', 'm-modely');

        // Camera Bindings
        const cType = document.getElementById('c-type');
        if (cType) cType.onchange = (e) => { if (this.app.editor.selected?.userData.isCamera) this.app.editor.selected.userData.type = e.target.value; };
        const cFov = document.getElementById('c-fov');
        if (cFov) cFov.onchange = (e) => { 
            if (this.app.editor.selected?.userData.isCamera) {
                this.app.editor.selected.userData.fov = parseFloat(e.target.value);
                const cam = this.app.editor.selected.children.find(c => c.isCamera);
                if (cam) { cam.fov = this.app.editor.selected.userData.fov; cam.updateProjectionMatrix(); }
            }
        };

        // Enemy Height & Hitbox logic
        const eHeight = document.getElementById('e-height');
        if (eHeight) {
            eHeight.onchange = (e) => {
                const sel = this.app.editor.selected;
                if (sel?.userData.type === 'Enemy') {
                    const newH = parseFloat(e.target.value);
                    if (!isNaN(newH) && newH > 0) {
                        const oldParams = sel.geometry.parameters;
                        const oldH = oldParams.height || 0.8;
                        const delta = (newH - oldH) / 2;

                        sel.geometry.dispose();
                        sel.geometry = new THREE.BoxGeometry(oldParams.width || 0.8, newH, oldParams.depth || 0.8);
                        
                        sel.position.y += delta;
                        const model = sel.getObjectByName('model');
                        if (model) {
                            model.position.y -= delta;
                            const el = document.getElementById('e-modely');
                            if (el) el.value = model.position.y.toFixed(2);
                        }
                    }
                }
            };
        }

        const eModelRot = document.getElementById('e-model-roty');
        if (eModelRot) eModelRot.oninput = (e) => {
             const m = this.app.editor.selected?.getObjectByName('model');
             if (m) m.rotation.y = THREE.MathUtils.degToRad(parseFloat(e.target.value));
        };
        const eModelScale = document.getElementById('e-model-scale');
        if (eModelScale) eModelScale.oninput = (e) => {
             const m = this.app.editor.selected?.getObjectByName('model');
             if (m) m.scale.setScalar(parseFloat(e.target.value));
        };
    }

    update() { this.updateOutliner(); this.updateProperties(); }

    updateOutliner() {
        const list = document.getElementById('outliner-list'); list.innerHTML = '';
        this.app.editor.objects.forEach(o => {
            const li = document.createElement('li'); li.className = 'outliner-item' + (this.app.editor.selected === o ? ' selected' : '');
            let icon = '🧊';
            if (o.userData.isPlayer) icon = '👤';
            else if (o.userData.isCamera) icon = '📷';
            else if (o.userData.type === 'Enemy') icon = '👿';
            else if (o.userData.type === 'Bonus') icon = '⭐';
            else if (o.userData.type === 'Boss') icon = '👹';
            else if (o.userData.type === 'PowerUp') icon = '⚡';
            else if (o.userData.type === 'Goal') icon = '🏆';
            else if (o.userData.type === 'Spawn') icon = '🏁';
            
            li.innerText = `${icon} ${o.name}`;
            li.onclick = () => this.app.editor.select(o); list.appendChild(li);
        });
    }

    updateProperties() {
        const selected = this.app.editor.selected;
        // Hide all first
        ['section-transform', 'section-player', 'section-camera', 'section-enemy', 'section-bonus', 'section-boss', 'section-powerup', 'section-spawn', 'section-goal', 'section-catcher', 'section-collision', 'section-model'].forEach(id => {
            const el = document.getElementById(id); if(el) el.classList.add('hidden');
        });
        document.getElementById('section-game').classList.add('hidden');

        if (!selected) return;

        document.getElementById('section-transform').classList.remove('hidden');
        document.getElementById('obj-name-input').value = selected.name;
        ['x', 'y', 'z'].forEach(axis => {
            const p = document.getElementById(`t-p${axis}`); if(p) p.value = selected.position[axis].toFixed(2);
            const r = document.getElementById(`t-r${axis}`); if(r) r.value = THREE.MathUtils.radToDeg(selected.rotation[axis]).toFixed(0);
            const s = document.getElementById(`t-s${axis}`); if(s) s.value = selected.scale[axis].toFixed(2);
        });

        if (selected.userData.isPlayer) {
            document.getElementById('section-player').classList.remove('hidden');
            // ... (rest of player updates handled by existing listeners/initial state but strictly inputs need refreshing)
            // Ideally should refresh inputs here too, but for brevity assuming static binding works for now or existing update logic was replaced?
            // Wait, I replaced 'setupInputs' and 'updateProperties'. The OLD updateProperties logic for Player is GONE if I don't re-include it.
            // I MUST re-include Player update logic.
            const typology = selected.userData.typology || 'platform';
            document.getElementById('p-typology').value = typology;
            document.getElementById('panel-platform').classList.toggle('hidden', typology !== 'platform' && typology !== '8WAY');
            document.getElementById('p-speed').value = selected.userData.speed || 0.4;
            document.getElementById('p-jump').value = (selected.userData.jumpForce || 12.0).toFixed(1);
            const dj = document.getElementById('p-doublejump');
            if (dj) dj.checked = !!selected.userData.doubleJump;
            
            const params = selected.geometry?.parameters || {};
            document.getElementById('p-radius').value = params.radius || 0.5;
            document.getElementById('p-height').value = params.length || params.height || 0.5;

            const model = selected.getObjectByName('model');
            if (model && selected.userData.glbSource) {
                document.getElementById('glb-preview-container').style.display = 'flex';
                document.getElementById('glb-filename').value = selected.userData.glbFilename || "Restored";
                document.getElementById('p-modely').value = model.position.y.toFixed(2);
                const img = document.getElementById('glb-preview-img');
                if (img && (!img.src || img.style.display === 'none')) this.generateThumbnail(model, 'glb-preview-img');
            } else document.getElementById('glb-preview-container').style.display = 'none';
            this.renderActionList(selected);
        }
        else if (selected.userData.isCamera) {
            document.getElementById('section-camera').classList.remove('hidden');
            document.getElementById('c-type').value = selected.userData.type || 'TPS';
            document.getElementById('c-fov').value = selected.userData.fov || 60;
        }
        else {
            const type = selected.userData.type;
            let sectionId = `section-${type.toLowerCase()}`;
            if (type === 'catcher_base') sectionId = 'section-catcher';
            
            const el = document.getElementById(sectionId);
            if (el) el.classList.remove('hidden');

            const prefix = type === 'Enemy' ? 'e' : type === 'Bonus' ? 'b' : type === 'Boss' ? 'bs' : type === 'PowerUp' ? 'pu' : type === 'Spawn' ? 'sp' : type === 'Goal' ? 'g' : type === 'Collision' ? 'col' : (type === 'catcher_base' || type === 'Catcher') ? 'c' : type === 'Model' ? 'm' : '';
            
            // Common GLB & Model Y Logic
            if (prefix) {
                const model = selected.getObjectByName('model');
                const container = document.getElementById(`${prefix}-glb-preview-container`);
                const filename = document.getElementById(`${prefix}-filename`);
                const modely = document.getElementById(`${prefix}-modely`);
                
                if (filename) filename.innerText = selected.userData.glbFilename || "(Default)";
                if (modely && model) modely.value = model.position.y.toFixed(2);

                if (model && selected.userData.glbSource) {
                    if(container) container.style.display = 'flex';
                    const img = document.getElementById(`${prefix}-glb-preview-img`);
                    if (img && (!img.src || img.style.display === 'none')) this.generateThumbnail(model, `${prefix}-glb-preview-img`);
                    
                    if (type === 'Enemy') {
                        const rotY = document.getElementById('e-model-roty');
                        const scale = document.getElementById('e-model-scale');
                        if (rotY) rotY.value = THREE.MathUtils.radToDeg(model.rotation.y).toFixed(0);
                        if (scale) scale.value = model.scale.x.toFixed(2);
                    }
                } else if (container) {
                    container.style.display = 'none';
                    if (type === 'Enemy') {
                        const rotY = document.getElementById('e-model-roty');
                        const scale = document.getElementById('e-model-scale');
                        if (rotY) rotY.value = 0;
                        if (scale) scale.value = 1;
                    }
                }
            }

            if (type === 'Model') {
                const anims = selected.userData.anims || [];
                const animSelect = document.getElementById('m-anim-default');
                if (animSelect) {
                    animSelect.innerHTML = '<option value="">-- None --</option>' + 
                        anims.map(a => `<option value="${a}" ${a === selected.userData.defaultAnim ? 'selected' : ''}>${a}</option>`).join('');
                }
            }

            else if (type === 'Enemy') {
                document.getElementById('e-hp').value = selected.userData.hp || 3;
                document.getElementById('e-movestyle').value = selected.userData.moveStyle || 'none';
                
                const moveStyle = selected.userData.moveStyle || 'none';
                const followerPanel = document.getElementById('panel-enemy-follower');
                if (followerPanel) {
                    followerPanel.classList.toggle('hidden', moveStyle !== 'follower');
                    if (moveStyle === 'follower') {
                        document.getElementById('e-f-target').value = selected.userData.followerTarget || '';
                        
                        // Populate Datalist
                        const dataList = document.getElementById('e-f-target-list');
                        if (dataList) {
                            dataList.innerHTML = '';
                            const targets = ['Player']; 
                            this.app.editor.objects.forEach(o => {
                                if (o !== selected && o.name) targets.push(o.name);
                            });
                            // Unique and sorted
                            const unique = [...new Set(targets)].sort();
                            unique.forEach(name => {
                                const opt = document.createElement('option');
                                opt.value = name;
                                dataList.appendChild(opt);
                            });
                        }

                        document.getElementById('e-f-proximity').value = selected.userData.followerProximity || 5.0;
                        document.getElementById('e-f-stop-dist').value = selected.userData.followerStopDist || 0.5;
                        document.getElementById('e-f-stop-col').checked = !!selected.userData.followerStopCol;

                        ['x', 'y', 'z'].forEach(axis => {
                            const tKey = `followerTrans${axis.toUpperCase()}`;
                            const tVal = selected.userData[tKey];
                            const t = document.getElementById(`e-f-t${axis}`);
                            if (t) t.checked = tVal !== undefined ? tVal : true;

                            const rKey = `followerRot${axis.toUpperCase()}`;
                            const rVal = selected.userData[rKey];
                            const r = document.getElementById(`e-f-r${axis}`);
                            if (r) r.checked = rVal !== undefined ? rVal : true;
                        });
                    }
                }

                document.getElementById('e-speed').value = selected.userData.speed || 2.0;
                document.getElementById('e-patrol').value = selected.userData.patrolRange || 3.0;
                document.getElementById('e-physics').checked = !!selected.userData.hasPhysics;
                document.getElementById('e-freeze').checked = !!selected.userData.isFrozen;
                document.getElementById('e-can-stomp').checked = !!selected.userData.canStomp;
                document.getElementById('e-no-col').checked = !!selected.userData.noCollision;
                document.getElementById('e-height').value = (selected.geometry?.parameters?.height || 0.8).toFixed(1);

                const anims = selected.userData.anims || [];
                const populateAnim = (id, val) => {
                    const el = document.getElementById(id);
                    if (el) el.innerHTML = '<option value="">-- None --</option>' + 
                        anims.map(a => `<option value="${a}" ${a === val ? 'selected' : ''}>${a}</option>`).join('');
                };

                populateAnim('e-anim-idle', selected.userData.animIdle);
                populateAnim('e-anim-move', selected.userData.animMove);
                populateAnim('e-anim-hit', selected.userData.animHit);
                populateAnim('e-anim-death', selected.userData.animDeath);
            }
            else if (type === 'Bonus') {
                document.getElementById('b-points').value = selected.userData.points || 100;
                document.getElementById('b-radius').value = selected.userData.radius || 1.0;
                document.getElementById('b-movestyle').value = selected.userData.moveStyle || 'none';
                document.getElementById('b-speed').value = selected.userData.speed || 2;
                document.getElementById('b-patrol').value = selected.userData.patrolRange || 3;
                document.getElementById('b-no-col').checked = !!selected.userData.noCollision;
                const disappear = document.getElementById('b-disappear');
                if (disappear) disappear.checked = selected.userData.disappearOnCollect !== false;

                const anims = selected.userData.anims || [];
                const populateBonusAnim = (id, val) => {
                    const el = document.getElementById(id);
                    if (el) el.innerHTML = '<option value="">-- None --</option>' + 
                        anims.map(a => `<option value="${a}" ${a === val ? 'selected' : ''}>${a}</option>`).join('');
                };

                populateBonusAnim('b-anim-idle', selected.userData.animIdle);
                populateBonusAnim('b-anim-collect', selected.userData.animCollect);
            }
            else if (type === 'Boss') {
                document.getElementById('bs-hp').value = selected.userData.hp || 100;
                document.getElementById('bs-no-col').checked = !!selected.userData.noCollision;
            }
            else if (type === 'PowerUp') {
                const pType = selected.userData.powerType || 'hammer';
                document.getElementById('pu-type').value = pType;
                
                const gunPanel = document.getElementById('panel-pu-gun');
                if (gunPanel) gunPanel.classList.toggle('hidden', pType !== 'gun');
                
                const lanternPanel = document.getElementById('panel-pu-lantern');
                if (lanternPanel) lanternPanel.classList.toggle('hidden', pType !== 'lantern');
                
                document.getElementById('pu-bullet-power').value = selected.userData.bulletPower || 1;
                document.getElementById('pu-bullet-filename').innerText = selected.userData.bulletFilename || 'None';
                
                document.getElementById('pu-lantern-freeze').value = selected.userData.lanternFreezeDuration || 5.0;

                document.getElementById('pu-dur').value = selected.userData.duration || 10;
                document.getElementById('pu-no-col').checked = !!selected.userData.noCollision;
                document.getElementById('pu-offx').value = (selected.userData.equipOffsetX || 0.5).toFixed(2);
                document.getElementById('pu-offy').value = (selected.userData.equipOffsetY || 1.0).toFixed(2);
                document.getElementById('pu-offz').value = (selected.userData.equipOffsetZ || 0.5).toFixed(2);
                document.getElementById('pu-height').value = (selected.geometry?.parameters?.height || 0.5).toFixed(1);
                
                const model = selected.getObjectByName('model');
                if (model) {
                    document.getElementById('pu-model-scale').value = model.scale.x.toFixed(2);
                }
                
                const er = selected.userData.equipRotation || [0, 0, 0];
                document.getElementById('pu-rotx').value = THREE.MathUtils.radToDeg(er[0]).toFixed(0);
                document.getElementById('pu-roty').value = THREE.MathUtils.radToDeg(er[1]).toFixed(0);
                document.getElementById('pu-rotz').value = THREE.MathUtils.radToDeg(er[2]).toFixed(0);
                
                const anims = selected.userData.anims || [];
                const animSelect = document.getElementById('pu-anim');
                if (animSelect) {
                    animSelect.innerHTML = '<option value="">-- None --</option>' + 
                        anims.map(a => `<option value="${a}" ${a === selected.userData.defaultAnim ? 'selected' : ''}>${a}</option>`).join('');
                }
                const equipSelect = document.getElementById('pu-anim-equip');
                if (equipSelect) {
                    equipSelect.innerHTML = '<option value="">-- None --</option>' + 
                        anims.map(a => `<option value="${a}" ${a === selected.userData.equipAnim ? 'selected' : ''}>${a}</option>`).join('');
                }
            }
            else if (type === 'Collision') {
                document.getElementById('col-action').value = selected.userData.actionType || 'restart';
                document.getElementById('col-value').value = selected.userData.actionValue || '';
                
                this.renderCollisionTargets(selected);
                if (selected.userData.actionTargets?.length > 0) {
                    this.updateCollisionAnimList(selected.userData.actionTargets[0]);
                } else if (selected.userData.actionTarget) {
                    this.updateCollisionAnimList(selected.userData.actionTarget);
                }
                
                // Populate Datalist
                const dataList = document.getElementById('col-target-list');
                if (dataList) {
                    dataList.innerHTML = '';
                    const targets = ['Player']; 
                    this.app.editor.objects.forEach(o => {
                        if (o !== selected && o.name) targets.push(o.name);
                    });
                    const unique = [...new Set(targets)].sort();
                    unique.forEach(name => {
                        const opt = document.createElement('option');
                        opt.value = name;
                        dataList.appendChild(opt);
                    });
                }
            }
            else if (type === 'Spawn') {
                document.getElementById('sp-rate').value = selected.userData.spawnRate || 2000;
            }
            else if (type === 'Goal') {
                document.getElementById('g-no-col').checked = !!selected.userData.noCollision;
            }
            else if (type === 'catcher_base' || type === 'Catcher') {
                document.getElementById('c-filter-type').value = selected.userData.filterType || 'all';
                document.getElementById('c-filter-tag').value = selected.userData.filterTag || '';
                document.getElementById('c-move-type').value = selected.userData.moveType || 'teleport';
                const keyInput = document.getElementById('c-key');
                if (keyInput) keyInput.value = selected.userData.keyTrigger || '';
            }
        }
    }


    addAction(playerObj) {
        if (!playerObj.userData.actions) playerObj.userData.actions = [];
        playerObj.userData.actions.push({ name: 'New Action', key: '', type: 'Idle', anim: '', mirror: false, active: true });
        this.renderActionList(playerObj);
    }

    removeAction(playerObj, index) { playerObj.userData.actions.splice(index, 1); this.renderActionList(playerObj); }

    renderCollisionTargets(selected) {
        const container = document.getElementById('col-targets-container');
        if (!container) return;
        container.innerHTML = '';
        const targets = selected.userData.actionTargets || [];
        targets.forEach((t, i) => {
            const div = document.createElement('div');
            div.style.display = 'flex'; div.style.alignItems = 'center'; div.style.gap = '5px';
            div.style.background = '#222'; div.style.padding = '2px 5px'; div.style.borderRadius = '3px';
            div.style.fontSize = '10px';
            div.innerHTML = `<span style="flex:1; color:#22ff22;">${t}</span><button class="btn-icon-small" data-idx="${i}" style="opacity:0.6;">🗑️</button>`;
            div.querySelector('button').onclick = () => this.removeCollisionTarget(selected, i);
            container.appendChild(div);
        });
    }

    removeCollisionTarget(selected, index) {
        if (selected.userData.actionTargets) {
            selected.userData.actionTargets.splice(index, 1);
            this.renderCollisionTargets(selected);
        }
    }

    renderActionList(playerObj) {
        const container = document.getElementById('action-list-container'); container.innerHTML = '';
        const actions = playerObj.userData.actions || [], anims = playerObj.userData.anims || [];
        actions.forEach((action, index) => {
            const item = document.createElement('div'); item.className = 'action-item'; if (action.active === false) item.style.opacity = '0.6';
            item.draggable = true; item.dataset.idx = index;
            const animOptions = ['<option value="">No Anim</option>', ...anims.map(a => `<option value="${a}" ${a === action.anim ? 'selected' : ''}>${a}</option>`)].join('');
            const typeOptions = this.actionTypes.map(t => `<option value="${t}" ${t === action.type ? 'selected' : ''}>${t}</option>`).join('');
            item.innerHTML = `
                <div class="action-header"><span style="font-size:12px; cursor:grab;">☰</span><input type="text" class="action-key-input" style="flex:1; margin:0 5px; font-weight:bold; color:#eb7b33;" value="${action.name || 'Action'}" data-idx="${index}" data-field="name"><div style="display:flex; align-items:center; gap:5px;"><input type="checkbox" class="action-checkbox" ${action.active !== false ? 'checked' : ''} data-idx="${index}" data-field="active"><button class="btn-icon-small" data-idx="${index}">🗑️</button></div></div>
                <div class="action-row-inputs"><input type="text" class="action-key-input" placeholder="Key" value="${action.key}" data-idx="${index}" data-field="key"><select class="action-select" data-idx="${index}" data-field="type">${typeOptions}</select><select class="action-select" data-idx="${index}" data-field="anim">${animOptions}</select><input type="checkbox" class="action-checkbox" ${action.mirror ? 'checked' : ''} data-idx="${index}" data-field="mirror"></div>`;
            item.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', index); item.classList.add('dragging'); });
            item.addEventListener('dragend', () => item.classList.remove('dragging'));
            item.addEventListener('dragover', (e) => { e.preventDefault(); const draggingItem = container.querySelector('.dragging'); if (draggingItem !== item) { const rect = item.getBoundingClientRect(); if (e.clientY - rect.top - rect.height / 2 < 0) container.insertBefore(draggingItem, item); else container.insertBefore(draggingItem, item.nextSibling); } });
            item.addEventListener('drop', (e) => { e.preventDefault(); const newOrder = Array.from(container.children).map(child => parseInt(child.dataset.idx)); playerObj.userData.actions = newOrder.map(i => actions[i]); this.renderActionList(playerObj); });
            container.appendChild(item);
        });
        container.querySelectorAll('.btn-icon-small').forEach(b => b.onclick = () => this.removeAction(playerObj, parseInt(b.dataset.idx)));
        container.querySelectorAll('input, select').forEach(el => { el.onchange = (e) => { const idx = parseInt(e.target.dataset.idx), field = e.target.dataset.field; playerObj.userData.actions[idx][field] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; }; });
    }

    setFullScreen(enabled) {
        const ids = ['left-panel', 'right-panel', 'asset-manager', 'resizer-left', 'resizer-right', 'resizer-bottom', 'toolbar-floating'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = enabled ? 'none' : '';
        });
        setTimeout(() => this.app.sceneManager.onResize(), 100);
    }

    updateCollisionAnimList(targetName) {
        const list = document.getElementById('col-value-list');
        if (!list) return;
        list.innerHTML = '';
        if (!targetName) return;

        const target = this.app.editor.objects.find(o => o.name === targetName);
        if (!target) return;

        let anims = target.userData.anims || [];
        if (anims.length === 0) {
            const model = target.getObjectByName('model');
            if (model && model.animations) {
                 anims = model.animations.map(c => c.name);
            }
        }
        if (target.userData.isPlayer && target.userData.actions) {
             const actionAnims = target.userData.actions.map(a => a.anim).filter(a => a);
             anims = [...new Set([...anims, ...actionAnims])];
        }

        anims.forEach(anim => {
            const opt = document.createElement('option');
            opt.value = anim;
            list.appendChild(opt);
        });
    }

    generateThumbnail(model, targetImgId = 'glb-preview-img') {
        if (!model) return;
        
        if (!this.thumbRenderer) {
            this.thumbRenderer = new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true, antialias: true });
            this.thumbRenderer.setPixelRatio(window.devicePixelRatio);
        }
        
        const renderer = this.thumbRenderer;
        renderer.setSize(128, 128);
        
        const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
        scene.add(new THREE.AmbientLight(0xffffff, 1.2)); const dirLight = new THREE.DirectionalLight(0xffffff, 1.5); dirLight.position.set(2, 2, 5); scene.add(dirLight);
        let clone; try { clone = SkeletonUtils.clone(model); } catch(e) { clone = model.clone(); }
        clone.visible = true; clone.position.set(0, 0, 0); scene.add(clone);
        const box = new THREE.Box3().setFromObject(clone), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
        clone.position.sub(center); const maxDim = Math.max(size.x, size.y, size.z);
        const fov = camera.fov * (Math.PI / 180); let distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.3;
        camera.position.set(distance * 0.4, distance * 0.2, distance); camera.lookAt(0, 0, 0);
        renderer.render(scene, camera); const img = document.getElementById(targetImgId);
        if (img) { img.src = renderer.domElement.toDataURL(); img.style.display = 'block'; if (targetImgId === 'glb-preview-img') { const placeholder = document.getElementById('glb-preview-placeholder'); if (placeholder) placeholder.style.display = 'none'; } }
        // Note: We don't dispose the renderer anymore so it can be reused
    }

    setupEquipPreview() {
        const btn = document.getElementById('btn-pu-preview-equip');
        if (!btn) return;

        let isPreviewing = false;
        let originalParent = null;
        let originalPos = new THREE.Vector3();
        let originalRot = new THREE.Euler();
        let currentPU = null;

        btn.onclick = () => {
            const selected = this.app.editor.selected;
            if (!selected || selected.userData.type !== 'PowerUp') {
                alert("Select a PowerUp first!");
                return;
            }

            if (!isPreviewing) {
                // START PREVIEW
                const player = this.app.editor.objects.find(o => o.userData.isPlayer);
                if (!player) { alert("Add a Player to the scene first!"); return; }

                isPreviewing = true;
                currentPU = selected;
                originalParent = selected.parent;
                originalPos.copy(selected.position);
                originalRot.copy(selected.rotation);

                const playerModel = player.getObjectByName('model') || player;
                playerModel.add(selected);

                // Use saved offsets or default
                selected.position.set(
                    selected.userData.equipOffsetX || 0.5,
                    selected.userData.equipOffsetY || 1.0,
                    selected.userData.equipOffsetZ || 0.5
                );
                if (selected.userData.equipRotation) {
                    selected.rotation.fromArray(selected.userData.equipRotation);
                } else {
                    selected.rotation.set(0, 0, 0);
                }

                btn.innerText = "❌ Stop Preview";
                btn.style.background = "#442222";
                this.updateProperties();
            } else {
                // STOP PREVIEW
                isPreviewing = false;
                if (currentPU && originalParent) {
                    originalParent.add(currentPU);
                    currentPU.position.copy(originalPos);
                    currentPU.rotation.copy(originalRot);
                }
                btn.innerText = "👤 Preview on Player";
                btn.style.background = "#222";
                currentPU = null;
                this.updateProperties();
            }
        };

        // Update offsets if gizmo moves while previewing
        this.app.editor.gizmo.addEventListener('change', () => {
            if (isPreviewing && currentPU && this.app.editor.selected === currentPU) {
                currentPU.userData.equipOffsetX = currentPU.position.x;
                currentPU.userData.equipOffsetY = currentPU.position.y;
                currentPU.userData.equipOffsetZ = currentPU.position.z;
                currentPU.userData.equipRotation = currentPU.rotation.toArray().slice(0, 3);
                
                // Sync UI
                document.getElementById('pu-offx').value = currentPU.position.x.toFixed(2);
                document.getElementById('pu-offy').value = currentPU.position.y.toFixed(2);
                document.getElementById('pu-offz').value = currentPU.position.z.toFixed(2);
                
                document.getElementById('pu-rotx').value = THREE.MathUtils.radToDeg(currentPU.rotation.x).toFixed(0);
                document.getElementById('pu-roty').value = THREE.MathUtils.radToDeg(currentPU.rotation.y).toFixed(0);
                document.getElementById('pu-rotz').value = THREE.MathUtils.radToDeg(currentPU.rotation.z).toFixed(0);
            }
        });
    }
}
