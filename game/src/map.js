// DUSTLINE — an original desert-dusk arena. Two bomb sites (A west, B east) in the
// north, the attackers' spawn in the south, three lanes (west, mid, east) between them.
// Walls are axis-aligned boxes; every wall is both a mesh and an AABB collider, and the
// same boxes answer line-of-sight queries (segment vs box, no raycaster needed).
import * as THREE from 'three';
import { mulberry32 } from './util.js';

const SAND = 0xc9a06a, SAND_DARK = 0xb08a52, ROCK = 0x8a6f4d, ROCK_DARK = 0x6e5638;
const WALL = 0x9c8468, WALL_TOP = 0xb59a78, CRATE = 0x7d6a4f, CRATE_ALT = 0x5f6e58;
const SITE_A = 0x3f7d5a, SITE_B = 0x7d5a3f, METAL = 0x4a4f55, ACCENT = 0xd98a2b;

function groundTexture(rng) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#c9a06a'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5200; i += 1) {
    const v = rng();
    g.fillStyle = v < 0.5 ? 'rgba(120,90,50,0.10)' : 'rgba(235,205,150,0.08)';
    const s = 1 + rng() * 4;
    g.fillRect(rng() * 512, rng() * 512, s, s);
  }
  // Faint tyre / lane wear running north-south down the three lanes.
  g.strokeStyle = 'rgba(90,65,35,0.16)'; g.lineWidth = 26;
  for (const x of [96, 256, 416]) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rng() * 30 - 15), 512); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Wall spec: [cx, cz, width(x), depth(z), height, colour]
const WALLS = [
  // Perimeter (arena x -22..22, z -18..18)
  [0, -18.6, 46, 1.2, 4.2, WALL], [0, 18.6, 46, 1.2, 4.2, WALL],
  [-22.6, 0, 1.2, 38, 4.2, WALL], [22.6, 0, 1.2, 38, 4.2, WALL],
  // Mid divider walls shaping the three lanes
  [-8, -7.5, 1.4, 9, 3.0, WALL], [8, -7.5, 1.4, 9, 3.0, WALL],
  [-8, 8, 1.4, 10, 3.0, WALL], [8, 8, 1.4, 10, 3.0, WALL],
  [-14, 0, 6, 1.4, 2.6, WALL], [14, 0, 6, 1.4, 2.6, WALL],
  [0, -2, 5, 1.4, 2.2, WALL],
  // Site back walls
  [-15, -14.5, 10, 1.4, 3.4, WALL], [15, -14.5, 10, 1.4, 3.4, WALL],
  // Spawn cover
  [-4, 16, 8, 1.2, 2.4, WALL], [6, 16, 6, 1.2, 2.4, WALL],
];
// Crate spec: [cx, cz, w, d, h, colour] — low cover you can shoot over when crouched on.
const CRATES = [
  [-16.5, -9, 2.4, 2.4, 1.3, CRATE], [-12.5, -11, 2, 2, 1.1, CRATE_ALT],
  [16.5, -9, 2.4, 2.4, 1.3, CRATE], [12.5, -11, 2, 2, 1.1, CRATE_ALT],
  [-4, -6.5, 2.2, 2.2, 1.2, CRATE], [4, -6.5, 2.2, 2.2, 1.2, CRATE_ALT],
  [-3, 7, 3, 1.6, 1.1, CRATE], [3, 7, 3, 1.6, 1.1, CRATE_ALT],
  [-17, 5, 2.2, 2.2, 1.2, CRATE_ALT],
  [17, 5, 2.2, 2.2, 1.2, CRATE], [-18, -3, 2, 2, 1.4, CRATE],
  [18, -3, 2, 2, 1.4, CRATE], [-5.5, -9.5, 2.6, 2.6, 1.2, CRATE_ALT],
  [5.5, -9.5, 2.6, 2.6, 1.2, CRATE],
  [-6, 12, 2.2, 2.2, 1.2, CRATE], [10, 11, 2.2, 2.2, 1.2, CRATE_ALT],
  [-17, 12, 1.8, 1.8, 1.0, CRATE], [17, 12, 1.8, 1.8, 1.0, CRATE],
];
// Waypoint graph: bots walk these nodes. [x, z, links...] — links by index.
// Every link was checked against the walls and crates: no segment crosses a collider.
const WAYPOINTS = [
  [0, 15, [1, 2, 3]],          // 0 attacker spawn
  [-14, 12, [0, 4]],           // 1 west lane south
  [0, 11, [0, 5]],             // 2 mid south
  [14, 12, [0, 6]],            // 3 east lane south
  [-14, 4, [1, 17]],           // 4 west lane mid
  [0, 5, [2, 17, 18]],         // 5 mid plaza
  [14, 4, [3, 18]],            // 6 east lane mid
  [-14, -4, [17, 10]],         // 7 west lane north
  [-4, -4, [17, 9, 13]],       // 8 mid-west junction
  [4, -4, [18, 8, 13]],        // 9 mid-east junction
  [-14, -8, [7, 12, 14]],      // 10 site A approach
  [14, -8, [18, 15]],          // 11 site B approach
  [-15, -12, [10, 14]],        // 12 site A
  [0, -11, [8, 9, 14, 15]],    // 13 north connector
  [-6, -14, [10, 12, 13, 16]], // 14 defender west
  [6, -14, [11, 13, 16]],      // 15 defender east
  [0, -15, [13, 14, 15]],      // 16 defender spawn
  [-8, 0.5, [4, 5, 7, 8]],     // 17 west crossing (the gap in the west walls)
  [8, 0.5, [5, 6, 9, 11]],     // 18 east crossing (the gap in the east walls)
];

