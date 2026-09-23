export class Clock {
  running = false;
  speed = 10;
  private queuedSeconds = 0;

  get pendingTicks(): number { return Math.floor(this.queuedSeconds + 1e-8); }
  get fraction(): number { return Math.min(1, this.queuedSeconds); }

  setRunning(running: boolean): void { this.running = running; }

  setSpeed(speed: number): void {
    if (![1, 10, 30].includes(speed)) throw new Error('Unsupported playback speed.');
    this.speed = speed;
  }

  consume(elapsedMilliseconds: number): number {
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) throw new Error('Invalid elapsed time.');
    if (!this.running) return 0;
    this.queuedSeconds += elapsedMilliseconds * this.speed / 1000;
    const ticks = Math.min(this.pendingTicks, 300);
    this.queuedSeconds = Math.max(0, this.queuedSeconds - ticks);
    return ticks;
  }

  reset(): void {
    this.queuedSeconds = 0;
    this.running = false;
  }
}
