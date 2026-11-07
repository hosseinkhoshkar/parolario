export const WRITER_LOCK_NAME = 'wortzeit-single-writer'

interface WriterLocks {
  request(name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>): Promise<void>
}
interface StartupHandlers {
  load: (signal: AbortSignal) => Promise<void>
  blocked: () => void
  failed: (error: unknown) => void
}

/** Initial probe is immediate; an explicit retry waits for ownership without reloading. */
export function holdWriterLock(locks: WriterLocks, waitForOwner: boolean, handlers: StartupHandlers): () => void {
  const controller = new AbortController()
  let release: () => void = () => {}
  const lifetime = new Promise<void>(resolve => { release = resolve })
  // The Web Locks API disallows combining ifAvailable and signal.
  const options: LockOptions = waitForOwner ? { signal: controller.signal } : { ifAvailable: true }
  const request = async () => locks.request(WRITER_LOCK_NAME, options, async lock => {
    if (controller.signal.aborted) return
    if (!lock) { handlers.blocked(); return }
    try {
      // Cancellation releases ownership even if a storage read has not completed yet.
      await Promise.race([handlers.load(controller.signal), lifetime])
      if (!controller.signal.aborted) await lifetime
    } catch (error) {
      if (!controller.signal.aborted) handlers.failed(error)
    }
  })
  void request().catch(error => { if (!controller.signal.aborted) handlers.failed(error) })
  return () => { controller.abort(); release() }
}
