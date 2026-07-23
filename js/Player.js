import * as THREE from 'three';

export const PlayerFactory = {
    createPlayer(nameIndex) {
        const geo = new THREE.CapsuleGeometry(0.3, 1.2, 4, 8);
        const mat = new THREE.MeshStandardMaterial({  
            color: 0x4caf50, 
            transparent: true, 
            opacity: 0.5, 
            wireframe: true 
        });
        const p = new THREE.Mesh(geo, mat);
        p.position.y = 0.9;
        p.name = "Player_" + nameIndex;
        p.userData = { 
            isPlayer: true, 
            isAsset: true,
            type: 'Player',
            typology: '8WAY',
            collisionMode: 'climb',
            anims: [], 
            actions: [
                { name: 'Idle', key: '', type: 'Idle', anim: '', mirror: false, active: true },
                { name: 'Walk Forward', key: 'w', type: 'Walk', anim: '', mirror: false, active: true },
                { name: 'Walk Backward', key: 's', type: 'Walk', anim: '', mirror: false, active: true },
                { name: 'Walk Right', key: 'd', type: 'Walk', anim: '', mirror: false, active: true },
                { name: 'Walk Left', key: 'a', type: 'Walk', anim: '', mirror: true, active: true },
                { name: 'Jump', key: ' ', type: 'Jump', anim: '', mirror: false, active: true },
                { name: 'Fly', key: '', type: 'Fly', anim: '', mirror: false, active: true },
                { name: 'Death', key: '', type: 'Death', anim: '', mirror: false, active: true }
            ],
            speed: 0.4,
            jumpForce: 5.0,
            doubleJump: false 
        };
        return p;
    }
};
