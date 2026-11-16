// DUSTLINE — boot, the fixed-step loop, and the match itself: rounds, economy, the bomb,
// shooting, grenades, and the bots' orders. Rendering runs at the display rate; the
// simulation runs at a fixed 60 Hz and never touches the renderer. ?shot=start|buy|play|end
// with &seed=N stages a deterministic frame for a screenshot, renders it twice, then
// freezes it and sets window.__SHOT_READY__.
import * as THREE from 'three';
import { mulberry32, clamp } from './util.js';
import { WEAPONS, WEAPON_ORDER, ARMOR, GRENADE, ECONOMY } from './weapons.js';
import { createMap } from './map.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createActor } from './actors.js';
import { createBot, BOT_NAMES } from './bots.js';
import { createBomb, PLANT_TIME, DEFUSE_TIME, BOMB_TIMER } from './bomb.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const BUY_TIME = 15, ROUND_TIME = 100, ROUND_END_TIME = 4, WIN_ROUNDS = 5;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed * 7919 + 13);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b2118);
scene.fog = new THREE.Fog(0x2b2118, 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene, seed);
const audio = createAudio();
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
const bomb = createBomb(scene);

// --- actors ---------------------------------------------------------------
const actors = [];
const player = createActor(scene, { id: 'you', name: 'You', team: 'atk', isPlayer: true, rng: random });
actors.push(player);
const bots = [];
for (let i = 0; i < 7; i += 1) {
  const team = i < 3 ? 'atk' : 'def';
  const bot = createActor(scene, { id: 'bot' + i, name: BOT_NAMES[i], team, isPlayer: false, rng: mulberry32(seed * 31 + i * 17 + 5) });
  actors.push(bot);
  bots.push(createBot(bot, gameApi(), i));
}
function gameApi() {
  return { actors, map, bomb };
}
const playerBots = bots.slice(0, 3);
const enemyBots = bots.slice(3);

// --- match state ------------------------------------------------------------
const G = {
  phase: 'menu', // menu | buy | live | roundEnd | matchEnd
  round: 1, score: { atk: 0, def: 0 },
  phaseTimer: 0, elapsed: 0, now: 0,
  stats: { shots: 0, hits: 0, kills: 0 },
  buyOpen: false, paused: false,
  bombCarrier: null,
};
const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const tracerPool = [];
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 });
for (let i = 0; i < 14; i += 1) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geo, tracerMat.clone());
  line.visible = false; line.frustumCulled = false;
  scene.add(line);
  tracerPool.push({ line, until: 0 });
}
let tracerIdx = 0;
const muzzle = new THREE.PointLight(0xffc266, 0, 9, 2);
scene.add(muzzle);
const grenades = [];
const tmpV = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

function aliveOf(team) { return actors.filter((a) => a.team === team && a.alive); }

