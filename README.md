# Call The Queens — Spray Wall

An interactive coming-soon page. Hold and drag a spray can to paint a hidden
mural onto a concrete wall. Choose from three artworks; once enough of the piece
is painted, the wall finishes itself and reveals the contact page.

## Development

```bash
npm install
npm run dev
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite development server |
| `npm run build` | Typecheck and build the static site into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript checks |
| `npm test` | Stroke continuity, input-rate, gesture-boundary, and pressure tests |

## Painting

- Paint lands immediately under the pointer. Coalesced input and distance-based
  sampling preserve corners and connect fast strokes, including taps shorter
  than a display frame.
- Four cached aerosol textures produce a soft, grainy edge. Repeated passes
  build from saturated colour into sharp artwork, with a subtle drying sheen,
  fine airborne pigment, drips, and a floor reflection.
- Mouse, touch, and pressure-sensitive pens share the same input path. Only
  the initiating pointer controls a stroke. Cancellation, loss of capture,
  window blur, reset, and backgrounding release the nozzle.
- Dwell, can movement, particles, drips, drying, and completion use elapsed
  time. Stroke spacing follows distance, so refresh rate does not determine
  the amount of paint in a moving stroke.
- The artwork is fitted and rasterised once per artwork/viewport change.
  Sharp layers redraw only the changed rectangle. Bloom, wetness, and the
  floor use smaller buffers; the sharp surface has a 2.8-million-pixel budget.
- The animation loop sleeps when the scene settles and pauses in hidden tabs.
  Reduced-motion preferences remove decorative animation and can tilt.

React owns controls and completion state. `SprayEngine` owns the canvas and
pointer work outside React's render cycle. Progress is sampled at most every
160 ms against a small map of the artwork's visible ink; empty background and
cropped-out artwork do not advance the meter.

```text
src/spray/
  SprayEngine.ts    Input, rendering, physics, sound, and completion
  StrokeSampler.ts Distance-based path sampling and pressure interpolation
  brush.ts         Cached aerosol and mist textures
  art.ts           Artwork, mist colours, and drip colours per can
src/components/
  SprayWall.tsx    Stage, controls, and engine lifecycle
  SprayWall.css    Concrete, lighting, responsive controls, and motion
  SprayCan.tsx     Three SVG can designs
  RevealScreen.tsx Coming-soon and contact page
src/site.ts        Brand, phone, address, license, and menu link
```

## Tuning

```tsx
<SprayWall
  radiusScale={1}   // multiply the automatically sized cone
  // radius={120}  // optionally use a fixed CSS-pixel radius
  threshold={0.86} // visible artwork needed before automatic completion
  drips={true}
  canSize={1}
  sound={true}
  sprayDelay={0}   // immediate paint; optional nonzero flight time in ms
  revealDelay={1200} // hold on the finished mural before showing contact info
/>
```

The cone scales with the visible mural and viewport proportions. Portrait
screens use a slightly smaller cone, and enforce the same 86% coverage floor
the default already sets, so the central subject is complete before the
finishing transition. Resizing
preserves the existing paint mask and ends any active gesture.

Artwork files live in `public/assets/`; their mapping is in `src/spray/art.ts`.
Audio is synthesised with Web Audio after the first press, without sound files.

## Deployment

The production build is fully static. Relative asset URLs (`base: './'`) support
both domain roots and subdirectories. Netlify and Vercel build configurations
are included. For GitHub Pages, S3, or another static host, publish `dist/`.

Local browser verification artifacts in `output/playwright/` and
`.playwright-cli/` are ignored by Git and the Vite watcher.
