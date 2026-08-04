const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');
const filter = require('leo-profanity');

app.use(express.static(path.join(__dirname, 'public')));

// Server-Side Tank Configurations (Authoritative Stats)
// Projectile speeds are doubled for realism
const TANK_STATS = {
    // WW1
    "mkiv": { hp: 4, speed: 1.5, reload: 180, damage: 1, range: 400, accuracy: 0.15, turretSpeed: 0.02, projSpeed: 24 },
    "a7v": { hp: 5, speed: 1.2, reload: 200, damage: 1, range: 400, accuracy: 0.15, turretSpeed: 0.02, projSpeed: 24 },
    "ft17": { hp: 2, speed: 2.5, reload: 120, damage: 1, range: 350, accuracy: 0.12, turretSpeed: 0.04, projSpeed: 20 },
    // WW2
    "m4": { hp: 3, speed: 3.0, reload: 120, damage: 1, range: 600, accuracy: 0.08, turretSpeed: 0.06, projSpeed: 36 },
    "t34": { hp: 3, speed: 3.2, reload: 110, damage: 1, range: 550, accuracy: 0.10, turretSpeed: 0.05, projSpeed: 36 },
    "tiger": { hp: 5, speed: 2.0, reload: 160, damage: 2, range: 800, accuracy: 0.04, turretSpeed: 0.03, projSpeed: 44 },
    "stug": { hp: 4, speed: 2.2, reload: 140, damage: 1.5, range: 700, accuracy: 0.05, turretSpeed: 0.015, projSpeed: 40 },
    // Cold War
    "m48": { hp: 4, speed: 3.5, reload: 100, damage: 1.5, range: 800, accuracy: 0.05, turretSpeed: 0.08, projSpeed: 52 },
    "t55": { hp: 4, speed: 3.4, reload: 110, damage: 1.5, range: 750, accuracy: 0.06, turretSpeed: 0.07, projSpeed: 50 },
    "leo1": { hp: 3, speed: 4.5, reload: 90, damage: 1.5, range: 900, accuracy: 0.03, turretSpeed: 0.10, projSpeed: 56 },
    // Modern
    "m1a2": { hp: 6, speed: 4.0, reload: 100, damage: 2, range: 1200, accuracy: 0.01, turretSpeed: 0.15, projSpeed: 76 },
    "t90": { hp: 5, speed: 3.8, reload: 100, damage: 2, range: 1100, accuracy: 0.02, turretSpeed: 0.12, projSpeed: 72 }
};

let activeRooms = {};
let waitingSockets = [];

function dist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

function createPlayer(id, tankId, username) {
    return {
        x: -1000, y: -1000, angle: 0, turretAngle: 0, hp: 0, maxHp: 0, 
        reloadCooldown: 0, tankTypeId: tankId || 'm4', username: username,
        inputs: { w: false, a: false, s: false, d: false, mouseX: 0, mouseY: 0, mouseDown: false }
    };
}

function resetBoard(room) {
    room.projectiles = [];
    room.trees = [];
    const margin = 120;

    let corners = [
        [{x: margin, y: margin, angle: Math.PI/4}, {x: 1200-margin, y: 800-margin, angle: -Math.PI*0.75}],
        [{x: 1200-margin, y: margin, angle: Math.PI*0.75}, {x: margin, y: 800-margin, angle: -Math.PI/4}]
    ];
    let selectedCorners = corners[Math.floor(Math.random() * corners.length)];
    
    if (room.players[room.p1Id]) {
        let p = room.players[room.p1Id];
        p.x = selectedCorners[0].x; p.y = selectedCorners[0].y;
        p.angle = selectedCorners[0].angle; p.turretAngle = selectedCorners[0].angle;
        p.hp = TANK_STATS[p.tankTypeId].hp; p.reloadCooldown = 0;
    }
    
    if (room.players[room.p2Id]) {
        let p = room.players[room.p2Id];
        p.x = selectedCorners[1].x; p.y = selectedCorners[1].y;
        p.angle = selectedCorners[1].angle; p.turretAngle = selectedCorners[1].angle;
        p.hp = TANK_STATS[p.tankTypeId].hp; p.reloadCooldown = 0;
    }

    const numTrees = 12 + Math.floor(Math.random() * 8);
    for (let i = 0; i < numTrees; i++) {
        let tx, ty, safe;
        let attempts = 0;
        do {
            tx = 1200 * 0.25 + Math.random() * (1200 * 0.5);
            ty = 800 * 0.2 + Math.random() * (800 * 0.6);
            safe = room.players[room.p1Id] && dist(tx, ty, room.players[room.p1Id].x, room.players[room.p1Id].y) > 150 && 
                   room.players[room.p2Id] && dist(tx, ty, room.players[room.p2Id].x, room.players[room.p2Id].y) > 150;
            attempts++;
        } while (!safe && attempts < 50);

        if (safe) room.trees.push({ x: tx, y: ty, radius: 22 + Math.random() * 12, swayOffset: Math.random() * Math.PI * 2 });
    }
}

