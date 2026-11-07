import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ActivityTracker } from './activity.ts'
import type { LearningCommand } from '../contracts/index.ts'

function clockHarness() {
  let monotonic = 0, wall = Date.parse('2026-10-28T12:00:00.000Z'), id = 0
  let callback: (() => void) | null = null
  const records: Extract<LearningCommand, { type: 'activity' }>[] = []
  const tracker = new ActivityTracker('session', {
    monotonic: () => monotonic, wallTime: () => new Date(wall).toISOString(), eventId: () => `time-${id++}`,
    everySecond: cb => { callback = cb; return () => { callback = null } },
  }, command => { if (command.type === 'activity') records.push(command) })
  return { tracker, records, advance(ms: number) { monotonic += ms; wall += ms },
    wallJump(ms: number) { wall += ms }, pulse() { callback?.() } }
}

test('pause and hidden time contribute nothing; stop flushes the final visible slice once', () => {
  const clock = clockHarness()
  clock.tracker.start()
  clock.advance(1000); clock.pulse()
  clock.advance(250); clock.tracker.stop()
  clock.advance(60_000); clock.pulse()
  clock.tracker.stop()
  assert.equal(clock.records.reduce((total, event) => total + event.elapsedMs, 0), 1250)
  clock.tracker.start()
  clock.advance(500); clock.tracker.stop()
  assert.equal(clock.records.reduce((total, event) => total + event.elapsedMs, 0), 1750)
  assert.equal(new Set(clock.records.map(event => event.eventId)).size, 3)
})

test('wall clock jumps and long suspensions cannot fabricate twenty minutes of activity', () => {
  const clock = clockHarness()
  clock.tracker.start()
  clock.advance(1000); clock.wallJump(1_200_000); clock.pulse()
  assert.equal(clock.records[0].elapsedMs, 1000)
  assert.equal(Date.parse(clock.records[0].to) - Date.parse(clock.records[0].from), 1000)
  clock.advance(1_200_000); clock.pulse()
  assert.equal(clock.records.length, 1)
  clock.advance(1000); clock.tracker.stop()
  assert.equal(clock.records.reduce((total, event) => total + event.elapsedMs, 0), 2000)
})
