import { NORMALIZATION_VERSION, POLICY_VERSION, SCHEMA_VERSION, TARGET_ACTIVE_MS } from '../contracts/legacy-v2.ts'
import type { AppState, ContentBundle } from '../contracts/legacy-v2.ts'


export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function validDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}
function validStudyDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
function uniqueStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0)
    && new Set(value).size === value.length
}

/** Reject damaged/unknown snapshots without resetting or overwriting them. */
export function validateVersionTwoState(value: unknown, bundle: ContentBundle): asserts value is AppState {
  const fail = (): never => { throw new StorageError('اطلاعات ذخیره‌شده ناقص یا ناسازگار است. داده‌های قبلی حفظ شده‌اند؛ حافظهٔ سایت را پاک نکنید.') }
  const known = new Set(bundle.entries.map(entry => entry.entryId))
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION
    || value.learningPolicyVersion !== POLICY_VERSION || value.contentVersion !== bundle.contentVersion
    || !integer(value.revision) || !isRecord(value.settings) || value.settings.maxNewPerSession !== 5
    || value.settings.targetActiveMs !== TARGET_ACTIVE_MS
    || typeof value.settings.studyTimeZone !== 'string' || !isRecord(value.progress)
    || !Array.isArray(value.attempts) || !Array.isArray(value.assistanceEvents)
    || !isRecord(value.dailyActivity) || !uniqueStrings(value.activityEventIds)) fail()
  const state = value as unknown as AppState
  try { new Intl.DateTimeFormat('en', { timeZone: state.settings.studyTimeZone }).format(0) } catch { fail() }
  for (const [id, progress] of Object.entries(state.progress)) {
    if (!known.has(id) || !isRecord(progress) || progress.entryId !== id
      || !validDate(progress.introducedAt) || typeof progress.initialRecallPending !== 'boolean'
      || !(progress.nextDueAt === null || validDate(progress.nextDueAt))
      || !integer(progress.intervalIndex, 0, 4)
      || !(progress.lastSuccessDate === null || validStudyDate(progress.lastSuccessDate))
      || !uniqueStrings(progress.scheduledReviewDates) || !progress.scheduledReviewDates.every(validStudyDate)
      || !integer(progress.correctCount) || !integer(progress.wrongCount)) fail()
    const error = progress.pendingError
    if (!(error === null || isRecord(error) && typeof error.sessionId === 'string' && error.sessionId.length > 0
      && validDate(error.at) && integer(error.remainingOtherAnswers, 0, 3)
      && ['wrong-answer', 'assisted'].includes(error.reason))) fail()
    if (!isRecord(progress.skills)) fail()
    const noun = bundle.entries.find(entry => entry.entryId === id)!.partOfSpeech === 'noun'
    if (noun ? !isRecord(progress.skills.article) : progress.skills.article !== null) fail()
    for (const skill of [progress.skills.meaning, progress.skills.writing, ...(noun ? [progress.skills.article!] : [])]) {
      if (!isRecord(skill) || !integer(skill.correct) || !integer(skill.wrong) || !integer(skill.assisted)
        || !integer(skill.unassistedCorrect) || skill.assisted > skill.correct + skill.wrong
        || skill.unassistedCorrect > skill.correct || !(skill.lastAttemptAt === null || validDate(skill.lastAttemptAt))) fail()
    }
  }
  const attemptIds = new Set<string>()
  for (const attempt of state.attempts) {
    if (!isRecord(attempt) || typeof attempt.attemptId !== 'string' || !attempt.attemptId
      || attemptIds.has(attempt.attemptId) || !known.has(attempt.entryId)
      || !state.progress[attempt.entryId] || typeof attempt.sessionId !== 'string' || !attempt.sessionId
      || typeof attempt.taskId !== 'string' || !attempt.taskId || typeof attempt.answer !== 'string'
      || !['choose-meaning', 'cloze', 'match', 'write-word', 'choose-article'].includes(attempt.exercise)
      || typeof attempt.correct !== 'boolean' || typeof attempt.independent !== 'boolean'
      || typeof attempt.assisted !== 'boolean'
      || !['answer-normalization-v1', NORMALIZATION_VERSION].includes(attempt.normalizationVersion)
      || attempt.independent !== ((attempt.exercise === 'cloze' || attempt.exercise === 'write-word') && !attempt.assisted)
      || attempt.exercise === 'choose-article' && state.progress[attempt.entryId].skills.article === null
      || !validDate(attempt.at) || !validStudyDate(attempt.studyDate)) fail()
    attemptIds.add(attempt.attemptId)
  }
  // Per-entry counters and event history must agree, not merely have plausible shapes.
  for (const progress of Object.values(state.progress)) {
    const attempts = state.attempts.filter(attempt => attempt.entryId === progress.entryId)
    if (progress.correctCount !== attempts.filter(attempt => attempt.correct).length
      || progress.wrongCount !== attempts.filter(attempt => !attempt.correct).length) fail()
    for (const [name, skill] of Object.entries(progress.skills)) {
      if (!skill) continue
      const relevant = attempts.filter(attempt => name === 'meaning' ? ['choose-meaning', 'match'].includes(attempt.exercise)
        : name === 'writing' ? ['cloze', 'write-word'].includes(attempt.exercise) : attempt.exercise === 'choose-article')
      if (skill.correct !== relevant.filter(attempt => attempt.correct).length
        || skill.wrong !== relevant.filter(attempt => !attempt.correct).length
        || skill.assisted !== relevant.filter(attempt => attempt.assisted).length
        || skill.unassistedCorrect !== relevant.filter(attempt => attempt.correct && !attempt.assisted).length
        || skill.lastAttemptAt !== (relevant.at(-1)?.at ?? null)) fail()
    }
  }
  const assistanceIds = new Set<string>()
  for (const event of state.assistanceEvents) {
    if (!isRecord(event) || typeof event.eventId !== 'string' || !event.eventId || assistanceIds.has(event.eventId)
      || typeof event.sessionId !== 'string' || !event.sessionId || typeof event.taskId !== 'string' || !event.taskId
      || !known.has(event.entryId) || !state.progress[event.entryId] || !['hint', 'answer'].includes(event.kind)
      || !validDate(event.at) || !validStudyDate(event.studyDate)) fail()
    assistanceIds.add(event.eventId)
  }
  for (const [date, elapsed] of Object.entries(state.dailyActivity)) {
    if (!validStudyDate(date) || !Number.isFinite(elapsed) || elapsed < 0) fail()
  }
  if (state.session !== null) {
    const session = state.session
    if (!isRecord(session) || typeof session.sessionId !== 'string' || !session.sessionId
      || session.contentVersion !== bundle.contentVersion || !['active', 'paused', 'ended'].includes(session.state)
      || !validDate(session.startedAt) || !(session.endedAt === null || validDate(session.endedAt))
      || !Array.isArray(session.queue) || !integer(session.cursor, 0, session.queue.length)
      || !uniqueStrings(session.introducedEntryIds) || session.introducedEntryIds.length > 5
      || session.introducedEntryIds.some(id => !state.progress[id]) || typeof session.draft !== 'string'
      || !Number.isFinite(session.activeMs) || session.activeMs < 0 || typeof session.targetAcknowledged !== 'boolean'
      || (session.targetAcknowledged ? !validStudyDate(session.targetAcknowledgedDate) : session.targetAcknowledgedDate !== null)
      || session.targetAcknowledged && (state.dailyActivity[session.targetAcknowledgedDate!] ?? 0) < state.settings.targetActiveMs
      || session.activeMs > Object.values(state.dailyActivity).reduce((sum, elapsed) => sum + elapsed, 0) + 0.01
      || session.state !== 'ended' && session.cursor === session.queue.length) fail()
    const taskIds = new Set<string>()
    for (const task of session.queue) {
      if (!isRecord(task) || typeof task.taskId !== 'string' || !task.taskId || taskIds.has(task.taskId)
        || task.assisted !== undefined && typeof task.assisted !== 'boolean') fail()
      taskIds.add(task.taskId)
      if (task.kind === 'match') {
        if (!uniqueStrings(task.entryIds) || task.entryIds.length !== 4 || task.entryIds.some(id => !known.has(id))
          || !uniqueStrings(task.leftOrder) || !uniqueStrings(task.rightOrder)
          || task.leftOrder.length !== 4 || task.rightOrder.length !== 4
          || task.leftOrder.some(id => !task.entryIds.includes(id)) || task.rightOrder.some(id => !task.entryIds.includes(id))
          || !uniqueStrings(task.matchedEntryIds) || task.matchedEntryIds.some(id => !task.entryIds.includes(id))) fail()
      } else {
        if (!known.has(task.entryId)) fail()
        if (task.kind === 'flashcard') {
          if (typeof task.revealed !== 'boolean') fail()
        } else if (task.kind === 'choose-meaning') {
          if (!uniqueStrings(task.optionIds) || task.optionIds.length !== 4
            || !task.optionIds.includes(task.entryId) || task.optionIds.some(id => !known.has(id))) fail()
        } else if (task.kind === 'cloze' || task.kind === 'write-word') {
          if (!['initial', 'scheduled', 'recovery'].includes(task.cycleKind)) fail()
        } else if (task.kind === 'choose-article') {
          if (bundle.entries.find(entry => entry.entryId === task.entryId)!.partOfSpeech !== 'noun'
            || !uniqueStrings(task.options) || task.options.length !== 3
            || task.options.some(option => !['der', 'die', 'das'].includes(option))) fail()
        } else fail()
      }
    }
    const feedback = session.feedback
    if (!(feedback === null || isRecord(feedback) && typeof feedback.attemptId === 'string'
      && attemptIds.has(feedback.attemptId) && known.has(feedback.entryId)
      && typeof feedback.correct === 'boolean' && typeof feedback.expectedAnswer === 'string'
      && typeof feedback.assisted === 'boolean'
      && typeof feedback.explanationFa === 'string')) fail()
    if (feedback) {
      const attempt = state.attempts.find(item => item.attemptId === feedback.attemptId)!
      if (attempt.taskId !== session.queue[session.cursor]?.taskId || attempt.sessionId !== session.sessionId
        || attempt.entryId !== feedback.entryId || attempt.correct !== feedback.correct || attempt.assisted !== feedback.assisted) fail()
    }
    if (session.state !== 'ended') {
      const activeTask = session.queue[session.cursor]
      if (activeTask.kind === 'match') {
        if (activeTask.entryIds.some(id => !state.progress[id])) fail()
        const matched = state.attempts.filter(attempt => attempt.taskId === activeTask.taskId
          && attempt.sessionId === session.sessionId && attempt.correct).map(attempt => attempt.entryId)
        if (matched.length !== activeTask.matchedEntryIds.length
          || activeTask.matchedEntryIds.some(id => !matched.includes(id))) fail()
      } else {
        if (!state.progress[activeTask.entryId]) fail()
        if (activeTask.kind !== 'flashcard' && !feedback && state.attempts.some(attempt =>
          attempt.taskId === activeTask.taskId && attempt.sessionId === session.sessionId)) fail()
      }
    }
  }
}
