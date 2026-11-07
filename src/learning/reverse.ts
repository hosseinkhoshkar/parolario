import type { AppState, ContentBundle, ReverseProgress, SessionTask } from '../contracts/index.ts'

export const REVERSE_ACTIVATION_COUNT = 15
export const REVERSE_MAX_PER_SESSION = 2
export const REVERSE_INITIAL_DAYS = 1
export const REVERSE_SUCCESS_DAYS = [3, 7, 14, 30] as const
export const REVERSE_GROWTH_DAYS = 30
export const REVERSE_MAX_INTERVAL_DAYS = 365
const DAY_MS = 86_400_000
const formatters = new Map<string, Intl.DateTimeFormat>()

function wallParts(value: string | number, timeZone: string): number[] {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    formatters.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(new Date(value))
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].map(type => Number(parts.find(part => part.type === type)!.value))
}
export function reverseStudyDate(now: string, timeZone: string): string {
  const [year, month, day] = wallParts(now, timeZone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
/** Calendar days at the same study-zone wall time, including 23/25-hour DST days.
 * A missing spring-forward wall time moves forward by the clock gap. */
export function calendarDaysAfter(now: string, days: number, timeZone: string): string {
  if (!Number.isInteger(days) || days < 1) throw new Error('فاصلهٔ مرور معتبر نیست.')
  const [year, month, day, hour, minute, second] = wallParts(now, timeZone)
  const target = Date.UTC(year, month - 1, day + days, hour, minute, second, new Date(now).getUTCMilliseconds())
  let candidate = target
  const visited: number[] = []
  for (let count = 0; count < 5; count++) {
    const [y, m, d, h, min, sec] = wallParts(candidate, timeZone)
    const local = Date.UTC(y, m - 1, d, h, min, sec, new Date(candidate).getUTCMilliseconds())
    const next = candidate + target - local
    if (next === candidate) return new Date(candidate).toISOString()
    if (visited.includes(next)) return new Date(Math.max(next, candidate)).toISOString()
    visited.push(candidate)
    candidate = next
  }
  return new Date(candidate).toISOString()
}

type CompletionState = Pick<AppState, 'progress' | 'attempts' | 'settings'>
/** Reconstruct only actual prior clean evidence; viewing a card cannot earn eligibility. */
export function deriveInitialReverseProgress(state: CompletionState, bundle: ContentBundle): Record<string, ReverseProgress> {
  const result: Record<string, ReverseProgress> = {}
  const evidence = new Map<string, { meaning?: string; writing?: string; article?: string }>()
  for (const attempt of state.attempts) {
    if (!attempt.correct || attempt.assisted || !state.progress[attempt.entryId]) continue
    const kind = attempt.exercise === 'choose-meaning' || attempt.exercise === 'match' ? 'meaning'
      : (attempt.exercise === 'cloze' || attempt.exercise === 'write-word') && attempt.independent ? 'writing'
        : attempt.exercise === 'choose-article' ? 'article' : null
    if (!kind) continue
    const item = evidence.get(attempt.entryId) ?? {}
    // History is append-only. A later device-clock rollback must not rewrite completion.
    if (!item[kind]) item[kind] = attempt.at
    evidence.set(attempt.entryId, item)
  }
  for (const entry of bundle.entries) {
    const clean = evidence.get(entry.entryId)
    if (!clean?.meaning || !clean.writing || entry.nounData?.article && !clean.article) continue
    const completedAt = [clean.meaning, clean.writing, ...(entry.nounData?.article ? [clean.article!] : [])].sort().at(-1)!
    result[entry.entryId] = { entryId: entry.entryId, completedAt, lastReviewedAt: null,
      nextDueAt: calendarDaysAfter(completedAt, REVERSE_INITIAL_DAYS, state.settings.studyTimeZone),
      successStreak: 0, correctCount: 0, incorrectCount: 0, intervalDays: REVERSE_INITIAL_DAYS }
  }
  return result
}
export function initializeReverseProgress(state: CompletionState & Pick<AppState, 'reverseProgress'>, bundle: ContentBundle): void {
  for (const [id, progress] of Object.entries(deriveInitialReverseProgress(state, bundle))) {
    if (!state.reverseProgress[id]) state.reverseProgress[id] = progress
  }
}

/** This is a separate self-assessed direction, never a written recall/mastery event. */
export function scheduleReverseReview(progress: ReverseProgress, correct: boolean, now: string, timeZone: string): void {
  if (correct) {
    progress.correctCount++
    progress.successStreak++
    progress.intervalDays = progress.successStreak <= REVERSE_SUCCESS_DAYS.length
      ? REVERSE_SUCCESS_DAYS[progress.successStreak - 1]
      : Math.min(REVERSE_MAX_INTERVAL_DAYS, REVERSE_SUCCESS_DAYS.at(-1)! + (progress.successStreak - REVERSE_SUCCESS_DAYS.length) * REVERSE_GROWTH_DAYS)
  } else {
    progress.incorrectCount++
    progress.successStreak = 0
    progress.intervalDays = REVERSE_INITIAL_DAYS
  }
  progress.lastReviewedAt = now
  progress.nextDueAt = calendarDaysAfter(now, progress.intervalDays, timeZone)
}

function randomGenerator(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let mixed = Math.imul(value ^ value >>> 15, value | 1)
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61)
    return ((mixed ^ mixed >>> 14) >>> 0) / 4_294_967_296
  }
}

