/**
 * Spell - DOM HUD, menus and panels.
 *
 * The HUD is plain DOM on top of the WebGL canvas (report section 6): easier to
 * make accessible (scalable text, contrast, key bindings) than drawing UI into
 * the GL context, and it costs no draw calls.
 */

import { ITEMS, RECIPES, PIECES, SURVIVAL, TIME, WORLD } from '../../shared/config.js';
import { t, itemName, pieceName, getLang } from './i18n.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      loading: $('loading'), loadBar: $('loadBar'), loadMsg: $('loadMsg'),
      menu: $('menu'), nameInput: $('nameInput'), playBtn: $('playBtn'), howBtn: $('howBtn'),
      serverInfo: $('serverInfo'), seedInfo: $('seedInfo'),
      hud: $('hud'), crosshair: $('crosshair'), debug: $('debug'),
      barHealth: $('barHealth'), barStamina: $('barStamina'), barHunger: $('barHunger'),
      barThirst: $('barThirst'), barBreath: $('barBreath'), breathRow: $('breathRow'),
      numHealth: $('numHealth'), numStamina: $('numStamina'), numHunger: $('numHunger'),
      numThirst: $('numThirst'), numBreath: $('numBreath'),
      clockIcon: $('clockIcon'), clockText: $('clockText'),
      toasts: $('toasts'), floating: $('floating'), chatLog: $('chatLog'),
      chatInputWrap: $('chatInputWrap'), chatInput: $('chatInput'),
      hotbar: $('hotbar'), hintText: $('hintText'), buildHint: $('buildHint'),
      vignette: $('vignette'), waterOverlay: $('waterOverlay'),
      inventoryScreen: $('inventoryScreen'), invGrid: $('invGrid'), recipeList: $('recipeList'),
      invTooltip: $('invTooltip'),
      buildMenu: $('buildMenu'), pieceList: $('pieceList'),
      mapScreen: $('mapScreen'), mapCanvas: $('mapCanvas'), mapLegend: $('mapLegend'),
      settings: $('settings'), help: $('help'), helpBody: $('helpBody'),
      death: $('death'), deathCause: $('deathCause'), respawnBtn: $('respawnBtn'),
      disconnect: $('disconnect'), dcText: $('dcText'), dcDetail: $('dcDetail'),
      reconnectBtn: $('reconnectBtn'), guestBtn: $('guestBtn'),
      disclaimer: $('disclaimer'),
    };
    this.selectedSlot = -1;
    this.selectedPiece = 'foundation';
    this.chatLines = [];
    this._lastFloat = 0;
  }

  /* ---------------- screens ---------------- */

  setLoading(pct, msg) {
    this.el.loadBar.style.width = `${Math.round(pct * 100)}%`;
    if (msg) this.el.loadMsg.textContent = msg;
    if (pct >= 1) setTimeout(() => this.el.loading.classList.add('hidden'), 250);
  }

  showMenu(show) { this.el.menu.classList.toggle('hidden', !show); }
  showHud(show) { this.el.hud.classList.toggle('hidden', !show); }
  showDeath(show, cause) {
    this.el.death.classList.toggle('hidden', !show);
    if (show) this.el.deathCause.textContent = t(`dead_cause_${cause || 'unknown'}`);
  }
  showDisconnect(show, text, detail = '') {
    this.el.disconnect.classList.toggle('hidden', !show);
    if (text !== undefined) this.el.dcText.textContent = text;
    if (this.el.dcDetail) this.el.dcDetail.textContent = detail || '';
    // "play as guest" only makes sense when the player id is the problem
    if (this.el.guestBtn) this.el.guestBtn.classList.toggle('hidden', !/gäst|guest|upptagen|taken/i.test(`${text} ${detail}`));
  }
  showSettings(show) { this.el.settings.classList.toggle('hidden', !show); }
  showHelp(show) { this.el.help.classList.toggle('hidden', !show); }
  showInventory(show) { this.el.inventoryScreen.classList.toggle('hidden', !show); }
  showBuild(show) { this.el.buildMenu.classList.toggle('hidden', !show); }
  showMap(show) { this.el.mapScreen.classList.toggle('hidden', !show); }
  showChatInput(show) {
    this.el.chatInputWrap.classList.toggle('hidden', !show);
    if (show) this.el.chatInput.focus();
    else { this.el.chatInput.value = ''; this.el.chatInput.blur(); }
  }

  get anyOverlayOpen() {
    return [
      this.el.inventoryScreen, this.el.buildMenu, this.el.mapScreen,
      this.el.settings, this.el.help, this.el.death, this.el.disconnect,
    ].some((el) => !el.classList.contains('hidden'));
  }

  /** Switch between the item list and the recipe list in the backpack window. */
  setTab(name) {
    for (const btn of this.el.inventoryScreen.querySelectorAll('.tab')) {
      btn.classList.toggle('active', btn.dataset.tab === name);
    }
    this.el.inventoryScreen.querySelector('#tab-inv').classList.toggle('hidden', name !== 'inv');
    this.el.inventoryScreen.querySelector('#tab-craft').classList.toggle('hidden', name !== 'craft');
  }

  /* ---------------- in-game ---------------- */

  updateStats(you) {
    const set = (bar, num, value, max) => {
      bar.style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
      num.textContent = Math.round(value);
    };
    set(this.el.barHealth, this.el.numHealth, you.health, SURVIVAL.maxHealth);
    set(this.el.barStamina, this.el.numStamina, you.stamina, SURVIVAL.maxStamina);
    set(this.el.barHunger, this.el.numHunger, you.hunger, SURVIVAL.maxHunger);
    set(this.el.barThirst, this.el.numThirst, you.thirst, SURVIVAL.maxThirst);
    if (you.breath < SURVIVAL.maxBreath - 1) {
      this.el.breathRow.style.display = '';
      set(this.el.barBreath, this.el.numBreath, you.breath, SURVIVAL.maxBreath);
    } else {
      this.el.breathRow.style.display = 'none';
    }
  }

  updateClock(time01, day) {
    const totalMin = time01 * 24 * 60;
    const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
    const mm = String(Math.floor(totalMin % 60)).padStart(2, '0');
    const night = time01 > 0.75 || time01 < 0.22;
    this.el.clockIcon.textContent = night ? '🌙' : time01 < 0.3 || time01 > 0.7 ? '🌇' : '☀';
    this.el.clockText.textContent = `${t('day')} ${day} — ${hh}:${mm}`;
  }

  setDebug(text) {
    this.el.debug.textContent = text;
  }

  toggleDebug() { this.el.debug.classList.toggle('hidden'); }

  setHint(text) { this.el.hintText.textContent = text || ''; }
  setBuildHint(text) { this.el.buildHint.textContent = text || ''; }

  setVignette(v) { this.el.vignette.style.opacity = String(Math.max(0, Math.min(1, v))); }
  setUnderwater(v) { this.el.waterOverlay.style.opacity = String(Math.max(0, Math.min(1, v))); }

  hitMarker(on) {
    this.el.crosshair.classList.toggle('hit', !!on);
    if (on) setTimeout(() => this.el.crosshair.classList.remove('hit'), 120);
  }

  toast(text, kind = '') {
    const div = document.createElement('div');
    div.className = `toast ${kind}`;
    div.textContent = text;
    this.el.toasts.appendChild(div);
    setTimeout(() => div.remove(), 3400);
  }

  /** Floating "+3 wood" text at a world position, projected to the screen. */
  floatText(text, screenX, screenY) {
    const div = document.createElement('div');
    div.className = 'float';
    div.textContent = text;
    div.style.left = `${screenX}px`;
    div.style.top = `${screenY}px`;
    this.el.floating.appendChild(div);
    setTimeout(() => div.remove(), 1100);
  }

  addChat(who, text, self = false) {
    const div = document.createElement('div');
    div.innerHTML = `<span class="who">${escapeHtml(who)}${self ? '' : ''}:</span> ${escapeHtml(text)}`;
    this.el.chatLog.appendChild(div);
    while (this.el.chatLog.children.length > 8) this.el.chatLog.firstChild.remove();
    setTimeout(() => div.remove(), 45000);
  }

  /* ---------------- hotbar ---------------- */

  renderHotbar(inv, toolSlot) {
    const slots = inv.slice(0, 9);
    const sig = JSON.stringify([slots, toolSlot]);
    if (sig === this._hotbarSig) return;
    this._hotbarSig = sig;
    if (this.el.hotbar.children.length !== 9) {
      this.el.hotbar.innerHTML = '';
      for (let i = 0; i < 9; i++) {
        const div = document.createElement('div');
        div.className = 'slot empty';
        div.dataset.slot = String(i);   // makes the slot clickable (controls.js)
        div.innerHTML = `<span class="k">${i + 1}</span>`;
        this.el.hotbar.appendChild(div);
      }
    }
    slots.forEach((slot, i) => {
      const el = this.el.hotbar.children[i];
      el.dataset.slot = String(i);
      const def = slot ? ITEMS[slot.item] : null;
      el.className = `slot${i === toolSlot ? ' sel' : ''}${slot ? '' : ' empty'}`;
      const dur = slot && def?.durability && slot.dur !== undefined
        ? `<span class="dur"><i style="width:${Math.max(0, (slot.dur / def.durability) * 100)}%"></i></span>` : '';
      el.innerHTML = `<span class="k">${i + 1}</span>${def ? def.icon : ''}${slot && slot.n > 1 ? `<span class="n">${slot.n}</span>` : ''}${dur}`;
    });
  }

  /* ---------------- inventory ---------------- */

  renderInventory(inv, toolSlot, selected) {
    const sig = JSON.stringify([inv, toolSlot, selected]);
    if (sig === this._invSig) return;
    this._invSig = sig;
    this.el.invGrid.innerHTML = '';
    inv.forEach((slot, i) => {
      const cell = document.createElement('div');
      const def = slot ? ITEMS[slot.item] : null;
      cell.className = `cell${selected === i ? ' selected' : ''}${i === toolSlot ? ' selected' : ''}`;
      cell.dataset.slot = String(i);
      const dur = slot && def?.durability && slot.dur !== undefined
        ? `<span class="dur"><i style="width:${Math.max(0, (slot.dur / def.durability) * 100)}%"></i></span>` : '';
      cell.innerHTML = `${def ? def.icon : ''}${slot && slot.n > 1 ? `<span class="n">${slot.n}</span>` : ''}${dur}`;
      cell.title = slot ? `${itemName(def)}${slot.dur !== undefined ? ` (${Math.round(slot.dur)})` : ''}` : '';
      this.el.invGrid.appendChild(cell);
    });
  }

  setTooltip(text) { this.el.invTooltip.textContent = text || ''; }

  selectSlot(i) { this.selectedSlot = i; }

  /* ---------------- crafting ---------------- */

  renderRecipes(inv, hasStation, onCraft) {
    this._craftHandler = onCraft;
    const sig = JSON.stringify([inv, hasStation]);
    if (sig === this._recipeSig) return;
    this._recipeSig = sig;
    const count = (item) => inv.filter(Boolean).filter((s) => s.item === item).reduce((a, s) => a + s.n, 0);
    const byCat = {};
    for (const r of RECIPES) {
      (byCat[r.cat] ||= []).push(r);
    }
    const catNames = {
      sv: { tools: 'Verktyg', build: 'Byggdelar', food: 'Mat', resource: 'Resurser' },
      en: { tools: 'Tools', build: 'Building', food: 'Food', resource: 'Resources' },
    };
    const lang = getLang();
    this.el.recipeList.innerHTML = '';
    for (const [cat, list] of Object.entries(byCat)) {
      const h = document.createElement('div');
      h.className = 'cat';
      h.textContent = (catNames[lang] || catNames.sv)[cat] || cat;
      this.el.recipeList.appendChild(h);
      for (const r of list) {
        const outItem = Object.keys(r.out)[0];
        const def = ITEMS[outItem];
        const stationOk = !r.station || hasStation;
        const ok = stationOk && Object.entries(r.need).every(([item, n]) => count(item) >= n);
        const div = document.createElement('div');
        div.className = `recipe${ok ? '' : ' no'}`;
        const need = Object.entries(r.need)
          .map(([item, n]) => `<b>${count(item)}/${n}</b> ${itemName(ITEMS[item])}`)
          .join(' · ');
        div.innerHTML = `
          <span class="ico">${def.icon}</span>
          <span class="name">${itemName(def)}${r.station ? ` <span class="tag">${t('needStation')}</span>` : ''}</span>
          <span class="need">${need}</span>`;
        div.addEventListener('click', () => { if (ok) this._craftHandler?.(r.id); });
        this.el.recipeList.appendChild(div);
      }
    }
  }

  /* ---------------- building ---------------- */

  renderPieces(inv, selected, onSelect) {
    this._pieceHandler = onSelect;
    const sig = JSON.stringify([inv, selected]);
    if (sig === this._pieceSig) return;
    this._pieceSig = sig;
    const count = (item) => inv.filter(Boolean).filter((s) => s.item === item).reduce((a, s) => a + s.n, 0);
    this.el.pieceList.innerHTML = '';
    for (const [id, def] of Object.entries(PIECES)) {
      const r = RECIPES.find((rec) => rec.id === def.item);
      const need = r ? Object.entries(r.need).map(([item, n]) => `${count(item)}/${n} ${itemName(ITEMS[item])}`).join(' · ') : '';
      const div = document.createElement('div');
      const icons = { foundation: '⬛', wall: '🧱', door: '🚪', campfire: '🔥' };
      div.className = `piece${selected === id ? ' sel' : ''}`;
      div.innerHTML = `<span class="ico">${icons[id] || '🧱'}</span><span><div>${pieceName(def)}</div><span class="need">${need}</span></span>`;
      div.addEventListener('click', () => this._pieceHandler?.(id));
      this.el.pieceList.appendChild(div);
    }
  }

  /* ---------------- map ---------------- */

  drawMap(worldView, buildings, players, self) {
    const canvas = this.el.mapCanvas;
    const ctx = canvas.getContext('2d');
    if (!this._mapCache) {
      const off = document.createElement('canvas');
      off.width = canvas.width;
      off.height = canvas.height;
      const octx = off.getContext('2d');
      worldView.paintMap(octx, off.width, off.height, new Map(), new Map(), { id: '__none', x: 0, z: 0, yaw: 0 });
      this._mapCache = off;
    }
    ctx.drawImage(this._mapCache, 0, 0);
    // markers (re-drawn every frame so they move)
    const W = canvas.width;
    const toPx = (v) => ((v + WORLD.half) / WORLD.size) * W;
    ctx.fillStyle = '#f0a63c';
    for (const b of buildings.values()) {
      const px = toPx(b.cx * WORLD.grid);
      const pz = toPx(b.cz * WORLD.grid);
      ctx.fillRect(px - 2, pz - 2, 4, 4);
    }
    for (const p of players.values()) {
      if (p.id === self.id) continue;
      ctx.fillStyle = '#6ec1e4';
      ctx.beginPath();
      ctx.arc(toPx(p.x), toPx(p.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(toPx(self.x), toPx(self.z), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(toPx(self.x), toPx(self.z));
    ctx.lineTo(toPx(self.x) + Math.sin(self.yaw) * 14, toPx(self.z) + Math.cos(self.yaw) * 14);
    ctx.stroke();
    this.el.mapLegend.textContent = `${WORLD.size} × ${WORLD.size} m · ${buildings.size} byggdelar · ${players.size} spelare`;
  }

  /* ---------------- help & disclaimer ---------------- */

  renderHelp(lang) {
    const sv = `
      <p><kbd>W A S D</kbd> gå · <kbd>Skift</kbd> spring · <kbd>Mellanslag</kbd> hoppa · <kbd>Ctrl</kbd> smyg</p>
      <p><kbd>Vänsterklick</kbd> samla/slå · <kbd>Högerklick</kbd> ät/använd · <kbd>E</kbd> öppna dörr</p>
      <p><kbd>1</kbd>–<kbd>9</kbd> eller mushjul väljer verktyg · <kbd>R</kbd> reparera/rotera</p>
      <p><kbd>Tab</kbd> ryggsäck · <kbd>C</kbd> tillverka · <kbd>B</kbd> byggläge · <kbd>M</kbd> karta</p>
      <p><kbd>T</kbd> chatt · <kbd>Esc</kbd> inställningar · <kbd>F1</kbd> hjälp · <kbd>F3</kbd> felsökningsinfo</p>
      <p class="dim">Överlevnad: håll hunger och törst uppe, bygg lägereld före natten (kylan skadar),
      samla trä och sten → gör en stenyxa → bygg en grund och väggar. Dödade spelare tappar hälften av sina resurser.</p>`;
    const en = `
      <p><kbd>W A S D</kbd> walk · <kbd>Shift</kbd> sprint · <kbd>Space</kbd> jump · <kbd>Ctrl</kbd> crouch</p>
      <p><kbd>Left click</kbd> gather/hit · <kbd>Right click</kbd> eat/use · <kbd>E</kbd> open door</p>
      <p><kbd>1</kbd>–<kbd>9</kbd> or mouse wheel selects a tool · <kbd>R</kbd> repair/rotate</p>
      <p><kbd>Tab</kbd> backpack · <kbd>C</kbd> craft · <kbd>B</kbd> build mode · <kbd>M</kbd> map</p>
      <p><kbd>T</kbd> chat · <kbd>Esc</kbd> settings · <kbd>F1</kbd> help · <kbd>F3</kbd> debug</p>
      <p class="dim">Survival: keep hunger and thirst up, build a campfire before night (cold hurts),
      gather wood and stone → craft a stone axe → build a foundation and walls. Killed players drop half of their resources.</p>`;
    this.el.helpBody.innerHTML = lang === 'en' ? en : sv;
  }

  setDisclaimer(text) { this.el.disclaimer.textContent = text; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { TIME };
