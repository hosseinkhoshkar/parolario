/** Historical synthetic test data only. Never imported by the product. */
import { lessonOneBundle as originalLesson } from '../../reference/legacy-wortzeit/src/content/lesson-one.ts'
import { courseBundle as originalCourse } from '../../reference/legacy-wortzeit/src/content/catalog.ts'
import type { ContentBundle as HistoricalBundle } from '../../reference/legacy-wortzeit/src/contracts/index.ts'
import type { ContentBundle } from '../contracts/index.ts'
function fixture(original: HistoricalBundle): ContentBundle {
  const lesson = (item: HistoricalBundle['lesson']) => { const { titleDe, ...rest } = item; return { ...rest, titleIt: titleDe } }
  return { ...original, lesson: lesson(original.lesson), lessons: original.lessons?.map(lesson),
    entries: original.entries.map(entry => { const { nounData, ...base } = entry; return ({ ...base,
      ...(nounData ? { nounData: { ...nounData,
        article: nounData.article === 'die' ? 'la' as const : nounData.article === 'der' ? 'il' as const : 'lo' as const,
        gender: nounData.article === 'die' ? 'feminine' as const : 'masculine' as const, number: 'singular' as const } } : {}),
      examples: entry.examples.map(({ de, ...example }) => ({ ...example, it: de })),
    }) }) }
}
export const lessonOneBundle = fixture(originalLesson)
export const courseBundle = fixture(originalCourse)
