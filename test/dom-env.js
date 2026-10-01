/**
 * Spell - shared jsdom environment for the client tests.
 *
 * Gives Node a browser-like DOM (loaded from the real client/index.html) plus
 * the smallest possible 2D-canvas stub, so the client's UI and scene-building
 * code can be executed without a GPU. WebGL itself is not emulated - that is
 * what `npm run verify:browser` is for.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** Minimal CanvasRenderingContext2D replacement (records nothing, never throws). */
function stub2dContext() {
  const image = () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
  return {
    canvas: null,
    fillStyle: '#000',
    strokeStyle: '#000',
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'top',
    lineWidth: 1,
    calls: { fillRect: 0, fillText: 0, arc: 0, moveTo: 0, lineTo: 0, stroke: 0, fill: 0 },
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData() { this.calls.putImageData = (this.calls.putImageData || 0) + 1; },
    drawImage() { this.calls.drawImage = (this.calls.drawImage || 0) + 1; },
    fillRect() { this.calls.fillRect++; },
    clearRect() {},
    fillText() { this.calls.fillText++; },
    beginPath() {},
    closePath() {},
    arc() { this.calls.arc++; },
    moveTo() { this.calls.moveTo++; },
    lineTo() { this.calls.lineTo++; },
    stroke() { this.calls.stroke++; },
    fill() { this.calls.fill++; },
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    measureText: (t) => ({ width: String(t).length * 6 }),
  };
}

export function createDom() {
  const html = fs.readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8080/', pretendToBeVisual: true });
  const { window } = dom;

  // 2D canvas stub (jsdom returns null without the optional `canvas` package)
  window.HTMLCanvasElement.prototype.getContext = function getContext(type) {
    if (type === '2d') {
      if (!this.__ctx) { this.__ctx = stub2dContext(); this.__ctx.canvas = this; }
      return this.__ctx;
    }
    return null;
  };
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';

  const define = (key, value) => {
    try { Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); }
    catch { /* already exists and is read-only; ignore */ }
  };
  define('window', window);
  define('document', window.document);
  define('navigator', window.navigator);
  define('localStorage', window.localStorage);
  define('requestAnimationFrame', window.requestAnimationFrame?.bind(window) ?? ((cb) => setTimeout(() => cb(performance.now()), 16)));
  define('cancelAnimationFrame', (id) => clearTimeout(id));
  define('HTMLElement', window.HTMLElement);
  define('HTMLCanvasElement', window.HTMLCanvasElement);
  define('ImageData', window.ImageData);
  define('getComputedStyle', window.getComputedStyle.bind(window));
  return dom;
}

export { stub2dContext };
