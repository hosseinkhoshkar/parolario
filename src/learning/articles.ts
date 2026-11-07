import type { Entry, ItalianArticle } from '../contracts/index.ts'
export const ARTICLE_OPTIONS: readonly ItalianArticle[] = ['il', 'lo', 'la', "l'", 'i', 'gli', 'le']
export function hasArticle(entry: Entry): boolean {
  return entry.partOfSpeech === 'noun' && Boolean(entry.nounData?.article)
}
/** Distractors stay in the noun's specified singular/plural form. */
export function articleOptions(entry: Entry): ItalianArticle[] {
  if (!hasArticle(entry)) return []
  return entry.nounData!.number === 'plural' ? ['i', 'gli', 'le'] : ['il', 'lo', 'la', "l'"]
}
