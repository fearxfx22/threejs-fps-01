// The bomb objective. One attacker carries it; planting takes 3s standing on a site,
// the planted bomb ticks down 35s with accelerating beeps, a defender defuses in 5s.
// The module owns the little bomb mesh (a dark case with a blinking light) and the state;
// the game decides who carries it and what a plant/explosion/defuse means for the round.
import * as THREE from 'three';

export const PLANT_TIME = 3, DEFUSE_TIME = 5, BOMB_TIMER = 35;

export function createBomb(scene) {
  const group = new THREE.Group();
  const caseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.24, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.4 }),
  );
  caseMesh.castShadow = true;
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff3020, emissiveIntensity: 2 }),
  );
  light.position.set(0, 0.15, 0);
  group.add(caseMesh, light);
  group.visible = false;
  scene.add(group);

  const bomb = {
    state: 'carried', // carried | planting | planted | defusing | exploded | defused
    x: 0, z: 0, timer: BOMB_TIMER,
    carrier: null, planter: null, defuser: null,
    lastBeep: 0, blink: 0,
    mesh: group, lightMesh: light,
    reset(carrier) {
      this.state = 'carried';
      this.carrier = carrier;
      this.planter = null; this.defuser = null;
      this.timer = BOMB_TIMER;
      this.lastBeep = 0;
      group.visible = false;
    },
    // Called every fixed step while planted; returns 'explode' once, else null.
    step(dt, now, onBeep) {
      if (this.state !== 'planted') return null;
      this.timer -= dt;
      this.blink += dt;
      const interval = this.timer > 20 ? 1.0 : this.timer > 10 ? 0.55 : 0.3;
      if (now - this.lastBeep >= interval) {
        this.lastBeep = now;
        onBeep(this.timer <= 10);
      }
      light.material.emissiveIntensity = (this.blink % 0.5) < 0.25 ? 2.5 : 0.3;
      if (this.timer <= 0) {
        this.state = 'exploded';
        group.visible = false;
        return 'explode';
      }
      return null;
    },
    plantAt(x, z) {
      this.state = 'planted';
      this.x = x; this.z = z;
      this.timer = BOMB_TIMER;
      this.carrier = null; this.planter = null;
      group.position.set(x, 0.14, z);
      group.visible = true;
    },
    dropAt(x, z) {
      // Carrier died: the bomb waits on the ground for a teammate to pick up.
      this.state = 'dropped';
      this.x = x; this.z = z;
      this.carrier = null;
      group.position.set(x, 0.14, z);
      group.visible = true;
    },
    pickUp(actor) {
      this.state = 'carried';
      this.carrier = actor;
      group.visible = false;
    },
  };
  return bomb;
}
