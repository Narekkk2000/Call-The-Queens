import { useCallback, useEffect, useRef, useState } from 'react';
import { SprayEngine, type SprayConfig } from '../spray/SprayEngine';
import { ART, artUrl } from '../spray/art';
import { RevealScreen } from './RevealScreen';
import { CAN_VARIANTS, SprayCan, type CanVariant } from './SprayCan';
import './SprayWall.css';

export type SprayWallProps = Partial<SprayConfig>;

const DEFAULTS: SprayConfig = {
  // `radius` is intentionally absent: it is derived from the stage size so the
  // effort to reveal the wall is the same on every display.
  radiusScale: 1,
  // High enough that the piece reads as painted before the wall takes over.
  // Matches the floor portrait screens already enforce (`PORTRAIT_THRESHOLD`).
  threshold: 0.86,
  drips: true,
  sound: true,
  canSize: 1,
  // Beat of silence on the finished mural before the coming-soon screen.
  revealDelay: 1200,
  // The artwork follows input immediately; mist supplies the airborne motion.
  sprayDelay: 0,
};

export function SprayWall(overrides: SprayWallProps) {
  const [done, setDone] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  // True from the first mark until a reset. The hint and the art picker both
  // clear out once there is paint on the wall.
  const [painted, setPainted] = useState(false);
  // Which can design is in hand. Each carries its own mural, so a swap changes
  // both the piece being revealed and the paint that reveals it.
  const [canVariant, setCanVariant] = useState<CanVariant>('queens');

  const wrapRef = useRef<HTMLDivElement>(null);
  const paintRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLCanvasElement>(null);
  const wetRef = useRef<HTMLCanvasElement>(null);
  const lampRef = useRef<HTMLDivElement>(null);
  const mistRef = useRef<HTMLCanvasElement>(null);
  const floorRef = useRef<HTMLCanvasElement>(null);
  const grainRef = useRef<HTMLCanvasElement>(null);
  const canRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const canTabsRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SprayEngine | null>(null);

  // The engine runs outside React's render cycle, so it reads state through a
  // ref that is kept current on every commit.
  const latest = useRef({ done, muted, art: ART[canVariant], config: { ...DEFAULTS, ...overrides } });
  latest.current.done = done;
  latest.current.muted = muted;
  latest.current.art = ART[canVariant];
  latest.current.config = { ...DEFAULTS, ...overrides };

  useEffect(() => {
    const els = {
      wrap: wrapRef.current,
      paint: paintRef.current,
      glow: glowRef.current,
      wet: wetRef.current,
      lamp: lampRef.current,
      mist: mistRef.current,
      floor: floorRef.current,
      grain: grainRef.current,
      can: canRef.current,
      controls: controlsRef.current,
      canTabs: canTabsRef.current,
    };
    if (Object.values(els).some((el) => el === null)) return;

    const engine = new SprayEngine(
      els as Required<{ [K in keyof typeof els]: NonNullable<(typeof els)[K]> }>,
      {
        getConfig: () => latest.current.config,
        getArt: () => latest.current.art,
        isDone: () => latest.current.done,
        isMuted: () => latest.current.muted,
        onComplete: () => setDone(true),
        onProgress: setProgress,
        onPaintedChange: setPainted,
      },
    );
    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // Built once per mount; live values flow through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push `done`/`muted` changes into the can and the audio bus.
  useEffect(() => {
    engineRef.current?.syncState();
  }, [done, muted]);

  // Load the new can's mural when the design changes.
  useEffect(() => {
    engineRef.current?.refreshArt();
  }, [canVariant]);

  // Shared by the RESET button and the corner mark on the reveal screen: both
  // mean "blank wall, 0%, start again".
  const handleReset = useCallback(() => {
    engineRef.current?.clearWall();
    setDone(false);
  }, []);

  const pct = Math.round(progress * 100);

  return (
    <div className={`wall${done ? ' wall--done' : ''}`} ref={wrapRef}>
      <div className="wall__status" aria-hidden="true"><span />MAKE YOUR MARK</div>
      <div className="wall__surface">
        <div className="wall__seams" />
        <div className="wall__course-line" />
        <canvas className="wall__canvas" ref={paintRef} />
        <canvas className="wall__canvas wall__canvas--glow" ref={glowRef} />
        {/* Sheen on paint that has not dried yet. Above the colour so it reads
            as a highlight on the surface, below the light so the light rakes
            both. */}
        <canvas className="wall__canvas wall__canvas--wet" ref={wetRef} />
        {/* The can's own light, travelling with it. */}
        <div className="wall__lamp" ref={lampRef} aria-hidden="true" />
        <div className="wall__vignette" />
        <div className="wall__base-shadow" />
      </div>

      <div className="floor">
        <div className="floor__lip" />
        <div className="floor__grooves" />
        <canvas className="wall__canvas" ref={floorRef} />
        <div className="floor__shade" />
      </div>

      <canvas className="wall__canvas wall__canvas--grain" ref={grainRef} />
      <canvas className="wall__canvas wall__canvas--mist" ref={mistRef} />

      <div className="hint" style={{ opacity: painted ? 0 : 1 }}>
        <div className="hint__row">
          <div className="hint__rule hint__rule--left" />
          <div className="hint__headline">
            Hold &amp; drag to reveal the wall
          </div>
          <div className="hint__rule hint__rule--right" />
        </div>
        <div className="hint__tail" />
      </div>

      <div className="controls" ref={controlsRef}>
        <button type="button" className="controls__button" aria-pressed={!muted} aria-label={muted ? 'Turn sound on' : 'Turn sound off'} onClick={() => setMuted((m) => !m)}>
          {muted ? 'SOUND OFF' : 'SOUND ON'}
        </button>
        <button type="button" className="controls__button" onClick={handleReset}>
          RESET
        </button>
      </div>

      {!done && (
        <div className="hud" role="progressbar" aria-label="Wall revealed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="hud__label">REVEALED</div>
          <div className="hud__track">
            <div className="hud__fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="hud__pct">{pct}%</div>
        </div>
      )}

      {/* Kept mounted through the reveal so the engine's cached box stays valid;
          it only has to be out of the way, not gone. It goes on the first mark
          too — choosing the art is a decision you make before you paint, and
          the bar would otherwise sit on top of the piece being revealed. */}
      <div
        className={`can-tabs${done || painted ? ' can-tabs--hidden' : ''}`}
        ref={canTabsRef}
        inert={done || painted}
      >
        <div className="can-tabs__bar" role="group" aria-label="Choose artwork">
          <span className="can-tabs__label">ART</span>
          {CAN_VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`can-tabs__button${v.id === canVariant ? ' can-tabs__button--active' : ''}`}
              aria-pressed={v.id === canVariant}
              onClick={() => setCanVariant(v.id)}
            >
              {/* A peek at the mural this can paints, so the choice is a choice of art. */}
              <img className="can-tabs__thumb" src={artUrl(ART[v.id].src)} alt="" aria-hidden="true" />
              <span className="can-tabs__name">{v.label}</span>
            </button>
          ))}
        </div>
      </div>

      {done && <RevealScreen onRestart={handleReset} />}

      <SprayCan ref={canRef} variant={canVariant} />
    </div>
  );
}
