import type { Character } from '../characters/Character';
import type { CharacterProfile } from '../characters/types';

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`HUD element #${id} is missing from index.html`);
  return element as T;
}

/**
 * Thin DOM overlay. Nodes are resolved once and only their text/attributes are
 * mutated per frame, so the HUD never churns the DOM during gameplay.
 */
export class Hud {
  private readonly nameEl = requireElement<HTMLDivElement>('hud-name');
  private readonly speedEl = requireElement<HTMLElement>('hud-speed');
  private readonly topEl = requireElement<HTMLElement>('hud-top');
  private readonly stateEl = requireElement<HTMLElement>('hud-state');
  private readonly rosterEl = requireElement<HTMLDivElement>('hud-roster');
  private readonly chips: HTMLButtonElement[] = [];

  constructor(
    profiles: readonly CharacterProfile[],
    onSelect: (index: number) => void,
  ) {
    profiles.forEach((profile, index) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset['active'] = 'false';
      chip.innerHTML = `
        <span class="chip__swatch" style="background:#${profile.palette.body.toString(16).padStart(6, '0')}"></span>
        <span class="chip__meta">
          <span class="chip__name">${profile.displayName}</span>
          <span class="chip__speed">${profile.sprintSpeed.toFixed(1)} m/s</span>
        </span>`;
      chip.addEventListener('click', () => onSelect(index));
      this.rosterEl.append(chip);
      this.chips.push(chip);
    });
  }

  setActive(index: number): void {
    this.chips.forEach((chip, i) => {
      chip.dataset['active'] = i === index ? 'true' : 'false';
    });
  }

  update(character: Character, index: number): void {
    this.speedEl.textContent = character.speed.toFixed(1);
    this.topEl.textContent = character.topSpeed.toFixed(1);
    this.stateEl.textContent = !character.isGrounded
      ? 'airborne'
      : character.speed > character.topSpeed * 0.75
        ? 'sprinting'
        : character.speed > 0.2
          ? 'moving'
          : 'idle';
    this.setActive(index);
    this.nameEl.textContent = character.displayName;
  }
}
