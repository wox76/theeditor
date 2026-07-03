import * as THREE from 'three';
import { PlayerFactory } from './Player.js';

export class AIManager {
    constructor(app) {
        this.app = app;
        this.panel = null;
        this.chatInput = null;
        this.chatHistory = null;
        this.sendBtn = null;
        this.toggleBtn = null;
        this.ollamaUrl = 'http://localhost:11434/api/chat';
        this.modelName = 'gemma4:e2b';
        this.messages = [];
        this.isGenerating = false;
    }

    init() {
        this.createUIElements();
        this.bindEvents();
        this.setupSystemPrompt();
    }

    setupSystemPrompt() {
        this.messages = [
            {
                role: 'system',
                content: `You are the local AI Assistant for the Wox Engine (also known as THE EDITOR), a 3D web-based game engine.
Your goal is to help the user build their 3D game level by answering questions and generating executable JavaScript scripts.

When the user asks you to modify, create, configure, or clear the game level/settings, you MUST output a JavaScript code block inside a \`\`\`javascript ... \`\`\` block containing code to execute in the editor context.
The JavaScript code will have direct access to the global \`app\` object (representing the running Wox Engine application).

Key variables and methods you can use:
- \`app.editor.objects\`: Array of all active objects in the scene.
- \`app.editor.addObject(mesh)\`: Adds a 3D object/mesh to the scene.
- \`app.editor.clearScene()\`: Resets the level.
- \`app.editor.selected\`: The currently selected object.
- \`app.editor.select(object)\`: Selects an object.
- \`app.sceneManager.scene\`: The Three.js Scene object.
- \`app.sceneManager.setPixelEffect(enabled, size)\`: Toggles retro pixelated shader.
- \`app.sceneManager.setShadows(enabled)\`: Toggles shadow maps.

You can also use these simplified helper methods on \`app.ai\`:
- \`app.ai.spawnAssetDirect(type, [x,y,z], [sx,sy,sz], [rx,ry,rz], name, data)\`: Spawns an asset.
  - Types: 'Player', 'Enemy', 'Bonus', 'Boss', 'Catcher', 'Spawn', 'Goal', 'PowerUp', 'Collision', 'PointLight', 'SpotLight', 'DirectionalLight', 'SplatEnv'.
  - Default properties are assigned automatically.
  - For 'SplatEnv' (3D Gaussian Splatting), the 'data' parameter must specify the relative path/URL of the .splat or .ply file (e.g. 'assets/corridoio' or 'assets/corridoio.ply').
- \`app.ai.editAssetDirect(name, properties, positionArray, scaleArray, rotationArray)\`: Edits an object by name. If name is null/omitted, edits selected object.
- \`app.ai.editGamePropsDirect(properties)\`: Edits game properties (e.g. {title: "Title", subtitle: "Subtitle", pixelEffect: true, pixelSize: 4}).
- \`app.ai.setupFPSTemplate()\`: Automatically configures an FPS (First Person Shooter) game template. Creates/configures Player, Camera, standard FPS keys, shadows, and PBR.
- \`app.ai.setupPlatformTemplate()\`: Automatically configures a 2.5D Platform game template with double jump enabled.
- \`app.ai.setup8WayTemplate()\`: Automatically configures an 8-Way (Commando style) top-down/isometric game template.

Examples:
- To spawn 5 enemies in a circle:
\`\`\`javascript
const radius = 5;
for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    app.ai.spawnAssetDirect('Enemy', [x, 0.4, z], [1,1,1], [0,0,0], 'Enemy_' + i);
}
\`\`\`
- To spawn a 3D Gaussian Splatting scene at the origin:
\`\`\`javascript
app.ai.spawnAssetDirect('SplatEnv', [0, 0, 0], [1, 1, 1], [0, 0, 0], 'Corridoio', 'assets/corridoio');
\`\`\`

Always write standard, modern, valid vanilla ES6 JavaScript inside the \`\`\`javascript block. Do not write text inside the code block. Explain your actions briefly in the language the user wrote their prompt in (e.g. English, Italian, Spanish, French, etc.) before or after the code block.`
            }
        ];
    }

