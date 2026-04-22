import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// Extend THREE classes with BVH methods
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export class GameManager {
    constructor(app) {
        this.app = app;
        this.isPlaying = false;
        this.isEndScreen = false;
        this._endScreenDismissRegistered = false;
        this.sessionId = 0; // Incremented each time a new game session starts
        this.player = null;
        this.mixer = null;
        this.actions = {};
        this.activeAction = null;
        this.keys = new Set();
        this.clock = new THREE.Clock();
        this.velocity = new THREE.Vector3();
        this.onGround = false;
        this.gravity = -35;
        this.cameraOffset = new THREE.Vector3(0, 3, -5);
        this.gameCameraObj = null;
        this.score = 0;
        this.lives = 3;
        this.raycaster = new THREE.Raycaster();
        this.raycaster.firstHitOnly = true; // Optimization for BVH
        this.powerups = [];
        this.bullets = [];
        this.translatingObjects = [];
        this.enemyMixers = [];
        this.enemyRuntimeData = new Map();
        this.bonusRuntimeData = new Map();
        this.initialStates = [];
        this.onKeyDown = (e) => {
            // console.log("Key Down:", e.key);
            if (e.key === 'Escape') {
                this.stop();
                const btnPlay = document.getElementById('btn-play');
                if (btnPlay) btnPlay.classList.remove('play-active');
                return;
            }
            this.keys.add(e.key.toLowerCase());
        };
        this.onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
        this.onBlur = () => this.keys.clear();
        this.firstFrame = false;
        this.mouseRotation = new THREE.Vector2();

        this.onMouseMove = (e) => {
            if (!this.isPlaying) return;

            // Check if we are in a mouse-controlled camera mode
            const type = this.gameCameraObj?.userData.type;
            if (type !== 'TPS' && type !== 'FPS') return;

            const mx = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
            const my = e.movementY || e.mozMovementY || e.webkitMovementY || 0;

            this.mouseRotation.x -= mx * 0.002;
            this.mouseRotation.y -= my * 0.002;

            this.mouseRotation.y = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, this.mouseRotation.y));
        };

        this.onMouseDown = (e) => {
            if (!this.isPlaying) return;
            const key = 'mouse' + e.button;
            this.keys.add(key);

            if (this.gameCameraObj?.userData.type === 'TPS' || this.gameCameraObj?.userData.type === 'FPS') {
                if (document.pointerLockElement !== this.app.sceneManager.renderer.domElement) {
                    try {
                        const promise = this.app.sceneManager.renderer.domElement.requestPointerLock();
                        if (promise && promise.catch) promise.catch(() => { }); // Ignore exit errors
                    } catch (err) { }
                }
            }
        };
        this.onMouseUp = (e) => {
            const key = 'mouse' + e.button;
            this.keys.delete(key);
        };
        this.lanternCooldownTimer = 0;
        this.flyTimer = null;
    }

    start(index = -1) {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.firstFrame = true;
        this.sessionId++; // New session — invalidates any stale async loadLevel() continuations
        this.score = 0; this.lives = 3;
        this.velocity.set(0, 0, 0);
        this.onGround = false;
        this.invulnerabilityTimer = 0;

        // ---- SPLASH SCREEN & LEVEL SETUP ----
        let levelIndex = index;
        if (levelIndex < 0) levelIndex = this.app.editor.currentLevelIndex;
        // Final fallback to starting level if still nothing
        if (levelIndex < 0 && this.app.editor.levels.length > 0) {
            levelIndex = this.app.editor.startingLevelIndex;
        }

        this.jumpCount = 0;
        this.lastMoveDir = 1; // 1 for right, -1 for left
        this.initialStates = [];
        this.playStartStates = []; // New array for Z-lock reference during play
        this.lanternCooldownTimer = 0;
        this.actionLocked = false;
        this.invulnerabilityTimer = 0;
        if (this.flyTimer) clearTimeout(this.flyTimer);
        this.flyTimer = null;

        this.editorCameraState = {
            position: this.app.sceneManager.camera.position.clone(),
            quaternion: this.app.sceneManager.camera.quaternion.clone()
        };

        this.app.editor.objects.forEach(o => {
            // Safety: Break any existing cycles
            let p = o.parent;
            while (p) { if (p === o) { o.removeFromParent(); break; } p = p.parent; }

            try { o.updateMatrixWorld(true); } catch (e) { console.warn("Error updating matrix for", o.name); }
            const state = {
                uuid: o.uuid,
                p: o.position.clone(),
                r: o.rotation.clone(),
                s: o.scale.clone(),
                visible: o.visible,
                // Save important userData flags that might change
                isAsset: o.userData.isAsset
            };
            this.initialStates.push(state);
            this.playStartStates.push({ uuid: o.uuid, p: o.position.clone() }); // Copy of start position

            // Compute BVH for static meshes (exclude player/helpers)
            if (o.isMesh && !o.userData.isPlayer && !o.userData.isHelper && !o.userData.isCamera && o.userData.type !== 'SplatEnv') {
                if (!o.geometry || !o.geometry.attributes.position) {
                    console.warn(`Object ${o.name} has no position attributes, skipping BVH.`);
                } else if (!o.geometry.boundsTree) {
                    o.geometry.computeBoundsTree();
                }
            }

            // Hide Hitboxes for GLB wrappers
            if (o.userData.glbSource && o.material) {
                if (o.userData.type === 'Enemy' || o.userData.type === 'Boss') {
                    // Check for tiny scale (invisible killer)
                    if (o.scale.lengthSq() < 0.01) {
                        console.warn(`Enemy ${o.name} has near-zero scale! Resetting to 1.`);
                        o.scale.set(1, 1, 1);
                    }

                    // For Enemies, show faint wireframe so user sees the "Ghost" if GLB is broken
                    o.material.visible = true;
                    o.material.wireframe = true;
                    o.material.transparent = true;
                    o.material.opacity = 0.5; // Increased visibility
                } else {
                    o.material.visible = false;
                }
            }

            // Hide Catchers (Base & Target) - ghost behavior
            if (o.userData.type === 'catcher_base' || o.userData.type === 'catcher_target' || o.userData.type === 'Catcher' || o.userData.type === 'Collision') {
                o.visible = false;
            }

            // Hide ArrowHelpers
            const arrow = o.getObjectByName('ArrowHelper');
            if (arrow) arrow.visible = false;

            this.safeTraverse(o, child => {
                if (child.isMesh && !child.userData.isPlayer && !child.userData.isHelper && o.userData.type !== 'SplatEnv') {
                    if (child.geometry && child.geometry.attributes.position && !child.geometry.boundsTree) {
                        child.geometry.computeBoundsTree();
                    }
                }
            });

            // Reset runtime-only flags that must never persist from a previous session
            if (o.userData.type === 'Goal') o.userData.triggered = false;
            if (o.userData.type === 'Collision') o.userData.triggered = false;
        });

        // Hide Link Arrows
        if (this.app.editor.linkGroup) this.app.editor.linkGroup.visible = false;

        // Prioritize selected object if it is a player, otherwise find first player
        const selected = this.app.editor.selected;
        this.player = (selected && selected.userData.isPlayer) ? selected : this.app.editor.objects.find(o => o.userData.isPlayer);

        this.gameCameraObj = (selected && selected.userData.isCamera) ? selected : this.app.editor.objects.find(o => o.userData.isCamera);

        if (this.gameCameraObj) {
            const cam = this.app.sceneManager.camera;
            this.gameCameraObj.updateMatrixWorld(true);
            cam.position.copy(this.gameCameraObj.position);
            cam.quaternion.copy(this.gameCameraObj.quaternion);
            cam.fov = this.gameCameraObj.userData.fov || 60;
            cam.updateProjectionMatrix();
            this.gameCameraObj.visible = false;
            if (this.player) {
                this.cameraOffset = this.gameCameraObj.position.clone().sub(this.player.position);
                if (this.gameCameraObj.userData.type !== '8WAY') {
                    const invRotation = this.player.quaternion.clone().invert();
                    this.cameraOffset.applyQuaternion(invRotation);
                }
            }
        }

        if (this.player) {
            const model = this.player.getObjectByName('model');
            if (model) {
                model.traverse(child => { if (child.isMesh) child.frustumCulled = false; });
                this.mixer = new THREE.AnimationMixer(model);
                (this.player.animations || []).forEach(clip => { this.actions[clip.name] = this.mixer.clipAction(clip); });

                // Pre-play Idle animation to avoid T-pose on first frame
                const u = this.player.userData;
                const idleAction = (u.actions || []).find(a => a.type === 'Idle' && a.anim && a.active);
                if (idleAction && this.actions[idleAction.anim]) {
                    this.activeAction = this.actions[idleAction.anim];
                    this.activeAction.play();
                    this.mixer.update(0);
                }
            }
        }

        // Reset Fly Mode State (Moved after player discovery)
        if (this.player) {
            this.player.userData.mode = 'normal';
            this.player.userData.flyAnim = null;
            this.player.userData.startFlyY = undefined;
            this.player.userData.featherFall = false;
        }

        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mouseup', this.onMouseUp);
        window.addEventListener('blur', this.onBlur);

        if (this.gameCameraObj?.userData.type === 'TPS' || this.gameCameraObj?.userData.type === 'FPS') {
            try {
                const promise = this.app.sceneManager.renderer.domElement.requestPointerLock();
                if (promise && promise.catch) promise.catch(() => { }); // Ignore exit errors
            } catch (err) {
                console.warn('[GameManager] requestPointerLock blocked without user gesture.');
            }

            // Sync initial mouse rotation from Camera's editor position relative to player
            if (this.player && this.gameCameraObj) {
                const relPos = this.gameCameraObj.position.clone().sub(this.player.position);
                this.cameraDistance = relPos.length();

                // Yaw (X) around Y axis, Pitch (Y) around X axis
                this.mouseRotation.x = Math.atan2(relPos.x, relPos.z);
                const ratio = relPos.y / Math.max(this.cameraDistance, 0.1);
                this.mouseRotation.y = -Math.asin(Math.max(-1, Math.min(1, ratio)));
            }
        }

        this.app.editor.gizmo.detach();
        this.app.editor.enableOrbit(false);
        this.app.sceneManager.scene.children.forEach(c => { if (c.type === 'GridHelper') c.visible = false; });

        this.app.ui.setFullScreen(true);

        const hud = document.getElementById('game-hud');
        if (hud) hud.classList.remove('hidden');
        this.updateHUD();

        // Enemy & Bonus Setup
        this.enemyMixers = [];
        this.enemyRuntimeData.clear();
        this.bonusRuntimeData.clear();
        this.translatingObjects = [];

        this.app.editor.objects.forEach(o => {
            if (o.userData.type === 'Enemy') {
                const model = o.getObjectByName('model');
                let mixer = null;
                let startAnim = null;
                const animations = o.animations || (model ? model.animations : []);

                if (model && animations && animations.length > 0) {
                    mixer = new THREE.AnimationMixer(model);
                    this.enemyMixers.push(mixer);

                    startAnim = o.userData.animIdle;

                    if (startAnim) {
                        const clip = animations.find(c => c.name === startAnim);
                        if (clip) {
                            mixer.clipAction(clip).play();
                            mixer.update(0);
                        }
                    }
                }

                // Initialize runtime data
                this.enemyRuntimeData.set(o.uuid, {
                    patrolDir: 1,
                    initialPos: o.position.clone(),
                    initialRot: o.rotation.clone(),
                    velocity: new THREE.Vector3(0, 0, 0),
                    mixer: mixer,
                    frozen: !!o.userData.isFrozen,
                    currentAnim: startAnim
                });
            } else if (o.userData.type === 'Bonus') {
                o.userData.collected = false;
                const model = o.getObjectByName('model');
                let mixer = null;
                const animations = o.animations || (model ? model.animations : []);
                if (model && animations && animations.length > 0) {
                    mixer = new THREE.AnimationMixer(model);
                    this.enemyMixers.push(mixer); // Reuse enemyMixers array for all non-player mixers

                    if (o.userData.animIdle) {
                        const clip = animations.find(c => c.name === o.userData.animIdle);
                        if (clip) {
                            mixer.clipAction(clip).play();
                            mixer.update(0);
                        }
                    }
                }

                this.bonusRuntimeData.set(o.uuid, {
                    patrolDir: 1,
                    initialPos: o.position.clone(),
                    mixer: mixer
                });
            } else if (o.userData.type === 'Model') {
                // Generic Model Animation
                const model = o.getObjectByName('model');
                const animations = o.animations || (model ? model.animations : []);
                if (model && animations.length > 0) {
                    const mixer = new THREE.AnimationMixer(model);
                    this.enemyMixers.push(mixer);
                    if (o.userData.defaultAnim) {
                        const clip = animations.find(c => c.name === o.userData.defaultAnim);
                        if (clip) {
                            mixer.clipAction(clip).play();
                            mixer.update(0);
                        }
                    }
                }
            } else if (o.userData.type === 'PowerUp') {
                o.userData.isAsset = true; // Ensure it's active for collection
                const model = o.getObjectByName('model');
                const animations = o.animations || (model ? model.animations : []);
                if (model && animations && animations.length > 0) {
                    const mixer = new THREE.AnimationMixer(model);
                    this.enemyMixers.push(mixer);
                    if (o.userData.defaultAnim) {
                        const clip = animations.find(c => c.name === o.userData.defaultAnim);
                        if (clip) {
                            mixer.clipAction(clip).play();
                            mixer.update(0);
                        }
                    }
                }
            } else if (o.userData.type === 'Collision') {
                o.userData.triggered = false;
            }
        });

        this.clock.start();

        // ---- SPLASH SCREEN ----
        // levelIndex is already defined at the top of start()
        const levelData = (levelIndex >= 0) ? this.app.editor.levels[levelIndex] : null;
        const splashEl = document.getElementById('game-splash');
        const splashTitle = document.getElementById('splash-title');
        const splashSubtitle = document.querySelector('#game-splash .splash-subtitle');
        const splashLevelName = document.getElementById('splash-level-name');
        const splashPrompt = document.querySelector('#game-splash .splash-prompt');

        if (splashEl) {
            if (splashTitle) splashTitle.textContent = this.app.editor.gameTitle || 'Web 3D Game';
            if (splashSubtitle) splashSubtitle.textContent = this.app.editor.gameSplashSubtitle || '3D Editor Engine';
            if (splashLevelName) splashLevelName.textContent = levelData ? levelData.name : '';
            
            if (splashPrompt) {
                splashPrompt.style.backgroundColor = this.app.editor.gameSplashPromptBg || 'rgba(255,255,255,0.1)';
                splashPrompt.style.color = this.app.editor.gameSplashPromptColor || '#ffffff';
            }
            
            // Apply splash background image
            if (this.app.editor.gameSplashImage) {
                splashEl.style.backgroundImage = `url(${this.app.editor.gameSplashImage})`;
            } else {
                splashEl.style.backgroundImage = '';
            }

            splashEl.classList.remove('hidden', 'splash-fade-out');
            this.splashActive = true;

            // Start Splash Music
            if (this.app.editor.gameSplashMusic) {
                this.playSplashMusic(this.app.editor.gameSplashMusic);
            }

            const dismissSplash = (e) => {
                if (!this.splashActive) return;
                this.splashActive = false;
                splashEl.classList.add('splash-fade-out');
                setTimeout(() => splashEl.classList.add('hidden'), 420);
                window.removeEventListener('keydown', dismissSplash);
                window.removeEventListener('pointerdown', dismissSplash);

                this.stopSplashMusic();

                // Start Level BGM after splash dismissed
                const bgm = levelData?.music;
                if (bgm) this.playBGM(bgm);
            };
            // Delay so the keydown that triggered start() doesn't immediately dismiss
            setTimeout(() => {
                window.addEventListener('keydown', dismissSplash);
                window.addEventListener('pointerdown', dismissSplash);
            }, 300);
        } else {
            // No splash: start BGM immediately
            const bgm = levelData?.music;
            if (bgm) this.playBGM(bgm);
        }
    }

    safeTraverse(obj, callback) {
        if (!obj) return;
        const stack = [obj];
        const seen = new Set();
        while (stack.length > 0) {
            const node = stack.pop();
            if (seen.has(node)) continue;
            seen.add(node);
            callback(node);
            if (node.children) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push(node.children[i]);
                }
            }
        }
    }

    getCollisionBox(obj) {
        const box = new THREE.Box3();
        const seen = new Set();
        // Permissive filter: include meshes even if invisible (common for triggers/zones)
        // But still exclude helper objects
        const filter = (o) => o.name !== 'ArrowHelper' && !o.userData.isHelper;

        const expand = (o) => {
            if (seen.has(o)) return;
            seen.add(o);

            if (!filter(o)) return;

            // Exclude GLB Wrapper Box (which is made invisible in start) from collision
            // We want to collide with the inner Model for Enemies (precise hitbox),
            // BUT keep the big box for PowerUps/Bonuses (easier pickup)
            let skipGeometry = false;
            const u = o.userData || {};
            if (u.glbSource && o.material && o.material.visible === false) {
                // Only skip for HOSTILE types where precision matters
                if (u.type === 'Enemy' || u.type === 'Boss') {
                    skipGeometry = true;
                }
            }
            if (o.userData.type === 'SplatEnv') return;

            if (!skipGeometry && o.isMesh && o.geometry) {
                if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
                box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
            }

            // For Player, use ONLY the main Capsule/Box wrapper for collision.
            // Do NOT include children (GLB models, attachments) because they might have
            // oversized bounding boxes (artifacts) or extend the hitbox unfairly.
            if (o.userData.isPlayer) return;

            const children = o.children;
            for (let i = 0; i < children.length; i++) {
                expand(children[i]);
            }
        };

        expand(obj);
        return box;
    }

    showMessage(text, duration = 5000) {
        let balloon = document.getElementById('game-msg-balloon');
        if (!balloon) {
            balloon = document.createElement('div');
            balloon.id = 'game-msg-balloon';
            balloon.className = 'msg-balloon';
            document.body.appendChild(balloon);
        }

        balloon.innerText = text;
        balloon.classList.add('show');

        if (this.msgTimeout) clearTimeout(this.msgTimeout);
        this.msgTimeout = setTimeout(() => {
            balloon.classList.remove('show');
        }, duration);
    }

    stop() {
        if (!this.isPlaying && !this.isEndScreen) return;
        this._stopInternal();
    }

    // Internal cleanup — works regardless of isPlaying / isEndScreen state
    _stopInternal() {
        this.isPlaying = false;
        this.isEndScreen = false;
        this._endScreenDismissRegistered = false;

        if (this.flyTimer) clearTimeout(this.flyTimer);
        this.flyTimer = null;
        this.initialStates.forEach(state => {
            const obj = this.app.editor.objects.find(o => o.uuid === state.uuid);
            if (obj) {
                obj.position.copy(state.p); obj.rotation.copy(state.r); obj.scale.copy(state.s); obj.visible = state.visible;
                if (state.isAsset !== undefined) obj.userData.isAsset = state.isAsset;

                if (obj.userData.type === 'Bonus') obj.userData.collected = false;
                if (obj.userData.type === 'PowerUp') obj.userData.collected = false;
                if (obj.userData.type === 'Collision') obj.userData.triggered = false;
                if (obj.userData.type === 'Goal') obj.userData.triggered = false;

                if (obj.userData.glbSource && obj.material) obj.material.visible = true;
                if (obj.parent !== this.app.sceneManager.scene) this.app.sceneManager.scene.add(obj);

                const arrow = obj.getObjectByName('ArrowHelper');
                if (arrow) arrow.visible = true;
            }
        });
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('mousedown', this.onMouseDown);
        window.removeEventListener('mouseup', this.onMouseUp);
        window.removeEventListener('blur', this.onBlur);
        document.exitPointerLock?.();

        if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }

        this.enemyMixers.forEach(m => m.stopAllAction());
        this.enemyMixers = [];
        this.bullets.forEach(b => { if (b.mesh.parent) b.mesh.parent.remove(b.mesh); });
        this.bullets = [];
        this.enemyRuntimeData.clear();
        this.bonusRuntimeData.clear();
        this.translatingObjects = [];

        this.actions = {}; this.activeAction = null; this.keys.clear();
        this.app.editor.enableOrbit(true);
        this.app.sceneManager.scene.children.forEach(c => { if (c.type === 'GridHelper') c.visible = true; });

        if (this.app.editor.linkGroup) this.app.editor.linkGroup.visible = true;

        if (this.editorCameraState) {
            this.app.sceneManager.camera.position.copy(this.editorCameraState.position);
            this.app.sceneManager.camera.quaternion.copy(this.editorCameraState.quaternion);
            this.app.editor.orbit.update();
        }

        if (this.gameCameraObj) this.gameCameraObj.visible = true;
        this.gameCameraObj = null;

        const hud = document.getElementById('game-hud');
        if (hud) hud.classList.add('hidden');

        const splashEl = document.getElementById('game-splash');
        if (splashEl) splashEl.classList.add('hidden');
        this.splashActive = false;

        this.stopBGM();
        this.stopSplashMusic();

        this.app.ui.setFullScreen(false);
    }

    updateHUD() {
        const scoreEl = document.getElementById('hud-score');
        const livesEl = document.getElementById('hud-lives');
        if (scoreEl) scoreEl.innerText = `Score: ${this.score}`;
        if (livesEl) {
            const hearts = livesEl.querySelectorAll('.heart');
            hearts.forEach((h, i) => {
                if (i < this.lives) h.classList.remove('lost');
                else h.classList.add('lost');
            });
        }
    }

    update(dt) { // Fixed signature in replacement block if needed, but context matching is key
        if (!this.isPlaying || !this.player) return;
        const _dt = Math.min(this.clock.getDelta(), 0.05);

        if (this.lanternCooldownTimer > 0) this.lanternCooldownTimer -= _dt;
        if (this.invulnerabilityTimer > 0) this.invulnerabilityTimer -= _dt;

        this.updateTranslations(_dt);
        this.handlePlayerInput(_dt);
        this.updateCamera();
        this.updateGameLogic(_dt);

        if (!this.isPlaying) return;

        this.updateEnemies(_dt);
        this.updateBonuses(_dt);
        this.updateCatchers(_dt);
        this.updateBullets(_dt);
        if (this.mixer) this.mixer.update(_dt);
        this.firstFrame = false;
    }

    updateTranslations(dt) {
        for (let i = this.translatingObjects.length - 1; i >= 0; i--) {
            const t = this.translatingObjects[i];
            const obj = t.object;
            const dist = obj.position.distanceTo(t.target);

            if (dist < 0.1) {
                obj.position.copy(t.target);
                obj.rotation.copy(t.targetRotation);

                if (obj === this.player) {
                    const state = this.playStartStates.find(s => s.uuid === obj.uuid);
                    if (state) state.p.copy(obj.position);
                }

                if (obj.userData.type === 'Enemy') {
                    const runtime = this.enemyRuntimeData.get(obj.uuid);
                    if (runtime) {
                        runtime.velocity.set(0, 0, 0);
                        runtime.initialPos.copy(obj.position);
                    }
                }
                this.translatingObjects.splice(i, 1);
            } else {
                const moveDist = t.speed * dt;
                const dir = t.target.clone().sub(obj.position).normalize();
                obj.position.add(dir.multiplyScalar(Math.min(moveDist, dist)));

                const targetQuat = new THREE.Quaternion().setFromEuler(t.targetRotation);
                obj.quaternion.slerp(targetQuat, 0.1);
            }
        }
    }

    useLantern(lanternObj) {
        // console.log("useLantern CALLED");

        this.lanternCooldownTimer = 4.0;

        // Show Lantern
        lanternObj.visible = true;

        const ox = lanternObj.userData.equipOffsetX !== undefined ? parseFloat(lanternObj.userData.equipOffsetX) : 0.5;
        const oy = lanternObj.userData.equipOffsetY !== undefined ? parseFloat(lanternObj.userData.equipOffsetY) : 1.0;
        const oz = lanternObj.userData.equipOffsetZ !== undefined ? parseFloat(lanternObj.userData.equipOffsetZ) : 0.5;

        // Restore -ox because +ox is Left. We want Right.
        lanternObj.position.set(-ox, oy, oz);

        if (lanternObj.userData.equipRotation) {
            lanternObj.rotation.fromArray(lanternObj.userData.equipRotation);
        } else {
            lanternObj.rotation.set(0, 0, 0);
        }

        // CRITICAL: Update matrix to ensure getWorldPosition uses the new coordinates immediately
        lanternObj.updateMatrixWorld(true);

        this.safeTraverse(lanternObj, c => { c.visible = true; });

        // Hide after 1 second
        setTimeout(() => {
            if (lanternObj.parent) {
                lanternObj.visible = false;
            }
        }, 1000);

        // 1. Visual Beam (Cone) - Parented to Lantern for correct position/rotation
        const range = 6.0; // Increased to 6.0 based on user feedback
        const angle = Math.PI / 6;

        // Cone Geometry
        const radius = range * Math.tan(angle / 2);
        const geometry = new THREE.ConeGeometry(radius, range, 32, 1, true);

        // Align Cone with +Z (Forward)
        // Tip at 0, Base at +range
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, 0, range / 2);

        const material = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        const beam = new THREE.Mesh(geometry, material);

        // Add to Lantern so it follows pos/rot perfectly
        lanternObj.add(beam);

        // User requested 180 rotation on Y relative to lantern
        beam.rotation.y = Math.PI / 2;
        beam.updateMatrixWorld(true); // Ensure rotation is applied for direction calculation

        // Remove beam after 0.5s
        setTimeout(() => {
            if (beam.parent) beam.parent.remove(beam);
        }, 500);

        // 2. Hit Detection (Use World Space for calculation)
        const spawnPos = new THREE.Vector3();
        beam.getWorldPosition(spawnPos); // Use Beam origin (should be same as lantern)

        const dir = new THREE.Vector3(0, 0, 1); // Beam Geometry points +Z
        dir.transformDirection(beam.matrixWorld).normalize();

        const enemies = this.app.editor.objects.filter(o => o.userData.type === 'Enemy' && o.parent);

        // Cone math: Distance from Point to Line (Beam Axis)
        // We treat the beam as a cone volume.
        // Radius at distance d = d * tan(angle/2)
        const tanHalfAngle = Math.tan(angle / 2);

        const cosAngle = Math.cos(angle / 2);
        const freezeDuration = lanternObj.userData.lanternFreezeDuration || 5.0;

        enemies.forEach(enemy => {
            // Flatten positions to XZ plane for easier aiming (ignore height diff)
            const flatEnemyPos = new THREE.Vector3(enemy.position.x, 0, enemy.position.z);
            const flatSpawnPos = new THREE.Vector3(spawnPos.x, 0, spawnPos.z);
            const flatDir = new THREE.Vector3(dir.x, 0, dir.z).normalize();

            // Check vertical distance separately (increase tolerance)
            if (Math.abs(enemy.position.y - spawnPos.y) > 5.0) return;

            const toEnemy = flatEnemyPos.clone().sub(flatSpawnPos);
            const dist = toEnemy.length();

            if (dist <= range + 2.0) {
                // Project toEnemy onto dir to get distance along axis
                const distAlongAxis = toEnemy.dot(flatDir);

                // Debug Collision Math
                console.log(`Check ${enemy.name}: DistAxis=${distAlongAxis.toFixed(2)}, Range=${range}`);

                if (distAlongAxis > 0 && distAlongAxis <= range) {
                    // Calculate closest point on axis
                    const closestPointOnAxis = flatDir.clone().multiplyScalar(distAlongAxis).add(flatSpawnPos);
                    const distFromAxis = flatEnemyPos.distanceTo(closestPointOnAxis);

                    // Cone radius at this distance
                    const coneRadius = distAlongAxis * Math.tan(angle / 2);
                    const enemyRadius = 0.8;
                    const hitThreshold = coneRadius + enemyRadius;

                    console.log(`  DistFromAxis=${distFromAxis.toFixed(2)}, Threshold=${hitThreshold.toFixed(2)}`);

                    if (distFromAxis <= hitThreshold) {
                        // HIT
                        console.log("Lantern HIT:", enemy.name);
                        const runtime = this.enemyRuntimeData.get(enemy.uuid);
                        if (runtime) {
                            runtime.freezeTimer = freezeDuration;
                        }
                    }
                }
            }
        });
    }

    fireBullet(gunObj) {
        const bulletPower = gunObj.userData.bulletPower || 1;
        const bulletGlb = gunObj.userData.bulletGlb;

        // Spawn position: in front of the player
        const spawnPos = new THREE.Vector3();
        gunObj.getWorldPosition(spawnPos);

        const dir = new THREE.Vector3(0, 0, 1);
        const typology = this.player.userData.typology;
        console.log("fireBullet - Typology:", typology);

        if (typology === 'platform') {
            // In platform mode, direction is based on last move direction
            dir.set(this.lastMoveDir, 0, 0);
        } else {
            const camType = this.gameCameraObj?.userData.type;
            if (camType === 'FPS') {
                this.app.sceneManager.camera.getWorldDirection(dir);
                spawnPos.add(dir.clone().multiplyScalar(0.5));
            } else {
                this.player.getWorldDirection(dir);
                spawnPos.add(dir.clone().multiplyScalar(1.0));
            }
        }

        const createMesh = (model) => {
            const mesh = model || new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshBasicMaterial({ color: 0xffff00 }));
            
            mesh.traverse(c => {
                if (c.isMesh) {
                    c.visible = true;
                }
            });
            mesh.position.copy(spawnPos);
            this.app.sceneManager.scene.add(mesh);
            this.bullets.push({
                mesh: mesh,
                dir: dir.clone(),
                dist: 0,
                power: bulletPower
            });
        };

        if (bulletGlb) {
            this.app.editor.loader.load(bulletGlb, (gltf) => {
                createMesh(gltf.scene);
            });
        } else {
            createMesh(null);
        }
    }

    updateBullets(dt) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            const speed = 20 * dt;
            b.mesh.position.add(b.dir.clone().multiplyScalar(speed));
            b.dist += speed;

            // Collision with Enemies
            const bBox = new THREE.Box3().setFromObject(b.mesh);
            const enemies = this.app.editor.objects.filter(o => o.userData.type === 'Enemy' && o.parent);

            let hit = false;
            for (let enemy of enemies) {
                const eBox = this.getCollisionBox(enemy);
                if (bBox.intersectsBox(eBox)) {
                    // HIT!
                    enemy.userData.hp = (enemy.userData.hp || 1) - b.power;

                    const runtime = this.enemyRuntimeData.get(enemy.uuid);
                    const mixer = runtime ? runtime.mixer : null;
                    const clips = enemy.animations || (enemy.getObjectByName('model')?.animations) || [];

                    if (enemy.userData.hp <= 0) {
                        if (mixer && enemy.userData.animDeath) {
                            const clip = clips.find(c => c.name === enemy.userData.animDeath);
                            if (clip) {
                                mixer.stopAllAction();
                                const act = mixer.clipAction(clip);
                                act.clampWhenFinished = true;
                                act.loop = THREE.LoopOnce;
                                act.play();
                                if (runtime) runtime.currentAnim = 'Death';
                            }
                        }
                        setTimeout(() => { if (this.isPlaying && enemy.parent) enemy.parent.remove(enemy); }, 500);
                    } else {
                        if (mixer && enemy.userData.animHit) {
                            const clip = clips.find(c => c.name === enemy.userData.animHit);
                            if (clip) {
                                mixer.stopAllAction();
                                const act = mixer.clipAction(clip);
                                act.loop = THREE.LoopOnce;
                                act.play();
                                if (runtime) runtime.currentAnim = 'Hit';
                            }
                        }
                    }
                    hit = true;
                    break;
                }
            }

            if (hit || b.dist > 50) {
                if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
                this.bullets.splice(i, 1);
            }
        }
    }

    updateCatchers(dt) {
        const catchers = this.app.editor.objects.filter(o => o.userData.type === 'catcher_base' || o.userData.type === 'Catcher');
        const enemies = this.app.editor.objects.filter(o => o.userData.type === 'Enemy' && o.parent);

        catchers.forEach(base => {
            const baseBox = this.getCollisionBox(base);

            enemies.forEach(enemy => {
                if (this.translatingObjects.find(t => t.object === enemy)) return;

                const eBox = this.getCollisionBox(enemy);
                if (baseBox.intersectsBox(eBox)) {
                    const filter = base.userData.filterType || 'all';
                    if (filter === 'all' || filter === 'enemy') {
                        const target = this.app.editor.objects.find(t => t.userData.type === 'catcher_target' && t.userData.parentId === base.userData.id);
                        if (target) {
                            const moveType = base.userData.moveType || 'teleport';

                            if (moveType === 'translation') {
                                this.translatingObjects.push({
                                    object: enemy,
                                    target: target.position.clone(),
                                    targetRotation: target.rotation.clone(),
                                    speed: (enemy.userData.speed || 2) * 2
                                });
                            } else {
                                enemy.position.copy(target.position);
                                enemy.rotation.copy(target.rotation);
                                // Adjust Y based on height? Target is center. Enemy center matches.
                                // Reset runtime velocity if physics
                                const runtime = this.enemyRuntimeData.get(enemy.uuid);
                                if (runtime) {
                                    runtime.velocity.set(0, 0, 0);
                                    // Optional: Update initialPos for patrol? 
                                    // If patrol is relative to initialPos, teleporting breaks it unless we update initialPos.
                                    runtime.initialPos.copy(target.position);
                                }
                            }
                        }
                    }
                }
            });
        });
    }

    updateEnemies(dt) {
        // Update Movement & Mixers
        this.app.editor.objects.forEach(o => {
            // Update Mixer for ALL non-player animated objects (Enemy, Bonus, Model, PowerUp)
            // But skip if it's a frozen enemy
            if (o.userData.type === 'Enemy' || o.userData.type === 'Bonus' || o.userData.type === 'Model' || o.userData.type === 'PowerUp') {
                const runtime = this.enemyRuntimeData.get(o.uuid) || this.bonusRuntimeData.get(o.uuid);
                const mixer = runtime ? runtime.mixer : this.enemyMixers.find(m => m.getRoot() === o.getObjectByName('model') || m.getRoot() === o);

                if (mixer) {
                    const isFrozenEnemy = o.userData.type === 'Enemy' && runtime && runtime.frozen;
                    if (!isFrozenEnemy) mixer.update(dt);
                }
            }

            if (o.userData.type === 'Enemy') {
                if (!o.parent) return; // Skip if removed

                const runtime = this.enemyRuntimeData.get(o.uuid);
                if (!runtime) return;

                if (runtime.freezeTimer > 0) {
                    runtime.freezeTimer -= dt;
                    if (runtime.mixer) runtime.mixer.timeScale = 0; // Pause animation
                    return; // Skip movement logic
                } else {
                    if (runtime.mixer && runtime.mixer.timeScale === 0) runtime.mixer.timeScale = 1; // Resume
                }

                if (runtime.frozen) return;

                if (this.translatingObjects.find(t => t.object === o)) return; // Skip if translating

                const u = o.userData;

                const speed = (u.speed || 2.0) * dt;

                // Physics Logic
                if (u.hasPhysics && u.moveStyle !== 'patrol_up_down') {
                    runtime.velocity.y += this.gravity * dt;

                    // Raycast for Ground
                    const origin = o.position.clone();
                    origin.y += 0.5;

                    this.raycaster.set(origin, new THREE.Vector3(0, -1, 0));

                    const targets = this.app.sceneManager.scene.children.filter(c =>
                        c !== o && c !== this.player && !c.userData.isHelper && !c.userData.isCamera && c.userData.type !== 'SplatEnv'
                    );

                    const hits = this.raycaster.intersectObjects(targets, true);

                    let onGround = false;
                    if (hits.length > 0) {
                        const dist = hits[0].distance;
                        const heightHalf = (o.geometry?.parameters?.height || 0.8) / 2;
                        const threshold = 0.5 + heightHalf + 0.1;

                        if (dist <= threshold && runtime.velocity.y <= 0) {
                            o.position.y = hits[0].point.y + heightHalf;
                            runtime.velocity.y = 0;
                            onGround = true;
                        }
                    }

                    if (!onGround) {
                        o.position.y += runtime.velocity.y * dt;
                    }
                }

                let isMoving = false;

                if (u.moveStyle === 'forward') {
                    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(o.quaternion);
                    o.position.add(forward.multiplyScalar(speed));
                    isMoving = true;
                }
                else if (u.moveStyle === 'patrol_up_down') {
                    const range = u.patrolRange || 3.0;
                    const startY = runtime.initialPos.y;

                    o.position.y += speed * runtime.patrolDir;
                    isMoving = true;

                    if (o.position.y > startY + range) {
                        o.position.y = startY + range;
                        runtime.patrolDir = -1;
                    } else if (o.position.y < startY - range) {
                        o.position.y = startY - range;
                        runtime.patrolDir = 1;
                    }
                }
                else if (u.moveStyle === 'follower') {
                    // Resolve Target
                    let targetObj = this.player;
                    let targetName = 'Player (Default)';

                    if (u.followerTarget && u.followerTarget.toLowerCase() !== 'player') {
                        const found = this.app.editor.objects.find(obj => obj.name === u.followerTarget || obj.userData.id === u.followerTarget || obj.uuid === u.followerTarget);
                        if (found) {
                            targetObj = found;
                            targetName = found.name;
                        } else {
                            targetName = `${u.followerTarget} (Not Found)`;
                        }
                    }

                    // Debug Scale and Target (Throttled log? No, one-off check or filtered)
                    if (this.firstFrame) {
                        console.log(`Enemy ${o.name} following: ${targetName}`);
                        console.log(`Enemy Scale:`, o.scale.toArray());
                    }

                    const dist = o.position.distanceTo(targetObj.position);
                    const detectRange = u.followerProximity || 5.0; // Detection Range
                    const stopDist = u.followerStopDist || 0.5; // Stop Distance

                    if (dist <= detectRange) {
                        // Stop Logic
                        let shouldStop = false;
                        if (dist <= stopDist) shouldStop = true;

                        // Collision Check
                        if (!shouldStop && u.followerStopCol) {
                            const oBox = this.getCollisionBox(o);
                            const tBox = this.getCollisionBox(targetObj);
                            if (oBox.intersectsBox(tBox)) shouldStop = true;
                        }

                        if (!shouldStop) {
                            isMoving = true;
                            const dir = new THREE.Vector3().subVectors(targetObj.position, o.position).normalize();
                            const move = dir.multiplyScalar(speed);

                            const tx = u.followerTransX !== false;
                            const ty = u.followerTransY !== false;
                            const tz = u.followerTransZ !== false;

                            if (tx) o.position.x += move.x;
                            if (ty) o.position.y += move.y;
                            if (tz) o.position.z += move.z;

                            const rx = u.followerRotX !== false;
                            const ry = u.followerRotY !== false;
                            const rz = u.followerRotZ !== false;

                            if (rx || ry || rz) {
                                const targetPos = targetObj.position.clone();
                                if (ry && !rx && !rz) {
                                    targetPos.y = o.position.y;
                                }

                                // Safety check: if target is too close (degenerate vector), skip rotation
                                if (o.position.distanceToSquared(targetPos) > 0.0001) {
                                    // Smooth Rotation
                                    const dummy = new THREE.Object3D();
                                    dummy.up.copy(o.up);
                                    dummy.position.copy(o.position);
                                    dummy.lookAt(targetPos);

                                    // Explicitly sync Euler from the calculated Quaternion
                                    dummy.rotation.setFromQuaternion(dummy.quaternion);

                                    // Defensive check for initialRot
                                    const initRot = runtime.initialRot || o.rotation;

                                    if (!rx) dummy.rotation.x = initRot.x;
                                    if (!ry) dummy.rotation.y = initRot.y;
                                    if (!rz) dummy.rotation.z = initRot.z;

                                    // Recalculate target Quaternion from constrained Euler
                                    const targetQ = new THREE.Quaternion().setFromEuler(dummy.rotation);
                                    o.quaternion.slerp(targetQ, 5.0 * dt);
                                }
                            }
                        }
                    }
                }

                // Animation State Machine
                if (runtime.mixer && runtime.currentAnim !== 'Death') {
                    const model = o.getObjectByName('model') || o;
                    const clips = o.animations || model.animations || [];

                    if (runtime.currentAnim === 'Hit') {
                        const hitClip = clips.find(c => c.name === u.animHit);
                        if (hitClip) {
                            const action = runtime.mixer.existingAction(hitClip);
                            if (action && action.isRunning()) {
                                // Still hitting
                            } else {
                                runtime.currentAnim = null; // Finished
                            }
                        } else {
                            runtime.currentAnim = null;
                        }
                    }

                    if (runtime.currentAnim !== 'Hit' && runtime.currentAnim !== 'Death') {
                        // Use Move animation if isMoving is true, otherwise Idle
                        let desiredAnim = isMoving ? u.animMove : u.animIdle;

                        let shouldSwitch = false;
                        if (desiredAnim !== runtime.currentAnim) {
                            shouldSwitch = true;
                        } else if (desiredAnim) {
                            // Integrity Check: Ensure the desired animation is actually playing
                            const clip = clips.find(c => c.name === desiredAnim);
                            if (clip) {
                                const act = runtime.mixer.existingAction(clip);
                                if (!act || !act.isRunning()) shouldSwitch = true;
                            }
                        }

                        if (shouldSwitch && desiredAnim) {
                            const clip = clips.find(c => c.name === desiredAnim);
                            if (clip) {
                                runtime.mixer.stopAllAction();
                                const act = runtime.mixer.clipAction(clip);
                                act.reset();
                                act.play();
                                runtime.currentAnim = desiredAnim;
                            }
                        }
                    }
                }
            }
        });
    }

    updateBonuses(dt) {
        this.app.editor.objects.forEach(o => {
            if (o.userData.type === 'Bonus') {
                if (!o.parent || o.userData.collected) return;

                const u = o.userData;
                const runtime = this.bonusRuntimeData.get(o.uuid);
                if (!runtime) return;

                const speed = (u.speed || 2.0) * dt;

                if (u.moveStyle === 'forward') {
                    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(o.quaternion);
                    o.position.add(forward.multiplyScalar(speed));
                }
                else if (u.moveStyle === 'patrol_up_down') {
                    const range = u.patrolRange || 3.0;
                    const startY = runtime.initialPos.y;

                    o.position.y += speed * runtime.patrolDir;

                    if (o.position.y > startY + range) {
                        o.position.y = startY + range;
                        runtime.patrolDir = -1;
                    } else if (o.position.y < startY - range) {
                        o.position.y = startY - range;
                        runtime.patrolDir = 1;
                    }
                }
            }
        });
    }

    updateGameLogic(dt) {
        const pBox = this.getCollisionBox(this.player);
        this.app.editor.objects.forEach(o => {
            if (o === this.player || !o.userData.isAsset || o.userData.noCollision) return;
            if (!o.parent) return;

            const oBox = this.getCollisionBox(o);
            let collided = pBox.intersectsBox(oBox);

            // Special radius-based check for Bonus, PowerUp & Goal
            if (o.userData.type === 'Bonus' || o.userData.type === 'PowerUp' || o.userData.type === 'Goal') {
                const radius = o.userData.radius || (o.userData.type === 'Goal' ? 1.5 : 1.0);
                const pWorld = new THREE.Vector3();
                this.player.getWorldPosition(pWorld);
                const oWorld = new THREE.Vector3();
                o.getWorldPosition(oWorld);
                // For Goal: use XZ-only distance (player walks ON it, Y doesn't matter much)
                if (o.userData.type === 'Goal') {
                    const dxz = Math.sqrt((pWorld.x - oWorld.x) ** 2 + (pWorld.z - oWorld.z) ** 2);
                    if (dxz <= radius) collided = true;
                } else {
                    const dist = pWorld.distanceTo(oWorld);
                    if (dist <= radius) collided = true;
                }
            }

            if (collided) {
                if (o.userData.type === 'Collision') {
                    if (o.userData.triggered && o.userData.oneShot) return;

                    o.userData.triggered = true;
                    const action = o.userData.actionType || 'restart';
                    const value = o.userData.actionValue;

                    console.log(`[Collision] Triggered: ${action} | Targets: ${o.userData.actionTargets?.join(', ') || o.userData.actionTarget || 'None'}`);

                    if (action === 'restart') {
                        this.stop();
                        setTimeout(() => this.start(), 100);
                    } else if (action === 'load_level') {
                        const levelIdx = parseInt(value);
                        if (!isNaN(levelIdx)) {
                            this.loadLevel(levelIdx);
                        }
                    } else if (action === 'alert') {
                        this.showMessage(value || "Triggered!");
                    } else if (action === 'hide_object') {
                        const targets = o.userData.actionTargets || (o.userData.actionTarget ? [o.userData.actionTarget] : []);
                        targets.forEach(targetName => {
                            const target = this.app.editor.objects.find(obj =>
                                obj.name === targetName.trim() ||
                                obj.userData.id === targetName.trim()
                            );
                            if (target) {
                                target.visible = false;
                                target.updateMatrixWorld(true);
                            }
                        });
                    } else if (action === 'play_anim' || action === 'unfreeze') {
                        const targetNames = o.userData.actionTargets || (o.userData.actionTarget ? [o.userData.actionTarget] : []);
                        const val = value ? value.trim() : null;

                        targetNames.forEach(targetName => {
                            const target = this.app.editor.objects.find(obj =>
                                obj.name === targetName.trim() ||
                                obj.userData.id === targetName.trim()
                            );
                            if (target) {
                                let tMixer = null;
                                if (target.userData.type === 'Enemy') {
                                    const runtime = this.enemyRuntimeData.get(target.uuid);
                                    if (runtime) {
                                        tMixer = runtime.mixer;
                                        runtime.frozen = false; // Activation!
                                        console.log(`[Collision] Unfrozen enemy: ${target.name}`);
                                    }
                                } else {
                                    tMixer = this.enemyMixers.find(m => {
                                        const root = m.getRoot();
                                        return root === target || root === target.getObjectByName('model') || root.parent === target;
                                    });
                                }

                                if (tMixer) {
                                    const clips = target.animations || (target.getObjectByName('model')?.animations) || [];
                                    // Determine which animation to play
                                    // If unfreeze and no specific value, use the default move animation
                                    let clipName = (action === 'play_anim') ? val : (val || target.userData.animMove);

                                    if (clipName) {
                                        const clip = clips.find(c => c.name === clipName) || clips.find(c => c.name.toLowerCase() === clipName.toLowerCase());
                                        if (clip) {
                                            tMixer.stopAllAction();
                                            const animAction = tMixer.clipAction(clip);
                                            animAction.reset();
                                            animAction.play();

                                            const runtime = this.enemyRuntimeData.get(target.uuid) || this.bonusRuntimeData.get(target.uuid);
                                            if (runtime) runtime.currentAnim = clipName;
                                        }
                                    }
                                }
                            }
                        });
                    }
                } else if (o.userData.type === 'Goal') {
                    // Guard: only trigger once per contact
                    if (o.userData.triggered) return;
                    o.userData.triggered = true;

                    // Goal automatically loads the next level by default, but can be customized
                    const action = o.userData.actionType || 'next_level';
                    const value = o.userData.actionValue;

                    if (action === 'next_level') {
                        const currentIdx = this.app.editor.currentLevelIndex;
                        const nextIdx = (currentIdx >= 0) ? currentIdx + 1 : 0;
                        this.showMessage('🏆 GOAL! Caricamento livello successivo...', 2000);
                        setTimeout(() => this.loadLevel(nextIdx), 1500);
                    } else if (action === 'load_level') {
                        const levelIdx = parseInt(value);
                        if (!isNaN(levelIdx)) {
                            this.showMessage(`🏆 GOAL! Caricamento livello ${levelIdx}...`, 2000);
                            setTimeout(() => this.loadLevel(levelIdx), 1500);
                        }
                    } else if (action === 'restart') {
                        this.showMessage('Level Restarting...', 2000);
                        setTimeout(() => { this.stop(); setTimeout(() => this.start(), 100); }, 1500);
                    } else if (action === 'alert') {
                        this.showMessage(value || 'Goal Reached!');
                        o.userData.triggered = false; // Allow re-trigger for alerts only
                    }
                    return; // Stop checking other collisions this frame
                } else if (o.userData.type === 'PowerUp') {
                    if (o.userData.collected) return;
                    try {
                        o.userData.collected = true;
                        const pType = o.userData.powerType || 'none';
                        console.log("Picking up PowerUp:", o.name, "Type:", pType);

                        // Attach to Player
                        const playerModel = this.player.getObjectByName('model') || this.player;

                        // Cycle Check: Ensure playerModel is not inside o
                        let ancestor = playerModel;
                        let cycleFound = false;
                        while (ancestor) {
                            if (ancestor === o) {
                                console.error("CYCLE DETECTED: PowerUp contains Player! Aborting pickup.");
                                cycleFound = true;
                                break;
                            }
                            ancestor = ancestor.parent;
                        }
                        if (cycleFound) return;

                        // Detach from scene, attach to player
                        o.removeFromParent();
                        playerModel.add(o);
                        console.log(`PowerUp Attached to: ${playerModel.name} | UUID: ${playerModel.uuid} | Object: ${o.name}`);
                        o.updateMatrixWorld(true);

                        // If it is a Lantern, hide it initially
                        if (pType === 'lantern') {
                            o.visible = false;
                            this.safeTraverse(o, c => { if (c.isMesh) c.frustumCulled = false; });
                        } else {
                            o.visible = true; // Guns etc remain visible
                        }
                        // Disable collision checks against this object
                        o.userData.isAsset = false;

                        // Play Equip Animation (on the PowerUp itself)
                        const animName = o.userData.equipAnim;
                        if (animName) {
                            const mixer = this.enemyMixers.find(m => m.getRoot() === o.getObjectByName('model') || m.getRoot() === o);
                            if (mixer) {
                                const model = o.getObjectByName('model');
                                const animations = o.animations || (model ? model.animations : []);
                                const clip = animations.find(c => c.name === animName);
                                if (clip) {
                                    mixer.stopAllAction();
                                    const action = mixer.clipAction(clip);
                                    action.reset();
                                    action.play();
                                }
                            }
                        }

                        // Activate Fly Mode
                        if (pType === 'fly') {
                            // Clear existing timer to prevent early reset
                            if (this.flyTimer) clearTimeout(this.flyTimer);

                            this.player.userData.mode = 'fly';
                            this.player.userData.flyAnim = o.userData.flyAnim;

                            // Only set startFlyY if not already flying, to preserve original ground level
                            if (this.player.userData.startFlyY === undefined) {
                                this.player.userData.startFlyY = this.player.position.y;
                            }

                            this.player.userData.flyHeight = (o.userData.flyHeight || 3.0);

                            const duration = (o.userData.duration || 10) * 1000;
                            this.showMessage("FLY MODE ACTIVATED!", duration);

                            // Boost start
                            this.velocity.y = (o.userData.flyBoost || 10.0);
                            this.player.position.y += 0.5;
                            this.onGround = false;

                            // Set robust timer
                            this.flyTimer = setTimeout(() => {
                                this.flyTimer = null;
                                if (this.player && this.player.userData.mode === 'fly') {
                                    this.player.userData.mode = 'normal';
                                    this.player.userData.flyAnim = null;

                                    // Feather Fall instead of teleport
                                    this.player.userData.featherFall = true;
                                    this.player.userData.startFlyY = undefined; // Clear tracking

                                    this.onGround = false;
                                    this.velocity.y = -1; // Start gentle descent   
                                    this.showMessage("Flight Ended!", 2000);
                                }
                            }, duration);

                            // Consume Fly PowerUp (don't keep it attached)
                            if (o.parent) o.removeFromParent();
                        }

                        // Remove object from scene only if it wasn't attached to player
                        // IF we attached it to player, o.parent is playerModel.
                        // IF we didn't (e.g. instant effect?), we should have removed it.
                        // But wait, the code above `playerModel.add(o)` ALWAYS runs for PowerUp (lines 1229-1231).
                        // So o.parent is ALWAYS playerModel here.
                        // So `o.removeFromParent()` ALWAYS detaches it.
                        // DELETING THIS BLOCK.

                        // (No operation needed here, the object is now part of the player)
                    } catch (err) {
                        console.error("Error picking up PowerUp:", err);
                    }
                } else if (o.userData.type === 'Bonus') {
                    if (o.userData.collected) return;
                    o.userData.collected = true;

                    this.score += (o.userData.points || 100);
                    this.updateHUD();

                    const u = o.userData;
                    const runtime = this.bonusRuntimeData.get(o.uuid);
                    const mixer = runtime ? runtime.mixer : null;
                    let animDuration = 0;

                    if (mixer && u.animCollect) {
                        const model = o.getObjectByName('model') || o;
                        const animations = o.animations || (model ? model.animations : []);
                        const clip = animations.find(c => c.name === u.animCollect);
                        if (clip) {
                            mixer.stopAllAction();
                            const action = mixer.clipAction(clip);
                            action.setLoop(THREE.LoopOnce);
                            action.clampWhenFinished = true;
                            action.play();
                            animDuration = clip.duration;
                        }
                    }

                    if (u.disappearOnCollect !== false) {
                        if (animDuration > 0) {
                            setTimeout(() => {
                                if (this.isPlaying && o.parent) o.parent.remove(o);
                            }, animDuration * 1000);
                        } else {
                            this.app.sceneManager.scene.remove(o);
                        }
                    }
                } else if (o.userData.type === 'Goal') {
                    // Handled above with trigger guard — this branch should not be reached

                } else if (o.userData.type === 'catcher_base' || o.userData.type === 'Catcher') {
                    const filter = o.userData.filterType || 'all';
                    if (filter === 'all' || filter === 'player') {
                        // Key Check
                        const reqKey = o.userData.keyTrigger ? o.userData.keyTrigger.toLowerCase() : null;
                        const keyActive = !reqKey || this.keys.has(reqKey);

                        if (keyActive) {
                            const target = this.app.editor.objects.find(t => t.userData.type === 'catcher_target' && t.userData.parentId === o.userData.id);
                            if (target) {
                                const moveType = o.userData.moveType || 'teleport';

                                // Calculate correct landing Y based on player height
                                let pr = 0.5, ph = 2.0;
                                if (this.player.geometry?.parameters) {
                                    const p = this.player.geometry.parameters;
                                    pr = p.radius || 0.5;
                                    ph = (p.length || p.height || 1.0) + pr * 2;
                                }
                                const targetPos = target.position.clone();
                                targetPos.y += ph / 2; // Position center so feet touch ground

                                if (moveType === 'translation') {
                                    if (!this.translatingObjects.find(t => t.object === this.player)) {
                                        this.translatingObjects.push({
                                            object: this.player,
                                            target: targetPos,
                                            targetRotation: target.rotation.clone(),
                                            speed: (this.player.userData.speed || 5) * 2
                                        });
                                    }
                                } else {
                                    this.player.position.copy(targetPos);
                                    this.player.rotation.copy(target.rotation);

                                    const state = this.playStartStates.find(s => s.uuid === this.player.uuid);
                                    if (state) state.p.copy(this.player.position);
                                }
                            }
                        }
                    }
                } else if (o.userData.type === 'Enemy' || o.userData.type === 'Boss') {
                    // Stomp Check
                    const feetY = pBox.min.y;
                    // Relaxed Check: If feet are above the enemy's center, consider it "Above"
                    // This handles fast falling where the player might penetrate deep into the hitbox in one frame.
                    const isAbove = feetY >= o.position.y;

                    // Fly Mode Invincibility against Normal/Boss enemies (unless Boss has special tag? User said "normal enemies")
                    // Let's assume Invincible to all for now as per "enemies normali non pssono colpire"
                    // If we distinguish Boss later, we can check o.userData.type
                    if (this.player.userData.mode === 'fly') {
                        return; // Invincible!
                    }

                    if (isAbove) {
                        // ...
                    } else {
                        // Side/Bottom Hit -> Damage
                        if (this.invulnerabilityTimer <= 0) {
                            const pSize = pBox.getSize(new THREE.Vector3());
                            console.warn(`DAMAGED BY: ${o.name} | Dist: ${o.position.distanceTo(this.player.position).toFixed(2)}`);
                            console.log(`Player Hitbox Size: ${pSize.x.toFixed(2)}, ${pSize.y.toFixed(2)}, ${pSize.z.toFixed(2)}`);

                            // Debug: Show BOTH hitboxes
                            if (!o.userData.debugBox) {
                                const helperO = new THREE.Box3Helper(oBox, 0xff0000);
                                const helperP = new THREE.Box3Helper(pBox, 0x00ff00);
                                this.app.sceneManager.scene.add(helperO);
                                this.app.sceneManager.scene.add(helperP);
                                o.userData.debugBox = helperO;
                                setTimeout(() => {
                                    if (helperO.parent) helperO.parent.remove(helperO);
                                    if (helperP.parent) helperP.parent.remove(helperP);
                                    o.userData.debugBox = null;
                                }, 2000);
                            }

                            this.lives--;
                            this.updateHUD();
                            this.invulnerabilityTimer = 2.0; // 2 seconds iFrames
                            if (this.lives <= 0) { alert("GAME OVER"); this.stop(); }
                            else {
                                this.velocity.y = 15;
                                this.player.position.y += 0.2;
                                // Knockback
                                const knockDir = this.player.position.clone().sub(o.position).normalize();
                                knockDir.y = 0;
                                this.player.position.add(knockDir.multiplyScalar(1.0));
                            }
                        }
                    }
                }
            }
        });
    }

    handlePlayerInput(dt) {
        if (this.translatingObjects.find(t => t.object === this.player)) return;

        const u = this.player.userData;

        // DEBUG F KEY
        if (this.keys.has('f')) {
            // console.log("DEBUG: F pressed");
            // const shoot = (u.actions || []).find(a => a.type === 'Shooting');
            // console.log("Shoot Action found:", shoot);
            // console.log("ActionLocked:", this.actionLocked);
        }

        let speed = (u.speed || 5.0);
        let isSprinting = false;
        const sprintKey = u.sprintKey || 'shift';
        if (u.canSprint && this.keys.has(sprintKey.toLowerCase())) {
            speed *= (u.sprintMult !== undefined ? u.sprintMult : 1.5);
            isSprinting = true;
        }
        const jumpForce = (u.jumpForce || 15.0);

        // Initialize physics parameters at the very start
        let pr = 0.5, ph = 2.0;
        if (this.player.geometry?.parameters) {
            const p = this.player.geometry.parameters;
            pr = p.radius || 0.5;
            ph = (p.length || p.height || 1.0) + pr * 2;
        }

        // 1. Gravity and Flight Logic
        let requestedAnim = null; // Declare here

        if (u.mode === 'fly') {
            // Constant Hover at Fixed Height
            const targetH = (u.flyHeight !== undefined ? u.flyHeight : 3.0);
            const targetABS = (u.startFlyY || 0) + targetH;

            // DEBUG: Trace Fly Height
            if (Math.random() < 0.05) console.log(`[FlyHeightDebug] H_Param: ${u.flyHeight} | TargetH: ${targetH} | StartY: ${u.startFlyY} | CurY: ${this.player.position.y.toFixed(2)} | TargetABS: ${targetABS.toFixed(2)}`);

            // Proportional Control for Smooth Height
            const diff = targetABS - this.player.position.y;
            // damping / speed factor
            this.velocity.y = diff * 2.0;


            // Override animation if Fly anim is set
            // if (u.flyAnim) requestedAnim = u.flyAnim; // REMOVED: Only play on move

        } else {
            if (!this.onGround) {
                if (u.featherFall) {
                    // Feather Fall: Reduced Gravity & Terminal Velocity
                    // Gravity is -35, so * 0.1 is -3.5. 
                    this.velocity.y += (this.gravity * 0.1) * dt;
                    // Clamp to slow fall (e.g. -2)
                    this.velocity.y = Math.max(this.velocity.y, -3.0);
                } else {
                    this.velocity.y += this.gravity * dt;
                }
                // DEBUG: Trace Gravity
                // if (Math.random() < 0.05) console.log(`[GravityDebug] OnGround: ${this.onGround} | VelY: ${this.velocity.y.toFixed(2)} | Gravity: ${this.gravity}`);
            }
            else this.velocity.y = 0;
        }

        const moveDir = new THREE.Vector3();

        (u.actions || []).forEach(action => {
            // DEBUG: Check for F key
            if (this.keys.has('f')) {
                console.log(`Key 'f' pressed. Checking Action: ${action.name} Type: ${action.type} Key: ${action.key} Active: ${action.active}`);
            }

            if (!action.active) return;
            if (this.keys.has(action.key.toLowerCase())) {
                if (action.type === 'Walk' || action.type === 'Run') {
                    if (action.key === 'w') moveDir.z -= 1; // Forward is -Z in Three.js camera space
                    if (action.key === 's') moveDir.z += 1; // Backward is +Z
                    if (action.key === 'a') {
                        moveDir.x -= 1;
                    }
                    if (action.key === 'd') {
                        moveDir.x += 1;
                    }
                }
                if (action.type === 'Jump') {
                    // Prevent Jump in Fly mode (Flight controls take over)
                    if (u.mode === 'fly') return;

                    const maxJumps = u.doubleJump ? 2 : 1;
                    if (this.jumpCount < maxJumps && !this.jumpLocked) {
                        this.velocity.y = jumpForce;
                        this.onGround = false;
                        this.jumpCount++;
                        this.jumpLocked = true;
                    }
                }
                if (action.type === 'Shooting') {
                    if (!this.actionLocked) {
                        const model = this.player.getObjectByName('model') || this.player;

                        // Recursive find for PowerUp (in case it attached to a Bone or sub-node)
                        let equipped = null;

                        // Explicit check on model children first
                        if (model && model.children) {
                            equipped = model.children.find(c => c.userData.type === 'PowerUp');
                        }

                        // Fallback: Full Search if direct failed
                        if (!equipped) {
                            this.safeTraverse(this.player, c => {
                                if (equipped) return;
                                if (c && c.userData && c.userData.type === 'PowerUp') equipped = c;
                            });
                        }

                        console.log("Equipped found:", equipped ? equipped.userData.powerType : "NONE");

                        if (equipped) {
                            console.log("PowerType:", equipped.userData.powerType);

                            if (equipped.userData.powerType === 'gun') {
                                this.fireBullet(equipped);
                                this.actionLocked = true;
                            } else if (equipped.userData.powerType === 'lantern') {
                                console.log("Lantern Cooldown:", this.lanternCooldownTimer);
                                if (isNaN(this.lanternCooldownTimer)) this.lanternCooldownTimer = 0;

                                if (this.lanternCooldownTimer <= 0) {
                                    this.useLantern(equipped);
                                    this.actionLocked = true;
                                    // Player stays still for 1 second
                                    setTimeout(() => { this.actionLocked = false; }, 1000);
                                } else {
                                    console.log("Lantern on Cooldown!");
                                }
                            } else if (equipped.userData.powerType === 'fly') {
                                // Already handled in mode check?
                            }
                        }
                    }
                }
            }
            if (action.anim) requestedAnim = action.anim;
        });

        // SHOOTING Key Release Check
        const shootAction = (u.actions || []).find(a => a.type === 'Shooting');
        if (shootAction && !this.keys.has(shootAction.key.toLowerCase())) {
            this.actionLocked = false;
        }

        // Jump Key Release Check
        const jumpAction = (u.actions || []).find(a => a.type === 'Jump');
        if (jumpAction && !this.keys.has(jumpAction.key.toLowerCase())) {
            this.jumpLocked = false;
        }

        // ... (rest of function)


        const camType = this.gameCameraObj?.userData.type;
        // 3D Movement Logic (TPS/FPS/8WAY)
        if (u.typology === '8WAY' || ((camType === 'TPS' || camType === 'FPS') && u.typology !== 'platform')) {
            let yaw = 0;
            if (u.typology === '8WAY') {
                // Robust Yaw Calculation (Vector-based to avoid Gimbal Lock)
                const q = this.app.sceneManager.camera.quaternion;
                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);

                // If looking mostly horizontal, use Forward vector
                if (Math.abs(forward.y) < 0.99) {
                    yaw = Math.atan2(forward.x, forward.z) - Math.PI;
                } else {
                    // If looking straight Up/Down, use Up vector to determine orientation
                    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
                    yaw = Math.atan2(up.x, up.z) - Math.PI;
                }
            } else {
                yaw = this.mouseRotation.x;
            }

            const camQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
            moveDir.applyQuaternion(camQuat);

            // Rotate player to look in the movement direction
            if (moveDir.length() > 0) {
                const targetRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(moveDir.x, moveDir.z), 0, 'YXZ'));
                this.player.quaternion.slerp(targetRotation, 0.15);
            }
        } else if (u.typology === 'platform') {
            // In Platform mode, inputs are usually World Axes (D=+X, A=-X) relative to camera's fixed view
            // Assuming Camera looks along Z axis by default.
            // But if user rotates camera? Platform usually implies fixed axes.
            // Let's assume standard side-scroll X-axis movement.
        }

        // 2. Horizontal Blocking (Ray-based - enhanced with BVH implicitly via raycast)
        const obstacles = this.app.sceneManager.scene.children.filter(o =>
            o !== this.player && !o.userData.isHelper && !o.userData.isCamera &&
            !o.userData.isTrigger && !o.userData.noCollision && o.userData.type !== 'SplatEnv' && // Exclude Triggers, NoCollision and Splats
            o.userData.type !== 'Bonus' && o.userData.type !== 'Goal' && o.userData.type !== 'catcher_base' && o.userData.type !== 'catcher_target' && o.userData.type !== 'Catcher'
        );

        if (moveDir.length() > 0) {
            moveDir.normalize();
            // Cast ray in movement direction at waist height
            const waistPos = this.player.position.clone().add(new THREE.Vector3(0, 0.5, 0));
            this.raycaster.set(waistPos, moveDir);
            const hits = this.raycaster.intersectObjects(obstacles, true);

            // Wall Sliding
            if (hits.length > 0 && hits[0].distance < 0.6 && hits[0].face) {
                const normal = hits[0].face.normal.clone().applyQuaternion(hits[0].object.quaternion);
                const dot = moveDir.dot(normal);
                if (dot < 0) {
                    moveDir.sub(normal.multiplyScalar(dot));
                }
            }

            this.player.position.add(moveDir.multiplyScalar(speed * dt));
        }

        // Update direction memory for Platform mode
        if (u.typology === 'platform') {
            if (moveDir.x > 0.01) this.lastMoveDir = 1;
            else if (moveDir.x < -0.01) this.lastMoveDir = -1;
        }

        // Apply Mirror / Orientation
        const model = this.player.getObjectByName('model');
        if (model) {
            if (u.typology === 'platform') {
                // Side View Logic: use last direction persistently
                model.rotation.y = (this.lastMoveDir === -1) ? -Math.PI / 2 : Math.PI / 2;
            }
        }

        // Apply Vertical
        this.player.position.y += this.velocity.y * dt;

        // 3. Grounding (Aggressive)
        let groundY = -Infinity;
        // 9-point grid for solid footing
        const spread = pr * 0.8;
        const groundRays = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(spread, 0, 0), new THREE.Vector3(-spread, 0, 0),
            new THREE.Vector3(0, 0, spread), new THREE.Vector3(0, 0, -spread),
            new THREE.Vector3(spread, 0, spread), new THREE.Vector3(-spread, 0, spread),
            new THREE.Vector3(spread, 0, -spread), new THREE.Vector3(-spread, 0, -spread)
        ];

        // Collide with EVERYTHING except player and specific triggers (and enemies for grounding)
        const allTargets = this.app.sceneManager.scene.children.filter(o =>
            o !== this.player && !o.userData.isHelper && !o.userData.isCamera &&
            !o.userData.isTrigger && !o.userData.noCollision && o.userData.type !== 'SplatEnv' && // Exclude Triggers, NoCollision and Splats
            o.userData.type !== 'Bonus' && o.userData.type !== 'Goal' && o.userData.type !== 'Enemy' && o.userData.type !== 'Boss' && o.userData.type !== 'catcher_base' && o.userData.type !== 'catcher_target' && o.userData.type !== 'Catcher'
        );

        groundRays.forEach(off => {
            const origin = this.player.position.clone().add(off);
            origin.y += 2.0; // Start from head level
            this.raycaster.set(origin, new THREE.Vector3(0, -1, 0));
            const hits = this.raycaster.intersectObjects(allTargets, true);

            if (hits.length > 0) {
                // Filter hits to find the highest solid ground below the player's "step up" height
                for (let hit of hits) {
                    if (hit.point.y < this.player.position.y + 0.5) {
                        if (hit.point.y > groundY) groundY = hit.point.y;
                        break; // Found closest valid ground for this ray
                    }
                }
            }
        });

        // Snap to ground with a bit more tolerance (0.2)
        if (groundY > -Infinity && (this.player.position.y - groundY <= (ph / 2 + 0.2)) && this.velocity.y <= 0) {
            // Prevent initial pop-up on first frame
            if (this.firstFrame) {
                this.onGround = true;
                this.velocity.y = 0;
                this.jumpCount = 0;
                u.featherFall = false;
            } else {
                this.player.position.y = groundY + ph / 2;
                this.onGround = true; this.velocity.y = 0;
                this.jumpCount = 0;
                u.featherFall = false;
            }
        } else this.onGround = false;

        // 2.5D Lock
        if (u.typology === 'platform') {
            const start = this.playStartStates.find(s => s.uuid === this.player.uuid);
            if (start) this.player.position.z = start.p.z;
        }


        // Anims Priority Logic
        let finalAnim = requestedAnim;

        // 1. Jump Priority
        if (!this.onGround && u.mode !== 'fly') {
            const jumpAction = (u.actions || []).find(a => a.type === 'Jump' && a.anim && a.active);
            if (jumpAction) finalAnim = jumpAction.anim;
        }

        // 2. Movement Fallback
        if (moveDir.length() > 0) {
            if (u.mode === 'fly') {
                if (u.flyAnim) finalAnim = u.flyAnim;
                else {
                    // Fallback to generic Fly action if no custom anim
                    const flyAction = (u.actions || []).find(a => a.type === 'Fly' && a.active);
                    if (flyAction && flyAction.anim) finalAnim = flyAction.anim;
                }
            } else {
                // Normal Walk/Run
                const moveAction = (u.actions || []).find(a => (a.type === 'Walk' || a.type === 'Run') && a.anim && a.active);
                if (moveAction) finalAnim = moveAction.anim;
            }
        }

        // 3. Idle Fallback
        if (!finalAnim) {
            const idleAction = (u.actions || []).find(a => a.type === 'Idle' && a.anim && a.active);
            if (idleAction) finalAnim = idleAction.anim;
        }


        if (finalAnim) {
            this.playAnim(finalAnim);
            if (this.activeAction) {
                if (isSprinting && (finalAnim === ((u.actions || []).find(a => (a.type === 'Walk' || a.type === 'Run') && a.active)?.anim))) {
                    this.activeAction.setEffectiveTimeScale(u.sprintMult !== undefined ? u.sprintMult : 1.5);
                } else {
                    this.activeAction.setEffectiveTimeScale(1);
                }
            }
        } else if (this.activeAction) {
            this.activeAction.fadeOut(0.2);
            this.activeAction = null;
        }
    }

    playAnim(name) {
        if (!this.actions[name]) return;
        const action = this.actions[name];
        if (this.activeAction !== action) {
            const prev = this.activeAction; this.activeAction = action;
            if (prev) { action.reset().enabled = true; action.crossFadeFrom(prev, 0.2, true); action.play(); }
            else action.reset().play();
        }
        // Trigger SFX for this action
        const playerActions = this.player?.userData.actions || [];
        const matchedAction = playerActions.find(a => a.anim === name && a.sfx);
        if (matchedAction && matchedAction.sfx) {
            this.playSFX(matchedAction.sfx);
        }
    }

    updateCamera() {
        if (!this.player || !this.gameCameraObj) return;
        const type = this.gameCameraObj.userData.type || 'TPS';
        // console.log("Cam Type:", type); // Debug
        if (type === 'FIXED') return;

        const cam = this.app.sceneManager.camera;

        if (type === 'TPS') {
            const distance = this.cameraDistance || 5;
            const orbitQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.mouseRotation.y, this.mouseRotation.x, 0, 'YXZ'));

            // Look target: precisely at player's center height
            let ph = 2.0;
            if (this.player.geometry?.parameters) {
                const p = this.player.geometry.parameters;
                ph = (p.length || p.height || 1.0) + (p.radius || 0.5) * 2;
            }
            const targetPos = this.player.position.clone(); // The position is already the center of the capsule in Three.js

            const offset = new THREE.Vector3(0, 0, distance).applyQuaternion(orbitQuat);
            const desiredPos = targetPos.clone().add(offset);

            // Camera Collision
            const dir = offset.clone().normalize();
            this.raycaster.set(targetPos, dir);
            const obstacles = this.app.sceneManager.scene.children.filter(o =>
                o !== this.player && !o.userData.isHelper && !o.userData.isCamera && o.isMesh && o.visible && o.name !== 'Floor' && o.userData.type !== 'SplatEnv'
            );
            const hits = this.raycaster.intersectObjects(obstacles, true);

            if (hits.length > 0 && hits[0].distance < distance) {
                cam.position.copy(hits[0].point).add(dir.multiplyScalar(-0.2));
            } else {
                cam.position.copy(desiredPos);
            }

            cam.lookAt(targetPos);
        } else if (type === 'FPS') {
            const headPos = this.player.position.clone().add(new THREE.Vector3(0, 1.8, 0));
            cam.position.copy(headPos);
            cam.rotation.set(this.mouseRotation.y, this.mouseRotation.x, 0, 'YXZ');
        } else if (type === '8WAY') {
            const desiredPos = this.player.position.clone().add(this.cameraOffset);
            cam.position.copy(desiredPos);
            // Enforce rotation to match the setup camera (preventing any drift/orbit interference)
            if (this.gameCameraObj) cam.quaternion.copy(this.gameCameraObj.quaternion);
        } else {
            const relativeOffset = this.cameraOffset.clone().applyMatrix4(this.player.matrixWorld);
            cam.position.copy(relativeOffset);
            cam.lookAt(this.player.position);
        }
    }

    // ======================== AUDIO ========================

    playBGM(src) {
        this.stopBGM();
        if (!src) return;
        this._bgmAudio = new Audio(src);
        this._bgmAudio.loop = true;
        this._bgmAudio.volume = 0.5;
        this._bgmAudio.play().catch(() => {});
    }

    stopBGM() {
        if (this._bgmAudio) {
            this._bgmAudio.pause();
            this._bgmAudio.src = '';
            this._bgmAudio = null;
        }
    }

    playSplashMusic(src) {
        this.stopSplashMusic();
        if (!src) return;
        this._splashAudio = new Audio(src);
        this._splashAudio.loop = true;
        this._splashAudio.volume = 0.5;
        this._splashAudio.play().catch(() => {});
    }

    stopSplashMusic() {
        if (this._splashAudio) {
            this._splashAudio.pause();
            this._splashAudio.src = '';
            this._splashAudio = null;
        }
    }

    playSFX(src) {
        if (!src) return;
        const audio = new Audio(src);
        audio.volume = 0.8;
        audio.play().catch(() => {});
    }

    // ======================== LEVEL LOADING ========================

    /**
     * Hot-swap to a new level while staying in game mode.
     * Does NOT show the title/splash screen, does NOT enter edit mode.
     */
    async loadLevel(index) {
        if (index < 0 || index >= this.app.editor.levels.length) {
            console.warn('[GameManager] loadLevel: index out of range', index);
            if (index >= this.app.editor.levels.length && this.app.editor.levels.length > 0) {
                this.showEndScreen();
            }
            return;
        }

        // Snapshot session at call time — if start() runs while we await, abort
        const mySession = this.sessionId;

        // ── 1. Mark as loading (still "playing" = no editor) ──────────────────
        const wasPlaying = this.isPlaying;
        this.isPlaying = false; // Pause game loop temporarily

        // Stop current audio (BGM) and timers
        this.stopBGM();
        if (this.flyTimer) { clearTimeout(this.flyTimer); this.flyTimer = null; }

        // Stop all mixers
        if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
        this.enemyMixers.forEach(m => m.stopAllAction());
        this.enemyMixers = [];

        // Clear bullets
        this.bullets.forEach(b => { if (b.mesh.parent) b.mesh.parent.remove(b.mesh); });
        this.bullets = [];

        // Clear runtime data
        this.enemyRuntimeData.clear();
        this.bonusRuntimeData.clear();
        this.translatingObjects = [];
        this.actions = {};
        this.activeAction = null;
        this.keys.clear();

        // ── 2. Quick "loading" overlay (no title/splash) ───────────────────────
        const splashEl = document.getElementById('game-splash');
        const splashTitle = document.getElementById('splash-title');
        const splashSubtitle = document.querySelector('#game-splash .splash-subtitle');
        const splashLevelName = document.getElementById('splash-level-name');
        const splashPrompt = document.querySelector('#game-splash .splash-prompt');

        const levelData = this.app.editor.levels[index];
        if (splashEl) {
            if (splashTitle) splashTitle.textContent = levelData?.name || `Livello ${index}`;
            if (splashSubtitle) splashSubtitle.textContent = 'Caricamento...';
            if (splashLevelName) splashLevelName.textContent = '';
            if (splashPrompt) splashPrompt.style.display = 'none';
            splashEl.classList.remove('hidden', 'splash-fade-out');
            this.splashActive = true;
        }

        // ── 3. Load the new level data into the editor scene ──────────────────
        await this.app.editor.loadLevelByIndex(index);

        // *** SESSION CHECK: if dismiss() + start() ran while we were awaiting, abort ***
        if (this.sessionId !== mySession) {
            console.warn('[GameManager] loadLevel: session changed, aborting stale continuation');
            return;
        }

        // ── 4. Re-initialize game state for the new scene ─────────────────────
        this.isPlaying = true;
        this.score = 0;
        this.lives = 3;
        this.velocity.set(0, 0, 0);
        this.onGround = false;
        this.invulnerabilityTimer = 0;
        this.jumpCount = 0;
        this.lastMoveDir = 1;
        this.lanternCooldownTimer = 0;
        this.actionLocked = false;
        this.firstFrame = true;
        this.initialStates = [];
        this.playStartStates = [];

        // BVH + material setup (same as start())
        this.app.editor.objects.forEach(o => {
            try { o.updateMatrixWorld(true); } catch (e) {}
            const state = {
                uuid: o.uuid,
                p: o.position.clone(),
                r: o.rotation.clone(),
                s: o.scale.clone(),
                visible: o.visible,
                isAsset: o.userData.isAsset
            };
            this.initialStates.push(state);
            this.playStartStates.push({ uuid: o.uuid, p: o.position.clone() });

            if (o.isMesh && !o.userData.isPlayer && !o.userData.isHelper && !o.userData.isCamera) {
                if (!o.geometry.boundsTree) o.geometry.computeBoundsTree();
            }
            if (o.userData.glbSource && o.material) {
                if (o.userData.type === 'Enemy' || o.userData.type === 'Boss') {
                    o.material.visible = true; o.material.wireframe = true;
                    o.material.transparent = true; o.material.opacity = 0.5;
                } else {
                    o.material.visible = false;
                }
            }
            if (o.userData.type === 'catcher_base' || o.userData.type === 'catcher_target' ||
                o.userData.type === 'Catcher' || o.userData.type === 'Collision') {
                o.visible = false;
            }
            const arrow = o.getObjectByName('ArrowHelper');
            if (arrow) arrow.visible = false;

            this.safeTraverse(o, child => {
                if (child.isMesh && !child.userData.isPlayer && !child.userData.isHelper) {
                    if (!child.geometry.boundsTree) child.geometry.computeBoundsTree();
                }
            });

            // Reset runtime flags
            if (o.userData.type === 'Goal') o.userData.triggered = false;
            if (o.userData.type === 'Collision') o.userData.triggered = false;
            if (o.userData.type === 'Bonus') o.userData.collected = false;
            if (o.userData.type === 'PowerUp') o.userData.collected = false;
        });

        if (this.app.editor.linkGroup) this.app.editor.linkGroup.visible = false;

        // Find player & camera
        this.player = this.app.editor.objects.find(o => o.userData.isPlayer);
        this.gameCameraObj = this.app.editor.objects.find(o => o.userData.isCamera);

        if (this.gameCameraObj) {
            const cam = this.app.sceneManager.camera;
            this.gameCameraObj.updateMatrixWorld(true);
            cam.position.copy(this.gameCameraObj.position);
            cam.quaternion.copy(this.gameCameraObj.quaternion);
            cam.fov = this.gameCameraObj.userData.fov || 60;
            cam.updateProjectionMatrix();
            this.gameCameraObj.visible = false;
            if (this.player) {
                this.cameraOffset = this.gameCameraObj.position.clone().sub(this.player.position);
                if (this.gameCameraObj.userData.type !== '8WAY') {
                    const invQ = this.player.quaternion.clone().invert();
                    this.cameraOffset.applyQuaternion(invQ);
                }
            }
        }

        // Player mixer
        if (this.player) {
            this.player.userData.mode = 'normal';
            const model = this.player.getObjectByName('model');
            if (model) {
                model.traverse(child => { if (child.isMesh) child.frustumCulled = false; });
                this.mixer = new THREE.AnimationMixer(model);
                (this.player.animations || []).forEach(clip => { this.actions[clip.name] = this.mixer.clipAction(clip); });
                const idleAction = (this.player.userData.actions || []).find(a => a.type === 'Idle' && a.anim && a.active);
                if (idleAction && this.actions[idleAction.anim]) {
                    this.activeAction = this.actions[idleAction.anim];
                    this.activeAction.play();
                    this.mixer.update(0);
                }
            }
        }

        // Enemies & Bonuses
        this.app.editor.objects.forEach(o => {
            if (o.userData.type === 'Enemy') {
                const model = o.getObjectByName('model');
                let mixer = null;
                const animations = o.animations || (model ? model.animations : []);
                if (model && animations && animations.length > 0) {
                    mixer = new THREE.AnimationMixer(model);
                    this.enemyMixers.push(mixer);
                    const startAnim = o.userData.animIdle;
                    if (startAnim) {
                        const clip = animations.find(c => c.name === startAnim);
                        if (clip) { mixer.clipAction(clip).play(); mixer.update(0); }
                    }
                }
                this.enemyRuntimeData.set(o.uuid, {
                    patrolDir: 1, initialPos: o.position.clone(), initialRot: o.rotation.clone(),
                    velocity: new THREE.Vector3(), mixer, frozen: !!o.userData.isFrozen,
                    currentAnim: o.userData.animIdle
                });
            } else if (o.userData.type === 'Bonus') {
                o.userData.collected = false;
                const model = o.getObjectByName('model');
                let mixer = null;
                const animations = o.animations || (model ? model.animations : []);
                if (model && animations && animations.length > 0) {
                    mixer = new THREE.AnimationMixer(model);
                    this.enemyMixers.push(mixer);
                    if (o.userData.animIdle) {
                        const clip = animations.find(c => c.name === o.userData.animIdle);
                        if (clip) { mixer.clipAction(clip).play(); mixer.update(0); }
                    }
                }
                this.bonusRuntimeData.set(o.uuid, { patrolDir: 1, initialPos: o.position.clone(), mixer });
            } else if (o.userData.type === 'Model') {
                const model = o.getObjectByName('model');
                const animations = o.animations || (model ? model.animations : []);
                if (model && animations.length > 0) {
                    const mixer = new THREE.AnimationMixer(model);
                    this.enemyMixers.push(mixer);
                    if (o.userData.defaultAnim) {
                        const clip = animations.find(c => c.name === o.userData.defaultAnim);
                        if (clip) { mixer.clipAction(clip).play(); mixer.update(0); }
                    }
                }
            } else if (o.userData.type === 'PowerUp') {
                o.userData.isAsset = true;
                const model = o.getObjectByName('model');
                const animations = o.animations || (model ? model.animations : []);
                if (model && animations && animations.length > 0) {
                    const mixer = new THREE.AnimationMixer(model);
                    this.enemyMixers.push(mixer);
                    if (o.userData.defaultAnim) {
                        const clip = animations.find(c => c.name === o.userData.defaultAnim);
                        if (clip) { mixer.clipAction(clip).play(); mixer.update(0); }
                    }
                }
            } else if (o.userData.type === 'Collision') {
                o.userData.triggered = false;
            }
        });

        this.updateHUD();

        // ── 5. Reset clock to avoid massive first-frame dt spike ─────────────
        this.clock.start();

        // ── 6. Start BGM for the new level ────────────────────────────────────
        if (levelData?.music) this.playBGM(levelData.music);

        // ── 7. Dismiss loading overlay quickly (no "press key" required) ──────
        if (splashEl) {
            setTimeout(() => {
                splashEl.classList.add('splash-fade-out');
                setTimeout(() => {
                    splashEl.classList.add('hidden');
                    splashEl.classList.remove('splash-fade-out');
                    if (splashPrompt) splashPrompt.style.display = '';
                }, 420);
                this.splashActive = false;
            }, 600);
        }

        // Ensure play button stays active
        const btnPlay = document.getElementById('btn-play');
        if (btnPlay) btnPlay.classList.add('play-active');
    }

    // ======================== END SCREEN ========================

    showEndScreen() {
        // Guard: don't show twice
        if (this.isEndScreen) return;

        const ed = this.app.editor;
        const el = document.getElementById('game-endscreen');
        if (!el) { this._stopInternal(); return; }

        // ── 1. Stop all game activity ─────────────────────────────────────────
        // Remove game key listeners before switching state
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('blur', this.onBlur);
        this.app.sceneManager.renderer.domElement.removeEventListener('mousedown', this.onMouseDownLock);
        document.exitPointerLock?.();

        // Stop mixers & physics
        if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
        this.enemyMixers.forEach(m => m.stopAllAction());
        this.enemyMixers = [];
        this.bullets.forEach(b => { if (b.mesh.parent) b.mesh.parent.remove(b.mesh); });
        this.bullets = [];
        this.keys.clear();
        if (this.flyTimer) { clearTimeout(this.flyTimer); this.flyTimer = null; }

        // Stop audio
        this.stopBGM();
        this.stopSplashMusic();

        // ── 2. Switch to END SCREEN state (blocks both game & editor loops) ───
        this.isPlaying = false;
        this.isEndScreen = true;

        // ── 3. Prepare UI ─────────────────────────────────────────────────────
        const hud = document.getElementById('game-hud');
        if (hud) hud.classList.add('hidden');

        const titleEl = document.getElementById('endscreen-title');
        const subtitleEl = document.getElementById('endscreen-subtitle');
        if (titleEl) titleEl.textContent = ed.gameEndTitle || '🏆 GIOCO COMPLETATO!';
        if (subtitleEl) subtitleEl.textContent = ed.gameEndSubtitle || '';

        // ── 4. Video / Image background ───────────────────────────────────────
        const videoEl = document.getElementById('endscreen-video');
        const imageEl = document.getElementById('endscreen-image');

        if (ed.gameEndVideo) {
            if (videoEl) {
                // Reset src first to force reload (avoids stale buffer issues)
                videoEl.pause();
                videoEl.removeAttribute('src');
                videoEl.load();

                videoEl.loop  = true;
                videoEl.muted = true;  // Required for autoplay policy

                // Apply aspect ratio style
                const aspect = ed.gameEndVideoAspect || 'cover';
                // Reset positioning first
                videoEl.style.position = 'absolute';
                videoEl.style.top = '50%';
                videoEl.style.left = '50%';
                videoEl.style.transform = 'translate(-50%, -50%)';
                videoEl.style.width = '100%';
                videoEl.style.height = '100%';
                videoEl.style.objectFit = 'cover';
                videoEl.style.maxWidth = '';
                videoEl.style.maxHeight = '';

                if (aspect === 'contain') {
                    videoEl.style.objectFit = 'contain';
                } else if (aspect === '16/9') {
                    // Force 16:9 box centered
                    videoEl.style.width = '100%';
                    videoEl.style.height = '100%';
                    videoEl.style.objectFit = 'contain';
                    // Use aspect-ratio for modern browsers
                    videoEl.style.aspectRatio = '16/9';
                } else if (aspect === 'vertical') {
                    // Portrait (9:16) centered
                    videoEl.style.width = 'auto';
                    videoEl.style.height = '100%';
                    videoEl.style.objectFit = 'contain';
                    videoEl.style.aspectRatio = '9/16';
                } else if (aspect === 'horizontal') {
                    videoEl.style.width = '100%';
                    videoEl.style.height = 'auto';
                    videoEl.style.objectFit = 'fill';
                } else {
                    // 'cover' = default — fills the container
                    videoEl.style.objectFit = 'cover';
                }

                videoEl.style.display = 'block';

                const tryPlay = () => { videoEl.play().catch(() => {}); };
                videoEl.src = ed.gameEndVideo;
                videoEl.load();
                videoEl.addEventListener('canplaythrough', tryPlay, { once: true });
            }
            if (imageEl) imageEl.style.display = 'none';
        } else if (ed.gameEndImage) {
            if (imageEl) { imageEl.src = ed.gameEndImage; imageEl.style.display = 'block'; }
            if (videoEl) videoEl.style.display = 'none';
        } else {
            if (videoEl) videoEl.style.display = 'none';
            if (imageEl) imageEl.style.display = 'none';
        }

        if (ed.gameEndMusic && !ed.gameEndVideo) this.playBGM(ed.gameEndMusic);

        // ── 5. Show overlay ───────────────────────────────────────────────────
        el.classList.remove('hidden', 'endscreen-fade-out');

        // ── 6. Dismiss handler (key or click → fade → go to Home) ────────────
        const dismiss = () => {
            window.removeEventListener('keydown', dismiss);
            window.removeEventListener('pointerdown', dismiss);

            // Stop video & audio
            if (videoEl) { videoEl.pause(); videoEl.src = ''; videoEl.load(); }
            this.stopBGM();

            // Fade out then transition to Home
            el.classList.add('endscreen-fade-out');
            setTimeout(() => {
                el.classList.add('hidden');
                el.classList.remove('endscreen-fade-out');

                // Full cleanup (restores editor state, camera, orbit, etc.)
                this._stopInternal();

                // Re-launch from starting level (shows title splash)
                const startIdx = (ed.startingLevelIndex >= 0 && ed.startingLevelIndex < ed.levels.length)
                    ? ed.startingLevelIndex : 0;
                if (ed.levels.length > 0) {
                    ed.loadLevelByIndex(startIdx).then(() => {
                        this.start(startIdx);
                        const btnPlay = document.getElementById('btn-play');
                        if (btnPlay) btnPlay.classList.add('play-active');
                    });
                }
            }, 500);
        };

        // Delay so the key that triggered the Goal doesn't immediately dismiss
        setTimeout(() => {
            window.addEventListener('keydown', dismiss);
            window.addEventListener('pointerdown', dismiss);
        }, 500);
    }
}