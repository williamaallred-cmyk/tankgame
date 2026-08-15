const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');
const filter = require('leo-profanity');

// Load English dictionary for profanity filter
filter.loadDictionary('en');
filter.add(['bitch', 'fucku', 'fuk', 'shit', 'cunt', 'asshole']);

app.use(express.static(path.join(__dirname, 'public')));

const TANK_STATS = {
    // WW1
    "mkiv":  { hp: 480, speed: 1.8, reload: 175, damage: 115, pen: 32, armor: {f: 18, s: 14, r: 14}, range: 420, accuracy: 0.13, turretSpeed: 0.025, projSpeed: 26, hitbox: 24 },
    "a7v":   { hp: 560, speed: 1.5, reload: 190, damage: 115, pen: 32, armor: {f: 35, s: 18, r: 18}, range: 420, accuracy: 0.13, turretSpeed: 0.025, projSpeed: 26, hitbox: 22 },
    "ft17":  { hp: 240, speed: 2.8, reload: 115, damage: 95,  pen: 28, armor: {f: 18, s: 10, r: 10}, range: 370, accuracy: 0.11, turretSpeed: 0.045, projSpeed: 22, hitbox: 12 },
    // WW2
    "m4":    { hp: 500, speed: 3.0, reload: 120, damage: 150, pen: 120, armor: {f: 50, s: 38, r: 38},  range: 600, accuracy: 0.08, turretSpeed: 0.06, projSpeed: 36, hitbox: 18 },
    "t34":   { hp: 500, speed: 3.2, reload: 110, damage: 150, pen: 110, armor: {f: 45, s: 45, r: 40},  range: 550, accuracy: 0.10, turretSpeed: 0.05, projSpeed: 36, hitbox: 18 },
    "tiger": { hp: 700, speed: 2.0, reload: 160, damage: 200, pen: 150, armor: {f: 100, s: 80, r: 80}, range: 800, accuracy: 0.04, turretSpeed: 0.03, projSpeed: 44, hitbox: 22 },
    "stug":  { hp: 450, speed: 2.2, reload: 140, damage: 180, pen: 140, armor: {f: 80, s: 30, r: 30},  range: 700, accuracy: 0.05, turretSpeed: 0.015, projSpeed: 40, hitbox: 18 },
    // Cold War
    "m48":   { hp: 700, speed: 3.5, reload: 100, damage: 250, pen: 250, armor: {f: 110, s: 76, r: 35}, range: 800, accuracy: 0.05, turretSpeed: 0.08, projSpeed: 52, hitbox: 20 },
    "t55":   { hp: 650, speed: 3.4, reload: 110, damage: 250, pen: 260, armor: {f: 100, s: 80, r: 45}, range: 750, accuracy: 0.06, turretSpeed: 0.07, projSpeed: 50, hitbox: 19 },
    "leo1":  { hp: 600, speed: 4.5, reload: 90,  damage: 240, pen: 300, armor: {f: 70, s: 35, r: 25},  range: 900, accuracy: 0.03, turretSpeed: 0.10, projSpeed: 56, hitbox: 19 },
    // Modern
    "m1a2":  { hp: 1000, speed: 4.0, reload: 100, damage: 400, pen: 600, armor: {f: 600, s: 150, r: 50}, range: 1200, accuracy: 0.01, turretSpeed: 0.15, projSpeed: 76, hitbox: 22 },
    "t90":   { hp: 900,  speed: 3.8, reload: 100, damage: 380, pen: 550, armor: {f: 550, s: 130, r: 45}, range: 1100, accuracy: 0.02, turretSpeed: 0.12, projSpeed: 72, hitbox: 20 }
};

const TANK_ERAS = {
    'mkiv': 'WW1', 'a7v': 'WW1', 'ft17': 'WW1',
    'm4': 'WW2', 't34': 'WW2', 'tiger': 'WW2', 'stug': 'WW2',
    'm48': 'Cold War', 't55': 'Cold War', 'leo1': 'Cold War',
    'm1a2': 'Modern Era', 't90': 'Modern Era'
};

const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1600;

let activeRooms = {}; 