// --- shooting ---------------------------------------------------------------
function muzzlePos(actor) {
  const f = actor.isPlayer ? camera : null;
  if (f) {
    f.getWorldPosition(tmpV);
    return tmpV;
  }
  return tmpV.set(
    actor.pos.x - Math.sin(actor.yaw) * 0.5,
    actor.eyeY * 0.9,
    actor.pos.z - Math.cos(actor.yaw) * 0.5,
  );
}
function fireShot(actor, now) {
  if (!actor.canShoot(now)) {
    if (actor.isPlayer && actor.weaponState && actor.weaponState.mag === 0) audio.dry();
    return false;
  }
  const w = actor.weapon;
  const ws = actor.weaponState;
  ws.mag -= 1;
  actor.lastShot = now;
  G.stats.shots += actor.isPlayer ? 1 : 0;
  // Direction: the player's camera, or the bot's aim point with bot inaccuracy.
  if (actor.isPlayer) {
    camera.getWorldDirection(tmpDir);
  } else if (actor.aimTarget) {
    tmpDir.set(actor.aimTarget.x - actor.pos.x, actor.aimTarget.y - actor.eyeY, actor.aimTarget.z - actor.pos.z).normalize();
  } else {
    tmpDir.set(-Math.sin(actor.yaw), 0, -Math.cos(actor.yaw));
  }
  const spread = actor.spread(now) * (actor.isPlayer ? 1 : 2.2);
  tmpDir.x += (random() * 2 - 1) * spread;
  tmpDir.y += (random() * 2 - 1) * spread;
  tmpDir.z += (random() * 2 - 1) * spread;
  tmpDir.normalize();
  const origin = muzzlePos(actor).clone();
  raycaster.set(origin, tmpDir);
  const targets = [];
  for (const a of actors) {
    if (!a.alive || a === actor) continue;
    targets.push(a.bodyMesh, a.headMesh);
  }
  const hits = raycaster.intersectObjects(targets.concat(map.shootables), false);
  const hit = hits[0];
  let endPoint = origin.clone().addScaledVector(tmpDir, 90);
  if (hit) {
    endPoint = hit.point.clone();
    const target = hit.object.userData.actor;
    if (target) {
      const dist = hit.distance;
      const falloff = dist <= w.range ? 1 : Math.max(0.55, 1 - (dist - w.range) / (w.range * 2));
      const dmg = w.damage * falloff;
      const died = target.damage(dmg, hit.object.userData.part, actor, now);
      if (actor.isPlayer) {
        G.stats.hits += 1;
        hud.hitmarker(died);
        if (died) { audio.kill(); G.stats.kills += 1; } else audio.hit();
      }
      if (died) onKill(actor, target, hit.object.userData.part === 'head');
      else if (target.isPlayer) { hud.damageFlash(); audio.hurt(); }
      // A bot that takes fire turns toward its attacker.
      if (target.bot && !target.isPlayer) {
        target.bot.seenEnemy = actor;
        target.bot.seenAt = now;
        target.bot.reactAt = Math.min(target.bot.reactAt, now + 0.15);
      }
    }
  }
  // Tracer + muzzle flash.
  const t = tracerPool[tracerIdx];
  tracerIdx = (tracerIdx + 1) % tracerPool.length;
  t.line.geometry.setFromPoints([origin, endPoint]);
  t.line.material.color.set(w.tracer);
  t.line.visible = true;
  t.until = now + 0.07;
  muzzle.position.copy(origin);
  muzzle.intensity = 14;
  audio.shot(w.kind);
  if (actor.isPlayer) {
    player.recoilPitch += w.recoil * (0.8 + random() * 0.4);
    player.yaw += (random() * 2 - 1) * w.recoil * 0.25;
  }
  if (actor.bot) actor.bot.onShotFired(now);
  if (actor.isPlayer) hud.setAmmo(ws.mag, ws.reserve, w.name);
  return true;
}

function onKill(killer, victim, headshot) {
  victim.deaths += 1;
  killer.kills += 1;
  killer.money = Math.min(ECONOMY.maxMoney, killer.money + ECONOMY.killBonus);
  hud.killfeed(killer.name, victim.name, headshot, killer.team);
  if (killer.isPlayer) { hud.setMoney(player.money); }
  if (victim.hasBomb) {
    victim.hasBomb = false;
    bomb.dropAt(victim.pos.x, victim.pos.z);
    hud.setHint('The bomb is down — pick it up!');
  }
  if (victim.isPlayer) {
    hud.setHint('You are down. Your team fights on.');
  }
}