/** Seeded weighted sampling without replacement. Never pull a future review forward. */
export function selectReverseEntries(state: AppState, bundle: ContentBundle, newEntryIds: string[], now: string, seed: number): string[] {
  if (Object.keys(state.reverseProgress).length < REVERSE_ACTIVATION_COUNT) return []
  const excluded = new Set(newEntryIds)
  for (const session of Object.values(state.savedSessions)) {
    if (session.state !== 'ended') for (const task of session.queue.slice(session.cursor)) {
      if (task.kind === 'reverse-card') excluded.add(task.entryId)
    }
  }
  const entries = new Map(bundle.entries.map(entry => [entry.entryId, entry]))
  const lessons = bundle.lessons ?? [bundle.lesson]
  const activeIndex = lessons.findIndex(lesson => lesson.lessonId === state.activeLessonId)
  const timestamp = Date.parse(now)
  const eligible = Object.values(state.reverseProgress).filter(progress => entries.has(progress.entryId)
    && !excluded.has(progress.entryId) && Date.parse(progress.nextDueAt) <= timestamp)
    .sort((a, b) => a.entryId.localeCompare(b.entryId))
  const random = randomGenerator(seed ^ 0x63c4d17a)
  const selected: string[] = []
  while (eligible.length && selected.length < REVERSE_MAX_PER_SESSION) {
    const weights = eligible.map(progress => {
      const overdueDays = Math.max(0, (timestamp - Date.parse(progress.nextDueAt)) / DAY_MS)
      const sinceReview = Math.max(0, (timestamp - Date.parse(progress.lastReviewedAt ?? progress.completedAt)) / DAY_MS)
      const index = lessons.findIndex(lesson => lesson.lessonId === entries.get(progress.entryId)!.introducedInLessonId)
      const priorLesson = index >= 0 && index < activeIndex ? 2 : 1
      return priorLesson * (1 + Math.min(60, overdueDays) * 4 + Math.min(10, progress.incorrectCount) * 2 + Math.min(60, sinceReview) / 10)
    })
    let ticket = random() * weights.reduce((sum, weight) => sum + weight, 0)
    let index = weights.length - 1
    for (let i = 0; i < weights.length; i++) {
      ticket -= weights[i]
      if (ticket < 0) { index = i; break }
    }
    selected.push(eligible.splice(index, 1)[0].entryId)
  }
  return selected
}

/** Preserve new-card order and persist the randomized reverse-card insertion positions. */
export function mixReverseCards(cards: SessionTask[], entryIds: string[], sessionId: string, seed: number): SessionTask[] {
  const result = [...cards]
  const random = randomGenerator(seed ^ 0x372a9b1)
  for (const entryId of entryIds) {
    const at = Math.floor(random() * (result.length + 1))
    result.splice(at, 0, { taskId: `${sessionId}:reverse:${entryId}`, kind: 'reverse-card', entryId, revealed: false })
  }
  return result
}

export { reverseStudyDate as studyDate }
