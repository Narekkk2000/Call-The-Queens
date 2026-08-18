import { forwardRef } from 'react';

/**
 * The can designs the stage can wear. `id` doubles as the CSS modifier
 * (`.can--mono`) that picks the drop-shadow, so keep them in step.
 */
export const CAN_VARIANTS = [
  { id: 'mono', label: 'MONO' },
  { id: 'queens', label: 'QUEENS' },
  { id: 'chrome', label: 'CHROME' },
  { id: 'midnight', label: 'MIDNIGHT' },
  { id: 'vintage', label: 'VINTAGE' },
] as const;

export type CanVariant = (typeof CAN_VARIANTS)[number]['id'];

/**
 * Silhouette shared by every variant: valve cup, a short steep shoulder, then a
 * straight cylinder. The shoulder is what separates a spray can from a bottle —
 * it is a cone with small fillets, not an S-curve.
 */
const BODY_PATH = 'M64 79L64 87L38 115Q32 122 32 133L32 400L168 400L168 133Q168 122 162 115L136 87L136 79Z';

/** Fat cap sitting on the bare valve stem, the way a can looks while in use. */
const CAP_PATH = 'M72 45V17C72 8.7 78.7 2 87 2H113C121.3 2 128 8.7 128 17V45Z';

/**
 * The cursor. Position, rotation and scale are driven imperatively by
 * `SprayEngine` — this component only owns the artwork.
 *
 * Every variant draws into the same 200×424 viewBox and keeps the same
 * footprint (body x 32→168, tip at y 2, foot at y 400), so swapping designs
 * never changes how large the can renders at any viewport size: the engine
 * sets `.can` width from the stage and the artwork simply scales with it.
 * The nozzle sits at roughly (100, 9) in viewBox units, next to the (93, 12)
 * transform origin the engine anchors to — keep it there if you redraw this.
 *
 * Shading is what sells the cylinder: every horizontal gradient runs
 * dark → highlight → dark across the body so the can reads as round, and the
 * cap, collar and base rim get their own passes so the silhouette has depth.
 */
export const SprayCan = forwardRef<HTMLDivElement, { variant?: CanVariant }>(function SprayCan(
  { variant = 'mono' },
  ref,
) {
  return (
    <div ref={ref} className={`can can--${variant}`} aria-hidden="true">
      <svg className="can__svg" viewBox="0 0 200 424">
        {variant === 'mono' && <MonoArt />}
        {variant === 'queens' && <QueensArt />}
        {variant === 'chrome' && <ChromeArt />}
        {variant === 'midnight' && <MidnightArt />}
        {variant === 'vintage' && <VintageArt />}
      </svg>
    </div>
  );
});

/**
 * 01 — Mono. Bare mill-finish aluminium: no label, just brushed tooth, two
 * engraved rules, fine print running up the can and a chip of the colour
 * inside. All of the interest is in the metal.
 */
