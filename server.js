const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Server-Side Tank Configurations (Authoritative Stats)
const TANK_STATS = {
    // WW1
    "mkiv": { hp: 4, speed: 1.5, reload: 180, damage: 1, range: 400, accuracy: 0.15, turretSpeed: 0.02 },
    "a7v": { hp: 5, speed: 1.2, reload: 200, damage: 1, range: 400, accuracy: 0.15, turretSpeed: 0.02 },
    "ft17": { hp: 2, speed: 2.5, reload: 120, damage: 1, range: 350, accuracy: 0.12, turretSpeed: 0.04 },
    // WW2
    "m4": { hp: 3, speed: 3.0, reload: 120, damage: 1, range: 600, accuracy: 0.08, turretSpeed: 0.06 },
    "t34": { hp: 3, speed: 3.2, reload: 110, damage: 1, range: 550, accuracy: 0.10, turretSpeed: 0.05 },
    "tiger": { hp: 5, speed: 2.0, reload: 160, damage: 2, range: 800, accuracy: 0.04, turretSpeed: 0.03 },
    "stug": { hp: 4, speed: 2.2, reload: 140, damage: 1.5, range: 700, accuracy: 0.05, turretSpeed: 0.015 },
    // Cold War
    "m48": { hp: 4, speed: 3.5, reload: 100, damage: 1.5, range: 800, accuracy: 0.05, turretSpeed: 0.08 },
    "t55": { hp: 4, speed: 3.4, reload: 110, damage: 1.5, range: 750, accuracy: 0.06, turretSpeed: 0.07 },
    "leo1": { hp: 3, speed: 4.5, reload: 90, damage: 1.5, range: 900, accuracy: 0.03, turretSpeed: 0.10 },
    // Modern
    "m1a2": { hp: 6, speed: 4.0, reload: 100, damage: 2, range: 1200, accuracy: 0.01, turretSpeed: 0.15 },
    "t90": { hp: 5, speed: 3.8, reload: 100, damage: 2, range: 1100, accuracy: 0.02, turretSpeed: 0.12 }
};

let players = {};
let projectiles = [];
let trees = [];
let p1Id = null;
let p2Id = null;
let gameState = "WAITING"; // WAITING, PLAYING, GAMEOVER
let scores = { p1: 0, p2: 0 };

function dist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

// Generate the map
function resetBoard() {
    projectiles = [];
    trees = [];
    const margin = 120;

    // Pick random opposite corners for spawns
    let corners = [
        [{x: margin, y: margin, angle: Math.PI/4}, {x: 1200-margin, y: 800-margin, angle: -Math.PI*0.75}],
        [{x: 1200-margin, y: margin, angle: Math.PI*0.75}, {x: margin, y: 800-margin, angle: -Math.PI/4}]
    ];
    let selectedCorners = corners[Math.floor(Math.random() * corners.length)];
    
    // Assign spawn points
    if (players[p1Id]) {
        players[p1Id].x = selectedCorners[0].x;
        players[p1Id].y = selectedCorners[0].y;
        players[p1Id].angle = selectedCorners[0].angle;
        players[p1Id].turretAngle = selectedCorners[0].angle;
        players[p1Id].hp = TANK_STATS[players[p1Id].tankTypeId].hp;
        players[p1Id].reloadCooldown = 0;
    }
    
    if (players[p2Id]) {
        players[p2Id].x = selectedCorners[1].x;
        players[p2Id].y = selectedCorners[1].y;
        players[p2Id].angle = selectedCorners[1].angle;
        players[p2Id].turretAngle = selectedCorners[1].angle;
        players[p2Id].hp = TANK_STATS[players[p2Id].tankTypeId].hp;
        players[p2Id].reloadCooldown = 0;
    }

    // Spawn cover in the middle ground
    const numTrees = 12 + Math.floor(Math.random() * 8);
    for (let i = 0; i < numTrees; i++) {
        let tx, ty, safe;
        let attempts = 0;
        do {
            tx = 1200 * 0.25 + Math.random() * (1200 * 0.5);
            ty = 800 * 0.2 + Math.random() * (800 * 0.6);
            safe = players[p1Id] && dist(tx, ty, players[p1Id].x, players[p1Id].y) > 150 && 
                   players[p2Id] && dist(tx, ty, players[p2Id].x, players[p2Id].y) > 150;
            attempts++;
        } while (!safe && attempts < 50);

        if (safe) trees.push({ x: tx, y: ty, radius: 22 + Math.random() * 12, swayOffset: Math.random() * Math.PI * 2 });
    }
}

