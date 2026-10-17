// The callback cadence draws the clock; elapsed time, not callback count, drives it.
export class PlaybackClock {
  private position = 0;
  private sampledAt = 0;
  private duration = 0;
  private playing = false;

  read(now: number) {
    const elapsed = this.playing ? Math.min(10, Math.max(0, (now - this.sampledAt) / 1_000)) : 0;
    return Math.min(this.duration, Math.max(0, this.position + elapsed));
  }

  sync(position: number, duration: number, playing: boolean, now: number, force = false) {
    const reported = Math.max(0, Math.min(duration, position));
    const local = this.read(now);
    // Ignore tiny network jitter, but correct both ahead and behind clocks equally.
    this.position = !force && playing && this.playing && Math.abs(reported - local) < 0.15 ? local : reported;
    this.duration = duration;
    this.sampledAt = now;
    this.playing = playing;
    return this.position;
  }

  pause(now: number) {
    this.position = this.read(now);
    this.sampledAt = now;
    this.playing = false;
    return this.position;
  }
}
