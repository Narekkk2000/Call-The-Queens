# Call The Queens — Spray Wall (single mural)

An interactive coming-soon page. Visitors hold and drag a spray can to reveal a
mural hidden behind a concrete wall; once enough of the artwork is uncovered the
wall floods with paint and the contact panel takes over.

**This is the single-mural build.** It ships only the original artwork, with no
colourway switcher — the tab bar, the variant state and the other eight murals
are all gone. Everything else, including the spray physics and the reveal
sequence, is identical to `../call-the-queens-spray-wall`, which keeps all nine
variants and their switcher.

To swap in different artwork, drop a file into `public/assets/` and point
`src/spray/art.ts` at it.

## Getting started

```bash
npm install
```

```bash
npm run dev
```

| Script              | What it does                                 |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Dev server with hot reload                    |
| `npm run build`     | Typecheck, then emit a static site to `dist/` |
| `npm run preview`   | Serve the built `dist/` locally               |
| `npm run typecheck` | Types only, no output                         |

## Deploying

`npm run build` produces a fully static `dist/` — no server, no routing, no
environment variables. Vite is configured with `base: './'`, so asset URLs are
relative and the same build works at a domain root *or* in a subdirectory.

- **Netlify** — `netlify.toml` is included; connect the repo and it builds as-is.
- **Vercel** — `vercel.json` is included; framework preset is Vite.
- **GitHub Pages / S3 / Cloudflare Pages / any static host** — upload the
  contents of `dist/`. Because the base is relative, `user.github.io/repo-name/`
  works without extra configuration.

The only asset is `public/assets/mural.png` (~400 KB), so a first visit pulls
roughly half a megabyte in total.

## How it works

```
src/
  spray/
    art.ts           The mural: file, mist hues, drip colour
    SprayEngine.ts   All canvas work — framework-free, drives its own rAF loop
  components/
    SprayWall.tsx    Owns done/muted state, mounts the engine
    SprayCan.tsx     The SVG can (positioned imperatively by the engine)
    RevealScreen.tsx Paint flood, hero lockup, scrollable contact panel
  site.ts            Phone number, address, license, menu URL
```

React owns the DOM and two pieces of state (`done` and `muted`).
`SprayEngine` owns everything on a canvas and runs at 60fps outside React's
render cycle — the two talk through a small `SprayHost` callback interface, so a
frame never triggers a re-render.

Five canvases are stacked to build the effect:

1. **paint** — the reveal mask composited against the mural via `source-in`
2. **glow** — the same image at 22% scale, blurred and screen-blended for bloom
3. **floor** — a mirrored, blurred reflection plus running drips and pools
4. **grain** — multi-octave concrete noise, baked once per resize
5. **mist** — coloured aerosol particles drifting off the nozzle

Progress is measured by downsampling the mural to 108×54 and building a bitmask
of "this pixel carries artwork", then counting how much of that ink the mask has
uncovered. Revealing blank background therefore doesn't advance the meter.

## Spray radius and effort

The prototype used a fixed 120px cone. That was tuned on a laptop, and it makes
large displays much slower to fill: the wall's area grows with the screen while
the cone does not.

The radius is now derived from the stage instead. Covering a wall of area `A`
with a stroke of width `2r` takes a drag of roughly `A / 2r`, so setting
`r = k·√A` makes the drag a fixed number of *screen-widths* on every display.
Pointer movement maps to a fraction of the screen rather than to pixels, so that
reads as the same physical effort. `k` is calibrated so a 14" MacBook Pro
(a 1512×860 viewport) lands exactly on the original 120px.

Aspect ratio still moves the number the other way — a tall narrow phone needs
more passes than a wide monitor — so the implied sweep count is held within
2.6–3.6 screen-widths of drag, against ~3.05 at the reference viewport.

Measured against the built bundle:

| Viewport                    | Radius | Screen-widths of drag |
| --------------------------- | -----: | --------------------: |
| 1512×860 (reference, 14" MBP) | 120px |                  3.05 |
| 1280×800                    |  107px |                  3.19 |
| 1920×1200                   |  160px |                  3.19 |
| 2560×1600                   |  213px |                  3.19 |
| 3440×1440 ultrawide         |  234px |                  2.61 |
| 390×844 phone               |  100px |                  3.60 |

A second, quieter cause of the same problem was also fixed: the murals are 16:9
and 2.04:1, so a wide stage cover-fits and crops them. The reveal meter used to
count *all* of a mural's ink, including the part pushed off-screen that can
never be sprayed — on a 2560×1300 viewport that silently demanded 78% of the
visible artwork against 63% on a MacBook. Only on-screen ink now counts.

## Tuning

```tsx
<SprayWall
  radiusScale={1}   // multiplier on the derived cone; raise to spray faster
  radius={120}      // optional: pin a fixed px radius, ignoring the stage
  threshold={0.6}   // fraction of reachable ink uncovered before the flood
  drips={true}      // paint runs when it pools
  canSize={1}       // spray can scale               (0.6–1.6)
  sound={true}      // hiss + ball-bearing rattle
/>
```

If the whole thing feels slightly off on your machine, `radiusScale` is the one
dial to turn — the calibration assumes a 14" MacBook Pro viewport, and a 16"
would come out around 15% smaller than intended.

Copy — phone, address, license, Weedmaps URL — lives in `src/site.ts`.

## Notes on the port

- Audio is built lazily on the first pointer press, as browser autoplay policy
  requires. It is synthesised in the Web Audio API; there are no sound files.
- The prototype carried workarounds for the design tool's preview sandbox — a
  React StrictMode remount guard, a global instance registry, and a
  `window.top` fallback for the Weedmaps link. None apply to a real deployment,
  so they were dropped; the engine now tears down cleanly on unmount.
- The prototype defined an `addSplat()` floor-splatter effect that nothing ever
  called. It was left out. Floor drips and pools, which *are* wired up, remain.
