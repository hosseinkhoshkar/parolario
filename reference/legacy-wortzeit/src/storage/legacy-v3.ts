import { POLICY_VERSION, SCHEMA_VERSION, TARGET_ACTIVE_MS } from '../contracts/legacy-v3.ts'
import type { AppState, ContentBundle, Session, SkillProgress } from '../contracts/legacy-v3.ts'
import type { ContentBundle as LegacyBundle } from '../contracts/legacy-v1.ts'
import { validateLegacyState } from './legacy-v1.ts'
import { emptySkill } from '../learning/schedule.ts'
import { validateVersionTwoState } from './legacy-v2.ts'

export const DATABASE_NAME = 'wortzeit-progress'
export const STORE_NAME = 'user-state'

export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
/** Keep the version-two evidence checks and validate each lesson session independently. */
export function validateVersionThreeState(value: unknown, bundle: ContentBundle): asserts value is AppState {
  const fail = (): never => { throw new StorageError('اطلاعات ذخیره‌شده ناقص یا ناسازگار است. داده‌های قبلی حفظ شده‌اند؛ حافظهٔ سایت را پاک نکنید.') }
  const lessons = bundle.lessons ?? [bundle.lesson]
  const lessonIds = new Set(lessons.map(lesson => lesson.lessonId))
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION
    || typeof value.activeLessonId !== 'string' || !lessonIds.has(value.activeLessonId)
    || !isRecord(value.savedSessions)) fail()
  const state = value as unknown as AppState
  const checkVersionTwo = (session: Session | null) => {
    try { validateVersionTwoState({ ...state, schemaVersion: 2, session }, bundle) } catch { fail() }
  }
  checkVersionTwo(state.session)
  const sessionIds = new Set<string>()
  const entryLesson = new Map(bundle.entries.map(entry => [entry.entryId, entry.introducedInLessonId]))
  function checkSession(session: Session, lessonId: string, archived: boolean): void {
    if (!isRecord(session) || session.lessonId !== lessonId || !lessonIds.has(lessonId)
      || sessionIds.has(session.sessionId) || archived && session.state === 'active') fail()
    sessionIds.add(session.sessionId)
    checkVersionTwo(session)
    const inLesson = (id: string) => entryLesson.get(id) === lessonId
    if (session.introducedEntryIds.some(id => !inLesson(id))) fail()
    for (const task of session.queue) {
      const ids = task.kind === 'match' ? task.entryIds
        : task.kind === 'choose-meaning' ? [task.entryId, ...task.optionIds] : [task.entryId]
      if (ids.some(id => !inLesson(id))) fail()
    }
    if (state.attempts.some(attempt => attempt.sessionId === session.sessionId && !inLesson(attempt.entryId))) fail()
  }
  if (state.session) checkSession(state.session, state.activeLessonId, false)
  for (const [lessonId, session] of Object.entries(state.savedSessions)) {
    if (lessonId === state.activeLessonId || !lessonIds.has(lessonId)) fail()
    checkSession(session, lessonId, true)
  }
}

function lessonOneBundle(bundle: ContentBundle): ContentBundle {
  const lesson = (bundle.lessons ?? [bundle.lesson]).find(item => item.lessonId === 'a1-lesson-01')
  if (!lesson) throw new StorageError('نسخهٔ قدیمی به درس اول نیاز دارد؛ اطلاعات قبلی حفظ شده‌اند.')
  const entries = bundle.entries.filter(entry => entry.introducedInLessonId === lesson.lessonId)
  return { ...bundle, lessons: undefined, lesson, entries,
    sourceRefs: bundle.sourceRefs.filter(ref => ref.lessonId === lesson.lessonId), contentVersion: 'lesson-01-excerpt-v2' }
}