function generateObstacles(mapType) {
    let obstacles = [];
    if (mapType === 'desert') {
        for (let i = 0; i < 10; i++) {
            obstacles.push({ x: Math.random() * (WORLD_WIDTH - 100) + 50, y: Math.random() * (WORLD_HEIGHT - 100) + 50, radius: Math.random() * 14 + 10, hp: 5, swayOffset: 0, type: 'rock' });
        }
    } else if (mapType === 'city') {
        for (let i = 0; i < 22; i++) {
            let bw = Math.floor(Math.random() * 30) + 45, bh = Math.floor(Math.random() * 25) + 35;
            obstacles.push({ x: Math.random() * (WORLD_WIDTH - 100) + 50, y: Math.random() * (WORLD_HEIGHT - 100) + 50, radius: Math.max(bw, bh) / 2, w: bw, h: bh, hp: 30, swayOffset: 0, type: 'building' });
        }
        for (let i = 0; i < 5; i++) {
            obstacles.push({ x: Math.random() * (WORLD_WIDTH - 100) + 50, y: Math.random() * (WORLD_HEIGHT - 100) + 50, radius: Math.random() * 15 + 12, hp: 3, swayOffset: Math.random() * 100, type: 'tree' });
        }
    } else if (mapType === 'hybrid') {
        for (let i = 0; i < 28; i++) {
            obstacles.push({ x: Math.random() * (WORLD_WIDTH - 100) + 50, y: Math.random() * (WORLD_HEIGHT - 100) + 50, radius: Math.random() * 18 + 15, hp: 3, swayOffset: Math.random() * 100, type: 'tree' });
        }
        for (let i = 0; i < 10; i++) {
            let bw = Math.floor(Math.random() * 25) + 40, bh = Math.floor(Math.random() * 20) + 30;
            obstacles.push({ x: Math.random() * (WORLD_WIDTH - 100) + 50, y: Math.random() * (WORLD_HEIGHT - 100) + 50, radius: Math.max(bw, bh) / 2, w: bw, h: bh, hp: 25, swayOffset: 0, type: 'building' });
        }
    } else {
        // forest (default)
        for (let i = 0; i < 55; i++) {
            obstacles.push({ x: Math.random() * (WORLD_WIDTH - 100) + 50, y: Math.random() * (WORLD_HEIGHT - 100) + 50, radius: Math.random() * 20 + 18, hp: 3, swayOffset: Math.random() * 100, type: 'tree' });
        }
    }
    return obstacles;
}

function getRandomSpawn(room) {
    let spawn;
    let valid = false;
    let attempts = 0;
    
    while (!valid && attempts < 50) {
        spawn = {
            x: Math.random() * (WORLD_WIDTH - 200) + 100,
            y: Math.random() * (WORLD_HEIGHT - 200) + 100,
            angle: Math.random() * Math.PI * 2
        };
        
        valid = true;
        for (let tree of room.trees) {
            if (dist(spawn.x, spawn.y, tree.x, tree.y) < tree.radius + 35) {
                valid = false;
                break;
            }
        }
        attempts++;
    }
    return spawn;
}

function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }

// Raycast Collision Math
function pointSegmentDist(px, py, x1, y1, x2, y2) {
    let A = px - x1; let B = py - y1; let C = x2 - x1; let D = y2 - y1;
    let dot = A * C + B * D; let len_sq = C * C + D * D;
    let param = -1;
    if (len_sq != 0) param = dot / len_sq;
    let xx, yy;
    if (param < 0) { xx = x1; yy = y1; }
    else if (param > 1) { xx = x2; yy = y2; }
    else { xx = x1 + param * C; yy = y1 + param * D; }
    let dx = px - xx; let dy = py - yy;
    return { distance: Math.hypot(dx, dy), hitX: xx, hitY: yy };
}

