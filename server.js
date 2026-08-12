const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

// Initialize the profanity filter
const filter = require('leo-profanity');
filter.loadDictionary('en'); // Force English dictionary load

// Custom blacklist for tricky names
const customBadWords = ['fucku', 'fuku', 'b1tch', 'bitch', 'asshole', 'sh1t', 'cunt', 'n1gga', 'nigga'];
filter.add(customBadWords);

app.use(express.static(path.join(__dirname, 'public')));

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

const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1600;
const KILLS_TO_WIN = 10;
let activeRooms = {};

function dist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

function createPlayer(id, tankId, username) {
    return {
        id: id, x: -1000, y: -1000, angle: 0, turretAngle: 0, hp: 0, maxHp: 0, 
        reloadCooldown: 0, tankTypeId: tankId || 'm4', username: username,
        kills: 0, deaths: 0, respawnTimer: 0,
        inputs: { w: false, a: false, s: false, d: false, mouseX: 0, mouseY: 0, mouseDown: false }
    };
}

function getRandomSpawn(room) {
    let x, y, safe;
    let attempts = 0;
    do {
        x = 100 + Math.random() * (WORLD_WIDTH - 200);
        y = 100 + Math.random() * (WORLD_HEIGHT - 200);
        safe = true;
        for (let id in room.players) {
           let other = room.players[id];
           if (other.hp > 0 && dist(x,y, other.x, other.y) < 300) safe = false;
        }
        attempts++;
    } while (!safe && attempts < 50);
    return {x, y, angle: Math.random() * Math.PI * 2};
}

function resetBoard(room) {
    room.projectiles = [];
    room.trees = [];
    
    // Spawn players
    for (let id in room.players) {
        let p = room.players[id];
        let spawn = getRandomSpawn(room);
        p.x = spawn.x; p.y = spawn.y;
        p.angle = spawn.angle; p.turretAngle = spawn.angle;
        p.hp = TANK_STATS[p.tankTypeId].hp; 
        p.maxHp = p.hp;
        p.reloadCooldown = 0;
        p.respawnTimer = 0;
        p.kills = 0;
        p.deaths = 0;
    }

    // Generate trees across the larger map
    const numTrees = 30 + Math.floor(Math.random() * 20);
    for (let i = 0; i < numTrees; i++) {
        let tx = 100 + Math.random() * (WORLD_WIDTH - 200);
        let ty = 100 + Math.random() * (WORLD_HEIGHT - 200);
        room.trees.push({ x: tx, y: ty, radius: 22 + Math.random() * 15, swayOffset: Math.random() * Math.PI * 2 });
    }
}

io.on('connection', (socket) => {
    socket.emit('init', socket.id);

    function cleanString(rawStr, fallback, isName = false) {
        let str = rawStr ? rawStr.trim() : "";
        if (str === "") return fallback;
        if (isName && filter.check(str)) return "TrollTank";
        return isName ? filter.clean(str) : str;
    }

    // Client requests the list of active public rooms
    socket.on('requestPublicRooms', () => {
        let publicRooms = [];
        for (let roomId in activeRooms) {
            let room = activeRooms[roomId];
            if (!room.isPrivate && room.gameState !== "GAMEOVER") {
                publicRooms.push({
                    id: room.id,
                    name: room.name,
                    playerCount: Object.keys(room.players).length,
                    maxPlayers: room.maxPlayers
                });
            }
        }
        socket.emit('publicRoomsList', publicRooms);
    });

    socket.on('createRoom', (data) => {
        if (socket.roomId) return;
        
        let roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        let maxP = parseInt(data.maxPlayers) || 5;
        if (maxP < 2) maxP = 2;
        if (maxP > 5) maxP = 5;

        socket.join(roomId);
        socket.roomId = roomId;

        let room = {
            id: roomId,
            name: cleanString(data.roomName, `${cleanString(data.username, "Guest", true)}'s Match`),
            isPrivate: data.isPrivate === 'private',
            password: data.password || "",
            maxPlayers: maxP,
            players: {},
            projectiles: [],
            trees: [],
            gameState: "PLAYING"
        };
        
        let username = cleanString(data.username, "Guest", true);
        room.players[socket.id] = createPlayer(socket.id, data.tankId, username);
        
        activeRooms[roomId] = room;
        resetBoard(room);

        io.to(roomId).emit('gameStart', { trees: room.trees, roomId: roomId, maxPlayers: maxP, roomName: room.name });
    });

    socket.on('joinRoom', (data) => {
        if (socket.roomId) return;
        let roomId = data.roomId.toUpperCase().trim();
        let room = activeRooms[roomId];

        if (!room) {
            socket.emit('lobbyError', "Room not found.");
            return;
        }

        if (room.isPrivate && room.password !== data.password) {
            socket.emit('lobbyError', "Incorrect Password.");
            return;
        }

        if (Object.keys(room.players).length >= room.maxPlayers) {
            socket.emit('lobbyError', "Room is full.");
            return;
        }

        socket.join(roomId);
        socket.roomId = roomId;
        
        let username = cleanString(data.username, "Guest", true);
        let p = createPlayer(socket.id, data.tankId, username);
        
        // Drop them in mid-match
        let spawn = getRandomSpawn(room);
        p.x = spawn.x; p.y = spawn.y;
        p.angle = spawn.angle; p.turretAngle = spawn.angle;
        p.hp = TANK_STATS[p.tankTypeId].hp;
        p.maxHp = p.hp;

        room.players[socket.id] = p;
        io.to(roomId).emit('gameStart', { trees: room.trees, roomId: roomId, maxPlayers: room.maxPlayers, roomName: room.name });
    });

    socket.on('changeTank', (tankId) => {
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
        if (socket.roomId && activeRooms[socket.roomId]) {
            let room = activeRooms[socket.roomId];
            delete room.players[socket.id];
            
            // If room is empty, destroy it
            if (Object.keys(room.players).length === 0) {
                delete activeRooms[socket.roomId];
            } else {
                io.to(socket.roomId).emit('playerLeft', socket.id);
            }
        }
    });
});

