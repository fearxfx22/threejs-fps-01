// Bot brains. Each bot owns a small state machine and a waypoint path; the game feeds it
// the shared world (map, actors, bomb) and the bot answers with movement wishes, a yaw to
// turn toward, and whether to hold the trigger. Bots buy weapons in the buy phase, push a
// site as attackers, hold and rotate as defenders, plant the bomb when they carry it to a
// site, and defuse when the bomb is down and they can reach it.
import { angDiff, clamp } from './util.js';
import { WEAPONS, WEAPON_ORDER } from './weapons.js';

const BOT_NAMES = ['Vex', 'Mira', 'Kodo', 'Sable', 'Rook', 'Nyx', 'Pike'];

export function createBot(actor, game, index) {
  const rng = actor.rng;
  const brain = {
    actor, game, index,
    state: 'move',          // move | engage | plant | defuse | hold
    path: [], pathIdx: 0,
    targetSite: rng() < 0.5 ? 'A' : 'B',
    targetNode: 0, repathAt: 0,
    seenEnemy: null, seenAt: -9, reactAt: -9,
    burstLeft: 0, burstPauseUntil: 0,
    strafeDir: 1, strafeUntil: 0,
    aimErr: { x: 0, y: 0 }, aimErrUntil: 0,
    perceiveAt: 0, thinkAt: 0,
    holdNode: 0,
    buyDone: false,

    // --- economy: spend the round's money in the buy phase, like a player would.
    buy() {
      if (this.buyDone) return;
      this.buyDone = true;
      const a = this.actor;
      const money = a.money;
      let pick = 'kestrel';
      if (money >= 4750 && rng() < 0.3) pick = 'falcon';
      else if (money >= 2700) pick = 'longhorn';
      else if (money >= 1500) pick = 'jackal';
      if (pick !== 'kestrel' && a.money >= WEAPONS[pick].price) {
        a.money -= WEAPONS[pick].price;
        a.giveWeapon(pick, true);
      }
      if (a.money >= 650 && a.armor <= 0) { a.money -= 650; a.armor = 100; }
      if (a.money >= 300 && a.grenades < 1 && rng() < 0.5) { a.money -= 300; a.grenades = 1; }
    },

    resetForRound() {
      this.buyDone = false;
      this.state = 'move';
      this.path = []; this.pathIdx = 0;
      this.seenEnemy = null;
      this.burstLeft = 0;
      this.targetSite = rng() < 0.5 ? 'A' : 'B';
      // Defenders pick a site to hold; the bomb carrier pushes its site.
      if (this.actor.team === 'def') {
        this.holdNode = this.targetSite === 'A' ? 14 : 15;
        this.targetNode = this.holdNode;
      } else {
        this.targetNode = this.targetSite === 'A' ? 12 : 11;
      }
      this.repathAt = 0;
    },

    // --- perception: nearest living enemy with a clear line of sight, re-checked 7x/s.
    perceive(now) {
      if (now < this.perceiveAt) return;
      this.perceiveAt = now + 0.14;
      const a = this.actor;
      const eyeY = a.pos ? a.eyeY : 1.58;
      let best = null, bestD = 46;
      for (const other of this.game.actors) {
        if (!other.alive || other.team === a.team) continue;
        const dx = other.pos.x - a.pos.x, dz = other.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > bestD) continue;
        // Must be roughly in front (bots do not have eyes in the back of the head).
        const wantYaw = Math.atan2(-dx, -dz);
        if (Math.abs(angDiff(a.yaw, wantYaw)) > 1.9 && d > 4) continue;
        if (this.game.map.blocked(a.pos.x, eyeY, a.pos.z, other.pos.x, other.eyeY * 0.9, other.pos.z)) continue;
        best = other; bestD = d;
      }
      if (best) {
        if (this.seenEnemy !== best) {
          // Reaction time: 0.25s up close, up to 0.7s at range, faster when already alert.
          const range = clamp(bestD / 46, 0, 1);
          this.reactAt = now + 0.25 + range * 0.45 + rng() * 0.12;
          this.aimErr = { x: (rng() * 2 - 1) * 0.4, y: (rng() * 2 - 1) * 0.3 };
          this.aimErrUntil = now + 0.5 + rng() * 0.6;
        }
        this.seenEnemy = best; this.seenAt = now;
      } else if (now - this.seenAt > 0.8) {
        this.seenEnemy = null;
      }
    },

    // --- navigation: BFS path over the waypoint graph, re-pathed when the goal changes.
    navigate(now) {
      const a = this.actor;
      const map = this.game.map;
      if (now >= this.repathAt || this.pathIdx >= this.path.length) {
        this.repathAt = now + 2.5;
        const from = map.nearestWaypoint(a.pos.x, a.pos.z);
        this.path = map.findPath(from, this.targetNode);
        this.pathIdx = 0;
      }
      if (this.pathIdx >= this.path.length) return { x: 0, z: 0 };
      const node = map.waypoints[this.path[this.pathIdx]];
      const dx = node.x - a.pos.x, dz = node.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.9) { this.pathIdx += 1; return { x: 0, z: 0 }; }
      return { x: dx / d, z: dz / d };
    },

    // --- one fixed step. Returns the bot's movement wish; sets yaw/trigger on the actor.
    step(now, dt) {
      const a = this.actor;
      const game = this.game;
      if (!a.alive) { a.triggerHeld = false; return { x: 0, z: 0 }; }
      this.perceive(now);
      const enemy = this.seenEnemy;
      const bomb = game.bomb;

      // Bomb duties override movement.
      if (bomb.state === 'planted' && a.team === 'def' && !enemy) {
        const bd = Math.hypot(bomb.x - a.pos.x, bomb.z - a.pos.z);
        if (bd < 1.6) {
          this.state = 'defuse';
          a.defusing += dt;
          a.triggerHeld = false;
          return { x: 0, z: 0 };
        }
        this.targetNode = game.map.nearestWaypoint(bomb.x, bomb.z);
        this.state = 'move';
      } else if (a.hasBomb && !enemy) {
        const site = this.targetSite === 'A' ? game.map.siteA : game.map.siteB;
        const inside = a.pos.x > site.minX && a.pos.x < site.maxX && a.pos.z > site.minZ && a.pos.z < site.maxZ;
        if (inside) {
          this.state = 'plant';
          a.planting += dt;
          a.triggerHeld = false;
          return { x: 0, z: 0 };
        }
        this.targetNode = this.targetSite === 'A' ? 12 : 11;
        this.state = 'move';
      }

      if (enemy && now >= this.reactAt) {
        // Engage: face the enemy, strafe, fire in bursts with bot inaccuracy.
        this.state = 'engage';
        const dx = enemy.pos.x - a.pos.x, dz = enemy.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const wantYaw = Math.atan2(-dx, -dz);
        a.yaw += clamp(angDiff(a.yaw, wantYaw), -5.5 * dt, 5.5 * dt);
        const errScale = clamp(d / 30, 0.25, 1) * (now < this.aimErrUntil ? 1 : 0.35);
        const aimX = enemy.pos.x + this.aimErr.x * errScale * 1.6;
        const aimY = enemy.eyeY * (0.82 + this.aimErr.y * errScale * 0.4);
        const aimZ = enemy.pos.z + this.aimErr.y * errScale * 1.6;
        a.aimTarget = { x: aimX, y: aimY, z: aimZ };
        if (now >= this.burstPauseUntil) {
          if (this.burstLeft <= 0) this.burstLeft = 3 + Math.floor(rng() * 3);
          a.triggerHeld = true;
        } else {
          a.triggerHeld = false;
        }
        // Strafe: change direction every 0.7–1.4s, keep some distance.
        if (now >= this.strafeUntil) {
          this.strafeUntil = now + 0.7 + rng() * 0.7;
          this.strafeDir = rng() < 0.5 ? -1 : 1;
        }
        const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
        const sx = -fz * this.strafeDir, sz = fx * this.strafeDir;
        const backOff = d < 5 ? -0.6 : 0;
        return { x: sx + fx * backOff, z: sz + fz * backOff };
      }

      // No enemy: walk the path, looking where we are going.
      this.state = a.team === 'def' && this.pathIdx >= this.path.length ? 'hold' : 'move';
      a.triggerHeld = false;
      a.aimTarget = null;
      const wish = this.navigate(now);
      if (wish.x || wish.z) {
        const wantYaw = Math.atan2(-wish.x, -wish.z);
        a.yaw += clamp(angDiff(a.yaw, wantYaw), -4.5 * dt, 4.5 * dt);
      }
      return wish;
    },

    // Called by main.js after each bot shot, so bursts actually end.
    onShotFired(now) {
      if (this.burstLeft > 0) {
        this.burstLeft -= 1;
        if (this.burstLeft === 0) this.burstPauseUntil = now + 0.45 + this.actor.rng() * 0.55;
      }
    },
  };
  actor.bot = brain;
  return brain;
}

export { BOT_NAMES };
