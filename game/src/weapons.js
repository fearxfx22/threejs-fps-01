// Weapon and grenade definitions. All numbers are the game's own balance: damage is
// per body hit, headshots multiply by headMul, spread is radians of cone half-angle at
// rest (standing still, aimed), recoil is the pitch kick per shot.
export const WEAPONS = {
  kestrel: {
    id: 'kestrel', name: 'KESTREL P9', kind: 'pistol', price: 0,
    damage: 30, headMul: 2.5, rpm: 360, mag: 12, reserve: 36,
    spread: 0.011, moveSpread: 0.030, recoil: 0.011, reloadS: 1.1,
    range: 42, auto: false, tracer: '#ffd27a', desc: 'Sidearm. Free, reliable, rewards a calm hand.',
  },
  jackal: {
    id: 'jackal', name: 'JACKAL SMG', kind: 'smg', price: 1500,
    damage: 22, headMul: 2.2, rpm: 780, mag: 28, reserve: 84,
    spread: 0.020, moveSpread: 0.045, recoil: 0.009, reloadS: 1.9,
    range: 34, auto: true, tracer: '#ffe9a8', desc: 'Close-quarters hose. Fast, hungry, wild on the move.',
  },
  longhorn: {
    id: 'longhorn', name: 'LONGHORN AR', kind: 'rifle', price: 2700,
    damage: 33, headMul: 2.6, rpm: 600, mag: 25, reserve: 75,
    spread: 0.008, moveSpread: 0.034, recoil: 0.016, reloadS: 2.3,
    range: 55, auto: true, tracer: '#ffb347', desc: 'The workhorse. One-tap headshots at mid range.',
  },
  falcon: {
    id: 'falcon', name: 'FALCON DMR', kind: 'sniper', price: 4750,
    damage: 95, headMul: 1.9, rpm: 55, mag: 5, reserve: 15,
    spread: 0.0015, moveSpread: 0.075, recoil: 0.055, reloadS: 3.1,
    range: 90, auto: false, tracer: '#cfe8ff', desc: 'One body shot, one kill — if you stand still and mean it.',
  },
};
export const WEAPON_ORDER = ['kestrel', 'jackal', 'longhorn', 'falcon'];
export const ARMOR = { id: 'kevlar', name: 'KEVLAR VEST', price: 650, absorb: 0.5, desc: 'Halves bullet damage until it breaks.' };
export const GRENADE = {
  id: 'frag', name: 'FRAG GRENADE', price: 300,
  radius: 7, damage: 110, fuseS: 1.7, desc: 'Cooks 1.7s, then clears a corner.',
};
export const ECONOMY = {
  startMoney: 800, winBonus: 3250, lossBonus: 1900, killBonus: 300,
  plantBonus: 300, explodeBonus: 300, defuseBonus: 300, maxMoney: 16000,
};
