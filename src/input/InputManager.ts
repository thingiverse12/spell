const DEADZONE = 0.18;
const GAMEPAD_LOOK_SPEED = 2.6;
const GAMEPAD_ZOOM_SPEED = 6;

/** Standard-gamepad button indices. */
const BUTTON_A = 0;
const BUTTON_Y = 3;
const BUTTON_LB = 4;
const BUTTON_RB = 5;
const BUTTON_LT = 6;

export interface InputSnapshot {
  moveX: number;
  moveZ: number;
  sprint: boolean;
  /** True only on the frame the jump control transitions to pressed. */
  jumpPressed: boolean;
  /** Horizontal look delta in pixels accumulated since the previous frame. */
  lookX: number;
  /** Vertical look delta in pixels accumulated since the previous frame. */
  lookY: number;
  /** Zoom delta in wheel units accumulated since the previous frame. */
  zoom: number;
  /** True only on the frame the switch control transitions to pressed. */
  switchPressed: boolean;
  /** One-shot direct selection: 0-based roster index, or -1. */
  selectIndex: number;
}

function applyDeadzone(value: number): number {
  if (Math.abs(value) < DEADZONE) return 0;
  const sign = Math.sign(value);
  return sign * ((Math.abs(value) - DEADZONE) / (1 - DEADZONE));
}

/**
 * Unified keyboard/mouse/gamepad input. Listeners are registered once and
 * removed in `dispose()`; nothing is allocated per frame.
 */
export class InputManager {
  private readonly keys = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private zoom = 0;
  private switchPressed = false;
  private selectIndex = -1;
  private dragging = false;
  private activePointer: number | null = null;

  private gamepadJumpWasDown = false;
  private gamepadSwitchWasDown = false;
  private keyboardJumpWasDown = false;
  private readonly snapshot: InputSnapshot = {
    moveX: 0,
    moveZ: 0,
    sprint: false,
    jumpPressed: false,
    lookX: 0,
    lookY: 0,
    zoom: 0,
    switchPressed: false,
    selectIndex: -1,
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) {
      // Still track the key so it isn't lost after a repeat-only sequence.
      this.keys.add(event.code);
      return;
    }
    this.keys.add(event.code);

    if (event.code === 'Tab') {
      // Tab would otherwise move focus out of the canvas.
      event.preventDefault();
      this.switchPressed = true;
    }
    if (event.code === 'Digit1') this.selectIndex = 0;
    if (event.code === 'Digit2') this.selectIndex = 1;
    if (event.code === 'Space') event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.dragging = false;
    this.activePointer = null;
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 2) return;
    this.dragging = true;
    this.activePointer = event.pointerId;
    this.element.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.activePointer) return;
    this.lookX += event.movementX || 0;
    this.lookY += event.movementY || 0;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return;
    this.dragging = false;
    this.activePointer = null;
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoom += event.deltaY;
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  constructor(private readonly element: HTMLElement) {}

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('pointercancel', this.onPointerUp);
    this.element.addEventListener('wheel', this.onWheel, { passive: false });
    this.element.addEventListener('contextmenu', this.onContextMenu);
  }

  /** Requests a switch — used by the HUD character chips. */
  requestSwitch(): void {
    this.switchPressed = true;
  }

  requestSelect(index: number): void {
    this.selectIndex = index;
  }

  /** Builds this frame's snapshot and clears edge-triggered state. */
  sample(dt: number): InputSnapshot {
    const held = (code: string): boolean => this.keys.has(code);

    let moveX = (held('KeyD') || held('ArrowRight') ? 1 : 0) - (held('KeyA') || held('ArrowLeft') ? 1 : 0);
    let moveZ = (held('KeyW') || held('ArrowUp') ? 1 : 0) - (held('KeyS') || held('ArrowDown') ? 1 : 0);

    let sprint = held('ShiftLeft') || held('ShiftRight');

    let lookX = this.lookX;
    let lookY = this.lookY;
    let zoom = this.zoom;

    // Keyboard jump is edge-triggered: holding Space must not auto-hop.
    const keyboardJumpDown = held('Space');
    let jumpPressed = keyboardJumpDown && !this.keyboardJumpWasDown;
    this.keyboardJumpWasDown = keyboardJumpDown;

    const pad = this.readGamepad();
    if (pad) {
      moveX += applyDeadzone(pad.axes[0] ?? 0);
      moveZ -= applyDeadzone(pad.axes[1] ?? 0);
      lookX += applyDeadzone(pad.axes[2] ?? 0) * GAMEPAD_LOOK_SPEED * dt * 100;
      lookY += applyDeadzone(pad.axes[3] ?? 0) * GAMEPAD_LOOK_SPEED * dt * 100;
      zoom += (this.button(pad, BUTTON_LB) ? GAMEPAD_ZOOM_SPEED : 0) * dt * 100;
      zoom -= (this.button(pad, BUTTON_RB) ? GAMEPAD_ZOOM_SPEED : 0) * dt * 100;

      sprint = sprint || this.button(pad, BUTTON_LT) > 0.4;

      const padJumpDown = this.button(pad, BUTTON_A) > 0;
      if (padJumpDown && !this.gamepadJumpWasDown) jumpPressed = true;
      this.gamepadJumpWasDown = padJumpDown;

      const switchDownNow = this.button(pad, BUTTON_Y) > 0;
      if (switchDownNow && !this.gamepadSwitchWasDown) this.switchPressed = true;
      this.gamepadSwitchWasDown = switchDownNow;
    }

    const snapshot = this.snapshot;
    snapshot.moveX = Math.max(-1, Math.min(1, moveX));
    snapshot.moveZ = Math.max(-1, Math.min(1, moveZ));
    snapshot.sprint = sprint;
    snapshot.jumpPressed = jumpPressed;
    snapshot.lookX = lookX;
    snapshot.lookY = lookY;
    snapshot.zoom = zoom;
    snapshot.switchPressed = this.switchPressed;
    snapshot.selectIndex = this.selectIndex;

    this.lookX = 0;
    this.lookY = 0;
    this.zoom = 0;
    this.switchPressed = false;
    this.selectIndex = -1;

    return snapshot;
  }

  private button(pad: Gamepad, index: number): number {
    const button = pad.buttons[index];
    if (!button) return 0;
    return typeof button === 'number' ? button : button.value;
  }

  private readGamepad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const pad of navigator.getGamepads()) {
      if (pad && pad.connected) return pad;
    }
    return null;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerUp);
    this.element.removeEventListener('wheel', this.onWheel);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    this.keys.clear();
  }
}
