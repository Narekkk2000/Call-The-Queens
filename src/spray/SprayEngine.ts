import { ART, artUrl } from './art';

export type SprayConfig = {
  /**
   * Pins the spray cone to a fixed pixel radius. Leave undefined to let it
   * scale with the stage (the default) — see `radiusScale`.
   */
  radius?: number;
  /**
   * Multiplier on the automatically derived radius. 1 reproduces the tuning of
   * the original prototype on a 14" MacBook Pro; raise it to spray faster.
   */
  radiusScale: number;
  /** Fraction of the mural's ink that must be uncovered before the flood fires. */
  threshold: number;
  /** Whether heavy paint build-up sheds running drips. */
  drips: boolean;
  /** Whether the hiss/rattle audio graph is built at all. */
  sound: boolean;
  /** Multiplier on the auto-sized spray can. */
  canSize: number;
  /**
   * How long to hold on the finished mural, in ms, after the wall finishes
   * flooding and before the coming-soon screen takes over.
   */
  revealDelay: number;
};

export type SprayElements = {
  wrap: HTMLDivElement;
  paint: HTMLCanvasElement;
  glow: HTMLCanvasElement;
  mist: HTMLCanvasElement;
  floor: HTMLCanvasElement;
  grain: HTMLCanvasElement;
  can: HTMLDivElement;
  /** The sound/reset cluster — the can gets out of its way. */
  controls: HTMLDivElement;
};

export type SprayHost = {
  getConfig(): SprayConfig;
  isDone(): boolean;
  isMuted(): boolean;
  /** The wall finished flooding — reveal the end screen. */
  onComplete(): void;
  /** Coverage in 0..1, already normalised against the reveal threshold. */
  onProgress(value: number): void;
  /** Show or hide the "hold & drag to spray" hint. */
  onHintVisibleChange(visible: boolean): void;
};

type Drip = { x: number; y: number; r: number; v: number; age: number; life: number };

type FloorDrip = {
  x: number;
  px: number;
  y: number;
  py: number;
  v: number;
  w: number;
  col: string;
  stop: number;
  pool: number;
  maxPool: number;
  drift: number;
};

type MistPuff = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  life: number;
  h: string;
};

/** Wall/floor split — the bottom 15% of the stage is the concrete floor. */
const FLOOR_RATIO = 0.15;

/**
 * Spray radius is derived from the square root of the wall's area, which is the
 * only scaling that keeps the *effort* of revealing the wall constant.
 *
 * Covering a wall of area A with a stroke of width 2r takes a drag of roughly
 * `A / 2r`. Setting `r = k·√A` makes that `√A / 2k` — so the drag is a fixed
 * number of screen-widths on every display. Since pointer movement maps to a
 * fraction of the screen rather than to pixels, that reads as identical effort.
 *
 * `K` is calibrated so a 14" MacBook Pro (a 1512x860 browser viewport, giving a
 * 1512x731 wall) lands on the prototype's hand-tuned radius of 120px.
 */
const RADIUS_K = 120 / Math.sqrt(1512 * 731);

/**
 * √A alone still lets *aspect ratio* move the effort around: sweeping a wall
 * takes `wallH / 2r` screen-widths of drag, so a tall narrow phone costs far
 * more passes than a wide monitor. The reference viewport works out at ~3.05
 * screen-widths; hold every stage within a narrow band of that so extreme
 * shapes stay in the same ballpark without letting the cone balloon to a
 * comical fraction of a small screen.
 */
const MIN_SWEEPS = 2.6;
const MAX_SWEEPS = 3.6;
/** Sanity rails, not tuning — the formula is well behaved between them. */
const RADIUS_MIN = 32;
const RADIUS_MAX = 420;

/**
 * How far outside the sound/reset cluster the can starts getting out of the
 * way, in CSS pixels. The stage hides the system cursor, so without this the
 * can sits under the pointer and the buttons are awkward to aim at.
 */
const CONTROLS_MARGIN = 44;

/**
 * Edge of one density bucket, in CSS pixels, at the 120px reference radius.
 * Buckets decide where paint has pooled enough to start running, so the bucket
 * has to scale with the cone or drips thin out on large screens.
 */
const CELL_PER_RADIUS = 20 / 120;
/** Downsampled mural resolution used for both the ink map and coverage sampling. */
const SAMPLE_W = 108;
const SAMPLE_H = 54;
const TAU = 6.2832;

/**
 * Owns every canvas on the stage: the reveal mask, the mural composite, the
 * bloom pass, the aerosol mist, the concrete grain and the floor reflection.
 *
 * Deliberately framework-free — React mounts the DOM and owns `done`/`muted`/
 * `variant`, while this class runs the rAF loop and talks back through `host`.
 */
export class SprayEngine {
  private readonly els: SprayElements;
  private readonly host: SprayHost;

  // Offscreen buffers.
  private readonly mask = document.createElement('canvas');
  private readonly sample = document.createElement('canvas');
  private readonly fink = document.createElement('canvas');
  private readonly glowSmall = document.createElement('canvas');
  private readonly sctx: CanvasRenderingContext2D;

  // Live contexts, (re)created on every resize.
  private pctx: CanvasRenderingContext2D | null = null;
  private gctx: CanvasRenderingContext2D | null = null;
  private mctx: CanvasRenderingContext2D | null = null;
  private fctx: CanvasRenderingContext2D | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;
  private finkCtx: CanvasRenderingContext2D | null = null;
  private gsctx: CanvasRenderingContext2D | null = null;