io.on('connection', (socket) => {
    socket.emit('init', socket.id);

    socket.on('requestPublicRooms', () => {
        let publicRooms = [];
        for (let roomId in activeRooms) {
            let r = activeRooms[roomId];
            if (!r.isPrivate) {
                publicRooms.push({ id: roomId, name: r.name, playerCount: Object.keys(r.players).length, maxPlayers: r.maxPlayers, mapType: r.mapType || 'forest', eraRestriction: r.eraRestriction || 'All' });
            }
        }
        socket.emit('publicRoomsList', publicRooms);
    });

    socket.on('createRoom', (data) => {
        let roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        let safeUsername = filter.check(data.username) ? "TrollTank" : data.username;
        if (!safeUsername.trim()) safeUsername = "Player";
        const validMaps = ['forest', 'desert', 'city', 'hybrid'];
        const mapType = validMaps.includes(data.mapType) ? data.mapType : 'forest';
        const validEras = ['All', 'WW1', 'WW2', 'Cold War', 'Modern Era'];
        const eraRestriction = validEras.includes(data.eraRestriction) ? data.eraRestriction : 'All';

        activeRooms[roomId] = {
            id: roomId,
            name: data.roomName || "Custom Match",
            mapType: mapType,
            eraRestriction: eraRestriction,
            isPrivate: data.isPrivate === 'private',
            password: data.password || "",
            maxPlayers: parseInt(data.maxPlayers) || 5,
            players: {},
            projectiles: [],
            trees: generateObstacles(mapType),
            winner: null
        };

        if (eraRestriction !== 'All' && TANK_ERAS[data.tankId] !== eraRestriction) {
            delete activeRooms[roomId];
            return socket.emit('lobbyError', `This room requires ${eraRestriction} era tanks.`);
        }
        joinRoom(socket, roomId, data.tankId, safeUsername);
    });

    socket.on('joinRoom', (data) => {
        let room = activeRooms[data.roomId];
        if (!room) return socket.emit('lobbyError', "Room not found.");
        if (room.isPrivate && room.password !== data.password) return socket.emit('lobbyError', "Incorrect password.");
        if (Object.keys(room.players).length >= room.maxPlayers) return socket.emit('lobbyError', "Room is full.");
        if (room.eraRestriction && room.eraRestriction !== 'All' && TANK_ERAS[data.tankId] !== room.eraRestriction) {
            return socket.emit('lobbyError', `This room is ${room.eraRestriction} era only. Switch your tank in the lobby.`);
        }
        
        let safeUsername = filter.check(data.username) ? "TrollTank" : data.username;
        if (!safeUsername.trim()) safeUsername = "Player";

        joinRoom(socket, data.roomId, data.tankId, safeUsername);
    });

    function joinRoom(socket, roomId, tankId, username) {
        let room = activeRooms[roomId];
        socket.join(roomId);
        socket.roomId = roomId;

        let stats = TANK_STATS[tankId] || TANK_STATS['m4'];
        let spawn = getRandomSpawn(room);

        room.players[socket.id] = {
            id: socket.id,
            username: username.substring(0, 12),
            tankTypeId: tankId,
            x: spawn.x, y: spawn.y,
            angle: spawn.angle, turretAngle: spawn.angle,
            hp: stats.hp, maxHp: stats.hp,
            kills: 0,
            reloadCooldown: 0,
            inputs: { w: false, a: false, s: false, d: false, mouseX: 0, mouseY: 0, mouseDown: false },
            debuffs: { track: 0, engine: 0, turret: 0, gun: 0 }
        };

        io.to(roomId).emit('gameStart', { roomId: roomId, roomName: room.name, mapType: room.mapType || 'forest', eraRestriction: room.eraRestriction || 'All', trees: room.trees });
    }

    socket.on('changeTank', (newTankId) => {
        let room = activeRooms[socket.roomId];
        if (room && room.players[socket.id]) {
            if (room.eraRestriction && room.eraRestriction !== 'All' && TANK_ERAS[newTankId] !== room.eraRestriction) return;
            room.players[socket.id].tankTypeId = newTankId;
        }
    });

    socket.on('input', (inputs) => {
        let room = activeRooms[socket.roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].inputs = inputs;
        }
    });

    socket.on('disconnect', () => {
        let room = activeRooms[socket.roomId];
        if (room) {
            delete room.players[socket.id];
            if (Object.keys(room.players).length === 0) {
                delete activeRooms[socket.roomId];
            }
        }
    });
});

