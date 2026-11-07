/* global window, Event, EventTarget, structuredClone */
import assert from 'node:assert/strict'
import { createInitialState, transition } from '../src/learning/engine.ts'
import { getReverseExample } from '../src/learning/examples.ts'
import { validateState } from '../src/storage/index.ts'
import { wordPronunciation } from '../src/features/pronunciation.ts'

async function installSpeech(context, unsupported = false) {
  await context.addInitScript(unsupported => {
    if (unsupported) {
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined })
      return
    }
    let voices = [], current = null
    const synthesis = new EventTarget()
    Object.assign(synthesis, {
      spoken: [], cancellations: 0, fail: false,
      getVoices: () => voices,
      speak(utterance) {
        if (this.fail) throw new Error('mock playback failure')
        current = utterance
        this.spoken.push(utterance)
      },
      cancel() { this.cancellations++; current?.onerror?.({ error: 'canceled' }); current = null },
      loadVoices() {
        voices = ['en-US', 'de-AT', 'de-DE'].map(lang => ({ lang, name: `mock ${lang}`, voiceURI: lang, localService: true, default: lang === 'en-US' }))
        synthesis.dispatchEvent(new Event('voiceschanged'))
      },
    })
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class {
      constructor(text) { this.text = text; this.voice = null; this.lang = ''; this.rate = 1; this.onend = null; this.onerror = null }
    } })
    window.__speech = synthesis
  }, unsupported)
}
const lastSpeech = page => page.evaluate(() => {
  const utterance = window.__speech.spoken.at(-1)
  return utterance && { text: utterance.text, rate: utterance.rate, lang: utterance.lang, voice: utterance.voice.lang }
})
const cancellations = page => page.evaluate(() => window.__speech.cancellations)

