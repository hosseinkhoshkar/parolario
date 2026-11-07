import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import ts from 'typescript'
import type { ContentBundle, Entry, EntryProgress, LessonDefinition, SessionTask, ParolarioUIProps } from '../contracts/index.ts'
import { lessonOneBundle as bundle } from '../testing/legacy-fixture.ts'
import { courseBundle as italianCourse } from '../content/catalog.ts'
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

function propsFor(task: SessionTask, targetBundle = bundle): ParolarioUIProps {
  const bundle = targetBundle
  const state = createInitialState(bundle, 'Europe/Berlin')
  state.session = {
    sessionId: 'ui-session', lessonId: bundle.lesson.lessonId, contentVersion: bundle.contentVersion, state: 'active', startedAt: now,
    endedAt: null, queue: [task], cursor: 0, introducedEntryIds: [], draft: '', feedback: null,
    activeMs: 0, targetAcknowledged: false, targetAcknowledgedDate: null,
  }
  return {
    bundle, state, stats: { introduced: 0, due: 0, newCount: bundle.entries.length, correct: 0, totalAnswers: 0, nextDueAt: null, todayActiveMs: 0, stabilized: 0 },
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

test('writing displays only Persian prompt/cue before answering, with Italian LTR draft input', () => {
  const task = writing(noun)
  const props = propsFor(task)
  props.state.session!.draft = 'An'
  const html = renderTask(task, props)
  assert.ok(html.includes(noun.writing.promptFa))
  assert.ok(html.includes(noun.writing.cueFa))
  assert.ok(!html.includes(noun.writing.acceptedAnswers[0]))
  assert.ok(!html.includes('speaker-button'), 'writing cannot play a hidden answer or sentence')
  assert.match(html, /id="italian-answer" lang="it" dir="ltr"/u)
  assert.match(html, /value="An"/u)
  assert.match(html, /نمایش پاسخ/u)
})

test('article question hides the article until feedback and provides all supplied Italian touch options', () => {
  const task: SessionTask = { taskId: 'article', kind: 'choose-article', entryId: noun.entryId, options: ['lo', 'il', 'la', "l'"] }
  const props = propsFor(task)
  const html = renderTask(task, props)
  assert.ok(html.includes(noun.lemma))
  assert.ok(!html.includes('class="article"'))
  assert.match(html, /speaker-button/u, 'the visible noun can be played without its hidden article')
  for (const option of task.options) assert.ok(html.includes(`>${escapedText(option)}</button>`))
  props.state.session!.feedback = { attemptId: 'a', entryId: noun.entryId, correct: true, expectedAnswer: noun.nounData!.article!, explanationFa: 'ثبت شد', assisted: false }
  const answered = renderTask(task, props)
  assert.match(answered, /class="article"/u)
  assert.ok(answered.includes(noun.meaningFa))
})

test('accepted written variants still show the canonical answer and assisted evidence explicitly', () => {
  const task = writing(noun)
  const props = propsFor(task)
  props.state.session!.draft = noun.writing.acceptedAnswers[0].toLocaleLowerCase('it')
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
const lessonFour: LessonDefinition = { lessonId: 'lesson-04', titleIt: 'In classe', titleFa: 'بازی و سرگرمی', level: 'A1', coverage: 'partial', introducedEntryIds: ['fixture-four'] }
const fourthWord: Entry = { ...noun, entryId: 'fixture-four', introducedInLessonId: 'lesson-04', lemma: 'corso', meaningFa: 'دورهٔ آزمایشی چهارم', sourceRefIds: ['fixture-four-ref'], occurrences: [{ lessonId: 'lesson-04', sourceRefIds: ['fixture-four-ref'] }] }
const course: ContentBundle = { ...bundle, lessons: [bundle.lesson, lessonFour], entries: [...bundle.entries, fourthWord], sourceRefs: [...bundle.sourceRefs, { sourceRefId: 'fixture-four-ref', sourceId: bundle.sources[0].sourceId, lessonId: 'lesson-04', locator: 'fixture, not book content' }] }

test('lesson cards expose each ready lesson independently with real counts and active selection', () => {
  const html = renderToStaticMarkup(createElement(view.LessonCards, { activeLessonId: 'lesson-04', disabled: false, onChoose: async () => {}, summaries: [
    { lesson: bundle.lesson, total: 20, introduced: 5, due: 2, stabilized: 0 },
    { lesson: lessonFour, total: 1, introduced: 0, due: 0, stabilized: 0 },
  ] }))
  assert.equal((html.match(/data-lesson-id=/gu) ?? []).length, 2)
  assert.ok(html.includes(`data-lesson-id="${bundle.lesson.lessonId}"`))
  assert.match(html, /class="lesson-card lesson-current" data-lesson-id="lesson-04"/u)
  assert.ok(html.includes('ورود به درس اول') && html.includes('ورود به درس چهارم'))
  assert.ok(html.includes('Ich und die anderen') && html.includes('In classe'))
  assert.match(html, /aria-valuemax="1" aria-valuenow="0"/u)
  assert.ok(!html.includes('lesson-02') && !html.includes('lesson-03'))
})

test('selected lesson home uses its title and count while retaining a visible lessons navigation', () => {
  const props = propsFor(writing(noun))
  props.bundle = course
  props.state.activeLessonId = lessonFour.lessonId
  props.state.session = null
  props.activeLesson = lessonFour
  const html = renderToStaticMarkup(createElement(view.ParolarioUI, props))
  const hero = html.match(/<section class="hero-panel">([\s\S]*?)<\/section>/u)?.[1] ?? ''
  assert.ok(hero.includes('In classe') && hero.includes('درس چهارم'))
  assert.ok(!hero.includes('Ich und die anderen') && !hero.includes('درس اول'))
  assert.match(html, /Lezione 04/u)
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
  assert.ok(html.includes('دورهٔ آزمایشی چهارم') && html.includes('corso'))
  const main = [...html.matchAll(/class="word-item-main">([\s\S]*?)<\/span><span class="word-status/gu)]
  assert.equal(main.length, 1)
  assert.match(html, /class="speech-text"/u)
  assert.ok(!html.includes('speaker-button'), 'vocabulary uses its Italian text instead of a speaker icon')
  assert.ok(main[0][1].includes('corso') && main[0][1].includes('دورهٔ آزمایشی چهارم'))
  assert.ok(!main[0][1].includes('Hallo') && !main[0][1].includes('Familienname'))
  assert.match(html, /lang="it" dir="ltr"/u)
})


test('Italian lesson vocabulary follows its flashcard introduction order and printed pages', () => {
  const lesson = italianCourse.lesson
  const entries: Entry[] = view.lessonEntries(italianCourse, lesson.lessonId)
  assert.equal(entries.length, 85)
  assert.deepEqual(entries.map(entry => entry.entryId), lesson.introducedEntryIds)
  assert.deepEqual(entries.slice(0, 5).map(entry => entry.entryId), lesson.introducedEntryIds.slice(0, 5))
  const pages = entries.map(entry => Math.min(...entry.sourceRefIds.map(id => {
    const ref = italianCourse.sourceRefs.find(item => item.sourceRefId === id)!
    return Number(ref.locator.match(/چاپی (\d+)/u)![1])
  })))
  assert.deepEqual(pages, [...pages].sort((a, b) => a - b))
})

test('reverse card conceals every Italian answer and example until persisted reveal', () => {
  const task: SessionTask = { taskId: 'reverse', kind: 'reverse-card', entryId: noun.entryId, revealed: false }
  const html = renderTask(task)
  assert.ok(html.includes(noun.meaningFa))
  assert.ok(html.includes(noun.writing.cueFa))
  assert.ok(!html.includes(noun.lemma))
  assert.ok(!html.includes(noun.examples[0].it))
  assert.ok(!html.includes('reverse-rating'))
  assert.ok(!html.includes('speaker-button'), 'hidden Italian has no audio control')
  assert.match(html, /reverse-reveal/u)
  assert.match(html, /نمایش پاسخ/u)
})

test('revealed reverse card restores Italian article and self-assessment without ordinary next', () => {
  const task: SessionTask = { taskId: 'reverse', kind: 'reverse-card', entryId: noun.entryId, revealed: true }
  const html = renderTask(task)
  assert.ok(html.includes(noun.lemma))
  assert.match(html, /class="article"/u)
  assert.match(html, /درست گفتم/u)
  assert.match(html, /اشتباه گفتم/u)
  assert.match(html, /ارجاع این واژه/u)
  assert.match(html, /پخش تلفظ واژهٔ ایتالیایی/u)
  assert.match(html, /پخش تلفظ جملهٔ ایتالیایی/u)
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
  assert.match(html, /ارزیابی شخصی فارسی به ایتالیایی/u)
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
  { exampleId: 'ui-extra-1', it: 'Questa è una frase nuova.', fa: 'این یک جملهٔ نمونهٔ تازه است.', origin: 'authored' },
  { exampleId: 'ui-extra-2', it: 'Leggiamo questa frase insieme.', fa: 'ما این جمله را با هم می‌خوانیم.', origin: 'authored' },
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
  assert.ok(!hidden.includes(expandedNoun.examples[1].it))
  task.revealed = true
  const html = renderTask(task, props)
  const back = html.match(/class="card-face card-back"[\s\S]*?class="card-detail-row"/u)?.[0] ?? ''
  assert.ok(back.includes(expandedNoun.examples[0].it))
  assert.ok(!back.includes(expandedNoun.examples[1].it) && !back.includes(expandedNoun.examples[2].it))
  assert.match(html, /مثال‌های بیشتر/u)
  assert.ok(html.includes(expandedNoun.examples[1].it) && html.includes(expandedNoun.examples[1].fa))
  assert.ok(html.includes(expandedNoun.examples[2].it) && html.includes(expandedNoun.examples[2].fa))
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
    assert.ok(direct.includes(expandedNoun.examples[index].it) && direct.includes(expandedNoun.examples[index].fa))
    for (let other = 0; other < 3; other++) if (other !== index) assert.ok(!direct.includes(expandedNoun.examples[other].it))
    assert.match(html, /این جمله را بلند بخوان/u)
    assert.match(html, /دیدن مثال‌ها امتیاز مرور را تغییر نمی‌دهد/u)
    assert.equal(renderTask(task, props), html)
    assert.deepEqual(props.state, before)
  }
})

test('unrevealed reverse card exposes no original or additional examples or extra-example control', () => {
  const task: SessionTask = { taskId: 'reverse-hidden-extras', kind: 'reverse-card', entryId: noun.entryId, revealed: false }
  const html = renderTask(task, expandedProps(task))
  for (const example of expandedNoun.examples) { assert.ok(!html.includes(example.it)); assert.ok(!html.includes(example.fa)) }
  assert.ok(!html.includes('مثال‌های بیشتر'))
})

test('word details retain the original sentence and allow manual access to the two paired additional examples', () => {
  const props = expandedProps({ taskId: 'card', kind: 'flashcard', entryId: noun.entryId, revealed: true })
  const html = renderToStaticMarkup(createElement(view.LessonWordList, { entries: [expandedNoun], props }))
  for (const example of expandedNoun.examples) { assert.ok(html.includes(example.it)); assert.ok(html.includes(example.fa)) }
  assert.match(html, /مثال‌های بیشتر/u)
  assert.equal((html.match(/<dialog/gu) ?? []).length, 2, 'examples and sources are separate dialogs')
})

function escapedText(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;')
}

test('the active Italian catalog renders the ready lesson with its real count and active selection', () => {
  const summaries = italianCourse.lessons!.map(lesson => ({ lesson,
    total: italianCourse.entries.filter(entry => entry.introducedInLessonId === lesson.lessonId).length,
    introduced: 0, due: 0, stabilized: 0,
  }))
  const html = renderToStaticMarkup(createElement(view.LessonCards, { activeLessonId: italianCourse.lesson.lessonId, disabled: false, onChoose: async () => {}, summaries }))
  assert.equal((html.match(/data-lesson-id=/gu) ?? []).length, 1)
  assert.ok(html.includes('aria-valuemax="85"'))
  assert.ok(html.includes('Primi contatti') && html.includes(italianCourse.lesson.titleFa))
  assert.ok(html.includes(`class="lesson-card lesson-current" data-lesson-id="${italianCourse.lesson.lessonId}"`))
  assert.match(html, /ورود به درس اول/u)
  assert.match(html, /Lezione 01/u)
  for (const legacy of ['Endlich ein Zimmer!', 'Kleider machen Freunde', 'Grüezi in der Schweiz', 'Mmh, das schmeckt!']) assert.ok(!html.includes(legacy))
})

test('all 85 Italian reverse answers stay hidden until reveal, then expose paired examples and pronunciation', () => {
  assert.equal(italianCourse.entries.length, 85)
  for (const entry of italianCourse.entries) {
    const task: SessionTask = { taskId: `italian-reverse-${entry.entryId}`, kind: 'reverse-card', entryId: entry.entryId, revealed: false }
    const props = propsFor(task, italianCourse)
    const hidden = renderTask(task, props)
    assert.ok(!hidden.includes('reverse-answer') && !hidden.includes('lang="it"'), entry.entryId)
    assert.ok(!hidden.includes('speaker-button') && !hidden.includes('مثال‌های بیشتر'), entry.entryId)
    for (const example of entry.examples) assert.ok(!hidden.includes(escapedText(example.it)), entry.entryId)
    const revealed = renderTask({ ...task, revealed: true }, props)
    assert.ok(revealed.includes(escapedText(entry.lemma)), entry.entryId)
    assert.ok(revealed.includes(escapedText(entry.examples[1].it)) && revealed.includes(escapedText(entry.examples[1].fa)), entry.entryId)
    assert.match(revealed, /پخش تلفظ واژهٔ ایتالیایی/u)
    assert.match(revealed, /پخش تلفظ جملهٔ ایتالیایی/u)
    assert.match(revealed, /مثال‌های بیشتر/u)
  }
})

test('all Italian clozes show their Persian cues without exposing the hidden word to audio', () => {
  assert.equal(italianCourse.entries.length, 85)
  for (const entry of italianCourse.entries) {
    const task: SessionTask = { taskId: `italian-cloze-${entry.entryId}`, kind: 'cloze', entryId: entry.entryId, cycleKind: 'initial' }
    const props = propsFor(task, italianCourse)
    const html = renderTask(task, props)
    assert.ok(html.includes(escapedText(entry.cloze.translationFa)), entry.entryId)
    assert.ok(html.includes(`<p class="writing-cue">${escapedText(entry.cloze.cueFa ?? entry.writing.cueFa)}</p>`), entry.entryId)
    assert.equal((html.match(/class="speech-text"/gu) ?? []).length, 1, 'only the visible sentence has a playback control')
  }
})

test('quoted book examples and authored examples display distinct provenance labels', () => {
  const entry = italianCourse.entries[0]
  const task: SessionTask = { taskId: 'quoted-card', kind: 'flashcard', entryId: entry.entryId, revealed: true }
  const html = renderTask(task, propsFor(task, italianCourse))
  assert.equal(entry.examples[0].origin, 'quoted')
  assert.ok(html.includes(`data-source-ref-id="${entry.examples[0].sourceRefId}"`))
  assert.match(html, /مثال از کتاب/u)
  assert.match(html, /مثال تألیفی/u)
})

test('unknown noun article is hidden and the article skill is explicitly inapplicable', () => {
  const unknown: Entry = { ...noun, nounData: { ...noun.nounData!, article: null, gender: null } }
  const html = renderToStaticMarkup(createElement(view.SkillDetails, { entry: unknown }))
  assert.match(html, /برای این مدخل کاربرد ندارد/u)
  const props = propsFor(writing(unknown))
  props.bundle = { ...bundle, entries: [unknown] }
  const wordHtml = renderToStaticMarkup(createElement(view.LessonWordList, { entries: [unknown], props }))
  assert.ok(!wordHtml.includes('class="article"') && !wordHtml.includes('null'))
})

test('cloze assistance reveals its inflected target and keeps the infinitive writing cue separate', () => {
  const inflected: Entry = { ...verb, lemma: 'essere', cloze: { ...verb.cloze,
    sentence: 'Io ___ italiano.', acceptedAnswers: ['sono'], cueFa: 'صورت اول‌شخص مفرد را بنویس.' } }
  const task: SessionTask = { taskId: 'inflected-cloze', kind: 'cloze', entryId: inflected.entryId, cycleKind: 'initial', assisted: true }
  const props = propsFor(task)
  props.bundle = { ...bundle, entries: bundle.entries.map(entry => entry.entryId === inflected.entryId ? inflected : entry) }
  props.state.assistanceEvents.push({ eventId: 'inflected-help', sessionId: 'ui-session', taskId: task.taskId,
    entryId: inflected.entryId, kind: 'answer', at: now, studyDate: '2026-10-28' })
  const html = renderTask(task, props)
  assert.ok(html.includes(inflected.cloze.cueFa!))
  assert.match(html, />sono<\/button>/u)
  assert.ok(!html.includes('>essere</button>'))
})
