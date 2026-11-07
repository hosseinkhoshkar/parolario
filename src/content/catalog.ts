import type { ContentBundle } from '../contracts/index.ts'
import { lessonBundles } from './lessons.ts'
import repeatedOccurrences from './lesson-two-occurrences.json' with { type: 'json' }
export { lessonBundles }
/** Registry aggregation preserves independently sourced future lessons. */
export function combineLessonBundles(bundles: ContentBundle[]): ContentBundle {
  if (!bundles.length) throw new Error('An active course requires a sourced lesson')
  if (bundles.some(bundle => bundle.contentVersion !== bundles[0].contentVersion)) throw new Error('Incompatible lesson content identity')
  return { contentVersion: bundles[0].contentVersion, lesson: bundles[0].lesson,
    lessons: bundles.map(bundle => bundle.lesson),
    sources: [...new Map(bundles.flatMap(bundle => bundle.sources).map(source => [source.sourceId, source])).values()],
    sourceRefs: bundles.flatMap(bundle => bundle.sourceRefs), entries: bundles.flatMap(bundle => bundle.entries),
    provenance: { file: bundles.map(bundle => bundle.provenance.file).join('؛ '), reviewStatus: 'excerpt-checked',
      noteFa: bundles.map(bundle => bundle.provenance.noteFa).join(' ') } }
}
/** Repeated source occurrences keep the original identity and all original examples. */
function withRepeatedOccurrences(bundle: ContentBundle): ContentBundle {
  const lessonId = 'it-a1-lesson-02'
  const extraRefs = repeatedOccurrences.flatMap(row => row.refs.map((ref,index) => ({
    sourceRefId: `${row.entryId}-lesson-02-ref-${index+1}`, sourceId: 'nuovo-espresso-1', lessonId, locator: ref.locator,
  })))
  const entries = bundle.entries.map(entry => {
    const repeat = repeatedOccurrences.find(row => row.entryId === entry.entryId)
    if (!repeat) return entry
    const sourceRefIds = repeat.refs.map((_,index) => `${entry.entryId}-lesson-02-ref-${index+1}`)
    return { ...entry, sourceRefIds: [...entry.sourceRefIds,...sourceRefIds],
      occurrences: [...entry.occurrences,{ lessonId,sourceRefIds }] }
  })
  for (const row of repeatedOccurrences) if (!entries.some(entry => entry.entryId === row.entryId && entry.introducedInLessonId !== lessonId)) throw new Error(`Unknown repeated entry: ${row.entryId}`)
  return { ...bundle, sourceRefs: [...bundle.sourceRefs,...extraRefs], entries }
}
export const courseBundle: ContentBundle = withRepeatedOccurrences(combineLessonBundles(lessonBundles))
