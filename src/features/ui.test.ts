import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import ts from 'typescript'
import type { ContentBundle, Entry, EntryProgress, LessonDefinition, SessionTask, WortzeitUIProps } from '../contracts/index.ts'
import { lessonOneBundle as bundle } from '../content/lesson-one.ts'
import { courseBundle } from '../content/catalog.ts'
import { createInitialState } from '../learning/engine.ts'

// Native Node does not load TSX/CSS. Compile the real view in memory and render it
// with React SSR. These are static content/accessibility checks, not browser proof.
const require = createRequire(import.meta.url)
const source = readFileSync(new URL('./WortzeitUI.tsx', import.meta.url), 'utf8')
const javascript = ts.transpileModule(`${source}\nexport { TaskPanel, SkillDetails, LessonCards, LessonWordList, lessonEntries, ReverseReviewSummary, TargetPrompt, PronunciationProvider }`, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
}).outputText.replace(/import ['"]\.\.\/App\.css['"];?/u, '')
  .replace(/from (['"])(react(?:\/jsx-runtime)?)\1/gu,
    (_match, _quote: string, specifier: string) => `from '${pathToFileURL(require.resolve(specifier)).href}'`)
  .replace("from '../learning/examples.ts'", `from '${new URL('../learning/examples.ts', import.meta.url).href}'`)
  .replace("from './pronunciation.ts'", `from '${new URL('./pronunciation.ts', import.meta.url).href}'`)
const view = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)
function renderToStaticMarkup(element: ReactNode) {
  return renderMarkup(createElement(view.PronunciationProvider, null, element))
}
const now = '2026-10-28T12:00:00.000Z'

function propsFor(task: SessionTask): WortzeitUIProps {
  const state = createInitialState(bundle, 'Europe/Berlin')
  state.session = {
    sessionId: 'ui-session', lessonId: bundle.lesson.lessonId, contentVersion: bundle.contentVersion, state: 'active', startedAt: now,
    endedAt: null, queue: [task], cursor: 0, introducedEntryIds: [], draft: '', feedback: null,
    activeMs: 0, targetAcknowledged: false, targetAcknowledgedDate: null,
  }
  return {
    bundle, state, stats: { introduced: 0, due: 0, newCount: 20, correct: 0, totalAnswers: 0, nextDueAt: null, todayActiveMs: 0, stabilized: 0 },
    summary: { practiced: 0, introduced: 0, correct: 0, totalAnswers: 0, needsReview: 0, remaining: 1, nextDueAt: null, activeMs: 0, assisted: 0 },
    statuses: Object.fromEntries(bundle.entries.map(entry => [entry.entryId, 'new'])), now,
    busy: false, error: null, offlineStatus: 'unavailable', onCommand: async () => {}, onRetry: () => {},
    onSessionVisibilityChange: () => {},
  }
}
function renderTask(task: SessionTask, props = propsFor(task)) {
  return renderToStaticMarkup(createElement(view.TaskPanel, { task, props }))
}
const noun = bundle.entries.find(entry => entry.nounData)!
const verb = bundle.entries.find(entry => entry.partOfSpeech === 'verb')!
const writing = (entry: Entry): SessionTask => ({ taskId: 'write', kind: 'write-word', entryId: entry.entryId, cycleKind: 'scheduled' })

test('writing displays only Persian prompt/cue before answering, with German LTR draft input', () => {
  const task = writing(noun)
  const props = propsFor(task)
  props.state.session!.draft = 'An'
  const html = renderTask(task, props)
  assert.ok(html.includes(noun.writing.promptFa))
  assert.ok(html.includes(noun.writing.cueFa))
  assert.ok(!html.includes(noun.writing.acceptedAnswers[0]))
  assert.ok(!html.includes('speaker-button'), 'writing cannot play a hidden answer or sentence')
  assert.match(html, /id="german-answer" lang="de" dir="ltr"/u)
  assert.match(html, /value="An"/u)
  assert.match(html, /نمایش پاسخ/u)
})

test('article question hides the article until feedback and provides all three touch options', () => {
  const task: SessionTask = { taskId: 'article', kind: 'choose-article', entryId: noun.entryId, options: ['das', 'der', 'die'] }
  const props = propsFor(task)
  const html = renderTask(task, props)
  assert.ok(html.includes(noun.lemma))
  assert.ok(!html.includes('class="article"'))
  assert.match(html, /speaker-button/u, 'the visible noun can be played without its hidden article')
  for (const option of task.options) assert.ok(html.includes(`>${option}</button>`))
  props.state.session!.feedback = { attemptId: 'a', entryId: noun.entryId, correct: true, expectedAnswer: noun.nounData!.article, explanationFa: 'ثبت شد', assisted: false }
  const answered = renderTask(task, props)
  assert.match(answered, /class="article"/u)
  assert.ok(answered.includes(noun.meaningFa))
})

test('accepted written variants still show the canonical answer and assisted evidence explicitly', () => {
  const task = writing(noun)
  const props = propsFor(task)
  props.state.session!.draft = noun.writing.acceptedAnswers[0].toLocaleLowerCase('de')
  props.state.session!.feedback = { attemptId: 'a', entryId: noun.entryId, correct: true, expectedAnswer: noun.writing.acceptedAnswers[0], explanationFa: 'ثبت شد', assisted: true }
  const html = renderTask(task, props)
  assert.match(html, /صورت معیار:/u)
  assert.ok(html.includes(noun.writing.acceptedAnswers[0]))
  assert.match(html, /این تلاش با کمک ثبت شد/u)
  assert.match(html, /یادآوری مستقل یا پلهٔ تازهٔ مرور محسوب نمی‌شود/u)
})

test('persisted answer assistance reveals only after assisted state and event are present', () => {
  const task: SessionTask = { ...writing(verb), assisted: true }
  const props = propsFor(task)
  props.state.assistanceEvents.push({ eventId: 'help', sessionId: 'ui-session', taskId: task.taskId,
    entryId: verb.entryId, kind: 'answer', at: now, studyDate: '2026-10-28' })
  const html = renderTask(task, props)
  assert.ok(html.includes(verb.writing.acceptedAnswers[0]))
  assert.match(html, /این تلاش مستقل محسوب نمی‌شود/u)
})

test('skill details separate all four counts and mark article inapplicable to a verb', () => {
  const counts = { correct: 4, wrong: 2, assisted: 1, unassistedCorrect: 3, lastAttemptAt: now }
  const progress: EntryProgress = { entryId: verb.entryId, introducedAt: now, initialRecallPending: false,
    nextDueAt: now, intervalIndex: 0, lastSuccessDate: '2026-10-28', scheduledReviewDates: [], correctCount: 4,
    wrongCount: 2, pendingError: null, skills: { meaning: counts, writing: counts, article: null } }
  const html = renderToStaticMarkup(createElement(view.SkillDetails, { entry: verb, progress }))
  for (const label of ['شناخت معنی', 'نوشتن واژه', 'آرتیکل', 'درست', 'غلط', 'با کمک', 'بدون کمک']) assert.ok(html.includes(label))
  assert.match(html, /برای این مدخل کاربرد ندارد/u)
  assert.match(html, /جمع این آمار، معیار تسلط نیست/u)
})

// A synthetic fourth-lesson fixture checks view separation without claiming book coverage.
const lessonFour: LessonDefinition = { lessonId: 'lesson-04', titleDe: 'Spiel und Spaß', titleFa: 'بازی و سرگرمی', level: 'A1', coverage: 'partial', introducedEntryIds: ['fixture-four'] }
const fourthWord: Entry = { ...noun, entryId: 'fixture-four', introducedInLessonId: 'lesson-04', lemma: 'Kurs', meaningFa: 'دورهٔ آزمایشی چهارم', sourceRefIds: ['fixture-four-ref'], occurrences: [{ lessonId: 'lesson-04', sourceRefIds: ['fixture-four-ref'] }] }
const course: ContentBundle = { ...bundle, lessons: [bundle.lesson, lessonFour], entries: [...bundle.entries, fourthWord], sourceRefs: [...bundle.sourceRefs, { sourceRefId: 'fixture-four-ref', sourceId: bundle.sources[0].sourceId, lessonId: 'lesson-04', locator: 'fixture, not book content' }] }

test('lesson cards expose each ready lesson independently with real counts and active selection', () => {
  const html = renderToStaticMarkup(createElement(view.LessonCards, { activeLessonId: 'lesson-04', disabled: false, onChoose: async () => {}, summaries: [
    { lesson: bundle.lesson, total: 20, introduced: 5, due: 2, stabilized: 0 },
    { lesson: lessonFour, total: 84, introduced: 0, due: 0, stabilized: 0 },
  ] }))
  assert.equal((html.match(/data-lesson-id=/gu) ?? []).length, 2)
  assert.ok(html.includes(`data-lesson-id="${bundle.lesson.lessonId}"`))
  assert.match(html, /class="lesson-card lesson-current" data-lesson-id="lesson-04"/u)
  assert.ok(html.includes('ورود به درس اول') && html.includes('ورود به درس چهارم'))
  assert.ok(html.includes('Ich und die anderen') && html.includes('Spiel und Spaß'))
  assert.match(html, /aria-valuemax="84" aria-valuenow="0"/u)
  assert.ok(!html.includes('lesson-02') && !html.includes('lesson-03'))
})

test('selected lesson home uses its title and count while retaining a visible lessons navigation', () => {
  const props = propsFor(writing(noun))
  props.bundle = course
  props.state.activeLessonId = lessonFour.lessonId
  props.state.session = null
  props.activeLesson = lessonFour
  const html = renderToStaticMarkup(createElement(view.WortzeitUI, props))
  const hero = html.match(/<section class="hero-panel">([\s\S]*?)<\/section>/u)?.[1] ?? ''
  assert.ok(hero.includes('Spiel und Spaß') && hero.includes('درس چهارم'))
  assert.ok(!hero.includes('Ich und die anderen') && !hero.includes('درس اول'))
  assert.match(html, /Lektion 04/u)
  assert.match(html, /تغییر درس/u)
  assert.match(html, /دسترسی به درس‌ها/u)
  assert.match(html, /واژه‌های معرفی‌شده در بسته" aria-valuemin="0" aria-valuemax="1"/u)
})

test('fourth lesson vocabulary renders only that lesson and keeps unrelated entries hidden', () => {
  const props = propsFor(writing(noun))
  props.bundle = course
  props.state.activeLessonId = lessonFour.lessonId
  const entries = view.lessonEntries(course, lessonFour.lessonId)
  const html = renderToStaticMarkup(createElement(view.LessonWordList, { entries, props: { ...props, statuses: { ...props.statuses, 'fixture-four': 'new' } } }))
  assert.equal(entries.length, 1)
  assert.ok(html.includes('دورهٔ آزمایشی چهارم') && html.includes('Kurs'))
  const main = [...html.matchAll(/class="word-item-main">([\s\S]*?)<\/span><span class="word-status/gu)]
  assert.equal(main.length, 1)
  assert.match(html, /class="speech-text"/u)
  assert.ok(!html.includes('speaker-button'), 'vocabulary uses its German text instead of a speaker icon')
  assert.ok(main[0][1].includes('Kurs') && main[0][1].includes('دورهٔ آزمایشی چهارم'))
  assert.ok(!main[0][1].includes('Hallo') && !main[0][1].includes('Familienname'))
  assert.match(html, /lang="de" dir="ltr"/u)
})


test('lesson-five vocabulary follows its flashcard introduction order', () => {
  const entries: Entry[] = view.lessonEntries(courseBundle, 'lesson-05')
  const fifth = courseBundle.lessons!.find(lesson => lesson.lessonId === 'lesson-05')!
  assert.equal(entries.length, 76)
  assert.deepEqual(entries.map(entry => entry.entryId), fifth.introducedEntryIds)
  assert.deepEqual(entries.slice(0, 5).map(entry => entry.lemma), ['Es geht', 'Internet', 'Vermieter', 'abholen', 'ausziehen'])
})

test('reverse card conceals every German answer and example until persisted reveal', () => {
  const task: SessionTask = { taskId: 'reverse', kind: 'reverse-card', entryId: noun.entryId, revealed: false }
  const html = renderTask(task)
  assert.ok(html.includes(noun.meaningFa))
  assert.ok(html.includes(noun.writing.cueFa))
  assert.ok(!html.includes(noun.lemma))
  assert.ok(!html.includes(noun.examples[0].de))
  assert.ok(!html.includes('reverse-rating'))
  assert.ok(!html.includes('speaker-button'), 'hidden German has no audio control')
  assert.match(html, /reverse-reveal/u)
  assert.match(html, /نمایش پاسخ/u)
})

test('revealed reverse card restores German article and self-assessment without ordinary next', () => {
  const task: SessionTask = { taskId: 'reverse', kind: 'reverse-card', entryId: noun.entryId, revealed: true }
  const html = renderTask(task)
  assert.ok(html.includes(noun.lemma))
  assert.match(html, /class="article"/u)
  assert.match(html, /درست گفتم/u)
  assert.match(html, /اشتباه گفتم/u)
  assert.match(html, /ارجاع این واژه/u)
  assert.match(html, /پخش تلفظ واژهٔ آلمانی/u)
  assert.match(html, /پخش تلفظ جملهٔ آلمانی/u)
  assert.ok(!html.includes('reverse-reveal'))
  assert.ok(!html.includes('feedback-next'))
})

test('unrevealed normal card reserves its next action but prevents skipping introduction', () => {
  const task: SessionTask = { taskId: 'card', kind: 'flashcard', entryId: noun.entryId, revealed: false }
  const html = renderTask(task)
  assert.match(html, /class="primary-button wide flashcard-next" disabled=""/u)
})

test('feedback replaces choice controls and reserves a clear next action', () => {
  const task: SessionTask = { taskId: 'meaning', kind: 'choose-meaning', entryId: noun.entryId, optionIds: noun.meaningOptionEntryIds }
  const props = propsFor(task)
  props.state.session!.feedback = { attemptId: 'a', entryId: noun.entryId, correct: true, expectedAnswer: noun.meaningFa, explanationFa: 'ثبت شد', assisted: false }
  const html = renderTask(task, props)
  assert.ok(!html.includes('meaning-options'))
  assert.match(html, /feedback-next/u)
  assert.match(html, /مثال و توضیح پاسخ/u)
})


test('reverse review summary reports self-assessed recall separately from original attempts', () => {
  const reviews = [
    { reviewId: 'r1', sessionId: 's', taskId: 't1', entryId: noun.entryId, correct: true, at: now, studyDate: '2026-10-28' },
    { reviewId: 'r2', sessionId: 's', taskId: 't2', entryId: verb.entryId, correct: false, at: now, studyDate: '2026-10-28' },
  ]
  const html = renderToStaticMarkup(createElement(view.ReverseReviewSummary, { reviews }))
  assert.match(html, /ارزیابی شخصی فارسی به آلمانی/u)
  assert.match(html, /<strong>۲<\/strong> واژه/u)
  assert.match(html, /<strong>۱<\/strong> درست گفتم/u)
  assert.match(html, /<strong>۱<\/strong> اشتباه گفتم/u)
  assert.ok(!html.includes('تسلط') && !html.includes('تثبیت‌شده'))
})


test('daily target prompt uses a labelled native dialog and explicit continuation controls', () => {
  const html = renderToStaticMarkup(createElement(view.TargetPrompt, { active: true, minutes: 20, disabled: false, onFinish: async () => {}, onContinue: async () => {} }))
  assert.match(html, /<dialog[^>]+class="target-banner target-dialog"[^>]+aria-labelledby=/u)
  assert.ok(!html.includes('role="status"'))
  assert.match(html, /پایان و دیدن خلاصه/u)
  assert.match(html, /ادامهٔ تمرین/u)
})


const expandedNoun: Entry = { ...noun, examples: [noun.examples[0],
  { exampleId: 'ui-extra-1', de: 'Das ist ein neuer Beispielsatz.', fa: 'این یک جملهٔ نمونهٔ تازه است.', origin: 'authored' },
  { exampleId: 'ui-extra-2', de: 'Wir lesen diesen Satz zusammen.', fa: 'ما این جمله را با هم می‌خوانیم.', origin: 'authored' },
] }
function expandedProps(task: SessionTask) {
  const props = propsFor(task)
  props.bundle = { ...bundle, entries: bundle.entries.map(entry => entry.entryId === expandedNoun.entryId ? expandedNoun : entry) }
  return props
}

test('initial learning keeps the original example on the card and offers extras only after reveal', () => {
  const task: SessionTask = { taskId: 'card-more', kind: 'flashcard', entryId: noun.entryId, revealed: false }
  const props = expandedProps(task)
  const hidden = renderTask(task, props)
  assert.ok(!hidden.includes('مثال‌های بیشتر'))
  assert.ok(!hidden.includes(expandedNoun.examples[1].de))
  task.revealed = true
  const html = renderTask(task, props)
  const back = html.match(/class="card-face card-back"[\s\S]*?class="card-detail-row"/u)?.[0] ?? ''
  assert.ok(back.includes(expandedNoun.examples[0].de))
  assert.ok(!back.includes(expandedNoun.examples[1].de) && !back.includes(expandedNoun.examples[2].de))
  assert.match(html, /مثال‌های بیشتر/u)
  assert.ok(html.includes(expandedNoun.examples[1].de) && html.includes(expandedNoun.examples[1].fa))
  assert.ok(html.includes(expandedNoun.examples[2].de) && html.includes(expandedNoun.examples[2].fa))
})

test('reverse sentence rotates only with completed review history, not rendering or manual example access', () => {
  const task: SessionTask = { taskId: 'reverse-examples', kind: 'reverse-card', entryId: noun.entryId, revealed: true }
  const props = expandedProps(task)
  for (const [completed, index] of [[0, 1], [1, 2], [2, 0], [3, 1]]) {
    props.state.reverseReviews = Array.from({ length: completed }, (_, i) => ({ reviewId: `past-${i}`, sessionId: `past-session-${i}`,
      taskId: `past-task-${i}`, entryId: noun.entryId, correct: i % 2 === 0, at: now, studyDate: '2026-10-28' }))
    const before = structuredClone(props.state)
    const html = renderTask(task, props)
    const direct = html.match(/class="reverse-example">([\s\S]*?)<div class="card-detail-row"/u)?.[1] ?? ''
    assert.ok(direct.includes(expandedNoun.examples[index].de) && direct.includes(expandedNoun.examples[index].fa))
    for (let other = 0; other < 3; other++) if (other !== index) assert.ok(!direct.includes(expandedNoun.examples[other].de))
    assert.match(html, /این جمله را بلند بخوان/u)
    assert.match(html, /دیدن مثال‌ها امتیاز مرور را تغییر نمی‌دهد/u)
    assert.equal(renderTask(task, props), html)
    assert.deepEqual(props.state, before)
  }
})

test('unrevealed reverse card exposes no original or additional examples or extra-example control', () => {
  const task: SessionTask = { taskId: 'reverse-hidden-extras', kind: 'reverse-card', entryId: noun.entryId, revealed: false }
  const html = renderTask(task, expandedProps(task))
  for (const example of expandedNoun.examples) { assert.ok(!html.includes(example.de)); assert.ok(!html.includes(example.fa)) }
  assert.ok(!html.includes('مثال‌های بیشتر'))
})

test('word details retain the original sentence and allow manual access to the two paired additional examples', () => {
  const props = expandedProps({ taskId: 'card', kind: 'flashcard', entryId: noun.entryId, revealed: true })
  const html = renderToStaticMarkup(createElement(view.LessonWordList, { entries: [expandedNoun], props }))
  for (const example of expandedNoun.examples) { assert.ok(html.includes(example.de)); assert.ok(html.includes(example.fa)) }
  assert.match(html, /مثال‌های بیشتر/u)
  assert.equal((html.match(/<dialog/gu) ?? []).length, 2, 'examples and sources are separate dialogs')
})

test('the active catalog renders six lesson cards with independent counts and eighth-lesson selection', () => {
  const summaries = courseBundle.lessons!.map(lesson => ({ lesson,
    total: courseBundle.entries.filter(entry => entry.introducedInLessonId === lesson.lessonId).length,
    introduced: 0, due: 0, stabilized: 0,
  }))
  const html = renderToStaticMarkup(createElement(view.LessonCards, { activeLessonId: 'lesson-08', disabled: false, onChoose: async () => {}, summaries }))
  assert.equal((html.match(/data-lesson-id=/gu) ?? []).length, 6)
  for (const count of [20, 84, 76, 80, 55, 52]) assert.ok(html.includes(`aria-valuemax="${count}"`))
  assert.ok(html.includes('Endlich ein Zimmer!') && html.includes('بالاخره یک اتاق!'))
  assert.ok(html.includes('Kleider machen Freunde') && html.includes('لباس و دوستان تازه'))
  assert.ok(html.includes('Grüezi in der Schweiz') && html.includes('سلام از سوئیس'))
  assert.ok(html.includes('Mmh, das schmeckt!') && html.includes('چه خوشمزه!'))
  assert.match(html, /class="lesson-card lesson-current" data-lesson-id="lesson-08"/u)
  assert.match(html, /ورود به درس پنجم/u)
})

test('all 76 real lesson-five reverse answers stay hidden until reveal, then expose bilingual examples and pronunciation', () => {
  for (const entry of courseBundle.entries.filter(entry => entry.introducedInLessonId === 'lesson-05')) {
    const task: SessionTask = { taskId: 'fifth-reverse-ui', kind: 'reverse-card', entryId: entry.entryId, revealed: false }
    const props = propsFor(task)
    props.bundle = courseBundle
    props.state.activeLessonId = 'lesson-05'
    const hidden = renderTask(task, props)
    assert.ok(!hidden.includes(entry.lemma))
    assert.ok(!hidden.includes('speaker-button') && !hidden.includes('مثال‌های بیشتر'))
    for (const example of entry.examples) assert.ok(!hidden.includes(example.de) && !hidden.includes(example.fa))
    const revealed = renderTask({ ...task, revealed: true }, props)
    assert.ok(revealed.includes(entry.lemma))
    assert.ok(revealed.includes(entry.examples[1].de) && revealed.includes(entry.examples[1].fa))
    assert.match(revealed, /پخش تلفظ واژهٔ آلمانی/u)
    assert.match(revealed, /پخش تلفظ جملهٔ آلمانی/u)
    assert.match(revealed, /مثال‌های بیشتر/u)
  }
})

test('real lesson-five clozes show Persian cues to distinguish Bad/Badezimmer and overlapping fetching verbs', () => {
  for (const lemma of ['Bad', 'Badezimmer', 'abholen', 'holen', 'bringen', 'mitbringen']) {
    const entry = courseBundle.entries.find(entry => entry.introducedInLessonId === 'lesson-05' && entry.lemma === lemma)!
    const task: SessionTask = { taskId: 'fifth-cloze-cue', kind: 'cloze', entryId: entry.entryId, cycleKind: 'initial' }
    const props = propsFor(task)
    props.bundle = courseBundle
    const html = renderTask(task, props)
    assert.ok(html.includes(entry.cloze.translationFa))
    assert.ok(html.includes(`<p class="writing-cue">${entry.writing.cueFa}</p>`))
    assert.equal((html.match(/class="speech-text"/gu) ?? []).length, 1, 'only the visible sentence has a playback control')
  }
})
