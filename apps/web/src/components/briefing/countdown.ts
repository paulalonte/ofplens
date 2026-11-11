/**
 * The Times card's countdown: time left to the plan's next milestone by the computer's clock
 * (not X-Plane's). Before Out it counts to pushback, between Out and Off to takeoff, between
 * Off and On to landing. The app cannot know whether the pilot actually pushed back, so the
 * takeoff stage also says how long ago pushback was planned.
 */

/** Shown from this long before Out; a plan further ahead (or already flown) shows no countdown. */
export const COUNTDOWN_LEAD_MS = 24 * 3_600_000;

/** Under this, the pushback and takeoff countdowns turn amber. */
export const COUNTDOWN_SOON_MS = 10 * 60_000;

export type CountdownStage = 'pushback' | 'takeoff' | 'landing';

export interface Countdown {
  stage: CountdownStage;
  /** The milestone being counted down to (Out, Off or On). */
  target: string;
  /** Milliseconds left to the target, always > 0. */
  remainingMs: number;
  /** In the takeoff stage: milliseconds since the planned pushback. */
  sincePushbackMs: number | null;
}

/**
 * Milestones rounded to the minute, as the card shows them (On 14:59:31Z is shown as 15:00Z),
 * so the countdown reaches 0:00 at the time on screen.
 */
function toMinute(iso: string): number {
  return Math.round(Date.parse(iso) / 60_000) * 60_000;
}

export function countdownAt(
  times: { out: string; off: string; on: string },
  nowMs: number,
): Countdown | null {
  const out = toMinute(times.out);
  const off = toMinute(times.off);
  const on = toMinute(times.on);

  if (nowMs < out - COUNTDOWN_LEAD_MS) return null;
  if (nowMs < out) {
    return {
      stage: 'pushback',
      target: times.out,
      remainingMs: out - nowMs,
      sincePushbackMs: null,
    };
  }
  if (nowMs < off) {
    return {
      stage: 'takeoff',
      target: times.off,
      remainingMs: off - nowMs,
      sincePushbackMs: nowMs - out,
    };
  }
  if (nowMs < on) {
    return { stage: 'landing', target: times.on, remainingMs: on - nowMs, sincePushbackMs: null };
  }
  return null;
}

/** "9:58", "1:05:00", "23:59:59": whole seconds, rounded up so it reaches 0:00 at the target. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