  // Geometry.
  private W = 0;
  private H = 0;
  private wallH = 0;
  private floorH = 0;
  private dpr = 1;
  private canW = 150;
  private cols = 0;
  private rows = 0;
  private cell = 20;
  private mx = 0;
  private my = 0;
  private mw = 0;
  private mh = 0;
  private hasMask = false;

  // Art.
  private mural: HTMLImageElement | null = null;
  private ink: Uint8Array | null = null;
  /** Ink that currently falls inside the wall — the reveal denominator. */
  private reachable: Uint8Array | null = null;
  private reachableCount = 0;

  // Simulation.
  private dens = new Float32Array(0);
  private drips: Drip[] = [];
  private floorDrips: FloorDrip[] = [];
  private mist: MistPuff[] = [];
  private ptr = { x: 0, y: 0, down: false };
  private can = { x: 0, y: 0, rot: 10, tx: 0, ty: 0 };
  private lastStamp: { x: number; y: number } | null = null;
  private dirty = true;
  private engaged = false;
  private sprayed = false;
  private finishing = false;
  private floodT = 0;
  private coverage = 0;
  private hintHidden = false;
  /** True from the moment the wall is fully revealed until the hold expires. */
  private completing = false;
  private completeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Controls cluster in wrap-local coordinates, already padded. Null until measured. */
  private controlsBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private sizeCheck = 0;
  private nextRattle = 0;
  private errShown = false;

  // Loop handles.
  private raf: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private coverTimer: ReturnType<typeof setInterval> | null = null;
  private fallbackT: ReturnType<typeof setTimeout> | null = null;
  private rafFired = false;
  private destroyed = false;

  // Audio.
  private actx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private rattleBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  // Bound listeners, kept so they can be detached.
  private readonly onResize = () => this.resize();
  private readonly onPointerDown = (e: PointerEvent) => this.handleDown(e);
  private readonly onPointerMove = (e: PointerEvent) => this.handleMove(e);
  private readonly onPointerUp = () => this.handleUp();

  constructor(els: SprayElements, host: SprayHost) {
    this.els = els;
    this.host = host;

    this.sample.width = SAMPLE_W;
    this.sample.height = SAMPLE_H;
    this.sctx = this.sample.getContext('2d', { willReadFrequently: true })!;

    this.loadArt();
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.bindPointer();
    this.startLoop();
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelCompletionHold();
    this.stopLoop();
    this.unbindPointer();
    window.removeEventListener('resize', this.onResize);
    if (this.actx) {
      void this.actx.close().catch(() => {});
      this.actx = null;
      this.gain = null;
      this.rattleBus = null;
    }
  }

  // ---------------------------------------------------------------- public API

  /** Back to a blank wall: mask, drips, mist, meter and hint all reset. */
  clearWall(): void {
    this.cancelCompletionHold();
    const m = this.maskCtx;
    if (m) {
      m.save();
      m.setTransform(1, 0, 0, 1, 0, 0);
      m.clearRect(0, 0, this.mask.width, this.mask.height);
      m.restore();
    }
    this.drips = [];
    this.floorDrips = [];
    this.mist = [];
    if (this.finkCtx) {
      this.finkCtx.save();
      this.finkCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.finkCtx.clearRect(0, 0, this.fink.width, this.fink.height);
      this.finkCtx.restore();
    }
    if (this.cols) this.dens = new Float32Array(this.cols * this.rows);
    this.sprayed = false;
    this.finishing = false;
    this.floodT = 0;
    this.coverage = 0;
    this.dirty = true;
    this.host.onProgress(0);
    this.hintHidden = false;
    this.host.onHintVisibleChange(true);
  }

  /** Called by React after `done` or `muted` flips so the can and hiss follow. */
  syncState(): void {
    this.placeCan(0);
    this.setHiss(this.ptr.down && !this.host.isDone() ? 0.16 : 0);
  }

  // ------------------------------------------------------------------- pointer