    createUIElements() {
        // Toggle button in left panel toolbox header
        const toolboxHeader = document.querySelector('#left-panel .panel-header');
        if (toolboxHeader) {
            this.toggleBtn = document.createElement('button');
            this.toggleBtn.id = 'btn-toggle-ai';
            this.toggleBtn.className = 'action-btn';
            this.toggleBtn.style.cssText = 'width: auto; padding: 2px 8px; margin-left: 10px; font-size: 13px; font-weight: bold; border-color: var(--accent); color: var(--accent); background: transparent;';
            this.toggleBtn.innerHTML = '🤖 AI';
            toolboxHeader.appendChild(this.toggleBtn);
        }

        // Add AI panel inside workspace
        const workspace = document.getElementById('workspace');
        if (workspace) {
            // Find left panel and its resizer
            const leftPanel = document.getElementById('left-panel');
            const resizerLeft = document.getElementById('resizer-left');

            this.panel = document.createElement('aside');
            this.panel.id = 'ai-panel';
            this.panel.className = 'hidden';
            this.panel.style.cssText = 'width: 300px; min-width: 200px; background-color: var(--bg-panel); display: flex; flex-direction: column; border-right: 1px solid var(--border);';
            this.panel.innerHTML = `
                <div class="panel-header" style="display:flex; justify-content:space-between; align-items:center; gap:5px; flex-wrap:wrap; font-size: 11px;">
                    <span style="font-weight:bold; white-space:nowrap;">🤖 AI Wox</span>
                    <select id="ai-model-select" style="background:#181818; border:1px solid #444; color:white; font-size:10px; padding:2px; border-radius:3px; max-width:140px; cursor:pointer; font-family:inherit;"></select>
                    <span id="btn-close-ai" style="cursor:pointer; font-size:16px; padding:2px 6px; color:var(--text-muted);">&times;</span>
                </div>
                <div class="panel-content" style="display:flex; flex-direction:column; height:calc(100% - 35px); padding:10px; gap:8px;">
                    <div id="ai-chat-history" style="flex:1; overflow-y:auto; background:#181818; border:1px solid #222; border-radius:4px; padding:8px; display:flex; flex-direction:column; gap:8px;">
                        <div class="ai-msg ai-msg-system" style="color:#aaa; font-style:italic; font-size:13px; line-height:1.4;">
                            Ciao! Sono il tuo assistente AI locale (Gemma 4). Posso aiutarti a posizionare oggetti, configurare il giocatore o impostare la grafica. Prova un'azione rapida o scrivimi una richiesta!
                        </div>
                    </div>
                    <div class="ai-quick-actions" style="display:flex; gap:4px; flex-wrap:wrap; margin-bottom:4px;">
                        <button class="ai-quick-btn" data-prompt="Aggiungi 3 nemici in fila a x=0, z=5, z=10" style="font-size:12px; padding:3px 6px; background:#383838; border:1px solid #555; color:#ddd; border-radius:4px; cursor:pointer;">👿 3 Nemici</button>
                        <button class="ai-quick-btn" data-prompt="Aggiungi una linea di monete Bonus (stelle) davanti al giocatore" style="font-size:12px; padding:3px 6px; background:#383838; border:1px solid #555; color:#ddd; border-radius:4px; cursor:pointer;">⭐ Linea Monete</button>
                        <button class="ai-quick-btn" data-prompt="Attiva l'effetto pixelated a 4 pixel e abilita le ombre" style="font-size:12px; padding:3px 6px; background:#383838; border:1px solid #555; color:#ddd; border-radius:4px; cursor:pointer;">👾 Pixel Art</button>
                        <button class="ai-quick-btn" data-prompt="Configura il player per correre veloce (sprint) ed effettuare super salti" style="font-size:12px; padding:3px 6px; background:#383838; border:1px solid #555; color:#ddd; border-radius:4px; cursor:pointer;">🏃 Super Sprint</button>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <textarea id="ai-chat-input" placeholder="Chiedimi di creare o modificare..." style="flex:1; background:#181818; border:1px solid #444; border-radius:4px; color:white; padding:6px; font-size:13px; resize:none; height:45px; font-family:inherit;"></textarea>
                        <button id="btn-send-ai" style="background:var(--accent); border:none; border-radius:4px; color:white; width:45px; height:45px; cursor:pointer; font-weight:bold; font-size:13px; display:flex; align-items:center; justify-content:center;">Invia</button>
                    </div>
                </div>
            `;

            this.resizer = document.createElement('div');
            this.resizer.id = 'resizer-ai';
            this.resizer.className = 'resizer resizer-v hidden';
            
            // Insert AI panel after leftPanel resizer
            if (resizerLeft) {
                resizerLeft.after(this.panel);
                this.panel.after(this.resizer);
            } else {
                workspace.prepend(this.resizer);
                workspace.prepend(this.panel);
            }
        }

        this.chatInput = document.getElementById('ai-chat-input');
        this.chatHistory = document.getElementById('ai-chat-history');
        this.sendBtn = document.getElementById('btn-send-ai');
    }