export async function checkPronunciation({ browser, origin, bundle, observeContext, writeState, readState, learningSnapshot, clickAndSave, assertViewport, saveScreenshot, completedReverseFixture, installClock, lessonId = 'lesson-04' }) {
  const now = '2026-11-01T12:00:00.000Z'
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'fa-IR', reducedMotion: 'reduce' })
  observeContext(context)
  await installClock(context, now)
  await installSpeech(context)
  try {
    const page = await context.newPage()
    const initial = transition(createInitialState(bundle, 'Europe/Berlin'), { type: 'select-lesson', lessonId }, bundle, now)
    const chosen = transition(initial, { type: 'start-session', sessionId: 'speech-card', seed: 5 }, bundle, now)
    const nounIndex = chosen.session.queue.findIndex(task => task.kind === 'flashcard' && bundle.entries.find(entry => entry.entryId === task.entryId)?.nounData)
    assert.ok(nounIndex >= 0, 'the first batch includes a noun')
    const entry = bundle.entries.find(entry => entry.entryId === chosen.session.queue[nounIndex].entryId)
    validateState(chosen, bundle)
    await page.goto(`${origin}/__test/setup`)
    await writeState(page, chosen)
    await page.goto(origin)
    await clickAndSave(page, page.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }), true)
    for (let index = 0; index < nounIndex; index++) {
      await clickAndSave(page, page.getByRole('button', { name: 'چرخاندن کارت و نمایش معنی', exact: true }))
      await clickAndSave(page, page.locator('.flashcard-next'))
    }
    const before = learningSnapshot(await readState(page))
    const word = page.locator('.card-front .speaker-button')
    await word.click()
    assert.ok((await page.locator('.task-content > .pronunciation-status').innerText()).includes('صدای آلمانی'))
    assert.equal(await page.evaluate(() => window.__speech.spoken.length), 0)
    await page.evaluate(() => window.__speech.loadVoices())
    assert.equal(await page.locator('.task-content > .pronunciation-status').innerText(), '')
    assert.equal(await page.evaluate(() => window.__speech.spoken.length), 0, 'late voices never autoplay')
    await word.focus()
    await word.press('Enter')
    assert.deepEqual(await lastSpeech(page), { text: `${entry.nounData.article} ${entry.lemma}`, rate: 1, lang: 'de-DE', voice: 'de-DE' })
    assert.equal(await word.getAttribute('aria-label'), 'توقف پخش واژهٔ آلمانی')
    await word.press('Space')
    assert.equal(await word.getAttribute('aria-pressed'), 'false')
    assert.equal(learningSnapshot(await readState(page)), before, 'word playback never reveals, submits or advances')
    assert.equal(await page.getByLabel('سرعت تلفظ').count(), 0)
    await page.evaluate(() => window.localStorage.setItem('wortzeit-pronunciation-rate', '0.8'))
    await word.click()
    assert.equal((await lastSpeech(page)).rate, 1)
    const cancelBeforeFlip = await cancellations(page)
    await clickAndSave(page, page.getByRole('button', { name: 'چرخاندن کارت و نمایش معنی', exact: true }))
    assert.ok(await cancellations(page) > cancelBeforeFlip, 'flipping away cancels the word')
    const revealed = learningSnapshot(await readState(page))
    const sentence = page.locator('.card-back .speaker-button')
    await sentence.click()
    assert.equal((await lastSpeech(page)).text, entry.examples[0].de)
    assert.equal((await lastSpeech(page)).rate, 1)
    await page.getByRole('button', { name: 'مثال‌های بیشتر', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'مثال‌های بیشتر', exact: true })
    const examples = dialog.locator('.example-block')
    assert.equal(await examples.count(), 2)
    for (let index = 0; index < 2; index++) {
      await examples.nth(index).locator('.speech-text').click()
      assert.equal((await lastSpeech(page)).text, entry.examples[index + 1].de)
      assert.equal((await lastSpeech(page)).rate, 1)
    }
    const beforeClose = await cancellations(page)
    await dialog.getByRole('button', { name: 'بستن جزئیات' }).click()
    await page.waitForFunction(count => window.__speech.cancellations > count, beforeClose)
    assert.equal(await page.locator('.speaker-button[aria-pressed=true]').count(), 0)
    assert.equal(learningSnapshot(await readState(page)), revealed, 'all examples leave learning and rotation untouched')
    await assertViewport(page, 'pronunciation normal card', '.speaker-button, .flashcard-flip, .flashcard-next')
    await page.setViewportSize({ width: 320, height: 568 })
    await saveScreenshot(page, `pronunciation-${lessonId}-card-320.png`)
    await sentence.click()
    await page.getByRole('button', { name: 'نمایش روی کارت', exact: true }).press('Enter')
    await word.waitFor()
    await word.click()
    const beforeNext = await cancellations(page)
    await clickAndSave(page, page.locator('.flashcard-next'))
    assert.ok(await cancellations(page) > beforeNext, 'next card cancels playback')
    await page.reload()
    await clickAndSave(page, page.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }), true)
    await page.evaluate(() => window.__speech.loadVoices())
    await page.locator('.card-front .speaker-button').click()
    assert.equal((await lastSpeech(page)).rate, 1, 'an old slow preference is ignored after reload')
    const beforePause = await cancellations(page)
    await clickAndSave(page, page.getByRole('button', { name: 'توقف و بازگشت', exact: true }))
    assert.ok(await cancellations(page) > beforePause)
    await page.getByRole('button', { name: 'واژه‌ها', exact: true }).click()
    const firstRow = page.locator('.word-item').first()
    const firstEntryId = bundle.lessons.find(lesson => lesson.lessonId === lessonId).introducedEntryIds[0]
    const firstEntry = bundle.entries.find(entry => entry.entryId === firstEntryId)
    const beforeListPlayback = learningSnapshot(await readState(page))
    const wordText = firstRow.locator('.word-item-main .speech-text')
    await wordText.click()
    assert.equal((await lastSpeech(page)).text, wordPronunciation(firstEntry))
    assert.equal(await firstRow.getAttribute('open'), null, 'playback keeps details closed')
    await wordText.press('Enter')
    assert.equal(await wordText.getAttribute('aria-pressed'), 'false')
    await wordText.press('Space')
    assert.equal(await firstRow.getAttribute('open'), null, 'keyboard playback also keeps details closed')
    assert.equal(await firstRow.locator('.speaker-button').count(), 0)
    assert.equal(learningSnapshot(await readState(page)), beforeListPlayback)
    await firstRow.locator('.details-chevron').click()
    const exampleText = firstRow.locator('.word-item-details > .example-block .speech-text')
    await exampleText.click()
    assert.equal((await lastSpeech(page)).text, firstEntry.examples[0].de)
    const beforeCollapse = await cancellations(page)
    await firstRow.locator('.details-chevron').click()
    await page.waitForFunction(count => window.__speech.cancellations > count, beforeCollapse)
    assert.equal(learningSnapshot(await readState(page)), beforeListPlayback)
  } finally { await context.close() }

  // Use a genuine due reverse task; the test isolates its queue just like the
  // existing rotation fixtures, without changing any learning implementation.
  const reverse = transition(completedReverseFixture(), { type: 'start-session', sessionId: 'speech-reverse', seed: 5 }, bundle, now)
  const task = reverse.session.queue.find(task => task.kind === 'reverse-card')
  assert.ok(task)
  reverse.session.queue = [task]
  reverse.session.cursor = 0
  validateState(reverse, bundle)
  const entry = bundle.entries.find(entry => entry.entryId === task.entryId)
  const reverseContext = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, locale: 'fa-IR', reducedMotion: 'reduce' })
  observeContext(reverseContext)
  await installClock(reverseContext, now)
  await installSpeech(reverseContext)
  try {
    const page = await reverseContext.newPage()
    await page.goto(`${origin}/__test/setup`)
    await writeState(page, reverse)
    await page.goto(origin)
    await clickAndSave(page, page.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }), true)
    assert.equal(await page.locator('.task-content .speaker-button').count(), 0, 'no hidden reverse audio in DOM')
    await clickAndSave(page, page.locator('.reverse-reveal'))
    await page.evaluate(() => window.__speech.loadVoices())
    const before = learningSnapshot(await readState(page))
    const expected = getReverseExample(entry, reverse.reverseReviews)
    await page.locator('.reverse-answer .speaker-button').click()
    assert.equal((await lastSpeech(page)).text, entry.nounData ? `${entry.nounData.article} ${entry.lemma}` : entry.lemma)
    await page.locator('.reverse-example .speaker-button').click()
    assert.equal((await lastSpeech(page)).text, expected.de)
    const active = page.locator('.reverse-example .speaker-button')
    // Simulate late callbacks from the canceled word, then rapid stop/start.
    await page.evaluate(() => { window.__speech.spoken[0].onend?.({}); window.__speech.spoken[0].onerror?.({}) })
    assert.equal(await active.getAttribute('aria-pressed'), 'true')
    await active.click()
    await active.click()
    assert.equal(await active.getAttribute('aria-pressed'), 'true')
    await assertViewport(page, 'pronunciation reverse card', '.speaker-button, .reverse-correct, .reverse-incorrect')
    await page.setViewportSize({ width: 320, height: 568 })
    await saveScreenshot(page, `pronunciation-${lessonId}-reverse-320.png`)
    await page.getByRole('button', { name: 'مثال‌های بیشتر', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'مثال‌های بیشتر', exact: true })
    await dialog.locator('.speech-text').first().click()
    const beforeEscape = await cancellations(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(count => window.__speech.cancellations > count, beforeEscape)
    assert.equal(learningSnapshot(await readState(page)), before)
    assert.equal(await page.locator('.reverse-example [lang=de]').innerText(), expected.de, 'audio never rotates the example')
    await page.evaluate(() => { window.__speech.fail = true })
    await active.click()
    assert.ok((await page.locator('.task-content > .pronunciation-status').innerText()).includes('پخش تلفظ انجام نشد'))
    await clickAndSave(page, page.locator('.reverse-correct'))
    assert.equal((await readState(page)).reverseReviews.length, reverse.reverseReviews.length + 1, 'learning remains usable after failure')
  } finally { await reverseContext.close() }

  const unsupported = await browser.newContext()
  observeContext(unsupported)
  await installSpeech(unsupported, true)
  try {
    const page = await unsupported.newPage()
    await page.goto(origin)
    await page.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).waitFor()
    await clickAndSave(page, page.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }))
    await page.locator('.card-front .speaker-button').click()
    assert.ok((await page.locator('.task-content > .pronunciation-status').innerText()).includes('پشتیبانی نمی‌کند'))
    await clickAndSave(page, page.getByRole('button', { name: 'چرخاندن کارت و نمایش معنی', exact: true }))
    assert.equal(await page.locator('.flashcard.is-flipped').count(), 1)
  } finally { await unsupported.close() }
}

