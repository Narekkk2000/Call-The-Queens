/** Textured aerosol stamps, baked once instead of hundreds of paths per frame. */
export function createBrushes(): HTMLCanvasElement[] {
  return Array.from({ length: 4 }, (_, variant) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const pixels = ctx.createImageData(256, 256);
    let seed = 937 + variant * 7919;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const r = Math.hypot(x - 127.5, y - 127.5) / 98;
        const falloff = Math.max(0, 1 - r * r);
        const grain = random();
        const body = 0.34 * falloff * falloff * (0.78 + grain * 0.44);
        const speck = random() > 0.965 && r < 1.28 ? 0.18 * Math.max(0, 1 - r / 1.28) : 0;
        const i = (y * 256 + x) * 4;
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
        pixels.data[i + 3] = Math.round(Math.min(1, body + speck) * 255);
      }
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  });
}

export function createSoftBrush(color = '255,255,255'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, `rgba(${color},0.6)`);
  gradient.addColorStop(0.3, `rgba(${color},0.26)`);
  gradient.addColorStop(0.65, `rgba(${color},0.07)`);
  gradient.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return canvas;
}
