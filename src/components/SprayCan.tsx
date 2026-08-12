import { forwardRef } from 'react';

/**
 * The cursor. Position, rotation and scale are driven imperatively by
 * `SprayEngine` — this component only owns the artwork.
 */
export const SprayCan = forwardRef<HTMLDivElement>(function SprayCan(_props, ref) {
  return (
    <div ref={ref} className="can" aria-hidden="true">
      <svg className="can__svg" viewBox="0 0 200 424">
        <defs>
          <linearGradient id="ctqBody" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.42" stopColor="#f6f5f8" />
            <stop offset="1" stopColor="#d5d3da" />
          </linearGradient>
          <linearGradient id="ctqPink" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ff7ec1" />
            <stop offset="0.45" stopColor="#f9569f" />
            <stop offset="1" stopColor="#d92e7f" />
          </linearGradient>
          <linearGradient id="ctqCap" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fbfbfd" />
            <stop offset="0.55" stopColor="#dedde3" />
            <stop offset="1" stopColor="#b7b6bd" />
          </linearGradient>
        </defs>

        {/* nozzle */}
        <rect x="82" y="4" width="38" height="24" rx="9" fill="#ffffff" stroke="#0d0c10" strokeWidth="7" />
        <rect x="90" y="22" width="22" height="26" rx="6" fill="#eceaf0" stroke="#0d0c10" strokeWidth="7" />
        {/* cap and collar */}
        <rect x="54" y="42" width="94" height="54" rx="16" fill="url(#ctqCap)" stroke="#0d0c10" strokeWidth="7" />
        <rect x="46" y="88" width="110" height="18" rx="8" fill="#c9c7d0" stroke="#0d0c10" strokeWidth="7" />
        {/* body */}
        <rect x="32" y="98" width="136" height="304" rx="30" fill="url(#ctqBody)" stroke="#0d0c10" strokeWidth="8" />
        <rect x="48" y="128" width="104" height="244" rx="20" fill="url(#ctqPink)" />
        <rect x="60" y="142" width="15" height="216" rx="7.5" fill="#ffffff" opacity="0.82" />
        <rect x="128" y="176" width="12" height="150" rx="6" fill="#a01f60" opacity="0.35" />
        {/* base and shadow pooling */}
        <rect x="32" y="360" width="136" height="42" rx="24" fill="#f2f1f5" stroke="#0d0c10" strokeWidth="8" />
        <ellipse cx="66" cy="410" rx="20" ry="15" fill="#0d0c10" />
        <ellipse cx="104" cy="416" rx="25" ry="17" fill="#0d0c10" />
        <ellipse cx="141" cy="408" rx="17" ry="13" fill="#0d0c10" />
      </svg>
    </div>
  );
});
