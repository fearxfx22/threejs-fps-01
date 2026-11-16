// The HUD: every DOM readout the player sees. The game calls small setters; this module
// never reads game state on its own. The buy menu is built from the weapon table so the
// prices on screen are always the prices the game charges.
import { fmtMoney, fmtTime } from './util.js';
import { WEAPONS, WEAPON_ORDER, ARMOR, GRENADE } from './weapons.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    health: $('health-num'), healthBar: $('health-bar'), armor: $('armor-num'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    money: $('money-num'), grenades: $('grenade-num'),
    scoreAtk: $('score-atk'), scoreDef: $('score-def'), timer: $('timer'), roundLabel: $('round-label'),
    killfeed: $('killfeed'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    progress: $('progress'), progressLabel: $('progress-label'), progressFill: $('progress-fill'),
    menu: $('menu-overlay'), buy: $('buy-overlay'), buyGrid: $('buy-grid'), buyMoney: $('buy-money'),
    end: $('end-overlay'), endTitle: $('end-title'), endSub: $('end-sub'),
    pause: $('pause-overlay'), minimap: $('minimap'), damage: $('damage-flash'),
    hint: $('hint'),
  };
  const mm = els.minimap.getContext('2d');
  let hitTimer = 0, bannerTimer = 0;

  function feedHtml(killer, victim, headshot, killerTeam) {
    const div = document.createElement('div');
    div.className = 'feed-row';
    const kc = killerTeam === 'atk' ? 'color-atk' : 'color-def';
    div.innerHTML = `<span class="${kc}"></span>`;
    div.firstChild.textContent = killer;
    const mid = document.createElement('span');
    mid.className = 'feed-mid';
    mid.textContent = headshot ? ' ⌖ ' : ' ✕ ';
    const v = document.createElement('span');
    v.className = 'color-victim';
    v.textContent = victim;
    div.append(mid, v);
    els.killfeed.prepend(div);
    while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
    setTimeout(() => div.remove(), 6000);
  }

  return {
    setHealth(hp, armor) {
      els.health.textContent = Math.ceil(hp);
      els.healthBar.style.width = Math.max(0, hp) + '%';
      els.healthBar.classList.toggle('low', hp <= 30);
      els.armor.textContent = armor > 0 ? Math.ceil(armor) : '—';
    },
    setAmmo(mag, reserve, name) {
      els.ammoMag.textContent = mag;
      els.ammoReserve.textContent = '/ ' + reserve;
      els.weaponName.textContent = name;
      els.ammoMag.parentElement.classList.toggle('empty', mag === 0);
    },
    setMoney(m) { els.money.textContent = fmtMoney(m); els.buyMoney.textContent = fmtMoney(m); },
    setGrenades(n) { els.grenades.textContent = '◉'.repeat(n) + (n === 0 ? '—' : ''); },
    setScore(atk, def, round) {
      els.scoreAtk.textContent = atk;
      els.scoreDef.textContent = def;
      els.roundLabel.textContent = 'ROUND ' + round;
    },
    setTimer(t, urgent) {
      els.timer.textContent = fmtTime(t);
      els.timer.classList.toggle('urgent', urgent);
    },
    setCrosshair(gapPx) { els.crosshair.style.setProperty('--gap', gapPx.toFixed(1) + 'px'); },
    hitmarker(kill) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), 140);
    },
    damageFlash() {
      els.damage.classList.add('on');
      setTimeout(() => els.damage.classList.remove('on'), 180);
    },
    killfeed(killer, victim, headshot, killerTeam) { feedHtml(killer, victim, headshot, killerTeam); },
    banner(title, sub, color) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub || '';
      els.banner.style.color = color || '';
      els.banner.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => els.banner.classList.remove('show'), 3200);
    },
    hideBanner() { els.banner.classList.remove('show'); },
    setProgress(label, frac) {
      if (frac === null) { els.progress.classList.add('hidden'); return; }
      els.progress.classList.remove('hidden');
      els.progressLabel.textContent = label;
      els.progressFill.style.width = (frac * 100).toFixed(0) + '%';
    },
    setHint(text) { els.hint.textContent = text; },
    showOverlay(name) {
      for (const key of ['menu', 'buy', 'end', 'pause']) els[key].classList.toggle('hidden', key !== name);
    },
    hideOverlays() { for (const key of ['menu', 'buy', 'end', 'pause']) els[key].classList.add('hidden'); },
    setEnd(title, sub) { els.endTitle.textContent = title; els.endSub.textContent = sub; },
    buildBuyMenu(onBuy) {
      const items = [];
      for (const id of WEAPON_ORDER) {
        const w = WEAPONS[id];
        items.push({ id, name: w.name, price: w.price, desc: w.desc, key: String(WEAPON_ORDER.indexOf(id) + 1), tag: `${w.damage} dmg · ${w.mag} rnd` });
      }
      items.push({ id: 'kevlar', name: ARMOR.name, price: ARMOR.price, desc: ARMOR.desc, key: '5', tag: '100 armor' });
      items.push({ id: 'frag', name: GRENADE.name, price: GRENADE.price, desc: GRENADE.desc, key: '6', tag: '1 grenade' });
      els.buyGrid.innerHTML = '';
      for (const item of items) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'buyItem';
        tile.dataset.id = item.id;
        tile.innerHTML = `<span class="buy-key"></span><span class="buy-name"></span><span class="buy-price"></span><span class="buy-tag"></span><span class="buy-desc"></span>`;
        tile.querySelector('.buy-key').textContent = item.key;
        tile.querySelector('.buy-name').textContent = item.name;
        tile.querySelector('.buy-price').textContent = item.price === 0 ? 'OWNED' : fmtMoney(item.price);
        tile.querySelector('.buy-tag').textContent = item.tag;
        tile.querySelector('.buy-desc').textContent = item.desc;
        tile.addEventListener('click', () => onBuy(item.id));
        els.buyGrid.appendChild(tile);
      }
    },
    markBought(id, owned) {
      const tile = els.buyGrid.querySelector(`[data-id="${id}"]`);
      if (tile) tile.classList.toggle('owned', owned);
    },
    drawMinimap(map, actors, bomb, player) {
      const W = els.minimap.width, H = els.minimap.height;
      const { minX, maxX, minZ, maxZ } = map.bounds;
      const sx = (x) => ((x - minX) / (maxX - minX)) * W;
      const sz = (z) => ((z - minZ) / (maxZ - minZ)) * H;
      mm.clearRect(0, 0, W, H);
      mm.fillStyle = 'rgba(20,22,26,0.72)';
      mm.fillRect(0, 0, W, H);
      // Sites
      mm.fillStyle = 'rgba(63,125,90,0.5)';
      mm.fillRect(sx(map.siteA.minX), sz(map.siteA.minZ), sx(map.siteA.maxX) - sx(map.siteA.minX), sz(map.siteA.maxZ) - sz(map.siteA.minZ));
      mm.fillStyle = 'rgba(125,90,63,0.5)';
      mm.fillRect(sx(map.siteB.minX), sz(map.siteB.minZ), sx(map.siteB.maxX) - sx(map.siteB.minX), sz(map.siteB.maxZ) - sz(map.siteB.minZ));
      mm.fillStyle = '#e9e6df';
      mm.font = 'bold 11px sans-serif';
      mm.fillText('A', sx(map.siteA.cx) - 3, sz(map.siteA.cz) + 4);
      mm.fillText('B', sx(map.siteB.cx) - 3, sz(map.siteB.cz) + 4);
      // Walls
      mm.fillStyle = '#8a7a5e';
      for (const b of map.colliders) {
        mm.fillRect(sx(b.minX), sz(b.minZ), Math.max(1, sx(b.maxX) - sx(b.minX)), Math.max(1, sz(b.maxZ) - sz(b.minZ)));
      }
      // Bomb
      if ((bomb.state === 'planted' || bomb.state === 'dropped') && bomb.x !== undefined) {
        mm.fillStyle = '#ff3020';
        mm.beginPath(); mm.arc(sx(bomb.x), sz(bomb.z), 4, 0, Math.PI * 2); mm.fill();
      }
      // Actors
      for (const a of actors) {
        if (!a.alive) continue;
        mm.fillStyle = a.team === 'atk' ? '#e0703a' : '#3aa7b8';
        mm.beginPath(); mm.arc(sx(a.pos.x), sz(a.pos.z), a.isPlayer ? 4 : 3, 0, Math.PI * 2); mm.fill();
        if (a.isPlayer) {
          mm.strokeStyle = '#fff'; mm.lineWidth = 1.5;
          mm.beginPath(); mm.arc(sx(a.pos.x), sz(a.pos.z), 6, 0, Math.PI * 2); mm.stroke();
          const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
          mm.beginPath(); mm.moveTo(sx(a.pos.x), sz(a.pos.z));
          mm.lineTo(sx(a.pos.x) + fx * 10, sz(a.pos.z) + fz * 10); mm.stroke();
        }
      }
    },
  };
}
