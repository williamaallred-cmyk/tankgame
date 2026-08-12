const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const filter = require('leo-profanity');

// Ensure English dictionary is loaded for the profanity filter
filter.loadDictionary('en');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// Advanced Damage Model Stats
// hp: Base Health, pen: Armor Penetration, armor: {f: Front, s: Side, r: Rear}
const TANK_STATS = {
    // WW1
    "mkiv": { hp: 400, speed: 1.5, reload: 180, damage: 100, pen: 30, armor: {f: 15, s: 12, r: 12}, range: 400, accuracy: 0.15, turretSpeed: 0.02, projSpeed: 24 },
    "a7v":  { hp: 500, speed: 1.2, reload: 200, damage: 100, pen: 30, armor: {f: 30, s: 15, r: 15}, range: 400, accuracy: 0.15, turretSpeed: 0.02, projSpeed: 24 },
    "ft17": { hp: 200, speed: 2.5, reload: 120, damage: 80,  pen: 25, armor: {f: 16, s: 8, r: 8},   range: 350, accuracy: 0.12, turretSpeed: 0.04, projSpeed: 20 },
    // WW2
    "m4":    { hp: 500, speed: 3.0, reload: 120, damage: 150, pen: 120, armor: {f: 50, s: 38, r: 38},  range: 600, accuracy: 0.08, turretSpeed: 0.06, projSpeed: 36 },
    "t34":   { hp: 500, speed: 3.2, reload: 110, damage: 150, pen: 110, armor: {f: 45, s: 45, r: 40},  range: 550, accuracy: 0.10, turretSpeed: 0.05, projSpeed: 36 },
    "tiger": { hp: 700, speed: 2.0, reload: 160, damage: 200, pen: 150, armor: {f: 100, s: 80, r: 80}, range: 800, accuracy: 0.04, turretSpeed: 0.03, projSpeed: 44 },
    "stug":  { hp: 450, speed: 2.2, reload: 140, damage: 180, pen: 140, armor: {f: 80, s: 30, r: 30},  range: 700, accuracy: 0.05, turretSpeed: 0.015, projSpeed: 40 },
    // Cold War
    "m48":  { hp: 700, speed: 3.5, reload: 100, damage: 250, pen: 250, armor: {f: 110, s: 76, r: 35}, range: 800, accuracy: 0.05, turretSpeed: 0.08, projSpeed: 52 },
    "t55":  { hp: 650, speed: 3.4, reload: 110, damage: 250, pen: 260, armor: {f: 100, s: 80, r: 45}, range: 750, accuracy: 0.06, turretSpeed: 0.07, projSpeed: 50 },
    "leo1": { hp: 600, speed: 4.5, reload: 90,  damage: 240, pen: 300, armor: {f: 70, s: 35, r: 25},  range: 900, accuracy: 0.03, turretSpeed: 0.10, projSpeed: 56 },
    // Modern
    "m1a2": { hp: 1000, speed: 4.0, reload: 100, damage: 400, pen: 600, armor: {f: 600, s: 150, r: 50}, range: 1200, accuracy: 0.01, turretSpeed: 0.15, projSpeed: 76 },
    "t90":  { hp: 900,  speed: 3.8, reload: 100, damage: 380, pen: 550, armor: {f: 550, s: 130, r: 45}, range: 1100, accuracy: 0.02, turretSpeed: 0.12, projSpeed: 72 }
};

const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1600;

// Lobby System
let activeRooms = {}; 

function generateTrees() {
    let trees = [];
    const numTrees = 20 + Math.floor(Math.random() * 15);
    for (let i = 0; i < numTrees; i++) {
        trees.push({
            x: Math.random() * (WORLD_WIDTH - 200) + 100,
            y: Math.random() * (WORLD_HEIGHT - 200) + 100,
            radius: 22 + Math.random() * 12,
            swayOffset: Math.random() * Math.PI * 2
        });
    }
    return trees;
}

function getRandomSpawn(room) {
    return {
        x: Math.random() * (WORLD_WIDTH - 200) + 100,
        y: Math.random() * (WORLD_HEIGHT - 200) + 100,
        angle: Math.random() * Math.PI * 2
    };
}

function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }

