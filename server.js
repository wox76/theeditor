import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const PORT = 8000;
const myPid = process.pid;
console.log(`[Server Woxengine] Starting (PID: ${myPid})...`);



// 2. Kill any process holding the port PORT
try {
    const output = execSync(`lsof -t -i:${PORT}`).toString().trim();
    if (output) {
        const pids = output.split('\n').map(p => p.trim()).filter(Boolean).map(Number);
        for (const pid of pids) {
            if (pid !== myPid) {
                try {
                    process.kill(pid, 'SIGKILL');
                    console.log(`[Server Woxengine] Abbattuto processo PID ${pid} sulla porta ${PORT}.`);
                } catch (err) {}
            }
        }
    }
} catch (e) {
    // Ignore if lsof is not installed or no process is listening on the port
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = __dirname;
const syncClients = [];

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.wscene': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json'
};

const server = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*'
        });
        res.end();
        return;
    }

    // --- API: List Projects with Thumbnails and Level Files ---
    if (req.method === 'GET' && req.url === '/api/list-projects') {
        const projectsDir = path.join(PUBLIC_DIR, 'projects');
        try {
            if (!fs.existsSync(projectsDir)) {
                fs.mkdirSync(projectsDir, { recursive: true });
            }
            const dirs = fs.readdirSync(projectsDir).filter(f => {
                return fs.statSync(path.join(projectsDir, f)).isDirectory();
            });

            const projectList = [];
            dirs.forEach(dir => {
                const configPath = path.join(projectsDir, dir, 'project.json');
                const levelsDir = path.join(projectsDir, dir, 'levels');
                let levelFiles = [];

                if (fs.existsSync(levelsDir)) {
                    try {
                        levelFiles = fs.readdirSync(levelsDir).filter(f => f.endsWith('.json'));
                    } catch (e) {
                        console.warn(`Impossibile leggere cartella livelli per ${dir}:`, e);
                    }
                }

                if (fs.existsSync(configPath)) {
                    try {
                        const raw = fs.readFileSync(configPath, 'utf8');
                        const data = JSON.parse(raw);
                        projectList.push({
                            name: dir,
                            title: data.gameTitle || dir.replace(/[_-]/g, ' '),
                            splashSubtitle: data.gameSplashSubtitle || '',
                            splashImage: data.gameSplashImage || null,
                            levels: levelFiles
                        });
                    } catch (e) {
                        projectList.push({ name: dir, title: dir, splashImage: null, levels: levelFiles });
                    }
                } else {
                    projectList.push({ name: dir, title: dir, splashImage: null, levels: levelFiles });
                }
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(projectList));
        } catch (err) {
            console.error('[Server] Errore elenco progetti:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // --- API: Upload Asset File (GLB/Audio) ---
    if (req.method === 'POST' && req.url === '/api/upload-asset') {
        const projectName = decodeURIComponent(req.headers['x-project-name'] || 'default_project');
        const assetType = decodeURIComponent(req.headers['x-asset-type'] || 'assets'); // 'assets' o 'music'
        const filename = decodeURIComponent(req.headers['x-filename'] || 'file.dat');

        const targetDir = path.join(PUBLIC_DIR, 'projects', projectName, assetType);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const targetPath = path.join(targetDir, filename);
        const writeStream = fs.createWriteStream(targetPath);

        req.pipe(writeStream);

        writeStream.on('finish', () => {
            const relPath = path.join('projects', projectName, assetType, filename);
            console.log(`[Server] File salvato: ${targetPath}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                success: true, 
                path: relPath,
                absolutePath: targetPath
            }));
        });

        writeStream.on('error', (err) => {
            console.error('[Server] Errore salvataggio file:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        });
        return;
    }

    // --- API: Delete Project Folder Recursively ---
    if (req.method === 'POST' && req.url === '/api/delete-project') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { projectName } = JSON.parse(body);
                if (!projectName || projectName === 'default_project') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Progetto non valido o protetto' }));
                    return;
                }

                const targetDir = path.join(PUBLIC_DIR, 'projects', projectName);
                if (fs.existsSync(targetDir)) {
                    // Cancella cartella e contenuto in modo ricorsivo
                    fs.rmSync(targetDir, { recursive: true, force: true });
                    console.log(`[Server] Progetto "${projectName}" eliminato fisicamente.`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Progetto non trovato' }));
                }
            } catch (err) {
                console.error('[Server] Errore eliminazione progetto:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // --- API: Save Single Level File to Disk ---
    if (req.method === 'POST' && req.url === '/api/save-single-level') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { projectName, filename, data } = JSON.parse(body);
                if (!projectName || !filename || !data) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Parametri mancanti' }));
                    return;
                }

                const levelsPath = path.join(PUBLIC_DIR, 'projects', projectName, 'levels');
                if (!fs.existsSync(levelsPath)) {
                    fs.mkdirSync(levelsPath, { recursive: true });
                }

                const filePath = path.join(levelsPath, filename);
                const dataToSave = typeof data === 'string' ? JSON.parse(data) : data;

                fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2));
                console.log(`[Server] Livello "${filename}" salvato correttamente sul disco.`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                console.error('[Server] Errore salvataggio singolo livello:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // --- API: Delete Level File physically from Disk ---
    if (req.method === 'POST' && req.url === '/api/delete-level') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { projectName, filename } = JSON.parse(body);
                if (!projectName || !filename) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Parametri mancanti' }));
                    return;
                }

                const filePath = path.join(PUBLIC_DIR, 'projects', projectName, 'levels', filename);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`[Server] Livello "${filename}" eliminato fisicamente dal progetto "${projectName}".`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'File non trovato' }));
                }
            } catch (err) {
                console.error('[Server] Errore eliminazione livello:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // --- API: Create Empty Level File ---
    if (req.method === 'POST' && req.url === '/api/create-level') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { projectName, levelName } = JSON.parse(body);
                if (!projectName || !levelName) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Parametri mancanti' }));
                    return;
                }

                const cleanedName = levelName.replace(/\.json$/i, '').trim();
                if (!cleanedName || !/^[a-zA-Z0-9_-]+$/.test(cleanedName)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Nome del livello non valido' }));
                    return;
                }

                const filename = `${cleanedName}.json`;
                const filePath = path.join(PUBLIC_DIR, 'projects', projectName, 'levels', filename);

                if (fs.existsSync(filePath)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Il file del livello esiste già' }));
                    return;
                }

                // Struttura JSON iniziale di un livello vuoto con Main Camera di default
                const emptyLevel = {
                    scene: [
                        {
                            name: "Main Camera",
                            p: [0, 5, 10],
                            r: [-0.4636, 0, 0],
                            s: [1, 1, 1],
                            userData: {
                                isCamera: true,
                                fov: 60,
                                type: "8WAY"
                            }
                        },
                        {
                            name: "Player",
                            p: [0, 1, 0],
                            r: [0, 0, 0],
                            s: [1, 1, 1],
                            userData: {
                                isPlayer: true,
                                type: "Player",
                                speed: 5,
                                jumpForce: 8,
                                typology: "8WAY",
                                cameraOffset: [0, 5, 10]
                            }
                        },
                        {
                            name: "DirectionalLight",
                            p: [5, 10, 7],
                            r: [0, 0, 0],
                            s: [1, 1, 1],
                            userData: {
                                type: "DirectionalLight",
                                color: "#ffffff",
                                intensity: 1.0,
                                castShadow: true
                            }
                        }
                    ],
                    library: [],
                    gamePBR: true,
                    gameShadows: true,
                    gameReflections: true,
                    gameExposure: 1.0,
                    gamePixelEffect: false,
                    gamePixelSize: 6,
                    gameBloomEffect: false,
                    gameBloomStrength: 1.5,
                    gameBloomRadius: 0.4,
                    gameCyberpunkEffect: false,
                    gameCyberpunkAberration: 0.004,
                    gameCyberpunkScanlines: 0.2,
                    gameSkyboxData: null,
                    gameSkyboxFilename: "",
                    gameSkyboxIntensity: 1.0,
                    gameSkyboxVisible: true
                };

                fs.writeFileSync(filePath, JSON.stringify(emptyLevel, null, 2));
                console.log(`[Server] Creato nuovo livello vuoto: ${filePath}`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, filename }));
            } catch (err) {
                console.error('[Server] Errore creazione livello:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // --- API: Save Project and Levels to Filesystem ---
    if (req.method === 'POST' && req.url === '/api/save-project') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { projectName, projectData, levels } = JSON.parse(body);
                if (!projectName) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'projectName richiesto' }));
                    return;
                }

                const projectPath = path.join(PUBLIC_DIR, 'projects', projectName);
                const levelsPath = path.join(projectPath, 'levels');

                // Assicurati che le cartelle esistano
                fs.mkdirSync(projectPath, { recursive: true });
                fs.mkdirSync(levelsPath, { recursive: true });

                // 1. Salva project.json principale
                fs.writeFileSync(
                    path.join(projectPath, 'project.json'),
                    JSON.stringify(projectData, null, 2)
                );

                // 2. Salva i singoli file dei livelli
                console.log(`[Server DEBUG] Ricevuto levels da salvare. Conteggio: ${Array.isArray(levels) ? levels.length : 0}`);
                if (Array.isArray(levels)) {
                    levels.forEach(lvl => {
                        console.log(`[Server DEBUG] Livello: filename="${lvl.filename}", lunghezza data=${lvl.data ? lvl.data.length : 0}`);
                        if (lvl.filename && lvl.data) {
                            const dataToSave = typeof lvl.data === 'string' ? JSON.parse(lvl.data) : lvl.data;
                            const targetFile = path.join(levelsPath, lvl.filename);
                            fs.writeFileSync(
                                targetFile,
                                JSON.stringify(dataToSave, null, 2)
                            );
                            console.log(`[Server DEBUG] Scritto file: ${targetFile}`);
                        } else {
                            console.warn(`[Server DEBUG] Livello ignorato (filename o data mancanti):`, lvl);
                        }
                    });
                }

                console.log(`[Server] Progetto "${projectName}" e relativi livelli salvati con successo sul filesystem.`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                console.error('[Server] Errore salvataggio progetto:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // --- API: Create Project Folder Structure ---
    if (req.method === 'POST' && req.url === '/api/create-project') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { name } = JSON.parse(body);
                if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Nome del progetto non valido' }));
                    return;
                }

                const projectPath = path.join(PUBLIC_DIR, 'projects', name);
                const subdirs = ['levels', 'assets', 'music'];

                // Create directories
                fs.mkdirSync(projectPath, { recursive: true });
                subdirs.forEach(sub => {
                    fs.mkdirSync(path.join(projectPath, sub), { recursive: true });
                });

                // Write initial empty project.json
                const initialProject = {
                    projectName: name,
                    gameTitle: name.replace(/[_-]/g, ' '),
                    gameSplashSubtitle: 'A 3D Web Game',
                    startingLevelIndex: 0,
                    currentLevelIndex: -1,
                    library: [
                        {
                            name: 'Player',
                            type: 'Player',
                            glbSource: null
                        }
                    ],
                    levels: []
                };

                fs.writeFileSync(
                    path.join(projectPath, 'project.json'),
                    JSON.stringify(initialProject, null, 2)
                );

                console.log(`[Server] Progetto "${name}" creato con successo in: ${projectPath}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, projectName: name }));
            } catch (err) {
                console.error('[Server] Errore creazione progetto:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // --- API: Blender Live Sync (SSE stream) ---
    if (req.method === 'GET' && req.url === '/api/blender-sync-stream') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });
        syncClients.push(res);
        console.log(`[Server] Client Blender Sync connesso. Totale: ${syncClients.length}`);

        req.on('close', () => {
            const idx = syncClients.indexOf(res);
            if (idx !== -1) {
                syncClients.splice(idx, 1);
            }
            console.log(`[Server] Client Blender Sync disconnesso. Totale: ${syncClients.length}`);
        });
        return;
    }

    // --- API: Blender Live Sync (Post wscene) ---
    if (req.method === 'POST' && req.url === '/api/blender-sync') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const { projectName, levelIndex, wscene } = payload;
                if (!wscene) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'wscene data missing' }));
                    return;
                }

                const project = projectName || 'default_project';
                let targetLvlIndex = levelIndex;
                const projectPath = path.join(PUBLIC_DIR, 'projects', project);
                const configPath = path.join(projectPath, 'project.json');
                
                // Read current project.json to see if we need to append a new level
                let projectConfig = null;
                if (fs.existsSync(configPath)) {
                    try {
                        projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    } catch (e) {
                        console.error("[Server] Errore lettura project.json:", e);
                    }
                }
                
                if (projectConfig) {
                    if (targetLvlIndex === 'NEW') {
                        // Create a new level entry
                        targetLvlIndex = projectConfig.levels ? projectConfig.levels.length : 0;
                        const newLvlName = `Blender Sync ${targetLvlIndex + 1}`;
                        const newLvlFilename = `blender_sync_${targetLvlIndex}.json`;
                        
                        if (!projectConfig.levels) projectConfig.levels = [];
                        projectConfig.levels.push({
                            name: newLvlName,
                            music: '',
                            musicFilename: '',
                            isExternal: true,
                            externalFilename: newLvlFilename
                        });
                        
                        fs.writeFileSync(configPath, JSON.stringify(projectConfig, null, 2));
                        console.log(`[Server] Creato nuovo livello Blender Sync in project.json all'indice ${targetLvlIndex}`);
                    }
                }

                // If projectName is provided, save the embedded GLB to disk
                if (wscene.glb) {
                    const assetsDir = path.join(projectPath, 'assets');
                    if (!fs.existsSync(assetsDir)) {
                        fs.mkdirSync(assetsDir, { recursive: true });
                    }
                    
                    // Decodifica glb base64 e salvalo
                    const base64Data = wscene.glb.replace(/^data:model\/gltf-binary;base64,/, "");
                    const buffer = Buffer.from(base64Data, 'base64');
                    const glbFilename = `blender_sync_${targetLvlIndex}.glb`;
                    const glbPath = path.join(assetsDir, glbFilename);
                    
                    fs.writeFileSync(glbPath, buffer);
                    console.log(`[Server] Scritto GLB per blender-sync in ${glbPath}`);
                    
                    // Sostituisci il campo base64 nel wscene con il path relativo
                    wscene.glbSource = `projects/${project}/assets/${glbFilename}`;
                    delete wscene.glb; // rimuoviamo per risparmiare memoria/banda
                }

                // Save the wscene level data as projects/<project>/levels/blender_sync_<level_index>.json
                const levelsDir = path.join(projectPath, 'levels');
                if (!fs.existsSync(levelsDir)) {
                    fs.mkdirSync(levelsDir, { recursive: true });
                }
                
                let levelFilename = `blender_sync_${targetLvlIndex}.json`;
                if (projectConfig && projectConfig.levels && projectConfig.levels[targetLvlIndex]) {
                    const lvlInfo = projectConfig.levels[targetLvlIndex];
                    if (lvlInfo.externalFilename) {
                        levelFilename = lvlInfo.externalFilename;
                    }
                }
                const levelPath = path.join(levelsDir, levelFilename);
                
                fs.writeFileSync(levelPath, JSON.stringify(wscene, null, 2));
                console.log(`[Server] Salvato file livello su disco: ${levelPath}`);

                // Invia broadcast a tutti i client SSE connessi
                const broadcastPayload = {
                    projectName: project,
                    levelIndex: targetLvlIndex,
                    wscene: wscene,
                    projectConfig: projectConfig
                };
                const broadcastData = JSON.stringify(broadcastPayload);
                syncClients.forEach(client => {
                    client.write(`data: ${broadcastData}\n\n`);
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, levelIndex: targetLvlIndex }));
            } catch (err) {
                console.error('[Server] Errore in blender-sync:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // --- Static File Server ---
    let filePath = path.join(PUBLIC_DIR, req.url.split('?')[0]);
    if (filePath === PUBLIC_DIR || filePath.endsWith('/')) {
        filePath = path.join(filePath, 'index.html');
    }

    const extname = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File non trovato');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Errore del server: ${err.code}`);
            }
        } else {
            res.writeHead(200, { 
                'Content-Type': contentType,
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log(`[Server Woxengine] Attivo su http://localhost:${PORT}`);
});
