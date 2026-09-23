import type { ServiceId } from '../scenario.ts';
import type { ServiceLight } from './buildings.ts';

// Intro beats (seconds): dusk lit -> lightning -> rolling blackout -> clinic generator -> hand off.
const BLACKOUT: [ServiceId, number][] = [['housing-a', 1.4], ['housing-b', 1.7], ['pump', 2], ['beacon', 2.2], ['clinic', 2.4]];
const CLINIC_GENERATOR = 2.6;
const END = 3.5;
const PULLBACK_SECONDS = 6;

export class Cinematic {
  private reduced: MediaQueryList;
  private t = -1;
  private flashed = false;
  private pullbackT = -1;

  constructor(reduced: MediaQueryList) { this.reduced = reduced; }

  get playing(): boolean { return this.t >= 0 && this.t < END; }
  get active(): boolean { return this.playing; }
  get time(): number { return this.t; }

  begin(): void {
    this.flashed = false;
    this.t = this.reduced.matches ? -1 : 0;
  }

  skip(): void { this.t = -1; }

  update(dt: number): void {
    if (this.t >= 0) {
      this.t += dt;
      if (this.t >= END) this.t = -1;
    }
    if (this.pullbackT >= 0) {
      this.pullbackT += dt;
      if (this.pullbackT >= PULLBACK_SECONDS) this.pullbackT = -1;
    }
  }

  // True exactly once when the timeline crosses the lightning beat.
  consumeFlash(): boolean {
    if (this.playing && !this.flashed && this.t >= 1.2) {
      this.flashed = true;
      return true;
    }
    return false;
  }

  override(id: ServiceId): ServiceLight | null {
    if (!this.playing) return null;
    if (id === 'clinic' && this.t >= CLINIC_GENERATOR) return 'backup';
    const cut = BLACKOUT.find(([service]) => service === id);
    if (cut && this.t >= cut[1]) return 'offline';
    return 'grid';
  }

  startPullback(): void {
    if (!this.reduced.matches && this.pullbackT < 0) this.pullbackT = 0;
  }

  // Incremental camera dolly/polar for this frame, or null when idle.
  pullbackStep(dt: number): { dolly: number; polar: number } | null {
    if (this.pullbackT < 0) return null;
    const slice = Math.min(dt, Math.max(0, PULLBACK_SECONDS - (this.pullbackT - dt)));
    if (slice <= 0) return null;
    const share = slice / PULLBACK_SECONDS;
    return { dolly: Math.pow(1.12, share), polar: share * (4 * Math.PI / 180) };
  }
}
