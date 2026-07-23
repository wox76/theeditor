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
        
        window.app = this;
        this.init();
    }

    init() {
        try {
            this.sceneManager.init();
            this.editor.init();
            this.ui.init();
            this.loop();
        } catch (e) {
            console.error("Critical error during App init:", e);
        }
    }

    loop() {
        requestAnimationFrame(() => this.loop());
        
        try {
            if (this.game && this.game.isEndScreen) {
                return;
            }

            if (this.game && this.game.isPlaying) {
                this.game.update();
            } else {
                if (this.editor) this.editor.update();
            }
            
            if (this.sceneManager) this.sceneManager.update();
        } catch (e) {
            console.error("Critical error in App loop:", e);
        }
    }
}

new App();