export async function checkExercisePronunciation({ browser, origin, bundle, observeContext, writeState, readState, learningSnapshot, clickAndSave, assertViewport, completedReverseFixture, installClock }) {
  const now = '2026-11-01T12:00:00.000Z'
  const lessonId = bundle.lesson.lessonId
  const selected = transition(completedReverseFixture(), { type: 'select-lesson', lessonId }, bundle, now)
  const started = transition(selected, { type: 'start-session', sessionId: 'speech-exercises', seed: 5 }, bundle, now)
  const learned = bundle.entries.filter(entry => entry.introducedInLessonId === lessonId && selected.progress[entry.entryId])
  const noun = learned.find(entry => entry.nounData)
  assert.ok(noun)
  const matchIds = learned.slice(0, 4).map(entry => entry.entryId)
  const scenarios = [
    [{ taskId: 'speech-meaning', kind: 'choose-meaning', entryId: noun.entryId, optionIds: noun.meaningOptionEntryIds }, '.question-word .speaker-button', wordPronunciation(noun)],
    [{ taskId: 'speech-article', kind: 'choose-article', entryId: noun.entryId, options: ['der', 'die', 'das'] }, '.question-word .speaker-button', noun.lemma],
    [{ taskId: 'speech-cloze', kind: 'cloze', entryId: noun.entryId, cycleKind: 'scheduled' }, '.cloze-question .speech-text', noun.cloze.sentence.replace('___', '…')],
    [{ taskId: 'speech-match', kind: 'match', entryIds: matchIds, leftOrder: matchIds, rightOrder: [...matchIds].reverse(), matchedEntryIds: [] }, '.match-word-tile .speaker-button', wordPronunciation(learned[0])],
  ]
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, locale: 'fa-IR', reducedMotion: 'reduce' })
  observeContext(context)
  await installClock(context, now)
  await installSpeech(context)
  try {
    const page = await context.newPage()
    for (const [task, selector, expected] of scenarios) {
      const state = structuredClone(started)
      Object.assign(state.session, { queue: [task], cursor: 0, introducedEntryIds: [], feedback: null })
      validateState(state, bundle)
      await page.goto(`${origin}/__test/setup`)
      await writeState(page, state)
      await page.goto(origin)
      await clickAndSave(page, page.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }), true)
      await page.evaluate(() => window.__speech.loadVoices())
      const before = learningSnapshot(await readState(page))
      await page.locator(selector).first().click()
      assert.equal((await lastSpeech(page)).text, expected)
      assert.equal((await lastSpeech(page)).rate, 1)
      assert.equal(learningSnapshot(await readState(page)), before)
      if (task.kind === 'match') assert.equal(await page.locator('.word-tile.is-selected').count(), 0)
      await assertViewport(page, `speech on ${task.kind}`, selector)
      if (task.kind === 'choose-meaning') {
        const correctIndex = task.optionIds.indexOf(noun.entryId)
        await clickAndSave(page, page.locator('.meaning-options .meaning-option').nth(correctIndex))
        const answered = learningSnapshot(await readState(page))
        await page.locator('.feedback-word .speech-text').click()
        assert.equal((await lastSpeech(page)).text, wordPronunciation(noun))
        assert.equal(await page.locator('.feedback .speaker-button').count(), 0)
        assert.equal(learningSnapshot(await readState(page)), answered)
        await assertViewport(page, 'text pronunciation in feedback', '.feedback .speech-text, .feedback-next')
      }
    }
  } finally { await context.close() }
}
