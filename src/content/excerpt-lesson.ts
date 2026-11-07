import type { ContentBundle, Entry, LessonDefinition, SourceRef } from '../contracts/index.ts'

export type ExcerptPedagogy = readonly [
  partOfSpeech: Entry['partOfSpeech'],
  exampleDe: string,
  exampleFa: string,
  cueFa: string,
]

interface ExcerptLesson {
  lesson: Omit<LessonDefinition, 'introducedEntryIds'>
  contentVersion: string
  rows: readonly { entryId: string; headword: string; meaningFa: string; refs: readonly string[] }[]
  pedagogy: (entryId: string) => ExcerptPedagogy
  keyboardAlternatives: Record<string, string[]>
  overlappingGroups: readonly (readonly string[])[]
  pluralNotes?: Record<string, string>
  provenance: ContentBundle['provenance']
}

function sourceIdFor(locator: string): string {
  if (locator.startsWith('کتاب درسی:')) return 'source-textbook'
  if (locator.startsWith('کتاب تمرین:')) return 'source-workbook'
  if (locator.startsWith('متن گفت‌وگوهای صوتی:')) return 'source-audio-transcript'
  throw new Error(`Unknown excerpt source: ${locator}`)
}

export function buildExcerptLesson({ lesson, contentVersion, rows, pedagogy, keyboardAlternatives, overlappingGroups, pluralNotes, provenance }: ExcerptLesson): ContentBundle {
  const lessonId = lesson.lessonId
  const sourceRefs: SourceRef[] = []
  const entries: Entry[] = rows.map((row, index) => {
    const [partOfSpeech, exampleDe, exampleFa, cueFa] = pedagogy(row.entryId)
    const nounMatch = /^(der|die|das) (.+)$/u.exec(row.headword)
    const article = nounMatch?.[1] as 'der' | 'die' | 'das' | undefined
    const lemma = nounMatch?.[2] ?? row.headword
    const answers = [lemma, ...(keyboardAlternatives[lemma] ?? [])]
    const sourceRefIds = row.refs.map((locator, refIndex) => {
      const sourceRefId = `${row.entryId}-ref-${refIndex + 1}`
      sourceRefs.push({ sourceRefId, sourceId: sourceIdFor(locator), lessonId, locator })
      return sourceRefId
    })
    if (!exampleDe.includes(lemma)) throw new Error(`Example must contain canonical headword: ${row.entryId}`)
    const excluded = overlappingGroups.find(group => group.includes(row.headword)) ?? []
    const candidates = rows.filter(other => other.entryId !== row.entryId && !excluded.includes(other.headword) && other.meaningFa !== row.meaningFa)
    const sameRole = candidates.filter(other => pedagogy(other.entryId)[0] === partOfSpeech)
    const otherRole = candidates.filter(other => pedagogy(other.entryId)[0] !== partOfSpeech)
    const optionPool = [...new Map((sameRole.length >= 3 ? sameRole : [...sameRole, ...otherRole]).map(other => [other.meaningFa, other])).values()]
    const options = [0, 1, 2].map(offset => optionPool[(index + offset) % optionPool.length].entryId)
    const exampleId = `${row.entryId}-example`
    return {
      entryId: row.entryId, introducedInLessonId: lessonId, introductionOrder: index + 1,
      lemma, partOfSpeech, meaningFa: row.meaningFa,
      ...(article ? { nounData: { article, plural: null, pluralNote: pluralNotes?.[lemma]
        ?? 'جمع در فایل واژگان ارائه نشده است؛ صورت جمع حدس زده نشده است.' } } : {}),
      sourceRefIds, occurrences: [{ lessonId, sourceRefIds: [...sourceRefIds] }],
      examples: [{ exampleId, de: exampleDe, fa: exampleFa, origin: 'authored' }],
      cloze: { sentence: exampleDe.replace(lemma, '___'), translationFa: exampleFa, acceptedAnswers: [...answers], exampleId },
      writing: { promptFa: row.meaningFa, cueFa, acceptedAnswers: [...answers], caseSensitive: false },
      meaningOptionEntryIds: [row.entryId, ...options],
      enabledExercises: ['flashcard', 'choose-meaning', 'cloze', 'match', 'write-word', ...(article ? ['choose-article' as const] : [])],
      reviewStatus: 'excerpt-checked',
    }
  })
  return {
    contentVersion,
    sources: [
      { sourceId: 'source-textbook', kind: 'textbook', title: 'DaF kompakt A1–B1 — کتاب درسی', edition: null },
      { sourceId: 'source-workbook', kind: 'workbook', title: 'DaF kompakt A1–B1 — کتاب تمرین', edition: null },
      { sourceId: 'source-audio-transcript', kind: 'audioTranscript', title: 'DaF kompakt A1–B1 — متن گفت‌وگوهای صوتی', edition: null },
    ],
    sourceRefs,
    lesson: { ...lesson, introducedEntryIds: entries.map(entry => entry.entryId) },
    entries,
    provenance,
  }
}
