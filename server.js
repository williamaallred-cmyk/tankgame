const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve the static files from the 'public' directory
app.use(express.static('public'));

// Fixed internal game resolution. The client canvas will scale to fit screens.
const GAME_WIDTH = 1200;
const GAME_HEIGHT = 800;

// Historical Tank Stats Data
const TANK_DATA = {
    "WW1": [
        { id: "mkiv", name: "Mark IV (UK)", hp: 8, speed: 1.2, reload: 180, damage: 2, projSpeed: 5 },
        { id: "a7v", name: "A7V (GER)", hp: 9, speed: 1.0, reload: 200, damage: 3, projSpeed: 5 },
        { id: "ft17", name: "Renault FT (FRA)", hp: 4, speed: 1.8, reload: 120, damage: 2, projSpeed: 6 }
    ],
    "WW2": [
        { id: "m4", name: "M4 Sherman (USA)", hp: 8, speed: 2.2, reload: 150, damage: 3, projSpeed: 8 },
        { id: "t34", name: "T-34 (USSR)", hp: 8, speed: 2.5, reload: 160, damage: 3, projSpeed: 8 },
        { id: "tiger", name: "Tiger I (GER)", hp: 14, speed: 1.6, reload: 220, damage: 6, projSpeed: 9 },
        { id: "stug", name: "StuG III TD (GER)", hp: 8, speed: 2.1, reload: 150, damage: 5, projSpeed: 9 }
    ],
    "Cold War": [
        { id: "m48", name: "M48 Patton (USA)", hp: 12, speed: 2.4, reload: 130, damage: 6, projSpeed: 10 },
        { id: "t55", name: "T-55 (USSR)", hp: 12, speed: 2.6, reload: 140, damage: 6, projSpeed: 10 },
        { id: "leo1", name: "Leopard 1 (GER)", hp: 8, speed: 3.2, reload: 110, damage: 7, projSpeed: 12 }
    ],
    "Modern Era": [
        { id: "m1a2", name: "M1A2 Abrams (USA)", hp: 20, speed: 3.0, reload: 100, damage: 10, projSpeed: 15 },
        { id: "t90", name: "T-90 (RUS)", hp: 18, speed: 2.8, reload: 110, damage: 10, projSpeed: 14 }
    ]
};

function getTankData(id) {
    for (let era in TANK_DATA) {
        for (let tank of TANK_DATA[era]) {
            if (tank.id === id) return tank;
        }
    }
    return TANK_DATA["WW2"][0]; // Fallback
}

let gameState = "WAITING"; // WAITING, PLAYING, GAMEOVER
let players = {};
let p1Id = null;
let p2Id = null;
let trees = [];
let projectiles = [];
let scores = { p1: 0, p2: 0 };

function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

function resetBoard() {
    projectiles = [];
    trees = [];
    
    // Spawn cover in the middle map area
    const numTrees = 12 + Math.floor(Math.random() * 8);
    for (let i = 0; i < numTrees; i++) {
        let tx = GAME_WIDTH * 0.25 + Math.random() * (GAME_WIDTH * 0.5);
        let ty = GAME_HEIGHT * 0.2 + Math.random() * (GAME_HEIGHT * 0.6);
        trees.push({ x: tx, y: ty, radius: 22 + Math.random() * 12, swayOffset: Math.random() * Math.PI * 2 });
    }

    // Assign spawn locations
    const marginX = 120;
    const marginY = 120;
    const spawn1 = { x: marginX, y: marginY }; // Top Left
    const spawn2 = { x: GAME_WIDTH - marginX, y: GAME_HEIGHT - marginY }; // Bottom Right
    const p1GetsFirst = Math.random() > 0.5;

    // Apply specific historical tank stats to players based on their selection
    for (let id of [p1Id, p2Id]) {
        if (!id) continue;
        let tData = getTankData(players[id].tankTypeId);
        let isSpawn1 = (id === p1Id && p1GetsFirst) || (id === p2Id && !p1GetsFirst);
        
        players[id].x = isSpawn1 ? spawn1.x : spawn2.x;
        players[id].y = isSpawn1 ? spawn1.y : spawn2.y;
        players[id].radius = 18;
        players[id].angle = 0;
        players[id].turretAngle = 0;
        players[id].hp = tData.hp;
        players[id].maxHp = tData.hp;
        players[id].speed = tData.speed;
        players[id].maxCooldown = tData.reload;
        players[id].reloadCooldown = 0;
        players[id].damage = tData.damage;
        players[id].projSpeed = tData.projSpeed;
        players[id].tankName = tData.name;
    }
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    // When a player chooses their tank and hits join
    socket.on('join', (tankId) => {
        if (p1Id && p2Id) {
            socket.emit('lobbyError', 'Match is currently full.');
            return;
        }

        players[socket.id] = {
            id: socket.id,
            tankTypeId: tankId,
            inputs: { w: false, a: false, s: false, d: false, mouseX: 0, mouseY: 0, mouseDown: false }
        };

        if (!p1Id) p1Id = socket.id;
        else if (!p2Id) p2Id = socket.id;

        socket.emit('init', socket.id);

        // Start match if 2 players are in
        if (p1Id && p2Id) {
            gameState = "PLAYING";
            resetBoard();
            io.emit('gameStart', { trees, p1Id, p2Id });
        }
    });

    // Receive keystrokes/mouse updates from client
    socket.on('input', (data) => {
        if (players[socket.id] && gameState === "PLAYING") {
            players[socket.id].inputs = data;
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        delete players[socket.id];
        if (p1Id === socket.id) p1Id = null;
        if (p2Id === socket.id) p2Id = null;
        gameState = "WAITING";
        io.emit('playerLeft');
    });
});

