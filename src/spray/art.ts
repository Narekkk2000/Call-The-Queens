/**
 * The mural hidden behind the wall. `hues` drives the coloured mist that puffs
 * off the can, `splat` is the fallback colour for floor drips when the sampled
 * pixel is too dark to read.
 */
export type Art = {
  /** Path relative to the deployed base URL. */
  src: string;
  /** One or two `r,g,b` triplets used for the aerosol mist. */
  hues: string[];
  /** `r,g,b` fallback for floor drips. */
  splat: string;
};

export const ART: Art = {
  src: 'assets/mural.png',
  hues: ['255,72,214', '176,86,255'],
  splat: '255,80,215',
};

export { assetUrl as artUrl } from '../site';
