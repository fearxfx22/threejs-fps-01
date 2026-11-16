# DUSTLINE — a three.js tactical FPS

A round-based tactical first-person shooter in the style Counter-Strike made famous,
built on three.js 0.187.0 from static files with no build step and no network request.

**The game:** two teams of four fight in a desert-dusk arena. Attackers plant a bomb
on site A or B (or wipe the defenders out); defenders hold the sites or defuse.
First team to 5 round wins takes the match. Between rounds you earn cash for kills
and round wins and spend it on weapons, kevlar and grenades.

**Features**

- 4 weapons with distinct price, damage, fire rate, recoil and spread (Kestrel P9
  pistol, Jackal SMG, Longhorn rifle, Falcon DMR) + frag grenades + kevlar
- Gunplay where accuracy counts: recoil, bloom, headshots (2–2.6×), movement spread
  penalty, crouching steadies your aim, limited ammo + reload
- Bot AI: 7 bots navigate a waypoint graph, hold lanes, react to what they see and
  hear, buy weapons, plant and defuse the bomb, and fight in bursts with reaction time
- Bomb objective: 3s plant, 35s fuse with accelerating beeps, 5s defuse
- Full HUD: health + armor, ammo, money, round score, round timer, minimap, kill feed,
  crosshair with live spread, hit markers, plant/defuse progress
- Original map: three lanes, two sites, crates and walls for cover, dusk lighting,
  fog, distant mesas; synthesised WebAudio sounds (no audio files)

**How to play**

Serve `game/` with any static server (e.g. `node serve.ts`, then open
http://localhost:8080) and click **Click to play**.

- `W A S D` move · mouse look · click fire · `R` reload
- `Ctrl` crouch · `Space` jump · `Shift` walk (steadier aim)
- `B` buy menu (buy phase) · `1`–`4` switch weapon · `G` throw grenade
- Hold `E` to plant / defuse the bomb · `Esc` pause

**Layout**

- `game/` — the playable game (ES modules, `index.html` + `src/`, three.js 0.187.0
  vendored under `game/vendor/three/`)
- `screenshots/` — 4 screenshots taken in headless Chrome from this code
- `main.ts` — the hand-in program: copies `game/` + `screenshots/` to `/output`
  and writes `dossier.json` with `vendor/makefun-threejs.ts`
- `serve.ts` — a tiny static server for local play-testing

MIT licensed. Built for the make.fun threejs-fps-01 bounty.
