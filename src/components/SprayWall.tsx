import { useCallback, useEffect, useRef, useState } from 'react';
import { SprayEngine, type SprayConfig } from '../spray/SprayEngine';
import { RevealScreen } from './RevealScreen';
import { SprayCan } from './SprayCan';
import './SprayWall.css';

export type SprayWallProps = Partial<SprayConfig>;

const DEFAULTS: SprayConfig = {
  // `radius` is intentionally absent: it is derived from the stage size so the
  // effort to reveal the wall is the same on every display.
  radiusScale: 1,
  threshold: 0.6,
  drips: true,
  sound: true,
  canSize: 1,
  // Beat of silence on the finished mural before the coming-soon screen.
  revealDelay: 1200,
};

export function SprayWall(overrides: SprayWallProps) {
  const [done, setDone] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hintVisible, setHintVisible] = useState(true);

  const wrapRef = useRef<HTMLDivElement>(null);
  const paintRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLCanvasElement>(null);
  const mistRef = useRef<HTMLCanvasElement>(null);
  const floorRef = useRef<HTMLCanvasElement>(null);
  const grainRef = useRef<HTMLCanvasElement>(null);
  const canRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SprayEngine | null>(null);

  // The engine runs outside React's render cycle, so it reads state through a
  // ref that is kept current on every commit.
  const latest = useRef({ done, muted, config: { ...DEFAULTS, ...overrides } });
  latest.current.done = done;
  latest.current.muted = muted;
  latest.current.config = { ...DEFAULTS, ...overrides };

  useEffect(() => {
    const els = {
      wrap: wrapRef.current,
      paint: paintRef.current,
      glow: glowRef.current,
      mist: mistRef.current,
      floor: floorRef.current,
      grain: grainRef.current,
      can: canRef.current,
      controls: controlsRef.current,
    };
    if (Object.values(els).some((el) => el === null)) return;

    const engine = new SprayEngine(
      els as Required<{ [K in keyof typeof els]: NonNullable<(typeof els)[K]> }>,
      {
        getConfig: () => latest.current.config,
        isDone: () => latest.current.done,
        isMuted: () => latest.current.muted,
        onComplete: () => setDone(true),
        onProgress: setProgress,
        onHintVisibleChange: setHintVisible,
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

  const handleReset = useCallback(() => {
    engineRef.current?.clearWall();
    setDone(false);
  }, []);

  const pct = Math.round(progress * 100);

  return (
    <div className="wall" ref={wrapRef}>
      <div className="wall__surface">
        <div className="wall__seams" />
        <div className="wall__course-line" />
        <canvas className="wall__canvas" ref={paintRef} />
        <canvas className="wall__canvas wall__canvas--glow" ref={glowRef} />
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

      <div className="hint" style={{ opacity: hintVisible ? 1 : 0 }}>
        <div className="hint__row">
          <div className="hint__rule hint__rule--left" />
          <div className="hint__headline">Hold &amp; drag your mouse to spray</div>
          <div className="hint__rule hint__rule--right" />
        </div>
        <div className="hint__sub">Reveal the wall</div>
        <div className="hint__tail" />
      </div>

      <div className="controls" ref={controlsRef}>
        <button type="button" className="controls__button" onClick={() => setMuted((m) => !m)}>
          {muted ? 'SOUND OFF' : 'SOUND ON'}
        </button>
        <button type="button" className="controls__button" onClick={handleReset}>
          RESET
        </button>
      </div>

      {!done && (
        <div className="hud">
          <div className="hud__label">REVEALED</div>
          <div className="hud__track">
            <div className="hud__fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="hud__pct">{pct}%</div>
        </div>
      )}

      {done && <RevealScreen />}

      <SprayCan ref={canRef} />
    </div>
  );
}
