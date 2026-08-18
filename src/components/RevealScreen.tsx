import { useEffect, useRef } from 'react';
import { assetUrl, site } from '../site';
import './RevealScreen.css';

/** Paint splats that pop before the full-screen flood sweeps over them. */
const BLOBS = [
  { left: '18%', top: '52%', size: '20vmax', duration: '.5s', delay: '.02s' },
  { left: '78%', top: '40%', size: '16vmax', duration: '.5s', delay: '.1s' },
  { left: '44%', top: '78%', size: '22vmax', duration: '.55s', delay: '.16s' },
  { left: '62%', top: '18%', size: '13vmax', duration: '.5s', delay: '.22s' },
];

/**
 * Shown once the wall is fully revealed: the paint flood, the hero lockup and
 * the scrollable contact panel.
 */
export function RevealScreen() {
  const rootRef = useRef<HTMLDivElement>(null);

  // Position-based reveal rather than IntersectionObserver: this panel is an
  // absolutely-positioned scroll container, where observer root maths is
  // unreliable across browsers.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let raf = 0;
    const check = () => {
      const bottom = root.getBoundingClientRect().bottom;
      root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
        if (el.dataset.shown === '1') return;
        if (el.getBoundingClientRect().top < bottom - 70) el.dataset.shown = '1';
      });
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        check();
      });
    };

    root.addEventListener('scroll', onScroll, { passive: true });
    check();
    // Re-check after layout settles and after the flood animation finishes.
    const t1 = setTimeout(check, 120);
    const t2 = setTimeout(check, 600);

    return () => {
      root.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <>
      <div className="flood" aria-hidden="true">
        {BLOBS.map((b) => (
          <div
            key={b.left + b.top}
            className="flood__blob"
            style={{
              left: b.left,
              top: b.top,
              width: b.size,
              height: b.size,
              margin: `calc(${b.size} / -2) 0 0 calc(${b.size} / -2)`,
              animation: `ctqBlob ${b.duration} ${b.delay} cubic-bezier(.2,.9,.3,1) both`,
            }}
          />
        ))}
        <div className="flood__sheet" />
        <div className="flood__texture">
          <div className="flood__dots" />
          <div className="flood__vignette" />
          <div className="flood__sheen" />
        </div>
      </div>

      <div className="reveal" ref={rootRef}>
        <section className="reveal__section reveal__section--hero">
          <img className="hero__logo" src={assetUrl(site.logo)} alt={site.brand} />

          <div className="hero__eyebrow">
            <div className="hero__eyebrow-rule hero__eyebrow-rule--left" />
            <div className="eyebrow-text">{site.brand}</div>
            <div className="hero__eyebrow-rule hero__eyebrow-rule--right" />
          </div>

          <h1 className="hero__headline">
            <div className="hero__line">
              <span className="hero__word" style={{ animationDelay: '.86s' }}>
                SOMETHING
              </span>
            </div>
            <div className="hero__line hero__line--split">
              <span className="hero__word hero__word--outline" style={{ animationDelay: '.96s' }}>
                COOL
              </span>
              <span className="hero__word hero__word--small" style={{ animationDelay: '1.04s' }}>
                IS
              </span>
            </div>
            <div className="hero__line">
              <span className="hero__word" style={{ animationDelay: '1.12s' }}>
                COMING
              </span>
            </div>
          </h1>

          <div className="hero__slab" aria-hidden="true">
            <div className="hero__slab-bar" />
          </div>

          <div className="hero__tagline">{site.tagline}</div>

          <div className="hero__scroll-cue">
            <div className="hero__scroll-label">Scroll for contact</div>
            <div className="hero__arrow" aria-hidden="true">
              <div className="hero__arrow-stem" />
              <div className="hero__arrow-head" />
            </div>
          </div>
        </section>

        <section className="reveal__section reveal__section--contact">
          <div className="reveal__item contact__eyebrow" data-reveal="1">
            <div className="contact__eyebrow-rule" />
            <div className="eyebrow-text">{site.category}</div>
            <div className="contact__eyebrow-rule" />
          </div>

          <a
            className="reveal__item contact__phone"
            data-reveal="2"
            data-keep-skew="1"
            href={site.phone.href}
          >
            {site.phone.display}
          </a>

          <a
            className="reveal__item contact__cta"
            data-reveal="3"
            href={site.menuUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {site.menuLabel}
            {/* Drawn rather than typed: U+2197 has an emoji presentation, which
                iOS picks by default, so the glyph renders as a blue emoji tile
                on mobile and a plain arrow on desktop. */}
            <svg className="contact__cta-arrow" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6.5 17.5 L17.5 6.5 M9.5 6.5 H17.5 V14.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>

          <div className="reveal__item contact__grid" data-reveal="4">
            <div className="contact__cell">
              <div className="contact__cell-label">Address</div>
              <div className="contact__cell-value">
                {site.address[0]}
                <br />
                {site.address[1]}
              </div>
            </div>
            <div className="contact__cell">
              <div className="contact__cell-label">Call us</div>
              <div className="contact__cell-value">{site.phone.display}</div>
            </div>
            <div className="contact__cell">
              <div className="contact__cell-label">License</div>
              <div className="contact__cell-value">{site.license}</div>
            </div>
          </div>

          <div className="reveal__item contact__legal" data-reveal="5">
            <div className="contact__badge">21+</div>
            <div className="contact__legal-text">
              {site.legal[0]}
              <br />
              {site.legal[1]}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