// --- grenades ---------------------------------------------------------------
function throwGrenade(actor, now) {
  if (actor.grenades <= 0) return;
  actor.grenades -= 1;
  audio.throwPin();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a4a2a, roughness: 0.6 }),
  );
  mesh.castShadow = true;
  const yaw = actor.yaw, pitch = actor.isPlayer ? actor.pitch : -0.25;
  const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch) + 0.45, -Math.cos(yaw) * Math.cos(pitch)).normalize();
  mesh.position.set(actor.pos.x, actor.eyeY, actor.pos.z);
  scene.add(mesh);
  grenades.push({ mesh, vel: dir.multiplyScalar(13), fuse: GRENADE.fuseS, owner: actor });
  if (actor.isPlayer) hud.setGrenades(player.grenades);
}
function explodeGrenade(g, now) {
  scene.remove(g.mesh);
  const p = g.mesh.position;
  const flash = new THREE.PointLight(0xffb347, 60, 22, 1.6);
  flash.position.copy(p);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 220);
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffc266, transparent: true, opacity: 0.55 }),
  );
  blast.position.copy(p);
  scene.add(blast);
  let scale = 0.2;
  const grow = setInterval(() => {
    scale += 0.55;
    blast.scale.setScalar(scale);
    blast.material.opacity = Math.max(0, 0.55 - scale * 0.08);
    if (scale > GRENADE.radius) { clearInterval(grow); scene.remove(blast); }
  }, 30);
  audio.explosion();
  for (const a of actors) {
    if (!a.alive) continue;
    const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
    if (d > GRENADE.radius) continue;
    const blocked = map.blocked(p.x, p.y, p.z, a.pos.x, a.eyeY * 0.9, a.pos.z);
    let dmg = GRENADE.damage * (1 - d / (GRENADE.radius * 1.15));
    if (blocked) dmg *= 0.4;
    if (dmg < 8) continue;
    const died = a.damage(dmg, 'body', g.owner, now);
    if (died) onKill(g.owner, a, false);
    else if (a.isPlayer) { hud.damageFlash(); audio.hurt(); }
  }
}