function MonoArt() {
  return (
    <>
      <defs>
        <clipPath id="ctqMBody">
          <path d={BODY_PATH} />
        </clipPath>
        <clipPath id="ctqMCap">
          <path d={CAP_PATH} />
        </clipPath>

        {/* Raw alu: bright specular at 24%, dark at both edges, rim light on the right. */}
        <linearGradient id="ctqMAlu" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3d414a" />
          <stop offset="0.05" stopColor="#767c87" />
          <stop offset="0.14" stopColor="#c4cad4" />
          <stop offset="0.24" stopColor="#eff2f7" />
          <stop offset="0.34" stopColor="#d2d7df" />
          <stop offset="0.52" stopColor="#a7acb6" />
          <stop offset="0.7" stopColor="#828791" />
          <stop offset="0.86" stopColor="#585c64" />
          <stop offset="0.96" stopColor="#383b43" />
          <stop offset="1" stopColor="#8b909a" />
        </linearGradient>

        {/* Light from above, floor darkening below. */}
        <linearGradient id="ctqMFall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000000" stopOpacity="0.42" />
          <stop offset="0.1" stopColor="#000000" stopOpacity="0.08" />
          <stop offset="0.22" stopColor="#ffffff" stopOpacity="0.06" />
          <stop offset="0.76" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.34" />
        </linearGradient>

        <linearGradient id="ctqMShoulder" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000000" stopOpacity="0.26" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </linearGradient>

        {/* Soft-touch black cap: a single broad sheen, no gloss. */}
        <linearGradient id="ctqMCapFill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0d0d10" />
          <stop offset="0.16" stopColor="#333238" />
          <stop offset="0.28" stopColor="#3f3e45" />
          <stop offset="0.52" stopColor="#232227" />
          <stop offset="0.84" stopColor="#131216" />
          <stop offset="1" stopColor="#2d2c33" />
        </linearGradient>

        <linearGradient id="ctqMCup" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#585c64" />
          <stop offset="0.2" stopColor="#c3c8d1" />
          <stop offset="0.38" stopColor="#e8ecf1" />
          <stop offset="0.6" stopColor="#9ba0aa" />
          <stop offset="0.85" stopColor="#5c6068" />
          <stop offset="1" stopColor="#8f949e" />
        </linearGradient>

        <linearGradient id="ctqMRim" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2c2f35" />
          <stop offset="0.2" stopColor="#8b9099" />
          <stop offset="0.33" stopColor="#b6bbc4" />
          <stop offset="0.6" stopColor="#71757e" />
          <stop offset="0.88" stopColor="#33363c" />
          <stop offset="1" stopColor="#666a72" />
        </linearGradient>

        <radialGradient id="ctqMGround" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="0.6" stopColor="#000000" stopOpacity="0.2" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="100" cy="404" rx="74" ry="15" fill="url(#ctqMGround)" />

      <g clipPath="url(#ctqMBody)">
        <rect x="28" y="75" width="144" height="330" fill="url(#ctqMAlu)" />

        {/* brushed tooth */}
        <g opacity="0.13">
          <path
            d="M50 79V400M74 79V400M97 79V400M126 79V400M150 79V400"
            stroke="#ffffff"
            strokeWidth="0.7"
          />
          <path d="M60 79V400M84 79V400M112 79V400M140 79V400" stroke="#000000" strokeWidth="0.7" />
        </g>

        <rect x="28" y="79" width="144" height="66" fill="url(#ctqMShoulder)" />

        {/* engraved rules: a dark groove with a lit lower edge */}
        <path d="M32 158H168" stroke="#000000" strokeOpacity="0.24" strokeWidth="1.1" />
        <path d="M32 159.6H168" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1.1" />
        <path d="M32 368H168" stroke="#000000" strokeOpacity="0.24" strokeWidth="1.1" />
        <path d="M32 369.6H168" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1.1" />

        {/* Type runs up the can. Rotated about (100, 252), so a line's `y` sets
            how far across the cylinder it sits and `x` sets its height. */}
        <text
          transform="rotate(-90 100 252)"
          x="100"
          y="252"
          textAnchor="middle"
          fontFamily="'Space Mono', monospace"
          fontSize="12"
          fontWeight="700"
          letterSpacing="4"
          fill="#20232a"
          fillOpacity="0.78"
        >
          CALL THE QUEENS
        </text>
        <text
          transform="rotate(-90 100 252)"
          x="100"
          y="284"
          textAnchor="middle"
          fontFamily="'Space Mono', monospace"
          fontSize="8"
          letterSpacing="2.4"
          fill="#20232a"
          fillOpacity="0.42"
        >
          400 ML · HIGH PRESSURE
        </text>
        <text
          transform="rotate(-90 100 252)"
          x="100"
          y="220"
          textAnchor="middle"
          fontFamily="'Space Mono', monospace"
          fontSize="8"
          letterSpacing="2.4"
          fill="#20232a"
          fillOpacity="0.42"
        >
          NO. 01 — RAW ALU
        </text>

        {/* chip of the colour inside, the way a real rack can carries it */}
        <rect x="91" y="344" width="18" height="18" rx="3" fill="#e8218f" />
        <rect
          x="91"
          y="344"
          width="18"
          height="18"
          rx="3"
          fill="none"
          stroke="#20232a"
          strokeOpacity="0.35"
          strokeWidth="1"
        />

        <rect x="28" y="75" width="144" height="330" fill="url(#ctqMFall)" />
      </g>

      {/* rolled base rim */}
      <rect x="32" y="378" width="136" height="22" rx="5" fill="url(#ctqMRim)" />
      <path d="M33 380H167" stroke="#000000" strokeOpacity="0.35" strokeWidth="1.4" />
      <path d="M33 396.5H167" stroke="#000000" strokeOpacity="0.55" strokeWidth="4" />

      {/* crimp bead and valve cup */}
      <rect x="58" y="65" width="84" height="16" rx="6" fill="url(#ctqMRim)" />
      <path d="M60 79H140" stroke="#000000" strokeOpacity="0.3" strokeWidth="1.6" />
      <rect x="66" y="51" width="68" height="16" rx="3" fill="url(#ctqMCup)" />
      <path d="M68 55H132" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="1" />

      <rect x="88" y="39" width="24" height="16" rx="2" fill="#1b1a1f" />

      <path d={CAP_PATH} fill="url(#ctqMCapFill)" />
      <g clipPath="url(#ctqMCap)">
        <path
          d="M79 45V19C79 15 80.5 12 83 10"
          stroke="#ffffff"
          strokeOpacity="0.17"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <rect x="70" y="35" width="60" height="1.2" fill="#000000" fillOpacity="0.38" />
        <rect x="70" y="2" width="60" height="7" fill="#000000" fillOpacity="0.22" />
      </g>

      {/* outlet */}
      <ellipse cx="100" cy="9" rx="10" ry="5" fill="#0a0a0c" />
      <ellipse cx="100" cy="8.2" rx="5" ry="2.6" fill="#000000" />
      <path
        d="M90.5 7.6A10 5 0 0 1 109.5 7.6"
        stroke="#c9ced8"
        strokeOpacity="0.32"
        strokeWidth="1"
        fill="none"
      />
    </>
  );
}

