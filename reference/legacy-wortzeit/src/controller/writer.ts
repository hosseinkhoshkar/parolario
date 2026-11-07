import type { AppState, ContentBundle, LearningCommand } from '../contracts/index.ts'
import { transition } from '../learning/engine.ts'

/** A failed commit retains the exact command AND edits queued behind it for retry. */
interface WriterOptions {
  bundle: ContentBundle
  now: () => string
  save: (state: AppState, expectedRevision: number) => Promise<void>
  onSaved: (state: AppState) => void
  onBusy: (busy: boolean) => void
  onError: (error: unknown | null) => void
}
export class CommandWriter {
  private state: AppState
  private queue: LearningCommand[] = []
  private running: Promise<void> | null = null
  private failure: unknown = null
  private closed = false
  private busy = false

  private updateBusy(): void {
    // Background clock/draft commits must not dim or disable the whole interface.
    const busy = this.queue.some(command => command.type !== 'activity' && command.type !== 'draft')
    if (busy !== this.busy) { this.busy = busy; this.options.onBusy(busy) }
  }

  private options: WriterOptions
  constructor(initial: AppState, options: WriterOptions) { this.state = initial; this.options = options }

  submit(command: LearningCommand): Promise<void> {
    if (this.closed) return Promise.reject(new Error('این جلسه دیگر نویسندهٔ فعال نیست.'))
    this.queue.push(command)
    if (this.failure) return Promise.reject(this.failure)
    this.updateBusy()
    return this.flush()
  }

  retry(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('این جلسه دیگر نویسندهٔ فعال نیست.'))
    this.failure = null
    return this.flush()
  }

  /** Stop accepting work; ownership may be released after the current queue settles. */
  close(): Promise<void> {
    this.closed = true
    return this.running?.catch(() => {}) ?? Promise.resolve()
  }

  private flush(): Promise<void> {
    if (this.running) return this.running
    this.updateBusy()
    this.running = (async () => {
      // Install running before a no-op command can drain synchronously. Cleanup
      // belongs to this same async continuation, not a later .finally microtask
      // where new submissions could attach to an already finished drain.
      await Promise.resolve()
      try {
        do {
          while (this.queue.length) {
            const before = this.state
            const after = transition(before, this.queue[0], this.options.bundle, this.options.now())
            if (after !== before) {
              await this.options.save(after, before.revision)
              this.state = after
              this.options.onSaved(after)
            }
            this.queue.shift()
            this.updateBusy()
          }
          this.options.onError(null)
        } while (this.queue.length)
      } catch (error) {
        this.failure = error
        this.options.onError(error)
        throw error
      } finally {
        this.running = null
        if (this.busy) { this.busy = false; this.options.onBusy(false) }
      }
    })()
    return this.running
  }
}
