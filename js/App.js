import { SceneManager } from './SceneManager.js';
import { Editor } from './Editor.js';
import { UIManager } from './UIManager.js';
import { GameManager } from './GameManager.js';

class App {
    constructor() {
        this.sceneManager = new SceneManager(this);
        this.editor = new Editor(this);
        this.ui = new UIManager(this);
        this.game = new GameManager(this);
        
        this.init();
    }

    init() {
        this.sceneManager.init();
        this.editor.init();
        this.ui.init();
        this.loop();
    }

    loop() {
        requestAnimationFrame(() => this.loop());
        
        if (this.game.isPlaying) {
            this.game.update();
        } else {
            this.editor.update();
        }
        
        this.sceneManager.update();
    }
}

new App();
