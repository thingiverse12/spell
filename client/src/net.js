/**
 * Spell - browser networking layer.
 *
 * Uses the SAME shared modules as the server (config, noise, physics,
 * prediction), which is what keeps prediction and authority in lockstep:
 *
 *   input  -> predict locally (instant feedback) -> send to server
 *   snap   -> reconcile (rewind + replay unacked inputs) -> render
 *
 * Transport is a WebSocket (the browser cannot open raw UDP/TCP sockets - see
 * the report's platform notes). Everything is plain JSON; the protocol is
 * small and interest-managed, so bandwidth stays in the kilobytes/second range.
 */

import { NET } from '../../shared/config.js';
import { LocalWorld, Predictor, createPlayerState, Interpolator, NetStats } from '../../shared/prediction.js';

export class Net {
  constructor({ playerId, name, handlers = {} }) {
    this.playerId = playerId;
    this.name = name;
    this.handlers = handlers;
    this.ws = null;
    this.connected = false;
    this.ready = false;
    this.pending = new Map();
    this.rid = 1;

    this.localWorld = null;
    this.predictor = null;
    this.you = null;
    this.interp = new Interpolator();
    this.stats = new NetStats();
    this.serverTime01 = 0.28;
    this.day = 1;
    this.players = new Map();
    this.buildings = new Map();
    this.nodes = new Map();
    this.events = [];
    this.lastSnapAt = 0;
    this.timeOffset = 0;
    this.reconnectAttempts = 0;
  }