/**
 * 02 — Queens. Matte black can with a wrapped white label, the wordmark set in
 * the site's Archivo italic running up the cylinder, and a magenta cap.
 */
function QueensArt() {
  return (
    <>
      <defs>
        <clipPath id="ctqQBody">
          <path d={BODY_PATH} />
        </clipPath>
        <clipPath id="ctqQCap">
          <path d={CAP_PATH} />
        </clipPath>

        <linearGradient id="ctqQBlack" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0a0a0c" />
          <stop offset="0.09" stopColor="#1f1e25" />
          <stop offset="0.22" stopColor="#35333e" />
          <stop offset="0.32" stopColor="#2b2a33" />
          <stop offset="0.55" stopColor="#1a1920" />
          <stop offset="0.8" stopColor="#0f0e13" />
          <stop offset="0.95" stopColor="#08080a" />
          <stop offset="1" stopColor="#3a3843" />
        </linearGradient>

        {/* One pass over label and body alike, so the flat label wraps the cylinder. */}
        <linearGradient id="ctqQWrap" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000000" stopOpacity="0.55" />
          <stop offset="0.08" stopColor="#000000" stopOpacity="0.2" />
          <stop offset="0.22" stopColor="#ffffff" stopOpacity="0.14" />
          <stop offset="0.36" stopColor="#ffffff" stopOpacity="0.02" />
          <stop offset="0.52" stopColor="#000000" stopOpacity="0" />
          <stop offset="0.7" stopColor="#000000" stopOpacity="0.14" />
          <stop offset="0.88" stopColor="#000000" stopOpacity="0.38" />
          <stop offset="0.98" stopColor="#000000" stopOpacity="0.6" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.18" />
        </linearGradient>

        <linearGradient id="ctqQFall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000000" stopOpacity="0.42" />
          <stop offset="0.14" stopColor="#000000" stopOpacity="0" />
          <stop offset="0.82" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.42" />
        </linearGradient>

        <linearGradient id="ctqQCapFill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8e0a6a" />
          <stop offset="0.16" stopColor="#ff4fb8" />
          <stop offset="0.3" stopColor="#ff8ed6" />
          <stop offset="0.55" stopColor="#e5218f" />
          <stop offset="0.85" stopColor="#8d0a63" />
          <stop offset="1" stopColor="#c82a8c" />
        </linearGradient>

        <linearGradient id="ctqQCup" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4c505a" />
          <stop offset="0.2" stopColor="#b9bec8" />
          <stop offset="0.4" stopColor="#e4e8ee" />
          <stop offset="0.65" stopColor="#8e939d" />
          <stop offset="0.9" stopColor="#4a4e57" />
          <stop offset="1" stopColor="#83888f" />
        </linearGradient>

        <linearGradient id="ctqQRim" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#08080a" />
          <stop offset="0.2" stopColor="#2c2b33" />
          <stop offset="0.35" stopColor="#3c3a45" />
          <stop offset="0.65" stopColor="#1b1a20" />
          <stop offset="0.9" stopColor="#0a0a0d" />
          <stop offset="1" stopColor="#2a2932" />
        </linearGradient>

        <radialGradient id="ctqQGround" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000000" stopOpacity="0.55" />
          <stop offset="0.6" stopColor="#000000" stopOpacity="0.22" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="100" cy="404" rx="74" ry="15" fill="url(#ctqQGround)" />

      <g clipPath="url(#ctqQBody)">
        <rect x="28" y="75" width="144" height="330" fill="url(#ctqQBlack)" />

        <rect x="28" y="146" width="144" height="222" fill="#f7f6f9" />
        <rect x="28" y="146" width="144" height="8" fill="#e8218f" />
        <rect x="28" y="362" width="144" height="6" fill="#e8218f" />

        {/* Wordmark rotated about (100, 257): `y` places each line across the
            can, `x` sets where it starts up its height. */}
        <text
          transform="rotate(-90 100 257)"
          x="100"
          y="243"
          textAnchor="middle"
          fontFamily="Archivo, sans-serif"
          fontStyle="italic"
          fontWeight="900"
          fontSize="34"
          letterSpacing="-1"
          fill="#0b0a0d"
        >
          CALL THE
        </text>
        <text
          transform="rotate(-90 100 257)"
          x="100"
          y="275"
          textAnchor="middle"
          fontFamily="Archivo, sans-serif"
          fontStyle="italic"
          fontWeight="900"
          fontSize="34"
          letterSpacing="-1"
          fill="#0b0a0d"
        >
          QUEENS
        </text>
        <text
          transform="rotate(-90 100 257)"
          x="100"
          y="304"
          textAnchor="middle"
          fontFamily="'Space Mono', monospace"
          fontSize="8"
          letterSpacing="2.6"
          fill="#0b0a0d"
          fillOpacity="0.55"
        >
          NORTH HOLLYWOOD · CA
        </text>
        <text
          transform="rotate(-90 100 257)"
          x="100"
          y="212"
          textAnchor="middle"
          fontFamily="'Space Mono', monospace"
          fontSize="8"
          letterSpacing="2.6"
          fill="#0b0a0d"
          fillOpacity="0.55"
        >
          AEROSOL ENAMEL · 400 ML
        </text>

        <rect x="28" y="75" width="144" height="330" fill="url(#ctqQWrap)" />
        <rect x="28" y="75" width="144" height="330" fill="url(#ctqQFall)" />
      </g>

      <rect x="32" y="378" width="136" height="22" rx="5" fill="url(#ctqQRim)" />
      <path d="M33 380H167" stroke="#000000" strokeOpacity="0.5" strokeWidth="1.4" />
      <path d="M33 396.5H167" stroke="#000000" strokeOpacity="0.65" strokeWidth="4" />

      <rect x="58" y="65" width="84" height="16" rx="6" fill="url(#ctqQRim)" />
      <path d="M60 79H140" stroke="#000000" strokeOpacity="0.45" strokeWidth="1.6" />
      <rect x="66" y="51" width="68" height="16" rx="3" fill="url(#ctqQCup)" />
      <path d="M68 55H132" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="1" />

      <rect x="88" y="39" width="24" height="16" rx="2" fill="#141319" />

      <path d={CAP_PATH} fill="url(#ctqQCapFill)" />
      <g clipPath="url(#ctqQCap)">
        <path
          d="M79 45V19C79 15 80.5 12 83 10"
          stroke="#ffffff"
          strokeOpacity="0.45"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <rect x="70" y="35" width="60" height="1.2" fill="#3d0129" fillOpacity="0.5" />
        <rect x="70" y="2" width="60" height="7" fill="#ffffff" fillOpacity="0.16" />
      </g>

      <ellipse cx="100" cy="9" rx="10" ry="5" fill="#4d0233" />
      <ellipse cx="100" cy="8.2" rx="5" ry="2.6" fill="#14000d" />
      <path
        d="M90.5 7.6A10 5 0 0 1 109.5 7.6"
        stroke="#ffd9f0"
        strokeOpacity="0.5"
        strokeWidth="1"
        fill="none"
      />
    </>
  );
}

