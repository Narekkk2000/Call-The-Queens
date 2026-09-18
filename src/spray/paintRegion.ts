export type PaintBounds = { x: number; y: number; right: number; bottom: number };

/** Round outward in backing pixels so clearing and clipping never leave partial pixels. */
export function paintRegion(bounds: PaintBounds, width: number, height: number, pixelWidth: number, pixelHeight: number) {
  const x = Math.max(0, Math.floor(bounds.x * pixelWidth / width));
  const y = Math.max(0, Math.floor(bounds.y * pixelHeight / height));
  const right = Math.min(pixelWidth, Math.ceil(bounds.right * pixelWidth / width));
  const bottom = Math.min(pixelHeight, Math.ceil(bounds.bottom * pixelHeight / height));
  return { x, y, width: right - x, height: bottom - y };
}
