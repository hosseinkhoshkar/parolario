import type { AppState, Session, SessionTask } from '../contracts/index.ts'

/** Old queue-length IDs could repeat after wrong answers removed future tasks.
 * Only tolerate fully completed, unassisted recall occurrences with one distinct
 * answer per occurrence. Keep all original IDs/evidence intact; never allow an
 * ambiguous live prompt or relax uniqueness for any other task. */
export function completedLegacyRecallIds(session: Session, state: AppState): Set<string> {
  const allowed = new Set<string>()
  if (session.state !== 'ended' || session.cursor !== session.queue.length || session.feedback !== null
    || !Array.isArray(state.attempts) || !Array.isArray(state.assistanceEvents)) return allowed
  const groups = new Map<string, SessionTask[]>()
  for (const task of session.queue) {
    if (!task || typeof task.taskId !== 'string') return allowed
    const group = groups.get(task.taskId) ?? []
    group.push(task)
    groups.set(task.taskId, group)
  }
  for (const [id, tasks] of groups) {
    if (tasks.length < 2) continue
    const first = tasks[0]
    if ((first.kind !== 'cloze' && first.kind !== 'write-word') || first.cycleKind !== 'recovery'
      || first.assisted !== undefined) continue
    const prefix = `${session.sessionId}:recall:${first.entryId}:`
    if (!id.startsWith(prefix) || !/^(?:boundary|resume)-\d+-\d+$/u.test(id.slice(prefix.length))) continue
    if (tasks.some(task => task.kind !== first.kind || !('entryId' in task) || task.entryId !== first.entryId
      || !('cycleKind' in task) || task.cycleKind !== 'recovery' || task.assisted !== undefined)) continue
    const answers = state.attempts.filter(attempt => attempt?.sessionId === session.sessionId && attempt.taskId === id)
    if (answers.length !== tasks.length || new Set(answers.map(attempt => attempt.attemptId)).size !== tasks.length
      || answers.some(attempt => attempt.entryId !== first.entryId || attempt.exercise !== first.kind
        || attempt.assisted || !attempt.independent)) continue
    if (state.assistanceEvents.some(event => event?.sessionId === session.sessionId && event.taskId === id)) continue
    allowed.add(id)
  }
  return allowed
}
