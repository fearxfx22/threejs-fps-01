// Keyboard + pointer-lock mouse input. One object owns the key set, the look deltas and
// the lock state; the game reads it every fixed step and never touches DOM events itself.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const look = { x: 0, y: 0 };
  let locked = false;
  let firing = false;
  let firePressed = false; // edge-triggered, for semi-auto weapons

  function onKeyDown(e) {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function onMouseMove(e) {
    if (!locked) return;
    look.x += e.movementX;
    look.y += e.movementY;
  }
  function onMouseDown(e) {
    if (!locked || e.button !== 0) return;
    firing = true;
    firePressed = true;
  }
  function onMouseUp(e) { if (e.button === 0) firing = false; }
  function onLock() {
    locked = document.pointerLockElement === canvas;
    if (!locked) firing = false;
    onLockChange(locked);
  }
  function onBlur() { keys.clear(); firing = false; }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLock);

  return {
    keys,
    get locked() { return locked; },
    get firing() { return firing; },
    requestLock() { canvas.requestPointerLock(); },
    exitLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    takeLook() {
      const out = { x: look.x, y: look.y };
      look.x = 0; look.y = 0;
      return out;
    },
    // True once per mouse press; the game clears it after the shot attempt.
    takeFirePress() {
      const pressed = firePressed;
      firePressed = false;
      return pressed;
    },
    // True while a key is held, cleared on read (single-fire actions like buy/grenade).
    takeKey(code) {
      if (!keys.has(code)) return false;
      keys.delete(code);
      return true;
    },
  };
}
