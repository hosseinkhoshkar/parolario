import type { ContentBundle, Entry, ItalianArticle } from '../contracts/index.ts'
import sourceRows from './italian-source.json' with { type: 'json' }
import pedagogyData from './italian-pedagogy.json' with { type: 'json' }
import { additionalExamplesByEntry } from './additional-examples.ts'
import { hasArticle } from '../learning/articles.ts'

const lessonId = 'it-a1-lesson-01'
interface Pedagogy {
  sourceRow: number; entryId: string; lemma: string; partOfSpeech: Entry['partOfSpeech']; sourceOrder: number
  nounData?: { article: ItalianArticle | null; gender: 'masculine' | 'feminine' | null; number: 'singular' | 'plural'; plural: string | null; pluralNote: string }
  cueFa: string; caseSensitive: boolean; acceptedAnswers: string[]
  cloze: { sentence: string; translationFa: string; acceptedAnswers: string[]; additionalExampleIndex: number; cueFa?: string }
}
const pedagogy = pedagogyData as Pedagogy[]
if (pedagogy.length !== sourceRows.length || new Set(pedagogy.map(row => row.entryId)).size !== sourceRows.length) throw new Error('Incomplete Italian pedagogy')
const sourceRefs = sourceRows.map(row => ({ sourceRefId: `it-a1-l01-${String(row.row).padStart(3, '0')}-book`,
  sourceId: 'nuovo-espresso-1', lessonId, locator: row.locator }))
const entries: Entry[] = sourceRows.map(row => {
  const data = pedagogy.find(item => item.sourceRow === row.row)
  const entryId = `it-a1-l01-${String(row.row).padStart(3, '0')}`
  if (!data || data.entryId !== entryId) throw new Error(`Missing Italian pedagogy: ${entryId}`)
  const sourceRefIds = [`${entryId}-book`]
  const additions = additionalExamplesByEntry[entryId]
  if (!additions || additions.length !== 2) throw new Error(`Missing Italian examples: ${entryId}`)
  const clozeExample = additions[data.cloze.additionalExampleIndex]
  const entry: Entry = {
    entryId, introducedInLessonId: lessonId, introductionOrder: data.sourceOrder,
    sourceHeadword: row.word, sourceRow: row.row, formNoteFa: row.noteFa,
    lemma: data.lemma, partOfSpeech: data.partOfSpeech, meaningFa: row.meaningFa,
    ...(data.nounData ? { nounData: data.nounData } : {}), sourceRefIds,
    occurrences: [{ lessonId, sourceRefIds }],
    examples: [{ exampleId: `${entryId}-quoted`, it: row.exampleIt, fa: row.exampleFa, origin: 'quoted', sourceRefId: sourceRefIds[0] }, ...additions],
    cloze: { sentence: data.cloze.sentence, translationFa: data.cloze.translationFa,
      acceptedAnswers: data.cloze.acceptedAnswers, exampleId: clozeExample.exampleId, cueFa: data.cloze.cueFa },
    writing: { promptFa: row.meaningFa, cueFa: data.cueFa, acceptedAnswers: data.acceptedAnswers, caseSensitive: data.caseSensitive },
    meaningOptionEntryIds: [], enabledExercises: ['flashcard', 'choose-meaning', 'cloze', 'match', 'write-word'], reviewStatus: 'excerpt-checked',
  }
  if (hasArticle(entry)) entry.enabledExercises.push('choose-article')
  return entry
})
// Reviewed targets use unrelated meanings as distractors, including for synonymous greetings.
for (const entry of entries) {
  const primaryMeaning = (value: Entry) => value.meaningFa.split('؛')[0]
  const pool = entries.filter(other => other.entryId !== entry.entryId && other.meaningFa !== entry.meaningFa
    && primaryMeaning(other) !== primaryMeaning(entry) && (entry.partOfSpeech === 'phrase' ? other.partOfSpeech === 'noun' : other.partOfSpeech !== entry.partOfSpeech))
  const unique = [...new Map(pool.map(other => [primaryMeaning(other), other])).values()]
  const offset = entry.sourceRow! % unique.length
  entry.meaningOptionEntryIds = [entry.entryId, ...[0, 1, 2].map(index => unique[(offset + index) % unique.length].entryId)]
}
export const lessonOneBundle: ContentBundle = {
  contentVersion: 'nuovo-espresso-a1-it-v1',
  sources: [{ sourceId: 'nuovo-espresso-1', kind: 'textbook', title: 'Nuovo Espresso 1 — libro dello studente e esercizi', edition: null }],
  sourceRefs, lesson: { lessonId, titleIt: 'Primi contatti', titleFa: 'نخستین آشنایی‌ها', level: 'A1', coverage: 'partial', introducedEntryIds: entries.map(entry => entry.entryId) },
  entries, provenance: { file: 'reference/vocabulary/italian/Lesson-01-A1.txt', reviewStatus: 'excerpt-checked',
    noteFa: '۸۵ واژه و عبارت منتخب درس اول؛ نمونهٔ هر مدخل از PDF و دو مثال تکمیلی تألیفی‌اند. این گزیده تأیید جامع اصل کتاب نیست. صورت جمع و آرتیکل نامعلوم حدس زده نشده‌اند.' },
}
