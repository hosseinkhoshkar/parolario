import type { ContentBundle } from '../contracts/index.ts'
import { lessonBundles } from './lessons.ts'
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
export const courseBundle: ContentBundle = combineLessonBundles(lessonBundles)
