import { forwardRef } from 'react';

/**
 * The cursor. Position, rotation and scale are driven imperatively by
 * `SprayEngine` — this component only owns the artwork.
 *
 * Shading is what sells the cylinder: every horizontal gradient runs
 * dark → highlight → dark across the body so the can reads as round, and the
 * cap/collar/base get their own ellipses so the silhouette has real depth.
 * The nozzle sits at roughly (93, 12) in viewBox units, which is where the
 * engine anchors its transform origin — keep it there if you redraw this.
 */
export const SprayCan = forwardRef<HTMLDivElement>(function SprayCan(_props, ref) {
  return (
    <div ref={ref} className="can" aria-hidden="true">
      <svg className="can__svg" viewBox="0 0 200 424">
        <defs>
          {/* Brushed aluminium body: two speculars, dark at both edges. */}
          <linearGradient id="ctqBody" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6f6c7a" />
            <stop offset="0.05" stopColor="#a8a5b4" />
            <stop offset="0.16" stopColor="#e9e7ee" />
            <stop offset="0.26" stopColor="#ffffff" />
            <stop offset="0.38" stopColor="#eceaf1" />
            <stop offset="0.58" stopColor="#cbc8d4" />
            <stop offset="0.78" stopColor="#a5a2b0" />
            <stop offset="0.92" stopColor="#7d7a88" />
            <stop offset="1" stopColor="#5d5a67" />
          </linearGradient>

          {/* Label wraps the cylinder, so it darkens toward both edges too. */}
          <linearGradient id="ctqLabel" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#5c0c33" />
            <stop offset="0.1" stopColor="#a82a69" />
            <stop offset="0.24" stopColor="#ff6fb8" />
            <stop offset="0.36" stopColor="#ff8fc9" />
            <stop offset="0.52" stopColor="#f2559f" />
            <stop offset="0.74" stopColor="#c92c77" />
            <stop offset="0.9" stopColor="#8d1750" />
            <stop offset="1" stopColor="#520a2c" />
          </linearGradient>

          <linearGradient id="ctqCap" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#1a181f" />
            <stop offset="0.16" stopColor="#3d3a46" />
            <stop offset="0.3" stopColor="#56525f" />
            <stop offset="0.5" stopColor="#413d4a" />
            <stop offset="0.78" stopColor="#2a272f" />
            <stop offset="1" stopColor="#151319" />
          </linearGradient>

          <linearGradient id="ctqCollar" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#67646f" />
            <stop offset="0.2" stopColor="#c3c0cb" />
            <stop offset="0.3" stopColor="#e8e6ec" />
            <stop offset="0.55" stopColor="#a9a6b2" />
            <stop offset="0.8" stopColor="#7c7985" />
            <stop offset="1" stopColor="#55525c" />
          </linearGradient>

          <linearGradient id="ctqTip" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#2b2832" />
            <stop offset="0.35" stopColor="#5f5b69" />
            <stop offset="0.6" stopColor="#46424e" />
            <stop offset="1" stopColor="#22202a" />
          </linearGradient>

          {/* Soft vertical falloff for the long specular streak. */}
          <linearGradient id="ctqSpec" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.14" stopColor="#ffffff" stopOpacity="0.75" />
            <stop offset="0.72" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>

          {/* Shoulder catches light from above. */}
          <linearGradient id="ctqShoulder" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>

          <radialGradient id="ctqGroundShadow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#000000" stopOpacity="0.55" />
            <stop offset="0.6" stopColor="#000000" stopOpacity="0.22" />
            <stop offset="1" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* contact shadow, replacing the three flat black blobs */}
        <ellipse cx="100" cy="406" rx="78" ry="17" fill="url(#ctqGroundShadow)" />

        {/* spray tip and actuator */}
        <rect x="86" y="4" width="26" height="13" rx="4" fill="url(#ctqTip)" />
        <ellipse cx="99" cy="6" rx="9" ry="3" fill="#100e14" opacity="0.85" />
        <rect x="76" y="15" width="48" height="27" rx="9" fill="url(#ctqTip)" />
        <rect x="83" y="19" width="9" height="15" rx="4" fill="#ffffff" opacity="0.22" />

        {/* cap: cylinder with its own top and bottom ellipse */}
        <ellipse cx="100" cy="46" rx="47" ry="9" fill="#5b5765" />
        <rect x="53" y="46" width="94" height="58" fill="url(#ctqCap)" />
        <rect x="53" y="52" width="94" height="3" fill="#ffffff" opacity="0.12" />
        <ellipse cx="100" cy="104" rx="47" ry="9" fill="#1b1921" />

        {/* collar */}
        <rect x="45" y="100" width="110" height="17" rx="4" fill="url(#ctqCollar)" />
        <ellipse cx="100" cy="117" rx="55" ry="8" fill="#8f8c99" />

        {/* body: tapered shoulder into a straight cylinder */}
        <path
          d="M30 176 C30 143, 50 124, 72 119 L128 119 C150 124, 170 143, 170 176 Z"
          fill="url(#ctqBody)"
        />
        <path
          d="M30 176 C30 143, 50 124, 72 119 L128 119 C150 124, 170 143, 170 176 Z"
          fill="url(#ctqShoulder)"
        />
        <rect x="30" y="172" width="140" height="212" fill="url(#ctqBody)" />

        {/* label band with pinstripes */}
        <rect x="30" y="204" width="140" height="146" fill="url(#ctqLabel)" />
        <rect x="30" y="204" width="140" height="4" fill="#ffffff" opacity="0.5" />
        <rect x="30" y="346" width="140" height="4" fill="#ffffff" opacity="0.34" />
        <rect x="30" y="238" width="140" height="2" fill="#ffffff" opacity="0.22" />
        {/* crown mark, echoing the brand logo */}
        <path
          d="M74 300 L82 274 L92 292 L100 266 L108 292 L118 274 L126 300 Z"
          fill="#ffffff"
          opacity="0.9"
        />

        {/* long specular running the height of the can */}
        <rect x="50" y="122" width="13" height="258" rx="6.5" fill="url(#ctqSpec)" />
        <rect x="146" y="132" width="6" height="238" rx="3" fill="#ffffff" opacity="0.16" />

        {/* base rim */}
        <rect x="30" y="374" width="140" height="16" fill="#9d9aa8" />
        <ellipse cx="100" cy="390" rx="70" ry="14" fill="url(#ctqBody)" />
        <ellipse cx="100" cy="390" rx="70" ry="14" fill="#000000" opacity="0.22" />
        <ellipse cx="100" cy="387" rx="59" ry="10" fill="#b6b3c0" opacity="0.75" />
      </svg>
    </div>
  );
});
