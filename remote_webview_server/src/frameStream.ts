// One in-flight encode per device. Pending producer frames can be coalesced
// BEFORE encoding; encoded delta frames must never be silently discarded.
export class LatestFrameStream {
  private pending?: string;
  private last?: string;
  private timer?: NodeJS.Timeout;
  private running = false;
  private paused = false;
  private stopped = false;
  private forceFull = true;
  private epoch = 0;
  private lastProcessed = 0;

  constructor(
    private readonly process: (b64: string, force: boolean, current: () => boolean) => Promise<void>,
    private readonly interval: () => number,
    private readonly onError: (error: unknown) => void,
  ) {}

  submit(b64: string): void {
    if (this.stopped) return;
    this.last = b64;
    if (this.paused) return;
    this.pending = b64;
    this.schedule();
  }

  requestFullFrame(): void {
    if (this.stopped) return;
    this.epoch++;
    this.forceFull = true;
    // Chromium emits no new frame for an unchanged page. Replay its last image.
    this.pending ??= this.last;
    this.schedule();
  }

  invalidate(): void {
    this.epoch++;
    this.pending = this.last = undefined;
    this.forceFull = true;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.epoch++;
    if (paused) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.pending = undefined;
    } else {
      this.requestFullFrame();
    }
  }

  stop(): void {
    this.stopped = true;
    this.invalidate();
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (this.stopped || this.paused || this.running || this.timer || !this.pending) return;
    const delay = Math.max(0, this.interval() - (Date.now() - this.lastProcessed));
    this.timer = setTimeout(() => { void this.flush(); }, delay);
  }

  private async flush(): Promise<void> {
    this.timer = undefined;
    if (this.stopped || this.paused || !this.pending) return;
    this.running = true;
    const b64 = this.pending;
    this.pending = undefined;
    const force = this.forceFull;
    this.forceFull = false;
    const epoch = this.epoch;
    try {
      await this.process(b64, force, () => epoch === this.epoch && !this.paused && !this.stopped);
    } catch (error) {
      this.forceFull = true;
      this.onError(error);
    } finally {
      this.running = false;
      this.lastProcessed = Date.now();
      this.schedule();
    }
  }
}
