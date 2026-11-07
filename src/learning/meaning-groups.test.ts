import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ContentBundle, Entry } from '../contracts/index.ts'
import { courseBundle as bundle } from '../content/catalog.ts'
import { lessonTwoBundle } from '../content/lesson-two.ts'
import { createInitialState, transition } from './engine.ts'
import { validateState } from '../storage/index.ts'

const NOW = '2026-11-09T12:00:00.000Z'
const camera = lessonTwoBundle.entries.find(entry => entry.lemma === 'camera')!
const stanza = lessonTwoBundle.entries.find(entry => entry.lemma === 'stanza')!
const alternatives = lessonTwoBundle.entries.filter(entry => !entry.meaningGroup
  && entry.meaningFa !== camera.meaningFa && entry.meaningFa !== stanza.meaningFa)
  .filter((entry, index, all) => all.findIndex(other => other.meaningFa === entry.meaningFa) === index).slice(0, 3)
const firstFive = [camera, stanza, ...alternatives]

/** Only presentation ranks change; these remain actual lesson-two words and exercises. */
function prioritize(overrides: (entry: Entry) => Entry = entry => entry): ContentBundle {
  const rank = new Map([...firstFive, ...lessonTwoBundle.entries.filter(entry => !firstFive.includes(entry))]
    .map((entry, index) => [entry.entryId, index + 1]))
  return { ...bundle, entries: bundle.entries.map(entry => entry.introducedInLessonId === lessonTwoBundle.lesson.lessonId
    ? overrides({ ...entry, introductionOrder: rank.get(entry.entryId)! }) : entry) }
}
function start(content: ContentBundle, seed: number) {
  let state = createInitialState(content, 'Europe/Berlin')
  state = transition(state, { type: 'select-lesson', lessonId: lessonTwoBundle.lesson.lessonId }, content, NOW)
  state = transition(state, { type: 'start-session', sessionId: `meaning-groups-${seed}`, seed }, content, NOW)
  validateState(state, content)
  return state
}

test('every active Italian meaning question keeps explicit synonym groups and literal meanings distinct', () => {
  assert.ok(camera && stanza)
  assert.equal(camera.meaningGroup, 'room')
  assert.equal(stanza.meaningGroup, camera.meaningGroup)
  assert.notEqual(camera.meaningFa, stanza.meaningFa, 'the regression needs differently worded glosses for the same concept')
  for (const entry of bundle.entries) {
    const options = entry.meaningOptionEntryIds.map(id => bundle.entries.find(other => other.entryId === id)!)
    assert.equal(options.length, 4)
    assert.ok(options.every(option => option.introducedInLessonId === entry.introducedInLessonId))
    assert.equal(new Set(options.map(option => option.meaningFa)).size, 4, entry.entryId)
    const groups = options.flatMap(option => option.meaningGroup ? [option.meaningGroup] : [])
    assert.equal(new Set(groups).size, groups.length, entry.entryId)
  }
})

test('a five-word batch containing both actual room synonyms still produces an unambiguous four-pair game across seeds', () => {
  assert.equal(firstFive.length, 5)
  const content = prioritize()
  for (let seed = 0; seed < 12; seed++) {
    const state = start(content, seed)
    const cards = state.session!.queue.filter(task => task.kind === 'flashcard')
    assert.deepEqual(cards.map(task => task.entryId), firstFive.map(entry => entry.entryId))
    const game = state.session!.queue.find(task => task.kind === 'match')!
    assert.equal(game.kind, 'match')
    if (game.kind !== 'match') throw new Error('A four-pair game is required')
    assert.equal(game.entryIds.length, 4)
    assert.ok(game.entryIds.includes(camera.entryId))
    assert.ok(!game.entryIds.includes(stanza.entryId), 'the second synonym must not create a second indistinguishable pair')
    const entries = game.entryIds.map(id => content.entries.find(entry => entry.entryId === id)!)
    assert.equal(new Set(entries.map(entry => entry.meaningFa)).size, 4)
    assert.equal(entries.filter(entry => entry.meaningGroup === 'room').length, 1)
    assert.equal(new Set(game.leftOrder).size, 4)
    assert.equal(new Set(game.rightOrder).size, 4)
  }
})

test('different explicit groups do not allow identical literal meanings into one matching game', () => {
  // Synthetic conflict isolates literal-meaning protection from room-group protection.
  const content = prioritize(entry => entry.entryId === stanza.entryId
    ? { ...entry, meaningFa: camera.meaningFa, meaningGroup: 'synthetic-different-group' } : entry)
  const state = start(content, 43)
  const game = state.session!.queue.find(task => task.kind === 'match')!
  assert.equal(game.kind, 'match')
  if (game.kind !== 'match') throw new Error('Expected a game from four eligible meanings')
  assert.equal(game.entryIds.length, 4)
  assert.ok(game.entryIds.includes(camera.entryId))
  assert.ok(!game.entryIds.includes(stanza.entryId))
  assert.equal(new Set(game.entryIds.map(id => content.entries.find(entry => entry.entryId === id)!.meaningFa)).size, 4)
})