io.on('connection', (socket) => {
    socket.emit('init', socket.id);

    // Player joins the match
    socket.on('join', (tankId) => {
        if (!p1Id) {
            p1Id = socket.id;
        } else if (!p2Id && socket.id !== p1Id) {
            p2Id = socket.id;
        } else {
            socket.emit('lobbyError', 'Match is full!');
            return;
        }

        players[socket.id] = {
            x: -1000, y: -1000, angle: 0, turretAngle: 0, hp: 0, maxHp: 0, 
            reloadCooldown: 0, tankTypeId: tankId || 'm4',
            inputs: { w: false, a: false, s: false, d: false, mouseX: 0, mouseY: 0, mouseDown: false }
        };

        if (p1Id && p2Id) {
            gameState = "PLAYING";
            resetBoard();
            io.emit('gameStart', { trees, p1Id, p2Id });
        }
    });

    // Player changes tank mid-game (applied next round)
    socket.on('changeTank', (tankId) => {
        if (players[socket.id] && TANK_STATS[tankId]) {
            players[socket.id].tankTypeId = tankId;
        }
    });

    // Receive player keyboard and mouse inputs
    socket.on('input', (data) => {
        if (players[socket.id] && gameState === "PLAYING") {
            players[socket.id].inputs = data;
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        if (socket.id === p1Id) p1Id = null;
        if (socket.id === p2Id) p2Id = null;
        gameState = "WAITING";
        scores = { p1: 0, p2: 0 };
        io.emit('playerLeft');
    });
});

setInterval(() => {
    if (gameState === "PLAYING") {
        
        // 1. Process Players
        for (let id in players) {
            let p = players[id];
            if (p.hp <= 0) continue;

            let stats = TANK_STATS[p.tankTypeId];
            p.maxHp = stats.hp;

            let moveX = 0; let moveY = 0;
            if (p.inputs.w) moveY -= 1;
            if (p.inputs.s) moveY += 1;
            if (p.inputs.a) moveX -= 1;
            if (p.inputs.d) moveX += 1;

            if (moveX !== 0 || moveY !== 0) {
                let targetAngle = Math.atan2(moveY, moveX);
                p.angle = targetAngle;
                let nextX = p.x + Math.cos(targetAngle) * stats.speed;
                let nextY = p.y + Math.sin(targetAngle) * stats.speed;

                let hitTree = false;
                for (let tree of trees) {
                    if (dist(nextX, nextY, tree.x, tree.y) < 18 + tree.radius) {
                        hitTree = true; break;
                    }
                }
                if (!hitTree) {
                    p.x = Math.max(30, Math.min(1170, nextX));
                    p.y = Math.max(30, Math.min(770, nextY));
                }
            }

            // Turret Rotation with Traverse Speed Constraint
            let targetTurretAngle = Math.atan2(p.inputs.mouseY - p.y, p.inputs.mouseX - p.x);
            let tDiff = targetTurretAngle - p.turretAngle;
            while (tDiff < -Math.PI) tDiff += Math.PI * 2;
            while (tDiff > Math.PI) tDiff -= Math.PI * 2;
            
            if (Math.abs(tDiff) <= stats.turretSpeed) {
                p.turretAngle = targetTurretAngle;
            } else {
                p.turretAngle += Math.sign(tDiff) * stats.turretSpeed;
            }

            // Firing Logic with Accuracy Spread and Range limits
            if (p.reloadCooldown <= 0 && p.inputs.mouseDown) {
                let muzzleX = p.x + Math.cos(p.turretAngle) * 28;
                let muzzleY = p.y + Math.sin(p.turretAngle) * 28;
                
                let spreadAngle = p.turretAngle + (Math.random() - 0.5) * stats.accuracy;
                
                projectiles.push({ 
                    x: muzzleX, y: muzzleY, 
                    angle: spreadAngle, 
                    speed: 7.5, 
                    shooterId: id, 
                    damage: stats.damage,
                    distance: 0,
                    maxRange: stats.range
                });
                p.reloadCooldown = stats.reload;
                io.emit('effect', { type: 'fire', x: muzzleX, y: muzzleY });
            }
            if (p.reloadCooldown > 0) p.reloadCooldown--;
        }

        // 2. Process Projectiles
        for (let i = projectiles.length - 1; i >= 0; i--) {
            let proj = projectiles[i];
            proj.x += Math.cos(proj.angle) * proj.speed;
            proj.y += Math.sin(proj.angle) * proj.speed;
            proj.distance += proj.speed;

            let hit = false;
            
            // Limit bullet distance based on tank range stat
            if (proj.distance > proj.maxRange) {
                hit = true;
                io.emit('effect', { type: 'hitTree', x: proj.x, y: proj.y }); // Generic puff
            }

            // Map Bounds
            if (!hit && (proj.x < 0 || proj.x > 1200 || proj.y < 0 || proj.y > 800)) hit = true;

            // Tree Collision
            if (!hit) {
                for (let tree of trees) {
                    if (dist(proj.x, proj.y, tree.x, tree.y) < tree.radius + 4) {
                        hit = true;
                        io.emit('effect', { type: 'hitTree', x: proj.x, y: proj.y });
                        break;
                    }
                }
            }

            // Tank Collision
            if (!hit) {
                for (let id in players) {
                    let p = players[id];
                    if (id !== proj.shooterId && p.hp > 0 && dist(proj.x, proj.y, p.x, p.y) < 18 + 4) {
                        hit = true;
                        p.hp -= proj.damage;
                        io.emit('effect', { type: 'hitTank', x: proj.x, y: proj.y, damage: proj.damage });

                        if (p.hp <= 0) {
                            if (proj.shooterId === p1Id) scores.p1++;
                            if (proj.shooterId === p2Id) scores.p2++;
                            gameState = "GAMEOVER";
                            io.emit('gameOver', { winnerId: proj.shooterId });
                            
                            setTimeout(() => {
                                if(gameState === "GAMEOVER" && p1Id && p2Id) {
                                    gameState = "PLAYING";
                                    resetBoard();
                                    io.emit('gameStart', { trees, p1Id, p2Id });
                                }
                            }, 3000);
                        }
                        break;
                    }
                }
            }

            if (hit) projectiles.splice(i, 1);
        }

        // 3. Broadcast State
        io.emit('stateUpdate', { players, projectiles, p1Id, p2Id, scores });
    }
}, 1000 / 30); // 30 Server Ticks per second

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Game Server running on port ${PORT}`));
