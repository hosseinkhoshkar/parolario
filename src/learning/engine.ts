import { hasArticle, articleOptions } from './articles.ts'
import { NORMALIZATION_VERSION, POLICY_VERSION, SCHEMA_VERSION, TARGET_ACTIVE_MS } from '../contracts/index.ts'
import type {
  AppState, ContentBundle, Entry, EntryProgress, EntryStatus, HomeStats,
  LearningCommand, LessonDefinition, Session, SessionSummary, SessionTask, ItalianArticle,
} from '../contracts/index.ts'
import { applySchedule, createProgress, isDue, isStabilized } from './schedule.ts'
import { initializeReverseProgress, mixReverseCards, reverseStudyDate, scheduleReverseReview, selectReverseEntries, REVERSE_ACTIVATION_COUNT } from './reverse.ts'

export function getLessons(bundle: ContentBundle): LessonDefinition[] {
  return bundle.lessons ?? [bundle.lesson]
}

export function getActiveLesson(state: AppState, bundle: ContentBundle): LessonDefinition {
  return getLessons(bundle).find(lesson => lesson.lessonId === state.activeLessonId) ?? bundle.lesson
}

function activeEntries(state: AppState, bundle: ContentBundle): Entry[] {
  return bundle.entries.filter(entry => entry.introducedInLessonId === state.activeLessonId)
}

export function createInitialState(bundle: ContentBundle, studyTimeZone: string): AppState {
  // Validate once, rather than silently changing an invalid time zone later.
  new Intl.DateTimeFormat('en', { timeZone: studyTimeZone }).format(0)
  return {
    schemaVersion: SCHEMA_VERSION, learningPolicyVersion: POLICY_VERSION,
    contentVersion: bundle.contentVersion, revision: 0,
    settings: { studyTimeZone, maxNewPerSession: 5, targetActiveMs: TARGET_ACTIVE_MS },
    progress: {}, reverseProgress: {}, reverseReviews: [], attempts: [], session: null, assistanceEvents: [], dailyActivity: {}, activityEventIds: [],
    activeLessonId: bundle.lesson.lessonId, savedSessions: {},
  }
}

export function currentTask(state: AppState): SessionTask | null {
  const session = state.session
  return session && session.state !== 'ended' ? session.queue[session.cursor] ?? null : null
}

export function normalizeAnswer(answer: string): string {
  return answer.normalize('NFC').trim().replace(/\s+/gu, ' ')
}