setInterval(() => {
    for (let roomId in activeRooms) {
        let room = activeRooms[roomId];
        if (room.winner) continue;

        for (let id in room.players) {
            let p = room.players[id];
            if (p.hp <= 0) continue;

            let stats = TANK_STATS[p.tankTypeId];
            let i = p.inputs;

            if (p.debuffs.track > 0) p.debuffs.track--;
            if (p.debuffs.engine > 0) p.debuffs.engine--;
            if (p.debuffs.turret > 0) p.debuffs.turret--;
            if (p.debuffs.gun > 0) p.debuffs.gun--;

            let speedMod = (p.debuffs.engine > 0) ? 0.3 : 1.0; 
            if (p.debuffs.track > 0) speedMod = 0; 

            let nextX = p.x;
            let nextY = p.y;
            
            if (i.w) { nextX += Math.cos(p.angle) * stats.speed * speedMod; nextY += Math.sin(p.angle) * stats.speed * speedMod; }
            if (i.s) { nextX -= Math.cos(p.angle) * stats.speed * speedMod * 0.5; nextY -= Math.sin(p.angle) * stats.speed * speedMod * 0.5; }
            if (i.a) p.angle -= 0.03 * speedMod;
            if (i.d) p.angle += 0.03 * speedMod;

            let canMove = true;
            for (let tree of room.trees) {
                if (dist(nextX, nextY, tree.x, tree.y) < tree.radius + stats.hitbox) {
                    canMove = false;
                    break;
                }
            }

            if (canMove) {
                p.x = nextX;
                p.y = nextY;
            }

            p.x = Math.max(20, Math.min(WORLD_WIDTH - 20, p.x));
            p.y = Math.max(20, Math.min(WORLD_HEIGHT - 20, p.y));

            let targetAngle = Math.atan2(i.mouseY - p.y, i.mouseX - p.x);
            let aDiff = targetAngle - p.turretAngle;
            while (aDiff < -Math.PI) aDiff += Math.PI * 2;
            while (aDiff > Math.PI) aDiff -= Math.PI * 2;

            let currentTurretSpeed = (p.debuffs.turret > 0) ? stats.turretSpeed * 0.2 : stats.turretSpeed;

            if (Math.abs(aDiff) < currentTurretSpeed) p.turretAngle = targetAngle;
            else p.turretAngle += Math.sign(aDiff) * currentTurretSpeed;

            if (p.reloadCooldown > 0) p.reloadCooldown--;

            if (i.mouseDown && p.reloadCooldown <= 0 && p.debuffs.gun === 0) {
                let spread = (Math.random() - 0.5) * stats.accuracy;
                let finalAngle = p.turretAngle + spread;

                room.projectiles.push({
                    x: p.x + Math.cos(finalAngle) * 30,
                    y: p.y + Math.sin(finalAngle) * 30,
                    angle: finalAngle,
                    speed: stats.projSpeed,
                    damage: stats.damage,
                    pen: stats.pen,
                    range: stats.range,
                    distanceTraveled: 0,
                    ownerId: id
                });
                p.reloadCooldown = stats.reload;
                io.to(roomId).emit('effect', { type: 'fire', x: p.x + Math.cos(finalAngle)*35, y: p.y + Math.sin(finalAngle)*35 });
            }
        }

        for (let j = room.projectiles.length - 1; j >= 0; j--) {
            let proj = room.projectiles[j];
            
            let oldX = proj.x;
            let oldY = proj.y;
            
            proj.x += Math.cos(proj.angle) * proj.speed;
            proj.y += Math.sin(proj.angle) * proj.speed;
            proj.distanceTraveled += proj.speed;

            let hit = false;

            if (proj.x < 0 || proj.x > WORLD_WIDTH || proj.y < 0 || proj.y > WORLD_HEIGHT || proj.distanceTraveled >= proj.range) {
                hit = true;
            }

            if (!hit) {
                for (let k = room.trees.length - 1; k >= 0; k--) {
                    let t = room.trees[k];
                    let hitResult = pointSegmentDist(t.x, t.y, oldX, oldY, proj.x, proj.y);
                    
                    if (hitResult.distance < t.radius) {
                        hit = true;
                        t.hp--;
                        io.to(roomId).emit('effect', { type: 'hitTree', x: hitResult.hitX, y: hitResult.hitY });
                        if (t.hp <= 0) room.trees.splice(k, 1);
                        break;
                    }
                }
            }

            if (!hit) {
                for (let pId in room.players) {
                    if (pId !== proj.ownerId) {
                        let p = room.players[pId];
                        if (p.hp <= 0) continue;

                        let hitResult = pointSegmentDist(p.x, p.y, oldX, oldY, proj.x, proj.y);
                        let stats = TANK_STATS[p.tankTypeId];
                        
                        if (hitResult.distance < stats.hitbox + 4) {
                            hit = true;
                            
                            let relAngle = proj.angle - p.angle;
                            while (relAngle < -Math.PI) relAngle += Math.PI * 2;
                            while (relAngle > Math.PI) relAngle -= Math.PI * 2;
                            
                            let relDeg = Math.abs(relAngle * (180 / Math.PI));
                            let effectiveArmor = stats.armor.s; 
                            
                            if (relDeg < 45 || relDeg > 315) effectiveArmor = stats.armor.r; 
                            else if (relDeg > 135 && relDeg < 225) effectiveArmor = stats.armor.f; 
                            
                            let penChance = proj.pen / effectiveArmor;
                            let finalDamage = 0;
                            let isCrit = false;
                            let critText = "";
                            
                            if (penChance > 1.2) {
                                finalDamage = proj.damage * (0.8 + Math.random() * 0.4); 
                                if (Math.random() < 0.2) isCrit = true; 
                            } else if (penChance > 0.8) {
                                finalDamage = proj.damage * (0.5 + Math.random() * 0.3);
                                if (Math.random() < 0.1) isCrit = true;
                            } else {
                                finalDamage = proj.damage * 0.1; 
                            }
                            
                            finalDamage = Math.floor(finalDamage);
                            p.hp -= finalDamage;

                            if (isCrit) {
                                let r = Math.random();
                                if (r < 0.25) { p.debuffs.track = 600; critText = "MOBILITY HIT!"; }
                                else if (r < 0.5) { p.debuffs.engine = 600; critText = "ENGINE DAMAGED!"; }
                                else if (r < 0.75) { p.debuffs.turret = 600; critText = "WEAPON JAMMED!"; }
                                else { p.debuffs.gun = 600; critText = "GUN BARREL WRECKED!"; }
                            }

                            io.to(roomId).emit('effect', { type: 'hitTank', x: hitResult.hitX, y: hitResult.hitY, damage: finalDamage, critText: critText });
                            
                            if (p.hp <= 0) {
                                p.hp = 0;
                                let killer = room.players[proj.ownerId];
                                if (killer) killer.kills++;
                                io.to(roomId).emit('killfeed', { killer: killer ? killer.username : "Unknown", victim: p.username });
                                
                                if (killer && killer.kills >= 10) {
                                    room.winner = killer;
                                    io.to(roomId).emit('gameOver', { winnerName: killer.username });
                                    setTimeout(() => { delete activeRooms[roomId]; }, 5000);
                                } else {
                                    setTimeout(() => {
                                        if(room.players[pId]) {
                                            let s = getRandomSpawn(room);
                                            p.x = s.x; p.y = s.y; p.angle = s.angle; p.turretAngle = s.angle; p.hp = stats.hp; p.reloadCooldown = 0; p.debuffs = { track: 0, engine: 0, turret: 0, gun: 0 };
                                        }
                                    }, 3000);
                                }
                            }
                            break; 
                        }
                    }
                }
            }

            if (hit) room.projectiles.splice(j, 1);
        }
        
        io.to(roomId).emit('stateUpdate', { players: room.players, projectiles: room.projectiles });
    }
}, 1000 / 60);

server.listen(3000, () => { console.log('Server authoritative simulation running on :3000'); });
