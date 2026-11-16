// One combatant: the player or a bot. Owns position, velocity, health, armor, the weapons
// it carries, and its visible body (two hitboxes: torso and head). Movement is a fixed-step
// acceleration model with AABB collision from the map; shooting is resolved by main.js so
// the player and bots share one hit path.
import * as THREE from 'three';
import { clamp } from './util.js';
import { WEAPONS } from './weapons.js';

const RADIUS = 0.38;
const EYE_STAND = 1.58, EYE_CROUCH = 1.12;
const TEAM_COLORS = { atk: 0xc65a2e, def: 0x2e7d8a };

export function createActor(scene, opts) {
  const { id, name, team, isPlayer, rng } = opts;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.05, 0.42), bodyMat);
  body.position.y = 0.95;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.42, 0.46), bodyMat);
  head.position.y = 1.66;
  head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.05), darkMat);
  visor.position.set(0, 1.68, 0.24);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.72), darkMat);
  gun.position.set(0.28, 1.15, 0.35);
  group.add(body, head, visor, gun);
  group.visible = false;
  scene.add(group);
  body.userData = { actor: null, part: 'body' };
  head.userData = { actor: null, part: 'head' };
  visor.userData = { actor: null, part: 'head' };

  const actor = {
    id, name, team, isPlayer, rng,
    mesh: group, bodyMesh: body, headMesh: head,
    pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 }, vy: 0,
    yaw: 0, pitch: 0, onGround: true, crouch: false,
    hp: 100, armor: 0, alive: true,
    money: 800, kills: 0, deaths: 0,
    weapons: {}, current: 'kestrel', grenades: 0,
    lastShot: -9, reloadUntil: -9, reloading: false,
    recoilPitch: 0, moveSpeed: 0, // current ground speed, for spread
    lastDamageFrom: null, lastDamageAt: -9,
    hasBomb: false, planting: 0, defusing: 0,
    // Bot brain fills these in; the player leaves them null.
    bot: null,
    aimTarget: null, triggerHeld: false,
    get eyeY() { return this.crouch ? EYE_CROUCH : EYE_STAND; },
    get weapon() { return WEAPONS[this.current]; },
    get weaponState() { return this.weapons[this.current]; },
    get speedNow() { return Math.hypot(this.vel.x, this.vel.z); },

    reset(spawn, yaw) {
      this.pos.x = spawn[0]; this.pos.z = spawn[1];
      this.vel.x = 0; this.vel.z = 0; this.vy = 0;
      this.yaw = yaw; this.pitch = 0;
      this.hp = 100; this.armor = 0; this.alive = true;
      this.crouch = false; this.onGround = true;
      this.reloading = false; this.reloadUntil = -9;
      this.recoilPitch = 0; this.planting = 0; this.defusing = 0;
      this.hasBomb = false;
      this.aimTarget = null; this.triggerHeld = false;
      group.visible = !isPlayer;
      this.syncMesh();
    },
    giveWeapon(wid, refill) {
      const def = WEAPONS[wid];
      if (!this.weapons[wid]) this.weapons[wid] = { mag: def.mag, reserve: def.reserve };
      else if (refill) { this.weapons[wid].mag = def.mag; this.weapons[wid].reserve = def.reserve; }
      this.current = wid;
    },
    // Movement: wishDir is a unit {x,z} in world space (or null), dt fixed step.
    stepMove(dt, wishX, wishZ, wantJump, wantCrouch, map) {
      if (!this.alive) return;
      this.crouch = wantCrouch;
      const maxSpeed = this.crouch ? 2.1 : (this.weapon.kind === 'sniper' ? 3.9 : 4.4);
      const accel = this.onGround ? 42 : 12;
      this.vel.x += wishX * accel * dt;
      this.vel.z += wishZ * accel * dt;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > maxSpeed) { this.vel.x *= maxSpeed / sp; this.vel.z *= maxSpeed / sp; }
      if (!wishX && !wishZ && this.onGround) {
        const f = Math.max(0, 1 - 11 * dt);
        this.vel.x *= f; this.vel.z *= f;
      }
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      map.collideCircle(this.pos, RADIUS);
      if (wantJump && this.onGround) { this.vy = 7.2; this.onGround = false; }
      if (!this.onGround) {
        this.vy -= 22 * dt;
        // Jump height is visual only: the actor's y is tracked on the mesh.
        this.jumpY = (this.jumpY || 0) + this.vy * dt;
        if (this.jumpY <= 0) { this.jumpY = 0; this.vy = 0; this.onGround = true; }
      }
      this.moveSpeed = Math.hypot(this.vel.x, this.vel.z);
      this.syncMesh();
    },
    syncMesh() {
      group.position.set(this.pos.x, this.jumpY || 0, this.pos.z);
      group.rotation.y = this.yaw;
      const s = this.crouch ? 0.78 : 1;
      group.scale.set(1, s, 1);
    },
    // Damage: armor absorbs its share first. Returns true when this kill lands.
    damage(amount, part, attacker, now) {
      if (!this.alive) return false;
      let dmg = amount * (part === 'head' ? this.weaponHeadMul(attacker) : 1);
      if (this.armor > 0) {
        const absorbed = dmg * 0.5;
        this.armor = Math.max(0, this.armor - absorbed);
        dmg -= absorbed;
      }
      this.hp -= dmg;
      this.lastDamageFrom = attacker;
      this.lastDamageAt = now;
      if (this.hp <= 0) {
        this.hp = 0; this.alive = false;
        // Fall over: tip the body on its side for a death pose.
        group.rotation.set(-Math.PI / 2, this.yaw, 0);
        group.position.y = 0.25;
        return true;
      }
      return false;
    },
    weaponHeadMul(attacker) {
      return attacker ? attacker.weapon.headMul : 2;
    },
    canShoot(now) {
      if (!this.alive || this.reloading || now < this.reloadUntil) return false;
      const w = this.weaponState;
      if (!w || w.mag <= 0) return false;
      return now - this.lastShot >= 60 / this.weapon.rpm;
    },
    startReload(now) {
      const w = this.weaponState;
      if (!w || this.reloading || w.mag >= this.weapon.mag || w.reserve <= 0) return false;
      this.reloading = true;
      this.reloadUntil = now + this.weapon.reloadS;
      return true;
    },
    finishReload() {
      const w = this.weaponState;
      const def = this.weapon;
      const need = def.mag - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take; w.reserve -= take;
      this.reloading = false;
    },
    // Current spread in radians: base + movement + air + recent fire bloom.
    spread(now) {
      const w = this.weapon;
      let s = w.spread;
      const move = this.moveSpeed / 4.4;
      s += (w.moveSpread - w.spread) * move;
      if (!this.onGround) s += 0.05;
      if (this.crouch) s *= 0.75;
      const sinceShot = now - this.lastShot;
      if (sinceShot < 0.35) s += (0.35 - sinceShot) * 0.03;
      return s;
    },
  };
  body.userData.actor = actor;
  head.userData.actor = actor;
  visor.userData.actor = actor;
  return actor;
}

export { EYE_STAND, EYE_CROUCH };