  private bindPointer(): void {
    this.els.wrap.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  private unbindPointer(): void {
    this.els.wrap.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }

  private handleDown(e: PointerEvent): void {
    const target = e.target as Element | null;
    if (target?.closest('button, a')) return;
    this.engaged = true;
    this.setPtr(e);
    this.ptr.down = true;
    this.startAudio();
    if (this.actx?.state === 'suspended') void this.actx.resume().catch(() => {});
    this.hideHint();
    if (e.pointerId != null) {
      try {
        this.els.wrap.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    }
  }

  private handleMove(e: PointerEvent): void {
    this.engaged = true;
    this.setPtr(e);
    this.startAudio();
  }

  private handleUp(): void {
    this.ptr.down = false;
    this.setHiss(0);
  }

  private setPtr(e: PointerEvent): void {
    const r = this.els.wrap.getBoundingClientRect();
    this.ptr.x = e.clientX - r.left;
    this.ptr.y = e.clientY - r.top;
  }

  private hideHint(): void {
    if (this.hintHidden) return;
    this.hintHidden = true;
    this.host.onHintVisibleChange(false);
  }

  // --------------------------------------------------------------- completion

  /**
   * The wall has finished flooding. Hold on the completed mural for a beat
   * before handing over to the coming-soon screen — going straight there skips
   * past the payoff the visitor just worked for.
   */
  private beginCompletionHold(): void {
    if (this.completing) return;
    this.completing = true;
    this.completeTimer = setTimeout(() => {
      this.completeTimer = null;
      if (this.destroyed) return;
      this.host.onComplete();
    }, this.host.getConfig().revealDelay);
  }

  private cancelCompletionHold(): void {
    if (this.completeTimer) {
      clearTimeout(this.completeTimer);
      this.completeTimer = null;
    }
    this.completing = false;
  }

  // ---------------------------------------------------------------- proximity

  /** Caches the controls cluster in wrap-local space; it only moves on resize. */
  private measureControls(): void {
    const wrap = this.els.wrap.getBoundingClientRect();
    const box = this.els.controls.getBoundingClientRect();
    if (!box.width || !box.height) {
      this.controlsBox = null;
      return;
    }
    this.controlsBox = {
      x0: box.left - wrap.left - CONTROLS_MARGIN,
      y0: box.top - wrap.top - CONTROLS_MARGIN,
      x1: box.right - wrap.left + CONTROLS_MARGIN,
      y1: box.bottom - wrap.top + CONTROLS_MARGIN,
    };
  }

  /** True when the pointer is close enough to the buttons to want a real cursor. */
  private get nearControls(): boolean {
    const b = this.controlsBox;
    if (!b) return false;
    return this.ptr.x >= b.x0 && this.ptr.x <= b.x1 && this.ptr.y >= b.y0 && this.ptr.y <= b.y1;
  }

  // ------------------------------------------------------------------- radius

  /**
   * The spray cone for the current stage. Recomputed on read so a changed
   * `radiusScale` prop takes effect without waiting for a resize.
   */
  private get radius(): number {
    const c = this.host.getConfig();
    if (c.radius != null) return c.radius;
    const area = RADIUS_K * Math.sqrt(this.W * this.wallH);
    // Keep the implied number of sweeps inside the band above.
    const bounded = Math.max(
      this.wallH / (2 * MAX_SWEEPS),
      Math.min(this.wallH / (2 * MIN_SWEEPS), area),
    );
    return Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, bounded * c.radiusScale));
  }

  /** Density buckets are sized relative to the cone, not to fixed pixels. */
  private rebuildDensity(radius: number): void {
    this.cell = Math.max(8, Math.round(radius * CELL_PER_RADIUS));
    this.cols = Math.ceil(this.W / this.cell);
    this.rows = Math.ceil(this.wallH / this.cell);
    this.dens = new Float32Array(this.cols * this.rows);
  }

  // ---------------------------------------------------------------------- art

  private loadArt(): void {
    const img = new Image();
    img.src = artUrl(ART.src);
    this.mural = img;

    const apply = () => {
      // The mural can resolve after an unmount; geometry would be gone.
      if (this.destroyed) return;
      this.buildInkMap();
      if (this.W) this.resize();
      this.dirty = true;
    };
    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener('load', apply, { once: true });
  }

  /**
   * Reduces the mural to a 108x54 bitmask of "this pixel carries artwork".
   * Coverage is then a cheap count of mask pixels that overlap set ink bits,
   * so revealing empty background never advances the meter.
   */
  private buildInkMap(): void {
    if (!this.mural?.naturalWidth) return;
    const c = document.createElement('canvas');
    c.width = SAMPLE_W;
    c.height = SAMPLE_H;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(this.mural, 0, 0, SAMPLE_W, SAMPLE_H);
    const a = x.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;

    this.ink = new Uint8Array(SAMPLE_W * SAMPLE_H);
    for (let i = 0; i < SAMPLE_W * SAMPLE_H; i++) {
      const l = 0.2126 * a[i * 4] + 0.7152 * a[i * 4 + 1] + 0.0722 * a[i * 4 + 2];
      if (l > 46) this.ink[i] = 1;
    }
    this.markReachableInk();
  }

  /**
   * The mural is cover-fit, so a wide stage crops its top and bottom away.
   * Ink outside the wall can never be sprayed, and counting it would quietly
   * make wide screens demand a larger share of the *visible* artwork. Restrict
   * the denominator to what is actually on screen.
   */
  private markReachableInk(): void {
    if (!this.ink || !this.mw || !this.mh) {
      this.reachable = null;
      this.reachableCount = 0;
      return;
    }
    const reachable = new Uint8Array(SAMPLE_W * SAMPLE_H);
    let n = 0;
    for (let cy = 0; cy < SAMPLE_H; cy++) {
      const y = this.my + ((cy + 0.5) / SAMPLE_H) * this.mh;
      if (y < 0 || y >= this.wallH) continue;
      for (let cx = 0; cx < SAMPLE_W; cx++) {
        const i = cy * SAMPLE_W + cx;
        if (!this.ink[i]) continue;
        const x = this.mx + ((cx + 0.5) / SAMPLE_W) * this.mw;
        if (x < 0 || x >= this.W) continue;
        reachable[i] = 1;
        n++;
      }
    }
    this.reachable = reachable;
    this.reachableCount = n;
  }

  // ------------------------------------------------------------------ geometry

