import { Engine3D } from './engine.js';
import * as THREE from 'three';

document.addEventListener('DOMContentLoaded', () => {
    const viewportContainer = document.getElementById('canvas-holder');
    
    // FPS stats tracking
    let lastTime = performance.now();
    let frameCount = 0;
    const fpsCounterEl = document.getElementById('fps-counter');
    const resCounterEl = document.getElementById('res-counter');
    
    function updateFPS() {
        const now = performance.now();
        frameCount++;
        if (now >= lastTime + 1000) {
            fpsCounterEl.textContent = Math.round((frameCount * 1000) / (now - lastTime));
            frameCount = 0;
            lastTime = now;
        }
        requestAnimationFrame(updateFPS);
    }
    updateFPS();

    resCounterEl.textContent = `${viewportContainer.clientWidth}x${viewportContainer.clientHeight}`;
    window.addEventListener('resize', () => {
        resCounterEl.textContent = `${viewportContainer.clientWidth}x${viewportContainer.clientHeight}`;
    });

    // Declare engine using let to avoid temporal dead zone and allow callback checks
    let engine;
    let activeMaterialsList = [];
    let selectedMaterialIndex = 0;
    window.assetLibrary = {}; // Stores loaded GLB buffers mapped by fileName

    // --- IndexedDB Setup for GLB Persistence ---
    const dbName = 'AssetDatabase';
    const storeName = 'assets';

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 1);
            request.onerror = (event) => reject(event.target.error);
            request.onsuccess = (event) => resolve(event.target.result);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                db.createObjectStore(storeName, { keyPath: 'name' });
            };
        });
    }

    function saveAssetToDB(name, buffer) {
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.put({ name: name, buffer: buffer });
                request.onsuccess = () => resolve();
                request.onerror = (event) => reject(event.target.error);
            });
        });
    }

    function getAllAssetsFromDB() {
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.getAll();
                request.onsuccess = (event) => resolve(event.target.result);
                request.onerror = (event) => reject(event.target.error);
            });
        });
    }
    // Load assets from IndexedDB on startup (Disabled to ensure content browser starts empty for each project)
    console.log("[IndexedDB] Startup DB load bypassed to keep content browser empty.");
    /*
    getAllAssetsFromDB().then(assets => {
        console.log(`[IndexedDB] Loaded assets from DB. Count: ${assets ? assets.length : 0}`);
        if (assets && assets.length > 0) {
            assets.forEach(asset => {
                console.log(`[IndexedDB] Restoring asset: ${asset.name} (${asset.buffer.byteLength} bytes)`);
                window.assetLibrary[asset.name] = asset.buffer;
                createAssetCard(asset.name);
            });
            // Scan for placeholders in case a scene was loaded and has placeholders matching these assets
            if (engine) {
                replacePlaceholdersInScene();
            }
        }
    }).catch(err => {
        console.error('[IndexedDB] Failed to load assets:', err);
    });
    */

    function clearContentBrowser() {
        window.assetLibrary = {};
        const assetsGrid = document.getElementById('assets-grid');
        if (assetsGrid) {
            const cards = assetsGrid.querySelectorAll('.preset-card');
            cards.forEach(card => {
                if (card.id !== 'btn-import-glb') {
                    card.remove();
                }
            });
            const dividers = assetsGrid.querySelectorAll('.preset-divider');
            dividers.forEach(div => div.remove());
            
            const divider = document.createElement('div');
            divider.className = 'preset-divider';
            assetsGrid.appendChild(divider);
        }
    }

    function createAssetCard(fileName) {
        const assetsGrid = document.getElementById('assets-grid');
        if (!assetsGrid) return;
        
        // Avoid duplicate cards
        const existingCards = assetsGrid.querySelectorAll('.preset-card span');
        for (let span of existingCards) {
            if (span.textContent === fileName.replace(/\.[^/.]+$/, "")) {
                return;
            }
        }

        const card = document.createElement('div');
        card.className = 'preset-card';
        card.setAttribute('draggable', 'true');
        card.style.cursor = 'grab';
        card.style.height = '70px';
        card.style.minWidth = '100px';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.alignItems = 'center';
        card.style.justifyContent = 'center';
        card.style.gap = '5px';
        card.innerHTML = `
            <i class="fa-solid fa-box" style="font-size: 20px; color: #c084fc;"></i>
            <span style="font-size: 11px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90px;">${fileName.replace(/\.[^/.]+$/, "")}</span>
        `;

        card.addEventListener('dragstart', (evt) => {
            evt.dataTransfer.setData('text/plain', fileName);
        });

        assetsGrid.appendChild(card);
    }

    function replacePlaceholdersInScene() {
        if (!engine) return;
        console.log("=== Scanning for placeholders to replace ===");
        const placeholdersToReplace = [];
        engine.actors.forEach(actor => {
            if (actor.object && actor.object.userData && actor.object.userData.isPlaceholder) {
                const assetName = actor.object.userData.assetName;
                // Find matching buffer loosely (ignoring extension, case and spaces)
                const target = assetName.replace(/\.[^/.]+$/, "").toLowerCase().trim();
                let foundBuffer = null;
                let matchedRealName = null;
                for (let key in window.assetLibrary) {
                    if (key.replace(/\.[^/.]+$/, "").toLowerCase().trim() === target) {
                        foundBuffer = window.assetLibrary[key];
                        matchedRealName = key;
                        break;
                    }
                }
                if (foundBuffer) {
                    placeholdersToReplace.push({ actor, buffer: foundBuffer, realName: matchedRealName });
                }
            }
        });

        placeholdersToReplace.forEach(({ actor, buffer, realName }) => {
            console.log(`Replacing placeholder: "${actor.name}" with real GLB model: "${realName}"`);

            const pos = actor.object.position.clone();
            const rot = actor.object.rotation.clone();
            const originalScaleData = actor.object.userData.originalScale;
            const scl = originalScaleData ? new THREE.Vector3(originalScaleData.x, originalScaleData.y, originalScaleData.z) : new THREE.Vector3(1, 1, 1);

            // Remove placeholder from scene & actors list
            engine.scene.remove(actor.object);
            engine.actors = engine.actors.filter(a => a.id !== actor.id);

            // Spawn real GLB in place, preserving original name
            engine.spawnGLB(buffer, realName, pos, rot, scl, actor.name);
        });
    }


    // Outliner UI elements (declared early to allow callback access during construction)
    const outlinerList = document.getElementById('outliner-list');
    const outlinerSearch = document.getElementById('outliner-search');

    // Details Inspector UI elements
    const detailsEmpty = document.getElementById('details-empty');
    const detailsContent = document.getElementById('details-content');
    const actorTitle = document.getElementById('actor-title');
    const sectionMaterial = document.getElementById('section-material');
    const sectionLight = document.getElementById('section-light');

    const onSelectionChanged = () => {
        if (outlinerList && detailsEmpty) {
            updateOutliner();
            updateInspector();
        }
    };

    const onUpdatePT = (samples, renderMode) => {
        const samplesEl = document.getElementById('pt-samples');
        const overlayEl = document.getElementById('path-tracing-overlay');
        const configEl = document.getElementById('pt-samples-config');
        
        const maxSamples = engine ? engine.maxPtSamples : parseInt(document.getElementById('pt-max-samples').value) || 200;
        samplesEl.textContent = `Samples: ${samples} / ${maxSamples}`;
        
        // Safely determine mode during boot
        const currentMode = renderMode || document.getElementById('select-render-mode').value;
        if (currentMode === 'pathtrace') {
            samplesEl.classList.remove('hidden');
            if (configEl) configEl.classList.remove('hidden');
            if (samples < maxSamples) {
                overlayEl.classList.remove('hidden');
            } else {
                overlayEl.classList.add('hidden');
            }
        } else {
            samplesEl.classList.add('hidden');
            if (configEl) configEl.classList.add('hidden');
            overlayEl.classList.add('hidden');
        }
    };

    // Instantiate Engine
    engine = new Engine3D(viewportContainer, onSelectionChanged, onUpdatePT);
    
    // Explicitly call sync UI update once after engine is fully initialized
    onSelectionChanged();
    
    function updateOutliner() {
        if (!engine) return;
        outlinerList.innerHTML = '';
        const query = outlinerSearch.value.toLowerCase();

        engine.actors.forEach(actor => {
            if (query && !actor.name.toLowerCase().includes(query)) return;

            const div = document.createElement('div');
            div.className = 'outliner-item';
            if (engine.selectedActor && engine.selectedActor.id === actor.id) {
                div.classList.add('selected');
            }

            const icon = document.createElement('i');
            const obj = actor.object;

            if (actor.type.includes('light') || obj.isLight) {
                div.classList.add('light');
                if (obj.isDirectionalLight) {
                    icon.className = 'fa-solid fa-sun';
                } else if (obj.isSpotLight) {
                    icon.className = 'fa-solid fa-circle-radiation';
                } else {
                    icon.className = 'fa-solid fa-lightbulb';
                }
            } else if (obj.isCamera) {
                div.classList.add('camera');
                icon.className = 'fa-solid fa-video';
            } else if (obj.isGroup || actor.mixer) {
                div.classList.add('glb');
                icon.className = 'fa-solid fa-cubes';
            } else {
                div.classList.add('mesh');
                const geomType = obj.geometry ? obj.geometry.type : '';
                if (geomType === 'BoxGeometry') {
                    icon.className = 'fa-solid fa-cube';
                } else if (geomType === 'SphereGeometry') {
                    icon.className = 'fa-solid fa-circle';
                } else if (geomType === 'CylinderGeometry') {
                    icon.className = 'fa-solid fa-database';
                } else if (geomType === 'PlaneGeometry') {
                    icon.className = 'fa-solid fa-square';
                } else {
                    icon.className = 'fa-solid fa-shapes';
                }
            }

            const label = document.createElement('span');
            label.textContent = actor.name;

            div.appendChild(icon);
            div.appendChild(label);
            div.addEventListener('click', () => {
                engine.selectActor(actor);
            });

            outlinerList.appendChild(div);
        });
    }

    outlinerSearch.addEventListener('input', updateOutliner);

    // Inspector UI Sync

    function updateInspector() {
        if (!engine) return;
        const actor = engine.selectedActor;
        if (!actor) {
            detailsEmpty.classList.remove('hidden');
            detailsContent.classList.add('hidden');
            return;
        }

        detailsEmpty.classList.add('hidden');
        detailsContent.classList.remove('hidden');
        actorTitle.textContent = actor.name;

        engine.syncActorTransformToUI(actor);

        if (actor.type === 'mesh' || !actor.type.includes('light')) {
            sectionLight.classList.add('hidden');

            activeMaterialsList = [];
            if (actor.object.material) {
                activeMaterialsList.push(actor.object.material);
                document.getElementById('group-glb-material-select').classList.add('hidden');
            } else {
                // Scan model children for unique sub-materials
                actor.object.traverse(child => {
                    if (child.isMesh && child.material) {
                        const mats = Array.isArray(child.material) ? child.material : [child.material];
                        mats.forEach(mat => {
                            if (!activeMaterialsList.includes(mat)) {
                                activeMaterialsList.push(mat);
                            }
                        });
                    }
                });

                if (activeMaterialsList.length > 0) {
                    const selectEl = document.getElementById('select-glb-material');
                    selectEl.innerHTML = '';
                    activeMaterialsList.forEach((mat, idx) => {
                        const opt = document.createElement('option');
                        opt.value = idx;
                        opt.textContent = mat.name || `Material ${idx + 1} (${mat.type})`;
                        selectEl.appendChild(opt);
                    });

                    if (selectedMaterialIndex >= activeMaterialsList.length) {
                        selectedMaterialIndex = 0;
                    }
                    selectEl.value = selectedMaterialIndex;
                    document.getElementById('group-glb-material-select').classList.remove('hidden');
                } else {
                    document.getElementById('group-glb-material-select').classList.add('hidden');
                }
            }

            if (activeMaterialsList.length > 0) {
                sectionMaterial.classList.remove('hidden');
                const mat = activeMaterialsList[selectedMaterialIndex];

                const colStr = mat.color ? '#' + mat.color.getHexString() : '#ffffff';
                document.getElementById('mat-color').value = colStr;
                
                const roughness = mat.roughness !== undefined ? mat.roughness : 0.5;
                document.getElementById('mat-roughness').value = roughness;
                document.getElementById('val-roughness').textContent = roughness.toFixed(2);
                
                const metalness = mat.metalness !== undefined ? mat.metalness : 0.0;
                document.getElementById('mat-metalness').value = metalness;
                document.getElementById('val-metalness').textContent = metalness.toFixed(2);

                const emissiveStr = mat.emissive ? '#' + mat.emissive.getHexString() : '#000000';
                document.getElementById('mat-emissive').value = emissiveStr;
                
                const emissiveIntensity = mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 0;
                document.getElementById('mat-emissive-intensity').value = emissiveIntensity;
                document.getElementById('val-emissive-intensity').textContent = emissiveIntensity.toFixed(1);

                const clearcoat = mat.clearcoat !== undefined ? mat.clearcoat : 0;
                document.getElementById('mat-clearcoat').value = clearcoat;
                document.getElementById('val-clearcoat').textContent = clearcoat.toFixed(2);

                const transmission = mat.transmission !== undefined ? mat.transmission : 0;
                document.getElementById('mat-transmission').value = transmission;
                document.getElementById('val-transmission').textContent = transmission.toFixed(2);

                const ior = mat.ior !== undefined ? mat.ior : 1.5;
                document.getElementById('mat-ior').value = ior;
                document.getElementById('val-ior').textContent = ior.toFixed(2);

                const iridescence = mat.iridescence !== undefined ? mat.iridescence : 0;
                document.getElementById('mat-iridescence').value = iridescence;
                document.getElementById('val-iridescence').textContent = iridescence.toFixed(2);
            } else {
                sectionMaterial.classList.add('hidden');
            }
            
        } else if (actor.type === 'light' || actor.type.includes('light')) {
            sectionMaterial.classList.add('hidden');
            sectionLight.classList.remove('hidden');

            const light = actor.object;
            document.getElementById('light-color').value = '#' + light.color.getHexString();
            
            document.getElementById('light-intensity').value = light.intensity;
            document.getElementById('val-light-intensity').textContent = light.intensity.toFixed(1);

            const distGroup = document.getElementById('group-light-distance');
            if (light.distance !== undefined) {
                distGroup.classList.remove('hidden');
                document.getElementById('light-distance').value = light.distance;
            } else {
                distGroup.classList.add('hidden');
            }

            document.getElementById('light-shadows').checked = light.castShadow;

            // Shadow softness
            const shadowRadius = light.shadow.radius !== undefined ? light.shadow.radius : (light.shadow.blurRadius !== undefined ? light.shadow.blurRadius : 4.0);
            document.getElementById('light-shadow-radius').value = shadowRadius;
            document.getElementById('val-light-shadow-radius').textContent = shadowRadius.toFixed(1);
        }
    }

    const updateActorFromInputs = () => {
        const actor = engine.selectedActor;
        if (!actor) return;

        actor.object.position.set(
            parseFloat(document.getElementById('pos-x').value) || 0,
            parseFloat(document.getElementById('pos-y').value) || 0,
            parseFloat(document.getElementById('pos-z').value) || 0
        );

        actor.object.rotation.set(
            (parseFloat(document.getElementById('rot-x').value) || 0) * (Math.PI / 180),
            (parseFloat(document.getElementById('rot-y').value) || 0) * (Math.PI / 180),
            (parseFloat(document.getElementById('rot-z').value) || 0) * (Math.PI / 180)
        );

        actor.object.scale.set(
            parseFloat(document.getElementById('scale-x').value) || 1,
            parseFloat(document.getElementById('scale-y').value) || 1,
            parseFloat(document.getElementById('scale-z').value) || 1
        );

        if (actor.type === 'mesh' || !actor.type.includes('light')) {
            if (activeMaterialsList.length > 0) {
                const mat = activeMaterialsList[selectedMaterialIndex];
                if (mat) {
                    mat.color.set(document.getElementById('mat-color').value);
                    
                    const r = parseFloat(document.getElementById('mat-roughness').value);
                    mat.roughness = r;
                    document.getElementById('val-roughness').textContent = r.toFixed(2);
                    
                    const m = parseFloat(document.getElementById('mat-metalness').value);
                    mat.metalness = m;
                    document.getElementById('val-metalness').textContent = m.toFixed(2);

                    mat.emissive.set(document.getElementById('mat-emissive').value);
                    
                    const emInt = parseFloat(document.getElementById('mat-emissive-intensity').value);
                    mat.emissiveIntensity = emInt;
                    document.getElementById('val-emissive-intensity').textContent = emInt.toFixed(1);

                    const cc = parseFloat(document.getElementById('mat-clearcoat').value);
                    mat.clearcoat = cc;
                    document.getElementById('val-clearcoat').textContent = cc.toFixed(2);

                    const trans = parseFloat(document.getElementById('mat-transmission').value);
                    mat.transmission = trans;
                    document.getElementById('val-transmission').textContent = trans.toFixed(2);

                    const iorVal = parseFloat(document.getElementById('mat-ior').value);
                    mat.ior = iorVal;
                    document.getElementById('val-ior').textContent = iorVal.toFixed(2);

                    const iridVal = parseFloat(document.getElementById('mat-iridescence').value);
                    mat.iridescence = iridVal;
                    document.getElementById('val-iridescence').textContent = iridVal.toFixed(2);
                }
            }
        }

        if (actor.type === 'light' || actor.type.includes('light')) {
            const light = actor.object;
            light.color.set(document.getElementById('light-color').value);
            
            const intensity = parseFloat(document.getElementById('light-intensity').value);
            light.intensity = intensity;
            document.getElementById('val-light-intensity').textContent = intensity.toFixed(1);

            const distanceInput = document.getElementById('light-distance');
            if (light.distance !== undefined) {
                light.distance = parseFloat(distanceInput.value) || 0;
            }

            light.castShadow = document.getElementById('light-shadows').checked;
            
            const shadowRadius = parseFloat(document.getElementById('light-shadow-radius').value);
            light.shadow.radius = shadowRadius;
            light.shadow.blurRadius = shadowRadius; // Support VSM soft maps
            document.getElementById('val-light-shadow-radius').textContent = shadowRadius.toFixed(1);
        }

        engine.resetPathTracing();
    };

    const inputIds = [
        'pos-x', 'pos-y', 'pos-z', 
        'rot-x', 'rot-y', 'rot-z', 
        'scale-x', 'scale-y', 'scale-z',
        'mat-color', 'mat-roughness', 'mat-metalness', 'mat-emissive', 'mat-emissive-intensity', 'mat-clearcoat',
        'mat-transmission', 'mat-ior', 'mat-iridescence',
        'light-color', 'light-intensity', 'light-distance', 'light-shadows', 'light-shadow-radius'
    ];
    inputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', updateActorFromInputs);
            el.addEventListener('change', () => {
                if (engine) engine.saveUndoState();
            });
        }
    });

    document.getElementById('btn-delete-actor').addEventListener('click', () => {
        if (engine.selectedActor) {
            engine.deleteActor(engine.selectedActor);
        }
    });

    // Snapping toggles mapping
    const gridBtn = document.getElementById('toggle-grid-snap');
    const angleBtn = document.getElementById('toggle-angle-snap');
    const scaleBtn = document.getElementById('toggle-scale-snap');

    gridBtn.addEventListener('click', () => {
        engine.toggleSnapping('grid');
        gridBtn.classList.toggle('active', engine.gridSnap);
    });

    angleBtn.addEventListener('click', () => {
        engine.toggleSnapping('angle');
        angleBtn.classList.toggle('active', engine.angleSnap);
    });

    scaleBtn.addEventListener('click', () => {
        engine.toggleSnapping('scale');
        scaleBtn.classList.toggle('active', engine.scaleSnap);
    });

    const gizmoCenterBtn = document.getElementById('toggle-gizmo-center');
    gizmoCenterBtn.addEventListener('click', () => {
        engine.toggleGizmoCenter();
        gizmoCenterBtn.classList.toggle('active', engine.gizmoCentered);
    });

    // Toolbar buttons for transform modes
    const btnSelect = document.getElementById('btn-select');
    const btnTranslate = document.getElementById('btn-translate');
    const btnRotate = document.getElementById('btn-rotate');
    const btnScale = document.getElementById('btn-scale');

    const setTransformMode = (mode) => {
        [btnSelect, btnTranslate, btnRotate, btnScale].forEach(btn => btn.classList.remove('active'));
        if (mode === 'select') {
            btnSelect.classList.add('active');
            engine.transformControls.detach();
        } else {
            if (mode === 'translate') btnTranslate.classList.add('active');
            if (mode === 'rotate') btnRotate.classList.add('active');
            if (mode === 'scale') btnScale.classList.add('active');
            
            engine.transformControls.setMode(mode);
            if (engine.selectedActor) {
                if (engine.gizmoCentered) {
                    const dir = new THREE.Vector3();
                    engine.camera.getWorldDirection(dir);
                    engine.gizmoPivot.position.copy(engine.camera.position).addScaledVector(dir, 8);
                    engine.gizmoPivot.rotation.copy(engine.selectedActor.object.rotation);
                    engine.gizmoPivot.scale.copy(engine.selectedActor.object.scale);
                    engine.transformControls.attach(engine.gizmoPivot);
                } else {
                    engine.transformControls.attach(engine.selectedActor.object);
                }
            }
        }
    };

    btnSelect.addEventListener('click', () => setTransformMode('select'));
    btnTranslate.addEventListener('click', () => setTransformMode('translate'));
    btnRotate.addEventListener('click', () => setTransformMode('rotate'));
    btnScale.addEventListener('click', () => setTransformMode('scale'));

    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (engine) engine.undo();
            return;
        }

        if (document.activeElement.tagName === 'INPUT') return;
        
        switch (e.key.toLowerCase()) {
            case 'q': setTransformMode('select'); break;
            case 'w': setTransformMode('translate'); break;
            case 'e': setTransformMode('rotate'); break;
            case 'r': setTransformMode('scale'); break;
            case 'f':
                if (engine.selectedActor) engine.focusActor(engine.selectedActor);
                break;
            case 'delete':
                if (engine.selectedActor) engine.deleteActor(engine.selectedActor);
                break;
        }
    });

    document.querySelectorAll('.add-actor-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.getAttribute('data-type');
            engine.addActor(type);
        });
    });

    const btnPlay = document.getElementById('btn-play');
    const btnStop = document.getElementById('btn-stop');

    btnPlay.addEventListener('click', () => {
        engine.isPlaying = true;
        btnPlay.classList.add('disabled');
        btnStop.classList.remove('disabled');
    });

    btnStop.addEventListener('click', () => {
        engine.isPlaying = false;
        btnPlay.classList.remove('disabled');
        btnStop.classList.add('disabled');
        
        engine.actors.forEach(actor => {
            if (actor.type === 'mesh' && actor.name !== "Floor Grid") {
                actor.object.rotation.set(0, 0, 0);
            }
        });
        engine.resetPathTracing();
    });

    const selectRenderMode = document.getElementById('select-render-mode');
    selectRenderMode.addEventListener('change', (e) => {
        engine.renderMode = e.target.value;
        engine.resetPathTracing();
    });

    const selectGlbMaterial = document.getElementById('select-glb-material');
    if (selectGlbMaterial) {
        selectGlbMaterial.addEventListener('change', (e) => {
            selectedMaterialIndex = parseInt(e.target.value) || 0;
            updateInspector(); // Refresh the inspector values for the new sub-material
        });
    }

    const maxSamplesInput = document.getElementById('pt-max-samples');
    if (maxSamplesInput) {
        maxSamplesInput.addEventListener('input', (e) => {
            const val = parseInt(e.target.value) || 200;
            engine.maxPtSamples = val;
            engine.resetPathTracing();
        });
    }

    // Camera viewpoints switcher
    const selectCameraView = document.getElementById('select-camera-view');
    selectCameraView.addEventListener('change', (e) => {
        const val = e.target.value;
        engine.orbitControls.reset();
        
        if (val === 'persp') {
            engine.camera.position.set(10, 8, 15);
            engine.camera.lookAt(0, 0, 0);
        } else if (val === 'top') {
            engine.camera.position.set(0, 20, 0);
            engine.camera.lookAt(0, 0, 0);
        } else if (val === 'front') {
            engine.camera.position.set(0, 0, 20);
            engine.camera.lookAt(0, 0, 0);
        }
        engine.resetPathTracing();
    });

    // Menu bar buttons listeners
    document.getElementById('menu-new-scene').addEventListener('click', (e) => {
        e.preventDefault();
        engine.actors.filter(a => a.name !== "Floor Grid").forEach(a => engine.scene.remove(a.object));
        engine.actors = engine.actors.filter(a => a.name === "Floor Grid");
        engine.selectActor(null);
        engine.resetPathTracing();
        clearContentBrowser();
    });

    document.getElementById('menu-reset-scene').addEventListener('click', (e) => {
        e.preventDefault();
        engine.setPreset('studio');
    });

    const sceneFileInput = document.getElementById('scene-file-input');
    
    document.getElementById('menu-save-scene').addEventListener('click', (e) => {
        e.preventDefault();
        const json = engine.exportSceneJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'level_scene.json';
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    document.getElementById('menu-load-scene').addEventListener('click', (e) => {
        e.preventDefault();
        if (sceneFileInput) sceneFileInput.click();
    });

    if (sceneFileInput) {
        sceneFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                const file = e.target.files[0];
                const reader = new FileReader();
                reader.onload = (event) => {
                    clearContentBrowser();
                    engine.importSceneJSON(event.target.result);
                    sceneFileInput.value = ''; // Reset uploader input
                };
                reader.readAsText(file);
            }
        });
    }

    document.getElementById('menu-delete-selected').addEventListener('click', (e) => {
        e.preventDefault();
        if (engine.selectedActor) engine.deleteActor(engine.selectedActor);
    });

    document.getElementById('menu-about').addEventListener('click', (e) => {
        e.preventDefault();
        alert('Web Engine 5 v1.0.0\nBuilt with Three.js & Custom GLSL Path Tracer Denoised');
    });

    // Tabs switching
    document.querySelectorAll('#bottom-panel .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#bottom-panel .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('#bottom-panel .tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // Bind preset cards
    document.querySelectorAll('.preset-card').forEach(card => {
        card.addEventListener('click', () => {
            const preset = card.getAttribute('data-preset');
            if (preset) {
                engine.setPreset(preset);
            }
        });
    });

    // Bind material presets
    document.querySelectorAll('.material-preset-card').forEach(card => {
        card.addEventListener('click', () => {
            const matPreset = card.getAttribute('data-matpreset');
            engine.applyMaterialPreset(matPreset);
        });
    });

    // Env and Post-process settings
    const envSunPitch = document.getElementById('env-sun-pitch');
    const envFogDensity = document.getElementById('env-fog-density');
    const envFogColor = document.getElementById('env-fog-color');
    const envAmbientIntensity = document.getElementById('env-ambient-intensity');
    const envBloomIntensity = document.getElementById('env-bloom-intensity');
    const envSSAOIntensity = document.getElementById('env-ssao-intensity');
    const envVignette = document.getElementById('env-vignette');
    const envHdrIntensity = document.getElementById('env-hdr-intensity');
    const envHdrRotation = document.getElementById('env-hdr-rotation');


    if (envHdrIntensity) {
        envHdrIntensity.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            engine.hdrIntensity = val;
            document.getElementById('val-hdr-intensity').textContent = val.toFixed(2);
            engine.updateEnvironment();
        });
    }

    if (envHdrRotation) {
        envHdrRotation.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            engine.hdrRotation = val;
            document.getElementById('val-hdr-rotation').textContent = `${val}°`;
            engine.updateEnvironment();
        });
    }

    envSunPitch.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        engine.sunPitch = val;
        document.getElementById('val-sun-pitch').textContent = `${val}°`;
        engine.updateSunPosition();
    });

    envFogDensity.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        engine.fogDensity = val;
        document.getElementById('val-fog-density').textContent = val.toFixed(3);
        engine.updateEnvironment();
    });

    if (envFogColor) {
        envFogColor.addEventListener('input', (e) => {
            engine.fogColor = e.target.value;
            engine.updateEnvironment();
        });
        envFogColor.addEventListener('change', () => {
            if (engine) engine.saveUndoState();
        });
    }

    envAmbientIntensity.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        engine.ambientIntensity = val;
        document.getElementById('val-ambient-intensity').textContent = val.toFixed(2);
        engine.updateEnvironment();
    });

    envBloomIntensity.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        engine.bloomIntensity = val;
        document.getElementById('val-bloom-intensity').textContent = val.toFixed(1);
        engine.updateEnvironment();
    });

    envSSAOIntensity.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        engine.ssaoIntensity = val;
        document.getElementById('val-ssao-intensity').textContent = val.toFixed(1);
        engine.updateEnvironment();
    });

    const envSsaoEnabled = document.getElementById('env-ssao-enabled');
    if (envSsaoEnabled) {
        envSsaoEnabled.addEventListener('change', (e) => {
            engine.ssaoEnabled = e.target.checked;
            engine.updateEnvironment();
        });
    }

    const envSsaoRadius = document.getElementById('env-ssao-radius');
    if (envSsaoRadius) {
        envSsaoRadius.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            engine.ssaoRadius = val;
            document.getElementById('val-ssao-radius').textContent = val.toFixed(3);
            engine.updateEnvironment();
        });
    }

    envVignette.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        engine.vignetteStrength = val;
        document.getElementById('val-vignette').textContent = val.toFixed(1);
        engine.updateEnvironment();
    });

    // Animation Sequencer Logic
    const seqRecordBtn = document.getElementById('seq-record');
    const seqPlayBtn = document.getElementById('seq-play');
    const seqStopBtn = document.getElementById('seq-stop');
    const seqLoopBtn = document.getElementById('seq-loop');
    const seqClearBtn = document.getElementById('seq-clear');
    
    const seqKeysCount = document.getElementById('seq-keys-count');
    const seqStatus = document.getElementById('seq-playback-status');
    const timelineKeyframes = document.getElementById('timeline-keyframes-container');

    const redrawTimelineDots = () => {
        timelineKeyframes.innerHTML = '';
        engine.keyframes.forEach(k => {
            const dot = document.createElement('div');
            dot.className = 'keyframe-dot';
            dot.style.left = `${k.time}%`;
            timelineKeyframes.appendChild(dot);
        });
        seqKeysCount.textContent = engine.keyframes.length;
    };

    seqRecordBtn.addEventListener('click', () => {
        const actor = engine.selectedActor;
        if (!actor) {
            alert('Please select an actor to record keyframes for.');
            return;
        }

        // Check if keyframe already exists at this exact seqTime, if so overwrite
        engine.keyframes = engine.keyframes.filter(k => !(k.actorId === actor.id && Math.abs(k.time - engine.seqTime) < 0.5));

        // Stash target transform states
        engine.keyframes.push({
            actorId: actor.id,
            time: engine.seqTime,
            pos: actor.object.position.clone(),
            rot: actor.object.rotation.clone(),
            scl: actor.object.scale.clone()
        });

        redrawTimelineDots();
    });

    seqPlayBtn.addEventListener('click', () => {
        if (engine.keyframes.length === 0) {
            alert('No keyframes recorded. Record some keyframes first!');
            return;
        }
        engine.isSeqPlaying = true;
        seqStatus.textContent = 'Playing';
        seqPlayBtn.classList.add('active');
        seqStopBtn.classList.remove('active');
    });

    seqStopBtn.addEventListener('click', () => {
        engine.isSeqPlaying = false;
        seqStatus.textContent = 'Stopped';
        seqPlayBtn.classList.remove('active');
        seqStopBtn.classList.add('active');
    });

    seqLoopBtn.addEventListener('click', () => {
        engine.seqLoop = !engine.seqLoop;
        seqLoopBtn.classList.toggle('active', engine.seqLoop);
    });

    seqClearBtn.addEventListener('click', () => {
        engine.keyframes = [];
        engine.seqTime = 0;
        document.getElementById('timeline-playhead').style.left = '0%';
        redrawTimelineDots();
        engine.isSeqPlaying = false;
        seqStatus.textContent = 'Stopped';
        seqPlayBtn.classList.remove('active');
        seqStopBtn.classList.remove('active');
    });

    // GLB Importer triggers (Loads to Asset Library instead of spawning immediately)
    const btnImportGlb = document.getElementById('btn-import-glb');
    const glbFileInput = document.getElementById('glb-file-input');

    if (btnImportGlb && glbFileInput) {
        btnImportGlb.addEventListener('click', (e) => {
            e.preventDefault();
            glbFileInput.click();
        });
        glbFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                const files = Array.from(e.target.files);
                let processedCount = 0;
                files.forEach(file => {
                    const reader = new FileReader();
                    reader.readAsArrayBuffer(file);
                    reader.onload = (event) => {
                        const buffer = event.target.result;
                        window.assetLibrary[file.name] = buffer;

                        // Save to IndexedDB for persistence
                        saveAssetToDB(file.name, buffer).then(() => {
                            console.log(`[IndexedDB] Saved asset "${file.name}" to database.`);
                        }).catch(err => {
                            console.error(`[IndexedDB] Failed to save asset "${file.name}":`, err);
                        });

                        // Create Asset card in Content Browser UI
                        createAssetCard(file.name);
                        
                        processedCount++;
                        // Automatically scan and replace placeholders of this asset inside the scene
                        if (processedCount === files.length) {
                            replacePlaceholdersInScene();
                        }
                    };
                });
                glbFileInput.value = ''; // Reset uploader input
            }
        });
    }

    // Viewport drag and drop drop listeners
    // Viewport drag and drop drop listeners (targeted to viewport-container to avoid overlay blocking)
    const viewport = document.getElementById('viewport-container');
    if (viewport) {
        viewport.addEventListener('dragover', (e) => {
            e.preventDefault(); // Enable drop cursor
        });
        viewport.addEventListener('drop', (e) => {
            e.preventDefault();
            const fileName = e.dataTransfer.getData('text/plain');
            if (fileName && window.assetLibrary[fileName]) {
                engine.spawnAssetAtViewportCoords(fileName, window.assetLibrary[fileName], e.clientX, e.clientY);
            }
        });
    }

    // HDR Environment Importer triggers
    const btnUploadHdr = document.getElementById('btn-upload-hdr');
    const hdrFileInput = document.getElementById('hdr-file-input');
    if (btnUploadHdr && hdrFileInput) {
        btnUploadHdr.addEventListener('click', (e) => {
            e.preventDefault();
            hdrFileInput.click();
        });
        hdrFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                engine.loadHDR(e.target.files[0]);
                hdrFileInput.value = ''; // reset so the same file can be uploaded again
            }
        });
    }
});