/**
 * 03 — Chrome. Mirror finish, so the can is mostly its surroundings: hard
 * banding across the cylinder, a bright sky above the horizon line and the
 * room's neon bouncing back off the floor.
 */
function ChromeArt() {
  return (
    <>
      <defs>
        <clipPath id="ctqCBody">
          <path d={BODY_PATH} />
        </clipPath>
        <clipPath id="ctqCCap">
          <path d={CAP_PATH} />
        </clipPath>

        {/* Chrome is high-contrast banding, not a smooth ramp. */}
        <linearGradient id="ctqCMirror" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#161a22" />
          <stop offset="0.06" stopColor="#8e99ad" />
          <stop offset="0.13" stopColor="#f2f7ff" />
          <stop offset="0.2" stopColor="#69748a" />
          <stop offset="0.3" stopColor="#14171e" />
          <stop offset="0.4" stopColor="#39404e" />
          <stop offset="0.52" stopColor="#aab5c6" />
          <stop offset="0.6" stopColor="#f8fbff" />
          <stop offset="0.68" stopColor="#9aa4b6" />
          <stop offset="0.78" stopColor="#454c5b" />
          <stop offset="0.9" stopColor="#171b23" />
          <stop offset="1" stopColor="#93a0b4" />
        </linearGradient>

        {/* What the mirror is looking at: sky, horizon, floor, neon. */}
        <linearGradient id="ctqCEnv" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dbe8ff" stopOpacity="0.38" />
          <stop offset="0.18" stopColor="#b9caea" stopOpacity="0.12" />
          <stop offset="0.4" stopColor="#000010" stopOpacity="0" />
          <stop offset="0.49" stopColor="#000010" stopOpacity="0.5" />
          <stop offset="0.57" stopColor="#000010" stopOpacity="0.16" />
          <stop offset="0.72" stopColor="#000010" stopOpacity="0" />
          <stop offset="0.9" stopColor="#ff2e9a" stopOpacity="0.22" />
          <stop offset="1" stopColor="#1a0012" stopOpacity="0.5" />
        </linearGradient>

        <linearGradient id="ctqCCapFill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#08080b" />
          <stop offset="0.14" stopColor="#2a2833" />
          <stop offset="0.28" stopColor="#443f52" />
          <stop offset="0.5" stopColor="#191720" />
          <stop offset="0.8" stopColor="#0b0b0f" />
          <stop offset="1" stopColor="#ff2e9a" />
        </linearGradient>

        <linearGradient id="ctqCSteel" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2b303b" />
          <stop offset="0.18" stopColor="#dfe7f2" />
          <stop offset="0.36" stopColor="#7d8798" />
          <stop offset="0.58" stopColor="#eff4fb" />
          <stop offset="0.8" stopColor="#4b515e" />
          <stop offset="1" stopColor="#aab3c2" />
        </linearGradient>

        <radialGradient id="ctqCGround" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000000" stopOpacity="0.55" />
          <stop offset="0.6" stopColor="#000000" stopOpacity="0.22" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="100" cy="404" rx="74" ry="15" fill="url(#ctqCGround)" />

      <g clipPath="url(#ctqCBody)">
        <rect x="28" y="75" width="144" height="330" fill="url(#ctqCMirror)" />
        <rect x="28" y="75" width="144" height="330" fill="url(#ctqCEnv)" />

        {/* horizon: the hard edge that reads as a mirror rather than metal */}
        <rect x="28" y="240" width="144" height="2.5" fill="#ffffff" fillOpacity="0.7" />
        <rect x="28" y="242.5" width="144" height="7" fill="#000000" fillOpacity="0.4" />
        <rect x="28" y="249.5" width="144" height="1.6" fill="#ff86d2" fillOpacity="0.45" />
        {/* neon bouncing off the floor */}
        <rect x="28" y="378" width="144" height="2" fill="#ff86d2" fillOpacity="0.3" />

        {/* The mirror swings from near-black to near-white across the body, so a
            flat white wordmark dissolves into the light bands. A dark halo under
            a solid white face carries it over every band — and reads as type
            etched into chrome rather than printed on it. */}
        <text
          transform="rotate(-90 100 192)"
          x="100"
          y="192"
          textAnchor="middle"
          fontFamily="'Space Mono', monospace"
          fontSize="10.5"
          fontWeight="700"
          letterSpacing="6"
          fill="#ffffff"
          stroke="#080b12"
          strokeOpacity="0.66"
          strokeWidth="2.6"
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          CALL THE QUEENS
        </text>
      </g>

      <rect x="32" y="378" width="136" height="22" rx="5" fill="url(#ctqCSteel)" />
      <rect x="32" y="386" width="136" height="14" rx="5" fill="#ff2e9a" opacity="0.22" />
      <path d="M33 380H167" stroke="#000000" strokeOpacity="0.45" strokeWidth="1.4" />
      <path d="M33 396.5H167" stroke="#000000" strokeOpacity="0.55" strokeWidth="4" />

      <rect x="58" y="65" width="84" height="16" rx="6" fill="url(#ctqCSteel)" />
      <rect x="58" y="74" width="84" height="4" fill="#ff2e9a" opacity="0.32" />
      <path d="M60 79H140" stroke="#000000" strokeOpacity="0.4" strokeWidth="1.6" />
      <rect x="66" y="51" width="68" height="16" rx="3" fill="url(#ctqCSteel)" />
      <path d="M68 55H132" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1" />

      <rect x="88" y="39" width="24" height="16" rx="2" fill="#121118" />

      <path d={CAP_PATH} fill="url(#ctqCCapFill)" />
      <g clipPath="url(#ctqCCap)">
        <path
          d="M79 45V19C79 15 80.5 12 83 10"
          stroke="#ffffff"
          strokeOpacity="0.32"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <rect x="70" y="38" width="60" height="3" fill="#ff2e9a" fillOpacity="0.8" />
        <rect x="70" y="2" width="60" height="7" fill="#ffffff" fillOpacity="0.1" />
      </g>

      <ellipse cx="100" cy="9" rx="10" ry="5" fill="#08080a" />
      <ellipse cx="100" cy="8.2" rx="5" ry="2.6" fill="#000000" />
      <path
        d="M90.5 7.6A10 5 0 0 1 109.5 7.6"
        stroke="#ff8ed6"
        strokeOpacity="0.55"
        strokeWidth="1"
        fill="none"
      />
    </>
  );
}