  private resize(): void {
    const r = this.els.wrap.getBoundingClientRect();
    this.W = Math.max(2, Math.round(r.width));
    this.H = Math.max(2, Math.round(r.height));
    // Floors of 1: mounting into a hidden or zero-size container would
    // otherwise round these to 0 and every drawImage of them would throw.
    this.floorH = Math.max(1, Math.round(this.H * FLOOR_RATIO));
    this.wallH = Math.max(1, this.H - this.floorH);
    this.dpr = Math.min(1.6, window.devicePixelRatio || 1);

    // Preserve the paint already on the wall across a viewport change.
    let keep: HTMLCanvasElement | null = null;
    if (this.hasMask && this.mask.width > 1) {
      keep = document.createElement('canvas');
      keep.width = this.mask.width;
      keep.height = this.mask.height;
      keep.getContext('2d')!.drawImage(this.mask, 0, 0);
    }

    const fit = (c: HTMLCanvasElement, w: number, h: number) => {
      c.width = Math.max(1, Math.round(w * this.dpr));
      c.height = Math.max(1, Math.round(h * this.dpr));
      const x = c.getContext('2d')!;
      x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      return x;
    };

    this.pctx = fit(this.els.paint, this.W, this.wallH);
    this.gctx = fit(this.els.glow, this.W, this.wallH);
    this.mctx = fit(this.els.mist, this.W, this.H);
    this.fctx = fit(this.els.floor, this.W, this.floorH);
    this.maskCtx = fit(this.mask, this.W, this.wallH);
    this.finkCtx = fit(this.fink, this.W, this.floorH);
    this.hasMask = true;

    if (keep) {
      this.maskCtx.save();
      this.maskCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.maskCtx.drawImage(keep, 0, 0, this.mask.width, this.mask.height);
      this.maskCtx.restore();
    }

    // The bloom pass runs at ~1/5 scale and is blurred back up — far cheaper
    // than blurring the full-resolution composite every frame.
    this.glowSmall.width = Math.max(2, Math.round(this.W * 0.22));
    this.glowSmall.height = Math.max(2, Math.round(this.wallH * 0.22));
    this.gsctx = this.glowSmall.getContext('2d');

    const aw = this.mural?.naturalWidth || 1920;
    const ah = this.mural?.naturalHeight || 1080;
    const s = Math.max(this.W / aw, this.wallH / ah); // cover-fit
    this.mw = aw * s;
    this.mh = ah * s;
    this.mx = (this.W - this.mw) / 2;
    this.my = (this.wallH - this.mh) / 2;

    this.canW = Math.max(84, Math.min(196, this.H * 0.215)) * this.host.getConfig().canSize;
    this.els.can.style.width = `${this.canW}px`;
    this.els.can.style.transformOrigin = `${0.465 * this.canW}px ${0.06 * this.canW}px`;

    // Depends on the mural placement above, so it has to follow it.
    this.markReachableInk();
    this.rebuildDensity(this.radius);

    this.grain();
    this.measureControls();
    if (!this.engaged) this.parkCan();
    this.dirty = true;
  }

  private parkCan(): void {
    const h = (this.canW || 150) * 2.12;
    this.can.x = this.W * 0.735;
    this.can.y = this.wallH - h + 18;
    this.can.tx = this.can.x;
    this.can.ty = this.can.y;
    this.can.rot = 0;
    this.placeCan(0);
  }

  private placeCan(shake: number): void {
    const done = this.host.isDone();
    // Yield to the system cursor over the buttons, otherwise they are hard to hit.
    const yielding = done || this.nearControls;
    const el = this.els.can;
    el.style.transition = `opacity ${done ? '.45s' : '.18s'} ease`;
    el.style.opacity = yielding ? '0' : '1';
    this.els.wrap.style.cursor = yielding ? 'auto' : 'none';
    const tx = this.can.x - 0.465 * this.canW + shake;
    const ty = this.can.y - 0.06 * this.canW;
    el.style.transform = `translate3d(${tx}px,${ty}px,0) rotate(${this.can.rot.toFixed(2)}deg)`;
  }

