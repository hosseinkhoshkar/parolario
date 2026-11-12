import { useEffect, useRef, useState } from 'react'
import type { AppState, LearningCommand, OfflineStatus } from './contracts/index.ts'
import { courseBundle, lessonBundles } from './content/catalog.ts'
import { validateContent } from './content/validate.ts'
import { createInitialState, getEntryStatus, getHomeStats, summarizeSession } from './learning/engine.ts'
import { CommandWriter } from './controller/writer.ts'
import { holdWriterLock } from './controller/startup-lock.ts'
import { ActivityTracker } from './controller/activity.ts'
import { loadState, saveState } from './storage/index.ts'
import { prepareOffline } from './pwa/offline.ts'
import { ParolarioUI } from './features/WortzeitUI.tsx'
import { RecoveryBackup } from './features/RecoveryBackup.tsx'

const bundle = courseBundle
const message = (error: unknown) => error instanceof Error ? error.message : 'ذخیره انجام نشد؛ دوباره تلاش کنید.'

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [offlineStatus, setOfflineStatus] = useState<OfflineStatus>('checking')
  const [now, setNow] = useState(() => new Date().toISOString())
  const writer = useRef<CommandWriter | null>(null)
  const activity = useRef<ActivityTracker | null>(null)
  const [sessionVisible, setSessionVisible] = useState(false)
  const booting = useRef(false)
  const [bootAttempt, setBootAttempt] = useState(0)
  const requestedLesson = useRef(new URLSearchParams(window.location.search).get('lesson'))

  useEffect(() => {
    let disposed = false
    booting.current = true
    setBusy(true)
    const failed = (failure: unknown) => {
      if (disposed) return
      booting.current = false
      setBusy(false)
      setError(message(failure))
    }
    const boot = async (signal: AbortSignal) => {
      const errors = validateContent(bundle)
      if (errors.length) throw new Error(`بستهٔ درس معتبر نیست: ${errors.join('؛ ')}`)
      const loaded = await loadState(bundle)
      if (disposed || signal.aborted) return
      const initial = loaded ?? createInitialState(bundle, Intl.DateTimeFormat().resolvedOptions().timeZone)
      const startupWriter = new CommandWriter(initial, {
        bundle, now: () => new Date().toISOString(), save: saveState,
        onSaved: saved => { if (!disposed) { setState(saved); setNow(new Date().toISOString()) } },
        onBusy: value => { if (!disposed) setBusy(value) },
        onError: failure => { if (!disposed) setError(failure ? message(failure) : null) },
      })
      writer.current = startupWriter
      const requested = requestedLesson.current
      try {
        if (requested && (bundle.lessons ?? [bundle.lesson]).some(lesson => lesson.lessonId === requested) && requested !== initial.activeLessonId) {
          await startupWriter.submit({ type: 'select-lesson', lessonId: requested })
        } else setState(initial)
      } catch (failure) {
        // A failed boot releases its Web Lock. Retry must acquire ownership again,
        // never reuse a writer carrying a failed command outside that lock.
        if (writer.current === startupWriter) writer.current = null
        await startupWriter.close()
        throw failure
      }
      if (disposed || signal.aborted) return
      requestedLesson.current = null
      setError(null)
      setBusy(false)
      booting.current = false
    }
    let cancel = () => {}
    if (!navigator.locks) {
      failed(new Error('این مرورگر امکان ذخیرهٔ امن جلسه را ندارد. برنامه را در مرورگر به‌روز و با HTTPS یا localhost باز کنید.'))
    } else {
      cancel = holdWriterLock(navigator.locks, bootAttempt > 0, {
        load: boot,
        blocked: () => failed(new Error('Parolario در تب دیگری باز است. آن تب را ببندید و دوباره تلاش کنید.')),
        failed,
      })
    }
    const stop = () => {
      if (disposed) return
      activity.current?.stop()
      disposed = true
      const active = writer.current
      writer.current = null
      booting.current = false
      if (active) void active.close().then(cancel)
      else cancel()
    }
    const hide = () => { stop(); setState(null) }
    const show = (event: PageTransitionEvent) => {
      if (event.persisted && disposed) { setError(null); setBootAttempt(value => value + 1) }
    }
    window.addEventListener('pagehide', hide)
    window.addEventListener('pageshow', show)
    return () => {
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('pageshow', show)
      stop()
    }
  }, [bootAttempt])

  const sessionId = state?.session?.sessionId
  const sessionActive = state?.session?.state === 'active'
  useEffect(() => {
    if (!sessionId || !sessionActive || !sessionVisible || error) return
    const tracker = new ActivityTracker(sessionId, {
      monotonic: () => performance.now(), wallTime: () => new Date().toISOString(), eventId: () => crypto.randomUUID(),
      everySecond: callback => { const timer = window.setInterval(callback, 1000); return () => window.clearInterval(timer) },
    }, command => { void writer.current?.submit(command).catch(() => {}) })
    activity.current = tracker
    const visibility = () => { if (document.visibilityState === 'visible') tracker.start(); else tracker.stop() }
    document.addEventListener('visibilitychange', visibility)
    visibility()
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      tracker.stop()
      if (activity.current === tracker) activity.current = null
    }
  }, [sessionId, sessionActive, sessionVisible, error])

  useEffect(() => {
    let disposed = false
    const check = () => { void prepareOffline().then(status => { if (!disposed) setOfflineStatus(status) }) }
    check()
    window.addEventListener('online', check)
    navigator.serviceWorker?.addEventListener('controllerchange', check)
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 30_000)
    return () => {
      disposed = true; window.clearInterval(timer); window.removeEventListener('online', check)
      navigator.serviceWorker?.removeEventListener('controllerchange', check)
    }
  }, [])

  const onCommand = (command: LearningCommand): Promise<void> => {
    if (command.type === 'next' || command.type === 'rate-reverse') activity.current?.flush()
    if (command.type === 'pause' || command.type === 'end-session' || command.type === 'select-lesson') activity.current?.stop()
    return writer.current?.submit(command) ?? Promise.resolve()
  }

  useEffect(() => {
    if (!state?.activeLessonId) return
    const url = new URL(window.location.href)
    url.searchParams.set('lesson', state.activeLessonId)
    window.history.replaceState(null, '', url)
  }, [state?.activeLessonId])

  const retry = () => {
    if (!writer.current) {
      if (booting.current) return
      booting.current = true
      setBusy(true)
      setError(null)
      setBootAttempt(value => value + 1)
      return
    }
    void writer.current.retry().catch(() => {})
  }

  if (!state) return <main className="boot-screen" dir="rtl" lang="fa">
    <div className="boot-mark" aria-hidden="true">P</div><h1>Parolario</h1>
    {error ? <><p role="alert">{error}</p><button type="button" disabled={busy} onClick={retry}>تلاش دوباره</button><RecoveryBackup /></>
      : <p role="status">{bootAttempt > 0 ? 'در حال گرفتن دسترسی و بازیابی جلسه…' : 'در حال آماده‌کردن واژه‌ها…'}</p>}
  </main>

  return <ParolarioUI bundle={bundle} state={state} stats={getHomeStats(state, bundle, now)}
    summary={summarizeSession(state, now)} statuses={Object.fromEntries(bundle.entries.map(entry =>
      [entry.entryId, getEntryStatus(state, entry.entryId, now)]))} now={now} busy={busy}
    error={error} offlineStatus={offlineStatus} onCommand={onCommand} onRetry={retry}
    onSessionVisibilityChange={setSessionVisible}
    activeLesson={(bundle.lessons ?? [bundle.lesson]).find(lesson => lesson.lessonId === state.activeLessonId) ?? bundle.lesson}
    activeProvenance={lessonBundles.find(item => item.lesson.lessonId === state.activeLessonId)?.provenance ?? bundle.provenance}
    lessonSummaries={(bundle.lessons ?? [bundle.lesson]).map(lesson => {
      const entries = bundle.entries.filter(entry => entry.introducedInLessonId === lesson.lessonId)
      return { lesson, total: entries.length,
        introduced: entries.filter(entry => state.progress[entry.entryId]).length,
        due: entries.filter(entry => getEntryStatus(state, entry.entryId, now) === 'due').length,
        stabilized: entries.filter(entry => getEntryStatus(state, entry.entryId, now) === 'stabilized').length }
    })} />
}