// --- rounds -----------------------------------------------------------------
function startMatch() {
  G.round = 1;
  G.score = { atk: 0, def: 0 };
  for (const a of actors) { a.money = ECONOMY.startMoney; a.kills = 0; a.deaths = 0; a.weapons = {}; a.giveWeapon('kestrel', true); a.grenades = 0; }
  startRound();
}
function startRound() {
  // Spawn everyone, reset the bomb, open the buy phase.
  const atkSpawns = map.spawns.atk, defSpawns = map.spawns.def;
  actors.forEach((a, i) => {
    const spawn = a.team === 'atk' ? atkSpawns[i % atkSpawns.length] : defSpawns[(i - 4 + 8) % defSpawns.length];
    a.reset(spawn, a.team === 'atk' ? 0 : Math.PI);
  });
  for (const b of bots) b.resetForRound();
  // Bomb carrier: a random attacker (the player carries it 1 time in 4).
  const carriers = aliveOf('atk');
  const carrier = carriers[Math.floor(random() * carriers.length)];
  G.bombCarrier = carrier;
  carrier.hasBomb = true;
  bomb.reset(carrier);
  for (const g of grenades) scene.remove(g.mesh);
  grenades.length = 0;
  G.phase = 'buy';
  G.phaseTimer = BUY_TIME;
  G.buyOpen = true;
  hud.showOverlay('buy');
  hud.buildBuyMenu(buyItem);
  hud.setMoney(player.money);
  hud.setGrenades(player.grenades);
  hud.setScore(G.score.atk, G.score.def, G.round);
  hud.setHint(player.hasBomb ? 'You carry the bomb — plant it on site A or B (hold E).' : 'Buy phase — press B to shop, then the round starts.');
  hud.hideBanner();
  for (const b of bots) b.buy();
  refreshBuyOwned();
}
function buyItem(id) {
  if (G.phase !== 'buy') return;
  const p = player;
  if (WEAPONS[id]) {
    const w = WEAPONS[id];
    if (p.current === id && p.weapons[id]) { audio.denied(); return; }
    if (p.money < w.price) { audio.denied(); return; }
    p.money -= w.price;
    p.giveWeapon(id, true);
    audio.buy();
  } else if (id === 'kevlar') {
    if (p.armor >= 100 || p.money < ARMOR.price) { audio.denied(); return; }
    p.money -= ARMOR.price;
    p.armor = 100;
    audio.buy();
  } else if (id === 'frag') {
    if (p.grenades >= 2 || p.money < GRENADE.price) { audio.denied(); return; }
    p.money -= GRENADE.price;
    p.grenades += 1;
    audio.buy();
  }
  hud.setMoney(p.money);
  hud.setGrenades(p.grenades);
  hud.setAmmo(p.weaponState.mag, p.weaponState.reserve, p.weapon.name);
  refreshBuyOwned();
}
function refreshBuyOwned() {
  for (const id of WEAPON_ORDER) hud.markBought(id, player.weapons[id] !== undefined);
  hud.markBought('kevlar', player.armor >= 100);
  hud.markBought('frag', player.grenades >= 2);
}
function startLive() {
  G.phase = 'live';
  G.phaseTimer = ROUND_TIME;
  G.buyOpen = false;
  hud.hideOverlays();
  hud.setHint(player.hasBomb ? 'Plant the bomb on A or B — hold E on the site.' : 'Eliminate the defenders or plant the bomb.');
  // Pointer lock needs a user gesture; the timer expiry is not one, so this may be
  // refused — clicking the game locks it instead (see the canvas click handler).
  if (!shot) input.requestLock();
}
function endRound(winner, reason) {
  if (G.phase === 'roundEnd' || G.phase === 'matchEnd') return;
  G.score[winner] += 1;
  for (const a of actors) {
    const bonus = a.team === winner ? ECONOMY.winBonus : ECONOMY.lossBonus;
    a.money = Math.min(ECONOMY.maxMoney, a.money + bonus);
    if (a.team === winner && a.hasBomb) a.money = Math.min(ECONOMY.maxMoney, a.money + ECONOMY.plantBonus);
  }
  G.phase = 'roundEnd';
  G.phaseTimer = ROUND_END_TIME;
  hud.setScore(G.score.atk, G.score.def, G.round);
  hud.setMoney(player.money);
  const won = winner === 'atk';
  hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reason, won ? '#8fd07a' : '#e0483a');
  if (won) audio.roundWin(); else audio.roundLose();
  if (document.pointerLockElement) input.exitLock();
}
function checkRoundEnd(now) {
  if (G.phase !== 'live') return;
  const atkAlive = aliveOf('atk').length;
  const defAlive = aliveOf('def').length;
  if (bomb.state === 'planted') {
    if (defAlive === 0) { endRound('atk', 'Defenders eliminated — the bomb will do the rest.'); return; }
    // Attackers wiped after the plant: defenders must still defuse in time.
    if (atkAlive === 0 && bomb.timer > 0) return;
  } else {
    if (atkAlive === 0) { endRound('def', 'Attackers eliminated.'); return; }
    if (defAlive === 0) { endRound('atk', 'Defenders eliminated.'); return; }
  }
  if (bomb.state !== 'planted' && G.phaseTimer <= 0) {
    endRound('def', 'Time ran out — the bomb was never planted.');
  }
}
function nextAfterRound() {
  if (G.score.atk >= WIN_ROUNDS || G.score.def >= WIN_ROUNDS) {
    G.phase = 'matchEnd';
    const won = G.score.atk > G.score.def;
    hud.setEnd(won ? 'VICTORY' : 'DEFEAT', `DUSTLINE ${G.score.atk} — ${G.score.def} · You: ${player.kills} kills, ${player.deaths} deaths.`);
    hud.showOverlay('end');
    if (document.pointerLockElement) input.exitLock();
    return;
  }
  G.round += 1;
  startRound();
}