export function migrateVersionThreeState(value: unknown, bundle: ContentBundle): AppState {
  if (isRecord(value) && value.schemaVersion === SCHEMA_VERSION) {
    if (value.contentVersion === bundle.contentVersion) {
      validateVersionThreeState(value, bundle)
      return structuredClone(value)
    }
    if (value.contentVersion !== 'lesson-01-excerpt-v2' || bundle.contentVersion !== 'course-a1-lessons-01-04-v1') {
      throw new StorageError('نسخهٔ محتوا شناخته‌شده نیست؛ اطلاعات قبلی حفظ شده‌اند.')
    }
    validateVersionThreeState(value, lessonOneBundle(bundle))
    const next = structuredClone(value)
    next.contentVersion = bundle.contentVersion
    next.revision++
    if (next.session) next.session.contentVersion = bundle.contentVersion
    for (const session of Object.values(next.savedSessions)) session.contentVersion = bundle.contentVersion
    validateVersionThreeState(next, bundle)
    return next
  }
  if (isRecord(value) && value.schemaVersion === 2) {
    const originalBundle = lessonOneBundle(bundle)
    try { validateVersionTwoState(value, originalBundle) } catch {
      throw new StorageError('اطلاعات نسخهٔ قبلی ناقص یا ناسازگار است؛ اطلاعات قبلی حفظ شده‌اند.')
    }
    const old = structuredClone(value)
    const next: AppState = {
      ...old, schemaVersion: SCHEMA_VERSION, contentVersion: bundle.contentVersion, revision: old.revision + 1,
      activeLessonId: originalBundle.lesson.lessonId, savedSessions: {},
      session: old.session ? { ...old.session, lessonId: originalBundle.lesson.lessonId, contentVersion: bundle.contentVersion } : null,
    }
    validateVersionThreeState(next, bundle)
    return next
  }
  const originalBundle = lessonOneBundle(bundle)
  const legacyBundle: LegacyBundle = {
    ...originalBundle, contentVersion: 'lesson-01-excerpt-v1',
    entries: originalBundle.entries.map(entry => ({ ...entry, enabledExercises: entry.enabledExercises.filter(kind =>
      kind === 'flashcard' || kind === 'choose-meaning' || kind === 'cloze' || kind === 'match') })),
  }
  // The prior reader is deliberately strict; no unknown version/content is reset.
  validateLegacyState(value, legacyBundle)
  const legacy = structuredClone(value)
  const previousWrongMatch = new Set<string>()
  const attempts: AppState['attempts'] = legacy.attempts.map(attempt => {
    const key = JSON.stringify([attempt.sessionId, attempt.taskId, attempt.entryId])
    const assisted = attempt.exercise === 'match' && previousWrongMatch.has(key)
    if (attempt.exercise === 'match' && !attempt.correct) previousWrongMatch.add(key)
    return { ...attempt, assisted, normalizationVersion: 'answer-normalization-v1' }
  })
  const next: AppState = {
    ...legacy, schemaVersion: SCHEMA_VERSION, learningPolicyVersion: POLICY_VERSION,
    contentVersion: bundle.contentVersion, revision: legacy.revision + 1,
    activeLessonId: originalBundle.lesson.lessonId, savedSessions: {},
    settings: { ...legacy.settings, targetActiveMs: TARGET_ACTIVE_MS },
    attempts,
    progress: {}, session: legacy.session ? { ...legacy.session, contentVersion: bundle.contentVersion, lessonId: originalBundle.lesson.lessonId,
      feedback: legacy.session.feedback ? { ...legacy.session.feedback,
        assisted: attempts.find(attempt => attempt.attemptId === legacy.session!.feedback!.attemptId)!.assisted } : null,
      activeMs: 0, targetAcknowledged: false, targetAcknowledgedDate: null } : null,
    assistanceEvents: [], dailyActivity: {}, activityEventIds: [],
  }
  for (const [id, progress] of Object.entries(legacy.progress)) {
    const entry = bundle.entries.find(item => item.entryId === id)!
    const skills = { meaning: emptySkill(), writing: emptySkill(), article: entry.partOfSpeech === 'noun' ? emptySkill() : null }
    for (const attempt of next.attempts.filter(item => item.entryId === id)) {
      const skill: SkillProgress = attempt.exercise === 'cloze' ? skills.writing : skills.meaning
      if (attempt.correct) { skill.correct++; if (!attempt.assisted) skill.unassistedCorrect++ }
      else skill.wrong++
      if (attempt.assisted) skill.assisted++
      skill.lastAttemptAt = attempt.at
    }
    next.progress[id] = { ...progress, pendingError: progress.pendingError ? { ...progress.pendingError, reason: 'wrong-answer' } : null, skills }
  }
  validateVersionThreeState(next, bundle)
  return next
}

