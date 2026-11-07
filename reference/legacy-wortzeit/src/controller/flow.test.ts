import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lessonOneBundle as bundle } from '../content/lesson-one.ts'
import { createInitialState, currentTask, getHomeStats, summarizeSession, transition } from '../learning/engine.ts'
import { validateState } from '../storage/index.ts'
import type { AppState, LearningCommand } from '../contracts/index.ts'

test('actual twenty-entry bundle completes four five-word sessions with valid restorable snapshots', () => {
  const now = '2026-10-28T12:00:00.000Z'
  let state = createInitialState(bundle, 'Europe/Berlin')
  let attempt = 0
  const introduced = new Set<string>()
  function commit(command: LearningCommand) {
    const before = state
    state = transition(state, command, bundle, now)
    if (state !== before) assert.equal(state.revision, before.revision + 1)
    validateState(state, bundle)
    state = structuredClone(state) // A snapshot round-trip, not an IndexedDB/browser claim.
  }
  for (let session = 0; session < 4; session++) {
    commit({ type: 'start-session', sessionId: `actual-${session}`, seed: 123 + session })
    let steps = 0
    while (state.session!.state !== 'ended') {
      assert.ok(steps++ < 150)
      const task = currentTask(state)!
      if (state.session!.feedback) { commit({ type: 'next', taskId: task.taskId }); continue }
      if (task.kind === 'flashcard') {
        commit({ type: 'reveal-card', taskId: task.taskId })
        commit({ type: 'next', taskId: task.taskId })
      } else if (task.kind === 'match') {
        const id = task.entryIds.find(id => !task.matchedEntryIds.includes(id))!
        commit({ type: 'answer', taskId: task.taskId, attemptId: `a-${attempt++}`, entryId: id, answer: id })
      } else {
        const entry = bundle.entries.find(entry => entry.entryId === task.entryId)!
        const answer = task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0]
          : task.kind === 'write-word' ? entry.writing.acceptedAnswers[0]
            : task.kind === 'choose-article' ? entry.nounData!.article : entry.entryId
        if (task.kind === 'cloze' || task.kind === 'write-word') {
          commit({ type: 'draft', taskId: task.taskId, value: answer })
          // Simulated reload marks the loaded session paused, as loadState does.
          const restored: AppState = structuredClone(state)
          restored.session!.state = 'paused'
          state = restored
          commit({ type: 'start-session', sessionId: 'ignored-on-resume', seed: 1 })
          assert.equal(currentTask(state)!.taskId, task.taskId)
          assert.equal(state.session!.draft, answer)
        }
        const command = { type: 'answer' as const, taskId: task.taskId, attemptId: `a-${attempt++}`, answer }
        commit(command)
        const count = state.attempts.length
        commit(command)
        assert.equal(state.attempts.length, count)
      }
    }
    assert.equal(state.session!.introducedEntryIds.length, 5)
    for (const id of state.session!.introducedEntryIds) { assert.ok(!introduced.has(id)); introduced.add(id) }
    assert.equal(summarizeSession(state, now).practiced, 5)
    assert.equal(state.attempts.filter(item => item.sessionId === `actual-${session}` && item.exercise === 'match').length, 4)
  }
  assert.equal(introduced.size, 20)
  assert.equal(getHomeStats(state, bundle, now).newCount, 0)
  assert.equal(Object.values(state.progress).filter(item => item.intervalIndex === 0).length, 20)
  assert.equal(Object.values(state.progress).every(item => item.nextDueAt === '2026-10-29T12:00:00.000Z'), true)
  commit({ type: 'start-session', sessionId: 'empty', seed: 1 })
  assert.equal(state.session!.state, 'ended')
})
