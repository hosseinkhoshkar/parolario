import { REVIEW_DAYS } from '../contracts/index.ts'
import type { Entry, EntryProgress, SkillProgress } from '../contracts/index.ts'

const DAY_MS = 86_400_000
export const emptySkill = (): SkillProgress => ({ correct: 0, wrong: 0, assisted: 0, unassistedCorrect: 0, lastAttemptAt: null })

export function createProgress(entry: Entry, now: string): EntryProgress {
  return {
    entryId: entry.entryId, introducedAt: now, initialRecallPending: true,
    nextDueAt: null, intervalIndex: 0, lastSuccessDate: null,
    scheduledReviewDates: [], correctCount: 0, wrongCount: 0, pendingError: null,
    skills: { meaning: emptySkill(), writing: emptySkill(), article: entry.partOfSpeech === 'noun' ? emptySkill() : null },
  }
}

export function isDue(progress: EntryProgress, now: string): boolean {
  return progress.nextDueAt !== null && Date.parse(progress.nextDueAt) <= Date.parse(now)
}

/** The sole owner of changes to nextDueAt, interval and the scheduled success chain. */
export function applySchedule(progress: EntryProgress, event:
  | { kind: 'wrong-answer' | 'assisted'; sessionId: string; now: string }
  | { kind: 'independent-success'; date: string; now: string },
): void {
  if (event.kind !== 'independent-success') {
    progress.pendingError = { sessionId: event.sessionId, remainingOtherAnswers: 3, at: event.now, reason: event.kind }
    progress.intervalIndex = 0
    progress.scheduledReviewDates = []
    progress.nextDueAt = event.now
    return
  }
  if (progress.initialRecallPending || progress.pendingError !== null) {
    progress.initialRecallPending = false
    progress.pendingError = null
    progress.intervalIndex = 0
    progress.nextDueAt = new Date(Date.parse(event.now) + DAY_MS).toISOString()
    progress.lastSuccessDate = event.date
    return
  }
  if (isDue(progress, event.now) && progress.lastSuccessDate !== event.date) {
    progress.intervalIndex = Math.min(progress.intervalIndex + 1, REVIEW_DAYS.length - 1)
    progress.nextDueAt = new Date(Date.parse(event.now) + REVIEW_DAYS[progress.intervalIndex] * DAY_MS).toISOString()
    progress.lastSuccessDate = event.date
    if (!progress.scheduledReviewDates.includes(event.date)) progress.scheduledReviewDates.push(event.date)
  }
}

export function isStabilized(progress: EntryProgress): boolean {
  return !progress.pendingError && progress.scheduledReviewDates.length >= 3
    && (progress.skills.article === null || progress.skills.article.unassistedCorrect > 0)
}