setInterval(() => {
    for (let roomId in activeRooms) {
        let room = activeRooms[roomId];
        
        if (room.gameState === "PLAYING") {
            
            for (let id in room.players) {
                let p = room.players[id];
                
                // Handle Respawn
                if (p.hp <= 0) {
                    if (p.respawnTimer > 0) {
                        p.respawnTimer--;
                        if (p.respawnTimer <= 0) {
                            let spawn = getRandomSpawn(room);
                            p.x = spawn.x; p.y = spawn.y;
                            p.angle = spawn.angle; p.turretAngle = spawn.angle;
                            p.hp = TANK_STATS[p.tankTypeId].hp;
                            p.maxHp = p.hp;
                            p.reloadCooldown = 0;
                        }
                    }
                    continue;
                }

                let stats = TANK_STATS[p.tankTypeId];
                p.maxHp = stats.hp;

                let moveX = 0; let moveY = 0;
                if (p.inputs.w) moveY -= 1;
                if (p.inputs.s) moveY += 1;
                if (p.inputs.a) moveX -= 1;
                if (p.inputs.d) moveX += 1;

                if (moveX !== 0 || moveY !== 0) {
                    let targetAngle = Math.atan2(moveY, moveX);
                    let aDiff = targetAngle - p.angle;
                    while (aDiff < -Math.PI) aDiff += Math.PI * 2;
                    while (aDiff > Math.PI) aDiff -= Math.PI * 2;
                    p.angle += aDiff * 0.15; // Smooth hull rotation

                    let nextX = p.x + Math.cos(targetAngle) * stats.speed;
                    let nextY = p.y + Math.sin(targetAngle) * stats.speed;

                    let hitTree = false;
                    for (let tree of room.trees) {
                        if (dist(nextX, nextY, tree.x, tree.y) < 18 + tree.radius) {
                            hitTree = true; break;
                        }
                    }
                    if (!hitTree) {
                        p.x = Math.max(30, Math.min(WORLD_WIDTH - 30, nextX));
                        p.y = Math.max(30, Math.min(WORLD_HEIGHT - 30, nextY));
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

                if (!hit && (proj.x < 0 || proj.x > WORLD_WIDTH || proj.y < 0 || proj.y > WORLD_HEIGHT)) hit = true;

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
                                let shooter = room.players[proj.shooterId];
                                if (shooter) shooter.kills++;
                                p.deaths++;
                                p.respawnTimer = 180; // 3 seconds at 60fps
                                io.to(roomId).emit('killfeed', { killer: shooter ? shooter.username : "Unknown", victim: p.username });

                                // Check Win Condition
                                if (shooter && shooter.kills >= KILLS_TO_WIN) {
                                    room.gameState = "GAMEOVER";
                                    io.to(roomId).emit('gameOver', { winnerName: shooter.username });
                                    
                                    setTimeout(() => {
                                        if(activeRooms[roomId]) {
                                            activeRooms[roomId].gameState = "PLAYING";
                                            resetBoard(activeRooms[roomId]);
                                            io.to(roomId).emit('gameStart', { trees: activeRooms[roomId].trees, roomId: roomId, maxPlayers: room.maxPlayers, roomName: room.name });
                                        }
                                    }, 6000);
                                }
                            }
                            break;
                        }
                    }
                }

                if (hit) room.projectiles.splice(i, 1);
            }

            io.to(roomId).emit('stateUpdate', { players: room.players, projectiles: room.projectiles });
        }
    }
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Game Server running on port ${PORT}`));