// --- per-step simulation ------------------------------------------------------
function stepPlayer(dt, now) {
  const k = input.keys;
  const walk = k.has('ShiftLeft') || k.has('ShiftRight');
  let fx = 0, fz = 0;
  if (k.has('KeyW')) fz += 1;
  if (k.has('KeyS')) fz -= 1;
  if (k.has('KeyA')) fx -= 1;
  if (k.has('KeyD')) fx += 1;
  const len = Math.hypot(fx, fz) || 1;
  fx /= len; fz /= len;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  // Forward is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw)... note: right = (-cos? ) —
  // world-space wish = forward * fz + right * fx with right = (cos, -sin) rotated -90°.
  const wx = -sin * fz + cos * fx;
  const wz = -cos * fz - sin * fx;
  const frozen = G.phase !== 'live';
  player.stepMove(dt, frozen ? 0 : wx, frozen ? 0 : wz, !frozen && k.has('Space'), k.has('ControlLeft') || k.has('KeyC'), map);
  if (frozen) { player.vel.x = 0; player.vel.z = 0; }

  // Look + recoil recovery.
  const look = input.takeLook();
  player.yaw -= look.x * 0.0022;
  player.pitch = clamp(player.pitch - look.y * 0.0022, -1.5, 1.5);
  player.recoilPitch *= Math.max(0, 1 - 7 * dt);
  if (player.reloading && now >= player.reloadUntil) {
    player.finishReload();
    hud.setAmmo(player.weaponState.mag, player.weaponState.reserve, player.weapon.name);
  }
  // Firing: auto weapons fire while held, semi-auto once per press.
  const pressed = input.takeFirePress();
  if (!frozen && (input.firing || pressed)) {
    if (player.weapon.auto) { if (input.firing) fireShot(player, now); }
    else if (pressed) fireShot(player, now);
  }
  if (k.has('KeyR') && !player.reloading) {
    if (player.startReload(now)) audio.reload();
  }
  // Weapon switching (live) — the same number keys buy during the buy phase.
  for (let i = 0; i < WEAPON_ORDER.length; i += 1) {
    if (input.takeKey('Digit' + (i + 1))) {
      if (G.phase === 'buy') { buyItem(WEAPON_ORDER[i]); continue; }
      const id = WEAPON_ORDER[i];
      if (player.weapons[id]) {
        player.current = id;
        hud.setAmmo(player.weaponState.mag, player.weaponState.reserve, player.weapon.name);
        audio.reload();
      }
    }
  }
  if (G.phase === 'buy') {
    if (input.takeKey('Digit5')) buyItem('kevlar');
    if (input.takeKey('Digit6')) buyItem('frag');
  }
  if (input.takeKey('KeyG')) throwGrenade(player, now);
  if (input.takeKey('KeyB') && G.phase === 'buy') {
    G.buyOpen = !G.buyOpen;
    if (G.buyOpen) { hud.showOverlay('buy'); input.exitLock(); }
    else { hud.hideOverlays(); input.requestLock(); }
  }
  // Plant / defuse progress (hold E).
  updateInteract(dt, now);
}
function updateInteract(dt, now) {
  const k = input.keys;
  const holdingE = k.has('KeyE');
  let label = null, frac = null;
  if (G.phase === 'live' && holdingE) {
    // The player is always on the attacking team, so holding E plants; defenders are bots.
    if (player.hasBomb) {
      const site = onSite(player);
      if (site) {
        player.planting += dt;
        label = 'PLANTING BOMB — ' + site;
        frac = player.planting / PLANT_TIME;
        if (player.planting >= PLANT_TIME) {
          player.planting = 0;
          player.hasBomb = false;
          bomb.plantAt(player.pos.x, player.pos.z);
          audio.plant();
          hud.banner('BOMB PLANTED', 'Defend it — 35 seconds to detonation.', '#ff9a3a');
          hud.setHint('Bomb planted. Hold the site!');
        }
      } else {
        player.planting = 0;
        hud.setHint('Plant the bomb ON a site (A or B, the coloured pads).');
      }
    }
  } else {
    player.planting = 0;
    player.defusing = 0;
  }
  hud.setProgress(label, frac);
  // Bomb pickup.
  if (bomb.state === 'dropped' && player.alive && player.team === 'atk') {
    const d = Math.hypot(bomb.x - player.pos.x, bomb.z - player.pos.z);
    if (d < 1.3) {
      bomb.pickUp(player);
      player.hasBomb = true;
      hud.setHint('You picked up the bomb — plant it on A or B.');
      audio.buy();
    }
  }
}
function onSite(actor) {
  for (const [name, site] of [['A', map.siteA], ['B', map.siteB]]) {
    if (actor.pos.x > site.minX && actor.pos.x < site.maxX && actor.pos.z > site.minZ && actor.pos.z < site.maxZ) return name;
  }
  return null;
}
function stepBots(dt, now) {
  const frozen = G.phase !== 'live';
  for (const b of bots) {
    const a = b.actor;
    if (!a.alive) continue;
    if (frozen) { a.triggerHeld = false; continue; } // freeze time: bots hold still
    const wish = b.step(now, dt);
    a.stepMove(dt, frozen ? 0 : wish.x, frozen ? 0 : wish.z, false, false, map);
    if (a.reloading && now >= a.reloadUntil) a.finishReload();
    if (a.triggerHeld && !frozen) {
      if (a.weapon.auto) fireShot(a, now);
      else if (a.canShoot(now)) fireShot(a, now);
    } else if (!a.triggerHeld && a.weaponState && a.weaponState.mag === 0) {
      a.startReload(now);
    }
    if (a.reloading === false && a.weaponState && a.weaponState.mag === 0 && a.weaponState.reserve > 0) a.startReload(now);
    // Plant/defuse progress only counts while the bot is actually doing it.
    if (b.state !== 'plant') a.planting = 0;
    if (b.state !== 'defuse') a.defusing = 0;
    // Bot plant / defuse completion.
    if (a.planting >= PLANT_TIME && bomb.state === 'carried') {
      a.planting = 0;
      a.hasBomb = false;
      bomb.plantAt(a.pos.x, a.pos.z);
      audio.plant();
      hud.banner('BOMB PLANTED', 'Defend it — 35 seconds to detonation.', '#ff9a3a');
    }
    if (a.defusing >= DEFUSE_TIME && bomb.state === 'planted') {
      a.defusing = 0;
      bomb.state = 'defused';
      endRound('def', 'Bomb defused by ' + a.name + '.');
    }
    // Bot bomb pickup.
    if (bomb.state === 'dropped' && a.team === 'atk') {
      const d = Math.hypot(bomb.x - a.pos.x, bomb.z - a.pos.z);
      if (d < 1.3) { bomb.pickUp(a); a.hasBomb = true; }
    }
  }
}
function stepBomb(dt, now) {
  if (bomb.state === 'planted') {
    const result = bomb.step(dt, now, (hi) => audio.beep(hi));
    if (result === 'explode') {
      audio.explosion();
      endRound('atk', 'The bomb detonated on site.');
    }
  }
}
function stepGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vel.y -= 18 * dt;
    g.mesh.position.x += g.vel.x * dt;
    g.mesh.position.y += g.vel.y * dt;
    g.mesh.position.z += g.vel.z * dt;
    const p = { x: g.mesh.position.x, z: g.mesh.position.z };
    const before = { x: p.x, z: p.z };
    map.collideCircle(p, 0.12);
    if (p.x !== before.x) g.vel.x *= -0.45;
    if (p.z !== before.z) g.vel.z *= -0.45;
    g.mesh.position.x = p.x; g.mesh.position.z = p.z;
    if (g.mesh.position.y < 0.12) { g.mesh.position.y = 0.12; g.vel.y *= -0.45; g.vel.x *= 0.7; g.vel.z *= 0.7; }
    if (g.fuse <= 0) {
      explodeGrenade(g, G.now);
      grenades.splice(i, 1);
    }
  }
}
function step(dt) {
  G.now += dt;
  G.elapsed += dt;
  if (G.phase === 'buy') {
    G.phaseTimer -= dt;
    if (G.phaseTimer <= 0) startLive();
  } else if (G.phase === 'live') {
    if (bomb.state !== 'planted') G.phaseTimer -= dt;
    else G.phaseTimer = bomb.timer;
    checkRoundEnd(G.now);
  } else if (G.phase === 'roundEnd') {
    G.phaseTimer -= dt;
    if (G.phaseTimer <= 0) nextAfterRound();
  }
  stepPlayer(dt, G.now);
  stepBots(dt, G.now);
  stepBomb(dt, G.now);
  stepGrenades(dt);
  for (const t of tracerPool) if (t.line.visible && G.now >= t.until) t.line.visible = false;
  muzzle.intensity = Math.max(0, muzzle.intensity - 260 * dt);
}