// Helper for Continuous Collision Detection (Tunneling fix)
function pointSegmentDist(px, py, x1, y1, x2, y2) {
    let lengthSquared = Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2);
    if (lengthSquared === 0) return { distance: dist(px, py, x1, y1), hitX: x1, hitY: y1 };
    
    // Find the closest point on the line segment using vector projection
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / lengthSquared;
    t = Math.max(0, Math.min(1, t)); // Clamp between 0 and 1
    
    let closestX = x1 + t * (x2 - x1);
    let closestY = y1 + t * (y2 - y1);
    return { distance: dist(px, py, closestX, closestY), hitX: closestX, hitY: closestY };
}

function getTankName(id) {
    const names = {
        "mkiv": "Mark IV", "a7v": "A7V", "ft17": "Renault FT",
        "m4": "M4 Sherman", "t34": "T-34", "tiger": "Tiger I", "stug": "StuG III",
        "m48": "M48 Patton", "t55": "T-55", "leo1": "Leopard 1",
        "m1a2": "M1A2 Abrams", "t90": "T-90"
    };
    return names[id] || "Tank";
}

function createPlayer(id, tankId, username) {
    return {
        id: id, x: -1000, y: -1000, angle: 0, turretAngle: 0, hp: 0, maxHp: 0, 
        reloadCooldown: 0, tankTypeId: tankId || 'm4', tankName: getTankName(tankId || 'm4'), username: username,
        kills: 0, deaths: 0, respawnTimer: 0,
        debuffs: { track: 0, engine: 0, turret: 0, gun: 0 },
        inputs: { w: false, a: false, s: false, d: false, shift: false, mouseX: 0, mouseY: 0, mouseDown: false }
    };
}

io.on('connection', (socket) => {
    socket.emit('init', socket.id);

    // Filter profanity logic
    function cleanUsername(rawName) {
        let name = rawName.trim().substring(0, 12);
        if (!name || name === "") name = "Operator";
        if (filter.check(name)) return "TrollTank"; // Penalty for bad words
        return name;
    }

    socket.on('requestPublicRooms', () => {
        let publicRooms = [];
        for (let id in activeRooms) {
            let r = activeRooms[id];
            if (!r.isPrivate) {
                publicRooms.push({ id: id, name: r.name, playerCount: Object.keys(r.players).length, maxPlayers: r.maxPlayers });
            }
        }
        socket.emit('publicRoomsList', publicRooms);
    });

    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        let maxP = parseInt(data.maxPlayers) || 5;
        if (maxP < 2) maxP = 2; if (maxP > 5) maxP = 5;

        activeRooms[roomId] = {
            id: roomId,
            name: filter.clean(data.roomName.substring(0, 20)) || "Match",
            isPrivate: data.isPrivate === 'private',
            password: data.password || "",
            maxPlayers: maxP,
            players: {},
            projectiles: [],
            trees: generateTrees(),
            isGameOver: false,
            winnerName: null
        };

        socket.emit('gameStart', { roomId: roomId, roomName: activeRooms[roomId].name, trees: activeRooms[roomId].trees });
        joinRoomInternal(socket, roomId, data.tankId, data.username);
    });

    socket.on('joinRoom', (data) => {
        let room = activeRooms[data.roomId];
        if (!room) return socket.emit('lobbyError', "Room not found.");
        if (Object.keys(room.players).length >= room.maxPlayers) return socket.emit('lobbyError', "Room is full.");
        if (room.isPrivate && room.password !== data.password) return socket.emit('lobbyError', "Incorrect password.");

        socket.emit('gameStart', { roomId: data.roomId, roomName: room.name, trees: room.trees });
        joinRoomInternal(socket, data.roomId, data.tankId, data.username);
    });

    function joinRoomInternal(socket, roomId, tankId, username) {
        socket.join(roomId);
        socket.roomId = roomId;
        let room = activeRooms[roomId];
        let pName = cleanUsername(username);
        
        let p = createPlayer(socket.id, tankId, pName);
        let spawn = getRandomSpawn(room);
        p.x = spawn.x; p.y = spawn.y; p.angle = spawn.angle; p.turretAngle = spawn.angle;
        p.hp = TANK_STATS[p.tankTypeId].hp; p.maxHp = p.hp;
        
        room.players[socket.id] = p;
    }

    socket.on('changeTank', (tankId) => {
        if (socket.roomId && activeRooms[socket.roomId] && activeRooms[socket.roomId].players[socket.id]) {
            let p = activeRooms[socket.roomId].players[socket.id];
            if (TANK_STATS[tankId]) {
                p.tankTypeId = tankId;
                p.tankName = getTankName(tankId);
                // Tank will physically change upon next respawn
            }
        }
    });

    socket.on('input', (data) => {
        if (socket.roomId && activeRooms[socket.roomId] && activeRooms[socket.roomId].players[socket.id]) {
            activeRooms[socket.roomId].players[socket.id].inputs = data;
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomId && activeRooms[socket.roomId]) {
            let room = activeRooms[socket.roomId];
            delete room.players[socket.id];
            if (Object.keys(room.players).length === 0) {
                delete activeRooms[socket.roomId]; // Clean up empty rooms
            }
        }
    });
});