    bindEvents() {
        if (this.toggleBtn) {
            this.toggleBtn.onclick = () => this.togglePanel();
        }

        const closeBtn = document.getElementById('btn-close-ai');
        if (closeBtn) {
            closeBtn.onclick = () => this.togglePanel(false);
        }

        if (this.sendBtn) {
            this.sendBtn.onclick = () => this.handleSendMessage();
        }

        if (this.chatInput) {
            this.chatInput.onkeydown = (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.handleSendMessage();
                }
            };
        }

        document.querySelectorAll('.ai-quick-btn').forEach(btn => {
            btn.onclick = (e) => {
                const prompt = e.currentTarget.dataset.prompt;
                if (this.chatInput) {
                    this.chatInput.value = prompt;
                    this.handleSendMessage();
                }
            };
        });

        // Initialize resizer
        if (this.resizer && this.panel) {
            this.resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = this.panel.offsetWidth;
                const onMove = (mv) => {
                    this.panel.style.width = Math.max(150, startW + (mv.clientX - startX)) + 'px';
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }
    }

    togglePanel(show = null) {
        if (show === null) {
            show = this.panel.classList.contains('hidden');
        }

        if (show) {
            this.panel.classList.remove('hidden');
            this.resizer.classList.remove('hidden');
            this.toggleBtn.style.background = 'var(--accent)';
            this.toggleBtn.style.color = '#white';
            this.checkOllamaAndModel();
        } else {
            this.panel.classList.add('hidden');
            this.resizer.classList.add('hidden');
            this.toggleBtn.style.background = 'transparent';
            this.toggleBtn.style.color = 'var(--accent)';
        }
    }