setInterval(() => {
    if (gameState !== "PLAYING") return;

    // Update Player Movements
    for (let id of [p1Id, p2Id]) {
        let p = players[id];
        if (!p || p.hp <= 0) continue;

        if (p.reloadCooldown > 0) p.reloadCooldown--;

        let moveX = 0;
        let moveY = 0;
        if (p.inputs.w) moveY -= 1;
        if (p.inputs.s) moveY += 1;
        if (p.inputs.a) moveX -= 1;
        if (p.inputs.d) moveX += 1;

        if (moveX !== 0 || moveY !== 0) {
            let targetAngle = Math.atan2(moveY, moveX);
            p.angle = targetAngle;
            let nextX = p.x + Math.cos(targetAngle) * p.speed;
            let nextY = p.y + Math.sin(targetAngle) * p.speed;

            let hitTree = false;
            for (let t of trees) {
                if (dist(nextX, nextY, t.x, t.y) < p.radius + t.radius) {
                    hitTree = true;
                    break;
                }
            }
            if (!hitTree) {
                p.x = clamp(nextX, 30, GAME_WIDTH - 30);
                p.y = clamp(nextY, 30, GAME_HEIGHT - 30);
            }
        }

        // Turret Aiming
        p.turretAngle = Math.atan2(p.inputs.mouseY - p.y, p.inputs.mouseX - p.x);

        // Firing Logic
        if (p.inputs.mouseDown && p.reloadCooldown <= 0) {
            p.reloadCooldown = p.maxCooldown;
            let muzzleX = p.x + Math.cos(p.turretAngle) * 28;
            let muzzleY = p.y + Math.sin(p.turretAngle) * 28;
            
            projectiles.push({
                x: muzzleX, y: muzzleY, angle: p.turretAngle,
                speed: p.projSpeed, damage: p.damage, shooterId: id, active: true
            });
            // Tell clients to draw a muzzle flash particle effect
            io.emit('effect', { type: 'fire', x: muzzleX, y: muzzleY }); 
        }
    }

    // Update Projectiles and Check Collisions
    for (let proj of projectiles) {
        if (!proj.active) continue;
        proj.x += Math.cos(proj.angle) * proj.speed;
        proj.y += Math.sin(proj.angle) * proj.speed;

        if (proj.x < 0 || proj.x > GAME_WIDTH || proj.y < 0 || proj.y > GAME_HEIGHT) {
            proj.active = false;
            continue;
        }

        // Tree Cover Hit
        for (let t of trees) {
            if (dist(proj.x, proj.y, t.x, t.y) < t.radius + 4) {
                proj.active = false;
                io.emit('effect', { type: 'hitTree', x: proj.x, y: proj.y });
                break;
            }
        }
        if (!proj.active) continue;

        // Player Hit Detection
        for (let id of [p1Id, p2Id]) {
            let p = players[id];
            if (p && id !== proj.shooterId && p.hp > 0) {
                if (dist(proj.x, proj.y, p.x, p.y) < p.radius + 4) {
                    proj.active = false;
                    p.hp -= proj.damage;
                    io.emit('effect', { type: 'hitTank', x: proj.x, y: proj.y, damage: proj.damage });
                    
                    // Check Death condition
                    if (p.hp <= 0) {
                        gameState = "GAMEOVER";
                        let winnerId = (id === p1Id) ? p2Id : p1Id;
                        if (winnerId === p1Id) scores.p1++; else scores.p2++;
                        
                        io.emit('gameOver', { winnerId, loserId: id });
                        
                        // Auto-restart after 4 seconds
                        setTimeout(() => {
                            if (p1Id && p2Id) {
                                gameState = "PLAYING";
                                resetBoard();
                                io.emit('gameStart', { trees, p1Id, p2Id });
                            }
                        }, 4000);
                    }
                    break;
                }
            }
        }
    }

    // Filter dead projectiles
    projectiles = projectiles.filter(p => p.active);

    // Send world state to all connected browsers
    io.emit('stateUpdate', { players, projectiles, scores, p1Id, p2Id });

}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
