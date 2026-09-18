import { artUrl, type Art } from './art';
import { createBrushes, createSoftBrush } from './brush';
import { StrokeSampler, type StrokePoint } from './StrokeSampler';
import { paintRegion, type PaintBounds } from './paintRegion';

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
   * Optional paint flight time in ms. Keep at zero for immediate feedback;
   * the airborne particles provide the illusion of travel independently.
   */
  sprayDelay: number;
};

export type SprayElements = {
  wrap: HTMLDivElement;
  paint: HTMLCanvasElement;
  glow: HTMLCanvasElement;
  /** Specular sheen on paint that has not dried yet. */
  wet: HTMLCanvasElement;
  /** Soft light travelling with the can, lighting the wall's tooth. */
  lamp: HTMLDivElement;
  mist: HTMLCanvasElement;
  floor: HTMLCanvasElement;
  grain: HTMLCanvasElement;
  can: HTMLDivElement;
  /** The sound/reset cluster — the can gets out of its way. */
  controls: HTMLDivElement;
  /** The art picker, which needs a real cursor for the same reason — and which
      steps aside once the first mark lands. */
  canTabs: HTMLDivElement;
};

export type SprayHost = {
  getConfig(): SprayConfig;
  /** The mural for the can currently in hand — its src, mist hues and drip colour. */
  getArt(): Art;
  isDone(): boolean;
  isMuted(): boolean;
  /** The wall finished flooding — reveal the end screen. */
  onComplete(): void;
  /** Coverage in 0..1, already normalised against the reveal threshold. */
  onProgress(value: number): void;
  /**
   * The visitor has laid down their first paint, or a reset has taken it back.
   * The hint and the art picker both step aside on the way up.
   */
  onPaintedChange(painted: boolean): void;
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
 * √A alone still lets *aspect ratio* move the effort around: sweeping the
 * artwork takes `height / 2r` screen-widths of drag, so a tall narrow phone
 * costs far more passes than a wide monitor. The reference viewport is ~3.05
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
/**
 * Sanity rails, not tuning — the formula is well behaved between them. The
 * floor came down from 32 when `PORTRAIT_EFFORT` grew: on a 320px-wide phone
 * the two met, and the rail would have quietly eaten any further tuning.
 */
const RADIUS_MIN = 24;
const RADIUS_MAX = 420;

/**
 * Everything above equalises effort in *screen-widths of drag*, which is the
 * right unit for a mouse and the wrong one for a thumb: a screen-width on a
 * phone is one flick, so a portrait stage that matches a desktop on paper is
 * over in seconds in the hand. Shrink the cone further when the stage is taller
 * than it is wide. Empirical, and the only place the two are treated unequally.
 */
const PORTRAIT_EFFORT = 1.15;

/**
 * Portrait crops the mural to its middle, so the ink left on screen is the
 * subject itself — the skate and the wordmark — and none of the frame-edge tags
 * that make a high bar a corner hunt on a wide stage. Ask for nearly all of it
 * there. Below this the wall can pass the configured threshold while the skate
 * is still half dark: the drips cut revealed stripes through it, which counts
 * as coverage but does not look like a finished piece.
 */
const PORTRAIT_THRESHOLD = 0.86;

/**
 * How far outside the sound/reset cluster the can starts getting out of the
 * way, in CSS pixels. The stage hides the system cursor, so without this the
 * can sits under the pointer and the buttons are awkward to aim at.
 */
const CONTROLS_MARGIN = 20;

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
/** Resolution of the wetness buffer, as a fraction of the wall. */
const WET_SCALE = 0.34;
/**
 * Seconds for wet paint to look dry. Aerosol enamel is touch-dry in minutes,
 * but the point of the sheen is to tell you where you just sprayed — much
 * longer than this and the whole wall shines at once, which tells you nothing.
 */
const DRY_SECONDS = 2;
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
  /**
   * How wet the paint is, everywhere, at a fraction of the wall's resolution.
   * Alpha is wetness: a stamp writes 1, and the whole buffer is faded down every
   * frame, so the newest paint is the brightest and everything else is drying.
   * Kept as a buffer rather than per-cell values because a grid of cells shows
   * as a grid of squares however hard it is blurred.
   */
  private readonly wetMap = document.createElement('canvas');
  /** Low-res, saturation-boosted mural — the wet colour a fresh pass lays down. */
  private readonly muralSoft = document.createElement('canvas');
  /** Sharp mural masked by coverage squared, so detail only resolves in thick paint. */
  private readonly detail = document.createElement('canvas');
  private readonly coat = document.createElement('canvas');
  private readonly sharp = document.createElement('canvas');
  private readonly brushes = createBrushes();
  private readonly wetBrush = createSoftBrush();
  private airBrush = createSoftBrush('255,72,214');
  private brushIndex = 0;
  private dirtyBounds: PaintBounds | null = null;
  private coverageDirty = false;
  private lastMeasure = 0;
  private floorDirty = true;
  private stroke: StrokeSampler | null = null;
  private activePointer: number | null = null;
  private pressure = 1;
  private depositsSinceFrame = 0;
  private wetElapsed = 0;
  private mistBlank = true;
  private dwellTime = 0;
  private particleTime = 0;
  private wrapLeft = 0;
  private wrapTop = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly resizeObserver = new ResizeObserver(() => this.resizeIfNeeded());
  private readonly controlsObserver = new ResizeObserver(() => this.measureControls());
  private detailCtx: CanvasRenderingContext2D | null = null;
  private readonly sctx: CanvasRenderingContext2D;

  // Live contexts, (re)created on every resize.
  private pctx: CanvasRenderingContext2D | null = null;
  private gctx: CanvasRenderingContext2D | null = null;
  private mctx: CanvasRenderingContext2D | null = null;
  private fctx: CanvasRenderingContext2D | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;
  private finkCtx: CanvasRenderingContext2D | null = null;
  private wctx: CanvasRenderingContext2D | null = null;
  private wetCtx: CanvasRenderingContext2D | null = null;

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
  /** src of the mural currently loaded, so a can swap only reloads on a change. */
  private muralSrc = '';
  private ink: Uint8Array | null = null;
  private muralPixels: Uint8ClampedArray | null = null;
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
  private dirty = true;
  /** How wet the wettest paint on the wall is, 0..1 — lets the pass be skipped. */
  private wetLevel = 0;
  private wetBlank = true;
  private lampOpacity = 0;
  private lastFrame = 0;
  private engaged = false;
  private sprayed = false;
  private finishing = false;
  private floodT = 0;
  private coverage = 0;
  /** Set by the first mark of a run, cleared by `clearWall`. */
  private painted = false;
  /** True from the moment the wall is fully revealed until the hold expires. */
  private completing = false;
  private completeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Control clusters in wrap-local coordinates, already padded. Empty until measured. */
  private controlsBoxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  private nextRattle = 0;
  /** Whether the hiss is currently sounding, so its onset "psh" fires once. */
  private hissOn = false;
  private errShown = false;

  // Demand-driven animation; dormant once the paint and can settle.
  private raf: number | null = null;
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
  private readonly onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointer) return;
    if (e.type === 'pointerup') this.handleMove(e);
    this.handleUp();
  };
  private readonly onBlur = () => this.handleUp();
  private readonly onVisibility = () => {
    if (document.hidden) { this.handleUp(); this.stopLoop(); }
    else { this.lastFrame = 0; this.startLoop(); }
  };

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
    this.resizeObserver.observe(this.els.wrap);
    this.controlsObserver.observe(this.els.controls);
    this.controlsObserver.observe(this.els.canTabs.firstElementChild ?? this.els.canTabs);
    this.startLoop();
  }

  destroy(): void {
    this.destroyed = true;
    this.handleUp();
    this.cancelCompletionHold();
    this.stopLoop();
    this.resizeObserver.disconnect();
    this.controlsObserver.disconnect();
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
    this.handleUp();
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
    // A cleared wall is a dry wall; leaving the sheen up would shine on nothing.
    this.wetLevel = 0;
    this.sprayed = false;
    this.finishing = false;
    this.floodT = 0;
    this.coverage = 0;
    this.invalidate();
    this.floorDirty = true;
    this.host.onProgress(0);
    this.painted = false;
    this.host.onPaintedChange(false);
  }

  /** Called by React after `done` or `muted` flips so the can and hiss follow. */
  syncState(): void {
    this.startLoop();
    this.placeCan(0);
    this.setHiss(this.ptr.down && !this.host.isDone() ? 0.16 : 0);
  }

  // ------------------------------------------------------------------- pointer

  private bindPointer(): void {
    this.els.wrap.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.els.wrap.addEventListener('lostpointercapture', this.onPointerUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private unbindPointer(): void {
    this.els.wrap.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.els.wrap.removeEventListener('lostpointercapture', this.onPointerUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private handleDown(e: PointerEvent): void {
    const target = e.target as Element | null;
    if (target?.closest('button, a, input') || e.button !== 0 || this.activePointer !== null) return;
    if (this.host.isDone() || this.finishing || this.completing || !this.mural?.naturalWidth) return;
    this.engaged = true;
    this.setPtr(e);
    if (this.nearControls || this.ptr.y > this.wallH) return;
    this.activePointer = e.pointerId;
    this.ptr.down = true;
    this.can.x = this.can.tx = this.ptr.x;
    this.can.y = this.can.ty = this.ptr.y;
    this.dwellTime = 0;
    this.depositsSinceFrame = 0;
    this.stroke = new StrokeSampler(Math.max(2, this.radius * 0.095), (point) => {
      this.depositsSinceFrame++;
      this.emit(point.x, point.y, this.radius * (0.8 + point.pressure * 0.2),
        0.7 + point.pressure * 0.3, performance.now());
    });
    this.stroke.add(this.strokePoint());
    this.startAudio();
    if (this.actx?.state === 'suspended') void this.actx.resume().catch(() => {});
    this.setHiss(0.16);
    this.markPainted();
    this.placeCan(0);
    this.startLoop();
    try { this.els.wrap.setPointerCapture(e.pointerId); } catch { /* synthetic input */ }
  }

  private handleMove(e: PointerEvent): void {
    if (this.activePointer !== null && e.pointerId !== this.activePointer) return;
    if (this.activePointer === null && e.pointerType === 'touch') return;
    if (this.activePointer !== null && e.type === 'pointermove' && e.pointerType !== 'touch' && e.buttons === 0) {
      this.handleUp();
    }
    this.engaged = true;
    const samples = e.getCoalescedEvents?.();
    for (const point of samples?.length ? samples : [e]) {
      this.setPtr(point);
      if (this.ptr.down) {
        if (this.nearControls || this.ptr.y > this.wallH || this.ptr.y < 0 || this.ptr.x < 0 || this.ptr.x > this.W) {
          this.stroke?.end();
        } else {
          this.stroke?.add(this.strokePoint());
        }
      }
    }
    this.startLoop();
  }

  private handleUp(): void {
    const id = this.activePointer;
    this.activePointer = null;
    this.ptr.down = false;
    this.stroke?.end();
    this.stroke = null;
    this.dwellTime = 0;
    this.setHiss(0);
    if (id !== null && this.els.wrap.hasPointerCapture(id)) this.els.wrap.releasePointerCapture(id);
    this.startLoop();
  }

  private setPtr(e: PointerEvent): void {
    this.ptr.x = e.clientX - this.wrapLeft;
    this.ptr.y = e.clientY - this.wrapTop;
    this.pressure = e.pointerType === 'pen' ? Math.max(0.15, e.pressure) : 1;
  }

  private strokePoint(): StrokePoint {
    return { x: this.ptr.x, y: this.ptr.y, pressure: this.pressure };
  }

  private markPainted(): void {
    if (this.painted) return;
    this.painted = true;
    this.host.onPaintedChange(true);
    // The art picker leaves with the hint, so the strip it occupied has to
    // become sprayable in the same breath.
    this.measureControls();
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
    this.handleUp();
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
   * Caches each live control cluster in wrap-local space; they move on resize
   * and when the art picker leaves. Clusters are kept apart rather than merged
   * into one box: they sit at opposite ends of the bottom edge, and their union
   * would swallow the whole strip between them.
   */
  private measureControls(): void {
    const wrap = this.els.wrap.getBoundingClientRect();
    const clusters: Element[] = [this.els.controls];
    // The picker fades out on the first mark. Its strip is wall again from that
    // moment, so it leaves the list instead of sitting there as a dead zone.
    if (!this.painted) clusters.push(this.els.canTabs.firstElementChild ?? this.els.canTabs);
    this.controlsBoxes = clusters
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
    if (c.radius != null) return Math.max(4, Math.min(RADIUS_MAX, c.radius));
    // Measured against the artwork on screen, not the wall it hangs on. The two
    // are the same thing in landscape, where the mural covers the wall — but on
    // a portrait stage the piece sits in a band across the middle, and all the
    // ink with it. Sizing off the wall there hands a phone a cone wide enough
    // to clear that band in a couple of passes, and the reveal fires long
    // before the wall looks worked. What should be constant across displays is
    // sweeps *of the mural*.
    const artW = this.mw ? Math.min(this.W, this.mw) : this.W;
    const artH = this.mh ? Math.min(this.wallH, this.mh) : this.wallH;
    const area = RADIUS_K * Math.sqrt(artW * artH);
    // Keep the implied number of sweeps inside the band above.
    const bounded = Math.max(artH / (2 * MAX_SWEEPS), Math.min(artH / (2 * MIN_SWEEPS), area));
    const capped = Math.min(bounded, this.W * RADIUS_MAX_WIDTH_FRACTION);
    const effort = this.wallH > this.W ? capped / PORTRAIT_EFFORT : capped;
    return Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, effort * c.radiusScale));
  }

  /** Density buckets are sized relative to the cone, not to fixed pixels. */
  private rebuildDensity(radius: number): void {
    this.cell = Math.max(8, Math.round(radius * CELL_PER_RADIUS));
    this.cols = Math.ceil(this.W / this.cell);
    this.rows = Math.ceil(this.wallH / this.cell);
    this.dens = new Float32Array(this.cols * this.rows);
  }

  // ---------------------------------------------------------------------- art

  /**
   * Loads the current can's mural, if it is not already up. The freshly loaded
   * image is only swapped in on `load`, so the wall keeps showing the old piece
   * until the new one is ready rather than blanking during the swap.
   */
  private loadArt(): void {
    const { src } = this.host.getArt();
    if (src === this.muralSrc && this.mural) return;
    this.muralSrc = src;
    this.airBrush = createSoftBrush(this.host.getArt().hues[0]);

    const img = new Image();
    img.src = artUrl(src);

    const apply = () => {
      // The mural can resolve after an unmount, or after a further can swap.
      if (this.destroyed || this.host.getArt().src !== src) return;
      this.mural = img;
      this.buildInkMap();
      if (this.W) this.resize();
      this.invalidate();
    };
    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener('load', apply, { once: true });
  }

  /**
   * Called by React after the can design changes. A different can means a
   * different piece, so the wall starts over: keeping the old coverage would
   * reveal the new mural half-finished through paint meant for another.
   */
  refreshArt(): void {
    const changed = this.host.getArt().src !== this.muralSrc;
    this.loadArt();
    if (changed) this.clearWall();
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

    this.muralPixels = a;
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

  private resizeIfNeeded(): void {
    const box = this.els.wrap.getBoundingClientRect();
    if (Math.abs(box.width - this.W) > 1 || Math.abs(box.height - this.H) > 1) this.resize();
  }

  private resize(): void {
    const r = this.els.wrap.getBoundingClientRect();
    this.wrapLeft = r.left;
    this.wrapTop = r.top;
    this.W = Math.max(2, Math.round(r.width));
    this.H = Math.max(2, Math.round(r.height));
    // Floors of 1: mounting into a hidden or zero-size container would
    // otherwise round these to 0 and every drawImage of them would throw.
    this.floorH = Math.max(1, Math.round(this.H * FLOOR_RATIO));
    this.wallH = Math.max(1, this.H - this.floorH);
    this.dpr = Math.min(1.6, window.devicePixelRatio || 1, Math.sqrt(2_800_000 / (this.W * this.wallH)));

    // Preserve the paint already on the wall across a viewport change.
    let keep: HTMLCanvasElement | null = null;
    if (this.hasMask && this.mask.width > 1) {
      keep = document.createElement('canvas');
      keep.width = this.mask.width;
      keep.height = this.mask.height;
      keep.getContext('2d')!.drawImage(this.mask, 0, 0);
    }

    const fit = (c: HTMLCanvasElement, w: number, h: number, scale = this.dpr) => {
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      const x = c.getContext('2d')!;
      x.setTransform(c.width / w, 0, 0, c.height / h, 0, 0);
      return x;
    };

    this.pctx = fit(this.els.paint, this.W, this.wallH);
    this.gctx = fit(this.els.glow, this.W, this.wallH, 0.22);
    this.wctx = fit(this.els.wet, this.W, this.wallH, WET_SCALE);
    this.mctx = fit(this.els.mist, this.W, this.H, Math.min(1, this.dpr));
    this.fctx = fit(this.els.floor, this.W, this.floorH, 0.5);
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

    // Wetness is a soft, slow-moving field, so it costs nothing to hold it at a
    // third of the wall's size and blur it back up.
    this.wetMap.width = Math.max(2, Math.round(this.W * WET_SCALE));
    this.wetMap.height = Math.max(2, Math.round(this.wallH * WET_SCALE));
    this.wetCtx = this.wetMap.getContext('2d');

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
    this.handleUp();
    if (!this.engaged) this.parkCan();
    else this.clampCanIntoStage();
    this.bakeMural();
    this.dirtyBounds = null;
    this.floorDirty = true;
    this.invalidate();
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
   * Samples changed paint against the ink map at most every 160ms. Once enough of the
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
      if (this.reachable[i] && a[i * 4 + 3] > 110) hit++;
    }
    this.coverage = this.reachableCount ? hit / this.reachableCount : 0;

    const configured = Math.max(0.01, Math.min(1, this.host.getConfig().threshold));
    const threshold = this.wallH > this.W ? Math.max(configured, PORTRAIT_THRESHOLD) : configured;
    this.host.onProgress(Math.min(1, this.coverage / threshold));
    if (this.sprayed && this.coverage >= threshold) {
      this.finishing = true;
      this.handleUp();
    }
  }

  // -------------------------------------------------------------------- paint

  /** Union of changed paint; the sharp mural only redraws this rectangle. */
  private invalidate(x = 0, y = 0, width = this.W, height = this.wallH): void {
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const right = Math.min(this.W, Math.ceil(x + width));
    const bottom = Math.min(this.wallH, Math.ceil(y + height));
    if (right <= left || bottom <= top) return;
    const b = this.dirtyBounds;
    this.dirtyBounds = b ? { x: Math.min(b.x, left), y: Math.min(b.y, top),
      right: Math.max(b.right, right), bottom: Math.max(b.bottom, bottom) } : { x: left, y: top, right, bottom };
    this.dirty = true;
    this.coverageDirty = true;
    this.startLoop();
  }

  private stamp(x: number, y: number, r: number, strength: number): void {
    const m = this.maskCtx;
    if (!m) return;
    const extent = r * (128 / 98);
    m.globalAlpha = Math.min(1, strength);
    m.drawImage(this.brushes[this.brushIndex++ % this.brushes.length], x - extent, y - extent, extent * 2, extent * 2);
    m.globalAlpha = 1;

    const wc = this.wetCtx;
    if (wc) {
      const wr = r * WET_SCALE;
      wc.globalAlpha = Math.min(1, strength * 0.65);
      wc.drawImage(this.wetBrush, x * WET_SCALE - wr, y * WET_SCALE - wr, wr * 2, wr * 2);
      wc.globalAlpha = 1;
      this.wetLevel = 1;
      this.wetBlank = false;
    }
    const ci = Math.floor(x / this.cell);
    const ri = Math.floor(y / this.cell);
    if (ci >= 0 && ri >= 0 && ci < this.cols && ri < this.rows) {
      const k = ri * this.cols + ci;
      this.dens[k] += strength * 0.22;
      if (this.host.getConfig().drips && this.dens[k] > 2.8 && this.drips.length < 32 && Math.random() < 0.14) {
        this.dens[k] = 0.5;
        this.drips.push({ x: x + Math.random() * 12 - 6, y: y + r * 0.35,
          r: 1 + Math.random() * 1.8, v: 0.22 + Math.random() * 0.5, age: 0, life: 140 + Math.random() * 180 });
      }
    }
    this.invalidate(x - extent - 2, y - extent - 2, extent * 2 + 4, extent * 2 + 4);
  }

  /** Dwell builds pigment on the clock; movement is sampled directly from input. */
  private spray(now: number, dt: number): void {
    const radius = this.radius;
    if (this.cell !== Math.max(8, Math.round(radius * CELL_PER_RADIUS))) this.rebuildDensity(radius);
    this.dwellTime = Math.max(0, this.dwellTime + dt - this.depositsSinceFrame / 60);
    while (this.dwellTime >= 1 / 60) {
      this.emit(this.ptr.x, this.ptr.y, radius * (0.8 + this.pressure * 0.2),
        0.7 + this.pressure * 0.3, now);
      this.dwellTime -= 1 / 60;
    }
    this.particleTime += dt * (this.reducedMotion ? 80 : 220);
    const count = Math.floor(this.particleTime);
    this.particleTime -= count;
    const hues = this.host.getArt().hues;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * TAU;
      const speed = 0.5 + Math.random() * 2;
      this.droplets.push({
        x: this.ptr.x + Math.cos(angle) * radius * Math.random() * 0.65,
        y: this.ptr.y + Math.sin(angle) * radius * Math.random() * 0.65,
        vx: Math.cos(angle) * speed + this.canVx * 0.04,
        vy: Math.sin(angle) * speed * 0.6 + this.canVy * 0.04,
        r: 0.4 + Math.random() * 1.1, a: 0.22 + Math.random() * 0.34,
        life: 1, decay: 0.045 + Math.random() * 0.045,
        h: hues[i % hues.length],
      });
    }
    if (this.droplets.length > 160) this.droplets.splice(0, this.droplets.length - 160);
  }

  /**
   * Puts one puff of paint in the air, aimed where the can was when it fired.
   * It lands there even if the can has moved on, which is what gives the
   * stroke its trailing edge.
   */
  private emit(x: number, y: number, r: number, strength: number, now: number): void {
    if (this.host.getConfig().sprayDelay <= 0) {
      this.stamp(x, y, r, strength);
      this.sprayed = true;
      return;
    }
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
    if (this.raf !== null || this.destroyed || document.hidden) return;
    this.raf = requestAnimationFrame((t) => {
      this.raf = null;
      this.run(t);
      const unsettled = Math.hypot(this.can.x - this.can.tx, this.can.y - this.can.ty) > 0.1;
      if (this.ptr.down || this.dirty || this.coverageDirty || this.finishing || this.pending.length ||
        this.drips.length || this.floorDrips.length || this.droplets.length || !this.wetBlank || unsettled ||
        Math.abs(this.lampOpacity - this.lampTarget) > 0.002 || this.canSettling) this.startLoop();
      else this.lastFrame = 0;
    });
  }

  private stopLoop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  private canSettling = false;
  private get lampTarget(): number {
    return this.host.isDone() ? 0 : this.ptr.down ? 0.8 : this.engaged ? 0.42 : 0.24;
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
    if (!this.pctx || !this.mctx || !this.gctx || !this.maskCtx) {
      this.resize();
      return;
    }
    const done = this.host.isDone();
    const W = this.W;
    const wallH = this.wallH;
    // Real elapsed time, so paint dries on the clock rather than on the frame
    // count — a throttled tab would otherwise keep the wall wet for minutes.
    // The cap only guards against the jump back from a long background pause.
    const dt = this.lastFrame ? Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000)) : 0.016;
    this.lastFrame = now;

    // The can chases the pointer with easing, and tilts into its own velocity.
    if (this.engaged) {
      this.can.tx = this.ptr.x;
      this.can.ty = this.ptr.y;
    }
    const ease = this.ptr.down ? 1 : 1 - Math.exp(-dt * (this.engaged ? 32 : 8));
    const px = this.can.x;
    const py = this.can.y;
    this.can.x += (this.can.tx - this.can.x) * ease;
    this.can.y += (this.can.ty - this.can.y) * ease;
    const vx = this.can.x - px;
    const vy = this.can.y - py;
    // Kept for the jet, which trails behind the nozzle as the can travels.
    this.canVx = vx / (dt * 60);
    this.canVy = vy / (dt * 60);
    let targetRot = Math.max(-26, Math.min(26, this.canVx * 0.85)) + (this.engaged ? 9 : 0);

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
    if (this.reducedMotion) targetRot = 0;
    this.can.rot += (targetRot - this.can.rot) * (1 - Math.exp(-dt * 14));
    this.canSettling = Math.abs(targetRot - this.can.rot) > 0.1;

    // Moving the can without spraying shakes the ball bearing.
    const speed = Math.hypot(vx, vy);
    if (!this.ptr.down && this.engaged && !done && !this.finishing && speed > 2.2) {
      if (now > this.nextRattle) {
        const hard = Math.min(1, speed / 24);
        this.rattle(hard);
        this.nextRattle = now + 34 + Math.random() * 90 - hard * 55;
      }
    }

    this.placeCan(0);

    const spraying = this.ptr.down && this.stroke?.active && !done && !this.finishing && !this.completing;
    if (spraying) {
      this.spray(now, dt);
      this.setHiss(0.16);
    } else this.setHiss(0);
    this.depositsSinceFrame = 0;
    this.els.wrap.dataset.spraying = spraying ? 'true' : 'false';

    if (this.finishing) {
      this.floodT += dt;
      this.maskCtx.fillStyle = `rgba(255,255,255,${1 - Math.exp(-dt * 4.8)})`;
      this.maskCtx.fillRect(0, 0, W, wallH);
      this.invalidate();
      if (this.floodT >= (this.reducedMotion ? 0.2 : 0.85)) {
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

    this.stepDrips(wallH, dt * 60);
    this.stepFloorDrips(dt * 60);

    if (this.dirty) {
      this.compose(W, wallH);
      this.dirty = false;
    }

    if (this.floorDirty) { this.drawFloor(); this.floorDirty = false; }
    this.wetElapsed += dt;
    if (this.wetElapsed >= 1 / 60 || this.wetLevel === 0) {
      this.drawWet(this.wetElapsed);
      this.wetElapsed = 0;
    }
    this.placeLamp(dt);
    this.drawAirborne(!spraying, now, dt * 60);
    if (this.coverageDirty && now - this.lastMeasure >= 160) {
      this.coverageDirty = false;
      this.lastMeasure = now;
      this.measure();
    }
  }

  /**
   * The wet look. Fresh paint is still holding solvent, so it throws a specular
   * highlight; as it flashes off the sheen goes with it and the colour settles
   * matte. Two things make it read as wet rather than as another glow: it is
   * clipped to the pigment, so bare wall never shines, and it decays
   * exponentially, so the newest stroke is always the brightest thing on the
   * wall no matter how much paint is already up.
   */
  private drawWet(dt: number): void {
    const w = this.wctx;
    const wc = this.wetCtx;
    if (!w || !wc) return;

    // Flash-off. Removing a fixed *share* of what is left each second gives the
    // exponential fade solvent actually has; a linear countdown reads as a
    // light being switched off.
    const tau = DRY_SECONDS / 3;
    const fade = 1 - Math.exp(-dt / tau);
    this.wetLevel *= Math.exp(-dt / tau);

    if (this.wetLevel < 0.005) {
      // Dry. Clear once, then stop paying for the pass until the next stroke.
      if (!this.wetBlank) {
        wc.save();
        wc.setTransform(1, 0, 0, 1, 0, 0);
        wc.clearRect(0, 0, this.wetMap.width, this.wetMap.height);
        wc.restore();
        w.save();
        w.setTransform(1, 0, 0, 1, 0, 0);
        w.clearRect(0, 0, this.els.wet.width, this.els.wet.height);
        w.restore();
        this.wetBlank = true;
      }
      return;
    }

    wc.globalCompositeOperation = 'destination-out';
    wc.fillStyle = `rgba(0,0,0,${fade.toFixed(4)})`;
    wc.fillRect(0, 0, this.wetMap.width, this.wetMap.height);
    wc.globalCompositeOperation = 'source-over';

    w.save();
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.clearRect(0, 0, this.els.wet.width, this.els.wet.height);
    w.restore();

    w.drawImage(this.wetMap, 0, 0, this.W, this.wallH);

    // Only pigment shines. Without this the sheen sits on bare concrete too and
    // the whole thing reads as a torch rather than as wet paint.
    w.globalCompositeOperation = 'destination-in';
    w.drawImage(this.els.paint, 0, 0, this.W, this.wallH);
    w.globalCompositeOperation = 'source-over';
  }

  /**
   * Moves the can's light. It is a plain element rather than another canvas
   * because all it does is travel — the wall's tooth, seams and grain are
   * already drawn, and a soft-light blend over them lifts that texture into
   * relief far more cheaply than relighting it per pixel would.
   */
  private placeLamp(dt: number): void {
    const l = this.els.lamp.style;
    // Sits a little above the nozzle: the light source is the can in your hand,
    // not the jet leaving it.
    l.transform = `translate3d(${(this.can.x - this.W / 2).toFixed(1)}px, ${(this.can.y - 26 - this.wallH / 2).toFixed(1)}px, 0)`;
    // Brightest while spraying, dim while the can is just being carried, gone
    // once the wall is finished and the flood takes over.
    const want = this.lampTarget;
    const have = this.lampOpacity;
    this.lampOpacity = have + (want - have) * (1 - Math.exp(-dt * 12));
    l.opacity = this.lampOpacity.toFixed(3);
  }

  /** Advances wall drips, painting them straight into the reveal mask. */
  private stepDrips(wallH: number, step: number): void {
    const m = this.maskCtx;
    if (!m) return;
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      d.age += step;
      d.v = Math.min(2.6, d.v * Math.pow(1.016, step));
      const oldY = d.y;
      d.y += d.v * step;
      d.x += Math.sin(d.y * 0.045) * 0.12 * step;
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
      this.invalidate(d.x - d.r * 2, oldY - d.r * 2, d.r * 4, d.y - oldY + d.r * 4);

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
    const fallback = this.host.getArt().splat;
    if (!this.muralPixels) return fallback;
    try {
      const px = Math.max(0, Math.min(SAMPLE_W - 1, Math.floor((x - this.mx) / this.mw * SAMPLE_W)));
      const py = Math.max(0, Math.min(SAMPLE_H - 1, Math.floor((this.wallH - 5 - this.my) / this.mh * SAMPLE_H)));
      const i = (py * SAMPLE_W + px) * 4;
      const d = this.muralPixels;
      if (d[i] + d[i + 1] + d[i + 2] > 40) return `${d[i]},${d[i + 1]},${d[i + 2]}`;
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
    this.floorDirty = true;
  }

  /** Runs a drip down the floor, then lets it spread into a flattened pool. */
  private stepFloorDrips(step: number): void {
    const f = this.finkCtx;
    if (!f || !this.floorDrips.length) return;
    const H = this.floorH;

    for (let i = this.floorDrips.length - 1; i >= 0; i--) {
      const d = this.floorDrips[i];
      if (d.y < d.stop) {
        d.py = d.y;
        d.px = d.x;
        d.y += d.v * step;
        d.x += d.drift * step;
        d.v = Math.max(0.18, d.v * Math.pow(0.976, step));
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
        d.pool += 0.14 * step;
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
      this.floorDirty = true;
    }
  }

  /** Rasterise the fitted artwork once; strokes only mask these cached coats. */
  private bakeMural(): void {
    for (const canvas of [this.coat, this.sharp]) {
      canvas.width = this.els.paint.width;
      canvas.height = this.els.paint.height;
    }
    if (!this.mural?.naturalWidth) return;
    const p = this.coat.getContext('2d')!;
    p.setTransform(this.coat.width / this.W, 0, 0, this.coat.height / this.wallH, 0, 0);
    p.imageSmoothingQuality = 'high';
    const sw = this.muralSoft.width;
    const sh = this.muralSoft.height;
    p.drawImage(this.muralSoft, 0, 0, sw, 1, this.mx, 0, this.mw, this.wallH);
    const foot = this.my + this.mh;
    if (foot < this.wallH) p.drawImage(this.muralSoft, 0, sh - 1, sw, 1, this.mx, foot, this.mw, this.wallH - foot);
    p.drawImage(this.muralSoft, this.mx, this.my, this.mw, this.mh);
    if (this.my > 0) {
      const top = p.createLinearGradient(0, 0, 0, this.my);
      top.addColorStop(0, 'rgba(0,0,0,0.92)');
      top.addColorStop(1, 'rgba(0,0,0,0)');
      p.fillStyle = top;
      p.fillRect(0, 0, this.W, this.my);
    }
    if (foot < this.wallH) {
      const bottom = p.createLinearGradient(0, foot, 0, this.wallH);
      bottom.addColorStop(0, 'rgba(0,0,0,0)');
      bottom.addColorStop(1, 'rgba(0,0,0,0.92)');
      p.fillStyle = bottom;
      p.fillRect(0, foot, this.W, this.wallH - foot);
    }
    const d = this.sharp.getContext('2d')!;
    d.setTransform(this.sharp.width / this.W, 0, 0, this.sharp.height / this.wallH, 0, 0);
    d.imageSmoothingQuality = 'high';
    d.drawImage(this.mural, this.mx, this.my, this.mw, this.mh);
  }

  /** Redraw only changed pigment. Soft colour resolves into detail as it builds. */
  private compose(W: number, wallH: number): void {
    const b = this.dirtyBounds ?? { x: 0, y: 0, right: W, bottom: wallH };
    // CSS-pixel bounds are fractional in the backing canvas on Retina displays.
    // A fractional clip/clear blends old and new paint along every rectangle edge.
    // All sharp buffers share a size: copy their integer backing pixels 1:1.
    const { x, y, width, height } = paintRegion(b, W, wallH, this.mask.width, this.mask.height);
    const draw = (ctx: CanvasRenderingContext2D, source: HTMLCanvasElement) => {
      ctx.drawImage(source, x, y, width, height, x, y, width, height);
    };
    const p = this.pctx!;
    const d = this.detailCtx!;
    // Porter-Duff compositing clears outside its source; clipping keeps prior strokes intact.
    for (const ctx of [p, d]) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.clearRect(x, y, width, height);
      draw(ctx, this.mask);
    }
    p.globalCompositeOperation = 'source-in';
    draw(p, this.coat);
    p.globalCompositeOperation = 'source-over';
    d.globalCompositeOperation = 'destination-in';
    draw(d, this.mask);
    d.globalCompositeOperation = 'source-in';
    draw(d, this.sharp);
    d.restore();
    draw(p, this.detail);
    p.restore();
    this.dirtyBounds = null;

    const g = this.gctx!;
    g.clearRect(0, 0, W, wallH);
    g.drawImage(this.els.paint, 0, 0, W, wallH);
    if (b.bottom >= wallH - this.floorH * 1.6) this.floorDirty = true;
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

  private drawInFlight(m: CanvasRenderingContext2D, now: number): void {
    const delay = this.host.getConfig().sprayDelay;
    if (delay <= 0) return;
    for (let i = Math.max(0, this.pending.length - 24); i < this.pending.length; i++) {
      const p = this.pending[i];
      const t = 1 - (p.due - now) / delay;
      if (t <= 0 || t >= 1) continue;
      m.globalAlpha = Math.sin(Math.PI * t) * 0.16;
      m.drawImage(this.airBrush, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    m.globalAlpha = 1;
  }

  /** Spatter in the air plus the wet spot the cone is laying down. */
  private drawAirborne(done: boolean, now: number, step: number): void {
    const m = this.mctx!;
    const hasMist = !done || this.droplets.length > 0 || this.pending.length > 0;
    if (!hasMist && this.mistBlank) return;
    this.mistBlank = !hasMist;
    m.save();
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, this.els.mist.width, this.els.mist.height);
    m.restore();

    this.drawInFlight(m, now);

    m.lineCap = 'round';
    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const q = this.droplets[i];
      q.vy += DROPLET_GRAVITY * step;
      q.vx *= Math.pow(0.965, step);
      q.vy *= Math.pow(0.99, step);
      q.x += q.vx * step;
      q.y += q.vy * step;
      q.life -= q.decay * step;
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
        m.moveTo(q.x - q.vx * 0.8, q.y - q.vy * 0.8);
        m.lineTo(q.x, q.y);
        m.stroke();
      } else {
        m.fillStyle = `rgba(${q.h},${a.toFixed(3)})`;
        m.beginPath();
        m.arc(q.x, q.y, q.r, 0, TAU);
        m.fill();
      }
    }

    if (this.ptr.down && !done) this.drawJet(m, now);
  }

  /** A fine, translucent aerosol cone; pigment and detail remain visible beneath it. */
  private drawJet(m: CanvasRenderingContext2D, now: number): void {
    const radius = this.radius;
    const x = this.ptr.x;
    const y = this.ptr.y;
    m.save();
    m.translate(x, y);
    m.rotate(this.can.rot * Math.PI / 180);
    m.globalAlpha = 0.22;
    m.drawImage(this.airBrush, -radius * 0.85, -radius * 1.05, radius * 1.7, radius * 1.5);
    m.globalAlpha = 0.12;
    const breath = this.reducedMotion ? 0 : Math.sin(now * 0.009) * radius * 0.035;
    m.drawImage(this.airBrush, -radius * 0.5 + breath, -radius * 0.7, radius, radius * 0.8);
    m.restore();
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
      // Pink-ish noise (Paul Kellet's economy filter), not flat white. White
      // noise is what makes a hiss read as TV static or an arc; pink weights
      // the low-mids the way escaping air does, so it sounds like a spray can.
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.12;
      }

      // Master hiss bus. `setHiss` gates the whole spray sound through this.
      const gain = actx.createGain();
      gain.gain.value = 0;
      gain.connect(actx.destination);

      // A spray can is broadband escaping air — a smooth "shhh", not a tone.
      // So: no resonant band and no tremolo (either one turns the noise into an
      // electric buzz). Just white noise shaped by wide, gentle filters:
      //  - highpass to drop the rumble;
      //  - lowpass to tame the harsh fizz that otherwise reads as an arc;
      //  - a broad, low-Q presence lift for the body of the hiss.
      const src = actx.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      const hp = actx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1500;
      hp.Q.value = 0.4;

      const lp = actx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 7200;
      lp.Q.value = 0.3;

      const presence = actx.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.value = 3800;
      presence.Q.value = 0.7;
      presence.gain.value = 4;

      src.connect(hp);
      hp.connect(lp);
      lp.connect(presence);
      presence.connect(gain);
      src.start();

      const rattleBus = actx.createGain();
      rattleBus.gain.value = 0.9;
      rattleBus.connect(actx.destination);

      this.actx = actx;
      this.gain = gain;
      this.noiseBuf = buf;
      this.rattleBus = rattleBus;
      this.hissOn = false;
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
    const on = v > 0 && !this.host.isMuted();
    const t = this.actx.currentTime;
    const g = this.gain.gain;
    if (on && !this.hissOn) {
      // Onset: the valve opening throws a brief over-pressure "psh" before the
      // stream settles to its sustained hiss.
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.linearRampToValueAtTime(v * 1.5, t + 0.02);
      g.setTargetAtTime(v, t + 0.02, 0.08);
    } else if (on) {
      g.setTargetAtTime(v, t, 0.04);
    } else {
      // Release: the pressure tails off fast, not a hard cut.
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.setTargetAtTime(0, t, 0.05);
    }
    this.hissOn = on;
  }
}
