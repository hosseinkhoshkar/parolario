import type { ContentBundle } from '../contracts/index.ts'

import { hasArticle, ARTICLE_OPTIONS } from '../learning/articles.ts'
function validAcceptedAnswers(answers: string[], canonical?: string): boolean {
  return answers.length > 0 && (!canonical || answers[0] === canonical) && new Set(answers).size === answers.length
    && answers.every(answer => answer.length > 0 && answer.trim() === answer && answer === answer.normalize('NFC'))
}

/** Fail before showing an exercise when its data is incomplete or inconsistent. */
export function validateContent(bundle: ContentBundle): string[] {
  const errors: string[] = []
  const ids = bundle.entries.map((entry) => entry.entryId)
  const byId = new Map(bundle.entries.map((entry) => [entry.entryId, entry]))
  const sourceIds = new Set(bundle.sources.map((source) => source.sourceId))
  const refIds = new Set(bundle.sourceRefs.map((ref) => ref.sourceRefId))
  const lessons = bundle.lessons ?? [bundle.lesson]
  const lessonIds = new Set(lessons.map(lesson => lesson.lessonId))
  if (!bundle.contentVersion || bundle.entries.length < 4) errors.push('A lesson requires at least four entries and a content version.')
  if (!lessons.length || lessonIds.size !== lessons.length || !lessonIds.has(bundle.lesson.lessonId)) errors.push('Invalid lesson catalog.')
  if (new Set(ids).size !== ids.length) errors.push('Duplicate entry ID.')
  if (new Set(bundle.sources.map((source) => source.sourceId)).size !== bundle.sources.length) errors.push('Duplicate source ID.')
  if (refIds.size !== bundle.sourceRefs.length) errors.push('Duplicate source reference ID.')
  if (lessons.some(lesson => lesson.coverage !== 'partial' || !lesson.titleIt.trim() || !lesson.titleFa.trim()) || bundle.provenance.reviewStatus !== 'excerpt-checked' || !bundle.provenance.noteFa) errors.push('Excerpt coverage or review status is missing.')
  for (const lesson of lessons) {
    const entries = bundle.entries.filter(entry => entry.introducedInLessonId === lesson.lessonId)
    const expected = entries.map(entry => entry.entryId)
    if (entries.length < 4 || new Set(lesson.introducedEntryIds).size !== expected.length || lesson.introducedEntryIds.length !== expected.length || expected.some(id => !lesson.introducedEntryIds.includes(id))) errors.push(`Introduction IDs must cover each entry once: ${lesson.lessonId}`)
    const orders = entries.map(entry => entry.introductionOrder)
    if (new Set(orders).size !== expected.length || orders.some(order => !Number.isInteger(order) || order < 1 || order > expected.length)) errors.push(`Introduction order must be unique and contiguous: ${lesson.lessonId}`)
  }
  for (const ref of bundle.sourceRefs) {
    if (!sourceIds.has(ref.sourceId) || !lessonIds.has(ref.lessonId) || !ref.locator.trim()) errors.push(`Broken source reference: ${ref.sourceRefId}`)
  }
  for (const entry of bundle.entries) {
    const at = entry.entryId
    if (!at || !entry.lemma.trim() || !entry.meaningFa.trim() || !lessonIds.has(entry.introducedInLessonId) || entry.reviewStatus !== 'excerpt-checked') errors.push(`Incomplete entry: ${at}`)
    if (!entry.sourceRefIds.length || new Set(entry.sourceRefIds).size !== entry.sourceRefIds.length || entry.sourceRefIds.some((id) => !refIds.has(id))) errors.push(`Broken entry source refs: ${at}`)
    if (!entry.occurrences.length || entry.occurrences.some((occurrence) => !lessonIds.has(occurrence.lessonId) || !occurrence.sourceRefIds.length || occurrence.sourceRefIds.some((id) => !entry.sourceRefIds.includes(id) || bundle.sourceRefs.find(ref => ref.sourceRefId === id)?.lessonId !== occurrence.lessonId)) || entry.sourceRefIds.some((id) => !entry.occurrences.some((occurrence) => occurrence.sourceRefIds.includes(id)))) errors.push(`Broken occurrences: ${at}`)
    if (entry.partOfSpeech === 'noun') {
      if (!entry.nounData || entry.nounData.article !== null && !ARTICLE_OPTIONS.includes(entry.nounData.article) || (entry.nounData.plural === null && !entry.nounData.pluralNote.trim())) errors.push(`Incomplete noun data: ${at}`)
    } else if (entry.nounData) errors.push(`Non-noun has article data: ${at}`)
    if (entry.nounData?.article === "l'" && !entry.nounData.gender) errors.push(`Elided article requires explicit gender: ${at}`)
    if (entry.examples.some(example => example.origin === 'quoted' && (!example.sourceRefId || !entry.sourceRefIds.includes(example.sourceRefId)))) errors.push(`Unreferenced quotation: ${at}`)
    const hasArticleExercise = entry.enabledExercises.includes('choose-article')
    if (hasArticleExercise !== hasArticle(entry)) errors.push(`Article exercise does not match noun eligibility: ${at}`)
    if (entry.examples.length !== 3 || new Set(entry.examples.map((example) => example.exampleId)).size !== entry.examples.length || entry.examples.some((example) => !example.exampleId || !['quoted', 'authored'].includes(example.origin) || !example.it.trim() || !example.fa.trim())) errors.push(`Invalid Italian example: ${at}`)
    const example = entry.examples.find((candidate) => candidate.exampleId === entry.cloze.exampleId)
    if (!example || entry.cloze.sentence.split('___').length !== 2 || !entry.cloze.translationFa.trim() || !validAcceptedAnswers(entry.cloze.acceptedAnswers) || entry.cloze.sentence.replace('___', entry.cloze.acceptedAnswers[0]) !== example.it) errors.push(`Invalid cloze: ${at}`)
    if (!entry.writing || !entry.writing.promptFa.trim() || !entry.writing.cueFa.trim() || typeof entry.writing.caseSensitive !== 'boolean' || !validAcceptedAnswers(entry.writing.acceptedAnswers, entry.lemma)) errors.push(`Invalid writing prompt or accepted answers: ${at}`)
    const optionIds = entry.meaningOptionEntryIds
    if (optionIds.length !== 4 || new Set(optionIds).size !== 4 || !optionIds.includes(at) || optionIds.some((id) => byId.get(id)?.introducedInLessonId !== entry.introducedInLessonId) || new Set(optionIds.map((id) => byId.get(id)?.meaningFa)).size !== 4) errors.push(`Invalid meaning options: ${at}`)
    if (['flashcard', 'choose-meaning', 'cloze', 'match', 'write-word'].some((kind) => !entry.enabledExercises.includes(kind as typeof entry.enabledExercises[number]))) errors.push(`Missing excerpt exercise: ${at}`)
  }
  return errors
}