// --- camera + HUD sync --------------------------------------------------------
function syncCamera() {
  camera.position.set(player.pos.x, (player.jumpY || 0) + player.eyeY, player.pos.z);
  camera.rotation.set(player.pitch + player.recoilPitch, player.yaw, 0, 'YXZ');
}
let mmAt = 0;
function syncHud() {
  hud.setHealth(player.hp, player.armor);
  const ws = player.weaponState;
  if (ws) hud.setAmmo(ws.mag, ws.reserve, player.weapon.name);
  hud.setTimer(G.phase === 'buy' ? G.phaseTimer : G.phase === 'live' ? G.phaseTimer : 0, G.phase === 'live' && G.phaseTimer < 20);
  hud.setCrosshair(4 + player.spread(G.now) * 900);
  if (G.now - mmAt > 0.12) {
    mmAt = G.now;
    hud.drawMinimap(map, actors, bomb, player);
  }
}

// --- lock / overlays ----------------------------------------------------------
function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    audio.unlock();
    if (G.phase === 'buy') { /* buying uses the mouse, keep the menu */ }
    else hud.hideOverlays();
    G.paused = false;
  } else if (G.phase === 'live' && !G.buyOpen) {
    G.paused = true;
    hud.showOverlay('pause');
  } else if (G.phase === 'menu') {
    hud.showOverlay('menu');
  }
}
document.getElementById('playBtn').addEventListener('click', () => {
  audio.unlock();
  // The buy phase needs a free mouse, so no pointer lock yet — it locks when the
  // player deploys (B key, Deploy button, or the buy timer running out).
  if (G.phase === 'menu') startMatch();
});
document.getElementById('againBtn').addEventListener('click', () => {
  hud.hideOverlays();
  startMatch();
});
document.getElementById('resumeBtn').addEventListener('click', () => {
  hud.hideOverlays();
  input.requestLock();
});
document.getElementById('deployBtn').addEventListener('click', () => {
  G.buyOpen = false;
  hud.hideOverlays();
  input.requestLock();
});
// Clicking the game during a live round (re)captures the mouse.
renderer.domElement.addEventListener('click', () => {
  if (G.phase === 'live' && !input.locked) input.requestLock();
});

