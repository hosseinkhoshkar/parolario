import { POLICY_VERSION, SCHEMA_VERSION } from '../contracts/index.ts'
import type { AppState, ContentBundle, Session } from '../contracts/index.ts'
import { StorageError, validateLearningState } from './validate-learning-state.ts'
export { StorageError } from './validate-learning-state.ts'
import { deriveInitialReverseProgress, scheduleReverseReview, reverseStudyDate as studyDate, REVERSE_ACTIVATION_COUNT, REVERSE_MAX_PER_SESSION } from '../learning/reverse.ts'

export const DATABASE_NAME = 'parolario-progress'
export const STORE_NAME = 'user-state'
const STATE_KEY = 'current'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}
const validDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))

/** Check original-direction evidence and independent reverse-review history without legacy migration. */
export function validateState(value: unknown, bundle: ContentBundle): asserts value is AppState {
  const fail = (): never => { throw new StorageError('اطلاعات ذخیره‌شده ناقص یا ناسازگار است. داده‌های قبلی حفظ شده‌اند؛ حافظهٔ سایت را پاک نکنید.') }
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION || !isRecord(value.reverseProgress)
    || !Array.isArray(value.reverseReviews) || !isRecord(value.savedSessions)) fail()
  const state = value as unknown as AppState
  const known = new Set(bundle.entries.map(entry => entry.entryId))
  const sessions = [state.session, ...Object.values(state.savedSessions)].filter((session): session is Session => session !== null)
  const project = (session: Session | null): Session | null => {
    if (session === null) return null
    if (!isRecord(session) || !Array.isArray(session.queue) || !integer(session.cursor, 0, session.queue.length)
      || !['active', 'paused', 'ended'].includes(session.state)) fail()
    const ids = new Set<string>(), reverseIds = new Set<string>()
    for (const task of session.queue) {
      if (!isRecord(task) || typeof task.taskId !== 'string' || !task.taskId || ids.has(task.taskId)) fail()
      ids.add(task.taskId)
      if (task.kind === 'reverse-card') {
        if (!known.has(task.entryId) || !isRecord(state.reverseProgress[task.entryId])
          || typeof task.revealed !== 'boolean' || task.assisted !== undefined
          || reverseIds.has(task.entryId) || reverseIds.size >= REVERSE_MAX_PER_SESSION) fail()
        reverseIds.add(task.entryId)
      }
    }
    const newIds = new Set(session.queue.filter(task => task.kind === 'flashcard').map(task => task.entryId))
    if ([...reverseIds].some(id => newIds.has(id))) fail()
    const reverseCurrent = session.queue[session.cursor]?.kind === 'reverse-card'
    if (reverseCurrent && session.feedback !== null) fail()
    return { ...session,
      queue: session.queue.filter(task => task.kind !== 'reverse-card'),
      cursor: session.queue.slice(0, session.cursor).filter(task => task.kind !== 'reverse-card').length,
      ...(reverseCurrent ? { state: 'ended' as const } : {}),
    }
  }
  if (Object.values(state.savedSessions).some(session => isRecord(session) && session.state === 'active')) fail()
  try {
    validateLearningState({ ...state, session: project(state.session),
      savedSessions: Object.fromEntries(Object.entries(state.savedSessions).map(([id, session]) => [id, project(session)])) }, bundle)
  } catch { fail() }
  // Original-direction evidence determines eligibility; reverse history alone never invents it.
  const expected = deriveInitialReverseProgress(state, bundle)
  if (Object.keys(expected).length < REVERSE_ACTIVATION_COUNT
    && sessions.some(session => session.queue.some(task => task.kind === 'reverse-card'))) fail()
  if (Object.keys(expected).length !== Object.keys(state.reverseProgress).length) fail()
  const reviewIds = new Set<string>(), reviewedTasks = new Set<string>(), reviewedEntries = new Set<string>()
  const lastDates = new Map<string, number>()
  for (const review of state.reverseReviews) {
    if (!isRecord(review) || typeof review.reviewId !== 'string' || !review.reviewId || reviewIds.has(review.reviewId)
      || typeof review.sessionId !== 'string' || !review.sessionId || typeof review.taskId !== 'string' || !review.taskId
      || reviewedTasks.has(JSON.stringify([review.sessionId, review.taskId]))
      || reviewedEntries.has(JSON.stringify([review.sessionId, review.entryId])) || !expected[review.entryId]
      || typeof review.correct !== 'boolean' || !validDate(review.at)
      || review.studyDate !== studyDate(review.at, state.settings.studyTimeZone)) fail()
    const progress = expected[review.entryId]
    if (Date.parse(review.at) < Date.parse(progress.nextDueAt)
      || Date.parse(review.at) < (lastDates.get(review.entryId) ?? 0)) fail()
    if (Object.values(expected).filter(item => Date.parse(item.completedAt) <= Date.parse(review.at)).length < REVERSE_ACTIVATION_COUNT) fail()
    reviewedEntries.add(JSON.stringify([review.sessionId, review.entryId]))
    reviewIds.add(review.reviewId)
    reviewedTasks.add(JSON.stringify([review.sessionId, review.taskId]))
    lastDates.set(review.entryId, Date.parse(review.at))
    scheduleReverseReview(progress, review.correct, review.at, state.settings.studyTimeZone)
  }
  for (const [id, progress] of Object.entries(state.reverseProgress)) {
    if (!isRecord(progress) || !expected[id]) fail()
    for (const key of ['entryId', 'completedAt', 'lastReviewedAt', 'nextDueAt', 'successStreak', 'correctCount', 'incorrectCount', 'intervalDays'] as const) {
      if (progress[key] !== expected[id][key]) fail()
    }
  }
  // Review evidence must agree with any still-restorable session's reveal/cursor.
  const reservedIds = new Set<string>()
  for (const session of sessions) {
    for (let index = 0; index < session.queue.length; index++) {
      const task = session.queue[index]
      if (task.kind !== 'reverse-card') continue
      const reviews = state.reverseReviews.filter(review => review.sessionId === session.sessionId && review.taskId === task.taskId)
      if (reviews.length > 1 || reviews.some(review => review.entryId !== task.entryId)
        || reviews.length && (!task.revealed || index >= session.cursor)) fail()
      if (index < session.cursor && !reviews.length) fail()
      if (session.state !== 'ended' && index >= session.cursor) {
        // Duplicate reservations across different saved lessons would lead to stale ratings.
        if (reservedIds.has(task.entryId)) fail()
        reservedIds.add(task.entryId)
      }
    }
  }
}

