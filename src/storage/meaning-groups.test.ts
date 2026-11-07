import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { AppState, ContentBundle } from '../contracts/index.ts'
import { courseBundle as bundle } from '../content/catalog.ts'
import { lessonTwoBundle } from '../content/lesson-two.ts'
import { createInitialState, transition } from '../learning/engine.ts'
import { migrateState, StorageError, validateState } from './index.ts'

const NOW = '2026-11-09T12:00:00.000Z'
const camera = lessonTwoBundle.entries.find(entry => entry.lemma === 'camera')!
const stanza = lessonTwoBundle.entries.find(entry => entry.lemma === 'stanza')!
const alternatives = lessonTwoBundle.entries.filter(entry => !entry.meaningGroup
  && entry.meaningFa !== camera.meaningFa && entry.meaningFa !== stanza.meaningFa)
  .filter((entry, index, all) => all.findIndex(other => other.meaningFa === entry.meaningFa) === index).slice(0, 3)
const firstFive = [camera, stanza, ...alternatives]

function ready(contentOverride?: ContentBundle) {
  const ranks = new Map([...firstFive, ...lessonTwoBundle.entries.filter(entry => !firstFive.includes(entry))]
    .map((entry, index) => [entry.entryId, index + 1]))
  const content: ContentBundle = contentOverride ?? { ...bundle, entries: bundle.entries.map(entry =>
    entry.introducedInLessonId === lessonTwoBundle.lesson.lessonId ? { ...entry, introductionOrder: ranks.get(entry.entryId)! } : entry) }
  let state = createInitialState(content, 'Europe/Berlin')
  state = transition(state, { type: 'select-lesson', lessonId: lessonTwoBundle.lesson.lessonId }, content, NOW)
  state = transition(state, { type: 'start-session', sessionId: 'stored-meaning-groups', seed: 18 }, content, NOW)
  validateState(state, content)
  return { state, content }
}
function assertRejectedWithoutMutation(state: AppState, content: ContentBundle) {
  const unchanged = structuredClone(state)
  assert.throws(() => validateState(state, content), StorageError)
  assert.deepEqual(state, unchanged, 'validation cannot rewrite an ambiguous saved task into a different question')
}

test('saved meaning options reject the real room synonyms despite four unique IDs and literal glosses', () => {
  const { state, content } = ready()
  const original = structuredClone(state)
  const corrupted = structuredClone(state)
  const task = corrupted.session!.queue.find(task => task.kind === 'choose-meaning' && task.entryId === camera.entryId)!
  assert.equal(task.kind, 'choose-meaning')
  if (task.kind !== 'choose-meaning') throw new Error('Expected the room meaning question')
  task.optionIds = [camera.entryId, stanza.entryId, alternatives[0].entryId, alternatives[1].entryId]
  assert.equal(new Set(task.optionIds).size, 4)
  assert.equal(new Set(task.optionIds.map(id => content.entries.find(entry => entry.entryId === id)!.meaningFa)).size, 4)
  assertRejectedWithoutMutation(corrupted, content)
  assert.deepEqual(state, original)
  assert.deepEqual(migrateState(state, content), original)
})

test('saved matching pairs reject room synonyms without changing their old queue or evidence', () => {
  const { state, content } = ready()
  const original = structuredClone(state)
  const corrupted = structuredClone(state)
  const task = corrupted.session!.queue.find(task => task.kind === 'match')!
  assert.equal(task.kind, 'match')
  if (task.kind !== 'match') throw new Error('Expected a matching game')
  task.entryIds = [camera.entryId, stanza.entryId, alternatives[0].entryId, alternatives[1].entryId]
  task.leftOrder = [...task.entryIds]
  task.rightOrder = [...task.entryIds].reverse()
  task.matchedEntryIds = []
  assert.equal(new Set(task.entryIds).size, 4)
  assert.equal(new Set(task.entryIds.map(id => content.entries.find(entry => entry.entryId === id)!.meaningFa)).size, 4)
  assertRejectedWithoutMutation(corrupted, content)
  assert.deepEqual(state, original)
})

test('different groups cannot conceal literal-meaning duplicates in stored options or matching pairs', () => {
  const first = ready()
  const content: ContentBundle = { ...first.content, entries: first.content.entries.map(entry => entry.entryId === stanza.entryId
    ? { ...entry, meaningFa: camera.meaningFa, meaningGroup: 'synthetic-different-group' } : entry) }
  const { state } = ready(content)
  const ids = [camera.entryId, stanza.entryId, alternatives[0].entryId, alternatives[1].entryId]
  assert.notEqual(content.entries.find(entry => entry.entryId === camera.entryId)!.meaningGroup,
    content.entries.find(entry => entry.entryId === stanza.entryId)!.meaningGroup)
  for (const kind of ['choose-meaning', 'match'] as const) {
    const corrupted = structuredClone(state)
    const task = corrupted.session!.queue.find(task => task.kind === kind && (kind === 'match' || 'entryId' in task && task.entryId === camera.entryId))!
    if (task.kind === 'choose-meaning') task.optionIds = [...ids]
    else if (task.kind === 'match') {
      task.entryIds = [...ids]; task.leftOrder = [...ids]; task.rightOrder = [...ids].reverse(); task.matchedEntryIds = []
    } else throw new Error('Expected stored exercise')
    assertRejectedWithoutMutation(corrupted, content)
  }
})

test('the pre-lesson-two first-lesson save remains unchanged with group metadata confined to content', () => {
  const baseline: AppState = JSON.parse(readFileSync(new URL('./fixtures/pre-lesson-two-schema5.json', import.meta.url), 'utf8'))
  const original = structuredClone(baseline)
  assert.ok(bundle.entries.some(entry => entry.meaningGroup === 'room'))
  validateState(baseline, bundle)
  assert.deepEqual(migrateState(baseline, bundle), original)
  assert.deepEqual(baseline, original)
  assert.ok(!JSON.stringify(baseline).includes('meaningGroup'), 'the additive content hint is not a new save field')
})