// 60 FPS Game Loop for all rooms
setInterval(() => {
    for (let roomId in activeRooms) {
        let room = activeRooms[roomId];
        if (room.isGameOver) continue;

        // 1. Process Players
        for (let id in room.players) {
            let p = room.players[id];
            
            // Handle Respawning
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
                        p.debuffs = { track: 0, engine: 0, turret: 0, gun: 0 };
                    }
                }
                continue;
            }

            let stats = TANK_STATS[p.tankTypeId];
            p.maxHp = stats.hp;

            // Process Debuff Timers
            for (let key in p.debuffs) {
                if (p.debuffs[key] > 0) p.debuffs[key]--;
            }

            // Movement Physics with Engine/Track Debuffs
            let currentSpeed = stats.speed;
            if (p.debuffs.track > 0) currentSpeed = 0; // Immobilized
            else if (p.debuffs.engine > 0) currentSpeed *= 0.4; // Slowed

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
                p.angle += aDiff * 0.15;

                let nextX = p.x + Math.cos(targetAngle) * currentSpeed;
                let nextY = p.y + Math.sin(targetAngle) * currentSpeed;

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

            // Turret Traverse with Jam Debuff
            let currentTurretSpeed = stats.turretSpeed;
            if (p.debuffs.turret > 0) currentTurretSpeed *= 0.1;

            let targetTurretAngle = Math.atan2(p.inputs.mouseY - p.y, p.inputs.mouseX - p.x);
            let tDiff = targetTurretAngle - p.turretAngle;
            while (tDiff < -Math.PI) tDiff += Math.PI * 2;
            while (tDiff > Math.PI) tDiff -= Math.PI * 2;
            
            if (Math.abs(tDiff) <= currentTurretSpeed) {
                p.turretAngle = targetTurretAngle;
            } else {
                p.turretAngle += Math.sign(tDiff) * currentTurretSpeed;
            }

            // Reload and Firing logic with Gun Damage Debuff
            let currentReload = stats.reload;
            if (p.debuffs.gun > 0) currentReload *= 2.5;

            if (p.reloadCooldown > 0) p.reloadCooldown--;
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
                    pen: stats.pen,
                    distance: 0,
                    maxRange: stats.range
                });
                p.reloadCooldown = currentReload;
                io.to(roomId).emit('effect', { type: 'fire', x: muzzleX, y: muzzleY });
            }
        }

        // 2. Process Projectiles with Continuous Collision Detection
        for (let i = room.projectiles.length - 1; i >= 0; i--) {
            let proj = room.projectiles[i];
            
            // Track previous position for CCD raycast
            let oldX = proj.x;
            let oldY = proj.y;
            
            proj.x += Math.cos(proj.angle) * proj.speed;
            proj.y += Math.sin(proj.angle) * proj.speed;
            proj.distance += proj.speed; 

            if (proj.x < 0 || proj.x > WORLD_WIDTH || proj.y < 0 || proj.y > WORLD_HEIGHT || proj.distance > proj.maxRange) {
                room.projectiles.splice(i, 1);
                continue;
            }

            let hit = false;
            let hitResult = null;

            for (let tree of room.trees) {
                // Raycast against tree
                hitResult = pointSegmentDist(tree.x, tree.y, oldX, oldY, proj.x, proj.y);
                if (hitResult.distance < 4 + tree.radius) {
                    hit = true;
                    io.to(roomId).emit('effect', { type: 'hitTree', x: hitResult.hitX, y: hitResult.hitY });
                    break;
                }
            }

            if (!hit) {
                for (let id in room.players) {
                    let p = room.players[id];
                    if (id !== proj.shooterId && p.hp > 0) {
                        // Raycast against enemy tank
                        hitResult = pointSegmentDist(p.x, p.y, oldX, oldY, proj.x, proj.y);
                        
                        // 18 is tank body radius, 4 is projectile radius
                        if (hitResult.distance < 18 + 4) {
                            hit = true;
                            
                            let stats = TANK_STATS[p.tankTypeId];
                            
                            // Calculate Hit Angle (Front, Side, Rear)
                            let relAngle = proj.angle - p.angle;
                            while (relAngle < -Math.PI) relAngle += Math.PI * 2;
                            while (relAngle > Math.PI) relAngle -= Math.PI * 2;
                            
                            let absRelAngle = Math.abs(relAngle);
                            let hitZone = 's'; // Default to side
                            if (absRelAngle < Math.PI / 4 || absRelAngle > 7 * Math.PI / 4) hitZone = 'r'; // Rear
                            else if (absRelAngle > 3 * Math.PI / 4 && absRelAngle < 5 * Math.PI / 4) hitZone = 'f'; // Front

                            let effectiveArmor = stats.armor[hitZone];
                            
                            // Distance Falloff for Penetration
                            let penFalloff = Math.max(0.5, 1 - (proj.distance / proj.maxRange));
                            let effectivePen = proj.pen * penFalloff;

                            // Armor vs Penetration Scaling
                            let penRatio = effectivePen / effectiveArmor;
                            let dmgMultiplier = Math.min(3.0, Math.max(0.1, penRatio));
                            
                            // Final Damage with +/- 15% RNG
                            let finalDamage = Math.round(proj.damage * dmgMultiplier * (0.85 + Math.random() * 0.3));
                            p.hp -= finalDamage;
                            
                            // Critical Hits / Debuffs
                            let critText = null;
                            if (finalDamage > p.maxHp * 0.05 && Math.random() < (finalDamage / p.maxHp) * 1.5) {
                                let rolls = ['track', 'engine', 'turret', 'gun'];
                                let critType = rolls[Math.floor(Math.random() * rolls.length)];
                                p.debuffs[critType] = 300; // Debuff lasts 5 seconds
                                
                                if(critType === 'track') critText = "TRACKS DESTROYED!";
                                if(critType === 'engine') critText = "ENGINE DAMAGED!";
                                if(critType === 'turret') critText = "TURRET JAMMED!";
                                if(critType === 'gun') critText = "GUN DAMAGED!";
                            }

                            // Emit visual effect
                            io.to(roomId).emit('effect', { type: 'hitTank', x: hitResult.hitX, y: hitResult.hitY, damage: finalDamage, critText: critText });

                            // Handle Death Event
                            if (p.hp <= 0) {
                                let shooter = room.players[proj.shooterId];
                                if (shooter) {
                                    shooter.kills++;
                                    io.to(roomId).emit('killfeed', { killer: shooter.username, victim: p.username });
                                    
                                    if (shooter.kills >= 10) {
                                        room.isGameOver = true;
                                        room.winnerName = shooter.username;
                                        io.to(roomId).emit('gameOver', { winnerName: shooter.username });
                                        
                                        // Reset room after 5 seconds
                                        setTimeout(() => {
                                            room.isGameOver = false;
                                            room.winnerName = null;
                                            room.projectiles = [];
                                            room.trees = generateTrees();
                                            for(let pid in room.players) {
                                                let pl = room.players[pid];
                                                pl.kills = 0; pl.hp = 0; pl.respawnTimer = 1;
                                            }
                                            io.to(roomId).emit('gameStart', { roomId: roomId, roomName: room.name, trees: room.trees });
                                        }, 5000);
                                    }
                                }
                                p.deaths++;
                                p.respawnTimer = 180; // 3 second respawn penalty
                            }
                            break; // Exit player collision check since shell exploded
                        }
                    }
                }
            }

            if (hit) room.projectiles.splice(i, 1);
        }

        // 3. Broadcast State
        io.to(roomId).emit('stateUpdate', {
            players: room.players,
            projectiles: room.projectiles.map(p => ({x: p.x, y: p.y})) // strip unneeded data
        });
    }
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server Authoritative Multiplayer running on port ${PORT}`);
});