  /**
   * Bakes the concrete: four octaves of smoothed value noise, a fine tooth
   * layer and a scatter of stains. Redrawn only on resize, then composited
   * with `mix-blend-mode: overlay`.
   */
  private grain(): void {
    const c = this.els.grain;
    const w = Math.max(2, Math.round(this.W));
    const h = Math.max(2, Math.round(this.H));
    c.width = w;
    c.height = h;
    const x = c.getContext('2d')!;
    x.fillStyle = '#808080';
    x.fillRect(0, 0, w, h);

    const octaves: [number, number][] = [
      [6, 0.55],
      [14, 0.4],
      [34, 0.3],
      [90, 0.2],
    ];
    for (const [cells, amt] of octaves) {
      const cw = Math.max(2, Math.round(cells * (w / h)));
      const ch = cells;
      const n = document.createElement('canvas');
      n.width = cw;
      n.height = ch;
      const nx = n.getContext('2d')!;
      const d = nx.createImageData(cw, ch);
      const a = d.data;
      for (let i = 0; i < a.length; i += 4) {
        const v = 128 + (Math.random() * 2 - 1) * 118;
        a[i] = a[i + 1] = a[i + 2] = v;
        a[i + 3] = 255;
      }
      nx.putImageData(d, 0, 0);
      x.globalCompositeOperation = 'overlay';
      x.globalAlpha = amt;
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      x.drawImage(n, 0, 0, w, h);
    }

    // Fine tooth, with occasional bright specks of aggregate.
    x.globalCompositeOperation = 'overlay';
    x.globalAlpha = 0.5;
    const fw = Math.round(w / 2);
    const fh = Math.round(h / 2);
    const f = document.createElement('canvas');
    f.width = fw;
    f.height = fh;
    const fx = f.getContext('2d')!;
    const fd = fx.createImageData(fw, fh);
    const fa = fd.data;
    for (let i = 0; i < fa.length; i += 4) {
      const v = 128 + (Math.random() * 2 - 1) * 52 + (Math.random() < 0.004 ? 90 : 0);
      fa[i] = fa[i + 1] = fa[i + 2] = v;
      fa[i + 3] = 255;
    }
    fx.putImageData(fd, 0, 0);
    x.drawImage(f, 0, 0, w, h);

    x.globalAlpha = 1;
    for (let i = 0; i < 16; i++) {
      const bx = Math.random() * w;
      const by = Math.random() * h * 0.9;
      const br = 60 + Math.random() * 260;
      const g = x.createRadialGradient(bx, by, 0, bx, by, br);
      const dark = Math.random() < 0.62;
      g.addColorStop(0, dark ? 'rgba(46,46,52,.45)' : 'rgba(206,204,214,.24)');
      g.addColorStop(1, 'rgba(128,128,128,0)');
      x.fillStyle = g;
      x.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
  }

  // ------------------------------------------------------------------- reveal

  /**
   * Samples the mask against the ink map every ~420ms. Once enough of the
   * artwork is uncovered, `finishing` takes over and floods the rest.
   */
  private measure(): void {
    // `completing` matters: the mask is fully white during the hold, so without
    // it this would re-trip the threshold and restart the flood.
    if (!this.reachable || !this.maskCtx || this.finishing || this.completing) return;
    if (this.host.isDone()) return;
    this.sctx.clearRect(0, 0, SAMPLE_W, SAMPLE_H);
    this.sctx.drawImage(
      this.mask,
      this.mx * this.dpr,
      this.my * this.dpr,
      this.mw * this.dpr,
      this.mh * this.dpr,
      0,
      0,
      SAMPLE_W,
      SAMPLE_H,
    );
    const a = this.sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    let hit = 0;
    for (let i = 0; i < SAMPLE_W * SAMPLE_H; i++) {
      if (this.reachable[i] && a[i * 4 + 3] > 70) hit++;
    }
    this.coverage = this.reachableCount ? hit / this.reachableCount : 0;

    const threshold = this.host.getConfig().threshold;
    this.host.onProgress(Math.min(1, this.coverage / threshold));
    if (this.sprayed && this.coverage >= threshold) this.finishing = true;
  }

  // -------------------------------------------------------------------- paint

  /**
   * One aerosol stamp: a soft core gradient plus scattered droplets that thin
   * out toward the edge, and the odd stray fleck outside the cone.
   */
  private stamp(x: number, y: number, r: number, strength: number): void {
    const m = this.maskCtx;
    if (!m) return;

    m.save();
    const g = m.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${(0.15 * strength).toFixed(3)})`);
    g.addColorStop(0.5, `rgba(255,255,255,${(0.075 * strength).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    m.fillStyle = g;
    m.beginPath();
    m.arc(x, y, r, 0, TAU);
    m.fill();

    m.fillStyle = '#fff';
    const n = Math.round(30 * Math.min(2, Math.max(1, r / 54)));
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU;
      const t = Math.sqrt(Math.random()); // uniform over the disc
      const rr = r * t * 1.12;
      const px = x + Math.cos(ang) * rr;
      const py = y + Math.sin(ang) * rr;
      const sz = 0.4 + Math.random() * 1.9 * (1 - t * 0.55);
      m.globalAlpha = (0.08 + Math.random() * 0.5) * strength * (1 - t * 0.62);
      m.beginPath();
      m.arc(px, py, sz, 0, TAU);
      m.fill();
    }
    if (Math.random() < 0.28) {
      const ang = Math.random() * TAU;
      const rr = r * (1.15 + Math.random() * 0.7);
      m.globalAlpha = 0.22 + Math.random() * 0.3;
      m.beginPath();
      m.arc(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, 0.6 + Math.random() * 1.6, 0, TAU);
      m.fill();
    }
    m.restore();

    // Track paint build-up per cell; saturated cells start to run.
    const ci = Math.floor(x / this.cell);
    const ri = Math.floor(y / this.cell);
    if (ci >= 0 && ri >= 0 && ci < this.cols && ri < this.rows) {
      const k = ri * this.cols + ci;
      this.dens[k] += strength * 0.22;
      if (this.host.getConfig().drips && this.dens[k] > 2.1 && this.drips.length < 52 && Math.random() < 0.14) {
        this.dens[k] = 0.5;
        this.drips.push({
          x: x + (Math.random() * 12 - 6),
          y: y + r * 0.35,
          r: 1.5 + Math.random() * 2.4,
          v: 0.22 + Math.random() * 0.5,
          age: 0,
          life: 260 + Math.random() * 460,
        });
      }
    }
    this.dirty = true;
  }

  /** Interpolates stamps along the pointer's travel so fast drags stay solid. */
  private spray(): void {
    const nx = this.can.x;
    const ny = this.can.y;
    if (ny > this.wallH + 40) return;

    const radius = this.radius;
    // Catches a `radiusScale` change that arrived without a resize.
    if (this.cell !== Math.max(8, Math.round(radius * CELL_PER_RADIUS))) {
      this.rebuildDensity(radius);
    }
    const last = this.lastStamp;
    if (last) {
      const dx = nx - last.x;
      const dy = ny - last.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(2.6, radius * 0.14);
      const steps = Math.min(60, Math.floor(dist / step));
      // Sweeping quickly lays down less paint per unit distance.
      const speedFade = Math.min(1, 26 / (dist + 8));
      for (let i = 1; i <= steps; i++) {
        this.stamp(
          last.x + dx * (i / steps),
          last.y + dy * (i / steps),
          radius * (0.92 + Math.random() * 0.16),
          0.55 + 0.45 * speedFade,
        );
      }
      if (steps === 0) this.stamp(nx, ny, radius * (0.94 + Math.random() * 0.12), 1);
    } else {
      this.stamp(nx, ny, radius, 1);
    }
    this.lastStamp = { x: nx, y: ny };
    this.sprayed = true;

    const hues = ART.hues;
    for (let i = 0; i < (radius > 80 ? 13 : 9); i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 5.4;
      const sp = 0.4 + Math.random() * 2.6;
      this.mist.push({
        x: nx + (Math.random() - 0.5) * radius * 0.8,
        y: ny + (Math.random() - 0.5) * radius * 0.8,
        vx: Math.cos(ang) * sp * 0.5,
        vy: Math.sin(ang) * sp * 0.5 - 0.25,
        r: 2 + Math.random() * 12,
        a: 0.1 + Math.random() * 0.22,
        life: 1,
        h: hues[(Math.random() * hues.length) | 0],
      });
    }
    if (this.mist.length > 420) this.mist.splice(0, this.mist.length - 420);
  }

  // --------------------------------------------------------------------- loop

  private startLoop(): void {
    this.stopLoop();
    this.rafFired = false;
    const tick = (t: number) => {
      this.rafFired = true;
      this.raf = requestAnimationFrame(tick);
      this.run(t);
    };
    this.raf = requestAnimationFrame(tick);

    // Some embedded/background contexts never fire rAF — fall back to a timer
    // so the wall is never inert.
    this.fallbackT = setTimeout(() => {
      if (this.rafFired || this.destroyed) return;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
      this.timer = setInterval(() => this.run(performance.now()), 32);
    }, 500);

    this.coverTimer = setInterval(() => this.measure(), 420);
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.timer) clearInterval(this.timer);
    if (this.coverTimer) clearInterval(this.coverTimer);
    if (this.fallbackT) clearTimeout(this.fallbackT);
    this.raf = null;
    this.timer = null;
    this.coverTimer = null;
    this.fallbackT = null;
  }

