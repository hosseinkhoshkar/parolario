import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { courseBundle, lessonBundles } from './catalog.ts'
import { extendEntryExamples } from './extend-examples.ts'
import { discoverExampleCatalog, validateExampleCatalog } from '../../scripts/example-catalog.mjs'

test('every discovered source lesson has exactly two authored, paired examples for every unchanged source row', async () => {
  const lessons = await discoverExampleCatalog()
  const sources = readdirSync('reference/vocabulary/italian').filter(name => /^Lesson-\d+-(A1|A2|B1)\.txt$/u.test(name))
  assert.equal(lessons.length, sources.length)
  assert.deepEqual(validateExampleCatalog(lessons), [])
  assert.equal(lessons.length, 3)
  assert.equal(lessons[0].rows.length, 85)
  assert.equal(lessons.reduce((sum: number, lesson: { rows: unknown[] }) => sum + lesson.rows.length, 0), courseBundle.entries.length)
  const sorted = lessons.map((lesson: { catalog: { lessonNumber: number } }) => lesson.catalog.lessonNumber)
  assert.deepEqual(sorted, [...sorted].sort((a, b) => a - b))
})

test('all active entry identities, original examples and game data stay intact; attachment is idempotent', () => {
  const originals = lessonBundles.flatMap(bundle => bundle.entries)
  for (const original of originals) {
    const extended = courseBundle.entries.find(entry => entry.entryId === original.entryId)!
    assert.equal(extended.examples.length, 3)
    assert.deepEqual(extended.examples[0], original.examples[0])
    const { sourceRefIds: originalRefs, occurrences: originalOccurrences, ...originalCore } = original
    const { sourceRefIds: extendedRefs, occurrences: extendedOccurrences, ...extendedCore } = extended
    assert.deepEqual(extendedCore, originalCore)
    assert.ok(originalRefs.every(id => extendedRefs.includes(id)))
    assert.ok(originalOccurrences.every(item => extendedOccurrences.some(occurrence => occurrence.lessonId === item.lessonId && item.sourceRefIds.every(id => occurrence.sourceRefIds.includes(id)))))
    assert.equal(new Set(extended.examples.map(example => example.it)).size, 3)
    assert.deepEqual(extendEntryExamples(extended), extended)
    assert.equal(original.examples.length, 3)
  }
})

test('sync is deterministic and never rewrites the authored data or original source files', async () => {
  const before = readFileSync('src/content/additional-examples.ts', 'utf8')
  const sources = (await discoverExampleCatalog()).map((lesson: { filename: string; catalogFile: string }) => [
    `reference/vocabulary/italian/${lesson.filename}`, `public/content/examples/italian/${lesson.catalogFile}`,
  ]).flat()
  const snapshots = sources.map((file: string) => readFileSync(file, 'utf8'))
  await import(new URL('../../scripts/sync-examples.mjs', import.meta.url).href + '?validation=' + Date.now())
  assert.equal(readFileSync('src/content/additional-examples.ts', 'utf8'), before)
  assert.deepEqual(sources.map((file: string) => readFileSync(file, 'utf8')), snapshots)
})

test('catalog validation rejects missing or duplicated examples, broken translations and changed source identity', async () => {
  const lessons = await discoverExampleCatalog()
  for (const mutate of [
    (value: typeof lessons) => { value[0].catalog.entries[0].additionalExamples.pop() },
    (value: typeof lessons) => { value[0].catalog.entries[0].additionalExamples[1] = structuredClone(value[0].catalog.entries[0].additionalExamples[0]) },
    (value: typeof lessons) => { value[0].catalog.entries[0].additionalExamples[0].fa = 'German only' },
    (value: typeof lessons) => { value[0].catalog.entries[0].word = 'invented' },
    (value: typeof lessons) => { value[0].catalog.level = 'B1' },
  ]) {
    const broken = structuredClone(lessons)
    mutate(broken)
    assert.ok(validateExampleCatalog(broken).length > 0)
  }
})
