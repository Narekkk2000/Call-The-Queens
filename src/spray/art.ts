import type { CanVariant } from '../components/SprayCan';

/**
 * The mural hidden behind the wall, one per can design. Whichever can is in
 * hand decides both the piece that gets revealed and the paint that reveals it:
 * `hues` drives the coloured mist that puffs off the can, `splat` is the
 * fallback colour for floor drips when the sampled pixel is too dark to read.
 */
export type Art = {
  /** Path relative to the deployed base URL. */
  src: string;
  /** One or two `r,g,b` triplets used for the aerosol mist. */
  hues: string[];
  /** `r,g,b` fallback for floor drips. */
  splat: string;
};

/**
 * Keyed by can id (see `CAN_VARIANTS`), so swapping the can swaps the mural.
 * Each design carries its own piece, with mist and drip colours tuned to match.
 */
export const ART: Record<CanVariant, Art> = {
  queens: { src: 'assets/s7.png', hues: ['204,34,238', '232,170,255'], splat: '204,34,238' },
  chrome: { src: 'assets/v4.png', hues: ['55,232,255', '255,46,154'], splat: '55,232,255' },
  midnight: { src: 'assets/s9.png', hues: ['204,34,238', '150,40,190'], splat: '204,34,238' },
};

export { assetUrl as artUrl } from '../site';