  private run(t: number): void {
    if (this.destroyed) return;
    try {
      this.frame(t);
    } catch (e) {
      if (!this.errShown) {
        this.errShown = true;
        console.error('spray frame error', e);
      }
    }
  }

  private frame(now: number): void {
    if (!this.pctx || !this.mctx || !this.gctx || !this.maskCtx || !this.gsctx) {
      this.resize();
      return;
    }
    // Cheap poll for container resizes that don't fire a window resize event.
    if (++this.sizeCheck > 20) {
      this.sizeCheck = 0;
      const r = this.els.wrap.getBoundingClientRect();
      if (Math.abs(r.width - this.W) > 1 || Math.abs(r.height - this.H) > 1) this.resize();
    }

    const done = this.host.isDone();
    const W = this.W;
    const wallH = this.wallH;

    // The can chases the pointer with easing, and tilts into its own velocity.
    if (this.engaged) {
      this.can.tx = this.ptr.x;
      this.can.ty = this.ptr.y;
    }
    const ease = this.engaged ? 0.34 : 0.06;
    const px = this.can.x;
    const py = this.can.y;
    this.can.x += (this.can.tx - this.can.x) * ease;
    this.can.y += (this.can.ty - this.can.y) * ease;
    const vx = this.can.x - px;
    const vy = this.can.y - py;
    const targetRot = Math.max(-26, Math.min(26, vx * 1.5)) + (this.engaged ? 9 : 0);
    this.can.rot += (targetRot - this.can.rot) * 0.16;

    // Moving the can without spraying shakes the ball bearing.
    const speed = Math.hypot(vx, vy);
    if (!this.ptr.down && this.engaged && !done && !this.finishing && speed > 2.2) {
      if (now > this.nextRattle) {
        const hard = Math.min(1, speed / 24);
        this.rattle(hard);
        this.nextRattle = now + 34 + Math.random() * 90 - hard * 55;
      }
    }

    this.placeCan(this.ptr.down ? Math.sin(now / 22) * 1.6 : 0);

    // Only spray once the can has caught up with the cursor, and never while
    // reaching for the buttons or during the hold on the finished mural.
    const settled = Math.hypot(this.can.x - this.ptr.x, this.can.y - this.ptr.y) < 70;
    const near = this.nearControls;
    if (this.ptr.down && settled && !done && !this.finishing && !this.completing && !near) {
      this.spray();
      this.setHiss(0.16);
    } else {
      this.lastStamp = null;
      if (!this.ptr.down || near || this.completing) this.setHiss(0);
    }

    if (this.finishing) {
      this.floodT += 0.016;
      this.maskCtx.fillStyle = 'rgba(255,255,255,0.055)';
      this.maskCtx.fillRect(0, 0, W, wallH);
      this.dirty = true;
      if (this.floodT >= 1) {
        this.maskCtx.fillStyle = '#fff';
        this.maskCtx.fillRect(0, 0, W, wallH);
        this.finishing = false;
        this.floodT = 0;
        this.setHiss(0);
        this.host.onProgress(1);
        this.beginCompletionHold();
      }
    }

    this.stepDrips(wallH);
    this.stepFloorDrips();

    if (this.dirty) {
      this.compose(W, wallH);
      this.dirty = false;
    }

    this.els.glow.style.opacity = done ? (0.62 + Math.sin(now / 900) * 0.16).toFixed(3) : '0.5';
    this.drawMist(done);
  }