    async checkOllamaAndModel() {
        this.appendMessage('system', '🔍 Verifica dello stato di Ollama...');
        try {
            const tagsRes = await fetch('http://localhost:11434/api/tags');
            if (!tagsRes.ok) throw new Error('Ollama non risponde.');
            
            await this.loadDownloadedModels();
            
            const tagsData = await tagsRes.json();
            const models = tagsData.models || [];
            const hasModel = models.some(m => m.name.startsWith(this.modelName) || m.model.startsWith(this.modelName));
            
            if (hasModel) {
                this.appendMessage('system', `🧠 Caricamento del modello ${this.modelName} in memoria...`);
                // Preload model
                await fetch('http://localhost:11434/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: this.modelName, keep_alive: '10m' })
                });
                this.appendMessage('system', `✅ Ollama attivo e modello ${this.modelName} pronto!`);
            } else {
                this.appendMessage('system', `⚠️ Modello ${this.modelName} non trovato su Ollama. Avvio del pull...`);
                // Attempt to pull the model if not found
                fetch('http://localhost:11434/api/pull', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: this.modelName })
                });
            }
        } catch (err) {
            this.appendMessage('system', '⚠️ Ollama non è attivo. Avvio del server in corso (attendi qualche secondo)...');
            // Try to reconnect
            setTimeout(() => this.checkOllamaAndModel(), 4000);
        }
    }

    async loadDownloadedModels() {
        const modelSelect = document.getElementById('ai-model-select');
        if (!modelSelect) return;

        try {
            const tagsRes = await fetch('http://localhost:11434/api/tags');
            if (!tagsRes.ok) throw new Error('Ollama offline');
            const data = await tagsRes.json();
            const models = data.models || [];
            
            modelSelect.innerHTML = '';
            if (models.length === 0) {
                modelSelect.innerHTML = `<option value="">Nessun modello</option>`;
                return;
            }
            
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.name;
                opt.textContent = m.name;
                if (m.name === this.modelName || m.name.startsWith(this.modelName)) {
                    opt.selected = true;
                    this.modelName = m.name; // sync
                }
                modelSelect.appendChild(opt);
            });

            modelSelect.onchange = (e) => {
                this.modelName = e.target.value;
                this.appendMessage('system', `🔄 Modello AI cambiato in: ${this.modelName}`);
                fetch('http://localhost:11434/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: this.modelName, keep_alive: '10m' })
                });
            };
        } catch (err) {
            console.warn('[AI Model Loader] Failed to load tags:', err);
            modelSelect.innerHTML = `<option value="">Ollama offline</option>`;
        }
    }

    appendMessage(role, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `ai-msg ai-msg-${role}`;
        
        let headerColor = '#eb7b33';
        let headerName = 'Gemma 4';
        let bg = '#252525';
        if (role === 'user') {
            headerColor = '#4caf50';
            headerName = 'Tu';
            bg = '#223022';
        } else if (role === 'system') {
            headerColor = '#888';
            headerName = 'Sistema';
            bg = '#1d1d1d';
        }

        msgDiv.style.cssText = `background:${bg}; border-radius:4px; padding:6px 8px; font-size:13px; line-height:1.4; color:#eee; border-left: 3px solid ${headerColor};`;
        msgDiv.innerHTML = `
            <div style="font-weight:bold; color:${headerColor}; margin-bottom:2px; font-size:11px;">${headerName}</div>
            <div class="msg-content" style="white-space:pre-wrap; word-break:break-word;">${text}</div>
        `;
        this.chatHistory.appendChild(msgDiv);
        this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
        return msgDiv;
    }

    async handleSendMessage() {
        if (this.isGenerating) return;
        const text = this.chatInput.value.trim();
        if (!text) return;

        this.chatInput.value = '';
        this.appendMessage('user', text);
        this.messages.push({ role: 'user', content: text });

        this.isGenerating = true;
        const botMsgDiv = this.appendMessage('assistant', 'Connessione a Gemma 4 in corso...');
        const botContentDiv = botMsgDiv.querySelector('.msg-content');

        try {
            const response = await fetch(this.ollamaUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.modelName,
                    messages: this.messages,
                    stream: true
                })
            });

            if (!response.ok) {
                throw new Error('Errore di comunicazione con Ollama.');
            }

            botContentDiv.innerHTML = '';
            let fullText = '';
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.trim() !== '') {
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.message?.content) {
                                fullText += parsed.message.content;
                                botContentDiv.textContent = fullText;
                                this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
                            }
                        } catch (e) {
                            // Ignora linee parziali
                        }
                    }
                }
            }

            this.messages.push({ role: 'assistant', content: fullText });
            this.executeAICommands(fullText);

        } catch (err) {
            console.error(err);
            botContentDiv.style.color = '#ff4444';
            botContentDiv.textContent = `Impossibile comunicare con l'AI locale. Assicurati che Ollama sia avviato con Gemma 4:
Errore: ${err.message}`;
        } finally {
            this.isGenerating = false;
        }
    }

    executeAICommands(text) {
        let executedCount = 0;

        // 1. Check for Javascript code blocks
        const jsRegex = /```(?:javascript|js)\s*([\s\S]*?)\s*```/g;
        let jsMatch;
        while ((jsMatch = jsRegex.exec(text)) !== null) {
            try {
                const code = jsMatch[1];
                console.log('[AI Executing JavaScript]', code);
                
                // Execute code in a safe wrapper with 'app' passed in
                const executeFn = new Function('app', code);
                executeFn(this.app);
                
                executedCount++;
                this.appendMessage('system', '✅ Script JavaScript eseguito con successo.');
            } catch (err) {
                console.error('[AI JS Execution Error]', err);
                this.appendMessage('system', `⚠️ Errore esecuzione JavaScript: ${err.message}`);
            }
        }

        // 2. Fallback: Check for JSON code blocks
        const jsonRegex = /```json\s*([\s\S]*?)\s*```/g;
        let jsonMatch;
        while ((jsonMatch = jsonRegex.exec(text)) !== null) {
            try {
                const jsonText = jsonMatch[1];
                const commands = JSON.parse(jsonText);
                if (Array.isArray(commands)) {
                    commands.forEach(cmd => {
                        this.runCommand(cmd);
                        executedCount++;
                    });
                }
            } catch (err) {
                console.error('[AI JSON Command Exec Error]', err);
                this.appendMessage('system', `Errore esecuzione comandi JSON: ${err.message}`);
            }
        }

        if (executedCount > 0) {
            // Rebuild outliner, properties, levels, and lists
            this.app.ui.rebuildLibrary();
            this.app.ui.updateProperties();
            this.app.ui.updateOutliner();
            if (this.app.editor.updateLinks) this.app.editor.updateLinks();
        }
    }

    runCommand(cmd) {
        console.log('[AI Executing]', cmd);
        switch (cmd.action) {
            case 'spawn':
                this.spawnAssetDirect(cmd.type, cmd.position, cmd.scale, cmd.rotation, cmd.name, cmd.data);
                break;
            case 'edit':
                this.editAssetDirect(cmd.name, cmd.properties, cmd.position, cmd.scale, cmd.rotation);
                break;
            case 'gameProps':
                this.editGamePropsDirect(cmd);
                break;
            case 'clear':
                this.app.editor.clearScene();
                break;
            default:
                console.warn('[AI Unknown Action]', cmd.action);
        }
    }

    spawnAssetDirect(type, posArr = [0, 0, 0], scaleArr = [1, 1, 1], rotArr = [0, 0, 0], name = null, data = null) {
        const editor = this.app.editor;
        const pos = new THREE.Vector3(posArr[0], posArr[1], posArr[2]);
        const scale = new THREE.Vector3(scaleArr[0], scaleArr[1], scaleArr[2]);
        const rotation = new THREE.Euler(
            THREE.MathUtils.degToRad(rotArr[0] || 0),
            THREE.MathUtils.degToRad(rotArr[1] || 0),
            THREE.MathUtils.degToRad(rotArr[2] || 0)
        );

        if (type === 'SplatEnv') {
            const wrapper = new THREE.Group();
            wrapper.position.copy(pos);
            wrapper.scale.copy(scale);
            wrapper.rotation.copy(rotation);
            wrapper.name = name || ('SplatEnv_' + editor.objects.length);
            wrapper.userData = {
                isAsset: true,
                type: 'SplatEnv',
                splatSource: data || '',
                glbFilename: name || 'splat',
                hasCollision: false
            };
            if (data) {
                import('@sparkjsdev/spark').then(({ SplatMesh }) => {
                    try {
                        const blobUrl = data.startsWith('data:') ? editor._dataUrlToBlobUrl(data) : data;
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
                        console.log('[SplatEnv] SplatMesh created from spawnAssetDirect.');
                    } catch (err) {
                        console.warn('[SplatEnv] SplatMesh creation failed in spawnAssetDirect:', err);
                    }
                });
            }
            editor.addObject(wrapper);
            return;
        }

        if (type === 'Player') {
            const p = PlayerFactory.createPlayer(editor.objects.length);
            p.position.copy(pos);
            p.scale.copy(scale);
            p.rotation.copy(rotation);
            editor.addObject(p);
            return;
        }

        let geo, mat = new THREE.MeshStandardMaterial({ color: 0x888888, wireframe: true, transparent: true, opacity: 0.5 });
        let isLight = false;

        switch (type) {
            case 'Enemy':
                geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
                mat.color.setHex(0xff6600);
                break;
            case 'Bonus': geo = new THREE.SphereGeometry(0.4); mat.color.setHex(0xFFD700); break;
            case 'Boss': geo = new THREE.BoxGeometry(1.5, 1.5, 1.5); mat.color.setHex(0xcc0000); break;
            case 'Catcher': geo = new THREE.CylinderGeometry(0.5, 0.5, 0.2); mat.color.setHex(0x5500aa); break;
            case 'Spawn': geo = new THREE.ConeGeometry(0.5, 1, 4); mat.color.setHex(0xaa5500); break;
            case 'Goal': geo = new THREE.BoxGeometry(1, 0.1, 1); mat.color.setHex(0xD4AF37); break;
            case 'PowerUp': geo = new THREE.BoxGeometry(0.5, 0.5, 0.5); mat.color.setHex(0x00cccc); break;
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
        mesh.position.copy(pos);
        mesh.scale.copy(scale);
        mesh.rotation.copy(rotation);
        mesh.name = name || (type + "_" + editor.objects.length);
        mesh.userData = { isAsset: true, type: type };

        if (isLight) {
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.userData.color = mat.color.getHex();
            mesh.userData.intensity = 1.0;
            mesh.userData.distance = (type === 'DirectionalLight') ? 0 : 10;

            let lightObj;
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
                mesh.add(lightObj);
            }
        }

        if (type === 'Bonus') {
            mesh.userData.radius = 0.4;
            mesh.userData.points = 100;
            mesh.userData.disappearOnCollect = true;
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

        editor.addObject(mesh);
    }

    editAssetDirect(name, properties, posArr, scaleArr, rotArr) {
        let obj = this.app.editor.selected;
        if (name) {
            const found = this.app.editor.objects.find(o => o.name === name);
            if (found) obj = found;
        }

        if (!obj) {
            console.warn('[AI Edit] No object selected or found by name:', name);
            return;
        }

        if (posArr) {
            obj.position.set(posArr[0], posArr[1], posArr[2]);
        }
        if (scaleArr) {
            obj.scale.set(scaleArr[0], scaleArr[1], scaleArr[2]);
        }
        if (rotArr) {
            obj.rotation.set(
                THREE.MathUtils.degToRad(rotArr[0] || 0),
                THREE.MathUtils.degToRad(rotArr[1] || 0),
                THREE.MathUtils.degToRad(rotArr[2] || 0)
            );
        }

        if (properties) {
            Object.assign(obj.userData, properties);
        }
    }

    editGamePropsDirect(cmd) {
        const editor = this.app.editor;
        if (cmd.title !== undefined) {
            editor.gameTitle = cmd.title;
            const el = document.getElementById('game-title-input');
            if (el) el.value = cmd.title;
        }
        if (cmd.subtitle !== undefined) {
            editor.gameSplashSubtitle = cmd.subtitle;
            const el = document.getElementById('game-subtitle-input');
            if (el) el.value = cmd.subtitle;
        }
        if (cmd.pixelEffect !== undefined) {
            const size = cmd.pixelSize !== undefined ? cmd.pixelSize : 4;
            this.app.sceneManager.setPixelEffect(cmd.pixelEffect, size);
            const elEff = document.getElementById('game-pixel-effect');
            const elSz = document.getElementById('game-pixel-size');
            if (elEff) elEff.checked = cmd.pixelEffect;
            if (elSz) elSz.value = size;
        }
        if (cmd.shadows !== undefined) {
            this.app.sceneManager.setShadows(cmd.shadows);
            const el = document.getElementById('game-shadows');
            if (el) el.checked = cmd.shadows;
        }
        if (cmd.pbr !== undefined) {
            this.app.sceneManager.setPBROutput(cmd.pbr);
            const el = document.getElementById('game-pbr');
            if (el) el.checked = cmd.pbr;
        }
    }

    setupFPSTemplate() {
        const editor = this.app.editor;
        
        // 1. Find or spawn Player
        let player = editor.objects.find(o => o.userData.isPlayer);
        if (!player) {
            const p = PlayerFactory.createPlayer(editor.objects.length);
            p.position.set(0, 1.0, 0);
            editor.addObject(p);
            player = p;
        }
        
        // Configure Player as FPS
        player.userData.typology = 'fps';
        player.userData.speed = 0.4;
        player.userData.jumpForce = 5.0;
        player.userData.doubleJump = false;
        player.userData.canSprint = true;
        player.userData.sprintKey = 'shift';
        player.userData.sprintMult = 1.5;
        
        // Populate standard FPS actions
        player.userData.actions = [
            { name: 'Forward', key: 'w', type: 'Walk', anim: '', mirror: false, active: true },
            { name: 'Backward', key: 's', type: 'Walk', anim: '', mirror: false, active: true },
            { name: 'Left', key: 'a', type: 'Walk', anim: '', mirror: false, active: true },
            { name: 'Right', key: 'd', type: 'Walk', anim: '', mirror: false, active: true },
            { name: 'Jump', key: ' ', type: 'Jump', anim: '', mirror: false, active: true },
            { name: 'Shoot', key: 'mouse0', type: 'Shooting', anim: '', mirror: false, active: true }
        ];
        
        if (editor.autoMapPlayerAnimations) {
            editor.autoMapPlayerAnimations(player);
        }
        
        // 2. Find or spawn Camera
        let cam = editor.objects.find(o => o.userData.isCamera);
        if (!cam) {
            editor.addCamera();
            cam = editor.objects.find(o => o.userData.isCamera);
        }
        if (cam) {
            cam.userData.type = 'fps';
        }
        
        // 3. Configure Game properties
        editor.gameTitle = "FPS Game";
        editor.gameSplashSubtitle = "Created with local AI";
        
        const elTitle = document.getElementById('game-title-input');
        if (elTitle) elTitle.value = editor.gameTitle;
        const elSub = document.getElementById('game-subtitle-input');
        if (elSub) elSub.value = editor.gameSplashSubtitle;

        if (this.app.sceneManager) {
            this.app.sceneManager.setShadows(true);
            this.app.sceneManager.setPBROutput(true);
            const elShadow = document.getElementById('game-shadows');
            const elPbr = document.getElementById('game-pbr');
            if (elShadow) elShadow.checked = true;
            if (elPbr) elPbr.checked = true;
        }
        
        editor.select(player);
        console.log('[AI template] FPS template applied.');
        return player;
    }

    setupPlatformTemplate() {
        const editor = this.app.editor;
        
        let player = editor.objects.find(o => o.userData.isPlayer);
        if (!player) {
            const p = PlayerFactory.createPlayer(editor.objects.length);
            p.position.set(0, 1.0, 0);
            editor.addObject(p);
            player = p;
        }
        
        player.userData.typology = 'platform';
        player.userData.speed = 0.4;
        player.userData.jumpForce = 5.0;
        player.userData.doubleJump = true;
        player.userData.canSprint = true;
        player.userData.sprintKey = 'shift';
        player.userData.sprintMult = 1.5;
        
        player.userData.actions = [
            { name: 'Walk Right', key: 'd', type: 'Walk', anim: '', mirror: false, active: true },
            { name: 'Walk Left', key: 'a', type: 'Walk', anim: '', mirror: true, active: true },
            { name: 'Jump', key: ' ', type: 'Jump', anim: '', mirror: false, active: true },
            { name: 'Shoot', key: 'mouse0', type: 'Shooting', anim: '', mirror: false, active: true }
        ];
        
        if (editor.autoMapPlayerAnimations) {
            editor.autoMapPlayerAnimations(player);
        }
        
        let cam = editor.objects.find(o => o.userData.isCamera);
        if (!cam) {
            editor.addCamera();
            cam = editor.objects.find(o => o.userData.isCamera);
        }
        if (cam) {
            cam.userData.type = 'platform';
        }
        
        editor.gameTitle = "Platform Game";
        editor.gameSplashSubtitle = "Created with local AI";
        
        const elTitle = document.getElementById('game-title-input');
        if (elTitle) elTitle.value = editor.gameTitle;
        const elSub = document.getElementById('game-subtitle-input');
        if (elSub) elSub.value = editor.gameSplashSubtitle;
        
        editor.select(player);
        console.log('[AI template] Platform template applied.');
        return player;
    }

    setup8WayTemplate() {
        const editor = this.app.editor;
        
        let player = editor.objects.find(o => o.userData.isPlayer);
        if (!player) {
            const p = PlayerFactory.createPlayer(editor.objects.length);
            p.position.set(0, 1.0, 0);
            editor.addObject(p);
            player = p;
        }
        
        player.userData.typology = '8WAY';
        player.userData.speed = 0.4;
        player.userData.jumpForce = 5.0;
        player.userData.doubleJump = false;
        player.userData.canSprint = true;
        player.userData.sprintKey = 'shift';
        player.userData.sprintMult = 1.5;
        
        player.userData.actions = [
            { name: 'Walk Forward', key: 'w', type: 'Walk', anim: '', mirror: false, active: true },
            { name: 'Walk Backward', key: 's', type: 'Walk', anim: '', mirror: false, active: true },
            { name: 'Walk Right', key: 'd', type: 'Walk', anim: '', mirror: false, active: true },
            { name: 'Walk Left', key: 'a', type: 'Walk', anim: '', mirror: true, active: true },
            { name: 'Jump', key: ' ', type: 'Jump', anim: '', mirror: false, active: true },
            { name: 'Shoot', key: 'mouse0', type: 'Shooting', anim: '', mirror: false, active: true }
        ];
        
        if (editor.autoMapPlayerAnimations) {
            editor.autoMapPlayerAnimations(player);
        }
        
        let cam = editor.objects.find(o => o.userData.isCamera);
        if (!cam) {
            editor.addCamera();
            cam = editor.objects.find(o => o.userData.isCamera);
        }
        if (cam) {
            cam.userData.type = '8WAY';
        }
        
        editor.gameTitle = "8-Way Game";
        editor.gameSplashSubtitle = "Created with local AI";
        
        const elTitle = document.getElementById('game-title-input');
        if (elTitle) elTitle.value = editor.gameTitle;
        const elSub = document.getElementById('game-subtitle-input');
        if (elSub) elSub.value = editor.gameSplashSubtitle;
        
        editor.select(player);
        console.log('[AI template] 8WAY template applied.');
        return player;
    }
}
