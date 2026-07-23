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
        this.collapsedObjects = new Set();
    }

    showLoading(text = "Caricamento scena in corso...") {
        const overlay = document.getElementById('global-loading-overlay');
        const label = document.getElementById('global-loading-text');
        if (label) label.innerText = text;
        if (overlay) {
            overlay.style.display = 'flex';
            overlay.style.opacity = '1';
        }
    }

    hideLoading() {
        const overlay = document.getElementById('global-loading-overlay');
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => {
                if (overlay.style.opacity === '0') {
                    overlay.style.display = 'none';
                }
            }, 300);
        }
    }

    async uploadAssetFile(file, assetType = 'assets') {
        const projectName = this.app.editor.projectName || 'default_project';
        const response = await fetch('/api/upload-asset', {
            method: 'POST',
            headers: {
                'x-project-name': encodeURIComponent(projectName),
                'x-asset-type': encodeURIComponent(assetType),
                'x-filename': encodeURIComponent(file.name)
            },
            body: file
        });
        const result = await response.json();
        if (result.success) {
            return '/' + result.path.replace(/\\/g, '/');
        } else {
            throw new Error(result.error);
        }
    }

    init() {
        this.setupToolbar();
        this.setupPropertyTabs();
        this.setupPanels();
        this.setupInputs();
        this.setupResizers();
        this.setupAssetManager();
        this.setupEquipPreview();
        this.setupLevelManager();

        // Apri il selettore dei progetti all'avvio
        setTimeout(() => {
            const btnLoadProject = document.getElementById('btn-load-project');
            if (btnLoadProject) btnLoadProject.click();
        }, 300);
    }

    rebuildLibrary() {
        const getB64 = (s) => {
            if (!s || typeof s !== 'string') return '';
            const idx = s.indexOf(',');
            return idx !== -1 ? s.substring(idx + 1) : s;
        };
        const matchData = (d1, d2) => {
            if (!d1 && !d2) return true;
            if (!d1 || !d2) return false;
            return getB64(d1) === getB64(d2);
        };

        const uniqueLib = [];

        const addUnique = (item) => {
            if (!item || !item.type || item.type === 'undefined') return;
            let name = item.name || item.type;
            const type = item.type;
            const data = item.data || null;
            const defaultAnim = item.defaultAnim || null;

            // Per i tipi di asset standard (non-Model e non-SplatEnv), la card nell'Asset Library
            // rappresenta il TEMPLATE e ha sempre il nome standard del tipo ('Player', 'Main Camera', 'DirectionalLight', etc.)
            if (type !== 'Model' && type !== 'SplatEnv') {
                if (type === 'Player') name = 'Player';
                else if (type === 'Camera') name = 'Main Camera';
                else name = type;
            }

            // Per i tipi standard esiste al massimo UNA sola card di template nella libreria.
            // Per i Modelli GLB e i file SplatEnv personalizzati, ciascuna sorgente univoca ha la sua card.
            const exists = uniqueLib.find(i => {
                if (type === 'Model' || type === 'SplatEnv') {
                    return i.type === type && i.name === name && matchData(i.data, data);
                } else {
                    return i.type === type;
                }
            });

            if (!exists) {
                uniqueLib.push({ name, type, data, defaultAnim });
            }
        };

        // 1. Inserisci prima le definizioni correnti nella library
        (this.library || []).forEach(item => addUnique(item));

        // 2. Registra eventuali sorgenti GLB / SplatEnv personalizzate attive negli oggetti della scena
        this.app.editor.objects.forEach(obj => {
            if (obj.userData.type === 'Model' && obj.userData.glbSource) {
                addUnique({
                    name: obj.userData.glbFilename || 'Model',
                    type: 'Model',
                    data: obj.userData.glbSource,
                    defaultAnim: obj.userData.defaultAnim
                });
            } else if (obj.userData.type === 'SplatEnv' && obj.userData.splatSource) {
                addUnique({
                    name: obj.userData.glbFilename || 'SplatEnv',
                    type: 'SplatEnv',
                    data: obj.userData.splatSource
                });
            }
        });

        // 3. Rimuovi modelli personalizzati vuoti o non più referenziati
        const finalLib = uniqueLib.filter(item => {
            if (item.type === 'Model') {
                if (!item.data || item.name === 'Model' || item.name === 'Unknown' || item.name.startsWith('Model_')) {
                    return false;
                }
                return this.app.editor.objects.some(obj => matchData(obj.userData.glbSource, item.data));
            }
            if (item.type === 'Camera' && item.name === 'Camera') {
                return false;
            }
            return true;
        });

        // Posiziona il Player come primo elemento
        const playerIdx = finalLib.findIndex(i => i.type === 'Player');
        if (playerIdx > 0) {
            const p = finalLib.splice(playerIdx, 1)[0];
            finalLib.unshift(p);
        }

        this.library = finalLib;
        this.restoreLibrary(this.library);
    }

    restoreLibrary(libraryData) {
        this.library = [];
        const content = document.getElementById('asset-content');
        if (content) content.innerHTML = '';
        
        if (libraryData) {
            const getB64 = (s) => {
                if (!s || typeof s !== 'string') return '';
                const idx = s.indexOf(',');
                return idx !== -1 ? s.substring(idx + 1) : s;
            };
            const matchData = (d1, d2) => {
                if (!d1 && !d2) return true;
                if (!d1 || !d2) return false;
                return getB64(d1) === getB64(d2);
            };

            const cleanedList = [];
            libraryData.forEach(item => {
                let name = item.name;
                const type = item.type;
                const data = item.data || null;
                const defaultAnim = item.defaultAnim;

                // Rimuovi suffissi numerici di istanza (es. "Enemy_3" -> "Enemy") ad esclusione dei modelli GLB caricati
                if (type !== 'Model' && typeof name === 'string' && name.match(/_[0-9]+$/)) {
                    name = type;
                }

                // Evita duplicati basati su nome normalizzato, tipo e sorgente
                const exists = cleanedList.find(i => i.name === name && i.type === type && matchData(i.data, data));
                if (!exists) {
                    cleanedList.push({ name, type, data, defaultAnim });
                }
            });

            cleanedList.forEach(item => this.createAssetCard(item.name, item.type, item.data, true, item.defaultAnim));
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
                const menuItem = e.target.closest('.asset-menu-item') || item;
                const type = menuItem ? menuItem.dataset.type : null;
                if (!type || type === 'undefined') return;

                if (type === 'Player') {
                    this.createAssetCard('Player', 'Player', null, true);
                } else if (type === 'Camera') {
                    this.createAssetCard('Main Camera', 'Camera', null, true);
                } else if (type === 'load') {
                    const input = document.createElement('input');
                    input.type = 'file'; input.accept = '.glb,.gltf';
                    input.onchange = async (ev) => {
                        const file = ev.target.files[0];
                        if (file) {
                            try {
                                this.app.ui.showToast(`Uploading ${file.name}...`, 2000);
                                const url = await this.uploadAssetFile(file, 'assets');
                                this.createAssetCard(file.name, 'Model', url, true);
                            } catch (err) {
                                console.error("Upload error:", err);
                                alert("Errore caricamento file: " + err.message);
                            }
                        }
                    };
                    input.click();
                } else if (type === 'SplatEnv') {
                    const splatInput = document.getElementById('splat-input');
                    splatInput.onchange = async (ev) => {
                        const file = ev.target.files[0];
                        if (file) {
                            try {
                                this.app.ui.showToast(`Uploading ${file.name}...`, 2000);
                                const url = await this.uploadAssetFile(file, 'assets');
                                this.createAssetCard(file.name, 'SplatEnv', url, true);
                            } catch (err) {
                                console.error("Upload error:", err);
                                alert("Errore caricamento file: " + err.message);
                            }
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
        const normData = data || null;
        if (addToLibraryArray) {
            const getB64 = (s) => {
                if (!s || typeof s !== 'string') return '';
                const idx = s.indexOf(',');
                return idx !== -1 ? s.substring(idx + 1) : s;
            };
            const matchData = (d1, d2) => {
                if (!d1 && !d2) return true;
                if (!d1 || !d2) return false;
                return getB64(d1) === getB64(d2);
            };

            const exists = this.library.find(item => item.name === name && item.type === type && matchData(item.data, normData));
            if (!exists) this.library.push({ name, type, data: normData, defaultAnim });
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
        if (type === 'Analyze') color = '#33cccc', icon = '🔍';
        if (type === 'Dialog') color = '#7733cc', icon = '💬';
        if (type === 'Camera') color = '#555555', icon = '🎥';
        if (type === 'EmbedHTML') color = '#ff00ff', icon = '🌐';
        if (type === 'CutScene') color = '#0099ff', icon = '🎬';
        if (type === 'SoundEffect') color = '#ff66aa', icon = '🔊';

        card.style.borderColor = color;
        const thumbId = "thumb-" + (Math.floor(Math.random() * 1000000));
        card.innerHTML = "\n            <div class=\"asset-icon\" id=\"icon-" + (thumbId) + "\">" + (icon) + "</div>\n            <div style=\"font-size:9px; font-weight:bold; color:#888; margin-top:4px;\">" + (type) + "</div>\n            <div class=\"asset-label\" style=\"color:" + (color) + "\">" + (name) + "</div>\n        ";

        const isGLTFType = ['Enemy', 'Bonus', 'Boss', 'PowerUp', 'Spawn', 'Goal', 'Catcher', 'catcher_base', 'Model'].includes(type);
        if (data && isGLTFType) {
            new GLTFLoader().load(data, (gltf) => {
                const iconDiv = card.querySelector('.asset-icon');
                // Ensure iconDiv still exists (card might be removed)
                if (iconDiv) {
                    const imgId = "img-" + (thumbId);
                    iconDiv.innerHTML = "<img id=\"" + (imgId) + "\" style=\"width:100%; height:100%; object-fit:contain;\">";
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

        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            let menu = document.getElementById('asset-context-menu');
            if (!menu) {
                menu = document.createElement('div');
                menu.id = 'asset-context-menu';
                menu.style.cssText = "\n                    position: fixed;\n                    z-index: 10000;\n                    background: #1e1e24;\n                    border: 1px solid #3e3e4a;\n                    box-shadow: 0 10px 30px rgba(0,0,0,0.6);\n                    border-radius: 6px;\n                    padding: 4px 0;\n                    font-size: 11px;\n                    font-family: sans-serif;\n                    min-width: 150px;\n                ";
                document.body.appendChild(menu);
            }

            menu.style.left = e.clientX + 'px';
            menu.style.top = e.clientY + 'px';
            menu.style.display = 'block';

            menu.innerHTML = '';

            // Option 1: Sostituisci Asset
            const isReplaceable = ['Model', 'SplatEnv', 'CutScene', 'SoundEffect'].includes(type);
            if (isReplaceable) {
                const repOpt = document.createElement('div');
                repOpt.innerHTML = '🔄 Sostituisci Asset';
                repOpt.style.cssText = 'padding: 8px 14px; cursor: pointer; color: #00ffcc; font-weight: bold;';
                repOpt.onmouseover = () => repOpt.style.background = '#2c2c35';
                repOpt.onmouseout = () => repOpt.style.background = 'none';
                repOpt.onclick = () => {
                    menu.style.display = 'none';
                    const input = document.createElement('input');
                    input.type = 'file';
                    if (type === 'Model') input.accept = '.glb,.gltf';
                    else if (type === 'SplatEnv') input.accept = '.ply,.splat';
                    else if (type === 'CutScene') input.accept = 'video/*';
                    else if (type === 'SoundEffect') input.accept = 'audio/*';

                    input.onchange = (ev) => {
                        const file = ev.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (f) => {
                                // 1. Update library array item
                                const idx = this.library.findIndex(item => item.type === type && item.data === data && item.name === name);
                                if (idx > -1) {
                                    this.library[idx].data = f.target.result;
                                    this.library[idx].name = file.name;
                                }

                                // 2. Update active scene objects using this asset data
                                this.app.editor.objects.forEach(o => {
                                    if (o.userData.type === type) {
                                        if (type === 'Model' && o.userData.glbSource === data) {
                                            o.name = file.name;
                                            o.userData.glbSource = f.target.result;
                                            o.userData.glbFilename = file.name;
                                            this.app.editor.reloadModel(o, f.target.result);
                                        } else if (type === 'SplatEnv' && o.userData.splatSource === data) {
                                            o.name = file.name;
                                            o.userData.splatSource = f.target.result;
                                            o.userData.splatFilename = file.name;
                                            this.app.editor.reloadSplat(o);
                                        } else if (type === 'CutScene' && o.userData.videoSource === data) {
                                            o.name = file.name;
                                            o.userData.videoSource = f.target.result;
                                            o.userData.videoFilename = file.name;
                                        } else if (type === 'SoundEffect' && o.userData.audioSource === data) {
                                            o.name = file.name;
                                            o.userData.audioSource = f.target.result;
                                            o.userData.audioFilename = file.name;
                                        }
                                    }
                                });

                                // 3. Refresh and update UI
                                this.restoreLibrary(this.library);
                                this.updateProperties();
                            };
                            reader.readAsDataURL(file);
                        }
                    };
                    input.click();
                };
                menu.appendChild(repOpt);
            }

            // Option 2: Elimina Asset (only if not Player)
            if (type !== 'Player') {
                const delOpt = document.createElement('div');
                delOpt.innerHTML = '❌ Elimina Asset';
                delOpt.style.cssText = 'padding: 8px 14px; cursor: pointer; color: #ff5555; border-top: 1px solid #2e2e38;';
                delOpt.onmouseover = () => delOpt.style.background = '#2c2c35';
                delOpt.onmouseout = () => delOpt.style.background = 'none';
                delOpt.onclick = () => {
                    this.removeAsset(type, data);
                    menu.style.display = 'none';
                };
                menu.appendChild(delOpt);
            }

            const closeMenu = () => {
                menu.style.display = 'none';
                document.removeEventListener('click', closeMenu);
            };
            setTimeout(() => document.addEventListener('click', closeMenu), 50);
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
        const btnRedo = document.getElementById('btn-redo');
        if (btnRedo) {
            btnRedo.onclick = () => this.app.editor.redo();
        }
        document.getElementById('btn-trans').onclick = () => { this.app.editor.gizmo.setMode('translate'); this.setActiveTool('btn-trans'); };
        document.getElementById('btn-rot').onclick = () => { this.app.editor.gizmo.setMode('rotate'); this.setActiveTool('btn-rot'); };
        document.getElementById('btn-scale').onclick = () => { this.app.editor.gizmo.setMode('scale'); this.setActiveTool('btn-scale'); };
        document.getElementById('btn-delete').onclick = () => this.app.editor.deleteSelected();
        document.getElementById('btn-save').onclick = () => this.app.editor.saveProject();

        document.getElementById('snap-trans').onchange = (e) => this.app.editor.setTranslationSnap(e.target.checked);
        document.getElementById('snap-rot').onchange = (e) => this.app.editor.setRotationSnap(e.target.checked);
        document.getElementById('snap-scale').onchange = (e) => this.app.editor.setScaleSnap(e.target.checked);

        const gizmoCenter = document.getElementById('gizmo-center');
        if (gizmoCenter) {
            gizmoCenter.onchange = (e) => this.app.editor.toggleGizmoCenter();
        }

        const btnGameView = document.getElementById('btn-game-view');
        if (btnGameView) {
            btnGameView.onclick = () => {
                document.body.classList.toggle('game-view-mode');
                const isGameView = document.body.classList.contains('game-view-mode');
                btnGameView.classList.toggle('game-view-active', isGameView);
                
                // Toggle gizmo visibility in game view mode
                if (this.app.editor.gizmo) {
                    if (isGameView) {
                        this.app.editor.gizmo.detach();
                    } else if (this.app.editor.selected) {
                        this.app.editor.gizmo.attach(this.app.editor.selected);
                    }
                }
                
                setTimeout(() => this.app.sceneManager.onResize(), 300);
            };
        }

        // Footer Tabs Navigation
        const tabBtns = document.querySelectorAll('.footer-tab-btn');
        tabBtns.forEach(btn => {
            btn.onclick = () => {
                tabBtns.forEach(b => {
                    b.classList.remove('active');
                    b.style.color = '#888';
                });
                btn.classList.add('active');
                btn.style.color = '#fff';

                const tab = btn.getAttribute('data-tab');
                document.getElementById('footer-tab-assets').classList.toggle('hidden', tab !== 'assets');
                document.getElementById('footer-tab-sequencer').classList.toggle('hidden', tab !== 'sequencer');
                this.updateSequencerUI();
            };
        });

        // Sequencer bindings
        const seqRecord = document.getElementById('seq-record');
        if (seqRecord) {
            seqRecord.onclick = () => {
                const actor = this.app.editor.selected;
                if (!actor) {
                    alert("Seleziona prima un oggetto!");
                    return;
                }
                const time = this.app.sceneManager.seqTime;
                
                // Remove duplicates at same time
                this.app.sceneManager.keyframes = this.app.sceneManager.keyframes.filter(k => !(k.actorId === actor.uuid && k.time === time));
                
                this.app.sceneManager.keyframes.push({
                    actorId: actor.uuid,
                    time: time,
                    pos: actor.position.clone(),
                    rot: actor.rotation.clone(),
                    scl: actor.scale.clone()
                });
                
                this.updateSequencerUI();
            };
        }

        const seqPlay = document.getElementById('seq-play');
        if (seqPlay) {
            seqPlay.onclick = () => {
                this.app.sceneManager.isSeqPlaying = true;
                document.getElementById('seq-playback-status').textContent = 'Playing';
            };
        }

        const seqStop = document.getElementById('seq-stop');
        if (seqStop) {
            seqStop.onclick = () => {
                this.app.sceneManager.isSeqPlaying = false;
                document.getElementById('seq-playback-status').textContent = 'Stopped';
            };
        }

        const seqLoop = document.getElementById('seq-loop');
        if (seqLoop) {
            seqLoop.onclick = () => {
                this.app.sceneManager.seqLoop = !this.app.sceneManager.seqLoop;
                seqLoop.classList.toggle('active', this.app.sceneManager.seqLoop);
                seqLoop.style.background = this.app.sceneManager.seqLoop ? '#4f46e5' : '#262a32';
            };
        }

        const seqClear = document.getElementById('seq-clear');
        if (seqClear) {
            seqClear.onclick = () => {
                this.app.sceneManager.keyframes = [];
                this.updateSequencerUI();
            };
        }

        const timelineBar = document.getElementById('timeline-bar');
        if (timelineBar) {
            timelineBar.onclick = (e) => {
                const rect = timelineBar.getBoundingClientRect();
                const pct = ((e.clientX - rect.left) / rect.width) * 100;
                this.app.sceneManager.seqTime = Math.max(0, Math.min(100, pct));
                const playhead = document.getElementById('timeline-playhead');
                if (playhead) {
                    playhead.style.left = `${this.app.sceneManager.seqTime}%`;
                }
                this.app.sceneManager.interpolateSequencer();
            };
        }

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
                // Load the currently active level being edited then start
                const currentIdx = this.app.editor.currentLevelIndex >= 0 ? this.app.editor.currentLevelIndex : 0;

                // Update the slot first before playing
                this.app.editor.updateLevel(currentIdx);

                await this.app.editor.loadLevelByIndex(currentIdx);
                this.app.game.start(currentIdx);
                btnPlay.classList.add('play-active');
            }
        };

        // Fallback silenzioso: project-load-input carica file JSON locali
        document.getElementById('project-load-input').onchange = (e) => {
            const file = e.target.files[0];
            if (file) { this.app.editor.loadProject(file); e.target.value = ''; }
        };

        // ========== PROJECT SELECTOR MODAL ==========
        const btnLoadProject = document.getElementById('btn-load-project');
        const projectModal   = document.getElementById('project-selector-modal');
        const projectGrid    = document.getElementById('project-grid');
        const btnCloseModal  = document.getElementById('btn-close-project-selector');
        const btnNewProject  = document.getElementById('btn-new-project');

        const openProjectModal = async () => {
            projectGrid.innerHTML = '<div style="color:#666;font-size:13px;grid-column:1/-1;text-align:center;padding:40px;">⏳ Caricamento progetti...</div>';
            projectModal.classList.remove('hidden');

            try {
                const res = await fetch('/api/list-projects');
                const projects = await res.json();
                projectGrid.innerHTML = '';

                if (!Array.isArray(projects) || projects.length === 0) {
                    projectGrid.innerHTML = '<div style="color:#666;font-size:13px;grid-column:1/-1;text-align:center;padding:40px;">📭 Nessun progetto trovato.<br><span style=\'color:#555;\'>Clicca "+ Nuovo Progetto" per crearne uno.</span></div>';
                    return;
                }

                projects.forEach(proj => {
                    // --- CARD WRAPPER ---
                    const wrapper = document.createElement('div');
                    wrapper.style.cssText = 'display:flex;flex-direction:column;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;transition:border-color 0.2s;';
                    wrapper.onmouseover = () => { wrapper.style.borderColor = 'rgba(235,123,51,0.5)'; };
                    wrapper.onmouseout  = () => { wrapper.style.borderColor = 'rgba(255,255,255,0.08)'; };

                    // --- THUMBNAIL ---
                    const thumb = document.createElement('div');
                    thumb.style.cssText = "position:relative;aspect-ratio:16/9;background:" + (proj.splashImage ? "url(" + (proj.splashImage) + ") center/cover" : 'linear-gradient(135deg,#1e293b,#0f172a)') + ";cursor:pointer;overflow:hidden;";

                    // Overlay gradiente con titolo
                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.85) 30%,transparent);display:flex;flex-direction:column;justify-content:flex-end;padding:10px;';
                    const titleEl = document.createElement('div');
                    titleEl.style.cssText = 'font-weight:700;font-size:13px;color:#fff;text-shadow:0 2px 4px rgba(0,0,0,0.9);';
                    titleEl.textContent = proj.title || proj.name;
                    const subtEl = document.createElement('div');
                    subtEl.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.5);margin-top:2px;';
                    subtEl.textContent = proj.splashSubtitle || proj.name;
                    overlay.appendChild(titleEl);
                    overlay.appendChild(subtEl);
                    thumb.appendChild(overlay);

                    // Pulsante elimina (cestino)
                    const btnDel = document.createElement('button');
                    btnDel.innerHTML = '🗑️';
                    btnDel.title = 'Elimina Progetto';
                    btnDel.style.cssText = 'position:absolute;top:8px;right:8px;z-index:10;border:none;background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.4);color:#ef4444;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;transition:background 0.2s;';
                    btnDel.onmouseover = () => { btnDel.style.background = 'rgba(239,68,68,0.6)'; };
                    btnDel.onmouseout  = () => { btnDel.style.background = 'rgba(239,68,68,0.2)'; };
                    btnDel.onclick = async (e) => {
                        e.stopPropagation();
                        if (!confirm("Eliminare definitivamente il progetto \"" + (proj.name) + "\"?")) return;
                        try {
                            const r = await fetch('/api/delete-project', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ projectName: proj.name }) });
                            const d = await r.json();
                            if (d.success) { wrapper.remove(); }
                            else { alert('Errore eliminazione: ' + (d.error || 'sconosciuto')); }
                        } catch(err) { alert('Impossibile contattare il server.'); }
                    };

                    // Click su thumbnail = carica progetto completo
                    const loadProjectData = async () => {
                        projectModal.classList.add('hidden');
                        this.showLoading(`Caricamento progetto "${proj.name}"...`);
                        try {
                            const projRes = await fetch("./projects/" + (proj.name) + "/project.json?t=" + (Date.now()));
                            if (!projRes.ok) throw new Error('Impossibile scaricare project.json');
                            const projData = await projRes.json();

                            this.app.editor.projectName = proj.name;
                            this.app.editor.clearScene();
                            this.app.editor.levels = (projData.levels || []).map(lvl => ({
                                name: lvl.name || 'Level',
                                music: lvl.music || '',
                                musicFilename: lvl.musicFilename || '',
                                isExternal: !!lvl.isExternal,
                                externalFilename: lvl.externalFilename || '',
                                fileHandle: null,
                                data: (lvl.data === null || lvl.data === undefined) ? null : (typeof lvl.data === 'string' ? lvl.data : JSON.stringify(lvl.data || {}))
                            }));
                            this.app.editor.currentLevelIndex = -1;
                            this.app.editor.gameTitle        = projData.gameTitle || proj.title;
                            this.app.editor.gameSplashSubtitle = projData.gameSplashSubtitle || '';
                            this.app.editor.gameSplashImage  = projData.gameSplashImage || null;
                            this.app.editor.gameSplashMusic  = projData.gameSplashMusic || null;
                            this.app.editor.gameSplashMusicFilename = projData.gameSplashMusicFilename || '';
                            this.app.editor.startingLevelIndex = projData.startingLevelIndex ?? 0;
                            this.app.editor.gameEndTitle      = projData.gameEndTitle || '';
                            this.app.editor.gameEndSubtitle   = projData.gameEndSubtitle || '';
                            this.app.editor.gameEndImage      = projData.gameEndImage || null;
                            this.app.editor.gameEndVideo      = projData.gameEndVideo || null;
                            this.app.editor.gameEndMusic      = projData.gameEndMusic || null;

                            if (this.restoreLibrary) this.restoreLibrary(projData.library || []);
                            if (this.renderLevelList) this.renderLevelList();

                            const startIdx = this.app.editor.startingLevelIndex;
                            if (Array.isArray(this.app.editor.levels) && this.app.editor.levels.length > 0) {
                                await this.app.editor.loadLevelByIndex(startIdx);
                            }
                            this.update();
                        } catch(err) {
                            console.error('[ProjectSelector] Errore caricamento progetto:', err);
                            if (this.showModalAlert) this.showModalAlert('Errore', "⚠️ Impossibile caricare il progetto \"" + (proj.name) + "\".\n" + (err.message));
                        } finally {
                            this.hideLoading();
                        }
                    };
                    overlay.onclick = loadProjectData;

                    thumb.appendChild(overlay);
                    wrapper.appendChild(thumb);

                    // --- BARRA PULSANTI (carica JSON singoli / crea JSON) ---
                    const btnRow = document.createElement('div');
                    btnRow.style.cssText = 'display:flex;border-top:1px solid rgba(255,255,255,0.05);';

                    const btnToggle = document.createElement('button');
                    btnToggle.textContent = '📄 Livelli JSON ▾';
                    btnToggle.style.cssText = 'flex:1;padding:8px;font-size:10px;background:transparent;border:none;border-right:1px solid rgba(255,255,255,0.05);color:#aaa;cursor:pointer;';

                    const btnCreate = document.createElement('button');
                    btnCreate.textContent = '➕ Crea JSON';
                    btnCreate.style.cssText = 'flex:1;padding:8px;font-size:10px;background:transparent;border:none;color:var(--accent);cursor:pointer;';

                    btnRow.appendChild(btnToggle);
                    btnRow.appendChild(btnCreate);
                    wrapper.appendChild(btnRow);

                    // --- LISTA LIVELLI JSON ---
                    const lvlList = document.createElement('div');
                    lvlList.style.cssText = 'display:none;flex-direction:column;gap:4px;padding:8px;background:rgba(0,0,0,0.25);max-height:120px;overflow-y:auto;border-top:1px solid rgba(255,255,255,0.05);';

                    if (proj.levels && proj.levels.length > 0) {
                        proj.levels.forEach(lvlFile => {
                            const btn = document.createElement('button');
                            btn.textContent = "📂 " + (lvlFile);
                            btn.style.cssText = 'text-align:left;padding:5px 8px;font-size:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);color:#ccc;border-radius:4px;cursor:pointer;';
                            btn.onclick = async (e) => {
                                e.stopPropagation();
                                projectModal.classList.add('hidden');
                                this.showLoading(`Caricamento livello "${lvlFile}"...`);
                                try {
                                    this.app.editor.projectName = proj.name;
                                    const lvlRes = await fetch("./projects/" + (proj.name) + "/levels/" + (lvlFile) + "?t=" + (Date.now()));
                                    if (!lvlRes.ok) throw new Error('File livello non trovato');
                                    const lvlData = await lvlRes.json();
                                    this.app.editor.clearScene();
                                    if (this.restoreLibrary) this.restoreLibrary(lvlData.library || []);
                                    const sceneArray = Array.isArray(lvlData.scene) ? lvlData.scene : (Array.isArray(lvlData) ? lvlData : []);
                                    await Promise.all(this.app.editor._restoreSceneData(sceneArray));

                                    // Restore rendering settings
                                    if (lvlData.gamePBR !== undefined)     this.app.sceneManager.setPBROutput(lvlData.gamePBR);
                                    if (lvlData.gameShadows !== undefined)  this.app.sceneManager.setShadows(lvlData.gameShadows);
                                    if (lvlData.gameReflections !== undefined) this.app.sceneManager.setReflections(lvlData.gameReflections);
                                    if (lvlData.gameExposure !== undefined) this.app.sceneManager.setExposure(lvlData.gameExposure);
                                    if (lvlData.gamePixelEffect !== undefined) this.app.sceneManager.setPixelEffect(lvlData.gamePixelEffect, lvlData.gamePixelSize || 6);
                                    if (lvlData.gameBloomEffect !== undefined) this.app.sceneManager.setBloomEffect(lvlData.gameBloomEffect, lvlData.gameBloomStrength, lvlData.gameBloomRadius);
                                    if (lvlData.gameCyberpunkEffect !== undefined) this.app.sceneManager.setCyberpunkEffect(lvlData.gameCyberpunkEffect, lvlData.gameCyberpunkAberration, lvlData.gameCyberpunkScanlines);
                                    if (lvlData.gameSkyboxData !== undefined) this.app.sceneManager.setSkybox(lvlData.gameSkyboxData, lvlData.gameSkyboxFilename || "");
                                    if (lvlData.gameSkyboxIntensity !== undefined) this.app.sceneManager.setSkyboxIntensity(lvlData.gameSkyboxIntensity);
                                    if (lvlData.gameSkyboxVisible !== undefined) this.app.sceneManager.setSkyboxVisibility(lvlData.gameSkyboxVisible);

                                    // Sync level slot
                                    if (!Array.isArray(this.app.editor.levels)) this.app.editor.levels = [];
                                    const existingIdx = this.app.editor.levels.findIndex(l => l.externalFilename === lvlFile);
                                    if (existingIdx >= 0) {
                                        this.app.editor.currentLevelIndex = existingIdx;
                                        this.app.editor.levels[existingIdx].data = JSON.stringify(lvlData);
                                    } else {
                                        this.app.editor.levels.push({ name: lvlFile.replace(/\.json$/i,''), isExternal:true, externalFilename:lvlFile, data:JSON.stringify(lvlData) });
                                        this.app.editor.currentLevelIndex = this.app.editor.levels.length - 1;
                                    }
                                    if (this.renderLevelList) this.renderLevelList();
                                    this.update();
                                } catch(err) {
                                    console.error('[ProjectSelector] Errore caricamento livello:', err);
                                    if (this.showModalAlert) this.showModalAlert('Errore', "⚠️ Impossibile caricare il livello \"" + (lvlFile) + "\".\n" + (err.message));
                                } finally {
                                    this.hideLoading();
                                }
                            };
                            lvlList.appendChild(btn);
                        });
                    } else {
                        const empty = document.createElement('div');
                        empty.style.cssText = 'font-size:10px;color:#555;text-align:center;padding:6px;';
                        empty.textContent = 'Nessun file JSON trovato.';
                        lvlList.appendChild(empty);
                    }
                    wrapper.appendChild(lvlList);

                    btnToggle.onclick = (e) => {
                        e.stopPropagation();
                        const open = lvlList.style.display === 'flex';
                        lvlList.style.display = open ? 'none' : 'flex';
                        btnToggle.textContent = open ? '📄 Livelli JSON ▾' : '📄 Livelli JSON ▴';
                    };

                    btnCreate.onclick = (e) => {
                        e.stopPropagation();
                        if (this.showModalPrompt) {
                            this.showModalPrompt('Nuovo Livello JSON', "Nome del file JSON per il progetto \"" + (proj.name) + "\":", '', async (name) => {
                                if (!name) return;
                                try {
                                    const r = await fetch('/api/create-level', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ projectName:proj.name, levelName:name }) });
                                    const d = await r.json();
                                    if (d.success) {
                                        if (this.showModalAlert) this.showModalAlert('Livello Creato', "✓ File \"" + (d.filename) + "\" creato nel progetto \"" + (proj.name) + "\".");
                                    } else { if (this.showModalAlert) this.showModalAlert('Errore', '⚠️ ' + (d.error || 'Errore sconosciuto')); }
                                } catch(err) { if (this.showModalAlert) this.showModalAlert('Errore', '⚠️ Impossibile contattare il server.'); }
                            });
                        }
                    };

                    projectGrid.appendChild(wrapper);
                });

            } catch(err) {
                console.error('[ProjectSelector] Errore fetch lista progetti:', err);
                projectGrid.innerHTML = '<div style="color:#ef4444;font-size:13px;grid-column:1/-1;text-align:center;padding:40px;">⚠️ Impossibile caricare la lista progetti.<br><span style=\'color:#555;font-size:11px;\'>Assicurati che server.js sia attivo su localhost:8000</span></div>';
            }
        };

        if (btnLoadProject) btnLoadProject.onclick = openProjectModal;

        if (btnCloseModal) btnCloseModal.onclick = () => projectModal.classList.add('hidden');

        // Chiudi modal su click fuori dalla finestra
        projectModal.addEventListener('click', (e) => {
            if (e.target === projectModal) projectModal.classList.add('hidden');
        });

        // Chiudi modal con ESC
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !projectModal.classList.contains('hidden')) {
                projectModal.classList.add('hidden');
            }
        });

        // Crea nuovo progetto
        if (btnNewProject) {
            btnNewProject.onclick = (e) => {
                e.stopPropagation();
                if (this.showModalPrompt) {
                    this.showModalPrompt('Nuovo Progetto', 'Nome del progetto (solo lettere, numeri, - e _):', '', async (name) => {
                        if (!name) return;
                        const sanitized = name.trim().replace(/\s+/g, '_');
                        try {
                            const r = await fetch('/api/create-project', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: sanitized }) });
                            const d = await r.json();
                            if (d.success) {
                                this.app.editor.projectName = d.projectName;
                                projectModal.classList.add('hidden');
                                if (this.showModalAlert) this.showModalAlert('Progetto Creato', "✓ Progetto \"" + (d.projectName) + "\" creato con successo!");
                            } else {
                                if (this.showModalAlert) this.showModalAlert('Errore', '⚠️ ' + (d.error || 'Nome non valido'));
                            }
                        } catch(err) {
                            if (this.showModalAlert) this.showModalAlert('Errore Connessione', '⚠️ Impossibile comunicare con il server.\nAssicurati che server.js sia in esecuzione.');
                        }
                    });
                }
            };
        }
    }

    setActiveTool(id) {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        const el = document.getElementById(id); if (el) el.classList.add('active');
    }

    // ========== VERTICAL PROPERTY TABS ==========
    setActivePropTab(tabName) {
        document.querySelectorAll('.prop-vtab').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tabName);
        });
        document.querySelectorAll('.prop-tab-content').forEach(c => {
            c.classList.toggle('active', c.dataset.tab === tabName);
        });
        this._activePropTab = tabName;
    }

    setupPropertyTabs() {
        const sectionGame = document.getElementById('section-game');
        if (sectionGame) {
            const gameTabContent = document.querySelector('.prop-tab-content[data-tab="game"]');
            if (gameTabContent && !gameTabContent.contains(sectionGame)) {
                sectionGame.classList.remove('hidden');
                gameTabContent.innerHTML = '';
                gameTabContent.appendChild(sectionGame);
            }
        }

        document.querySelectorAll('.prop-vtab').forEach(btn => {
            btn.onclick = () => this.setActivePropTab(btn.dataset.tab);
        });

        // Gestione Accordion Game Properties collassabili
        document.querySelectorAll('.game-accordion-header').forEach(header => {
            header.onclick = () => {
                const targetId = "accordion-" + (header.dataset.accordion);
                const targetContent = document.getElementById(targetId);
                
                // Toggle l'attuale cliccato
                targetContent.classList.toggle('open');
                header.classList.toggle('active');
            };
        });

        this._activePropTab = 'game';
    }

    setupPanels() {
        const btnGameProps = document.getElementById('btn-game-props');
        if (btnGameProps) {
            btnGameProps.onclick = () => { 
                this.app.editor.select(null); 
                this.setActivePropTab('game'); 
            };
        }
        document.getElementById('btn-import').onclick = () => document.getElementById('glb-input').click();
        document.getElementById('glb-input').onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    this.showToast(`Uploading ${file.name}...`, 2000);
                    const url = await this.uploadAssetFile(file, 'assets');
                    const container = document.getElementById('glb-preview-container'), nameInput = document.getElementById('glb-filename');
                    if (container) container.style.display = 'flex';
                    if (nameInput) nameInput.value = file.name;
                    if (this.app.editor.selected) {
                        this.app.editor.selected.userData.glbFilename = file.name;
                        this.app.editor.selected.userData.glbSource = url;
                    }
                    this.app.editor.loadGLB(url, (m) => this.generateThumbnail(m, 'glb-preview-img'));
                } catch (err) {
                    console.error("Upload error:", err);
                    alert("Errore caricamento file: " + err.message);
                }
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
                    selected.userData.isAligned = true;

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
        const outlinerFilter = document.getElementById('outliner-filter');
        if (outlinerFilter) {
            outlinerFilter.oninput = () => {
                this.updateOutliner();
            };
        }

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
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) {
                    try {
                        this.showToast(`Uploading ${file.name}...`, 2000);
                        const url = await this.uploadAssetFile(file, 'assets');
                        this.app.editor.gameSplashImage = url;
                        this.updateProperties(); // Refresh preview
                    } catch (err) {
                        console.error(err);
                        alert("Errore upload: " + err.message);
                    }
                }
            };
            input.click();
        };

        const btnSplashMusic = document.getElementById('btn-splash-music');
        if (btnSplashMusic) btnSplashMusic.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'audio/*';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) {
                    try {
                        this.showToast(`Uploading ${file.name}...`, 2000);
                        const url = await this.uploadAssetFile(file, 'music');
                        this.app.editor.gameSplashMusic = url;
                        this.app.editor.gameSplashMusicFilename = file.name;
                        this.updateProperties(); // Refresh UI
                    } catch (err) {
                        console.error(err);
                        alert("Errore upload: " + err.message);
                    }
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
            // Open Game Properties tab and scroll to End Screen section
            this.setActivePropTab('game');
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
            input.onchange = async (e) => {
                const file = e.target.files[0]; if (!file) return;
                try {
                    this.showToast(`Uploading ${file.name}...`, 2000);
                    const url = await this.uploadAssetFile(file, 'assets');
                    this.app.editor.gameEndImage = url;
                    this.app.editor.gameEndVideo = null;
                    const preview = document.getElementById('endscreen-image-preview');
                    const thumb = document.getElementById('endscreen-image-thumb');
                    const clearBtn = document.getElementById('btn-endscreen-image-clear');
                    const vidFilename = document.getElementById('endscreen-video-filename');
                    const vidClear = document.getElementById('btn-endscreen-video-clear');
                    if (thumb) thumb.src = url;
                    if (preview) preview.style.display = 'block';
                    if (clearBtn) clearBtn.classList.remove('hidden');
                    if (vidFilename) vidFilename.textContent = '(None)';
                    if (vidClear) vidClear.classList.add('hidden');
                } catch (err) {
                    console.error(err);
                    alert("Errore upload: " + err.message);
                }
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
            input.onchange = async (e) => {
                const file = e.target.files[0]; if (!file) return;
                try {
                    this.showToast(`Uploading ${file.name}...`, 2000);
                    const url = await this.uploadAssetFile(file, 'assets');
                    this.app.editor.gameEndVideo = url;
                    this.app.editor.gameEndImage = null;
                    const filenameEl = document.getElementById('endscreen-video-filename');
                    const clearBtn = document.getElementById('btn-endscreen-video-clear');
                    const preview = document.getElementById('endscreen-image-preview');
                    if (filenameEl) filenameEl.textContent = file.name;
                    if (clearBtn) clearBtn.classList.remove('hidden');
                    if (preview) preview.style.display = 'none';
                    const imgClear = document.getElementById('btn-endscreen-image-clear');
                    if (imgClear) imgClear.classList.add('hidden');
                } catch (err) {
                    console.error(err);
                    alert("Errore upload: " + err.message);
                }
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
            input.onchange = async (e) => {
                const file = e.target.files[0]; if (!file) return;
                try {
                    this.showToast(`Uploading ${file.name}...`, 2000);
                    const url = await this.uploadAssetFile(file, 'music');
                    this.app.editor.gameEndMusic = url;
                    this.app.editor.gameEndMusicFilename = file.name;
                    const filenameEl = document.getElementById('endscreen-music-filename');
                    const clearBtn = document.getElementById('btn-endscreen-music-clear');
                    if (filenameEl) filenameEl.textContent = file.name;
                    if (clearBtn) clearBtn.classList.remove('hidden');
                } catch (err) {
                    console.error(err);
                    alert("Errore upload: " + err.message);
                }
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
            const p = document.getElementById("t-p" + (axis)); if (p) p.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.position[axis] = parseFloat(e.target.value); };
            const r = document.getElementById("t-r" + (axis)); if (r) r.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.rotation[axis] = THREE.MathUtils.degToRad(parseFloat(e.target.value)); };
            const s = document.getElementById("t-s" + (axis)); if (s) s.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.scale[axis] = parseFloat(e.target.value); };
        });

        // Binding Analyze
        const anzName = document.getElementById('anz-name');
        if (anzName) anzName.oninput = (e) => { if (this.app.editor.selected) this.app.editor.selected.userData.objectName = e.target.value; };
        const anzDesc = document.getElementById('anz-desc');
        if (anzDesc) anzDesc.oninput = (e) => { if (this.app.editor.selected) this.app.editor.selected.userData.objectDescription = e.target.value; };
        const anzKey = document.getElementById('anz-key');
        if (anzKey) anzKey.oninput = (e) => { if (this.app.editor.selected) this.app.editor.selected.userData.activationKey = e.target.value.toLowerCase(); };
        const anzTouch = document.getElementById('anz-touch');
        if (anzTouch) anzTouch.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.userData.activationTouch = e.target.checked; };
        const anzShowHint = document.getElementById('anz-show-hint');
        if (anzShowHint) anzShowHint.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.userData.showHint = e.target.checked; };
        const anzHintDist = document.getElementById('anz-hint-dist');
        if (anzHintDist) anzHintDist.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.userData.hintDistance = parseFloat(e.target.value); };
        const anzHintSize = document.getElementById('anz-hint-size');
        if (anzHintSize) anzHintSize.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.userData.hintSize = parseInt(e.target.value); };
        const anzHintBg = document.getElementById('anz-hint-bgcolor');
        if (anzHintBg) anzHintBg.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.userData.hintBgColor = e.target.value; };
        const anzHintText = document.getElementById('anz-hint-textcolor');
        if (anzHintText) anzHintText.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.userData.hintTextColor = e.target.value; };

        const btnAnzImport = document.getElementById('btn-analyze-import');
        if (btnAnzImport) {
            btnAnzImport.onclick = () => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = '.glb,.gltf,.png,.jpg,.jpeg';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            const dataUrl = ev.target.result;
                            if (this.app.editor.selected) {
                                this.app.editor.selected.userData.glbFilename = file.name;
                                this.app.editor.selected.userData.glbSource = dataUrl;
                                const filenameEl = document.getElementById('anz-filename');
                                if (filenameEl) filenameEl.innerText = file.name;
                                this.app.editor.reloadModel(this.app.editor.selected, dataUrl);
                            }
                        };
                        reader.readAsDataURL(file);
                    }
                };
                input.click();
            };
        }

        // Binding Post Processing (Pixel, Bloom, Cyberpunk)
        const gamePixelEffect = document.getElementById('game-pixel-effect');
        if (gamePixelEffect) gamePixelEffect.onchange = (e) => {
            const size = parseInt(document.getElementById('game-pixel-size').value) || 6;
            this.app.sceneManager.setPixelEffect(e.target.checked, size);
            this.app.editor.gamePixelEffect = e.target.checked;
        };

        const gamePixelSize = document.getElementById('game-pixel-size');
        if (gamePixelSize) gamePixelSize.onchange = (e) => {
            const active = document.getElementById('game-pixel-effect').checked;
            const val = parseInt(e.target.value) || 6;
            this.app.sceneManager.setPixelEffect(active, val);
            this.app.editor.gamePixelSize = val;
        };

        const gameBloomEffect = document.getElementById('game-bloom-effect');
        if (gameBloomEffect) gameBloomEffect.onchange = (e) => {
            const st = parseFloat(document.getElementById('game-bloom-strength').value) || 1.5;
            const rd = parseFloat(document.getElementById('game-bloom-radius').value) || 0.4;
            this.app.sceneManager.setBloomEffect(e.target.checked, st, rd);
            this.app.editor.gameBloomEffect = e.target.checked;
        };

        const gameBloomStrength = document.getElementById('game-bloom-strength');
        if (gameBloomStrength) gameBloomStrength.onchange = (e) => {
            const active = document.getElementById('game-bloom-effect').checked;
            const val = parseFloat(e.target.value) || 1.5;
            const rd = parseFloat(document.getElementById('game-bloom-radius').value) || 0.4;
            this.app.sceneManager.setBloomEffect(active, val, rd);
            this.app.editor.gameBloomStrength = val;
        };

        const gameBloomRadius = document.getElementById('game-bloom-radius');
        if (gameBloomRadius) gameBloomRadius.onchange = (e) => {
            const active = document.getElementById('game-bloom-effect').checked;
            const st = parseFloat(document.getElementById('game-bloom-strength').value) || 1.5;
            const val = parseFloat(e.target.value) || 0.4;
            this.app.sceneManager.setBloomEffect(active, st, val);
            this.app.editor.gameBloomRadius = val;
        };

        const gameCyberpunkEffect = document.getElementById('game-cyberpunk-effect');
        if (gameCyberpunkEffect) gameCyberpunkEffect.onchange = (e) => {
            const ab = parseFloat(document.getElementById('game-cyberpunk-aberration').value) || 0.004;
            const sc = parseFloat(document.getElementById('game-cyberpunk-scanlines').value) || 0.2;
            this.app.sceneManager.setCyberpunkEffect(e.target.checked, ab, sc);
            this.app.editor.gameCyberpunkEffect = e.target.checked;
        };

        const gameCyberpunkAberration = document.getElementById('game-cyberpunk-aberration');
        if (gameCyberpunkAberration) gameCyberpunkAberration.onchange = (e) => {
            const active = document.getElementById('game-cyberpunk-effect').checked;
            const val = parseFloat(e.target.value) || 0.004;
            const sc = parseFloat(document.getElementById('game-cyberpunk-scanlines').value) || 0.2;
            this.app.sceneManager.setCyberpunkEffect(active, val, sc);
            this.app.editor.gameCyberpunkAberration = val;
        };

        const gameCyberpunkScanlines = document.getElementById('game-cyberpunk-scanlines');
        if (gameCyberpunkScanlines) gameCyberpunkScanlines.onchange = (e) => {
            const active = document.getElementById('game-cyberpunk-effect').checked;
            const ab = parseFloat(document.getElementById('game-cyberpunk-aberration').value) || 0.004;
            const val = parseFloat(e.target.value) || 0.2;
            this.app.sceneManager.setCyberpunkEffect(active, ab, val);
            this.app.editor.gameCyberpunkScanlines = val;
        };

        // Binding Viewport / Grid Settings
        const gridCenterColor = document.getElementById('grid-center-color');
        if (gridCenterColor) gridCenterColor.oninput = (e) => {
            this.app.sceneManager.updateGrid(undefined, undefined, e.target.value, undefined);
            this.app.editor.gridCenterColor = e.target.value;
        };

        const gridColor = document.getElementById('grid-color');
        if (gridColor) gridColor.oninput = (e) => {
            this.app.sceneManager.updateGrid(undefined, undefined, undefined, e.target.value);
            this.app.editor.gridColor = e.target.value;
        };

        const gridSize = document.getElementById('grid-size');
        if (gridSize) gridSize.onchange = (e) => {
            const val = parseInt(e.target.value) || 40;
            this.app.sceneManager.updateGrid(val, undefined, undefined, undefined);
            this.app.editor.gridSize = val;
        };

        const gridDivisions = document.getElementById('grid-divisions');
        if (gridDivisions) gridDivisions.onchange = (e) => {
            const val = parseInt(e.target.value) || 40;
            this.app.sceneManager.updateGrid(undefined, val, undefined, undefined);
            this.app.editor.gridDivisions = val;
        };

        // Binding HDR & Post processing
        const btnHdrUpload = document.getElementById('btn-hdr-upload');
        if (btnHdrUpload) {
            btnHdrUpload.onclick = () => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = '.hdr';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            const dataUrl = ev.target.result;
                            this.app.sceneManager.setSkybox(dataUrl, file.name);
                            this.app.editor.gameSkyboxData = dataUrl;
                            this.app.editor.gameSkyboxFilename = file.name;
                            document.getElementById('hdr-filename').innerText = file.name;
                            document.getElementById('btn-hdr-clear').classList.remove('hidden');
                        };
                        reader.readAsDataURL(file);
                    }
                };
                input.click();
            };
        }

        const btnHdrClear = document.getElementById('btn-hdr-clear');
        if (btnHdrClear) {
            btnHdrClear.onclick = () => {
                this.app.sceneManager.setSkybox(null, '');
                this.app.editor.gameSkyboxData = null;
                this.app.editor.gameSkyboxFilename = '';
                document.getElementById('hdr-filename').innerText = '(Default Sky)';
                btnHdrClear.classList.add('hidden');
            };
        }

        const hdrIntensity = document.getElementById('hdr-intensity');
        if (hdrIntensity) hdrIntensity.oninput = (e) => {
            const val = parseFloat(e.target.value);
            this.app.sceneManager.setSkyboxIntensity(val);
            this.app.editor.gameSkyboxIntensity = val;
        };

        const envSunPitch = document.getElementById('env-sun-pitch');
        if (envSunPitch) envSunPitch.oninput = (e) => {
            const val = parseFloat(e.target.value);
            this.app.sceneManager.sunPitch = val;
            this.app.sceneManager.updateSunPosition();
            const el = document.getElementById('val-sun-pitch');
            if (el) el.innerText = `${val}°`;
        };

        const envHdrRotation = document.getElementById('env-hdr-rotation');
        if (envHdrRotation) envHdrRotation.oninput = (e) => {
            const val = parseFloat(e.target.value);
            this.app.sceneManager.hdrRotation = val;
            this.app.sceneManager.updateEnvironment();
            const el = document.getElementById('val-hdr-rotation');
            if (el) el.innerText = `${val}°`;
        };
        const gameAmbientColor = document.getElementById('game-ambient-color');
        if (gameAmbientColor) gameAmbientColor.oninput = (e) => {
            this.app.sceneManager.setAmbientColor(e.target.value);
            this.app.editor.gameAmbientColor = e.target.value;
        };

        const gameAmbientIntensity = document.getElementById('game-ambient-intensity');
        if (gameAmbientIntensity) gameAmbientIntensity.oninput = (e) => {
            const val = parseFloat(e.target.value);
            this.app.sceneManager.setAmbientIntensity(val);
            this.app.editor.gameAmbientIntensity = val;
        };

        const gamePbr = document.getElementById('game-pbr');
        if (gamePbr) gamePbr.onchange = (e) => {
            this.app.sceneManager.setPBROutput(e.target.checked);
            this.app.editor.gamePbrActive = e.target.checked;
        };

        const gameExposure = document.getElementById('game-exposure');
        if (gameExposure) gameExposure.oninput = (e) => {
            const val = parseFloat(e.target.value);
            this.app.sceneManager.setExposure(val);
            this.app.editor.gameExposure = val;
        };

        const gameShadows = document.getElementById('game-shadows');
        if (gameShadows) gameShadows.onchange = (e) => {
            this.app.sceneManager.setShadows(e.target.checked);
            this.app.editor.gameShadows = e.target.checked;
        };

        const gameReflections = document.getElementById('game-reflections');
        if (gameReflections) gameReflections.onchange = (e) => {
            this.app.sceneManager.setReflections(e.target.checked);
            this.app.editor.gameReflections = e.target.checked;
        };

        // Fog
        const gameFogType = document.getElementById('game-fog-type');
        if (gameFogType) gameFogType.onchange = (e) => {
            const type = e.target.value;
            const color = document.getElementById('game-fog-color').value;
            const density = parseFloat(document.getElementById('game-fog-density').value);
            const near = parseFloat(document.getElementById('game-fog-near').value);
            const far = parseFloat(document.getElementById('game-fog-far').value);
            this.app.sceneManager.setFog(type, color, density, near, far);
            this.updateProperties();
        };
        const gameFogColor = document.getElementById('game-fog-color');
        if (gameFogColor) gameFogColor.oninput = (e) => {
            const type = document.getElementById('game-fog-type').value;
            this.app.sceneManager.setFog(type, e.target.value, undefined, undefined, undefined);
        };
        const gameFogDensity = document.getElementById('game-fog-density');
        if (gameFogDensity) gameFogDensity.oninput = (e) => {
            const type = document.getElementById('game-fog-type').value;
            this.app.sceneManager.setFog(type, undefined, parseFloat(e.target.value), undefined, undefined);
        };
        const gameFogNear = document.getElementById('game-fog-near');
        if (gameFogNear) gameFogNear.oninput = (e) => {
            const type = document.getElementById('game-fog-type').value;
            this.app.sceneManager.setFog(type, undefined, undefined, parseFloat(e.target.value), undefined);
        };
        const gameFogFar = document.getElementById('game-fog-far');
        if (gameFogFar) gameFogFar.oninput = (e) => {
            const type = document.getElementById('game-fog-type').value;
            this.app.sceneManager.setFog(type, undefined, undefined, undefined, parseFloat(e.target.value));
        };

        // SSAO
        const gameSsaoEnable = document.getElementById('game-ssao-enable');
        if (gameSsaoEnable) gameSsaoEnable.onchange = (e) => {
            const radius = parseFloat(document.getElementById('game-ssao-radius').value);
            const intensity = parseFloat(document.getElementById('game-ssao-intensity').value);
            this.app.sceneManager.setSSAO(e.target.checked, radius, intensity);
        };
        const gameSsaoRadius = document.getElementById('game-ssao-radius');
        if (gameSsaoRadius) gameSsaoRadius.oninput = (e) => {
            const active = document.getElementById('game-ssao-enable').checked;
            const intensity = parseFloat(document.getElementById('game-ssao-intensity').value);
            this.app.sceneManager.setSSAO(active, parseFloat(e.target.value), intensity);
        };
        const gameSsaoIntensity = document.getElementById('game-ssao-intensity');
        if (gameSsaoIntensity) gameSsaoIntensity.oninput = (e) => {
            const active = document.getElementById('game-ssao-enable').checked;
            const radius = parseFloat(document.getElementById('game-ssao-radius').value);
            this.app.sceneManager.setSSAO(active, radius, parseFloat(e.target.value));
        };

        // SSR
        const gameSsrEnable = document.getElementById('game-ssr-enable');
        if (gameSsrEnable) gameSsrEnable.onchange = (e) => {
            const intensity = parseFloat(document.getElementById('game-ssr-intensity')?.value || 0.45);
            this.app.sceneManager.setSSR(e.target.checked, intensity);
        };

        const gameSsrIntensity = document.getElementById('game-ssr-intensity');
        if (gameSsrIntensity) gameSsrIntensity.oninput = (e) => {
            const active = document.getElementById('game-ssr-enable')?.checked;
            const val = parseFloat(e.target.value);
            this.app.sceneManager.setSSR(active, val);
        };

        // Path Tracing
        const gamePathTracingEnable = document.getElementById('game-pathtracing-enable');
        if (gamePathTracingEnable) gamePathTracingEnable.onchange = (e) => {
            this.app.sceneManager.setPathTracing(e.target.checked);
        };
        const gamePtMaxSamples = document.getElementById('game-pathtracing-max-samples');
        if (gamePtMaxSamples) gamePtMaxSamples.onchange = (e) => {
            const val = parseInt(e.target.value) || 200;
            this.app.sceneManager.maxPtSamples = val;
            this.app.sceneManager.resetPathTracing();
        };

        // Realism Effects (0beqz) Bindings
        const updateSSGI = () => {
            const active = document.getElementById('game-ssgi-enable')?.checked;
            const dist = document.getElementById('game-ssgi-distance')?.value;
            const thick = document.getElementById('game-ssgi-thickness')?.value;
            const steps = document.getElementById('game-ssgi-steps')?.value;
            const denoise = document.getElementById('game-ssgi-denoise')?.value;
            this.app.sceneManager.setRealismSSGI(active, dist, thick, steps, denoise);
            if (this.app.editor) {
                this.app.editor.gameSSGI = { enabled: active, distance: dist, thickness: thick, steps: steps, denoise: denoise };
            }
        };
        ['game-ssgi-enable', 'game-ssgi-distance', 'game-ssgi-thickness', 'game-ssgi-steps', 'game-ssgi-denoise'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.onchange = updateSSGI;
        });

        const updateRealismSSR = () => {
            const active = document.getElementById('game-realism-ssr-enable')?.checked;
            const intensity = document.getElementById('game-realism-ssr-intensity')?.value;
            this.app.sceneManager.setRealismSSR(active, intensity);
            if (this.app.editor) {
                this.app.editor.gameRealismSSR = { enabled: active, intensity: intensity };
            }
        };
        ['game-realism-ssr-enable', 'game-realism-ssr-intensity'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.onchange = updateRealismSSR;
        });

        const updateRealismAO = () => {
            const active = document.getElementById('game-ao-enable')?.checked;
            const type = document.getElementById('game-ao-type')?.value;
            const radius = document.getElementById('game-ao-radius')?.value;
            this.app.sceneManager.setRealismAO(active, type, radius);
            if (this.app.editor) {
                this.app.editor.gameRealismAO = { enabled: active, type: type, radius: radius };
            }
        };
        ['game-ao-enable', 'game-ao-type', 'game-ao-radius'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.onchange = updateRealismAO;
        });

        const updateMotionBlur = () => {
            const active = document.getElementById('game-motionblur-enable')?.checked;
            const intensity = document.getElementById('game-motionblur-intensity')?.value;
            this.app.sceneManager.setRealismMotionBlur(active, intensity);
            if (this.app.editor) {
                this.app.editor.gameMotionBlur = { enabled: active, intensity: intensity };
            }
        };
        ['game-motionblur-enable', 'game-motionblur-intensity'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.onchange = updateMotionBlur;
        });

        const gameAaMode = document.getElementById('game-aa-mode');
        if (gameAaMode) {
            gameAaMode.onchange = (e) => {
                this.app.sceneManager.setRealismAAMode(e.target.value);
                if (this.app.editor) this.app.editor.gameAAMode = e.target.value;
            };
        }

        // Bloom
        const bloomEnable = document.getElementById('bloom-enable');
        if (bloomEnable) bloomEnable.onchange = (e) => {
            const st = parseFloat(document.getElementById('bloom-strength').value);
            const rd = parseFloat(document.getElementById('bloom-radius').value);
            this.app.sceneManager.setBloomEffect(e.target.checked, st, rd);
            this.app.editor.gameBloomEffect = e.target.checked;
        };

        const bloomStrength = document.getElementById('bloom-strength');
        if (bloomStrength) bloomStrength.oninput = (e) => {
            const active = document.getElementById('bloom-enable').checked;
            const val = parseFloat(e.target.value);
            this.app.sceneManager.setBloomEffect(active, val, undefined);
            this.app.editor.gameBloomStrength = val;
        };

        const bloomRadius = document.getElementById('bloom-radius');
        if (bloomRadius) bloomRadius.oninput = (e) => {
            const active = document.getElementById('bloom-enable').checked;
            const val = parseFloat(e.target.value);
            this.app.sceneManager.setBloomEffect(active, undefined, val);
            this.app.editor.gameBloomRadius = val;
        };

        // Vignette
        const vignetteEnable = document.getElementById('vignette-enable');
        if (vignetteEnable) vignetteEnable.onchange = (e) => {
            const ab = parseFloat(document.getElementById('vignette-aberration').value);
            const sc = parseFloat(document.getElementById('vignette-scanlines').value);
            this.app.sceneManager.setCyberpunkEffect(e.target.checked, ab, sc);
            this.app.editor.gameCyberpunkEffect = e.target.checked;
        };

        const vignetteAberration = document.getElementById('vignette-aberration');
        if (vignetteAberration) vignetteAberration.oninput = (e) => {
            const active = document.getElementById('vignette-enable').checked;
            const val = parseFloat(e.target.value);
            this.app.sceneManager.setCyberpunkEffect(active, val, undefined);
            this.app.editor.gameCyberpunkAberration = val;
        };

        const vignetteScanlines = document.getElementById('vignette-scanlines');
        if (vignetteScanlines) vignetteScanlines.oninput = (e) => {
            const active = document.getElementById('vignette-enable').checked;
            const val = parseFloat(e.target.value);
            this.app.sceneManager.setCyberpunkEffect(active, undefined, val);
            this.app.editor.gameCyberpunkScanlines = val;
        };

        const envVignette = document.getElementById('env-vignette');
        if (envVignette) envVignette.oninput = (e) => {
            const val = parseFloat(e.target.value);
            this.app.sceneManager.vignetteStrength = val;
            this.app.editor.gameVignetteStrength = val;
            this.app.sceneManager.updateEnvironment();
        };

        // Binding Dialog
        const dlgBg = document.getElementById('dlg-bgcolor');
        if (dlgBg) dlgBg.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.userData.dialogBgColor = e.target.value; };
        const dlgTxt = document.getElementById('dlg-textcolor');
        if (dlgTxt) dlgTxt.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.userData.dialogTextColor = e.target.value; };
        const dlgAcc = document.getElementById('dlg-accentcolor');
        if (dlgAcc) dlgAcc.onchange = (e) => { if (this.app.editor.selected) this.app.editor.selected.userData.dialogAccentColor = e.target.value; };
        const dlgFont = document.getElementById('dlg-font');
        if (dlgFont) dlgFont.oninput = (e) => { if (this.app.editor.selected) this.app.editor.selected.userData.dialogFont = e.target.value; };


        const dlgActMode = document.getElementById('dlg-activation-mode');
        if (dlgActMode) {
            dlgActMode.addEventListener('change', () => {
                const pKey = document.getElementById('panel-dlg-keypress');
                if (pKey) pKey.classList.toggle('hidden', dlgActMode.value !== 'keypress');
            });
        }

        // Dialog Questions/Answers controls
        const btnDlgAddQ = document.getElementById('btn-dlg-add-q');
        if (btnDlgAddQ) {
            btnDlgAddQ.onclick = () => {
                const sel = this.app.editor.selected;
                if (sel?.userData.type === 'Dialog') {
                    if (!sel.userData.dialogQuestions) sel.userData.dialogQuestions = [];
                    sel.userData.dialogQuestions.push({
                        text: 'Nuova Domanda',
                        image: '',
                        answers: []
                    });
                    this.activeQuestionIndex = sel.userData.dialogQuestions.length - 1;
                    this.renderDialogQuestionsList(sel);
                    this.renderDialogQuestionEditPanel(sel);
                }
            };
        }

        const btnDlgAddA = document.getElementById('btn-dlg-add-a');
        if (btnDlgAddA) {
            btnDlgAddA.onclick = () => {
                const sel = this.app.editor.selected;
                if (sel?.userData.type === 'Dialog') {
                    const qIndex = this.activeQuestionIndex;
                    const q = sel.userData.dialogQuestions?.[qIndex];
                    if (q) {
                        if (!q.answers) q.answers = [];
                        q.answers.push({
                            text: 'Nuova Risposta',
                            actionType: 'close',
                            actionValue: ''
                        });
                        this.renderDialogQuestionEditPanel(sel);
                    }
                }
            };
        }

        const btnDlgQImg = document.getElementById('btn-dlg-q-img');
        if (btnDlgQImg) {
            btnDlgQImg.onclick = () => {
                const sel = this.app.editor.selected;
                if (sel?.userData.type === 'Dialog') {
                    const qIndex = this.activeQuestionIndex;
                    const q = sel.userData.dialogQuestions?.[qIndex];
                    if (q) {
                        const fileInput = document.createElement('input');
                        fileInput.type = 'file';
                        fileInput.accept = 'image/*';
                        fileInput.onchange = (e) => {
                            const file = e.target.files[0];
                            if (file) {
                                const reader = new FileReader();
                                reader.onload = (f) => {
                                    q.image = f.target.result;
                                    this.renderDialogQuestionEditPanel(sel);
                                };
                                reader.readAsDataURL(file);
                            }
                        };
                        fileInput.click();
                    }
                }
            };
        }

        const btnDlgQImgClear = document.getElementById('btn-dlg-q-img-clear');
        if (btnDlgQImgClear) {
            btnDlgQImgClear.onclick = () => {
                const sel = this.app.editor.selected;
                if (sel?.userData.type === 'Dialog') {
                    const qIndex = this.activeQuestionIndex;
                    const q = sel.userData.dialogQuestions?.[qIndex];
                    if (q) {
                        q.image = '';
                        this.renderDialogQuestionEditPanel(sel);
                    }
                }
            };
        }

        document.getElementById('p-typology').onchange = (e) => {
            if (this.app.editor.selected?.userData.isPlayer) {
                const player = this.app.editor.selected;
                const oldType = player.userData.typology || '8WAY';
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

        const pCollisionMode = document.getElementById('p-collision-mode');
        if (pCollisionMode) pCollisionMode.onchange = (e) => { if (this.app.editor.selected?.userData.isPlayer) this.app.editor.selected.userData.collisionMode = e.target.value; };

        // Sprint Settings Bindings
        const pSprintEnable = document.getElementById('p-sprint-enable');
        const pSprintKey = document.getElementById('p-sprint-key');
        const pSprintMult = document.getElementById('p-sprint-mult');
        if (pSprintEnable) pSprintEnable.onchange = (e) => { if (this.app.editor.selected?.userData.isPlayer) this.app.editor.selected.userData.canSprint = e.target.checked; };
        if (pSprintKey) pSprintKey.onchange = (e) => { if (this.app.editor.selected?.userData.isPlayer) this.app.editor.selected.userData.sprintKey = e.target.value; };
        if (pSprintMult) pSprintMult.oninput = (e) => { if (this.app.editor.selected?.userData.isPlayer) this.app.editor.selected.userData.sprintMult = parseFloat(e.target.value); };

        // Pixel Effect Bindings (Managed via post-processing bindings above)

        // Render Engine Bindings (Managed via post-processing bindings above)

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

        bindProp('dlg-activation-mode', 'activationMode', 'Dialog');
        bindProp('dlg-activation-key', 'activationKey', 'Dialog');

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
                                this.generateThumbnail(m, (prefix) + "-glb-preview-img");
                                document.getElementById((prefix) + "-glb-preview-container").style.display = 'flex';
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
            bindProp("e-f-t" + (axis), "followerTrans" + (axis.toUpperCase()), 'Enemy');
            bindProp("e-f-r" + (axis), "followerRot" + (axis.toUpperCase()), 'Enemy');
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
            const el = document.getElementById("pu-rot" + (axis));
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
        bindProp('col-value-select', 'actionValue', 'Collision');
        bindProp('col-activation-mode', 'activationMode', 'Collision');
        bindProp('col-activation-key', 'activationKey', 'Collision');
        bindProp('col-show-hint', 'showHint', 'Collision');
        bindProp('col-hint-distance', 'hintDistance', 'Collision', parseFloat);
        bindProp('col-external-event', 'externalEvent', 'Collision');
        bindProp('col-external-target', 'externalTarget', 'Collision');
        bindProp('col-repeat-mode', 'repeatMode', 'Collision');
        bindProp('col-repeat-count', 'repeatCount', 'Collision', parseInt);
        bindProp('col-anim-loop-mode', 'animLoopMode', 'Collision');
        bindProp('col-anim-play-count', 'animPlayCount', 'Collision', parseInt);

        const colAction = document.getElementById('col-action');
        if (colAction) {
            colAction.addEventListener('change', () => {
                this.updateProperties();
            });
        }

        const colShowHint = document.getElementById('col-show-hint');
        if (colShowHint) {
            colShowHint.addEventListener('change', () => {
                this.updateProperties();
            });
        }

        // EmbedHTML Bindings
        bindProp('eb-url', 'embedUrl', 'EmbedHTML');
        bindProp('eb-activation-mode', 'activationMode', 'EmbedHTML');
        bindProp('eb-activation-key', 'activationKey', 'EmbedHTML');
        bindProp('eb-show-hint', 'showHint', 'EmbedHTML');
        bindProp('eb-hint-distance', 'hintDistance', 'EmbedHTML', parseFloat);

        const ebActivationMode = document.getElementById('eb-activation-mode');
        if (ebActivationMode) {
            ebActivationMode.addEventListener('change', () => this.updateProperties());
        }
        const ebShowHint = document.getElementById('eb-show-hint');
        if (ebShowHint) {
            ebShowHint.addEventListener('change', () => this.updateProperties());
        }

        // Objective Bindings
        bindProp('obj-text', 'objectiveText', 'Objective');
        bindProp('obj-action', 'actionType', 'Objective');
        bindProp('obj-value', 'actionValue', 'Objective');
        bindProp('obj-value-select', 'actionValue', 'Objective');
        bindProp('obj-distance', 'triggerDistance', 'Objective', parseFloat);

        const objAction = document.getElementById('obj-action');
        if (objAction) {
            objAction.addEventListener('change', () => this.updateProperties());
        }

        const btnAddObjTarget = document.getElementById('obj-add-target-btn');
        if (btnAddObjTarget) {
            btnAddObjTarget.onclick = () => {
                const sel = this.app.editor.selected;
                const input = document.getElementById('obj-target-input');
                if (sel?.userData.type === 'Objective' && input.value) {
                    if (!sel.userData.actionTargets) sel.userData.actionTargets = [];
                    if (!sel.userData.actionTargets.includes(input.value)) {
                        sel.userData.actionTargets.push(input.value);
                        this.renderObjectiveTargets(sel);
                        this.updateObjectiveAnimList(input.value);
                        input.value = '';
                    }
                }
            };
        }

        // CutScene Bindings
        bindProp('cut-trigger-level-start', 'triggerOnLevelStart', 'CutScene');
        bindProp('cut-trigger-collision', 'triggerOnCollision', 'CutScene');
        bindProp('cut-skippable', 'skippable', 'CutScene');
        bindProp('cut-skip-key', 'skipKey', 'CutScene');
        bindProp('cut-appear-effect', 'appearEffect', 'CutScene');

        const btnCutVideoLoad = document.getElementById('btn-cut-video-load');
        if (btnCutVideoLoad) {
            btnCutVideoLoad.onclick = () => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = 'video/*';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file && this.app.editor.selected?.userData.type === 'CutScene') {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            this.app.editor.selected.userData.videoSource = ev.target.result;
                            this.app.editor.selected.userData.videoFilename = file.name;
                            const filenameLabel = document.getElementById('cut-video-filename');
                            if (filenameLabel) filenameLabel.textContent = file.name;
                            const clearBtn = document.getElementById('btn-cut-video-clear');
                            if (clearBtn) clearBtn.classList.remove('hidden');
                        };
                        reader.readAsDataURL(file);
                    }
                };
                input.click();
            };
        }

        const btnCutVideoClear = document.getElementById('btn-cut-video-clear');
        if (btnCutVideoClear) {
            btnCutVideoClear.onclick = () => {
                const sel = this.app.editor.selected;
                if (sel?.userData.type === 'CutScene') {
                    sel.userData.videoSource = '';
                    sel.userData.videoFilename = '';
                    const filenameLabel = document.getElementById('cut-video-filename');
                    if (filenameLabel) filenameLabel.textContent = '(Nessuno)';
                    btnCutVideoClear.classList.add('hidden');
                }
            };
        }
        // SoundEffect Bindings
        bindProp('sound-trigger-level-start', 'triggerOnLevelStart', 'SoundEffect');
        bindProp('sound-trigger-collision', 'triggerOnCollision', 'SoundEffect');

        const btnSoundAudioLoad = document.getElementById('btn-sound-audio-load');
        if (btnSoundAudioLoad) {
            btnSoundAudioLoad.onclick = () => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = 'audio/*';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file && this.app.editor.selected?.userData.type === 'SoundEffect') {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            this.app.editor.selected.userData.audioSource = ev.target.result;
                            this.app.editor.selected.userData.audioFilename = file.name;
                            const filenameLabel = document.getElementById('sound-audio-filename');
                            if (filenameLabel) filenameLabel.textContent = file.name;
                            const clearBtn = document.getElementById('btn-sound-audio-clear');
                            if (clearBtn) clearBtn.classList.remove('hidden');
                        };
                        reader.readAsDataURL(file);
                    }
                };
                input.click();
            };
        }

        const btnSoundAudioClear = document.getElementById('btn-sound-audio-clear');
        if (btnSoundAudioClear) {
            btnSoundAudioClear.onclick = () => {
                const sel = this.app.editor.selected;
                if (sel?.userData.type === 'SoundEffect') {
                    sel.userData.audioSource = '';
                    sel.userData.audioFilename = '';
                    const filenameLabel = document.getElementById('sound-audio-filename');
                    if (filenameLabel) filenameLabel.textContent = '(Nessuno)';
                    btnSoundAudioClear.classList.add('hidden');
                }
            };
        }
        const toggleColPanels = () => {
            const actMode = document.getElementById('col-activation-mode')?.value;
            const repMode = document.getElementById('col-repeat-mode')?.value;
            const animMode = document.getElementById('col-anim-loop-mode')?.value;

            const pKey = document.getElementById('panel-col-keypress');
            if (pKey) pKey.classList.toggle('hidden', actMode !== 'keypress');

            const pExt = document.getElementById('panel-col-external');
            if (pExt) pExt.classList.toggle('hidden', actMode !== 'external');

            const pRep = document.getElementById('panel-col-repeat-count');
            if (pRep) pRep.classList.toggle('hidden', repMode !== 'count');

            const pAnim = document.getElementById('panel-col-anim-count');
            if (pAnim) pAnim.classList.toggle('hidden', animMode !== 'count');
        };

        ['col-activation-mode', 'col-repeat-mode', 'col-anim-loop-mode'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', toggleColPanels);
        });

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

        // col-oneshot has been deprecated in favor of col-repeat-mode, but keeping it bound for safety or removing
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
            const el = document.getElementById("l-shadow-" + (prop));
            if (el) el.oninput = (e) => {
                const sel = this.app.editor.selected;
                if (sel && sel.userData.isAsset && ['PointLight', 'SpotLight', 'DirectionalLight'].includes(sel.userData.type)) {
                    const val = parser(e.target.value);
                    sel.userData["shadow" + (prop.charAt(0).toUpperCase() + prop.slice(1))] = val;
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
            const el = document.getElementById("l-shadow-" + (prop));
            if (el) el.oninput = (e) => {
                const sel = this.app.editor.selected;
                if (sel && sel.userData.isAsset && ['PointLight', 'SpotLight', 'DirectionalLight'].includes(sel.userData.type)) {
                    const val = parser(e.target.value);
                    sel.userData["shadowCam" + (prop.charAt(0).toUpperCase() + prop.slice(1))] = val;
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

        // Model Transparency & PBR
        const bindMaterialOpt = (id, key, parser = v => v) => {
            const el = document.getElementById(id);
            if (el) el.oninput = (e) => {
                const selected = this.app.editor.selected;
                const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
                if (selected) {
                    selected.userData[key] = parser(val);
                    this.app.editor.updateMaterialSettings(selected);
                }
            };
        };
        bindMaterialOpt('m-alpha-mode', 'alphaMode');
        bindMaterialOpt('m-alpha-test', 'alphaTest', parseFloat);
        bindMaterialOpt('m-double-side', 'doubleSide');
        bindMaterialOpt('m-material-color', 'materialColor');
        bindMaterialOpt('m-material-metalness', 'materialMetalness', parseFloat);
        bindMaterialOpt('m-material-roughness', 'materialRoughness', parseFloat);
        bindMaterialOpt('m-material-specular', 'materialSpecular', parseFloat);
        bindMaterialOpt('m-material-subsurface-scattering', 'materialSubsurfaceScattering', parseFloat);
        bindMaterialOpt('m-material-clearcoat', 'materialClearcoat', parseFloat);
        bindMaterialOpt('m-material-clearcoat-roughness', 'materialClearcoatRoughness', parseFloat);
        bindMaterialOpt('m-material-transmission', 'materialTransmission', parseFloat);
        bindMaterialOpt('m-material-thickness', 'materialThickness', parseFloat);
        bindMaterialOpt('m-material-emissive', 'materialEmissive');
        bindMaterialOpt('m-material-emissive-intensity', 'materialEmissiveIntensity', parseFloat);

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

        // Analyze model transform inputs
        setupModelEdit('btn-edit-anz-modely', 'anz-modely');

        const anzModelRot = document.getElementById('anz-model-roty');
        if (anzModelRot) anzModelRot.oninput = (e) => {
            const m = this.app.editor.selected?.getObjectByName('model');
            if (m) m.rotation.y = THREE.MathUtils.degToRad(parseFloat(e.target.value));
        };
        const anzScaleX = document.getElementById('anz-model-scalex');
        if (anzScaleX) anzScaleX.oninput = (e) => {
            const m = this.app.editor.selected?.getObjectByName('model');
            if (m) m.scale.x = parseFloat(e.target.value);
        };
        const anzScaleY = document.getElementById('anz-model-scaley');
        if (anzScaleY) anzScaleY.oninput = (e) => {
            const m = this.app.editor.selected?.getObjectByName('model');
            if (m) m.scale.y = parseFloat(e.target.value);
        };
        const anzScaleZ = document.getElementById('anz-model-scalez');
        if (anzScaleZ) anzScaleZ.oninput = (e) => {
            const m = this.app.editor.selected?.getObjectByName('model');
            if (m) m.scale.z = parseFloat(e.target.value);
        };
    }

    update() { this.updateOutliner(); this.updateProperties(); }

    collapseAll() {
        this.collapsedObjects.clear();
        this.app.editor.objects.forEach(o => {
            this.collapsedObjects.add(o.uuid);
            o.traverse(child => {
                this.collapsedObjects.add(child.uuid);
            });
        });
    }

    updateOutliner() {
        const list = document.getElementById('outliner-list');
        list.innerHTML = '';

        const filterInput = document.getElementById('outliner-filter');
        const filterText = filterInput ? filterInput.value.toLowerCase().trim() : '';

        // Helper to check if a node or any child matches the filter
        const matchesFilter = (node) => {
            if (!filterText) return true;
            const nameMatch = (node.name || '').toLowerCase().includes(filterText);
            const typeMatch = (node.userData && node.userData.type || '').toLowerCase().includes(filterText);
            if (nameMatch || typeMatch) return true;
            if (node.children) {
                return node.children.some(c => {
                    if (c.userData && c.userData.isHelper) return false;
                    if (c.name === 'TransformControlsGizmo') return false;
                    return matchesFilter(c);
                });
            }
            return false;
        };
        
        const renderItem = (o, depth = 0) => {
            if (!matchesFilter(o)) return;

            const isSelected = this.app.editor.selectedObjects.includes(o) || this.app.editor.selected === o;
            const li = document.createElement('li');
            li.className = 'outliner-item' + (isSelected ? ' selected' : '');
            li.style.paddingLeft = `${depth * 15 + 5}px`;
            li.style.display = 'flex';
            li.style.alignItems = 'center';
            li.style.gap = '4px';
            
            let icon = '🧊';
            if (depth === 0) {
                if (o.userData.isPlayer) icon = '👤';
                else if (o.userData.isCamera) icon = '🎥';
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
                else if (o.userData.type === 'Collision') icon = '🚧';
                else if (o.userData.type === 'Analyze') icon = '🔍';
                else if (o.userData.type === 'Dialog') icon = '💬';
                else if (o.userData.type === 'EmbedHTML') icon = '🌐';
                else if (o.userData.type === 'CutScene') icon = '🎬';
                else if (o.userData.type === 'SoundEffect') icon = '🔊';
            } else {
                icon = o.isMesh ? '📐' : '📁';
            }
            
            const hasVisibleChildren = o.children && o.children.some(child => {
                if (child.userData && child.userData.isHelper) return false;
                if (child.name === 'TransformControlsGizmo') return false;
                return true;
            });

            const caretSpan = document.createElement('span');
            caretSpan.style.display = 'inline-block';
            caretSpan.style.width = '12px';
            caretSpan.style.cursor = 'pointer';
            caretSpan.style.userSelect = 'none';
            caretSpan.style.fontSize = '9px';
            caretSpan.style.color = '#888';
            
            if (hasVisibleChildren) {
                const isCollapsed = filterText ? false : this.collapsedObjects.has(o.uuid);
                caretSpan.innerText = isCollapsed ? '▶' : '▼';
                caretSpan.onclick = (e) => {
                    e.stopPropagation();
                    if (this.collapsedObjects.has(o.uuid)) {
                        this.collapsedObjects.delete(o.uuid);
                    } else {
                        this.collapsedObjects.add(o.uuid);
                    }
                    this.updateOutliner();
                };
            } else {
                caretSpan.innerHTML = '&nbsp;';
            }
            li.appendChild(caretSpan);
 
            const contentSpan = document.createElement('span');
            contentSpan.innerText = `${icon} ${o.name || 'Unnamed'}`;
            contentSpan.style.cursor = 'pointer';
            contentSpan.style.flex = '1';
            contentSpan.onclick = (e) => {
                e.stopPropagation();
                this.app.editor.selectMulti(o, e.shiftKey, e.ctrlKey || e.metaKey);
            };
            li.appendChild(contentSpan);
            
            list.appendChild(li);
            
            const isCollapsed = filterText ? false : this.collapsedObjects.has(o.uuid);
            if (o.children && o.children.length > 0 && !isCollapsed) {
                o.children.forEach(child => {
                    if (child.userData && child.userData.isHelper) return;
                    if (child.name === 'TransformControlsGizmo') return;
                    renderItem(child, depth + 1);
                });
            }
        };

        this.app.editor.objects.forEach(o => {
            renderItem(o, 0);
        });
    }

    updateProperties() {
        const selected = this.app.editor.selected;
        // Hide all first
        ['section-transform', 'section-player', 'section-camera', 'section-enemy', 'section-bonus', 'section-boss', 'section-powerup', 'section-spawn', 'section-goal', 'section-catcher', 'section-collision', 'section-model', 'section-splatenv', 'section-analyze', 'section-dialog', 'section-embedhtml', 'section-cutscene', 'section-soundeffect', 'section-objective'].forEach(id => {
            const el = document.getElementById(id); if (el) el.classList.add('hidden');
        });
        // Show Game Settings and populate if game tab is active
        if (this._activePropTab === 'game') {
            document.getElementById('section-game').classList.remove('hidden');
            document.getElementById('game-title-input').value = this.app.editor.gameTitle || 'Web 3D Game';
            document.getElementById('game-subtitle-input').value = this.app.editor.gameSplashSubtitle || '3D Editor Engine';
            
            const gameAmbientColor = document.getElementById('game-ambient-color');
            if (gameAmbientColor) gameAmbientColor.value = this.app.editor.gameAmbientColor || '#ffffff';

            const gameAmbientIntensity = document.getElementById('game-ambient-intensity');
            if (gameAmbientIntensity) gameAmbientIntensity.value = this.app.editor.gameAmbientIntensity !== undefined ? this.app.editor.gameAmbientIntensity : 1.5;

            const gamePbr = document.getElementById('game-pbr');
            if (gamePbr) gamePbr.checked = this.app.editor.gamePbrActive !== false;

            const gameShadows = document.getElementById('game-shadows');
            if (gameShadows) gameShadows.checked = !!this.app.editor.gameShadows;

            const gameReflections = document.getElementById('game-reflections');
            if (gameReflections) gameReflections.checked = !!this.app.editor.gameReflections;

            const gameExposure = document.getElementById('game-exposure');
            if (gameExposure) gameExposure.value = this.app.editor.gameExposure !== undefined ? this.app.editor.gameExposure : 1.0;

            const hdrIntensity = document.getElementById('hdr-intensity');
            if (hdrIntensity) hdrIntensity.value = this.app.editor.gameSkyboxIntensity !== undefined ? this.app.editor.gameSkyboxIntensity : 1.0;

            const hdrFilename = document.getElementById('hdr-filename');
            if (hdrFilename) hdrFilename.textContent = this.app.editor.gameSkyboxFilename || '(Default Sky)';
            const btnHdrClear = document.getElementById('btn-hdr-clear');
            if (btnHdrClear) btnHdrClear.classList.toggle('hidden', !this.app.editor.gameSkybox);

            // Fog, SSAO, SSR, Path Tracing
            const sm = this.app.sceneManager;
            if (sm) {
                const fogTypeInput = document.getElementById('game-fog-type');
                if (fogTypeInput) fogTypeInput.value = sm.fogType;
                
                const fogColorInput = document.getElementById('game-fog-color');
                if (fogColorInput) fogColorInput.value = sm.fogColor;
                
                const fogDensityInput = document.getElementById('game-fog-density');
                if (fogDensityInput) fogDensityInput.value = sm.fogDensity;
                
                const fogNearInput = document.getElementById('game-fog-near');
                if (fogNearInput) fogNearInput.value = sm.fogNear;
                
                const fogFarInput = document.getElementById('game-fog-far');
                if (fogFarInput) fogFarInput.value = sm.fogFar;

                const rowDensity = document.getElementById('row-fog-density');
                const rowNear = document.getElementById('row-fog-near');
                const rowFar = document.getElementById('row-fog-far');
                if (rowDensity) rowDensity.style.display = sm.fogType === 'exponential' ? 'flex' : 'none';
                if (rowNear) rowNear.style.display = sm.fogType === 'linear' ? 'flex' : 'none';
                if (rowFar) rowFar.style.display = sm.fogType === 'linear' ? 'flex' : 'none';

                const ssaoEnableInput = document.getElementById('game-ssao-enable');
                if (ssaoEnableInput) ssaoEnableInput.checked = sm.useSSAO;
                
                const ssaoRadiusInput = document.getElementById('game-ssao-radius');
                if (ssaoRadiusInput) ssaoRadiusInput.value = sm.ssaoRadius !== undefined ? sm.ssaoRadius * 150.0 : 16;

                const ssaoIntensityInput = document.getElementById('game-ssao-intensity');
                if (ssaoIntensityInput) ssaoIntensityInput.value = sm.ssaoIntensity !== undefined ? sm.ssaoIntensity : 1.0;

                const ssrEnableInput = document.getElementById('game-ssr-enable');
                if (ssrEnableInput) ssrEnableInput.checked = sm.useSSR;

                const ssrIntensityInput = document.getElementById('game-ssr-intensity');
                if (ssrIntensityInput) ssrIntensityInput.value = sm.ssrIntensity !== undefined ? sm.ssrIntensity : 0.45;

                const ptEnableInput = document.getElementById('game-pathtracing-enable');
                if (ptEnableInput) ptEnableInput.checked = sm.usePathTracing;

                const envVignetteInput = document.getElementById('env-vignette');
                if (envVignetteInput) envVignetteInput.value = sm.vignetteStrength !== undefined ? sm.vignetteStrength : 1.0;

                const bloomEnableInput = document.getElementById('game-bloom-effect') || document.getElementById('bloom-enable');
                if (bloomEnableInput) bloomEnableInput.checked = !!sm.useBloom;

                const bloomStrengthInput = document.getElementById('game-bloom-strength') || document.getElementById('bloom-strength');
                if (bloomStrengthInput) bloomStrengthInput.value = sm.bloomIntensity !== undefined ? sm.bloomIntensity : 0.5;

                const bloomRadiusInput = document.getElementById('game-bloom-radius') || document.getElementById('bloom-radius');
                if (bloomRadiusInput) bloomRadiusInput.value = sm.bloomRadius !== undefined ? sm.bloomRadius : 0.4;
            }
        }

        if (!selected && this._activePropTab !== 'game') {
            this.setActivePropTab('game');
        } else if (!selected && this._activePropTab === 'game') {
            // (Rimasto vuoto o per compatibilità legacy)
            

            
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

        if (!selected) {
            return;
        }

        if (this._activePropTab === 'game') {
            this.setActivePropTab('object');
        }

        document.getElementById('section-transform').classList.remove('hidden');
        document.getElementById('obj-name-input').value = selected.name || '';
        ['x', 'y', 'z'].forEach(axis => {
            const p = document.getElementById("t-p" + (axis)); if (p) p.value = selected.position[axis].toFixed(2);
            const r = document.getElementById("t-r" + (axis)); if (r) r.value = THREE.MathUtils.radToDeg(selected.rotation[axis]).toFixed(0);
            const s = document.getElementById("t-s" + (axis)); if (s) s.value = selected.scale[axis].toFixed(2);
        });

        if (selected.userData.isPlayer) {
            this.setActivePropTab('object');
            document.getElementById('section-player').classList.remove('hidden');
            // ... (rest of player updates handled by existing listeners/initial state but strictly inputs need refreshing)
            // Ideally should refresh inputs here too, but for brevity assuming static binding works for now or existing update logic was replaced?
            // Wait, I replaced 'setupInputs' and 'updateProperties'. The OLD updateProperties logic for Player is GONE if I don't re-include it.
            // I MUST re-include Player update logic.
            const typology = selected.userData.typology || '8WAY';
            document.getElementById('p-typology').value = typology;
            document.getElementById('panel-platform').classList.remove('hidden');
            document.getElementById('p-speed').value = selected.userData.speed || 0.4;
            document.getElementById('p-jump').value = (selected.userData.jumpForce || 12.0).toFixed(1);
            const dj = document.getElementById('p-doublejump');
            if (dj) dj.checked = !!selected.userData.doubleJump;

            const cm = document.getElementById('p-collision-mode');
            if (cm) cm.value = selected.userData.collisionMode || 'climb';

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
            this.setActivePropTab('object');
            document.getElementById('section-camera').classList.remove('hidden');
            const validModes = ['TPS', 'FPS', 'SIMPLE', 'FIXED', '8WAY'];
            if (!validModes.includes(selected.userData.type)) {
                selected.userData.type = '8WAY';
            }
            document.getElementById('c-type').value = selected.userData.type;
            document.getElementById('c-fov').value = selected.userData.fov || 60;
        }
        else {
            const type = selected.userData.type || '';
            let sectionId = "section-" + (type ? type.toLowerCase() : 'model');
            if (type === 'catcher_base') sectionId = 'section-catcher';
            if (['PointLight', 'SpotLight', 'DirectionalLight'].includes(type)) sectionId = 'section-light';
            if (type === 'SplatEnv') sectionId = 'section-splatenv';

            const el = document.getElementById(sectionId);
            if (el) {
                this.setActivePropTab('object');
                el.classList.remove('hidden');
            }

            // Popola campi CutScene
            if (type === 'CutScene') {
                document.getElementById('cut-trigger-level-start').checked = !!selected.userData.triggerOnLevelStart;
                document.getElementById('cut-trigger-collision').checked = !!selected.userData.triggerOnCollision;
                document.getElementById('cut-skippable').checked = !!selected.userData.skippable;
                document.getElementById('cut-skip-key').value = selected.userData.skipKey || 'Escape';
                document.getElementById('cut-appear-effect').value = selected.userData.appearEffect || 'immediate';
                
                const filenameLabel = document.getElementById('cut-video-filename');
                if (filenameLabel) {
                    filenameLabel.textContent = selected.userData.videoFilename || '(Nessuno)';
                }
                const clearBtn = document.getElementById('btn-cut-video-clear');
                if (clearBtn) {
                    clearBtn.classList.toggle('hidden', !selected.userData.videoSource);
                }
            }
            // Popola campi SoundEffect
            if (type === 'SoundEffect') {
                document.getElementById('sound-trigger-level-start').checked = !!selected.userData.triggerOnLevelStart;
                document.getElementById('sound-trigger-collision').checked = !!selected.userData.triggerOnCollision;
                
                const filenameLabel = document.getElementById('sound-audio-filename');
                if (filenameLabel) {
                    filenameLabel.textContent = selected.userData.audioFilename || '(Nessuno)';
                }
                const clearBtn = document.getElementById('btn-sound-audio-clear');
                if (clearBtn) {
                    clearBtn.classList.toggle('hidden', !selected.userData.audioSource);
                }
            }
            // Popola campi EmbedHTML
            if (type === 'EmbedHTML') {
                document.getElementById('eb-url').value = selected.userData.embedUrl || 'https://example.com';
                const actMode = selected.userData.activationMode || 'collision';
                document.getElementById('eb-activation-mode').value = actMode;
                document.getElementById('eb-activation-key').value = selected.userData.activationKey || 'e';
                
                const showHint = !!selected.userData.showHint;
                document.getElementById('eb-show-hint').checked = showHint;

                let defaultDist = '4.0';
                if (selected.geometry) {
                    selected.geometry.computeBoundingBox();
                    const oBox = selected.geometry.boundingBox;
                    const size = new THREE.Vector3();
                    if (oBox) {
                        oBox.getSize(size);
                        const maxDim = Math.max(size.x, size.y, size.z);
                        defaultDist = (maxDim / 2 + 3.0).toFixed(1);
                    }
                }
                const ebHintDistance = document.getElementById('eb-hint-distance');
                if (ebHintDistance) {
                    ebHintDistance.value = selected.userData.hintDistance !== undefined ? selected.userData.hintDistance : '';
                    ebHintDistance.placeholder = "Default (" + (defaultDist) + ")";
                }

                const pKey = document.getElementById('panel-eb-keypress');
                if (pKey) pKey.classList.toggle('hidden', actMode !== 'keypress');

                const hintDistRow = document.getElementById('eb-hint-dist-row');
                if (hintDistRow) {
                    hintDistRow.classList.toggle('hidden', !showHint || actMode !== 'keypress');
                }
            }

            // Popola campi Analyze
            if (type === 'Analyze') {
                document.getElementById('anz-name').value = selected.userData.objectName || '';
                document.getElementById('anz-desc').value = selected.userData.objectDescription || '';
                document.getElementById('anz-key').value = selected.userData.activationKey || 'e';
                document.getElementById('anz-touch').checked = !!selected.userData.activationTouch;
                const showHintEl = document.getElementById('anz-show-hint');
                if (showHintEl) showHintEl.checked = selected.userData.showHint !== false;
                const hintDistEl = document.getElementById('anz-hint-dist');
                if (hintDistEl) hintDistEl.value = selected.userData.hintDistance !== undefined ? selected.userData.hintDistance : 3.5;
                const hintSizeEl = document.getElementById('anz-hint-size');
                if (hintSizeEl) hintSizeEl.value = selected.userData.hintSize || 44;
                const hintBgEl = document.getElementById('anz-hint-bgcolor');
                if (hintBgEl) hintBgEl.value = selected.userData.hintBgColor || selected.userData.dialogAccentColor || '#33cccc';
                const hintTextEl = document.getElementById('anz-hint-textcolor');
                if (hintTextEl) hintTextEl.value = selected.userData.hintTextColor || '#000000';
                
                const model = selected.getObjectByName('model');
                const filenameEl = document.getElementById('anz-filename');
                if (filenameEl) filenameEl.innerText = selected.userData.glbFilename || "(Default Box)";
                
                const container = document.getElementById('anz-glb-preview-container');
                if (model && selected.userData.glbSource) {
                    if (container) container.style.display = 'flex';
                    const img = document.getElementById('anz-glb-preview-img');
                    if (img && (!img.src || img.style.display === 'none')) this.generateThumbnail(model, 'anz-glb-preview-img');
                } else {
                    if (container) container.style.display = 'none';
                }

                // Popola offset e rotazione modello per Analyze
                const anzModely = document.getElementById('anz-modely');
                const anzModelRoty = document.getElementById('anz-model-roty');
                const anzScaleX = document.getElementById('anz-model-scalex');
                const anzScaleY = document.getElementById('anz-model-scaley');
                const anzScaleZ = document.getElementById('anz-model-scalez');

                if (model) {
                    if (anzModely) anzModely.value = model.position.y.toFixed(2);
                    if (anzModelRoty) anzModelRoty.value = THREE.MathUtils.radToDeg(model.rotation.y).toFixed(0);
                    if (anzScaleX) anzScaleX.value = model.scale.x.toFixed(2);
                    if (anzScaleY) anzScaleY.value = model.scale.y.toFixed(2);
                    if (anzScaleZ) anzScaleZ.value = model.scale.z.toFixed(2);
                } else {
                    if (anzModely) anzModely.value = 0;
                    if (anzModelRoty) anzModelRoty.value = 0;
                    if (anzScaleX) anzScaleX.value = 1;
                    if (anzScaleY) anzScaleY.value = 1;
                    if (anzScaleZ) anzScaleZ.value = 1;
                }
            }

            // Popola campi Dialog
            if (type === 'Dialog') {
                // Migrazione dati legacy: se manca l'array di domande, crealo basandoti sulla singola domanda legacy
                if (!selected.userData.dialogQuestions || selected.userData.dialogQuestions.length === 0) {
                    selected.userData.dialogQuestions = [
                        {
                            text: selected.userData.dialogQuestion || 'Scrivi qui la tua domanda...',
                            image: '',
                            answers: []
                        }
                    ];
                }
                
                document.getElementById('dlg-bgcolor').value = selected.userData.dialogBgColor || '#19191e';
                document.getElementById('dlg-textcolor').value = selected.userData.dialogTextColor || '#ffffff';
                document.getElementById('dlg-accentcolor').value = selected.userData.dialogAccentColor || '#eb7b33';
                document.getElementById('dlg-font').value = selected.userData.dialogFont || "'Segoe UI', sans-serif";
                const actMode = selected.userData.activationMode || 'collision';
                document.getElementById('dlg-activation-mode').value = actMode;
                document.getElementById('dlg-activation-key').value = selected.userData.activationKey || '';
                
                const pKey = document.getElementById('panel-dlg-keypress');
                if (pKey) pKey.classList.toggle('hidden', actMode !== 'keypress');

                this.activeQuestionIndex = 0;
                this.renderDialogQuestionsList(selected);
                this.renderDialogQuestionEditPanel(selected);
            }

            if (type === 'Objective') {
                const actionType = selected.userData.actionType || 'alert';
                document.getElementById('obj-action').value = actionType;
                document.getElementById('obj-text').value = selected.userData.objectiveText || 'Raggiungi';
                document.getElementById('obj-value').value = selected.userData.actionValue || '';
                document.getElementById('obj-distance').value = selected.userData.triggerDistance !== undefined ? selected.userData.triggerDistance : '';

                const inputVal = document.getElementById('obj-value');
                const selectVal = document.getElementById('obj-value-select');
                const addTargetRow = document.getElementById('obj-add-target-row');
                const targetsContainer = document.getElementById('obj-targets-container');

                if (addTargetRow && targetsContainer) {
                    if (actionType === 'load_level') {
                        addTargetRow.style.display = 'none';
                        targetsContainer.style.display = 'none';
                    } else {
                        addTargetRow.style.display = '';
                        targetsContainer.style.display = '';
                    }
                }

                if (inputVal && selectVal) {
                    if (actionType === 'play_anim' || actionType === 'load_level') {
                        inputVal.style.display = 'none';
                        selectVal.style.display = '';
                    } else {
                        inputVal.style.display = '';
                        selectVal.style.display = 'none';
                    }
                }

                this.renderObjectiveTargets(selected);

                if (actionType === 'load_level') {
                    if (selectVal) {
                        selectVal.innerHTML = '';
                        const emptyOpt = document.createElement('option');
                        emptyOpt.value = '';
                        emptyOpt.innerText = '-- Seleziona Livello --';
                        selectVal.appendChild(emptyOpt);
                        this.app.editor.levels.forEach((lvl, idx) => {
                            const opt = document.createElement('option');
                            opt.value = idx;
                            opt.innerText = (idx) + ": " + (lvl.name);
                            if (selected.userData.actionValue == idx) opt.selected = true;
                            selectVal.appendChild(opt);
                        });
                    }
                } else if (actionType === 'play_anim') {
                    if (selected.userData.actionTargets && selected.userData.actionTargets.length > 0) {
                        this.updateObjectiveAnimList(selected.userData.actionTargets[0]);
                    } else {
                        this.updateObjectiveAnimList(null);
                    }
                }
            }

            const prefix = type === 'Enemy' ? 'e' : type === 'Bonus' ? 'b' : type === 'Boss' ? 'bs' : type === 'PowerUp' ? 'pu' : type === 'Spawn' ? 'sp' : type === 'Goal' ? 'g' : type === 'Collision' ? 'col' : (type === 'catcher_base' || type === 'Catcher') ? 'c' : type === 'Model' ? 'm' : type === 'SplatEnv' ? 'se' : '';

            // Common GLB & Model Y Logic
            if (prefix) {
                const model = selected.getObjectByName('model');
                const container = document.getElementById((prefix) + "-glb-preview-container");
                const filename = document.getElementById((prefix) + "-filename");
                const modely = document.getElementById((prefix) + "-modely");

                if (filename) filename.innerText = selected.userData.glbFilename || "(Default)";
                if (modely && model) modely.value = model.position.y.toFixed(2);

                if (model && selected.userData.glbSource) {
                    if (container) container.style.display = 'flex';
                    const img = document.getElementById((prefix) + "-glb-preview-img");
                    if (img && (!img.src || img.style.display === 'none')) this.generateThumbnail(model, (prefix) + "-glb-preview-img");

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
                        anims.map(a => "<option value=\"" + (a) + "\" " + (a === selected.userData.defaultAnim ? 'selected' : '') + ">" + (a) + "</option>").join('');
                }

                // Transparency
                const am = document.getElementById('m-alpha-mode');
                if (am) am.value = selected.userData.alphaMode || 'mask';
                const at = document.getElementById('m-alpha-test');
                if (at) at.value = selected.userData.alphaTest !== undefined ? selected.userData.alphaTest : 0.5;
                const ds = document.getElementById('m-double-side');
                if (ds) ds.checked = selected.userData.doubleSide !== undefined ? !!selected.userData.doubleSide : true;

                // PBR Material inputs
                let firstMeshMat = null;
                selected.traverse((child) => {
                    if (!firstMeshMat && child.isMesh && child.material) {
                        firstMeshMat = Array.isArray(child.material) ? child.material[0] : child.material;
                    }
                });

                const mColor = document.getElementById('m-material-color');
                if (mColor) {
                    mColor.value = selected.userData.materialColor || (firstMeshMat && firstMeshMat.color ? '#' + firstMeshMat.color.getHexString() : '#ffffff');
                }
                const mMet = document.getElementById('m-material-metalness');
                if (mMet) {
                    mMet.value = selected.userData.materialMetalness !== undefined ? selected.userData.materialMetalness : (firstMeshMat && firstMeshMat.metalness !== undefined ? firstMeshMat.metalness : 0.0);
                }
                const mRou = document.getElementById('m-material-roughness');
                if (mRou) {
                    mRou.value = selected.userData.materialRoughness !== undefined ? selected.userData.materialRoughness : (firstMeshMat && firstMeshMat.roughness !== undefined ? firstMeshMat.roughness : 1.0);
                }
                const mSpec = document.getElementById('m-material-specular');
                if (mSpec) {
                    mSpec.value = selected.userData.materialSpecular !== undefined ? selected.userData.materialSpecular : 0.5;
                }
                const mSub = document.getElementById('m-material-subsurface-scattering');
                if (mSub) {
                    mSub.value = selected.userData.materialSubsurfaceScattering !== undefined ? selected.userData.materialSubsurfaceScattering : 0.0;
                }
                const mCc = document.getElementById('m-material-clearcoat');
                if (mCc) {
                    mCc.value = selected.userData.materialClearcoat !== undefined ? selected.userData.materialClearcoat : 0.0;
                }
                const mCcr = document.getElementById('m-material-clearcoat-roughness');
                if (mCcr) {
                    mCcr.value = selected.userData.materialClearcoatRoughness !== undefined ? selected.userData.materialClearcoatRoughness : 0.0;
                }
                const mTr = document.getElementById('m-material-transmission');
                if (mTr) {
                    mTr.value = selected.userData.materialTransmission !== undefined ? selected.userData.materialTransmission : 0.0;
                }
                const mTh = document.getElementById('m-material-thickness');
                if (mTh) {
                    mTh.value = selected.userData.materialThickness !== undefined ? selected.userData.materialThickness : 0.0;
                }
                const mEm = document.getElementById('m-material-emissive');
                if (mEm) {
                    mEm.value = selected.userData.materialEmissive || (firstMeshMat && firstMeshMat.emissive ? '#' + firstMeshMat.emissive.getHexString() : '#000000');
                }
                const mEmi = document.getElementById('m-material-emissive-intensity');
                if (mEmi) {
                    mEmi.value = selected.userData.materialEmissiveIntensity !== undefined ? selected.userData.materialEmissiveIntensity : (firstMeshMat && firstMeshMat.emissiveIntensity !== undefined ? firstMeshMat.emissiveIntensity : 1.0);
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
                            const tKey = "followerTrans" + (axis.toUpperCase());
                            const tVal = selected.userData[tKey];
                            const t = document.getElementById("e-f-t" + (axis));
                            if (t) t.checked = tVal !== undefined ? tVal : true;

                            const rKey = "followerRot" + (axis.toUpperCase());
                            const rVal = selected.userData[rKey];
                            const r = document.getElementById("e-f-r" + (axis));
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
                        anims.map(a => "<option value=\"" + (a) + "\" " + (a === val ? 'selected' : '') + ">" + (a) + "</option>").join('');
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
                        anims.map(a => "<option value=\"" + (a) + "\" " + (a === val ? 'selected' : '') + ">" + (a) + "</option>").join('');
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
                        anims.map(a => "<option value=\"" + (a) + "\" " + (a === selected.userData.defaultAnim ? 'selected' : '') + ">" + (a) + "</option>").join('');
                }
                const equipSelect = document.getElementById('pu-equip-anim'); // Assuming equipSelect was defined elsewhere or is a typo for pu-equip-anim
                if (equipSelect) {
                    equipSelect.innerHTML = '<option value="">-- None --</option>' +
                        anims.map(a => "<option value=\"" + (a) + "\" " + (a === selected.userData.equipAnim ? 'selected' : '') + ">" + (a) + "</option>").join('');
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
                        playerAnims.map(a => "<option value=\"" + (a) + "\" " + (a === selected.userData.flyAnim ? 'selected' : '') + ">" + (a) + "</option>").join('');
                }
                const flyBoostInput = document.getElementById('pu-fly-boost');
                if (flyBoostInput) flyBoostInput.value = selected.userData.flyBoost || 10.0;
            }
            else if (type === 'Collision') {
                const actionType = selected.userData.actionType || 'restart';
                document.getElementById('col-action').value = actionType;
                document.getElementById('col-value').value = selected.userData.actionValue || '';
                
                const inputVal = document.getElementById('col-value');
                const selectVal = document.getElementById('col-value-select');
                const addTargetRow = document.getElementById('col-add-target-row');
                const targetsContainer = document.getElementById('col-targets-container');

                if (addTargetRow && targetsContainer) {
                    if (actionType === 'load_level' || actionType === 'play_cutscene' || actionType === 'play_soundeffect') {
                        addTargetRow.style.display = 'none';
                        targetsContainer.style.display = 'none';
                    } else {
                        addTargetRow.style.display = '';
                        targetsContainer.style.display = '';
                    }
                }

                if (inputVal && selectVal) {
                    if (actionType === 'play_anim' || actionType === 'load_level' || actionType === 'play_cutscene' || actionType === 'play_soundeffect') {
                        inputVal.style.display = 'none';
                        selectVal.style.display = '';
                    } else {
                        inputVal.style.display = '';
                        selectVal.style.display = 'none';
                    }
                }

                // Carica nuove opzioni di attivazione e ripetizione
                const actMode = selected.userData.activationMode || 'collision';
                document.getElementById('col-activation-mode').value = actMode;
                document.getElementById('col-activation-key').value = selected.userData.activationKey || '';
                
                const showHint = !!selected.userData.showHint;
                document.getElementById('col-show-hint').checked = showHint;
                
                let defaultDist = '4.0';
                if (selected.geometry) {
                    selected.geometry.computeBoundingBox();
                    const oBox = selected.geometry.boundingBox;
                    const size = new THREE.Vector3();
                    if (oBox) {
                        oBox.getSize(size);
                        const maxDim = Math.max(size.x, size.y, size.z);
                        defaultDist = (maxDim / 2 + 3.0).toFixed(1);
                    }
                }
                
                const colHintDistance = document.getElementById('col-hint-distance');
                if (colHintDistance) {
                    colHintDistance.value = selected.userData.hintDistance !== undefined ? selected.userData.hintDistance : '';
                    colHintDistance.placeholder = "Default (" + (defaultDist) + ")";
                }
                
                const hintDistRow = document.getElementById('col-hint-dist-row');
                if (hintDistRow) {
                    hintDistRow.classList.toggle('hidden', !showHint || actMode !== 'keypress');
                }
                
                document.getElementById('col-external-event').value = selected.userData.externalEvent || 'anim_end';
                document.getElementById('col-external-target').value = selected.userData.externalTarget || '';

                const repMode = selected.userData.repeatMode || (selected.userData.oneShot ? 'once' : 'always');
                document.getElementById('col-repeat-mode').value = repMode;
                document.getElementById('col-repeat-count').value = selected.userData.repeatCount !== undefined ? selected.userData.repeatCount : 1;

                const animLoopMode = selected.userData.animLoopMode || 'loop';
                document.getElementById('col-anim-loop-mode').value = animLoopMode;
                document.getElementById('col-anim-play-count').value = selected.userData.animPlayCount !== undefined ? selected.userData.animPlayCount : 1;

                // Mostra/Nascondi pannelli
                const pKey = document.getElementById('panel-col-keypress');
                if (pKey) pKey.classList.toggle('hidden', actMode !== 'keypress');

                const pExt = document.getElementById('panel-col-external');
                if (pExt) pExt.classList.toggle('hidden', actMode !== 'external');

                const pRep = document.getElementById('panel-col-repeat-count');
                if (pRep) pRep.classList.toggle('hidden', repMode !== 'count');

                const pAnim = document.getElementById('panel-col-anim-count');
                if (pAnim) pAnim.classList.toggle('hidden', animLoopMode !== 'count');

                this.renderCollisionTargets(selected);
                
                if (actionType === 'load_level') {
                    if (selectVal) {
                        selectVal.innerHTML = '';
                        const emptyOpt = document.createElement('option');
                        emptyOpt.value = '';
                        emptyOpt.innerText = '-- Seleziona Livello --';
                        selectVal.appendChild(emptyOpt);
                        
                        const levels = this.app.editor.levels || [];
                        levels.forEach((lvl, idx) => {
                            const opt = document.createElement('option');
                            opt.value = idx;
                            opt.innerText = (idx) + ": " + (lvl.name);
                            if (selected.userData.actionValue == idx) {
                                opt.selected = true;
                            }
                            selectVal.appendChild(opt);
                        });
                        selectVal.value = selected.userData.actionValue !== undefined ? selected.userData.actionValue : '';
                    }
                } else if (actionType === 'play_cutscene') {
                    if (selectVal) {
                        selectVal.innerHTML = '';
                        const emptyOpt = document.createElement('option');
                        emptyOpt.value = '';
                        emptyOpt.innerText = '-- Seleziona Cutscene --';
                        selectVal.appendChild(emptyOpt);
                        
                        this.app.editor.objects.forEach(o => {
                            if (o.userData.type === 'CutScene') {
                                const opt = document.createElement('option');
                                opt.value = o.name;
                                opt.innerText = o.name;
                                if (selected.userData.actionValue === o.name) {
                                    opt.selected = true;
                                }
                                selectVal.appendChild(opt);
                            }
                        });
                        selectVal.value = selected.userData.actionValue !== undefined ? selected.userData.actionValue : '';
                    }
                } else if (actionType === 'play_soundeffect') {
                    if (selectVal) {
                        selectVal.innerHTML = '';
                        const emptyOpt = document.createElement('option');
                        emptyOpt.value = '';
                        emptyOpt.innerText = '-- Seleziona Effetto Sonoro --';
                        selectVal.appendChild(emptyOpt);
                        
                        this.app.editor.objects.forEach(o => {
                            if (o.userData.type === 'SoundEffect') {
                                const opt = document.createElement('option');
                                opt.value = o.name;
                                opt.innerText = o.name;
                                if (selected.userData.actionValue === o.name) {
                                    opt.selected = true;
                                }
                                selectVal.appendChild(opt);
                            }
                        });
                        selectVal.value = selected.userData.actionValue !== undefined ? selected.userData.actionValue : '';
                    }
                } else {
                    if (selected.userData.actionTargets?.length > 0) {
                        this.updateCollisionAnimList(selected.userData.actionTargets[0]);
                    } else if (selected.userData.actionTarget) {
                        this.updateCollisionAnimList(selected.userData.actionTarget);
                    } else {
                        this.updateCollisionAnimList(null);
                    }
                    if (selectVal) {
                        selectVal.value = selected.userData.actionValue || '';
                    }
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
            div.innerHTML = "<span style=\"flex:1; color:#22ff22;\">" + (t) + "</span><button class=\"btn-icon-small\" data-idx=\"" + (i) + "\" style=\"opacity:0.6;\">🗑️</button>";
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

    renderObjectiveTargets(selected) {
        const container = document.getElementById('obj-targets-container');
        if (!container) return;
        container.innerHTML = '';
        const targets = selected.userData.actionTargets || [];
        targets.forEach((t, i) => {
            const div = document.createElement('div');
            div.style.display = 'flex'; div.style.alignItems = 'center'; div.style.gap = '5px';
            div.style.background = '#222'; div.style.padding = '2px 5px'; div.style.borderRadius = '3px';
            div.style.fontSize = '10px';
            div.innerHTML = "<span style=\"flex:1; color:#ffcc00;\">" + (t) + "</span><button class=\"btn-icon-small\" data-idx=\"" + (i) + "\" style=\"opacity:0.6;\">🗑️</button>";
            div.querySelector('button').onclick = () => this.removeObjectiveTarget(selected, i);
            container.appendChild(div);
        });
    }

    removeObjectiveTarget(selected, index) {
        if (selected.userData.actionTargets) {
            selected.userData.actionTargets.splice(index, 1);
            this.renderObjectiveTargets(selected);
        }
    }

    updateObjectiveAnimList(targetName) {
        const list = document.getElementById('obj-value-list');
        const select = document.getElementById('obj-value-select');
        if (!list) return;
        list.innerHTML = '';
        if (select) {
            select.innerHTML = '';
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.innerText = '-- Seleziona Animazione --';
            select.appendChild(emptyOpt);
        }
        if (!targetName) return;

        let target = this.app.editor.objects.find(o => o.name === targetName);
        if (!target) {
            target = this.app.editor.objects.find(o => o.userData.glbFilename === targetName);
        }
        if (!target) {
            target = this.app.editor.objects.find(o => o.name && o.name.toLowerCase() === targetName.toLowerCase());
        }
        if (!target) {
            target = this.app.editor.objects.find(o => o.name && o.name.includes(targetName));
        }

        if (target && target.userData.anims) {
            const animations = target.userData.anims;
            animations.forEach(anim => {
                const opt = document.createElement('option');
                opt.value = anim;
                opt.innerText = anim;
                list.appendChild(opt);

                if (select) {
                    const selOpt = document.createElement('option');
                    selOpt.value = anim;
                    selOpt.innerText = anim;
                    if (this.app.editor.selected?.userData.actionValue === anim) selOpt.selected = true;
                    select.appendChild(selOpt);
                }
            });
        }
    }

    renderActionList(playerObj) {
        const container = document.getElementById('action-list-container'); container.innerHTML = '';
        const actions = playerObj.userData.actions || [], anims = playerObj.userData.anims || [];
        actions.forEach((action, index) => {
            const item = document.createElement('div'); item.className = 'action-item'; if (action.active === false) item.style.opacity = '0.6';
            item.draggable = true; item.dataset.idx = index;
            const animOptions = ['<option value="">No Anim</option>', ...anims.map(a => "<option value=\"" + (a) + "\" " + (a === action.anim ? 'selected' : '') + ">" + (a) + "</option>")].join('');
            const typeOptions = this.actionTypes.map(t => "<option value=\"" + (t) + "\" " + (t === action.type ? 'selected' : '') + ">" + (t) + "</option>").join('');
            const sfxFilename = action.sfxFilename || '';
            item.innerHTML = "\n                <div class=\"action-header\"><span style=\"font-size:12px; cursor:grab;\">☰</span><input type=\"text\" class=\"action-key-input\" style=\"flex:1; margin:0 5px; font-weight:bold; color:#eb7b33;\" value=\"" + (action.name || 'Action') + "\" data-idx=\"" + (index) + "\" data-field=\"name\"><div style=\"display:flex; align-items:center; gap:5px;\"><input type=\"checkbox\" class=\"action-checkbox\" " + (action.active !== false ? 'checked' : '') + " data-idx=\"" + (index) + "\" data-field=\"active\"><button class=\"btn-icon-small\" data-idx=\"" + (index) + "\">🗑️</button></div></div>\n                <div class=\"action-row-inputs\"><input type=\"text\" class=\"action-key-input\" placeholder=\"Key\" value=\"" + (action.key) + "\" data-idx=\"" + (index) + "\" data-field=\"key\"><select class=\"action-select\" data-idx=\"" + (index) + "\" data-field=\"type\">" + (typeOptions) + "</select><select class=\"action-select\" data-idx=\"" + (index) + "\" data-field=\"anim\">" + (animOptions) + "</select><input type=\"checkbox\" class=\"action-checkbox\" " + (action.mirror ? 'checked' : '') + " data-idx=\"" + (index) + "\" data-field=\"mirror\"></div>\n                <div style=\"display:flex; align-items:center; gap:5px; margin-top:4px;\">\n                    <span style=\"font-size:10px; color:#888; flex-shrink:0;\">🔊 SFX:</span>\n                    <span class=\"action-sfx-name\" data-idx=\"" + (index) + "\" style=\"flex:1; font-size:10px; color:#eb7b33; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;\">" + (sfxFilename || '(none)') + "</span>\n                    <button class=\"level-btn-sm action-sfx-btn\" data-idx=\"" + (index) + "\">📁</button>\n                    <button class=\"level-btn-sm danger action-sfx-clear\" data-idx=\"" + (index) + "\" style=\"padding:2px 4px;\">✕</button>\n                </div>";
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
        const select = document.getElementById('col-value-select');
        if (!list) return;
        list.innerHTML = '';
        if (select) {
            select.innerHTML = '';
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.innerText = '-- Seleziona Animazione --';
            select.appendChild(emptyOpt);
        }
        if (!targetName) return;

        // Cerca l'oggetto target in modo estremamente flessibile
        let target = this.app.editor.objects.find(o => o.name === targetName);
        if (!target) {
            target = this.app.editor.objects.find(o => o.userData.glbFilename === targetName);
        }
        if (!target) {
            // Cerca case-insensitive
            target = this.app.editor.objects.find(o => o.name && o.name.toLowerCase() === targetName.toLowerCase());
        }
        if (!target) {
            // Cerca se contiene il nome
            target = this.app.editor.objects.find(o => o.name && o.name.includes(targetName));
        }
        if (!target) {
            // Se targetName è il nome di un asset della libreria (es. "ps1_scene.glb"),
            // trova l'oggetto nella scena che ha lo stesso glbSource di quell'asset
            const libItem = this.library.find(item => item.name === targetName);
            if (libItem && libItem.data) {
                const getB64 = (s) => {
                    if (!s || typeof s !== 'string') return '';
                    const idx = s.indexOf(',');
                    return idx !== -1 ? s.substring(idx + 1) : s;
                };
                const libB64 = getB64(libItem.data);
                target = this.app.editor.objects.find(o => o.userData.type === 'Model' && getB64(o.userData.glbSource) === libB64);
            }
        }

        if (!target) return;

        // Recupera le animazioni da tutte le fonti possibili dell'oggetto target
        let anims = [];
        if (target.userData.anims && target.userData.anims.length > 0) {
            anims = [...target.userData.anims];
        }
        
        if (anims.length === 0 && target.animations && target.animations.length > 0) {
            anims = target.animations.map(c => c.name);
        }

        if (anims.length === 0) {
            const model = target.getObjectByName('model');
            if (model) {
                if (model.animations && model.animations.length > 0) {
                    anims = model.animations.map(c => c.name);
                } else if (model.parent && model.parent.animations && model.parent.animations.length > 0) {
                    anims = model.parent.animations.map(c => c.name);
                }
            }
        }

        if (target.userData.isPlayer && target.userData.actions) {
            const actionAnims = target.userData.actions.map(a => a.anim).filter(a => a);
            anims = [...new Set([...anims, ...actionAnims])];
        }

        // Rimuovi duplicati
        anims = [...new Set(anims)];

        anims.forEach(anim => {
            const opt = document.createElement('option');
            opt.value = anim;
            list.appendChild(opt);

            if (select) {
                const sOpt = document.createElement('option');
                sOpt.value = anim;
                sOpt.innerText = anim;
                select.appendChild(sOpt);
            }
        });

        // Ripristina valore attivo se Collision selezionato
        const selected = this.app.editor.selected;
        if (selected?.userData.type === 'Collision' && select) {
            select.value = selected.userData.actionValue || '';
        }
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
                const name = "Level " + (this.app.editor.levels.length + 1);
                this.app.editor.saveCurrentAsLevel(name);
            };
        }

        // Import a JSON file as a new level
        const btnImport = document.getElementById('btn-import-level-json');
        if (btnImport) {
            btnImport.onclick = () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,.wscene';
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
            div.innerHTML = "\n                <span class=\"level-name " + (isActive ? 'active-level' : '') + "\" title=\"Doppio click per rinominare — Index: " + (index) + "\">" + (index) + ": " + (level.name) + "</span>\n                <button class=\"level-btn-sm lv-start\" data-idx=\"" + (index) + "\" title=\"Imposta come livello iniziale\">" + (isStarting ? '⭐' : '☆') + "</button>\n                <button class=\"level-btn-sm lv-play\" data-idx=\"" + (index) + "\" title=\"Testa questo livello\">▶️</button>\n                <button class=\"level-btn-sm lv-load\" data-idx=\"" + (index) + "\" title=\"Carica nel editor (auto-salva il livello corrente)\">📂</button>\n                <button class=\"level-btn-sm lv-update\" data-idx=\"" + (index) + "\" title=\"Salva scena corrente\">💾</button>\n                <button class=\"level-btn-sm lv-music\" data-idx=\"" + (index) + "\" title=\"" + (musicName || 'Scegli musica BGM') + "\">🎵</button>\n                <button class=\"level-btn-sm danger lv-delete\" data-idx=\"" + (index) + "\" title=\"Cancella\">🗑️</button>\n            ";

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
                if (confirm("Cancellare \"" + (level.name) + "\"?")) {
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

    _injectModalStyles() {
        if (!document.getElementById('dyn-modal-styles')) {
            const styles = document.createElement('style');
            styles.id = 'dyn-modal-styles';
            styles.innerHTML = "\n                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }\n                @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }\n                @keyframes scaleUp { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }\n                @keyframes scaleDown { from { transform: scale(1); opacity: 1; } to { transform: scale(0.9); opacity: 0; } }\n            ";
            document.head.appendChild(styles);
        }
    }

    showToast(message, duration = 2000) {
        const existing = document.getElementById('toast-notification');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.style.cssText = "\n            position: fixed;\n            bottom: 30px;\n            left: 50%;\n            transform: translateX(-50%) translateY(20px);\n            background: rgba(25, 25, 30, 0.95);\n            color: #fff;\n            border: 2px solid #eb7b33;\n            border-radius: 50px;\n            padding: 12px 30px;\n            font-size: 14px;\n            font-weight: bold;\n            box-shadow: 0 10px 25px rgba(0,0,0,0.5);\n            z-index: 100000;\n            opacity: 0;\n            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);\n            pointer-events: none;\n            display: flex;\n            align-items: center;\n            gap: 8px;\n        ";
        toast.innerText = message;
        document.body.appendChild(toast);

        toast.offsetHeight; // force reflow

        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(-20px)';
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, duration);
    }

    showModalAlert(title, message) {
        this._injectModalStyles();
        const existing = document.getElementById('dyn-modal-alert');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'dyn-modal-alert';
        modal.style.cssText = "\n            position: fixed;\n            inset: 0;\n            z-index: 99999;\n            background: rgba(0, 0, 0, 0.7);\n            backdrop-filter: blur(8px);\n            display: flex;\n            align-items: center;\n            justify-content: center;\n            animation: fadeIn 0.2s ease-out;\n        ";

        const card = document.createElement('div');
        card.style.cssText = "\n            background: #1e1e24;\n            border: 1px solid rgba(255, 255, 255, 0.1);\n            border-radius: 12px;\n            width: 90%;\n            max-width: 400px;\n            padding: 24px;\n            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);\n            transform: scale(0.9);\n            animation: scaleUp 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;\n            font-family: system-ui, -apple-system, sans-serif;\n            color: #fff;\n        ";

        card.innerHTML = "\n            <div style=\"font-size: 16px; font-weight: 700; margin-bottom: 12px; color: #eb7b33; display: flex; align-items: center; gap: 8px;\">\n                " + (title) + "\n            </div>\n            <div style=\"font-size: 13px; line-height: 1.6; color: #ccc; margin-bottom: 24px; white-space: pre-wrap;\">\n                " + (message) + "\n            </div>\n            <div style=\"display: flex; justify-content: flex-end;\">\n                <button id=\"btn-alert-ok\" style=\"\n                    background: #eb7b33;\n                    color: #fff;\n                    border: none;\n                    padding: 8px 20px;\n                    font-size: 13px;\n                    font-weight: 600;\n                    border-radius: 6px;\n                    cursor: pointer;\n                    transition: background 0.15s;\n                \">OK</button>\n            </div>\n        ";

        modal.appendChild(card);
        document.body.appendChild(modal);

        const btn = card.querySelector('#btn-alert-ok');
        btn.focus();
        btn.onmouseover = () => btn.style.background = '#f98d48';
        btn.onmouseout = () => btn.style.background = '#eb7b33';

        const closeAlert = () => {
            modal.style.animation = 'fadeOut 0.15s ease-in forwards';
            card.style.animation = 'scaleDown 0.15s ease-in forwards';
            setTimeout(() => modal.remove(), 150);
            window.removeEventListener('keydown', onKeyDown);
        };

        btn.onclick = closeAlert;

        const onKeyDown = (e) => {
            if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
                e.preventDefault();
                closeAlert();
            }
        };
        window.addEventListener('keydown', onKeyDown);
    }

    showModalPrompt(title, label, defaultValue, callback) {
        this._injectModalStyles();
        const existing = document.getElementById('dyn-modal-prompt');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'dyn-modal-prompt';
        modal.style.cssText = "\n            position: fixed;\n            inset: 0;\n            z-index: 99999;\n            background: rgba(0, 0, 0, 0.7);\n            backdrop-filter: blur(8px);\n            display: flex;\n            align-items: center;\n            justify-content: center;\n            animation: fadeIn 0.2s ease-out;\n        ";

        const card = document.createElement('div');
        card.style.cssText = "\n            background: #1e1e24;\n            border: 1px solid rgba(255, 255, 255, 0.1);\n            border-radius: 12px;\n            width: 90%;\n            max-width: 400px;\n            padding: 24px;\n            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);\n            transform: scale(0.9);\n            animation: scaleUp 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;\n            font-family: system-ui, -apple-system, sans-serif;\n            color: #fff;\n        ";

        card.innerHTML = "\n            <div style=\"font-size: 16px; font-weight: 700; margin-bottom: 12px; color: #eb7b33;\">\n                " + (title) + "\n            </div>\n            <div style=\"font-size: 13px; color: #bbb; margin-bottom: 8px;\">\n                " + (label) + "\n            </div>\n            <input type=\"text\" id=\"prompt-input\" value=\"" + (defaultValue || '') + "\" style=\"\n                width: 100%;\n                background: #111;\n                border: 1px solid #444;\n                border-radius: 6px;\n                padding: 8px 12px;\n                color: #fff;\n                font-size: 13px;\n                margin-bottom: 24px;\n                box-sizing: border-box;\n                outline: none;\n            \">\n            <div style=\"display: flex; justify-content: flex-end; gap: 10px;\">\n                <button id=\"btn-prompt-cancel\" style=\"\n                    background: transparent;\n                    color: #aaa;\n                    border: 1px solid #444;\n                    padding: 8px 16px;\n                    font-size: 13px;\n                    font-weight: 600;\n                    border-radius: 6px;\n                    cursor: pointer;\n                    transition: color 0.15s;\n                \">Annulla</button>\n                <button id=\"btn-prompt-submit\" style=\"\n                    background: #eb7b33;\n                    color: #fff;\n                    border: none;\n                    padding: 8px 20px;\n                    font-size: 13px;\n                    font-weight: 600;\n                    border-radius: 6px;\n                    cursor: pointer;\n                    transition: background 0.15s;\n                \">Conferma</button>\n            </div>\n        ";

        modal.appendChild(card);
        document.body.appendChild(modal);

        const input = card.querySelector('#prompt-input');
        const btnCancel = card.querySelector('#btn-prompt-cancel');
        const btnSubmit = card.querySelector('#btn-prompt-submit');

        input.focus();
        input.select();
        input.style.border = '1px solid #eb7b33';

        const closePrompt = () => {
            modal.style.animation = 'fadeOut 0.15s ease-in forwards';
            card.style.animation = 'scaleDown 0.15s ease-in forwards';
            setTimeout(() => modal.remove(), 150);
            window.removeEventListener('keydown', onKeyDown);
        };

        const submit = () => {
            const val = input.value.trim();
            if (callback) callback(val);
            closePrompt();
        };

        btnCancel.onclick = closePrompt;
        btnSubmit.onclick = submit;

        btnSubmit.onmouseover = () => btnSubmit.style.background = '#f98d48';
        btnSubmit.onmouseout = () => btnSubmit.style.background = '#eb7b33';
        btnCancel.onmouseover = () => btnCancel.style.color = '#fff';
        btnCancel.onmouseout = () => btnCancel.style.color = '#aaa';

        const onKeyDown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closePrompt();
            }
        };
        window.addEventListener('keydown', onKeyDown);
    }

    renderDialogQuestionsList(selected) {
        const container = document.getElementById('dlg-questions-list');
        if (!container) return;
        container.innerHTML = '';
        const questions = selected.userData.dialogQuestions || [];

        questions.forEach((q, i) => {
            const div = document.createElement('div');
            div.style.cssText = "\n                display: flex;\n                align-items: center;\n                gap: 5px;\n                background: " + (this.activeQuestionIndex === i ? '#4422aa' : '#222') + ";\n                padding: 4px 6px;\n                border-radius: 4px;\n                font-size: 11px;\n                cursor: pointer;\n                border: 1px solid " + (this.activeQuestionIndex === i ? '#7733cc' : '#444') + ";\n            ";
            div.onclick = () => {
                this.activeQuestionIndex = i;
                this.renderDialogQuestionsList(selected);
                this.renderDialogQuestionEditPanel(selected);
            };

            const label = document.createElement('span');
            label.style.flex = '1';
            label.style.overflow = 'hidden';
            label.style.textOverflow = 'ellipsis';
            label.style.whiteSpace = 'nowrap';
            label.innerText = (i + 1) + ". " + (q.text || '(Vuota)');
            div.appendChild(label);

            const btnDel = document.createElement('button');
            btnDel.className = 'btn-icon-small';
            btnDel.innerHTML = '🗑️';
            btnDel.style.padding = '1px 3px';
            btnDel.onclick = (e) => {
                e.stopPropagation();
                questions.splice(i, 1);
                if (this.activeQuestionIndex >= questions.length) {
                    this.activeQuestionIndex = Math.max(0, questions.length - 1);
                }
                this.renderDialogQuestionsList(selected);
                this.renderDialogQuestionEditPanel(selected);
            };
            div.appendChild(btnDel);
            container.appendChild(div);
        });
    }

    renderDialogQuestionEditPanel(selected) {
        const panel = document.getElementById('dlg-q-edit-panel');
        if (!panel) return;
        const questions = selected.userData.dialogQuestions || [];
        const qIndex = this.activeQuestionIndex;
        if (qIndex < 0 || qIndex >= questions.length) {
            panel.classList.add('hidden');
            return;
        }
        panel.classList.remove('hidden');
        const q = questions[qIndex];

        // Textarea
        const textInput = document.getElementById('dlg-q-text');
        if (textInput) {
            textInput.value = q.text || '';
            textInput.oninput = (e) => {
                q.text = e.target.value;
                this.renderDialogQuestionsList(selected);
            };
        }

        // Image Preview and Handlers
        const previewCont = document.getElementById('dlg-q-img-preview-container');
        const preview = document.getElementById('dlg-q-img-preview');
        if (q.image) {
            if (previewCont) previewCont.classList.remove('hidden');
            if (preview) preview.src = q.image;
        } else {
            if (previewCont) previewCont.classList.add('hidden');
            if (preview) preview.src = '';
        }

        // Answer list
        this.renderDialogAnswersList(selected, q);
    }

    renderDialogAnswersList(selected, q) {
        const container = document.getElementById('dlg-answers-list');
        if (!container) return;
        container.innerHTML = '';
        const answers = q.answers || [];

        answers.forEach((ans, idx) => {
            const div = document.createElement('div');
            div.style.cssText = "\n                display: flex;\n                flex-direction: column;\n                gap: 4px;\n                background: rgba(0,0,0,0.2);\n                border: 1px solid #444;\n                border-radius: 4px;\n                padding: 6px;\n            ";

            // Row 1: Answer Text and Delete button
            const r1 = document.createElement('div');
            r1.style.display = 'flex';
            r1.style.gap = '4px';

            const txt = document.createElement('input');
            txt.type = 'text';
            txt.className = 'prop-input';
            txt.placeholder = 'Risposta...';
            txt.value = ans.text || '';
            txt.style.flex = '1';
            txt.oninput = (e) => { ans.text = e.target.value; };
            r1.appendChild(txt);

            const btnDel = document.createElement('button');
            btnDel.className = 'btn-icon-small';
            btnDel.innerHTML = '🗑️';
            btnDel.onclick = () => {
                answers.splice(idx, 1);
                this.renderDialogAnswersList(selected, q);
            };
            r1.appendChild(btnDel);
            div.appendChild(r1);

            // Row 2: Action type selection
            const r2 = document.createElement('div');
            r2.style.display = 'flex';
            r2.style.gap = '4px';

            const sel = document.createElement('select');
            sel.className = 'prop-input';
            sel.style.flex = '1';
            sel.innerHTML = "\n                <option value=\"close\" " + (ans.actionType === 'close' ? 'selected' : '') + ">Chiudi Dialogo</option>\n                <option value=\"next_q\" " + (ans.actionType === 'next_q' ? 'selected' : '') + ">Vai a Domanda...</option>\n                <option value=\"trigger\" " + (ans.actionType === 'trigger' ? 'selected' : '') + ">Attiva Trigger...</option>\n            ";

            // Row 3: Action value input/select
            const valCont = document.createElement('div');
            valCont.style.display = 'flex';
            valCont.style.gap = '4px';
            valCont.style.marginTop = '2px';

            const updateValField = () => {
                valCont.innerHTML = '';
                const aType = sel.value;
                ans.actionType = aType;

                if (aType === 'next_q') {
                    // Dropdown of other questions
                    const selectQ = document.createElement('select');
                    selectQ.className = 'prop-input';
                    selectQ.style.flex = '1';
                    const questions = selected.userData.dialogQuestions || [];
                    questions.forEach((otherQ, qIdx) => {
                        const opt = document.createElement('option');
                        opt.value = qIdx;
                        opt.innerText = "Domanda " + (qIdx + 1) + ": " + (otherQ.text?.substring(0, 15) || '') + "...";
                        if (ans.actionValue == qIdx) opt.selected = true;
                        selectQ.appendChild(opt);
                    });
                    selectQ.onchange = (e) => { ans.actionValue = parseInt(e.target.value); };
                    valCont.appendChild(selectQ);
                    ans.actionValue = ans.actionValue !== undefined ? ans.actionValue : 0;
                } else if (aType === 'trigger') {
                    // Text input or dropdown with collision/triggers datalist
                    const inpT = document.createElement('input');
                    inpT.type = 'text';
                    inpT.className = 'prop-input';
                    inpT.placeholder = 'Nome Trigger...';
                    inpT.value = ans.actionValue || '';
                    inpT.style.flex = '1';
                    inpT.setAttribute('list', 'col-target-list');
                    inpT.oninput = (e) => { ans.actionValue = e.target.value; };
                    valCont.appendChild(inpT);
                }
            };

            sel.onchange = () => {
                updateValField();
            };

            r2.appendChild(sel);
            div.appendChild(r2);
            div.appendChild(valCont);

            // Populate initial value field state
            updateValField();

            container.appendChild(div);
        });
    }

    updateSequencerUI() {
        if (!this.app.sceneManager) return;
        const countEl = document.getElementById('seq-keys-count');
        if (countEl) countEl.textContent = this.app.sceneManager.keyframes.length;

        const container = document.getElementById('timeline-keyframes-container');
        if (container) {
            container.innerHTML = '';
            this.app.sceneManager.keyframes.forEach(k => {
                const marker = document.createElement('div');
                marker.style.position = 'absolute';
                marker.style.top = '0';
                marker.style.bottom = '0';
                marker.style.width = '4px';
                marker.style.background = '#4f46e5';
                marker.style.left = `${k.time}%`;
                marker.title = `Time: ${k.time.toFixed(1)}%`;
                container.appendChild(marker);
            });
        }
    }
}