  /** Advances wall drips, painting them straight into the reveal mask. */
  private stepDrips(wallH: number): void {
    const m = this.maskCtx;
    if (!m) return;
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      d.age++;
      d.v = Math.min(3.4, d.v * 1.016);
      d.y += d.v;
      d.x += Math.sin(d.y * 0.045) * 0.22;
      const k = 1 - d.age / d.life;

      m.save();
      m.fillStyle = '#fff';
      m.globalAlpha = 0.5;
      m.beginPath();
      m.arc(d.x, d.y, Math.max(0.4, d.r * (0.35 + k * 0.65)), 0, TAU);
      m.fill();
      if (Math.random() < 0.06) {
        m.globalAlpha = 0.4;
        m.beginPath();
        m.arc(d.x, d.y, d.r * 1.5, 0, TAU);
        m.fill();
      }
      m.restore();
      this.dirty = true;

      if (d.y > wallH - 1) {
        this.spawnFloorDrip(d.x, d.r);
        this.drips.splice(i, 1);
      } else if (d.age > d.life) {
        this.drips.splice(i, 1);
      }
    }
  }

  /** Reads the mural colour at the foot of the wall so drips match the art. */
  private paintColorAt(x: number): string {
    const fallback = ART.splat;
    if (!this.pctx) return fallback;
    try {
      const px = Math.max(0, Math.min(this.els.paint.width - 1, Math.round(x * this.dpr)));
      const py = Math.max(0, Math.round((this.wallH - 5) * this.dpr));
      const d = this.pctx.getImageData(px, py, 1, 1).data;
      if (d[3] > 24 && d[0] + d[1] + d[2] > 40) return `${d[0]},${d[1]},${d[2]}`;
    } catch {
      /* tainted or zero-sized canvas — fall through */
    }
    return fallback;
  }

  private spawnFloorDrip(x: number, w: number): void {
    if (this.floorDrips.length > 54) return;
    const H = this.floorH || 1;
    this.floorDrips.push({
      x,
      px: x,
      y: 1,
      py: 1,
      v: 0.5 + Math.random() * 0.8,
      w: Math.max(1.1, (w || 2) * 0.85),
      col: this.paintColorAt(x),
      stop: H * (0.16 + Math.random() * 0.34),
      pool: 0,
      maxPool: 3.5 + Math.random() * 9,
      drift: (Math.random() - 0.5) * 0.32,
    });
    this.dirty = true;
  }

  /** Runs a drip down the floor, then lets it spread into a flattened pool. */
  private stepFloorDrips(): void {
    const f = this.finkCtx;
    if (!f || !this.floorDrips.length) return;
    const H = this.floorH;

    for (let i = this.floorDrips.length - 1; i >= 0; i--) {
      const d = this.floorDrips[i];
      if (d.y < d.stop) {
        d.py = d.y;
        d.px = d.x;
        d.y += d.v;
        d.x += d.drift;
        d.v *= 0.976;
        // Widen as it travels "toward" the viewer.
        const persp = 1 + (d.y / H) * 1.9;
        f.save();
        f.strokeStyle = `rgba(${d.col},0.5)`;
        f.lineWidth = d.w * persp;
        f.lineCap = 'round';
        f.beginPath();
        f.moveTo(d.px, d.py);
        f.lineTo(d.x, d.y);
        f.stroke();
        f.restore();
      } else {
        d.pool += 0.14;
        const r = Math.min(d.maxPool, d.pool);
        f.save();
        f.translate(d.x, d.y);
        f.scale(1, 0.4);
        f.translate(-d.x, -d.y);
        const rg = f.createRadialGradient(d.x, d.y, 0, d.x, d.y, r);
        rg.addColorStop(0, `rgba(${d.col},0.34)`);
        rg.addColorStop(0.7, `rgba(${d.col},0.16)`);
        rg.addColorStop(1, `rgba(${d.col},0)`);
        f.fillStyle = rg;
        f.beginPath();
        f.arc(d.x, d.y, r, 0, TAU);
        f.fill();
        f.restore();
        if (d.pool >= d.maxPool) this.floorDrips.splice(i, 1);
      }
      this.dirty = true;
    }
  }

  /** Masks the mural through the sprayed area, then rebuilds bloom and floor. */
  private compose(W: number, wallH: number): void {
    const p = this.pctx!;
    p.save();
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.clearRect(0, 0, this.els.paint.width, this.els.paint.height);
    p.restore();
    p.drawImage(this.mask, 0, 0, W, wallH);
    if (this.mural?.complete && this.mural.naturalWidth) {
      p.globalCompositeOperation = 'source-in';
      p.drawImage(this.mural, this.mx, this.my, this.mw, this.mh);
      p.globalCompositeOperation = 'source-over';
    }

    const gs = this.gsctx!;
    gs.clearRect(0, 0, this.glowSmall.width, this.glowSmall.height);
    gs.drawImage(this.els.paint, 0, 0, this.glowSmall.width, this.glowSmall.height);

    const g = this.gctx!;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.els.glow.width, this.els.glow.height);
    g.restore();
    g.filter = 'blur(9px)';
    g.drawImage(this.glowSmall, 0, 0, W, wallH);
    g.filter = 'none';

    this.drawFloor();
  }

  /** Mirrored, blurred reflection of the wall, fading out toward the viewer. */
  private drawFloor(): void {
    const f = this.fctx;
    if (!f) return;
    const H = this.floorH;
    const W = this.W;

    f.save();
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, this.els.floor.width, this.els.floor.height);
    f.restore();

    const src = this.els.paint;
    const sh = Math.min(src.height, H * 1.6 * this.dpr);
    f.save();
    f.globalAlpha = 0.34;
    f.filter = 'blur(3px)';
    f.translate(0, H);
    f.scale(1, -1);
    f.drawImage(src, 0, src.height - sh, src.width, sh, 0, 0, W, H);
    f.restore();

    f.save();
    f.globalCompositeOperation = 'destination-in';
    const gr = f.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(0,0,0,.8)');
    gr.addColorStop(0.5, 'rgba(0,0,0,.2)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = gr;
    f.fillRect(0, 0, W, H);
    f.restore();

    f.drawImage(this.fink, 0, 0, W, H);
  }

  /** Aerosol overcast plus the coloured cone around the nozzle while spraying. */
  private drawMist(done: boolean): void {
    const m = this.mctx!;
    m.save();
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, this.els.mist.width, this.els.mist.height);
    m.restore();

    for (let i = this.mist.length - 1; i >= 0; i--) {
      const q = this.mist[i];
      q.x += q.vx;
      q.y += q.vy;
      q.vy -= 0.012; // buoyancy
      q.vx *= 0.985;
      q.vy *= 0.985;
      q.r += 0.42;
      q.life -= 0.022;
      if (q.life <= 0) {
        this.mist.splice(i, 1);
        continue;
      }
      const rg = m.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r);
      rg.addColorStop(0, `rgba(${q.h},${(q.a * q.life).toFixed(3)})`);
      rg.addColorStop(1, `rgba(${q.h},0)`);
      m.fillStyle = rg;
      m.beginPath();
      m.arc(q.x, q.y, q.r, 0, TAU);
      m.fill();
    }

    if (this.ptr.down && !done) {
      const r = this.radius * 2.2;
      const hues = ART.hues;
      const rg = m.createRadialGradient(this.can.x, this.can.y, 0, this.can.x, this.can.y, r);
      rg.addColorStop(0, `rgba(${hues[0]},0.20)`);
      rg.addColorStop(0.4, `rgba(${hues[1] || hues[0]},0.08)`);
      rg.addColorStop(1, `rgba(${hues[1] || hues[0]},0)`);
      m.fillStyle = rg;
      m.beginPath();
      m.arc(this.can.x, this.can.y, r, 0, TAU);
      m.fill();
    }
  }

  // -------------------------------------------------------------------- audio

  /** Lazily builds the hiss graph on first interaction (autoplay policy). */
  private startAudio(): void {
    if (this.actx || !this.host.getConfig().sound) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      const actx = new AC();
      const sr = actx.sampleRate;
      const len = sr * 2;
      const buf = actx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      const src = actx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = actx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3400;
      bp.Q.value = 0.55;
      const hp = actx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const gain = actx.createGain();
      gain.gain.value = 0;
      src.connect(bp);
      bp.connect(hp);
      hp.connect(gain);
      gain.connect(actx.destination);
      src.start();

      const rattleBus = actx.createGain();
      rattleBus.gain.value = 0.9;
      rattleBus.connect(actx.destination);

      this.actx = actx;
      this.gain = gain;
      this.noiseBuf = buf;
      this.rattleBus = rattleBus;
    } catch {
      this.actx = null;
    }
  }

  /** Ball-bearing rattle: a short filtered noise burst with a fast decay. */
  private rattle(hard: number): void {
    if (!this.actx || !this.noiseBuf || !this.rattleBus) return;
    if (this.host.isMuted() || !this.host.getConfig().sound) return;
    if (this.actx.state === 'suspended') {
      void this.actx.resume().catch(() => {});
      return;
    }
    try {
      const t = this.actx.currentTime;
      const src = this.actx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.playbackRate.value = 0.85 + Math.random() * 0.5;
      const bp = this.actx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500 + Math.random() * 2600;
      bp.Q.value = 3.2 + Math.random() * 3;
      const hp = this.actx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 700;
      const g = this.actx.createGain();
      const peak = (0.05 + hard * 0.16) * (0.7 + Math.random() * 0.6);
      const dur = 0.045 + Math.random() * 0.055;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp);
      bp.connect(hp);
      hp.connect(g);
      g.connect(this.rattleBus);
      src.start(t + Math.random() * 0.008, Math.random() * 1.5, dur + 0.02);
      src.stop(t + dur + 0.05);
    } catch {
      /* the graph can be torn down mid-schedule */
    }
  }

  private setHiss(v: number): void {
    if (!this.gain || !this.actx) return;
    this.gain.gain.setTargetAtTime(this.host.isMuted() ? 0 : v, this.actx.currentTime, 0.04);
  }
}