io.on('connection', (socket) => {
    socket.emit('init', socket.id);

    // Player attempts to join matchmaking
    socket.on('join', (data) => {
        if (socket.roomId || waitingSockets.includes(socket)) return;

        // Clean the username with the profanity filter, fallback to 'Guest' if empty
        let rawName = data.username ? data.username.trim() : "";
        if (rawName === "") rawName = "Guest";
        
        socket.tankId = data.tankId || 'm4';
        socket.username = filter.clean(rawName); 

        // Check for a valid waiting opponent
        let opponent = null;
        while(waitingSockets.length > 0) {
            let potential = waitingSockets.shift();
            // Ensure they haven't disconnected while in queue
            if (potential.connected && potential.id !== socket.id) {
                opponent = potential;
                break;
            }
        }

        if (opponent) {
            // Match found! Create a private room
            let roomId = "room_" + Math.random().toString(36).substring(7);
            
            socket.join(roomId);
            opponent.join(roomId);
            
            socket.roomId = roomId;
            opponent.roomId = roomId;

            let room = {
                id: roomId,
                p1Id: opponent.id,
                p2Id: socket.id,
                players: {},
                projectiles: [],
                trees: [],
                gameState: "PLAYING",
                scores: { p1: 0, p2: 0 }
            };

            room.players[opponent.id] = createPlayer(opponent.id, opponent.tankId, opponent.username);
            room.players[socket.id] = createPlayer(socket.id, socket.tankId, socket.username);
            
            activeRooms[roomId] = room;
            resetBoard(room);

            // Emit ONLY to players in this specific room
            io.to(roomId).emit('gameStart', { trees: room.trees, p1Id: room.p1Id, p2Id: room.p2Id });
        } else {
            // No opponent found, enter queue
            waitingSockets.push(socket);
        }
    });

    socket.on('changeTank', (tankId) => {
        socket.tankId = tankId; // Save for next game
        if (socket.roomId && activeRooms[socket.roomId]) {
            let room = activeRooms[socket.roomId];
            if (room.players[socket.id] && TANK_STATS[tankId]) {
                room.players[socket.id].tankTypeId = tankId;
            }
        }
    });

    socket.on('input', (data) => {
        if (socket.roomId && activeRooms[socket.roomId]) {
            let room = activeRooms[socket.roomId];
            if (room.players[socket.id] && room.gameState === "PLAYING") {
                room.players[socket.id].inputs = data;
            }
        }
    });

    socket.on('disconnect', () => {
        // Remove from waiting queue if they were there
        let index = waitingSockets.indexOf(socket);
        if (index !== -1) waitingSockets.splice(index, 1);

        // If they were in an active match
        if (socket.roomId && activeRooms[socket.roomId]) {
            let room = activeRooms[socket.roomId];
            let opponentId = (socket.id === room.p1Id) ? room.p2Id : room.p1Id;
            let roomId = socket.roomId;
            
            io.to(roomId).emit('playerLeft');
            delete activeRooms[roomId];
            
            // Rescue the surviving opponent and push them back into the matchmaking queue
            let opponentSocket = io.sockets.sockets.get(opponentId);
            if (opponentSocket) {
                opponentSocket.roomId = null;
                opponentSocket.leave(roomId);
                waitingSockets.push(opponentSocket);
            }
        }
    });
});

