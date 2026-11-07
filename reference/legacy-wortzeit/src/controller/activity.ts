import type { LearningCommand } from '../contracts/index.ts'

interface ActivityClock {
  monotonic: () => number
  wallTime: () => string
  eventId: () => string
  everySecond: (callback: () => void) => () => void
}

/** Samples only explicitly active, visible time. No elapsed time is restored from storage. */
export class ActivityTracker {
  private clock: ActivityClock
  private sessionId: string
  private record: (command: LearningCommand) => void
  private cancel: (() => void) | null = null
  private previous = 0

  constructor(sessionId: string, clock: ActivityClock, record: (command: LearningCommand) => void) {
    this.sessionId = sessionId; this.clock = clock; this.record = record
  }

  start() {
    if (this.cancel) return
    this.previous = this.clock.monotonic()
    this.cancel = this.clock.everySecond(() => this.flush())
  }

  flush() {
    if (!this.cancel) return
    const current = this.clock.monotonic()
    const elapsedMs = Math.floor(current - this.previous)
    this.previous = current
    // A long event-loop/OS suspension cannot be certified as active study.
    if (elapsedMs <= 0 || elapsedMs > 5000) return
    const to = this.clock.wallTime()
    const end = Date.parse(to)
    if (!Number.isFinite(end)) return
    this.record({ type: 'activity', eventId: this.clock.eventId(), sessionId: this.sessionId,
      from: new Date(end - elapsedMs).toISOString(), to, elapsedMs })
  }

  stop() {
    if (!this.cancel) return
    this.flush()
    this.cancel()
    this.cancel = null
  }
}
