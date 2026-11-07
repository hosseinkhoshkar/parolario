/** Multi-lesson state. Frozen v1/v2 contracts support lossless progress upgrades. */
export const SCHEMA_VERSION = 3 as const
export const POLICY_VERSION = 'learning-policy-v2' as const
export const NORMALIZATION_VERSION = 'answer-normalization-v2' as const
export const TARGET_ACTIVE_MS = 1_200_000 as const
export const REVIEW_DAYS = [1, 3, 7, 14, 30] as const

export interface Source {
  sourceId: string
  kind: 'textbook' | 'workbook' | 'audioTranscript'
  title: string
  edition: string | null
}
export interface SourceRef {
  sourceRefId: string
  sourceId: string
  lessonId: string
  locator: string
}
export interface Example {
  exampleId: string
  de: string
  fa: string
  origin: 'authored'
}
export interface Entry {
  entryId: string
  introducedInLessonId: string
  introductionOrder: number
  lemma: string
  partOfSpeech: 'noun' | 'verb' | 'adjective' | 'adverb' | 'pronoun' | 'phrase' | 'other'
  meaningFa: string
  nounData?: { article: 'der' | 'die' | 'das'; plural: string | null; pluralNote: string }
  sourceRefIds: string[]
  occurrences: { lessonId: string; sourceRefIds: string[] }[]
  examples: Example[]
  cloze: { sentence: string; translationFa: string; acceptedAnswers: string[]; exampleId: string }
  writing: { promptFa: string; cueFa: string; acceptedAnswers: string[]; caseSensitive: boolean }
  meaningOptionEntryIds: string[]
  enabledExercises: ('flashcard' | 'choose-meaning' | 'cloze' | 'match' | 'write-word' | 'choose-article')[]
  reviewStatus: 'excerpt-checked'
}
export interface LessonDefinition {
  lessonId: string
  titleDe: string
  titleFa: string
  level: 'A1'
  coverage: 'partial'
  introducedEntryIds: string[]
}
export interface ContentBundle {
  contentVersion: string
  sources: Source[]
  sourceRefs: SourceRef[]
  lesson: LessonDefinition
  lessons?: LessonDefinition[]
  entries: Entry[]
  provenance: { file: string; reviewStatus: 'excerpt-checked'; noteFa: string }
}
export interface EntryProgress {
  entryId: string
  introducedAt: string
  initialRecallPending: boolean
  nextDueAt: string | null
  intervalIndex: number
  lastSuccessDate: string | null
  scheduledReviewDates: string[]
  correctCount: number
  wrongCount: number
  pendingError: null | { sessionId: string; remainingOtherAnswers: number; at: string; reason: 'wrong-answer' | 'assisted' }
  skills: { meaning: SkillProgress; writing: SkillProgress; article: SkillProgress | null }
}
export interface SkillProgress {
  correct: number
  wrong: number
  assisted: number
  unassistedCorrect: number
  lastAttemptAt: string | null
}
export type ExerciseKind = 'choose-meaning' | 'cloze' | 'match' | 'write-word' | 'choose-article'
export type CycleKind = 'initial' | 'scheduled' | 'recovery'
export type SessionTask = (
  | { taskId: string; kind: 'flashcard'; entryId: string; revealed: boolean }
  | { taskId: string; kind: 'choose-meaning'; entryId: string; optionIds: string[] }
  | { taskId: string; kind: 'cloze'; entryId: string; cycleKind: CycleKind }
  | { taskId: string; kind: 'write-word'; entryId: string; cycleKind: CycleKind }
  | { taskId: string; kind: 'choose-article'; entryId: string; options: ('der' | 'die' | 'das')[] }
  | { taskId: string; kind: 'match'; entryIds: string[]; leftOrder: string[]; rightOrder: string[]; matchedEntryIds: string[] }
) & { assisted?: boolean }
export interface Attempt {
  attemptId: string
  sessionId: string
  taskId: string
  entryId: string
  exercise: ExerciseKind
  answer: string
  correct: boolean
  independent: boolean
  assisted: boolean
  normalizationVersion: 'answer-normalization-v1' | typeof NORMALIZATION_VERSION
  at: string
  studyDate: string
}
export interface Feedback {
  attemptId: string
  entryId: string
  correct: boolean
  expectedAnswer: string
  explanationFa: string
  assisted: boolean
}
export interface AssistanceEvent {
  eventId: string
  sessionId: string
  taskId: string
  entryId: string
  kind: 'hint' | 'answer'
  at: string
  studyDate: string
}
export interface Session {
  lessonId: string
  sessionId: string
  contentVersion: string
  state: 'active' | 'paused' | 'ended'
  startedAt: string
  endedAt: string | null
  queue: SessionTask[]
  cursor: number
  introducedEntryIds: string[]
  draft: string
  feedback: Feedback | null
  activeMs: number
  targetAcknowledged: boolean
  targetAcknowledgedDate: string | null
}
export interface AppState {
  schemaVersion: 3
  learningPolicyVersion: typeof POLICY_VERSION
  contentVersion: string
  revision: number
  settings: { studyTimeZone: string; maxNewPerSession: 5; targetActiveMs: typeof TARGET_ACTIVE_MS }
  progress: Record<string, EntryProgress>
  attempts: Attempt[]
  session: Session | null
  activeLessonId: string
  savedSessions: Record<string, Session>
  assistanceEvents: AssistanceEvent[]
  dailyActivity: Record<string, number>
  activityEventIds: string[]
}
export type LearningCommand =
  | { type: 'start-session'; sessionId: string; seed: number }
  | { type: 'select-lesson'; lessonId: string }
  | { type: 'reveal-card'; taskId: string }
  | { type: 'next'; taskId: string }
  | { type: 'answer'; taskId: string; attemptId: string; answer: string; entryId?: string }
  | { type: 'draft'; taskId: string; value: string }
  | { type: 'assist'; taskId: string; eventId: string; kind: 'hint' | 'answer'; entryId?: string }
  | { type: 'activity'; eventId: string; sessionId: string; from: string; to: string; elapsedMs: number }
  | { type: 'continue-after-target' }
  | { type: 'pause' }
  | { type: 'end-session' }
export type EntryStatus = 'new' | 'learning' | 'due' | 'stabilized'
export interface HomeStats {
  introduced: number
  due: number
  newCount: number
  correct: number
  totalAnswers: number
  nextDueAt: string | null
  todayActiveMs: number
  stabilized: number
}
export interface SessionSummary {
  practiced: number
  introduced: number
  correct: number
  totalAnswers: number
  needsReview: number
  remaining: number
  nextDueAt: string | null
  activeMs: number
  assisted: number
}
export type OfflineStatus = 'checking' | 'ready' | 'unavailable'
export interface LessonSummary {
  lesson: LessonDefinition
  total: number
  introduced: number
  due: number
  stabilized: number
}
export interface WortzeitUIProps {
  bundle: ContentBundle
  state: AppState
  stats: HomeStats
  summary: SessionSummary
  statuses: Record<string, EntryStatus>
  now: string
  busy: boolean
  error: string | null
  offlineStatus: OfflineStatus
  onCommand: (command: LearningCommand) => Promise<void>
  onRetry: () => void
  onSessionVisibilityChange: (visible: boolean) => void
  activeLesson?: LessonDefinition
  lessonSummaries?: LessonSummary[]
  activeProvenance?: ContentBundle['provenance']
}
