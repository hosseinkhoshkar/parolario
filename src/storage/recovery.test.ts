import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { courseBundle } from '../content/catalog.ts'
import { loadState, readRecoverySnapshot, StorageError } from './index.ts'
import { indexedDBModel } from './test-idb.ts'

test('a snapshot rejected at startup remains fully readable for recovery without rewriting it', async () => {
  const snapshot = JSON.parse(readFileSync(new URL('./fixtures/pre-lesson-three-schema5.json', import.meta.url), 'utf8'))
  // Deliberately inconsistent counters: recovery must preserve the evidence as-is.
  Object.values(snapshot.progress as Record<string, { correctCount: number }>)[0].correctCount++
  const original = structuredClone(snapshot)
  const model = indexedDBModel(snapshot), previous = globalThis.indexedDB
  globalThis.indexedDB = model.factory
  try {
    await assert.rejects(loadState(courseBundle), StorageError)
    const recovered = await readRecoverySnapshot()
    assert.deepEqual(recovered, original)
    assert.deepEqual(JSON.parse(JSON.stringify(recovered)), original)
    assert.deepEqual(model.read(), original)
    assert.deepEqual(model.keys(), ['current'])
    assert.deepEqual(model.modes(), ['readwrite', 'readonly'])
  } finally { globalThis.indexedDB = previous }
})

test('recovery reads foreign and malformed snapshots without interpreting or dropping fields', async () => {
  const previous = globalThis.indexedDB
  try {
    for (const snapshot of [null, { schemaVersion: 99, originalAnswers: ['caffè', '  sì  '], unknownField: { keep: true } }]) {
      const model = indexedDBModel(snapshot)
      globalThis.indexedDB = model.factory
      assert.deepEqual(await readRecoverySnapshot(), snapshot)
      assert.deepEqual(model.read(), snapshot)
      assert.deepEqual(model.modes(), ['readonly'])
    }
  } finally { globalThis.indexedDB = previous }
})

test('empty storage reports no backup rather than inventing a replacement state', async () => {
  const model = indexedDBModel(), previous = globalThis.indexedDB
  globalThis.indexedDB = model.factory
  try {
    await assert.rejects(readRecoverySnapshot(), /پیشرفت ذخیره‌شده‌ای/)
    assert.equal(model.read(), undefined)
    assert.deepEqual(model.keys(), [])
    assert.deepEqual(model.modes(), ['readonly'])
  } finally { globalThis.indexedDB = previous }
})
