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
  /**
   * Milliseconds of flight time between paint leaving the nozzle and landing
   * on the wall, so the aerosol is visibly in the air first.
   *
   * The perceived lag is `drag speed x delay`, so this trades directly against
   * responsiveness: at a typical 500px/s drag, 150ms puts the paint ~75px
   * behind the can — around half a spray radius, which reads as travel. Past
   * ~300ms it stops reading as physics and starts reading as input lag.
   */
  sprayDelay: number;
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
  /** The can-design tabs, which need a real cursor for the same reason. */
  canTabs: HTMLDivElement;
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

/** Paint in flight: emitted at the nozzle, lands once `due` has passed. */
type PaintPacket = { x: number; y: number; r: number; strength: number; due: number };

/**
 * A drop of paint thrown off the cone. Not a puff of smoke: it leaves the
 * nozzle fast, falls, and keeps its size instead of billowing out.
 */
type Droplet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  life: number;
  /** Life lost per frame — heavy drops hang around, fine ones flash past. */
  decay: number;
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
/**
 * On a portrait phone the wall is tall and narrow, so an area-derived cone ends
 * up enormous relative to the screen — nearly half its width. Cap the radius
 * against width so the spray stays visually proportional. This deliberately
 * wins over the sweep band above: on a phone, looking right beats matching
 * desktop effort exactly. Only ever binds on narrow stages.
 */
const RADIUS_MAX_WIDTH_FRACTION = 0.18;
/** Sanity rails, not tuning — the formula is well behaved between them. */
const RADIUS_MIN = 32;
const RADIUS_MAX = 420;

/**
 * How far outside the sound/reset cluster the can starts getting out of the
 * way, in CSS pixels. The stage hides the system cursor, so without this the
 * can sits under the pointer and the buttons are awkward to aim at.
 */
const CONTROLS_MARGIN = 44;

/** Body length below the nozzle, as a multiple of the can's width. */
const CAN_BODY_LENGTH = 2.06;
/** Clearance kept between the foot of the can and the bottom of the stage. */
const CAN_EDGE_GAP = 8;
/** Never tilt past this; beyond it the can reads as lying down rather than angled. */
const CAN_MAX_TILT = 74;

/**
 * Edge of one density bucket, in CSS pixels, at the 120px reference radius.
 * Buckets decide where paint has pooled enough to start running, so the bucket
 * has to scale with the cone or drips thin out on large screens.
 */
const CELL_PER_RADIUS = 20 / 120;
/**
 * Pull on airborne paint, in px/frame². Smoke rises; paint falls, and this is
 * the single value that decides which one the spray reads as.
 */
const DROPLET_GRAVITY = 0.08;
/**
 * Least of the mural's width that may ever be on screen. A plain cover fit is
 * driven by the short axis, so on a portrait phone it showed only ~27% of the
 * piece and cut both ends off the skate. The skate spans about half the image,
 * so hold that much — the shortfall in height is taken up by the edge rows in
 * `compose`, not by bars.
 */
const MIN_MURAL_WIDTH_VISIBLE = 0.5;

/** Downsampled mural resolution used for both the ink map and coverage sampling. */
const SAMPLE_W = 108;
const SAMPLE_H = 54;
const TAU = 6.2832;

