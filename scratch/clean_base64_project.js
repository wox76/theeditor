import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..'); // project root

function decodeBase64File(dataUrl, targetDir, defaultFilename) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        return dataUrl;
    }

    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return dataUrl;

    const mime = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // Determine extension
    let ext = '.dat';
    if (mime.includes('gltf') || mime.includes('octet-stream')) ext = '.glb';
    else if (mime.includes('png')) ext = '.png';
    else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
    else if (mime.includes('audio/mpeg') || mime.includes('mp3')) ext = '.mp3';
    else if (mime.includes('audio/wav') || mime.includes('wav')) ext = '.wav';
    else if (mime.includes('video/mp4')) ext = '.mp4';

    let filename = defaultFilename;
    if (!path.extname(filename)) {
        filename += ext;
    }

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetPath = path.join(targetDir, filename);
    fs.writeFileSync(targetPath, buffer);

    const relPath = '/' + path.relative(PUBLIC_DIR, targetPath).replace(/\\/g, '/');
    console.log(`Saved base64 asset to: ${targetPath} -> ${relPath}`);
    return relPath;
}

function cleanProjectOrLevelFile(filePath, projectName) {
    console.log(`Cleaning file: ${filePath}`);
    const raw = fs.readFileSync(filePath, 'utf8');
    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        console.error(`Failed to parse JSON for ${filePath}:`, e);
        return;
    }

    const assetsDir = path.join(PUBLIC_DIR, 'projects', projectName, 'assets');
    const musicDir = path.join(PUBLIC_DIR, 'projects', projectName, 'music');

    // 1. Clean library
    if (Array.isArray(data.library)) {
        data.library = data.library.map(item => {
            if (item.data && typeof item.data === 'string' && item.data.startsWith('data:')) {
                const targetDir = item.type === 'Player' || item.type === 'Model' ? assetsDir : musicDir;
                const pathLink = decodeBase64File(item.data, targetDir, item.name);
                return { ...item, data: pathLink };
            }
            return item;
        });
    }

    // Helper to sanitize userData
    const sanitizeUserData = (userData) => {
        if (!userData) return userData;
        for (const key in userData) {
            const val = userData[key];
            if (typeof val === 'string' && val.startsWith('data:')) {
                // If it's a base64 string, clean it
                const targetDir = key.toLowerCase().includes('music') || key.toLowerCase().includes('sound') ? musicDir : assetsDir;
                const name = userData.glbFilename || userData.name || key;
                userData[key] = decodeBase64File(val, targetDir, name);
            }
        }
        return userData;
    };

    // 2. Clean scene objects
    if (Array.isArray(data.scene)) {
        data.scene = data.scene.map(obj => {
            if (obj.userData) {
                obj.userData = sanitizeUserData(obj.userData);
                if (obj.userData.glbSource && obj.userData.glbSource.startsWith('data:')) {
                    obj.userData.glbSource = obj.userData.glbFilename ? `/projects/${projectName}/assets/${obj.userData.glbFilename}` : '';
                }
            }
            return obj;
        });
    }

    // 3. Clean game properties
    const keysToClean = [
        'gameSplashImage',
        'gameSplashMusic',
        'gameEndImage',
        'gameEndVideo',
        'gameEndMusic',
        'gameSkyboxData'
    ];

    keysToClean.forEach(key => {
        if (data[key] && typeof data[key] === 'string' && data[key].startsWith('data:')) {
            const targetDir = key.toLowerCase().includes('music') ? musicDir : assetsDir;
            const filename = key.replace('game', 'game_').toLowerCase();
            data[key] = decodeBase64File(data[key], targetDir, filename);
        }
    });

    // Write cleaned file back
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Successfully cleaned and saved: ${filePath}`);
}

const projectsDir = path.join(PUBLIC_DIR, 'projects');
if (fs.existsSync(projectsDir)) {
    const dirs = fs.readdirSync(projectsDir).filter(f => {
        return fs.statSync(path.join(projectsDir, f)).isDirectory();
    });

    dirs.forEach(projectName => {
        const projectPath = path.join(projectsDir, projectName);
        const configPath = path.join(projectPath, 'project.json');
        const levelsDir = path.join(projectPath, 'levels');

        if (fs.existsSync(configPath)) {
            cleanProjectOrLevelFile(configPath, projectName);
        }

        if (fs.existsSync(levelsDir)) {
            const levelFiles = fs.readdirSync(levelsDir).filter(f => f.endsWith('.json'));
            levelFiles.forEach(lvlFile => {
                const lvlPath = path.join(levelsDir, lvlFile);
                cleanProjectOrLevelFile(lvlPath, projectName);
            });
        }
    });
}
