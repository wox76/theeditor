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
        this.setupLevelManager();
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
                } else if (type === 'SplatEnv') {
                    const splatInput = document.getElementById('splat-input');
                    splatInput.onchange = (ev) => {
                        const file = ev.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (f) => {
                                this.createAssetCard(file.name, 'SplatEnv', f.target.result, true);
                            };
                            reader.readAsDataURL(file);
                        }
                        splatInput.value = '';
                    };
                    splatInput.click();
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

            let resolvedData = data;
            if (type === 'SplatEnv') {
                const libItem = this.library.find(i => i.name === name && i.type === 'SplatEnv');
                if (libItem && libItem.data) {
                    resolvedData = libItem.data;
                }
            } else if (!resolvedData) {
                const libItem = this.library.find(i => i.name === name && i.type === type);
                if (libItem && libItem.data) resolvedData = libItem.data;
            }

            if (type) this.app.editor.spawnAsset(type, resolvedData, e.clientX, e.clientY, defaultAnim, name);
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
        if (type === 'PointLight') color = '#ffff00', icon = '💡';
        if (type === 'SpotLight') color = '#ffffaa', icon = '🔦';
        if (type === 'DirectionalLight') color = '#ffffff', icon = '☀️';
        if (type === 'SplatEnv') color = '#8844ff', icon = '🌌';

        card.style.borderColor = color;
        const thumbId = `thumb-${Math.floor(Math.random() * 1000000)}`;
        card.innerHTML = `
            <div class="asset-icon" id="icon-${thumbId}">${icon}</div>
            <div style="font-size:9px; font-weight:bold; color:#888; margin-top:4px;">${type}</div>
            <div class="asset-label" style="color:${color}">${name}</div>
        `;

        if (data && type !== 'SplatEnv') {
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
            if (data && type !== 'SplatEnv') e.dataTransfer.setData('asset-data', data);
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
        btnPlay.onclick = async (e) => {
            e.currentTarget.blur();
            if (this.app.game.isPlaying) {
                this.app.game.stop();
                btnPlay.classList.remove('play-active');
            } else {
                // Load designated starting level then start
                const startIdx = this.app.editor.startingLevelIndex;
                const currentIdx = this.app.editor.currentLevelIndex;

                // If playing the current active level, update the slot first
                if (startIdx === currentIdx && currentIdx >= 0) {
                    this.app.editor.updateLevel(currentIdx);
                }

                await this.app.editor.loadLevelByIndex(startIdx);
                this.app.game.start(startIdx);
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
        const el = document.getElementById(id); if (el) el.classList.add('active');
    }

    setupPanels() {
        document.getElementById('btn-game-props').onclick = () => { this.app.editor.select(null); document.getElementById('section-game').classList.remove('hidden'); };
        document.getElementById('btn-import').onclick = () => document.getElementById('glb-input').click();
        document.getElementById('glb-input').onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
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
        
        document.getElementById('game-title-input').onchange = (e) => {
            this.app.editor.gameTitle = e.target.value;
        };

        document.getElementById('game-subtitle-input').onchange = (e) => {
            this.app.editor.gameSplashSubtitle = e.target.value;
        };

        document.getElementById('game-splash-prompt-bg').onchange = (e) => {
            this.app.editor.gameSplashPromptBg = e.target.value;
        };

        document.getElementById('game-splash-prompt-color').onchange = (e) => {
            this.app.editor.gameSplashPromptColor = e.target.value;
        };

        const btnSplash = document.getElementById('btn-splash-import');
        if (btnSplash) btnSplash.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        this.app.editor.gameSplashImage = ev.target.result;
                        this.updateProperties(); // Refresh preview
                    };
                    reader.readAsDataURL(file);
                }
            };
            input.click();
        };

        const btnSplashMusic = document.getElementById('btn-splash-music');
        if (btnSplashMusic) btnSplashMusic.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'audio/*';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        this.app.editor.gameSplashMusic = ev.target.result;
                        this.app.editor.gameSplashMusicFilename = file.name;
                        this.updateProperties(); // Refresh UI
                    };
                    reader.readAsDataURL(file);
                }
            };
            input.click();
        };

        const btnClearSplashMusic = document.getElementById('btn-splash-music-clear');
        if (btnClearSplashMusic) btnClearSplashMusic.onclick = () => {
            this.app.editor.gameSplashMusic = null;
            this.app.editor.gameSplashMusicFilename = '';
            this.updateProperties();
        };

        const btnClearSplash = document.getElementById('btn-splash-clear');
        if (btnClearSplash) btnClearSplash.onclick = () => {
            this.app.editor.gameSplashImage = null;
            this.updateProperties();
        };

        // ── End Screen Config ────────────────────────────────────────────────
        const btnConfigEnd = document.getElementById('btn-config-endscreen');
        if (btnConfigEnd) btnConfigEnd.onclick = () => {
            // Open Game Properties panel and scroll to End Screen section
            const gamePropsBtn = document.getElementById('btn-game-props');
            if (gamePropsBtn) gamePropsBtn.click();
            setTimeout(() => {
                const endTitle = document.getElementById('endscreen-title-input');
                if (endTitle) endTitle.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 150);
        };

        const endTitleInput = document.getElementById('endscreen-title-input');
        if (endTitleInput) endTitleInput.oninput = (e) => { this.app.editor.gameEndTitle = e.target.value; };

        const endSubtitleInput = document.getElementById('endscreen-subtitle-input');
        if (endSubtitleInput) endSubtitleInput.oninput = (e) => { this.app.editor.gameEndSubtitle = e.target.value; };

        // End Screen Image
        const btnEndImg = document.getElementById('btn-endscreen-image');
        if (btnEndImg) btnEndImg.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*';
            input.onchange = (e) => {
                const file = e.target.files[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.app.editor.gameEndImage = ev.target.result;
                    this.app.editor.gameEndVideo = null;
                    const preview = document.getElementById('endscreen-image-preview');
                    const thumb = document.getElementById('endscreen-image-thumb');
                    const clearBtn = document.getElementById('btn-endscreen-image-clear');
                    const vidFilename = document.getElementById('endscreen-video-filename');
                    const vidClear = document.getElementById('btn-endscreen-video-clear');
                    if (thumb) thumb.src = ev.target.result;
                    if (preview) preview.style.display = 'block';
                    if (clearBtn) clearBtn.classList.remove('hidden');
                    if (vidFilename) vidFilename.textContent = '(None)';
                    if (vidClear) vidClear.classList.add('hidden');
                };
                reader.readAsDataURL(file);
            };
            input.click();
        };
        const btnEndImgClear = document.getElementById('btn-endscreen-image-clear');
        if (btnEndImgClear) btnEndImgClear.onclick = () => {
            this.app.editor.gameEndImage = null;
            const preview = document.getElementById('endscreen-image-preview');
            const thumb = document.getElementById('endscreen-image-thumb');
            if (preview) preview.style.display = 'none';
            if (thumb) thumb.src = '';
            btnEndImgClear.classList.add('hidden');
        };

        // End Screen Video
        const btnEndVid = document.getElementById('btn-endscreen-video');
        if (btnEndVid) btnEndVid.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'video/*';
            input.onchange = (e) => {
                const file = e.target.files[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.app.editor.gameEndVideo = ev.target.result;
                    this.app.editor.gameEndImage = null;
                    const filenameEl = document.getElementById('endscreen-video-filename');
                    const clearBtn = document.getElementById('btn-endscreen-video-clear');
                    const preview = document.getElementById('endscreen-image-preview');
                    if (filenameEl) filenameEl.textContent = file.name;
                    if (clearBtn) clearBtn.classList.remove('hidden');
                    if (preview) preview.style.display = 'none';
                    const imgClear = document.getElementById('btn-endscreen-image-clear');
                    if (imgClear) imgClear.classList.add('hidden');
                };
                reader.readAsDataURL(file);
            };
            input.click();
        };
        const btnEndVidClear = document.getElementById('btn-endscreen-video-clear');
        if (btnEndVidClear) btnEndVidClear.onclick = () => {
            this.app.editor.gameEndVideo = null;
            const filenameEl = document.getElementById('endscreen-video-filename');
            if (filenameEl) filenameEl.textContent = '(None)';
            btnEndVidClear.classList.add('hidden');
        };

        // End Screen Video Aspect Ratio
        const endVideoAspect = document.getElementById('endscreen-video-aspect');
        if (endVideoAspect) endVideoAspect.onchange = (e) => {
            this.app.editor.gameEndVideoAspect = e.target.value;
        };

        // End Screen Music
        const btnEndMusic = document.getElementById('btn-endscreen-music');
        if (btnEndMusic) btnEndMusic.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'audio/*';
            input.onchange = (e) => {
                const file = e.target.files[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.app.editor.gameEndMusic = ev.target.result;
                    this.app.editor.gameEndMusicFilename = file.name;
                    const filenameEl = document.getElementById('endscreen-music-filename');
                    const clearBtn = document.getElementById('btn-endscreen-music-clear');
                    if (filenameEl) filenameEl.textContent = file.name;
                    if (clearBtn) clearBtn.classList.remove('hidden');
                };
                reader.readAsDataURL(file);
            };
            input.click();
        };
        const btnEndMusicClear = document.getElementById('btn-endscreen-music-clear');
        if (btnEndMusicClear) btnEndMusicClear.onclick = () => {
            this.app.editor.gameEndMusic = null;
            this.app.editor.gameEndMusicFilename = '';
            const filenameEl = document.getElementById('endscreen-music-filename');
            if (filenameEl) filenameEl.textContent = '(None)';
            btnEndMusicClear.classList.add('hidden');
        };

        const axes = ['x', 'y', 'z'];
        axes.forEach(axis => {
            const p = document.getElementById(`t-p${axis}`); if (p) p.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.position[axis] = parseFloat(e.target.value); };
            const r = document.getElementById(`t-r${axis}`); if (r) r.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.rotation[axis] = THREE.MathUtils.degToRad(parseFloat(e.target.value)); };
            const s = document.getElementById(`t-s${axis}`); if (s) s.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.scale[axis] = parseFloat(e.target.value); };
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
                        defaults.push({ name: 'Shoot', key: 'mouse0', type: 'Shooting', anim: '', mirror: false, active: true });
                    } else if (newType === '8WAY') {
                        // 8WAY (Commando style)
                        defaults.push({ name: 'Walk Forward', key: 'w', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Walk Backward', key: 's', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Walk Right', key: 'd', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Walk Left', key: 'a', type: 'Walk', anim: '', mirror: true, active: true });
                        defaults.push({ name: 'Jump', key: ' ', type: 'Jump', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Shoot', key: 'mouse0', type: 'Shooting', anim: '', mirror: false, active: true });
                    } else {
                        // FPS/TPS
                        defaults.push({ name: 'Forward', key: 'w', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Backward', key: 's', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Left', key: 'a', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Right', key: 'd', type: 'Walk', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Jump', key: ' ', type: 'Jump', anim: '', mirror: false, active: true });
                        defaults.push({ name: 'Shoot', key: 'mouse0', type: 'Shooting', anim: '', mirror: false, active: true });
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

        // Sprint Settings Bindings
        const pSprintEnable = document.getElementById('p-sprint-enable');
        const pSprintKey = document.getElementById('p-sprint-key');
        const pSprintMult = document.getElementById('p-sprint-mult');
        if (pSprintEnable) pSprintEnable.onchange = (e) => { if (this.app.editor.selected?.userData.isPlayer) this.app.editor.selected.userData.canSprint = e.target.checked; };
        if (pSprintKey) pSprintKey.onchange = (e) => { if (this.app.editor.selected?.userData.isPlayer) this.app.editor.selected.userData.sprintKey = e.target.value; };
        if (pSprintMult) pSprintMult.oninput = (e) => { if (this.app.editor.selected?.userData.isPlayer) this.app.editor.selected.userData.sprintMult = parseFloat(e.target.value); };

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

        // Render Engine Bindings
        const gamePBR = document.getElementById('game-pbr');
        if (gamePBR) gamePBR.onchange = (e) => this.app.sceneManager.setPBROutput(e.target.checked);

        const gameShadows = document.getElementById('game-shadows');
        if (gameShadows) gameShadows.onchange = (e) => this.app.sceneManager.setShadows(e.target.checked);

        const gameReflections = document.getElementById('game-reflections');
        if (gameReflections) gameReflections.onchange = (e) => this.app.sceneManager.setReflections(e.target.checked);

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
                        const oldBottom = -((oldParams.length || oldParams.height) / 2 + oldParams.radius);
                        const newBottom = -(h / 2 + r);
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

        // SplatEnv
        bindProp('se-collision', 'hasCollision', 'SplatEnv');
        const btnSeLoad = document.getElementById('btn-se-load');
        if (btnSeLoad) {
            btnSeLoad.onclick = () => {
                const splatInput = document.getElementById('splat-input');
                splatInput.onchange = (ev) => {
                    const file = ev.target.files[0];
                    if (file && this.app.editor.selected?.userData.type === 'SplatEnv') {
                        const reader = new FileReader();
                        reader.onload = (f) => {
                            this.app.editor.selected.userData.splatSource = f.target.result;
                            this.app.editor.selected.userData.glbFilename = file.name;
                            this.app.editor.reloadSplat(this.app.editor.selected);
                            this.updateProperties();
                        };
                        reader.readAsDataURL(file);
                    }
                    splatInput.value = '';
                };
                splatInput.click();
            };
        }

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
                const panelFly = document.getElementById('panel-pu-fly');
                if (panelFly) panelFly.classList.toggle('hidden', e.target.value !== 'fly');
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
        bindProp('pu-fly-anim', 'flyAnim', 'PowerUp');
        bindProp('pu-fly-boost', 'flyBoost', 'PowerUp', parseFloat);
        bindProp('pu-fly-height', 'flyHeight', 'PowerUp', parseFloat);
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
        bindProp('g-action-type', 'actionType', 'Goal');
        bindProp('g-action-value', 'actionValue', 'Goal');
        bindProp('g-no-col', 'noCollision', 'Goal');
        setupLoader('btn-goal-import', 'Goal', 'g');
        setupModelEdit('btn-edit-g-modely', 'g-modely');

        // LIGHT BINDINGS
        const lColor = document.getElementById('l-color');
        if (lColor) lColor.oninput = (e) => {
            const sel = this.app.editor.selected;
            if (sel && sel.userData.isAsset && ['PointLight', 'SpotLight', 'DirectionalLight'].includes(sel.userData.type)) {
                const hexStr = e.target.value.replace('#', '');
                const hex = parseInt(hexStr, 16);
                sel.userData.color = hex;
                sel.material.color.setHex(hex);
                const lightSource = sel.getObjectByName('light_source');
                if (lightSource) lightSource.color.setHex(hex);
            }
        };

        const lIntensity = document.getElementById('l-intensity');
        if (lIntensity) lIntensity.oninput = (e) => {
            const sel = this.app.editor.selected;
            if (sel && sel.userData.isAsset && ['PointLight', 'SpotLight', 'DirectionalLight'].includes(sel.userData.type)) {
                const val = parseFloat(e.target.value);
                sel.userData.intensity = val;
                const lightSource = sel.getObjectByName('light_source');
                if (lightSource) lightSource.intensity = val;
            }
        };

        const lDistance = document.getElementById('l-distance');
        if (lDistance) lDistance.oninput = (e) => {
            const sel = this.app.editor.selected;
            if (sel && sel.userData.isAsset && ['PointLight', 'SpotLight'].includes(sel.userData.type)) {
                const val = parseFloat(e.target.value);
                sel.userData.distance = val;
                const lightSource = sel.getObjectByName('light_source');
                if (lightSource) lightSource.distance = val;
            }
        };

        const lAngle = document.getElementById('l-angle');
        if (lAngle) lAngle.oninput = (e) => {
            const sel = this.app.editor.selected;
            if (sel && sel.userData.isAsset && sel.userData.type === 'SpotLight') {
                const val = parseFloat(e.target.value);
                const rad = THREE.MathUtils.degToRad(val);
                sel.userData.angle = rad;
                const lightSource = sel.getObjectByName('light_source');
                if (lightSource) lightSource.angle = rad;
            }
        };

        const lPenumbra = document.getElementById('l-penumbra');
        if (lPenumbra) lPenumbra.oninput = (e) => {
            const sel = this.app.editor.selected;
            if (sel && sel.userData.isAsset && sel.userData.type === 'SpotLight') {
                const val = parseFloat(e.target.value);
                sel.userData.penumbra = val;
                const lightSource = sel.getObjectByName('light_source');
                if (lightSource) lightSource.penumbra = val;
            }
        };

        const lDecay = document.getElementById('l-decay');
        if (lDecay) lDecay.oninput = (e) => {
            const sel = this.app.editor.selected;
            if (sel && sel.userData.isAsset && ['PointLight', 'SpotLight'].includes(sel.userData.type)) {
                const val = parseFloat(e.target.value);
                sel.userData.decay = val;
                const lightSource = sel.getObjectByName('light_source');
                if (lightSource) lightSource.decay = val;
            }
        };

        const lCastShadow = document.getElementById('l-cast-shadow');
        if (lCastShadow) lCastShadow.onchange = (e) => {
            const sel = this.app.editor.selected;
            if (sel && sel.userData.isAsset && ['PointLight', 'SpotLight', 'DirectionalLight'].includes(sel.userData.type)) {
                const val = e.target.checked;
                sel.userData.castShadow = val;
                const lightSource = sel.getObjectByName('light_source');
                if (lightSource) lightSource.castShadow = val && this.app.sceneManager.renderer.shadowMap.enabled;
            }
        };

        const updateShadowProp = (prop, parser, applyFn) => {
            const el = document.getElementById(`l-shadow-${prop}`);
            if (el) el.oninput = (e) => {
                const sel = this.app.editor.selected;
                if (sel && sel.userData.isAsset && ['PointLight', 'SpotLight', 'DirectionalLight'].includes(sel.userData.type)) {
                    const val = parser(e.target.value);
                    sel.userData[`shadow${prop.charAt(0).toUpperCase() + prop.slice(1)}`] = val;
                    const lightSource = sel.getObjectByName('light_source');
                    if (lightSource && lightSource.shadow) applyFn(lightSource.shadow, val);
                }
            };
        };

        updateShadowProp('bias', parseFloat, (s, v) => s.bias = v);
        updateShadowProp('normalBias', parseFloat, (s, v) => s.normalBias = v);
        updateShadowProp('radius', parseFloat, (s, v) => s.radius = v);

        const elRes = document.getElementById('l-shadow-res');
        if (elRes) elRes.onchange = (e) => {
            const sel = this.app.editor.selected;
            if (sel && sel.userData.isAsset && ['PointLight', 'SpotLight', 'DirectionalLight'].includes(sel.userData.type)) {
                const val = parseInt(e.target.value);
                sel.userData.shadowRes = val;
                const lightSource = sel.getObjectByName('light_source');
                if (lightSource && lightSource.shadow) {
                    lightSource.shadow.mapSize.width = val;
                    lightSource.shadow.mapSize.height = val;
                    if (lightSource.shadow.map) {
                        lightSource.shadow.map.dispose();
                        lightSource.shadow.map = null;
                    }
                }
            }
        };

        const updateCamProp = (prop, parser, applyFn) => {
            const el = document.getElementById(`l-shadow-${prop}`);
            if (el) el.oninput = (e) => {
                const sel = this.app.editor.selected;
                if (sel && sel.userData.isAsset && ['PointLight', 'SpotLight', 'DirectionalLight'].includes(sel.userData.type)) {
                    const val = parser(e.target.value);
                    sel.userData[`shadowCam${prop.charAt(0).toUpperCase() + prop.slice(1)}`] = val;
                    const lightSource = sel.getObjectByName('light_source');
                    if (lightSource && lightSource.shadow && lightSource.shadow.camera) {
                        applyFn(lightSource.shadow.camera, val);
                        lightSource.shadow.camera.updateProjectionMatrix();
                    }
                }
            };
        };

        updateCamProp('near', parseFloat, (c, v) => c.near = v);
        updateCamProp('far', parseFloat, (c, v) => c.far = v);
        updateCamProp('size', parseFloat, (c, v) => {
            if (c.isOrthographicCamera) {
                c.left = -v; c.right = v; c.top = v; c.bottom = -v;
            }
        });

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

        // Model Transparency
        const bindMaterialOpt = (id, key, parser = v => v) => {
            const el = document.getElementById(id);
            if (el) el.onchange = (e) => {
                if (this.app.editor.selected?.userData.type === 'Model') {
                    this.app.editor.selected.userData[key] = parser(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
                    const m = this.app.editor.selected.getObjectByName('model');
                    if (m) this.app.editor.updateMaterialSettings(m);
                }
            };
        };
        bindMaterialOpt('m-alpha-mode', 'alphaMode');
        bindMaterialOpt('m-alpha-test', 'alphaTest', parseFloat);
        bindMaterialOpt('m-double-side', 'doubleSide');

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
            else if (o.userData.type === 'PointLight') icon = '💡';
            else if (o.userData.type === 'SpotLight') icon = '🔦';
            else if (o.userData.type === 'DirectionalLight') icon = '☀️';
            else if (o.userData.type === 'SplatEnv') icon = '🌌';

            li.innerText = `${icon} ${o.name}`;
            li.onclick = () => this.app.editor.select(o); list.appendChild(li);
        });
    }

    updateProperties() {
        const selected = this.app.editor.selected;
        // Hide all first
        ['section-transform', 'section-player', 'section-camera', 'section-enemy', 'section-bonus', 'section-boss', 'section-powerup', 'section-spawn', 'section-goal', 'section-catcher', 'section-collision', 'section-model', 'section-splatenv'].forEach(id => {
            const el = document.getElementById(id); if (el) el.classList.add('hidden');
        });
        document.getElementById('section-game').classList.add('hidden');

        if (!selected) {
            // Show Game Settings if nothing selected
            document.getElementById('section-game').classList.remove('hidden');
            document.getElementById('game-title-input').value = this.app.editor.gameTitle || 'Web 3D Game';
            document.getElementById('game-subtitle-input').value = this.app.editor.gameSplashSubtitle || '3D Editor Engine';
            document.getElementById('game-splash-prompt-bg').value = this.app.editor.gameSplashPromptBg || 'rgba(255,255,255,0.1)';
            document.getElementById('game-splash-prompt-color').value = this.app.editor.gameSplashPromptColor || '#ffffff';
            
            const musicNameEl = document.getElementById('splash-music-filename');
            const btnClearMusic = document.getElementById('btn-splash-music-clear');
            if (musicNameEl) musicNameEl.textContent = this.app.editor.gameSplashMusicFilename || '(None)';
            if (btnClearMusic) {
                if (this.app.editor.gameSplashMusic) btnClearMusic.classList.remove('hidden');
                else btnClearMusic.classList.add('hidden');
            }

            const preview = document.getElementById('splash-preview-container');
            const img = document.getElementById('splash-preview-img');
            const btnClear = document.getElementById('btn-splash-clear');
            if (this.app.editor.gameSplashImage) {
                if (preview) preview.style.display = 'block';
                if (img) img.src = this.app.editor.gameSplashImage;
                if (btnClear) btnClear.classList.remove('hidden');
            } else {
                if (preview) preview.style.display = 'none';
                if (btnClear) btnClear.classList.add('hidden');
            }
            // End Screen config restore
            const endTitleInp = document.getElementById('endscreen-title-input');
            if (endTitleInp) endTitleInp.value = this.app.editor.gameEndTitle || '';
            const endSubInp = document.getElementById('endscreen-subtitle-input');
            if (endSubInp) endSubInp.value = this.app.editor.gameEndSubtitle || '';
            const endAspectSel = document.getElementById('endscreen-video-aspect');
            if (endAspectSel) endAspectSel.value = this.app.editor.gameEndVideoAspect || 'cover';
            const endVidFilename = document.getElementById('endscreen-video-filename');
            if (endVidFilename) endVidFilename.textContent = this.app.editor.gameEndVideo ? '✅ Video caricato' : '(None)';
            const endVidClear = document.getElementById('btn-endscreen-video-clear');
            if (endVidClear) endVidClear.classList.toggle('hidden', !this.app.editor.gameEndVideo);
            return;
        }

        document.getElementById('section-transform').classList.remove('hidden');
        document.getElementById('obj-name-input').value = selected.name;
        ['x', 'y', 'z'].forEach(axis => {
            const p = document.getElementById(`t-p${axis}`); if (p) p.value = selected.position[axis].toFixed(2);
            const r = document.getElementById(`t-r${axis}`); if (r) r.value = THREE.MathUtils.radToDeg(selected.rotation[axis]).toFixed(0);
            const s = document.getElementById(`t-s${axis}`); if (s) s.value = selected.scale[axis].toFixed(2);
        });

        if (selected.userData.isPlayer) {
            document.getElementById('section-player').classList.remove('hidden');
            // ... (rest of player updates handled by existing listeners/initial state but strictly inputs need refreshing)
            // Ideally should refresh inputs here too, but for brevity assuming static binding works for now or existing update logic was replaced?
            // Wait, I replaced 'setupInputs' and 'updateProperties'. The OLD updateProperties logic for Player is GONE if I don't re-include it.
            // I MUST re-include Player update logic.
            const typology = selected.userData.typology || 'platform';
            document.getElementById('p-typology').value = typology;
            document.getElementById('panel-platform').classList.remove('hidden');
            document.getElementById('p-speed').value = selected.userData.speed || 0.4;
            document.getElementById('p-jump').value = (selected.userData.jumpForce || 12.0).toFixed(1);
            const dj = document.getElementById('p-doublejump');
            if (dj) dj.checked = !!selected.userData.doubleJump;

            const spe = document.getElementById('p-sprint-enable');
            const spk = document.getElementById('p-sprint-key');
            const spm = document.getElementById('p-sprint-mult');
            if (spe) spe.checked = !!selected.userData.canSprint;
            if (spk) spk.value = selected.userData.sprintKey || 'shift';
            if (spm) spm.value = selected.userData.sprintMult || 1.5;

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
            if (['PointLight', 'SpotLight', 'DirectionalLight'].includes(type)) sectionId = 'section-light';
            if (type === 'SplatEnv') sectionId = 'section-splatenv';

            const el = document.getElementById(sectionId);
            if (el) el.classList.remove('hidden');

            const prefix = type === 'Enemy' ? 'e' : type === 'Bonus' ? 'b' : type === 'Boss' ? 'bs' : type === 'PowerUp' ? 'pu' : type === 'Spawn' ? 'sp' : type === 'Goal' ? 'g' : type === 'Collision' ? 'col' : (type === 'catcher_base' || type === 'Catcher') ? 'c' : type === 'Model' ? 'm' : type === 'SplatEnv' ? 'se' : '';

            // Common GLB & Model Y Logic
            if (prefix) {
                const model = selected.getObjectByName('model');
                const container = document.getElementById(`${prefix}-glb-preview-container`);
                const filename = document.getElementById(`${prefix}-filename`);
                const modely = document.getElementById(`${prefix}-modely`);

                if (filename) filename.innerText = selected.userData.glbFilename || "(Default)";
                if (modely && model) modely.value = model.position.y.toFixed(2);

                if (model && selected.userData.glbSource) {
                    if (container) container.style.display = 'flex';
                    const img = document.getElementById(`${prefix}-glb-preview-img`);
                    if (img && (!img.src || img.style.display === 'none')) this.generateThumbnail(model, `${prefix}-glb-preview-img`);

                    if (type === 'Enemy') {
                        const rotY = document.getElementById('e-model-roty');
                        const scale = document.getElementById('e-model-scale');
                        if (rotY) rotY.value = THREE.MathUtils.radToDeg(model.rotation.y).toFixed(0);
                        if (scale) scale.value = model.scale.x.toFixed(2);
                    }
                    if (type === 'Goal') {
                        const actionType = document.getElementById('g-action-type');
                        const actionValue = document.getElementById('g-action-value');
                        if (actionType) actionType.value = selected.userData.actionType || 'next_level';
                        if (actionValue) actionValue.value = selected.userData.actionValue || '';
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

                // Transparency
                const am = document.getElementById('m-alpha-mode');
                if (am) am.value = selected.userData.alphaMode || 'mask';
                const at = document.getElementById('m-alpha-test');
                if (at) at.value = selected.userData.alphaTest !== undefined ? selected.userData.alphaTest : 0.5;
                const ds = document.getElementById('m-double-side');
                if (ds) ds.checked = selected.userData.doubleSide !== undefined ? !!selected.userData.doubleSide : true;
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

                const flyPanel = document.getElementById('panel-pu-fly');
                if (flyPanel) flyPanel.classList.toggle('hidden', pType !== 'fly');

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
                const equipSelect = document.getElementById('pu-equip-anim'); // Assuming equipSelect was defined elsewhere or is a typo for pu-equip-anim
                if (equipSelect) {
                    equipSelect.innerHTML = '<option value="">-- None --</option>' +
                        anims.map(a => `<option value="${a}" ${a === selected.userData.equipAnim ? 'selected' : ''}>${a}</option>`).join('');
                }

                // Get PLAYER animations for Fly Anim (since it plays on Player)
                const player = this.app.editor.objects.find(o => o.userData.isPlayer);
                let playerAnims = [];
                if (player) {
                    playerAnims = player.userData.anims || [];
                    if (playerAnims.length === 0) {
                        const m = player.getObjectByName('model');
                        if (m && m.animations) playerAnims = m.animations.map(c => c.name);
                    }
                }

                const flyAnimSelect = document.getElementById('pu-fly-anim');
                if (flyAnimSelect) {
                    flyAnimSelect.innerHTML = '<option value="">-- None --</option>' +
                        playerAnims.map(a => `<option value="${a}" ${a === selected.userData.flyAnim ? 'selected' : ''}>${a}</option>`).join('');
                }
                const flyBoostInput = document.getElementById('pu-fly-boost');
                if (flyBoostInput) flyBoostInput.value = selected.userData.flyBoost || 10.0;
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
                const noCol = document.getElementById('g-no-col');
                if (noCol) noCol.checked = !!selected.userData.noCollision;
            }
            else if (type === 'catcher_base' || type === 'Catcher') {
                document.getElementById('c-filter-type').value = selected.userData.filterType || 'all';
                document.getElementById('c-filter-tag').value = selected.userData.filterTag || '';
                document.getElementById('c-move-type').value = selected.userData.moveType || 'teleport';
                const keyInput = document.getElementById('c-key');
                if (keyInput) keyInput.value = selected.userData.keyTrigger || '';
            }
            else if (['PointLight', 'SpotLight', 'DirectionalLight'].includes(type)) {
                const colorHex = selected.userData.color !== undefined ? selected.userData.color.toString(16).padStart(6, '0') : 'ffffff';
                document.getElementById('l-color').value = '#' + colorHex;
                document.getElementById('l-intensity').value = selected.userData.intensity !== undefined ? selected.userData.intensity : 1.0;

                const panelDist = document.getElementById('panel-l-distance');
                const panelAngle = document.getElementById('panel-l-angle');
                const panelPen = document.getElementById('panel-l-penumbra');
                const panelDecay = document.getElementById('panel-l-decay');
                const panelShadowSize = document.getElementById('panel-l-shadow-size');

                if (type === 'DirectionalLight') {
                    if (panelDist) panelDist.classList.add('hidden');
                    if (panelAngle) panelAngle.classList.add('hidden');
                    if (panelPen) panelPen.classList.add('hidden');
                    if (panelDecay) panelDecay.classList.add('hidden');
                    if (panelShadowSize) panelShadowSize.classList.remove('hidden');
                } else if (type === 'PointLight') {
                    if (panelDist) panelDist.classList.remove('hidden');
                    if (panelAngle) panelAngle.classList.add('hidden');
                    if (panelPen) panelPen.classList.add('hidden');
                    if (panelDecay) panelDecay.classList.remove('hidden');
                    if (panelShadowSize) panelShadowSize.classList.add('hidden');
                    document.getElementById('l-distance').value = selected.userData.distance !== undefined ? selected.userData.distance : 10;
                    document.getElementById('l-decay').value = selected.userData.decay !== undefined ? selected.userData.decay : 2;
                } else if (type === 'SpotLight') {
                    if (panelDist) panelDist.classList.remove('hidden');
                    if (panelAngle) panelAngle.classList.remove('hidden');
                    if (panelPen) panelPen.classList.remove('hidden');
                    if (panelDecay) panelDecay.classList.remove('hidden');
                    if (panelShadowSize) panelShadowSize.classList.add('hidden');
                    document.getElementById('l-distance').value = selected.userData.distance !== undefined ? selected.userData.distance : 10;
                    document.getElementById('l-angle').value = selected.userData.angle !== undefined ? Math.round(THREE.MathUtils.radToDeg(selected.userData.angle)) : 45;
                    document.getElementById('l-penumbra').value = selected.userData.penumbra !== undefined ? selected.userData.penumbra : 0.5;
                    document.getElementById('l-decay').value = selected.userData.decay !== undefined ? selected.userData.decay : 2;
                }

                document.getElementById('l-cast-shadow').checked = selected.userData.castShadow !== false;
                document.getElementById('l-shadow-res').value = selected.userData.shadowRes || 1024;
                document.getElementById('l-shadow-bias').value = selected.userData.shadowBias || 0;
                document.getElementById('l-shadow-normal-bias').value = selected.userData.shadowNormalBias || 0;
                document.getElementById('l-shadow-radius').value = selected.userData.shadowRadius || 1;
                document.getElementById('l-shadow-near').value = selected.userData.shadowCamNear || 0.5;
                document.getElementById('l-shadow-far').value = selected.userData.shadowCamFar || 500;
                if (type === 'DirectionalLight') {
                    document.getElementById('l-shadow-size').value = selected.userData.shadowCamSize || 10;
                }
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
            const sfxFilename = action.sfxFilename || '';
            item.innerHTML = `
                <div class="action-header"><span style="font-size:12px; cursor:grab;">☰</span><input type="text" class="action-key-input" style="flex:1; margin:0 5px; font-weight:bold; color:#eb7b33;" value="${action.name || 'Action'}" data-idx="${index}" data-field="name"><div style="display:flex; align-items:center; gap:5px;"><input type="checkbox" class="action-checkbox" ${action.active !== false ? 'checked' : ''} data-idx="${index}" data-field="active"><button class="btn-icon-small" data-idx="${index}">🗑️</button></div></div>
                <div class="action-row-inputs"><input type="text" class="action-key-input" placeholder="Key" value="${action.key}" data-idx="${index}" data-field="key"><select class="action-select" data-idx="${index}" data-field="type">${typeOptions}</select><select class="action-select" data-idx="${index}" data-field="anim">${animOptions}</select><input type="checkbox" class="action-checkbox" ${action.mirror ? 'checked' : ''} data-idx="${index}" data-field="mirror"></div>
                <div style="display:flex; align-items:center; gap:5px; margin-top:4px;">
                    <span style="font-size:10px; color:#888; flex-shrink:0;">🔊 SFX:</span>
                    <span class="action-sfx-name" data-idx="${index}" style="flex:1; font-size:10px; color:#eb7b33; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${sfxFilename || '(none)'}</span>
                    <button class="level-btn-sm action-sfx-btn" data-idx="${index}">📁</button>
                    <button class="level-btn-sm danger action-sfx-clear" data-idx="${index}" style="padding:2px 4px;">✕</button>
                </div>`;
            item.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', index); item.classList.add('dragging'); });
            item.addEventListener('dragend', () => item.classList.remove('dragging'));
            item.addEventListener('dragover', (e) => { e.preventDefault(); const draggingItem = container.querySelector('.dragging'); if (draggingItem !== item) { const rect = item.getBoundingClientRect(); if (e.clientY - rect.top - rect.height / 2 < 0) container.insertBefore(draggingItem, item); else container.insertBefore(draggingItem, item.nextSibling); } });
            item.addEventListener('drop', (e) => { e.preventDefault(); const newOrder = Array.from(container.children).map(child => parseInt(child.dataset.idx)); playerObj.userData.actions = newOrder.map(i => actions[i]); this.renderActionList(playerObj); });
            container.appendChild(item);
        });
        container.querySelectorAll('.btn-icon-small[data-field]').forEach(b => {});
        container.querySelectorAll('.btn-icon-small:not([data-field])').forEach(b => b.onclick = () => this.removeAction(playerObj, parseInt(b.dataset.idx)));
        container.querySelectorAll('input, select').forEach(el => { el.onchange = (e) => { const idx = parseInt(e.target.dataset.idx), field = e.target.dataset.field; if (field) playerObj.userData.actions[idx][field] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; }; });

        // SFX pickers
        container.querySelectorAll('.action-sfx-btn').forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.idx);
                const input = document.createElement('input');
                input.type = 'file'; input.accept = 'audio/*';
                input.onchange = (ev) => {
                    const file = ev.target.files[0]; if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (f) => {
                        playerObj.userData.actions[idx].sfx = f.target.result;
                        playerObj.userData.actions[idx].sfxFilename = file.name;
                        this.renderActionList(playerObj);
                    };
                    reader.readAsDataURL(file);
                };
                input.click();
            };
        });
        container.querySelectorAll('.action-sfx-clear').forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.idx);
                delete playerObj.userData.actions[idx].sfx;
                delete playerObj.userData.actions[idx].sfxFilename;
                this.renderActionList(playerObj);
            };
        });
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
        let clone; try { clone = SkeletonUtils.clone(model); } catch (e) { clone = model.clone(); }
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

    // =================== LEVEL MANAGER ===================

    setupLevelManager() {
        const btnAdd = document.getElementById('btn-add-level');
        if (btnAdd) {
            btnAdd.onclick = () => {
                const name = `Level ${this.app.editor.levels.length + 1}`;
                this.app.editor.saveCurrentAsLevel(name);
            };
        }

        // Import a JSON file as a new level
        const btnImport = document.getElementById('btn-import-level-json');
        if (btnImport) {
            btnImport.onclick = () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        this.app.editor.importLevelFromJSON(file);
                        e.target.value = '';
                    }
                };
                input.click();
            };
        }

        this.renderLevelList();
    }

    renderLevelList() {
        const container = document.getElementById('level-list');
        if (!container) return;
        container.innerHTML = '';
        const levels = this.app.editor.levels;
        if (!levels || levels.length === 0) {
            container.innerHTML = '<div style="font-size:10px; color:#666; text-align:center; padding:8px;">Nessun livello — clicca ＋</div>';
            return;
        }
        levels.forEach((level, index) => {
            const isActive = index === this.app.editor.currentLevelIndex;
            const isStarting = index === this.app.editor.startingLevelIndex;
            const musicName = level.musicFilename || '';

            const div = document.createElement('div');
            div.className = 'level-list-item';
            div.innerHTML = `
                <span class="level-name ${isActive ? 'active-level' : ''}" title="Doppio click per rinominare — Index: ${index}">${index}: ${level.name}</span>
                <button class="level-btn-sm lv-start" data-idx="${index}" title="Imposta come livello iniziale">${isStarting ? '⭐' : '☆'}</button>
                <button class="level-btn-sm lv-play" data-idx="${index}" title="Testa questo livello">▶️</button>
                <button class="level-btn-sm lv-load" data-idx="${index}" title="Carica nel editor (auto-salva il livello corrente)">📂</button>
                <button class="level-btn-sm lv-update" data-idx="${index}" title="Aggiorna con scena corrente">💾</button>
                <button class="level-btn-sm lv-music" data-idx="${index}" title="${musicName || 'Scegli musica BGM'}">🎵</button>
                <button class="level-btn-sm danger lv-delete" data-idx="${index}" title="Cancella">🗑️</button>
            `;

            div.querySelector('.lv-start').onclick = () => {
                this.app.editor.startingLevelIndex = index;
                this.renderLevelList();
            };

            div.querySelector('.lv-play').onclick = async () => {
                const btnPlayBtn = document.getElementById('btn-play');
                
                // If testing the current active level, update the slot first
                if (index === this.app.editor.currentLevelIndex) {
                    this.app.editor.updateLevel(index);
                }

                await this.app.editor.loadLevelByIndex(index);
                if (btnPlayBtn) btnPlayBtn.classList.add('play-active');
                this.app.game.start(index);
            };

            div.querySelector('.lv-load').onclick = async () => {
                // Auto-save the current active level before switching
                const curIdx = this.app.editor.currentLevelIndex;
                if (curIdx >= 0 && curIdx < this.app.editor.levels.length) {
                    this.app.editor.updateLevel(curIdx);
                }
                await this.app.editor.loadLevelByIndex(index);
            };
            div.querySelector('.lv-update').onclick = () => { this.app.editor.updateLevel(index); };
            div.querySelector('.lv-music').onclick = () => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = 'audio/*';
                input.onchange = (ev) => {
                    const file = ev.target.files[0]; if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (f) => {
                        this.app.editor.levels[index].music = f.target.result;
                        this.app.editor.levels[index].musicFilename = file.name;
                        this.renderLevelList();
                    };
                    reader.readAsDataURL(file);
                };
                input.click();
            };
            div.querySelector('.lv-delete').onclick = () => {
                if (confirm(`Cancellare "${level.name}"?`)) {
                    this.app.editor.levels.splice(index, 1);
                    if (this.app.editor.currentLevelIndex >= this.app.editor.levels.length) {
                        this.app.editor.currentLevelIndex = -1;
                    }
                    this.renderLevelList();
                }
            };

            // Double-click the name span to rename inline
            const nameSpan = div.querySelector('.level-name');
            nameSpan.ondblclick = () => {
                const inp = document.createElement('input');
                inp.type = 'text';
                inp.value = level.name;
                inp.style.cssText = 'flex:1; font-size:10px; background:#222; border:1px solid #5588cc; color:#fff; padding:1px 4px; border-radius:3px; min-width:0;';
                nameSpan.replaceWith(inp);
                inp.focus(); inp.select();
                const commit = () => {
                    const newName = inp.value.trim() || level.name;
                    this.app.editor.levels[index].name = newName;
                    this.renderLevelList();
                };
                inp.onblur = commit;
                inp.onkeydown = (ev) => {
                    if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
                    if (ev.key === 'Escape') { inp.value = level.name; inp.blur(); }
                };
            };

            container.appendChild(div);

            if (musicName) {
                const ml = document.createElement('div');
                ml.style.cssText = 'font-size:9px; color:#888; padding:1px 7px 4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                ml.title = musicName;
                ml.textContent = '🎵 ' + musicName;
                container.appendChild(ml);
            }
        });
    }
}