setInterval(() => {
    // Process every active match independently
    for (let roomId in activeRooms) {
        let room = activeRooms[roomId];
        
        if (room.gameState === "PLAYING") {
            
            // 1. Process Players
            for (let id in room.players) {
                let p = room.players[id];
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
                    for (let tree of room.trees) {
                        if (dist(nextX, nextY, tree.x, tree.y) < 18 + tree.radius) {
                            hitTree = true; break;
                        }
                    }
                    if (!hitTree) {
                        p.x = Math.max(30, Math.min(1170, nextX));
                        p.y = Math.max(30, Math.min(770, nextY));
                    }
                }

                let targetTurretAngle = Math.atan2(p.inputs.mouseY - p.y, p.inputs.mouseX - p.x);
                let tDiff = targetTurretAngle - p.turretAngle;
                while (tDiff < -Math.PI) tDiff += Math.PI * 2;
                while (tDiff > Math.PI) tDiff -= Math.PI * 2;
                
                if (Math.abs(tDiff) <= stats.turretSpeed) {
                    p.turretAngle = targetTurretAngle;
                } else {
                    p.turretAngle += Math.sign(tDiff) * stats.turretSpeed;
                }

                if (p.reloadCooldown <= 0 && p.inputs.mouseDown) {
                    let muzzleX = p.x + Math.cos(p.turretAngle) * 28;
                    let muzzleY = p.y + Math.sin(p.turretAngle) * 28;
                    let spreadAngle = p.turretAngle + (Math.random() - 0.5) * stats.accuracy;
                    
                    room.projectiles.push({ 
                        x: muzzleX, y: muzzleY, 
                        angle: spreadAngle, 
                        speed: stats.projSpeed, 
                        shooterId: id, 
                        damage: stats.damage,
                        distance: 0,
                        maxRange: stats.range
                    });
                    p.reloadCooldown = stats.reload;
                    io.to(roomId).emit('effect', { type: 'fire', x: muzzleX, y: muzzleY });
                }
                if (p.reloadCooldown > 0) p.reloadCooldown--;
            }

            // 2. Process Projectiles
            for (let i = room.projectiles.length - 1; i >= 0; i--) {
                let proj = room.projectiles[i];
                proj.x += Math.cos(proj.angle) * proj.speed;
                proj.y += Math.sin(proj.angle) * proj.speed;
                proj.distance += proj.speed;

                let hit = false;
                
                if (proj.distance > proj.maxRange) {
                    hit = true;
                    io.to(roomId).emit('effect', { type: 'hitTree', x: proj.x, y: proj.y }); 
                }

                if (!hit && (proj.x < 0 || proj.x > 1200 || proj.y < 0 || proj.y > 800)) hit = true;

                if (!hit) {
                    for (let tree of room.trees) {
                        if (dist(proj.x, proj.y, tree.x, tree.y) < tree.radius + 4) {
                            hit = true;
                            io.to(roomId).emit('effect', { type: 'hitTree', x: proj.x, y: proj.y });
                            break;
                        }
                    }
                }

                if (!hit) {
                    for (let id in room.players) {
                        let p = room.players[id];
                        if (id !== proj.shooterId && p.hp > 0 && dist(proj.x, proj.y, p.x, p.y) < 18 + 4) {
                            hit = true;
                            p.hp -= proj.damage;
                            io.to(roomId).emit('effect', { type: 'hitTank', x: proj.x, y: proj.y, damage: proj.damage });

                            if (p.hp <= 0) {
                                if (proj.shooterId === room.p1Id) room.scores.p1++;
                                if (proj.shooterId === room.p2Id) room.scores.p2++;
                                room.gameState = "GAMEOVER";
                                io.to(roomId).emit('gameOver', { winnerId: proj.shooterId });
                                
                                setTimeout(() => {
                                    // Ensure room still exists (they didn't disconnect)
                                    if(activeRooms[roomId] && activeRooms[roomId].gameState === "GAMEOVER") {
                                        activeRooms[roomId].gameState = "PLAYING";
                                        resetBoard(activeRooms[roomId]);
                                        io.to(roomId).emit('gameStart', { trees: activeRooms[roomId].trees, p1Id: room.p1Id, p2Id: room.p2Id });
                                    }
                                }, 3000);
                            }
                            break;
                        }
                    }
                }

                if (hit) room.projectiles.splice(i, 1);
            }

            // 3. Broadcast State
            io.to(roomId).emit('stateUpdate', { players: room.players, projectiles: room.projectiles, p1Id: room.p1Id, p2Id: room.p2Id, scores: room.scores });
        }
    }
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Game Server running on port ${PORT}`));