  get url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  /**
   * Opens the socket and performs the handshake.
   *
   * Rejections carry `{ code, reason, url }` so the caller can tell the cases
   * apart: server unreachable, upgrade blocked by a proxy, or "this player is
   * already connected" (which happens when the same browser opens a second tab).
   */
  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.lastClose = null;
      const fail = (code, reason) => {
        if (settled) return;
        settled = true;
        const err = new Error(reason || `WebSocket ${code}`);
        err.code = code;
        err.reason = reason;
        err.url = this.url;
        reject(err);
      };
      try {
        this.ws = new WebSocket(this.url);
      } catch (err) {
        err.url = this.url;
        reject(err);
        return;
      }
      this.ws.onopen = () => {
        this.connected = true;
        this.ws.send(JSON.stringify({ t: 'hello', playerId: this.playerId, name: this.name }));
        this._handshakeTimer = setTimeout(() => fail(408, 'handshake timeout'), 8000);
      };
      this.ws.onmessage = (ev) => this._onMessage(ev.data);
      this.ws.onclose = (ev) => {
        this.connected = false;
        this.ready = false;
        clearTimeout(this._handshakeTimer);
        this.lastClose = { code: ev.code, reason: ev.reason };
        if (!settled) fail(ev.code || 1006, ev.reason || 'closed before welcome');
        else this.handlers.onClose?.(ev.code, ev.reason);
      };
      this.ws.onerror = () => fail(this.ws?.readyState === 3 ? 1006 : 1006, 'WebSocket error');
      this._resolveHandshake = () => {
        clearTimeout(this._handshakeTimer);
        if (!settled) { settled = true; resolve(this); }
      };
    });
  }

  disconnect() {
    try { this.ws?.close(1000, 'client'); } catch { /* ignore */ }
  }

  get closed() {
    return !this.ws || this.ws.readyState === 3;
  }

  /* ------------------------------------------------------------ *
   *  Outgoing
   * ------------------------------------------------------------ */

  sendInput(input) {
    if (!this.ready || !this.predictor) return;
    const full = { ...input, seq: ++this.predictor.seq, dt: input.dt || 1 / NET.inputRate };
    this.predictor.applyInput(full);
    if (this.ws.readyState === 1) {
      const payload = JSON.stringify({
        t: 'input',
        seq: full.seq, dt: full.dt, yaw: full.yaw, pitch: full.pitch,
        wish: full.wish, strafe: full.strafe, jump: full.jump, sprint: full.sprint, crouch: full.crouch,
      });
      this.ws.send(payload);
      this.stats.addBytes(0, payload.length);
    }
  }

  action(a, payload = {}) {
    if (!this.connected) return Promise.resolve({ ok: false, error: 'offline' });
    const rid = this.rid++;
    return new Promise((resolve) => {
      this.pending.set(rid, resolve);
      this.ws.send(JSON.stringify({ t: 'action', a, rid, ...payload }));
      setTimeout(() => {
        if (this.pending.has(rid)) { this.pending.delete(rid); resolve({ ok: false, error: 'timeout' }); }
      }, 3000);
    });
  }

  chat(text) {
    if (this.connected && text.trim()) this.ws.send(JSON.stringify({ t: 'chat', text }));
  }

  ping() {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ t: 'ping', id: this.rid++, at: performance.now() }));
  }

  /* ------------------------------------------------------------ *
   *  Incoming
   * ------------------------------------------------------------ */

  _onMessage(raw) {
    this.stats.addBytes(raw.length, 0);
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.t) {
      case 'welcome': {
        this.welcome = msg;
        this.localWorld = new LocalWorld(msg.seed);
        this.you = createPlayerState(msg.you, msg.id);
        this.you.inv = msg.you.inv;
        this.you.toolSlot = msg.you.toolSlot ?? 0;
        this.predictor = new Predictor(this.localWorld, this.you);
        this.serverTime01 = msg.time01;
        this.day = msg.day;
        this.timeOffset = performance.now();
        this.ready = true;
        clearTimeout(this._handshakeTimer);
        this.handlers.onWelcome?.(msg);
        this._resolveHandshake?.();
        break;
      }

      case 'snap': {
        this.lastSnapAt = performance.now();
        this.serverTime01 = msg.time01;
        this.day = msg.day;

        // ---- static entities -> maps + prediction collider
        for (const n of msg.nodes) {
          const node = { id: n[0], x: n[1], y: n[2], z: n[3], type: n[4], rot: n[5], scale: n[6] };
          this.nodes.set(node.id, node);
          this.handlers.onNode?.(node);
        }
        for (const id of msg.nrem) { this.nodes.delete(id); this.handlers.onNodeRemove?.(id); }

        for (const b of msg.buildings) {
          const building = { id: b[0], piece: b[1], cx: b[2], cz: b[3], rot: b[4], y: b[5], hp: b[6], open: !!b[7], ownerName: b[8] };
          this.buildings.set(building.id, building);
          this.localWorld.addBuilding(building);
          this.handlers.onBuilding?.(building);
        }
        for (const id of msg.brem) {
          this.buildings.delete(id);
          this.localWorld.removeBuilding(id);
          this.handlers.onBuildingRemove?.(id);
        }

        // ---- remote entities
        const players = new Map();
        for (const p of msg.players) {
          const obj = {
            id: p[0], name: p[1], x: p[2], y: p[3], z: p[4], yaw: p[5], pitch: p[6],
            crouch: !!p[7], health: p[8], inWater: !!p[9], item: p[10], color: p[11] || null,
          };
          if (obj.id !== msg.you.id) players.set(obj.id, obj);
        }
        players.set(msg.you.id, { id: msg.you.id, name: this.name, x: msg.you.x, y: msg.you.y, z: msg.you.z, yaw: msg.you.yaw });
        this.players = players;

        const animals = new Map();
        for (const a of msg.animals) {
          animals.set(a[0], { id: a[0], type: a[1], x: a[2], y: a[3], z: a[4], yaw: a[5], hp: a[6] });
          this.handlers.onAnimal?.(animals.get(a[0]));
        }
        this.interp.push(performance.now(), players, animals);

        // ---- reconcile our own player
        this.predictor.reconcile(msg.you, msg.you.seq);
        this.you.dead = !!msg.you.dead;
        this.you.kills = msg.you.kills;
        this.you.deaths = msg.you.deaths;
        this.you.killsAnimal = msg.you.killsAnimal;

        for (const ev of msg.ev || []) this.handlers.onEvent?.(ev);
        this.handlers.onSnapshot?.(msg);
        break;
      }

      case 'res': {
        const resolve = this.pending.get(msg.r);
        if (resolve) { this.pending.delete(msg.r); resolve(msg); }
        this.handlers.onResult?.(msg);
        break;
      }

      case 'ev': {
        if (msg.e === 'chat') this.handlers.onChat?.(msg);
        else this.handlers.onEvent?.(msg);
        break;
      }

      case 'pong': {
        this.stats.addPing(performance.now() - msg.at);
        this.handlers.onPong?.(msg);
        break;
      }

      default: break;
    }
  }

  /** Locally extrapolated world clock (0..1) between snapshots. */
  get time01() {
    if (!this.ready) return this.serverTime01;
    const elapsed = (performance.now() - this.lastSnapAt) / 1000;
    const t = this.serverTime01 + elapsed / 600;
    return t % 1;
  }
}