function studyDate(now: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now))
  const get = (type: string) => parts.find(part => part.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
  const result = [...values]
  let randomState = seed >>> 0
  for (let index = result.length - 1; index > 0; index--) {
    randomState += 0x6d2b79f5
    let value = randomState
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    const random = ((value ^ value >>> 14) >>> 0) / 4_294_967_296
    const other = Math.floor(random * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

function entryMap(bundle: ContentBundle): Map<string, Entry> {
  return new Map(bundle.entries.map(entry => [entry.entryId, entry]))
}

function needsRecall(progress: EntryProgress, sessionId: string, now: string): boolean {
  if (progress.pendingError) {
    return progress.pendingError.sessionId !== sessionId || progress.pendingError.remainingOtherAnswers === 0
  }
  return progress.initialRecallPending || isDue(progress, now)
}

function makeRecall(progress: EntryProgress, session: Session, suffix: string): SessionTask {
  let hash = 0
  for (const character of `${session.sessionId}:${progress.entryId}:${suffix}`) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return {
    taskId: `${session.sessionId}:recall:${progress.entryId}:${suffix}`,
    kind: (hash & 1) === 0 || progress.skills.writing.wrong > 0
      && progress.skills.writing.wrong >= progress.skills.writing.unassistedCorrect ? 'write-word' : 'cloze', entryId: progress.entryId,
    cycleKind: progress.pendingError ? 'recovery' : progress.initialRecallPending ? 'initial' : 'scheduled',
  }
}

function orderedRecall(state: AppState, now: string, bundle: ContentBundle): EntryProgress[] {
  const sessionId = state.session!.sessionId
  const date = studyDate(now, state.settings.studyTimeZone)
  const completedIndependent = new Set(state.attempts.filter(attempt => attempt.sessionId === sessionId
    && attempt.studyDate === date && attempt.independent && attempt.correct).map(attempt => attempt.entryId))
  const eligible = new Set(activeEntries(state, bundle).map(entry => entry.entryId))
  return Object.values(state.progress).filter(item => eligible.has(item.entryId) && needsRecall(item, sessionId, now)
    // A due success on the same study date intentionally keeps its old due time.
    // It is complete for this study date; a later day/error can still require recall.
    && (item.pendingError !== null || !completedIndependent.has(item.entryId)))
    .sort((a, b) => {
      // Due scheduled reviews first; pending and unfinished work follow.
      const rank = (item: EntryProgress) => !item.pendingError && isDue(item, now) ? 0 : item.pendingError ? 1 : 2
      return rank(a) - rank(b)
        || (a.nextDueAt ?? a.introducedAt).localeCompare(b.nextDueAt ?? b.introducedAt)
        || a.entryId.localeCompare(b.entryId)
    })
}

function queueNewEntryPractice(session: Session, entry: Entry, seed: number): void {
  const prefix = `${session.sessionId}:new:${entry.entryId}`
  const writtenTasks: SessionTask[] = [
    { taskId: `${prefix}:cloze`, kind: 'cloze', entryId: entry.entryId, cycleKind: 'initial' },
    { taskId: `${prefix}:write`, kind: 'write-word', entryId: entry.entryId, cycleKind: 'initial' },
  ]
  if (((seed + entry.introductionOrder) & 1) !== 0) writtenTasks.reverse()
  session.queue.push(
    { taskId: `${prefix}:meaning`, kind: 'choose-meaning', entryId: entry.entryId,
      optionIds: shuffled(entry.meaningOptionEntryIds, seed + entry.introductionOrder) },
    ...writtenTasks,
  )
  if (hasArticle(entry)) session.queue.push({ taskId: `${prefix}:article`,
    kind: 'choose-article', entryId: entry.entryId, options: shuffled(articleOptions(entry), seed + entry.introductionOrder + 1) })
}

/** Extra practice is bounded and based on actual skill evidence, never on a time quota. */
function queueAdaptive(state: AppState, bundle: ContentBundle, seed: number): void {
  const session = state.session!
  const queuedWriting = new Set(session.queue.filter(task => task.kind === 'cloze' || task.kind === 'write-word').map(task => task.entryId))
  const eligible = new Set(activeEntries(state, bundle).map(entry => entry.entryId))
  const candidates = Object.values(state.progress).filter(item => eligible.has(item.entryId)).sort((a, b) => {
    const weakness = (item: EntryProgress) => item.skills.writing.wrong - item.skills.writing.unassistedCorrect
      + (item.skills.article ? item.skills.article.wrong - item.skills.article.unassistedCorrect : 0)
    return weakness(b) - weakness(a) || a.entryId.localeCompare(b.entryId)
  })
  let added = 0
  const entries = entryMap(bundle)
  for (const progress of candidates) {
    if (added >= 4 || progress.pendingError?.sessionId === session.sessionId) continue
    const entry = entries.get(progress.entryId)!
    if (!queuedWriting.has(progress.entryId) && progress.skills.writing.wrong > 0
      && progress.skills.writing.wrong >= progress.skills.writing.unassistedCorrect) {
      session.queue.push({ taskId: `${session.sessionId}:adaptive-writing:${progress.entryId}`, kind: 'write-word',
        entryId: progress.entryId, cycleKind: 'scheduled' })
      added++
    }
    if (added < 4 && hasArticle(entry) && progress.skills.article
      && (progress.skills.article.wrong > 0 && progress.skills.article.wrong >= progress.skills.article.unassistedCorrect
        || queuedWriting.has(progress.entryId) && progress.skills.article.unassistedCorrect === 0)) {
      session.queue.push({ taskId: `${session.sessionId}:adaptive-article:${progress.entryId}`, kind: 'choose-article',
        entryId: progress.entryId, options: shuffled(articleOptions(entry), seed + added) })
      added++
    }
    if (added < 4 && progress.skills.meaning.wrong > 0 && progress.skills.meaning.wrong >= progress.skills.meaning.unassistedCorrect) {
      session.queue.push({ taskId: `${session.sessionId}:adaptive-meaning:${progress.entryId}`, kind: 'choose-meaning',
        entryId: progress.entryId, optionIds: shuffled(entry.meaningOptionEntryIds, seed + added) })
      added++
    }
  }
}

/** Introduce only the card actually reached; merely planning five cards does not count. */
function activateCurrent(state: AppState, now: string, bundle: ContentBundle): void {
  const session = state.session!
  const task = session.queue[session.cursor]
  if (!task) {
    session.state = 'ended'
    session.endedAt = now
    return
  }
  if (task.kind === 'flashcard' && !state.progress[task.entryId]) {
    if (session.introducedEntryIds.length >= state.settings.maxNewPerSession) {
      throw new Error('سقف معرفی واژه‌های این جلسه پر شده است.')
    }
    state.progress[task.entryId] = createProgress(entryMap(bundle).get(task.entryId)!, now)
    session.introducedEntryIds.push(task.entryId)
  }
}

/** At a task boundary, overdue/recovery tasks precede a new, unopened card. */
function prepareBoundary(state: AppState, now: string, bundle: ContentBundle): void {
  const session = state.session!
  const task = session.queue[session.cursor]
  const beforeNewCard = !task || task.kind === 'flashcard' && !state.progress[task.entryId]
  const remaining = session.queue.slice(session.cursor)
  const alreadyPlanned = new Set(remaining.flatMap(item => item.kind === 'match' ? [] : [item.entryId]))
  const recalls = orderedRecall(state, now, bundle)
    .filter(item => !alreadyPlanned.has(item.entryId) && (beforeNewCard || item.pendingError !== null))
    .map((item, index) => makeRecall(item, session, `boundary-${session.queue.length}-${index}`))
  session.queue.splice(session.cursor, 0, ...recalls)
  activateCurrent(state, now, bundle)
}

function start(state: AppState, command: Extract<LearningCommand, { type: 'start-session' }>, bundle: ContentBundle, now: string): void {
  if (state.session && state.session.state !== 'ended') {
    const session = state.session
    session.state = 'active'
    // Preserve the current prompt/draft; newly due items go after it and before unopened cards.
    const insertion = session.queue.findIndex((task, index) => index > session.cursor
      && task.kind === 'flashcard' && !state.progress[task.entryId])
    const at = insertion < 0 ? session.queue.length : insertion
    const queued = new Set(session.queue.slice(session.cursor).flatMap(task => task.kind === 'match' ? [] : [task.entryId]))
    const recalls = orderedRecall(state, now, bundle).filter(progress => !queued.has(progress.entryId))
    session.queue.splice(at, 0, ...recalls.map((progress, index) => makeRecall(progress, session, `resume-${session.queue.length}-${index}`)))
    return
  }
  const session: Session = {
    sessionId: command.sessionId, contentVersion: bundle.contentVersion, state: 'active', lessonId: state.activeLessonId,
    startedAt: now, endedAt: null, queue: [], cursor: 0,
    introducedEntryIds: [], draft: '', feedback: null, activeMs: 0, targetAcknowledged: false, targetAcknowledgedDate: null,
  }
  state.session = session
  session.queue.push(...orderedRecall(state, now, bundle).map((progress, index) => makeRecall(progress, session, `start-${index}`)))
  queueAdaptive(state, bundle, command.seed)
  const newEntries = activeEntries(state, bundle).filter(entry => !state.progress[entry.entryId])
    .sort((a, b) => a.introductionOrder - b.introductionOrder).slice(0, state.settings.maxNewPerSession)
  // Learn the complete small batch before any of its exercises. Cards only
  // become introductions when reached; their IDs and persisted shape stay stable.
  const newCards: SessionTask[] = newEntries.map(entry => ({
    taskId: `${session.sessionId}:new:${entry.entryId}:card`, kind: 'flashcard', entryId: entry.entryId, revealed: false,
  }))
  const reverseIds = selectReverseEntries(state, bundle, newEntries.map(entry => entry.entryId), now, command.seed)
  session.queue.push(...mixReverseCards(newCards, reverseIds, session.sessionId, command.seed))
  for (const entry of newEntries) queueNewEntryPractice(session, entry, command.seed)
  // This task appears only after their cards, never introduces an unseen word by itself.
  const matchPool = [...newEntries, ...activeEntries(state, bundle).filter(entry => state.progress[entry.entryId])]
  const seenMeanings = new Set<string>()
  const matchIds = matchPool.filter(entry => {
    if (seenMeanings.has(entry.meaningFa)) return false
    seenMeanings.add(entry.meaningFa)
    return true
  }).slice(0, 4).map(entry => entry.entryId)
  if (matchIds.length === 4 && session.queue.length > 0) {
    let rightOrder = shuffled(matchIds, command.seed ^ 0x5b1a)
    const leftOrder = shuffled(matchIds, command.seed ^ 0x77ab)
    // Independent shuffles can coincide; still avoid a solved visual row alignment.
    if (rightOrder.every((id, index) => id === leftOrder[index])) rightOrder = [...rightOrder.slice(1), rightOrder[0]]
    session.queue.push({ taskId: `${session.sessionId}:match`, kind: 'match', entryIds: matchIds,
      leftOrder, rightOrder, matchedEntryIds: [] })
  }
  activateCurrent(state, now, bundle)
}

function markWrong(state: AppState, entryId: string, now: string): void {
  const session = state.session!
  const progress = state.progress[entryId]
  progress.wrongCount++
  applySchedule(progress, { kind: 'wrong-answer', sessionId: session.sessionId, now })
  // A preplanned immediate cloze cannot bypass the delayed recovery rule.
  session.queue = session.queue.filter((task, index) => index <= session.cursor
    || task.kind === 'match' || task.kind === 'reverse-card' || task.entryId !== entryId)
}

function acceptWritten(answers: string[], actual: string, caseSensitive: boolean): boolean {
  const normalize = (value: string) => caseSensitive ? normalizeAnswer(value) : normalizeAnswer(value).toLocaleLowerCase('it-IT')
  return answers.some(value => normalize(value) === normalize(actual))
}

function assist(state: AppState, command: Extract<LearningCommand, { type: 'assist' }>, now: string): boolean {
  const session = state.session!
  const task = session.queue[session.cursor]
  if (!task || task.taskId !== command.taskId || (task.kind === 'flashcard' || task.kind === 'reverse-card') || session.feedback && task.kind !== 'match'
    || !command.eventId || !['hint', 'answer'].includes(command.kind)) return false
  const entryId = task.kind === 'match'
    ? command.entryId ?? task.leftOrder.find(id => !task.matchedEntryIds.includes(id)) : task.entryId
  if (task.kind === 'match' && (!entryId || !task.entryIds.includes(entryId) || task.matchedEntryIds.includes(entryId))) return false
  if (task.kind !== 'match' && command.entryId && command.entryId !== task.entryId) return false
  if (!entryId || !state.progress[entryId]) return false
  task.assisted = true
  state.assistanceEvents.push({ eventId: command.eventId, sessionId: session.sessionId, taskId: task.taskId,
    entryId, kind: command.kind, at: now, studyDate: studyDate(now, state.settings.studyTimeZone) })
  applySchedule(state.progress[entryId], { kind: 'assisted', sessionId: session.sessionId, now })
  // Keep the helped prompt available but remove any immediate unassisted follow-up.
  session.queue = session.queue.filter((item, index) => index <= session.cursor
    || item.kind === 'match' || item.kind === 'reverse-card' || item.entryId !== entryId)
  return true
}

function activity(state: AppState, command: Extract<LearningCommand, { type: 'activity' }>, now: string): boolean {
  const session = state.session!
  const from = Date.parse(command.from)
  const to = Date.parse(command.to)
  const elapsed = command.elapsedMs
  if (!command.eventId || command.sessionId !== session.sessionId || !Number.isFinite(from) || !Number.isFinite(to)
    || !Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 5_000 || to < from || to > Date.parse(now) + 1_000
    || from < Date.parse(session.startedAt) || to - from > 6_000 || Math.abs(to - from - elapsed) > 1_000) return false
  // A sample is at most five seconds, but can still cross a local midnight.
  let boundary = to
  const firstDate = studyDate(command.from, state.settings.studyTimeZone)
  const lastDate = studyDate(command.to, state.settings.studyTimeZone)
  if (firstDate !== lastDate && to > from) {
    let lower = from
    let upper = to
    while (upper - lower > 1) {
      const middle = Math.floor((lower + upper) / 2)
      if (studyDate(new Date(middle).toISOString(), state.settings.studyTimeZone) === firstDate) lower = middle
      else upper = middle
    }
    boundary = upper
  }
  const firstElapsed = to === from ? elapsed : elapsed * (boundary - from) / (to - from)
  state.dailyActivity[firstDate] = (state.dailyActivity[firstDate] ?? 0) + firstElapsed
  if (firstDate !== lastDate) state.dailyActivity[lastDate] = (state.dailyActivity[lastDate] ?? 0) + elapsed - firstElapsed
  session.activeMs += elapsed
  state.activityEventIds.push(command.eventId)
  return true
}

function answer(state: AppState, command: Extract<LearningCommand, { type: 'answer' }>, bundle: ContentBundle, now: string): boolean {
  const session = state.session!
  const task = session.queue[session.cursor]
  if (!task || (task.kind === 'flashcard' || task.kind === 'reverse-card') || task.taskId !== command.taskId || session.feedback) return false
  const entries = entryMap(bundle)
  let entryId: string
  if (task.kind === 'match') {
    if (!command.entryId || !task.entryIds.includes(command.entryId) || !task.entryIds.includes(command.answer)
      || task.matchedEntryIds.includes(command.entryId) || task.matchedEntryIds.includes(command.answer)) return false
    entryId = command.entryId
    if (!state.progress[entryId] || !state.progress[command.answer]) return false
  } else {
    entryId = task.entryId
    if (task.kind === 'choose-meaning' && !task.optionIds.includes(command.answer)) return false
  }
  const entry = entries.get(entryId)!
  if (task.kind === 'choose-article' && (!hasArticle(entry) || !task.options.includes(command.answer as ItalianArticle))) return false
  const correct = task.kind === 'cloze' ? acceptWritten(entry.cloze.acceptedAnswers, command.answer, entry.writing.caseSensitive)
    : task.kind === 'write-word' ? acceptWritten(entry.writing.acceptedAnswers, command.answer, entry.writing.caseSensitive)
      : task.kind === 'choose-article' ? command.answer === entry.nounData!.article : command.answer === entryId
  const helped = task.kind === 'match'
    ? state.assistanceEvents.some(event => event.taskId === task.taskId && event.entryId === entryId)
      || state.attempts.some(attempt => attempt.taskId === task.taskId && attempt.entryId === entryId && !attempt.correct)
    : task.assisted === true
  const independent = (task.kind === 'cloze' || task.kind === 'write-word') && !helped
  const date = studyDate(now, state.settings.studyTimeZone)
  state.attempts.push({ attemptId: command.attemptId, sessionId: session.sessionId,
    taskId: task.taskId, entryId, exercise: task.kind, answer: command.answer,
    correct, independent, assisted: helped, normalizationVersion: NORMALIZATION_VERSION, at: now, studyDate: date })
  const skill = task.kind === 'choose-article' ? state.progress[entryId].skills.article!
    : task.kind === 'cloze' || task.kind === 'write-word' ? state.progress[entryId].skills.writing : state.progress[entryId].skills.meaning
  if (correct) skill.correct++
  else skill.wrong++
  if (helped) skill.assisted++
  if (correct && !helped) skill.unassistedCorrect++
  skill.lastAttemptAt = now
  // Only answers to other entries count toward an error's spacing.
  for (const progress of Object.values(state.progress)) {
    if (progress.entryId !== entryId && progress.pendingError?.sessionId === session.sessionId) {
      progress.pendingError.remainingOtherAnswers = Math.max(0, progress.pendingError.remainingOtherAnswers - 1)
    }
  }
  if (correct) {
    state.progress[entryId].correctCount++
    if (task.kind === 'match') task.matchedEntryIds.push(entryId)
    if (independent) applySchedule(state.progress[entryId], { kind: 'independent-success', date, now })
  } else markWrong(state, entryId, now)
  session.feedback = {
    attemptId: command.attemptId, entryId, correct,
    expectedAnswer: task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0]
      : task.kind === 'write-word' ? entry.writing.acceptedAnswers[0]
        : task.kind === 'choose-article' ? entry.nounData!.article : entry.meaningFa,
    assisted: helped,
    explanationFa: correct
      ? helped ? 'پاسخ با کمک ثبت شد؛ این پاسخ یادآوری مستقل نیست و واژه دوباره تمرین می‌شود.'
        : independent ? 'یادآوری شما ثبت شد؛ زمان مرور بعدی بر اساس برنامهٔ مرور تعیین می‌شود.'
        : 'این ارتباط درست است. برای مرور فاصله‌دار، یادآوری در جای خالی هم لازم است.'
      : `«${entry.lemma}» یعنی «${entry.meaningFa}». بعد از چند پاسخ به واژه‌های دیگر، دوباره تمرینش می‌کنیم.`,
  }
  return true
}

export function transition(state: AppState, command: LearningCommand, bundle: ContentBundle, now: string): AppState {
  if (!Number.isFinite(Date.parse(now))) throw new Error('زمان مطالعه معتبر نیست.')
  if (state.contentVersion !== bundle.contentVersion || state.schemaVersion !== SCHEMA_VERSION
    || state.learningPolicyVersion !== POLICY_VERSION) throw new Error('نسخهٔ داده با برنامه سازگار نیست؛ داده‌های قبلی حفظ شده‌اند.')
  // Retry after a successful commit is idempotent, even if the prompt has moved on.
  if (command.type === 'answer' && state.attempts.some(item => item.attemptId === command.attemptId)) return state
  if (command.type === 'assist' && state.assistanceEvents.some(item => item.eventId === command.eventId)) return state
  if (command.type === 'activity' && state.activityEventIds.includes(command.eventId)) return state
  if (command.type === 'rate-reverse' && state.reverseReviews.some(review => review.reviewId === command.reviewId)) return state
  const next = structuredClone(state)
  const date = studyDate(now, next.settings.studyTimeZone)
  if (next.session && next.session.targetAcknowledgedDate !== null && next.session.targetAcknowledgedDate !== date) {
    next.session.targetAcknowledged = false
    next.session.targetAcknowledgedDate = null
  }
  if (command.type === 'select-lesson') {
    if (command.lessonId === state.activeLessonId || !getLessons(bundle).some(lesson => lesson.lessonId === command.lessonId)) return state
    if (next.session) {
      if (next.session.state === 'active') next.session.state = 'paused'
      next.savedSessions[next.activeLessonId] = next.session
    }
    next.activeLessonId = command.lessonId
    next.session = next.savedSessions[command.lessonId] ?? null
    delete next.savedSessions[command.lessonId]
    if (next.session?.state === 'active') next.session.state = 'paused'
  } else if (command.type === 'start-session') {
    if (!command.sessionId || !Number.isFinite(command.seed)) return state
    if ((!state.session || state.session.state === 'ended')
      && (state.session?.sessionId === command.sessionId
        || Object.values(state.savedSessions).some(session => session.sessionId === command.sessionId)
        || state.attempts.some(attempt => attempt.sessionId === command.sessionId)
        || state.reverseReviews.some(review => review.sessionId === command.sessionId))) return state
    start(next, command, bundle, now)
  } else {
    const session = next.session
    if (!session || session.state === 'ended') return state
    if (command.type === 'pause') {
      if (session.state === 'paused') return state
      session.state = 'paused'
    } else if (command.type === 'end-session') {
      session.state = 'ended'
      session.endedAt = now
    } else if (command.type === 'activity') {
      if (session.state !== 'active' || !activity(next, command, now)) return state
    } else if (command.type === 'continue-after-target') {
      if (session.state !== 'active' || session.targetAcknowledged
        || (next.dailyActivity[studyDate(now, next.settings.studyTimeZone)] ?? 0) < next.settings.targetActiveMs) return state
      session.targetAcknowledged = true
      session.targetAcknowledgedDate = date
    } else {
      if (session.state !== 'active' && command.type !== 'assist') return state
      const task = session.queue[session.cursor]
      if (!task || task.taskId !== command.taskId) return state
      if (command.type === 'reveal-card') {
        if ((task.kind !== 'flashcard' && task.kind !== 'reverse-card') || task.revealed) return state
        task.revealed = true
      } else if (command.type === 'rate-reverse') {
        const progress = task.kind === 'reverse-card' ? next.reverseProgress[task.entryId] : null
        if (task.kind !== 'reverse-card' || !task.revealed || !progress || !command.reviewId
          || Object.keys(next.reverseProgress).length < REVERSE_ACTIVATION_COUNT
          || typeof command.correct !== 'boolean' || session.feedback
          || Date.parse(progress.nextDueAt) > Date.parse(now)
          || next.reverseReviews.some(review => review.sessionId === session.sessionId && review.entryId === task.entryId)) return state
        next.reverseReviews.push({ reviewId: command.reviewId, sessionId: session.sessionId, taskId: task.taskId,
          entryId: task.entryId, correct: command.correct, at: now, studyDate: reverseStudyDate(now, next.settings.studyTimeZone) })
        scheduleReverseReview(progress, command.correct, now, next.settings.studyTimeZone)
        session.cursor++
        session.draft = ''
        prepareBoundary(next, now, bundle)
      } else if (command.type === 'draft') {
        if (task.kind !== 'cloze' && task.kind !== 'write-word' || session.feedback || session.draft === command.value) return state
        session.draft = command.value
      } else if (command.type === 'assist') {
        if (!assist(next, command, now)) return state
      } else if (command.type === 'answer') {
        if (!command.attemptId || !answer(next, command, bundle, now)) return state
        initializeReverseProgress(next, bundle)
      } else if (command.type === 'next') {
        if (task.kind === 'reverse-card' || (task.kind === 'flashcard' ? !task.revealed : !session.feedback)) return state
        const stayOnMatch = task.kind === 'match' && task.matchedEntryIds.length < 4
        session.feedback = null
        session.draft = ''
        if (!stayOnMatch) {
          session.cursor++
          prepareBoundary(next, now, bundle)
        }
      }
    }
  }
  next.revision = state.revision + 1
  return next
}

export function getEntryStatus(state: AppState, entryId: string, now: string): EntryStatus {
  const progress = state.progress[entryId]
  if (!progress) return 'new'
  return progress.pendingError || isDue(progress, now) ? 'due' : isStabilized(progress) ? 'stabilized' : 'learning'
}

function nearestDue(state: AppState, entryIds?: Set<string>): string | null {
  return Object.values(state.progress).filter(progress => !entryIds || entryIds.has(progress.entryId)).flatMap(progress => progress.nextDueAt ? [progress.nextDueAt] : [])
    .sort()[0] ?? null
}

export function getHomeStats(state: AppState, bundle: ContentBundle, now: string): HomeStats {
  const entries = activeEntries(state, bundle)
  const ids = new Set(entries.map(entry => entry.entryId))
  const progress = Object.values(state.progress).filter(item => ids.has(item.entryId))
  const attempts = state.attempts.filter(attempt => ids.has(attempt.entryId))
  return {
    introduced: entries.filter(entry => state.progress[entry.entryId]).length,
    due: progress.filter(item => getEntryStatus(state, item.entryId, now) === 'due').length,
    newCount: entries.filter(entry => !state.progress[entry.entryId]).length,
    correct: attempts.filter(attempt => attempt.correct).length,
    totalAnswers: attempts.length, nextDueAt: nearestDue(state, ids),
    todayActiveMs: state.dailyActivity[studyDate(now, state.settings.studyTimeZone)] ?? 0,
    stabilized: progress.filter(item => getEntryStatus(state, item.entryId, now) === 'stabilized').length,
  }
}

export function summarizeSession(state: AppState, now: string): SessionSummary {
  const session = state.session
  const attempts = state.attempts.filter(attempt => attempt.sessionId === session?.sessionId)
  const practicedIds = [...new Set(attempts.map(attempt => attempt.entryId))]
  return {
    practiced: practicedIds.length, introduced: session?.introducedEntryIds.length ?? 0,
    correct: attempts.filter(attempt => attempt.correct).length, totalAnswers: attempts.length,
    needsReview: practicedIds.filter(id => getEntryStatus(state, id, now) === 'due').length,
    remaining: session ? new Set(session.queue.slice(session.cursor).flatMap(task => task.kind === 'match'
      ? task.entryIds.filter(id => !task.matchedEntryIds.includes(id)) : [task.entryId])).size : 0,
    nextDueAt: nearestDue(state, new Set(practicedIds)),
    activeMs: session?.activeMs ?? 0,
    assisted: attempts.filter(attempt => attempt.assisted).length,
  }
}