/**
 * 04 — Midnight. Black on black: a matte body carrying a gloss-varnish
 * wordmark, read only by the sheen. A dark can needs its edges lit or it
 * dissolves into the wall, so both rims carry a hard highlight and every metal
 * part — cup, crimp, base rim — is polished rather than blacked out.
 */
function MidnightArt() {
  return (
    <>
      <defs>
        <clipPath id="ctqNBody">
          <path d={BODY_PATH} />
        </clipPath>
        <clipPath id="ctqNCap">
          <path d={CAP_PATH} />
        </clipPath>

        <linearGradient id="ctqNBlack" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6a6678" />
          <stop offset="0.045" stopColor="#0d0d11" />
          <stop offset="0.14" stopColor="#232128" />
          <stop offset="0.24" stopColor="#3a3844" />
          <stop offset="0.34" stopColor="#1d1c25" />
          <stop offset="0.5" stopColor="#0e0d12" />
          <stop offset="0.66" stopColor="#16151c" />
          <stop offset="0.82" stopColor="#0b0a0e" />
          <stop offset="0.95" stopColor="#08080a" />
          <stop offset="1" stopColor="#56525f" />
        </linearGradient>

        <linearGradient id="ctqNFall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000000" stopOpacity="0.45" />
          <stop offset="0.13" stopColor="#000000" stopOpacity="0" />
          <stop offset="0.8" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.4" />
        </linearGradient>

        {/* Gloss cap: a harder, narrower highlight than the matte body. */}
        <linearGradient id="ctqNCapFill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0a0a0d" />
          <stop offset="0.12" stopColor="#35333f" />
          <stop offset="0.22" stopColor="#4a4757" />
          <stop offset="0.3" stopColor="#23212a" />
          <stop offset="0.55" stopColor="#121118" />
          <stop offset="0.85" stopColor="#08080a" />
          <stop offset="1" stopColor="#322f3b" />
        </linearGradient>

        <linearGradient id="ctqNSteel" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3a3d45" />
          <stop offset="0.18" stopColor="#cfd4dd" />
          <stop offset="0.34" stopColor="#f1f4f8" />
          <stop offset="0.58" stopColor="#9ba0aa" />
          <stop offset="0.84" stopColor="#4d515a" />
          <stop offset="1" stopColor="#9aa0aa" />
        </linearGradient>

        <radialGradient id="ctqNGround" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000000" stopOpacity="0.6" />
          <stop offset="0.6" stopColor="#000000" stopOpacity="0.24" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="100" cy="404" rx="74" ry="15" fill="url(#ctqNGround)" />

      <g clipPath="url(#ctqNBody)">
        <rect x="28" y="75" width="144" height="330" fill="url(#ctqNBlack)" />

        {/* magenta hairlines framing the wordmark */}
        <rect x="28" y="147" width="144" height="1.5" fill="#ff2e9a" fillOpacity="0.5" />
        <rect x="28" y="357" width="144" height="1.5" fill="#ff2e9a" fillOpacity="0.5" />

        {/* Varnish: a dark edge under a faint sheen is what makes gloss read on
            matte at this size — neither line is legible alone. */}
        <text
          transform="rotate(-90 100 252)"
          x="99"
          y="253"
          textAnchor="middle"
          fontFamily="Archivo, sans-serif"
          fontStyle="italic"
          fontWeight="900"
          fontSize="26"
          letterSpacing="-0.5"
          fill="#000000"
          fillOpacity="0.55"
        >
          CALL THE QUEENS
        </text>
        <text
          transform="rotate(-90 100 252)"
          x="100"
          y="252"
          textAnchor="middle"
          fontFamily="Archivo, sans-serif"
          fontStyle="italic"
          fontWeight="900"
          fontSize="26"
          letterSpacing="-0.5"
          fill="#ffffff"
          fillOpacity="0.1"
        >
          CALL THE QUEENS
        </text>

        <text
          transform="rotate(-90 100 252)"
          x="100"
          y="292"
          textAnchor="middle"
          fontFamily="'Space Mono', monospace"
          fontSize="8"
          letterSpacing="2.4"
          fill="#ff2e9a"
          fillOpacity="0.55"
        >
          NO. 04 — MIDNIGHT
        </text>
        <text
          transform="rotate(-90 100 252)"
          x="100"
          y="212"
          textAnchor="middle"
          fontFamily="'Space Mono', monospace"
          fontSize="8"
          letterSpacing="2.4"
          fill="#ffffff"
          fillOpacity="0.3"
        >
          400 ML · MATTE
        </text>

        <rect x="28" y="75" width="144" height="330" fill="url(#ctqNFall)" />
      </g>

      <rect x="32" y="378" width="136" height="22" rx="5" fill="url(#ctqNSteel)" />
      <path d="M33 380H167" stroke="#000000" strokeOpacity="0.4" strokeWidth="1.4" />
      <path d="M33 396.5H167" stroke="#000000" strokeOpacity="0.5" strokeWidth="4" />

      <rect x="58" y="65" width="84" height="16" rx="6" fill="url(#ctqNSteel)" />
      <path d="M60 79H140" stroke="#000000" strokeOpacity="0.35" strokeWidth="1.6" />
      <rect x="66" y="51" width="68" height="16" rx="3" fill="url(#ctqNSteel)" />
      <path d="M68 55H132" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1" />

      <rect x="88" y="39" width="24" height="16" rx="2" fill="#100f14" />

      <path d={CAP_PATH} fill="url(#ctqNCapFill)" />
      <g clipPath="url(#ctqNCap)">
        <path
          d="M79 45V19C79 15 80.5 12 83 10"
          stroke="#ffffff"
          strokeOpacity="0.3"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <rect x="70" y="35" width="60" height="1.2" fill="#000000" fillOpacity="0.5" />
        <rect x="70" y="2" width="60" height="7" fill="#ffffff" fillOpacity="0.07" />
      </g>

      <ellipse cx="100" cy="9" rx="10" ry="5" fill="#08080a" />
      <ellipse cx="100" cy="8.2" rx="5" ry="2.6" fill="#000000" />
      <path
        d="M90.5 7.6A10 5 0 0 1 109.5 7.6"
        stroke="#8f8b9c"
        strokeOpacity="0.5"
        strokeWidth="1"
        fill="none"
      />
    </>
  );
}