// --- debug handle (used by the headless playtest, not by the game) ------------
window.__game = {
  get phase() { return G.phase; },
  get round() { return G.round; },
  get phaseTimer() { return G.phaseTimer; },
  get score() { return { ...G.score }; },
  get player() {
    return {
      pos: { x: player.pos.x, z: player.pos.z }, yaw: player.yaw, hp: player.hp,
      money: player.money, alive: player.alive, hasBomb: player.hasBomb,
      weapons: Object.fromEntries(Object.entries(player.weapons).map(([k, v]) => [k, { ...v }])),
      current: player.current, grenades: player.grenades,
    };
  },
  get actors() { return actors; },
  get bomb() { return { state: bomb.state, timer: bomb.timer, x: bomb.x, z: bomb.z }; },
  get stats() { return { ...G.stats }; },
  buyItem, startMatch, endRound,
  // Test hooks (used by the headless playtest; invisible to players).
  setPhaseTimer(v) { G.phaseTimer = v; },
};

// --- main loop ----------------------------------------------------------------
let lastTime = performance.now();
let accumulator = 0;
let frozen = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen && G.phase !== 'menu') {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }
  syncCamera();
  syncHud();
  renderer.render(scene, camera);
}
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- screenshot poses ---------------------------------------------------------
function aimAt(actor, x, y, z) {
  const dx = x - actor.pos.x;
  const dy = y - actor.eyeY;
  const dz = z - actor.pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  actor.yaw = Math.atan2(-dx, -dz);
  actor.pitch = Math.asin(clamp(dy / len, -1, 1));
}
function settle(n) { for (let i = 0; i < n; i += 1) step(FIXED_STEP); }
function runShot(name) {
  hud.hideOverlays();
  if (name === 'start') {
    G.phase = 'menu';
    startRoundSilent();
    player.pos.x = 2; player.pos.z = 15; player.yaw = 0; player.pitch = 0.02;
    stageBotsMid();
    settle(30);
    hud.showOverlay('menu');
  } else if (name === 'buy') {
    startMatch();
    player.pos.x = 2; player.pos.z = 14; player.yaw = 0.12; player.pitch = 0;
    stageBotsMid();
    settle(10);
    hud.showOverlay('buy');
  } else if (name === 'play') {
    startMatch();
    G.phase = 'live';
    G.phaseTimer = 82;
    hud.hideOverlays();
    hud.setHint('Eliminate the defenders or plant the bomb.');
    player.pos.x = 0; player.pos.z = 9; player.yaw = 0; player.pitch = 0;
    stageBotsMid();
    // One enemy ahead in the mid lane, one teammate beside us, one casualty.
    const e0 = actors[4], e1 = actors[5], t0 = actors[1];
    e0.reset([0.5, 1.5], Math.PI); e0.giveWeapon('longhorn', true);
    e1.reset([-6, -3], Math.PI * 0.7);
    t0.reset([-2.5, 7.5], 0);
    actors[6].reset([6, -6], Math.PI);
    actors[6].damage(500, 'body', player, G.now);
    settle(25);
    aimAt(player, e0.pos.x, 1.35, e0.pos.z);
    hud.hitmarker(false);
    fireShot(player, G.now);
    settle(2);
  } else if (name === 'end') {
    startMatch();
    G.phase = 'roundEnd';
    G.phaseTimer = 3;
    G.score = { atk: 3, def: 2 };
    hud.setScore(3, 2, 4);
    bomb.state = 'exploded';
    player.pos.x = -11; player.pos.z = -5; player.yaw = 0.59; player.pitch = 0.02;
    stageBotsMid();
    // Aftermath on site A: one defender down on the pad, the rest holding around it.
    actors[5].reset([-14, -11], 2.2);
    actors[5].damage(500, 'body', player, G.now);
    settle(20);
    aimAt(player, -15, 1.2, -12);
    hud.hideOverlays();
    hud.setHint('');
    hud.banner('ROUND WON', 'Bomb detonated on site A.', '#8fd07a');
  }
  syncCamera();
  syncHud();
  paintTwiceThenReady();
}
function startRoundSilent() {
  // Round setup without opening the buy menu (menu shot only).
  const atkSpawns = map.spawns.atk, defSpawns = map.spawns.def;
  actors.forEach((a, i) => {
    const spawn = a.team === 'atk' ? atkSpawns[i % atkSpawns.length] : defSpawns[(i - 4 + 8) % defSpawns.length];
    a.reset(spawn, a.team === 'atk' ? 0 : Math.PI);
  });
  for (const b of bots) b.resetForRound();
  const carrier = aliveOf('atk')[0];
  carrier.hasBomb = true;
  bomb.reset(carrier);
  G.phase = 'menu';
}
function stageBotsMid() {
  // Spread bots through the lanes so the frame reads as a live match.
  const spots = [[-4, 5, 0.4], [4, 3, -0.4], [-10, -2, 0.9], [8, -5, -2.2], [-2, -8, 2.6], [10, 8, 2.8], [0, -12, 3.1]];
  bots.forEach((b, i) => {
    const s = spots[i % spots.length];
    b.actor.reset([s[0], s[1]], s[2]);
    b.actor.giveWeapon(i % 2 ? 'longhorn' : 'jackal', true);
  });
}
function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    syncCamera();
    syncHud();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__SHOT_READY__ = true;
      window.__shotReady = true;
      frozen = true;
      return;
    }
    requestAnimationFrame(paint);
  }
  requestAnimationFrame(paint);
}

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
