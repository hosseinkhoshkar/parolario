import type { ContentBundle } from '../contracts/index.ts'

export function withTextbookStudyOrder(bundle: ContentBundle): ContentBundle {
  const textbookIds = new Set(bundle.sources.filter(source => source.kind === 'textbook').map(source => source.sourceId))
  const pages = new Map<string, number>()
  for (const ref of bundle.sourceRefs) {
    if (ref.lessonId !== bundle.lesson.lessonId || !textbookIds.has(ref.sourceId)) continue
    const page = /چاپی (\d+)(?=[\s؛،,]|$)/u.exec(ref.locator)
    if (page) pages.set(ref.sourceRefId, Number(page[1]))
  }
  // Stable sorting keeps source order on the same page and for entries without a textbook page.
  const ordered = bundle.entries.map(entry => ({
    entryId: entry.entryId,
    sourceOrder: entry.introductionOrder,
    page: Math.min(Number.MAX_SAFE_INTEGER, ...entry.sourceRefIds.map(id => pages.get(id) ?? Number.MAX_SAFE_INTEGER)),
  })).sort((a, b) => a.page - b.page || a.sourceOrder - b.sourceOrder)
  const rank = new Map(ordered.map(({ entryId }, index) => [entryId, index + 1]))
  return {
    ...bundle,
    lesson: { ...bundle.lesson, introducedEntryIds: [...rank.keys()] },
    entries: bundle.entries.map(entry => ({ ...entry, introductionOrder: rank.get(entry.entryId)! })),
  }
}