/**
 * 05 — Vintage. Warm ivory enamel with an oxblood band, and the only design in
 * the set that shows use: chipped edges and runs of the wall's own magenta
 * down the body. The wordmark is set upright and tracked, so it reads as an
 * old rack can rather than a second take on the branded one.
 */
function VintageArt() {
  return (
    <>
      <defs>
        <clipPath id="ctqVBody">
          <path d={BODY_PATH} />
        </clipPath>
        <clipPath id="ctqVCap">
          <path d={CAP_PATH} />
        </clipPath>

        <linearGradient id="ctqVIvory" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5c5348" />
          <stop offset="0.06" stopColor="#9c9082" />
          <stop offset="0.15" stopColor="#ded3c0" />
          <stop offset="0.24" stopColor="#f6f0e2" />
          <stop offset="0.34" stopColor="#e6dccb" />
          <stop offset="0.52" stopColor="#cdc2b0" />
          <stop offset="0.7" stopColor="#a89c8c" />
          <stop offset="0.86" stopColor="#7a7063" />
          <stop offset="0.96" stopColor="#514a41" />
          <stop offset="1" stopColor="#8f8677" />
        </linearGradient>

        {/* Re-shades the flat oxblood band onto the cylinder. */}
        <linearGradient id="ctqVWrap" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000000" stopOpacity="0.45" />
          <stop offset="0.1" stopColor="#000000" stopOpacity="0.12" />
          <stop offset="0.24" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="0.4" stopColor="#ffffff" stopOpacity="0.03" />
          <stop offset="0.55" stopColor="#000000" stopOpacity="0" />
          <stop offset="0.74" stopColor="#000000" stopOpacity="0.16" />
          <stop offset="0.9" stopColor="#000000" stopOpacity="0.36" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.5" />
        </linearGradient>

        <linearGradient id="ctqVFall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2a18" stopOpacity="0.4" />
          <stop offset="0.12" stopColor="#3a2a18" stopOpacity="0.05" />
          <stop offset="0.78" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#241a10" stopOpacity="0.4" />
        </linearGradient>

        <linearGradient id="ctqVCapFill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#544c42" />
          <stop offset="0.16" stopColor="#b3a89a" />
          <stop offset="0.3" stopColor="#d9d0be" />
          <stop offset="0.55" stopColor="#a2988a" />
          <stop offset="0.85" stopColor="#5f574c" />
          <stop offset="1" stopColor="#8b8274" />
        </linearGradient>

        <linearGradient id="ctqVSteel" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#413a33" />
          <stop offset="0.2" stopColor="#a49a8c" />
          <stop offset="0.35" stopColor="#c8bfb0" />
          <stop offset="0.62" stopColor="#877e72" />
          <stop offset="0.88" stopColor="#463f38" />
          <stop offset="1" stopColor="#7c7367" />
        </linearGradient>

        <radialGradient id="ctqVGround" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000000" stopOpacity="0.55" />
          <stop offset="0.6" stopColor="#000000" stopOpacity="0.22" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="100" cy="404" rx="74" ry="15" fill="url(#ctqVGround)" />

      <g clipPath="url(#ctqVBody)">
        <rect x="28" y="75" width="144" height="330" fill="url(#ctqVIvory)" />

        {/* oxblood band with hairlines above and below */}
        <rect x="28" y="168" width="144" height="152" fill="#6d1c2a" />
        <rect x="28" y="150" width="144" height="1.6" fill="#6d1c2a" fillOpacity="0.8" />
        <rect x="28" y="154" width="144" height="1.6" fill="#6d1c2a" fillOpacity="0.8" />
        <rect x="28" y="334" width="144" height="1.6" fill="#6d1c2a" fillOpacity="0.8" />

        <text
          transform="rotate(-90 100 244)"
          x="100"
          y="244"
          textAnchor="middle"
          fontFamily="Archivo, sans-serif"
          fontWeight="800"
          fontSize="13.5"
          letterSpacing="2"
          fill="#f4ecdc"
        >
          CALL THE QUEENS
        </text>
        <text
          transform="rotate(-90 100 244)"
          x="100"
          y="272"
          textAnchor="middle"
          fontFamily="'Space Mono', monospace"
          fontSize="7.5"
          letterSpacing="2.2"
          fill="#f4ecdc"
          fillOpacity="0.6"
        >
          EST. NORTH HOLLYWOOD
        </text>
        <text
          transform="rotate(-90 100 244)"
          x="100"
          y="216"
          textAnchor="middle"
          fontFamily="'Space Mono', monospace"
          fontSize="7.5"
          letterSpacing="2.2"
          fill="#f4ecdc"
          fillOpacity="0.6"
        >
          NO. 05 · 400 ML
        </text>

        {/* Runs of the wall's own colour, caught on the shoulder and pulled
            down by gravity — the tell that this can has been worked with. Each
            one starts thin, thickens as it gathers, and ends in a heavy head. */}
        <g fill="#ff2e9a" fillOpacity="0.72">
          <rect x="52.6" y="136" width="1.5" height="76" rx="0.75" />
          <rect x="52" y="198" width="2.7" height="52" rx="1.35" />
          <ellipse cx="53.4" cy="251" rx="2.9" ry="3.6" />

          <rect x="118.4" y="148" width="1.3" height="40" rx="0.65" />
          <rect x="118" y="180" width="2.2" height="22" rx="1.1" />
          <ellipse cx="119.1" cy="203" rx="2.4" ry="3" />

          <rect x="150.2" y="132" width="1.4" height="104" rx="0.7" />
          <rect x="149.6" y="222" width="2.5" height="72" rx="1.25" />
          <ellipse cx="150.9" cy="295" rx="2.7" ry="3.4" />

          <ellipse cx="66" cy="174" rx="1.5" ry="1.9" />
          <circle cx="133" cy="204" r="1.1" />
          <circle cx="94" cy="158" r="0.9" />
        </g>

        {/* chips in the enamel */}
        <g fill="#4b4238" fillOpacity="0.35">
          <ellipse cx="37" cy="212" rx="3.5" ry="6" />
          <ellipse cx="163" cy="288" rx="3" ry="7" />
          <ellipse cx="41" cy="352" rx="2.4" ry="4" />
          <ellipse cx="158" cy="146" rx="2.6" ry="4.5" />
        </g>

        <rect x="28" y="75" width="144" height="330" fill="url(#ctqVWrap)" />
        <rect x="28" y="75" width="144" height="330" fill="url(#ctqVFall)" />
      </g>

      <rect x="32" y="378" width="136" height="22" rx="5" fill="url(#ctqVSteel)" />
      <path d="M33 380H167" stroke="#2a231c" strokeOpacity="0.5" strokeWidth="1.4" />
      <path d="M33 396.5H167" stroke="#1d1813" strokeOpacity="0.6" strokeWidth="4" />

      <rect x="58" y="65" width="84" height="16" rx="6" fill="url(#ctqVSteel)" />
      <path d="M60 79H140" stroke="#2a231c" strokeOpacity="0.45" strokeWidth="1.6" />
      <rect x="66" y="51" width="68" height="16" rx="3" fill="url(#ctqVSteel)" />
      <path d="M68 55H132" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1" />

      <rect x="88" y="39" width="24" height="16" rx="2" fill="#332c25" />

      <path d={CAP_PATH} fill="url(#ctqVCapFill)" />
      <g clipPath="url(#ctqVCap)">
        <path
          d="M79 45V19C79 15 80.5 12 83 10"
          stroke="#ffffff"
          strokeOpacity="0.3"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <rect x="70" y="35" width="60" height="1.2" fill="#3a3128" fillOpacity="0.5" />
        {/* paint dried on the cap, heaviest where the fingertip sits */}
        <ellipse cx="87" cy="20" rx="8" ry="3.4" fill="#ff2e9a" fillOpacity="0.32" />
        <ellipse cx="112" cy="17" rx="5.5" ry="2.6" fill="#ff2e9a" fillOpacity="0.24" />
        <rect x="85" y="20" width="1.6" height="14" rx="0.8" fill="#ff2e9a" fillOpacity="0.3" />
      </g>

      <ellipse cx="100" cy="9" rx="10" ry="5" fill="#2a2018" />
      <ellipse cx="100" cy="8.2" rx="5" ry="2.6" fill="#120d09" />
      <path
        d="M90.5 7.6A10 5 0 0 1 109.5 7.6"
        stroke="#ffb3e0"
        strokeOpacity="0.45"
        strokeWidth="1"
        fill="none"
      />
    </>
  );
}