export function createMap(scene, seed = 1) {
  const rng = mulberry32(seed);
  const colliders = [];   // {minX,maxX,minZ,maxZ,h}
  const shootables = [];  // meshes bullets can hit (walls, crates, ground)
  const occluders = [];   // {minX,maxX,minZ,maxZ,h} for line-of-sight
  const group = new THREE.Group();
  scene.add(group);

  // Dusk sky dome: a big gradient sphere so the horizon glows instead of going black.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 256;
  const sg = skyCanvas.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1d2942');
  grad.addColorStop(0.45, '#5c3d2c');
  grad.addColorStop(0.62, '#c97a33');
  grad.addColorStop(0.72, '#e8a04a');
  grad.addColorStop(1, '#2b2118');
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(130, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);

  // Lights: low warm sun + cool dusk sky fill.
  const sun = new THREE.DirectionalLight(0xffc98a, 2.6);
  sun.position.set(-18, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8fa3c7, 0x8a6a45, 0.85));
  scene.add(new THREE.AmbientLight(0x604a30, 0.35));

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 38),
    new THREE.MeshStandardMaterial({ map: groundTexture(rng), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  shootables.push(ground);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  function addBox(cx, cz, w, d, h, color, topColor) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });
    const mesh = new THREE.Mesh(boxGeo, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(cx, h / 2, cz);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    shootables.push(mesh);
    if (topColor) {
      const cap = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: topColor, roughness: 0.7 }));
      cap.scale.set(w + 0.12, 0.12, d + 0.12);
      cap.position.set(cx, h + 0.06, cz);
      cap.castShadow = true; cap.receiveShadow = true;
      group.add(cap);
      shootables.push(cap);
    }
    const box = { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h };
    colliders.push(box);
    occluders.push(box);
    return box;
  }
  for (const [cx, cz, w, d, h, c] of WALLS) addBox(cx, cz, w, d, h, c, WALL_TOP);
  for (const [cx, cz, w, d, h, c] of CRATES) addBox(cx, cz, w, d, h, c, null);

  // Site pads: painted ground rectangles + a low marker post.
  function sitePad(cx, cz, color, label) {
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 5),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: true, opacity: 0.55 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(cx, 0.02, cz);
    pad.receiveShadow = true;
    group.add(pad);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 3.2, 8),
      new THREE.MeshStandardMaterial({ color: METAL, roughness: 0.4, metalness: 0.7 }),
    );
    post.position.set(cx, 1.6, cz - 2.2);
    post.castShadow = true;
    group.add(post);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 8),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6 }),
    );
    lamp.position.set(cx, 3.3, cz - 2.2);
    group.add(lamp);
    const light = new THREE.PointLight(color, 12, 12, 1.8);
    light.position.set(cx, 3.0, cz - 2.2);
    group.add(light);
    return { cx, cz, label, minX: cx - 3.5, maxX: cx + 3.5, minZ: cz - 2.5, maxZ: cz + 2.5 };
  }
  const siteA = sitePad(-15, -12, SITE_A, 'A');
  const siteB = sitePad(15, -12, SITE_B, 'B');

  // Distant mesas outside the walls, for a skyline silhouette in the fog.
  const mesaMat = new THREE.MeshStandardMaterial({ color: ROCK, roughness: 1 });
  const mesaMat2 = new THREE.MeshStandardMaterial({ color: ROCK_DARK, roughness: 1 });
  const mesas = [[-38, -30, 16, 9, 6], [30, -34, 20, 11, 8], [42, 10, 10, 7, 10], [-40, 16, 12, 6, 12], [8, -40, 24, 8, 5]];
  for (const [x, z, w, h, d] of mesas) {
    const m = new THREE.Mesh(boxGeo, rng() < 0.5 ? mesaMat : mesaMat2);
    m.scale.set(w, h, d);
    m.position.set(x, h / 2 - 0.5, z);
    group.add(m);
  }
  // A few scrub bushes (dark cones) for ground detail.
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x4d5c3a, roughness: 1 });
  for (let i = 0; i < 26; i += 1) {
    const x = -21 + rng() * 42, z = -17 + rng() * 34;
    if (Math.abs(x) < 3 && Math.abs(z - 15) < 3) continue;
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.35 + rng() * 0.3, 0.5 + rng() * 0.5, 6), bushMat);
    b.position.set(x, 0.3, z);
    group.add(b);
  }

  // Waypoints with resolved links.
  const waypoints = WAYPOINTS.map(([x, z, links]) => ({ x, z, links }));

  return {
    group, colliders, shootables, occluders, waypoints, siteA, siteB,
    bounds: { minX: -22, maxX: 22, minZ: -18, maxZ: 18 },
    spawns: {
      atk: [[-4, 15], [2, 15], [4, 15], [-8, 14]],
      def: [[-8, -15], [0, -15.5], [8, -15], [4, -14]],
    },
    // Circle (actor) vs AABB: push the point out of any collider it overlaps.
    collideCircle(p, r) {
      for (const b of colliders) {
        const nx = Math.max(b.minX, Math.min(p.x, b.maxX));
        const nz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
        const dx = p.x - nx, dz = p.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = nx + (dx / d) * r;
          p.z = nz + (dz / d) * r;
        } else {
          // Centre inside the box: push out along the smallest penetration axis.
          const pl = p.x - b.minX, pr = b.maxX - p.x, pt = p.z - b.minZ, pb = b.maxZ - p.z;
          const m = Math.min(pl, pr, pt, pb);
          if (m === pl) p.x = b.minX - r;
          else if (m === pr) p.x = b.maxX + r;
          else if (m === pt) p.z = b.minZ - r;
          else p.z = b.maxZ + r;
        }
      }
      p.x = Math.max(-21.4, Math.min(21.4, p.x));
      p.z = Math.max(-17.4, Math.min(17.4, p.z));
    },
    // 3D segment vs wall boxes: true when something solid blocks the view.
    blocked(ax, ay, az, bx, by, bz) {
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      for (const b of occluders) {
        let tmin = 0, tmax = 1, ok = true;
        const slabs = [[ax, dx, b.minX, b.maxX], [ay, dy, 0, b.h], [az, dz, b.minZ, b.maxZ]];
        for (const [o, d, lo, hi] of slabs) {
          if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } continue; }
          let t1 = (lo - o) / d, t2 = (hi - o) / d;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
          if (tmin > tmax) { ok = false; break; }
        }
        if (ok && tmax > 0.02 && tmin < 0.98) return true;
      }
      return false;
    },
    nearestWaypoint(x, z) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < waypoints.length; i += 1) {
        const d = (waypoints[i].x - x) ** 2 + (waypoints[i].z - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
    // BFS over the waypoint graph; returns a list of waypoint indices from start to goal.
    findPath(from, to) {
      if (from === to) return [to];
      const prev = new Array(waypoints.length).fill(-1);
      const queue = [from];
      prev[from] = from;
      while (queue.length) {
        const cur = queue.shift();
        for (const n of waypoints[cur].links) {
          if (prev[n] !== -1) continue;
          prev[n] = cur;
          if (n === to) {
            const path = [to];
            let p = to;
            while (p !== from) { p = prev[p]; path.unshift(p); }
            return path;
          }
          queue.push(n);
        }
      }
      return [to];
    },
  };
}
