/** Shared phase-one contract. Content and persisted user state are separate. */
export const SCHEMA_VERSION = 1 as const
export const POLICY_VERSION = 'learning-policy-v1' as const
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
  meaningOptionEntryIds: string[]
  enabledExercises: ('flashcard' | 'choose-meaning' | 'cloze' | 'match')[]
  reviewStatus: 'excerpt-checked'
}
export interface ContentBundle {
  contentVersion: string
  sources: Source[]
  sourceRefs: SourceRef[]
  lesson: {
    lessonId: string
    titleDe: string
    titleFa: string
    level: 'A1'
    coverage: 'partial'
    introducedEntryIds: string[]
  }
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
  pendingError: null | { sessionId: string; remainingOtherAnswers: number; at: string }
}
export type ExerciseKind = 'choose-meaning' | 'cloze' | 'match'
export type CycleKind = 'initial' | 'scheduled' | 'recovery'
export type SessionTask =
  | { taskId: string; kind: 'flashcard'; entryId: string; revealed: boolean }
  | { taskId: string; kind: 'choose-meaning'; entryId: string; optionIds: string[] }
  | { taskId: string; kind: 'cloze'; entryId: string; cycleKind: CycleKind }
  | { taskId: string; kind: 'match'; entryIds: string[]; leftOrder: string[]; rightOrder: string[]; matchedEntryIds: string[] }
export interface Attempt {
  attemptId: string
  sessionId: string
  taskId: string
  entryId: string
  exercise: ExerciseKind
  answer: string
  correct: boolean
  independent: boolean
  at: string
  studyDate: string
}
export interface Feedback {
  attemptId: string
  entryId: string
  correct: boolean
  expectedAnswer: string
  explanationFa: string
}
export interface Session {
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
}
export interface AppState {
  schemaVersion: 1
  learningPolicyVersion: typeof POLICY_VERSION
  contentVersion: string
  revision: number
  settings: { studyTimeZone: string; maxNewPerSession: 5 }
  progress: Record<string, EntryProgress>
  attempts: Attempt[]
  session: Session | null
}
export type LearningCommand =
  | { type: 'start-session'; sessionId: string; seed: number }
  | { type: 'reveal-card'; taskId: string }
  | { type: 'next'; taskId: string }
  | { type: 'answer'; taskId: string; attemptId: string; answer: string; entryId?: string }
  | { type: 'draft'; taskId: string; value: string }
  | { type: 'pause' }
  | { type: 'end-session' }
export type EntryStatus = 'new' | 'learning' | 'due'
export interface HomeStats {
  introduced: number
  due: number
  newCount: number
  correct: number
  totalAnswers: number
  nextDueAt: string | null
}
export interface SessionSummary {
  practiced: number
  introduced: number
  correct: number
  totalAnswers: number
  needsReview: number
  remaining: number
  nextDueAt: string | null
}
export type OfflineStatus = 'checking' | 'ready' | 'unavailable'
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
}