/** Italian storage starts at schema 5; foreign/unknown snapshots are rejected, never reset. */
export function migrateState(value: unknown, bundle: ContentBundle): AppState {
  validateState(value, bundle)
  return structuredClone(value)
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageError('ذخیرهٔ محلی در این مرورگر در دسترس نیست.'))
      return
    }
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(new StorageError('بازکردن حافظهٔ محلی ممکن نشد؛ اطلاعات قبلی حذف نشده‌اند.'))
    request.onblocked = () => reject(new StorageError('یک تب دیگر دسترسی به حافظه را نگه داشته است؛ آن تب را ببندید و دوباره تلاش کنید.'))
  })
}

/** Read the original snapshot even when validation fails. Never repair or write it. */
export async function readRecoverySnapshot(): Promise<unknown> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(STATE_KEY)
    transaction.oncomplete = () => {
      database.close()
      if (request.result === undefined) reject(new StorageError('پیشرفت ذخیره‌شده‌ای برای دریافت پیدا نشد.'))
      else resolve(request.result)
    }
    transaction.onerror = transaction.onabort = () => {
      database.close()
      reject(new StorageError('خواندن پشتیبان ممکن نشد؛ اطلاعات قبلی تغییر نکرده‌اند.'))
    }
  })
}

export async function loadState(bundle: ContentBundle): Promise<AppState | null> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(STATE_KEY)
    let restored: AppState | null = null
    let failure: unknown = null
    request.onsuccess = () => {
      try {
        if (request.result === undefined) return
        restored = migrateState(request.result, bundle)
        if (restored.revision !== request.result.revision) store.put(restored, STATE_KEY)
      } catch (error) { failure = error; transaction.abort() }
    }
    transaction.oncomplete = () => {
      database.close()
      // A current-version load is read-only in effect and does not change its revision.
      if (restored?.session?.state === 'active') restored.session.state = 'paused'
      resolve(restored)
    }
    transaction.onerror = transaction.onabort = () => {
      database.close()
      reject(failure ?? new StorageError('بازیابی پیشرفت ممکن نشد؛ اطلاعات قبلی حفظ شده‌اند.'))
    }
  })
}

/** Atomically commits answers, schedule, feedback and cursor in one snapshot. */
export async function saveState(state: AppState, expectedRevision: number): Promise<void> {
  if (state.schemaVersion !== SCHEMA_VERSION || !integer(expectedRevision) || state.revision !== expectedRevision + 1) {
    throw new StorageError('ترتیب ذخیره‌سازی معتبر نیست؛ برنامه را دوباره باز کنید.')
  }
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(STATE_KEY)
    let conflict = false
    request.onsuccess = () => {
      const current = request.result as AppState | undefined
      if (current ? current.revision !== expectedRevision || current.schemaVersion !== SCHEMA_VERSION
        || current.contentVersion !== state.contentVersion || current.learningPolicyVersion !== POLICY_VERSION : expectedRevision !== 0) {
        conflict = true
        transaction.abort()
        return
      }
      store.put(state, STATE_KEY)
    }
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = transaction.onabort = () => {
      database.close()
      reject(new StorageError(conflict
        ? 'پیشرفت در تب دیگری تغییر کرده است. این صفحه را تازه کنید تا آخرین وضعیت بازیابی شود.'
        : 'ذخیره انجام نشد. پاسخ شما هنوز ثبت نشده؛ با همان پاسخ دوباره تلاش کنید.'))
    }
  })
}
