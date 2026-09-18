export type StrokePoint = { x: number; y: number; pressure: number };

/** Distance-based sampling keeps fast strokes connected at any refresh rate. */
export class StrokeSampler {
  private previous: StrokePoint | null = null;
  private remaining = 0;

  constructor(private readonly spacing: number, private readonly deposit: (point: StrokePoint) => void) {}

  get active(): boolean { return this.previous !== null; }

  add(point: StrokePoint): void {
    const previous = this.previous;
    if (!previous) {
      this.deposit(point);
      this.remaining = this.spacing;
      this.previous = point;
      return;
    }
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    const distance = Math.hypot(dx, dy);
    if (!distance) { this.previous = point; return; }
    let travelled = this.remaining;
    // An input jump across the entire stage is still bounded work.
    let count = 0;
    while (travelled <= distance + 1e-7 && count++ < 512) {
      const t = Math.min(1, travelled / distance);
      this.deposit({
        x: previous.x + dx * t,
        y: previous.y + dy * t,
        pressure: previous.pressure + (point.pressure - previous.pressure) * t,
      });
      travelled += this.spacing;
    }
    this.remaining = Math.max(0.001, travelled - distance);
    this.previous = point;
  }

  end(): void {
    this.previous = null;
    this.remaining = 0;
  }
}