/**
 * Owns every canvas on the stage: the reveal mask, the mural composite, the
 * bloom pass, the airborne paint, the concrete grain and the floor reflection.
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
  /** Low-res, saturation-boosted mural — the wet colour a fresh pass lays down. */
  private readonly muralSoft = document.createElement('canvas');
  /** Sharp mural masked by coverage squared, so detail only resolves in thick paint. */
  private readonly detail = document.createElement('canvas');
  private detailCtx: CanvasRenderingContext2D | null = null;
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
  private droplets: Droplet[] = [];
  private pending: PaintPacket[] = [];
  private ptr = { x: 0, y: 0, down: false };
  /** Can travel this frame, in px — the jet lags behind it. */
  private canVx = 0;
  private canVy = 0;
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
  /** Control clusters in wrap-local coordinates, already padded. Empty until measured. */
  private controlsBoxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
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
    this.droplets = [];
    this.pending = [];
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

  /**
   * Caches each control cluster in wrap-local space; they only move on resize.
   * Clusters are kept apart rather than merged into one box: they sit at
   * opposite ends of the bottom edge, and their union would swallow the whole
   * strip between them.
   */
  private measureControls(): void {
    const wrap = this.els.wrap.getBoundingClientRect();
    this.controlsBoxes = [this.els.controls, this.els.canTabs]
      .map((el) => el.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0)
      .map((box) => ({
        x0: box.left - wrap.left - CONTROLS_MARGIN,
        y0: box.top - wrap.top - CONTROLS_MARGIN,
        x1: box.right - wrap.left + CONTROLS_MARGIN,
        y1: box.bottom - wrap.top + CONTROLS_MARGIN,
      }));
  }

  /** True when the pointer is close enough to the buttons to want a real cursor. */
  private get nearControls(): boolean {
    return this.controlsBoxes.some(
      (b) => this.ptr.x >= b.x0 && this.ptr.x <= b.x1 && this.ptr.y >= b.y0 && this.ptr.y <= b.y1,
    );
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
    const capped = Math.min(bounded, this.W * RADIUS_MAX_WIDTH_FRACTION);
    return Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, capped * c.radiusScale));
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
    this.buildSoftMural();
  }

  /**
   * A tiny, saturation-boosted copy of the mural. Drawn back at full size with
   * smoothing it becomes a soft colour field — the wet pigment a pass leaves
   * behind, before the artwork itself resolves out of it.
   */
  private buildSoftMural(): void {
    if (!this.mural?.naturalWidth) return;
    const w = 132;
    const h = Math.max(1, Math.round((w * this.mural.naturalHeight) / this.mural.naturalWidth));
    this.muralSoft.width = w;
    this.muralSoft.height = h;
    const x = this.muralSoft.getContext('2d')!;
    x.clearRect(0, 0, w, h);
    // Fresh paint is more saturated than the dried artwork it becomes.
    x.filter = 'saturate(1.5)';
    x.drawImage(this.mural, 0, 0, w, h);
    x.filter = 'none';
  }

  /**
   * The mural is still cropped on stages far from its own aspect, so ink can
   * sit outside the wall where it can never be sprayed. Counting it would
   * quietly make those stages demand a larger share of the *visible* artwork.
   * Restrict the denominator to what is actually on screen.
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
    this.detailCtx = fit(this.detail, this.W, this.wallH);
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
    // Cover fit, but never cropped so hard that the subject is lost: on a
    // portrait stage the height drives the scale and the piece gets squeezed
    // out sideways, so back the scale off until enough of its width is on
    // screen. Landscape stages are unaffected — the cap never binds there.
    const cover = Math.max(this.W / aw, this.wallH / ah);
    const s = Math.min(cover, this.W / (MIN_MURAL_WIDTH_VISIBLE * aw));
    this.mw = aw * s;
    this.mh = ah * s;
    this.mx = (this.W - this.mw) / 2;
    this.my = (this.wallH - this.mh) / 2;

    // Bounded by width as well as height: sizing off height alone made the can
    // ~40% of the screen on a portrait phone.
    const canFit = Math.min(this.H * 0.215, this.W * 0.24);
    this.canW = Math.max(84, Math.min(196, canFit)) * this.host.getConfig().canSize;
    this.els.can.style.width = `${this.canW}px`;
    this.els.can.style.transformOrigin = `${0.465 * this.canW}px ${0.06 * this.canW}px`;

    // Depends on the mural placement above, so it has to follow it.
    this.markReachableInk();
    this.rebuildDensity(this.radius);

    this.grain();
    this.measureControls();
    if (!this.engaged) this.parkCan();
    else this.clampCanIntoStage();
    this.dirty = true;
  }

  private parkCan(): void {
    const h = (this.canW || 150) * 2.12;
    // Parked far enough right to clear the centred hint headline, which is a
    // single nowrap line on desktop and reaches ~78% of the stage width.
    this.can.x = this.W * 0.86;
    this.can.y = this.wallH - h + 18;
    this.can.tx = this.can.x;
    this.can.ty = this.can.y;
    this.can.rot = 0;
    this.placeCan(0);
  }

  /**
   * After a viewport change the can may still be holding a target from the old
   * geometry — a rotation, or the mobile URL bar collapsing, is enough — which
   * strands it off-screen until the next touch. Pull it back inside.
   */
  private clampCanIntoStage(): void {
    const half = this.canW * 0.5;
    const minX = Math.min(half, this.W / 2);
    const maxX = Math.max(this.W - half, this.W / 2);
    const clampX = (v: number) => Math.max(minX, Math.min(maxX, v));
    const clampY = (v: number) => Math.max(0, Math.min(this.wallH, v));
    this.can.x = clampX(this.can.x);
    this.can.tx = clampX(this.can.tx);
    this.can.y = clampY(this.can.y);
    this.can.ty = clampY(this.can.ty);
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
    const scale = Math.min(2, Math.max(1, r / 54));

    // Body droplets, uniform over the disc and thinning outward.
    const n = Math.round(34 * scale);
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

    // A grainy rim concentrated around the cone edge. Without this the stamp
    // ends in a clean gradient, which reads as wiping something clean rather
    // than as atomised paint landing on concrete.
    const rim = Math.round(30 * scale);
    for (let i = 0; i < rim; i++) {
      const ang = Math.random() * TAU;
      const rr = r * (0.72 + Math.random() * 0.46);
      const sz = 0.28 + Math.random() * 1.05;
      m.globalAlpha = (0.05 + Math.random() * 0.3) * strength;
      m.beginPath();
      m.arc(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, sz, 0, TAU);
      m.fill();
    }

    // Overspray: the fine dust that drifts past the cone and settles.
    const dust = 3 + ((Math.random() * 4) | 0);
    for (let i = 0; i < dust; i++) {
      const ang = Math.random() * TAU;
      const rr = r * (1.18 + Math.random() * 1.15);
      m.globalAlpha = (0.03 + Math.random() * 0.16) * strength;
      m.beginPath();
      m.arc(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, 0.3 + Math.random() * 1.3, 0, TAU);
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

  /**
   * Interpolates along the pointer's travel so fast drags stay solid, emitting
   * each puff into the flight queue rather than painting it immediately.
   */
  private spray(now: number): void {
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
        this.emit(
          last.x + dx * (i / steps),
          last.y + dy * (i / steps),
          radius * (0.92 + Math.random() * 0.16),
          0.55 + 0.45 * speedFade,
          now,
        );
      }
      if (steps === 0) this.emit(nx, ny, radius * (0.94 + Math.random() * 0.12), 1, now);
    } else {
      this.emit(nx, ny, radius, 1, now);
    }
    this.lastStamp = { x: nx, y: ny };

    // Spatter thrown off the cone. It leaves fast in every direction, carries a
    // little of the stroke's own travel, and then falls — paint coming off a
    // nozzle, not exhaust.
    const hues = ART.hues;
    const dragX = last ? nx - last.x : 0;
    const dragY = last ? ny - last.y : 0;
    for (let i = 0; i < (radius > 80 ? 16 : 11); i++) {
      const ang = Math.random() * TAU;
      const sp = 0.7 + Math.random() * 3.6;
      // A few fat drops among the atomised mass, as a real cone throws.
      const heavy = Math.random() < 0.16;
      this.droplets.push({
        x: nx + (Math.random() - 0.5) * radius * 0.55,
        y: ny + (Math.random() - 0.5) * radius * 0.55,
        vx: Math.cos(ang) * sp + dragX * 0.16,
        vy: Math.sin(ang) * sp * 0.7 + dragY * 0.16,
        r: heavy ? 1.5 + Math.random() * 2.1 : 0.45 + Math.random() * 1.15,
        a: 0.55 + Math.random() * 0.4,
        life: 1,
        decay: heavy ? 0.03 + Math.random() * 0.02 : 0.055 + Math.random() * 0.05,
        h: hues[(Math.random() * hues.length) | 0],
      });
    }
    if (this.droplets.length > 420) this.droplets.splice(0, this.droplets.length - 420);
  }

  /**
   * Puts one puff of paint in the air, aimed where the can was when it fired.
   * It lands there even if the can has moved on, which is what gives the
   * stroke its trailing edge.
   */
  private emit(x: number, y: number, r: number, strength: number, now: number): void {
    this.pending.push({ x, y, r, strength, due: now + this.host.getConfig().sprayDelay });
    if (this.pending.length > 1500) this.pending.splice(0, this.pending.length - 1500);
  }

  /**
   * Lands every packet whose flight time has elapsed. Packets are pushed with a
   * constant delay off a monotonic clock, so the queue is always sorted by
   * `due` and a prefix scan is enough.
   */
  private landPaint(now: number): void {
    let n = 0;
    while (n < this.pending.length && this.pending[n].due <= now) n++;
    if (!n) return;
    for (let i = 0; i < n; i++) {
      const p = this.pending[i];
      this.stamp(p.x, p.y, p.r, p.strength);
    }
    this.pending.splice(0, n);
    // Coverage only counts paint that has actually arrived.
    this.sprayed = true;
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
    // Kept for the jet, which trails behind the nozzle as the can travels.
    this.canVx = vx;
    this.canVy = vy;
    let targetRot = Math.max(-26, Math.min(26, vx * 1.5)) + (this.engaged ? 9 : 0);

    // The can hangs below the nozzle, so a touch low on a short screen runs the
    // body off the bottom edge — very easy to do with a thumb on a phone.
    // Tilt it away instead: the nozzle is the transform origin, so rotating
    // about it keeps the tip exactly under the pointer while the body swings
    // into view. Angling a can is what you would do with a real one anyway.
    const bodyLen = this.canW * CAN_BODY_LENGTH;
    const room = this.H - CAN_EDGE_GAP - this.can.y;
    if (bodyLen > room) {
      // The lowest point of a tilted can is a bottom *corner*, not the centre
      // line, so the half-width counts: reach = halfW·sin|θ| + bodyLen·cos|θ|.
      // Writing that as R·cos(θ − δ) gives the angle that brings it to `room`.
      const halfW = this.canW * 0.535;
      const reach = Math.hypot(halfW, bodyLen);
      const delta = Math.atan2(halfW, bodyLen);
      const need = ((delta + Math.acos(Math.max(-1, Math.min(1, room / reach)))) * 180) / Math.PI;
      // Positive rotation swings the body left, so pick the roomier side.
      const away = this.can.x < this.W / 2 ? -1 : 1;
      const edgeRot = away * Math.min(CAN_MAX_TILT, need);
      if (Math.abs(edgeRot) > Math.abs(targetRot)) targetRot = edgeRot;
    }
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
      this.spray(now);
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

    // After spray(), so a zero delay still lands paint on the same frame.
    this.landPaint(now);

    this.stepDrips(wallH);
    this.stepFloorDrips();

    if (this.dirty) {
      this.compose(W, wallH);
      this.dirty = false;
    }

    this.els.glow.style.opacity = done ? (0.62 + Math.sin(now / 900) * 0.16).toFixed(3) : '0.5';
    this.drawAirborne(done, now);
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

  /**
   * Builds the wall in two coats so the wall reads as *painted*, not wiped
   * clean:
   *
   *  1. wet coat — soft, saturated colour at the mask's own alpha, so the first
   *     pass over bare concrete leaves pigment rather than finished artwork;
   *  2. detail coat — the sharp mural at alpha squared, so the artwork only
   *     resolves where paint has actually built up.
   *
   * Squaring is just the mask drawn into itself with `destination-in`.
   */
  private compose(W: number, wallH: number): void {
    const p = this.pctx!;
    const muralReady = !!(this.mural?.complete && this.mural.naturalWidth);
    p.save();
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.clearRect(0, 0, this.els.paint.width, this.els.paint.height);
    p.restore();

    p.drawImage(this.mask, 0, 0, W, wallH);
    if (muralReady) {
      p.globalCompositeOperation = 'source-in';
      p.imageSmoothingEnabled = true;
      p.imageSmoothingQuality = 'high';
      // Where the capped fit leaves the mural short of the wall, its own top
      // and bottom rows are stretched into the gap: the piece runs off the edge
      // in its own colours instead of stopping on a line, and a pass up there
      // still lays paint. The first draw has to cover the whole wall — anything
      // `source-in` misses is cleared — so the top row lays the ground.
      const sw = this.muralSoft.width;
      const sh = this.muralSoft.height;
      p.drawImage(this.muralSoft, 0, 0, sw, 1, this.mx, 0, this.mw, wallH);
      p.globalCompositeOperation = 'source-atop';
      const foot = this.my + this.mh;
      if (foot < wallH) {
        p.drawImage(this.muralSoft, 0, sh - 1, sw, 1, this.mx, foot, this.mw, wallH - foot);
      }
      // The wet coat, in register with the detail coat that follows.
      p.drawImage(this.muralSoft, this.mx, this.my, this.mw, this.mh);
      // Sink the stretched rows into shadow toward the edges, so they read as
      // the piece falling off into the dark rather than as smeared pixels.
      if (this.my > 0) {
        const top = p.createLinearGradient(0, 0, 0, this.my);
        top.addColorStop(0, 'rgba(0,0,0,0.92)');
        top.addColorStop(1, 'rgba(0,0,0,0)');
        p.fillStyle = top;
        p.fillRect(0, 0, W, this.my);
      }
      if (foot < wallH) {
        const bottom = p.createLinearGradient(0, foot, 0, wallH);
        bottom.addColorStop(0, 'rgba(0,0,0,0)');
        bottom.addColorStop(1, 'rgba(0,0,0,0.92)');
        p.fillStyle = bottom;
        p.fillRect(0, foot, W, wallH - foot);
      }
      p.globalCompositeOperation = 'source-over';
    }

    const d = this.detailCtx;
    if (muralReady && d) {
      d.save();
      d.setTransform(1, 0, 0, 1, 0, 0);
      d.clearRect(0, 0, this.detail.width, this.detail.height);
      d.restore();
      d.drawImage(this.mask, 0, 0, W, wallH);
      d.globalCompositeOperation = 'destination-in';
      d.drawImage(this.mask, 0, 0, W, wallH);
      d.globalCompositeOperation = 'source-in';
      d.drawImage(this.mural!, this.mx, this.my, this.mw, this.mh);
      d.globalCompositeOperation = 'source-over';
      p.drawImage(this.detail, 0, 0, W, wallH);
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

  /**
   * Pigment still in the air, drawn where it is about to land. It fades in over
   * the packet's flight and hands off to real paint on arrival, so a stroke has
   * a visible cloud of paint running ahead of the wet edge.
   */
  private drawInFlight(m: CanvasRenderingContext2D, now: number): void {
    const delay = this.host.getConfig().sprayDelay;
    if (delay <= 0) return;
    const hues = ART.hues;
    const tail = hues[1] || hues[0];
    // Only the most recent packets matter visually, and this bounds the cost.
    const from = Math.max(0, this.pending.length - 90);
    for (let i = from; i < this.pending.length; i++) {
      const p = this.pending[i];
      const t = 1 - (p.due - now) / delay; // 0 at the nozzle, 1 on landing
      if (t <= 0 || t >= 1) continue;
      const a = Math.sin(Math.PI * t) * 0.5 * p.strength;
      if (a < 0.01) continue;
      // Strands, not a disc: the packet arrives as a handful of streaks flung
      // out from its centre, spreading as it closes on the wall.
      const r = p.r * (0.35 + t * 0.7);
      const h = (i & 1) === 0 ? hues[0] : tail;
      m.strokeStyle = `rgba(${h},${a.toFixed(3)})`;
      m.lineWidth = 0.8 + p.r * 0.035;
      m.beginPath();
      for (let s = 0; s < 3; s++) {
        const ang = Math.random() * TAU;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        const r0 = r * (0.15 + Math.random() * 0.4);
        const r1 = r0 + r * (0.25 + Math.random() * 0.55);
        m.moveTo(p.x + cos * r0, p.y + sin * r0);
        m.lineTo(p.x + cos * r1, p.y + sin * r1);
      }
      m.stroke();
    }
  }

  /** Spatter in the air plus the wet spot the cone is laying down. */
  private drawAirborne(done: boolean, now: number): void {
    const m = this.mctx!;
    m.save();
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, this.els.mist.width, this.els.mist.height);
    m.restore();

    this.drawInFlight(m, now);

    m.lineCap = 'round';
    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const q = this.droplets[i];
      q.vy += DROPLET_GRAVITY;
      q.vx *= 0.965;
      q.vy *= 0.99;
      q.x += q.vx;
      q.y += q.vy;
      q.life -= q.decay;
      if (q.life <= 0) {
        this.droplets.splice(i, 1);
        continue;
      }
      // Held at full strength and cut at the end: a drop of paint does not
      // dissolve on the way, it simply stops being in shot.
      const a = q.a * Math.min(1, q.life * 2.4);
      const speed = Math.hypot(q.vx, q.vy);
      if (speed > 1.1) {
        // Fast enough to smear across the frame, which is most of what sells
        // liquid over vapour.
        m.strokeStyle = `rgba(${q.h},${a.toFixed(3)})`;
        m.lineWidth = q.r * 1.7;
        m.beginPath();
        m.moveTo(q.x - q.vx * 2.4, q.y - q.vy * 2.4);
        m.lineTo(q.x, q.y);
        m.stroke();
      } else {
        m.fillStyle = `rgba(${q.h},${a.toFixed(3)})`;
        m.beginPath();
        m.arc(q.x, q.y, q.r, 0, TAU);
        m.fill();
      }
    }

    if (this.ptr.down && !done) this.drawJet(m);
  }

  /**
   * The paint leaving the nozzle, seen head on: strands firing out of the
   * centre and tearing apart as they go, redrawn from scratch every frame.
   *
   * Deliberately not a radial gradient. A soft disc around the nozzle is what
   * makes a spray read as smoke however tightly it is drawn — the eye needs
   * *filaments* to call it liquid.
   */
  private drawJet(m: CanvasRenderingContext2D): void {
    const R = this.radius;
    const cx = this.can.x;
    const cy = this.can.y;
    const hues = ART.hues;

    // Lag: airborne paint keeps the nozzle's old position for a moment, so the
    // whole stream smears opposite the travel.
    const lagX = -this.canVx * 1.1;
    const lagY = -this.canVy * 1.1;

    const strands = 26 + ((Math.random() * 10) | 0);
    for (let i = 0; i < strands; i++) {
      const ang = Math.random() * TAU;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      // Nothing sprays down through the can it just came out of: the further a
      // strand points into the body, the less likely it is to be drawn.
      if (sin > 0.3 && Math.random() < sin) continue;
      // Long thin ones among short fat ones, so the jet has some grain to it.
      const thin = Math.random() < 0.6;
      const r0 = R * (0.04 + Math.random() * 0.2);
      const r1 = r0 + R * (thin ? 0.45 + Math.random() * 0.95 : 0.2 + Math.random() * 0.45);
      const x0 = cx + cos * r0;
      const y0 = cy + sin * r0;
      const x1 = cx + cos * r1 + lagX;
      const y1 = cy + sin * r1 + lagY;
      // A quarter of the stream catches the light as wet highlight.
      const h = Math.random() < 0.25 ? '255,190,238' : hues[(Math.random() * hues.length) | 0];
      const a = (thin ? 0.34 : 0.5) + Math.random() * 0.34;
      // Each strand thins out along its length rather than ending on a hard
      // stop, which is how a stream of paint actually breaks into droplets.
      const g = m.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(${h},${a.toFixed(3)})`);
      g.addColorStop(0.65, `rgba(${h},${(a * 0.5).toFixed(3)})`);
      g.addColorStop(1, `rgba(${h},0)`);
      m.strokeStyle = g;
      m.lineWidth = thin ? 0.8 + Math.random() * 1.5 : 2.2 + Math.random() * 2.6;
      // Bowed, not ruled: a torn thread of paint never leaves straight.
      const bow = (Math.random() - 0.5) * (r1 - r0) * 0.4;
      m.beginPath();
      m.moveTo(x0, y0);
      m.quadraticCurveTo((x0 + x1) / 2 - sin * bow, (y0 + y1) / 2 + cos * bow, x1, y1);
      m.stroke();
    }

    // Wet core where the stream leaves the can.
    m.fillStyle = `rgba(${hues[0]},0.5)`;
    m.beginPath();
    m.arc(cx, cy, R * 0.09, 0, TAU);
    m.fill();
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
