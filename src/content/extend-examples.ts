import type { Entry } from '../contracts/index.ts'
import { additionalExamplesByEntry } from './additional-examples.ts'

/** Preserve the original object/data; stable example IDs make attachment idempotent. */
export function extendEntryExamples(entry: Entry): Entry {
  const additions = additionalExamplesByEntry[entry.entryId]
  if (!additions || additions.length !== 2) throw new Error(`Missing authored examples: ${entry.entryId}`)
  const examples = [...entry.examples]
  for (const additional of additions) {
    const existing = examples.find(example => example.exampleId === additional.exampleId)
    if (existing) {
      if (existing.it !== additional.it || existing.fa !== additional.fa || existing.origin !== additional.origin) {
        throw new Error(`Conflicting authored example identity: ${additional.exampleId}`)
      }
    } else examples.push(additional)
  }
  return { ...entry, examples }
}
