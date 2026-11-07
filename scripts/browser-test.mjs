/* global indexedDB, document, IDBObjectStore, navigator, sessionStorage, structuredClone, requestAnimationFrame, MutationObserver, window, Event */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import ts from 'typescript'
import { courseBundle as bundle } from '../src/content/catalog.ts'
import { createInitialState, transition } from '../src/learning/engine.ts'
import { scheduleReverseReview, reverseStudyDate } from '../src/learning/reverse.ts'
import { validateState } from '../src/storage/index.ts'
import { wordPronunciation } from '../src/features/pronunciation.ts'
import { checkExercisePronunciation, checkPronunciation } from './pronunciation-browser.mjs'

const results = []
const diagnostics = []
const pageErrors = []
const observedPages = new Map()
const exercisedKinds = new Set()
const layoutCheckedKinds = new Set()
const mobileSizes = [{ width: 320, height: 568 }, { width: 360, height: 800 }, { width: 390, height: 844 }]
function observeContext(context) {
  context.on('page', page => {
    const id = observedPages.size + 1
    observedPages.set(page, id)
    page.on('pageerror', error => {
      const record = { kind: 'pageerror', tab: id, url: page.url(), message: error.message, stack: error.stack }
      pageErrors.push(record)
      diagnostics.push(record)
    })
    page.on('console', event => {
      if (event.type() === 'error') diagnostics.push({ kind: 'console', tab: id, url: page.url(), message: event.text() })
    })
  })
}
async function capture(page, phase) {
  const record = { phase, tab: observedPages.get(page), closed: page.isClosed() }
  if (!page.isClosed()) {
    record.url = page.url()
    record.screen = await page.evaluate(async () => ({
      boot: document.querySelector('.boot-screen')?.textContent ?? null,
      error: document.querySelector('[role="alert"]')?.textContent ?? null,
      locks: navigator.locks ? await navigator.locks.query() : null,
    })).catch(error => ({ error: error.message }))
    record.state = await readState(page).catch(error => ({ error: error.message }))
  }
  diagnostics.push(record)
}
const directory = path.resolve('test-results')
await mkdir(directory, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2' }
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (pathname.startsWith('/__test/src/') && (/\.(?:ts|json)$/u.test(pathname))) {
      const file = path.resolve(pathname.slice('/__test/'.length))
      if (!file.startsWith(path.resolve('src') + path.sep)) throw new Error('Invalid test module')
      const source = await readFile(file, 'utf8')
      response.setHeader('Content-Type', pathname.endsWith('.json') ? 'application/json' : 'text/javascript')
      response.end(pathname.endsWith('.json') ? source : ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText)
      return
    }
    if (pathname === '/__test/setup') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Parolario isolated storage test</title>'); return }
    const file = path.resolve('dist', pathname === '/' ? 'index.html' : `.${pathname}`)
    if (!file.startsWith(path.resolve('dist') + path.sep)) throw new Error('Invalid path')
    const data = await readFile(file)
    response.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream')
    response.setHeader('Cache-Control', 'no-store')
    response.end(data)
  } catch { response.statusCode = 404; response.end('Not found') }
})
let browser
let origin
async function checkpoint(name, action) {
  const filter = process.env.PAROLARIO_BROWSER_CHECKPOINT
  if (filter && !new RegExp(filter).test(name)) return
  await action()
  results.push({ name, passed: true })
  console.log(`PASS ${name}`)
}
async function saveScreenshot(page, name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  try {
    await page.screenshot({ path: path.join(directory, name), fullPage: true })
  } catch (error) {
    if (!error.message.includes('Unable to capture screenshot')) throw error
    diagnostics.push({ kind: 'screenshot-viewport-fallback', name })
    await page.screenshot({ path: path.join(directory, name), fullPage: false })
  }
}
async function readState(page, databaseName = 'parolario-progress') {
  return page.evaluate(databaseName => new Promise((resolve, reject) => {
    const open = indexedDB.open(databaseName, 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const transaction = db.transaction('user-state', 'readonly')
      const request = transaction.objectStore('user-state').get('current')
      transaction.oncomplete = () => { db.close(); resolve(request.result ?? null) }
      transaction.onerror = () => { db.close(); reject(transaction.error) }
    }
  }), databaseName)
}
async function waitState(page, predicate) {
  for (let count = 0; count < 160; count++) {
    const state = await readState(page)
    if (state && predicate(state)) return state
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Persisted state did not reach the expected condition')
}
function learningSnapshot(state) {
  if (!state) return null
  return JSON.stringify({ progress: state.progress, attempts: state.attempts, reverseProgress: state.reverseProgress, reverseReviews: state.reverseReviews, assistanceEvents: state.assistanceEvents,
    session: state.session ? { ...state.session, activeMs: 0 } : null })
}
async function clickAndSave(page, locator, resume = false) {
  const before = await readState(page)
  if (await locator.evaluate(element => element.matches('.flashcard-flip'))) {
    // The speaker is intentionally above the full-card flip action. A short
    // word can place it at the default click center; tap a genuine card margin.
    await locator.scrollIntoViewIfNeeded()
    const position = await locator.evaluate(element => {
      const box = element.getBoundingClientRect()
      const candidates = [{ x: 24, y: 24 }, { x: box.width - 24, y: 24 },
        { x: 24, y: box.height - 24 }, { x: box.width - 24, y: box.height - 24 }]
      return candidates.find(point => document.elementFromPoint(box.left + point.x, box.top + point.y) === element) ?? null
    })
    assert.ok(position, 'the flip action has a visible tappable margin separate from its speaker')
    await locator.click({ position })
  } else await locator.click()
  return waitState(page, state => state.revision > (before?.revision ?? 0)
    && (resume || learningSnapshot(state) !== learningSnapshot(before)))
}
async function assertViewport(page, label, controlSelector) {
  for (const viewport of mobileSizes) {
    await page.setViewportSize(viewport)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const bounds = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
    }))
    assert.ok(bounds.width <= bounds.viewportWidth, `${label}: horizontal document overflow at ${viewport.width}`)
    assert.ok(bounds.height <= bounds.viewportHeight + 1, `${label}: document scroll at ${viewport.width}x${viewport.height} (${bounds.height})`)
    assert.equal(bounds.scrollY, 0, `${label}: document must stay at scroll zero`)
    if (viewport.width === 320 && ['home', 'reverse revealed answer', 'summary', 'summary-reverse'].includes(label)) {
      await saveScreenshot(page, `${label.replaceAll(' ', '-')}-320x568.png`)
    }
    if (controlSelector) {
      const controls = page.locator(`${controlSelector}, .page-session button, .page-home button`)
      assert.ok(await controls.count(), `${label}: expected main controls`)
      for (let index = 0; index < await controls.count(); index++) {
        const control = controls.nth(index)
        if (!await control.isVisible()) continue
        const box = await control.boundingBox()
        assert.ok(box && box.y >= -1 && box.x >= -1 && box.y + box.height <= bounds.viewportHeight + 1
          && box.x + box.width <= bounds.viewportWidth + 1, `${label}: main control outside viewport at ${viewport.width}x${viewport.height}`)
        assert.ok(box.height >= 43, `${label}: touch control is shorter than 44px`)
        const reachable = await control.evaluate(element => {
          const modal = document.querySelector('dialog[open]')
          if (modal && !modal.contains(element)) return true // Native modal intentionally makes the underlying page inert.
          const box = element.getBoundingClientRect()
          return [box.top + 3, box.top + box.height / 2, box.bottom - 3].every(y => {
            const hit = document.elementFromPoint(box.left + box.width / 2, y)
            return hit === element || element.contains(hit)
          })
        })
        assert.ok(reachable, `${label}: main control is clipped by an ancestor or covered at ${viewport.width}x${viewport.height}`)
      }
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
}

async function checkKeyboardViewport(page, force = false) {
  if (layoutCheckedKinds.has('keyboard') && !force) return
  layoutCheckedKinds.add('keyboard')
  await page.setViewportSize({ width: 360, height: 800 })
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 400 })
    window.visualViewport.dispatchEvent(new Event('resize'))
  })
  await page.waitForFunction(() => document.documentElement.classList.contains('keyboard-open'))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  for (const selector of ['#italian-answer', '.answer-form button[type="submit"]', '.answer-form .details-trigger']) {
    const control = page.locator(selector)
    assert.equal(await control.isVisible(), true, `keyboard: ${selector} remains visible`)
    const box = await control.boundingBox()
    assert.ok(box && box.y >= 0 && box.y + box.height <= 401 && box.height >= 43, `keyboard: ${selector} is reachable within visual viewport`)
  }
  const cueVisible = await page.evaluate(() => [...document.querySelectorAll('.writing-prompt,.writing-cue,.cloze-translation')].some(element => {
    const box = element.getBoundingClientRect()
    return box.height > 0 && box.y >= 0 && box.bottom <= 401 && window.getComputedStyle(element).display !== 'none'
  }))
  assert.equal(cueVisible, true, 'keyboard keeps the meaning or recall cue visible')
  await saveScreenshot(page, 'keyboard-visual-viewport-360.png')
  await page.locator('.answer-form .details-trigger').click()
  const dialog = page.locator('.detail-sheet[open]')
  await dialog.waitFor()
  const closeBox = await dialog.locator('.sheet-close').boundingBox()
  assert.ok(closeBox && closeBox.y >= 0 && closeBox.y + closeBox.height <= 401, 'keyboard guide remains closable within visual viewport')
  await dialog.locator('.sheet-close').click()
  await page.evaluate(() => {
    delete window.visualViewport.height
    window.visualViewport.dispatchEvent(new Event('resize'))
  })
  await page.waitForFunction(() => !document.documentElement.classList.contains('keyboard-open'))
}

async function installClock(context, now) {
  await context.addInitScript(now => {
    const RealDate = Date
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [now])) }
      static now() { return RealDate.parse(now) }
    }
  }, now)
}

async function writeState(page, state, databaseName = 'parolario-progress') {
  await page.evaluate(({ state, databaseName }) => new Promise((resolve, reject) => {
    const open = indexedDB.open(databaseName, 1)
    open.onupgradeneeded = () => open.result.createObjectStore('user-state')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result, transaction = db.transaction('user-state', 'readwrite')
      transaction.objectStore('user-state').put(state, 'current')
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onerror = () => { db.close(); reject(transaction.error) }
    }
  }), { state, databaseName })
}

async function checkTaskLayout(page, task, feedback) {
  const key = feedback ? `feedback-${task.kind}` : task.kind
  if (layoutCheckedKinds.has(key) || task.kind === 'match' && feedback) return
  layoutCheckedKinds.add(key)
  const selector = feedback ? '.feedback .primary-button'
    : task.kind === 'flashcard' ? '.flashcard, .flashcard-next'
      : task.kind === 'match' ? '.match-tile'
        : task.kind === 'cloze' || task.kind === 'write-word' ? '.answer-form input, .answer-form button[type="submit"]'
          : task.kind === 'reverse-card' ? '.reverse-reveal, .reverse-correct, .reverse-incorrect'
            : '.meaning-option'
  await assertViewport(page, key, selector)
}

async function continueFeedback(page, state) {
  const task = state.session.queue[state.session.cursor]
  if (task.kind === 'match') return waitState(page, next => next.session.feedback?.attemptId !== state.session.feedback?.attemptId)
  return clickAndSave(page, page.getByRole('button', { name: 'ادامه', exact: true }))
}
async function checkMoreExamples(page, entry, currentExample) {
  const before = learningSnapshot(await readState(page))
  await page.getByRole('button', { name: 'مثال‌های بیشتر', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'مثال‌های بیشتر', exact: true })
  await dialog.waitFor()
  const others = entry.examples.filter(example => example.exampleId !== currentExample.exampleId)
  assert.equal(await dialog.locator('.example-block').count(), others.length)
  const text = await dialog.innerText()
  for (const example of others) assert.ok(text.includes(example.it) && text.includes(example.fa), 'additional Italian/Persian pair stays together')
  await dialog.getByRole('button', { name: 'بستن جزئیات', exact: true }).click()
  assert.equal(learningSnapshot(await readState(page)), before, 'manual examples do not complete review or modify schedules')
}

async function finishCards(page) {
  let count = 0
  for (;;) {
    const state = await readState(page), task = state.session.queue[state.session.cursor]
    if (task.kind !== 'flashcard') return count
    if (!task.revealed) await clickAndSave(page, page.getByRole('button', { name: 'چرخاندن کارت و نمایش معنی', exact: true }))
    if (count === 0) {
      const entry = bundle.entries.find(entry => entry.entryId === task.entryId)
      await page.locator('.flashcard.is-flipped').waitFor()
      assert.equal(await page.locator('.card-example-de').textContent(), entry.examples[0].it)
      assert.ok(!await page.locator('.flashcard').innerText().then(text => text.includes(entry.examples[1].it)))
      await checkMoreExamples(page, entry, entry.examples[0])
      await assertViewport(page, 'flashcard back', '.flashcard, .flashcard-next')
      await saveScreenshot(page, 'flashcard-back-360.png')
    }
    await clickAndSave(page, page.locator('.flashcard-next'))
    count++
  }
}
async function checkWrongMatch(page, state) {
  const task = state.session.queue[state.session.cursor]
  const id = task.entryIds.find(id => !task.matchedEntryIds.includes(id))
  const wrongId = task.entryIds.find(other => other !== id && !task.matchedEntryIds.includes(other))
  const left = page.locator('.match-column').nth(0).locator('.match-tile').nth(task.leftOrder.indexOf(id))
  const wrong = page.locator('.match-column').nth(1).locator('.match-tile').nth(task.rightOrder.indexOf(wrongId))
  await left.click()
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  await clickAndSave(page, wrong)
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), height, 'matching feedback preserves page height')
  assert.equal(await page.getByRole('button', { name: 'ادامهٔ بازی', exact: true }).count(), 0)
  await page.locator('.match-tile.answer-wrong').first().waitFor()
  const retry = await waitState(page, next => !next.session.feedback)
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), height, 'retry preserves page height')
  await saveScreenshot(page, 'matching-retry-360.png')
  assert.equal(retry.session.queue[retry.session.cursor].taskId, task.taskId)
  assert.equal(retry.attempts.at(-1).correct, false)
  assert.equal(await left.isEnabled(), true)
  await left.click()
  await clickAndSave(page, page.locator('.match-column').nth(1).locator('.match-tile').nth(task.rightOrder.indexOf(id)))
  const corrected = await readState(page)
  assert.equal(corrected.attempts.at(-1).correct, true)
  assert.equal(corrected.attempts.at(-1).assisted, true)
  assert.equal(corrected.attempts.at(-1).independent, false)
  await waitState(page, next => !next.session.feedback)
}
async function playToEnd(page, stopAtWritten = false, wrongMatch = false) {
  for (let step = 0; step < 150; step++) {
    const state = await readState(page), session = state.session
    if (session.state === 'ended') {
      const key = state.reverseReviews.some(review => review.sessionId === session.sessionId) ? 'summary-reverse' : 'summary'
      if (!layoutCheckedKinds.has(key)) { layoutCheckedKinds.add(key); await assertViewport(page, key, '.summary-actions button') }
      return state
    }
    const task = session.queue[session.cursor]
    exercisedKinds.add(task.kind)
    await checkTaskLayout(page, task, session.feedback)
    if (session.feedback) { await continueFeedback(page, state); continue }
    if (stopAtWritten && (task.kind === 'cloze' || task.kind === 'write-word')) return state
    const entry = task.kind === 'match' ? null : bundle.entries.find(entry => entry.entryId === task.entryId)
    if (task.kind === 'flashcard') {
      if (!task.revealed) await clickAndSave(page, page.getByRole('button', { name: 'چرخاندن کارت و نمایش معنی', exact: true }))
      await clickAndSave(page, page.locator('.flashcard-next'))
    } else if (task.kind === 'reverse-card') {
      if (!task.revealed) await clickAndSave(page, page.locator('.reverse-reveal'))
      await clickAndSave(page, page.locator('.reverse-correct'))
    } else if (task.kind === 'choose-meaning') {
      await clickAndSave(page, page.locator('.meaning-option').nth(task.optionIds.indexOf(task.entryId)))
    } else if (task.kind === 'cloze' || task.kind === 'write-word') {
      const answer = task.kind === 'write-word' ? entry.writing.acceptedAnswers[0] : entry.cloze.acceptedAnswers[0]
      await page.getByLabel('پاسخ تو', { exact: true }).fill(answer)
      await waitState(page, state => state.session.draft === answer)
      await checkKeyboardViewport(page)
      await clickAndSave(page, page.getByRole('button', { name: 'بررسی پاسخ', exact: false }))
    } else if (task.kind === 'choose-article') {
      await clickAndSave(page, page.locator('.article-option').nth(task.options.indexOf(entry.nounData.article)))
    } else {
      if (wrongMatch) { await checkWrongMatch(page, state); wrongMatch = false; continue }
      const id = task.entryIds.find(id => !task.matchedEntryIds.includes(id))
      await page.locator('.match-column').nth(0).locator('.match-tile').nth(task.leftOrder.indexOf(id)).click()
      await clickAndSave(page, page.locator('.match-column').nth(1).locator('.match-tile').nth(task.rightOrder.indexOf(id)))
    }
  }
  throw new Error('Session did not terminate')
}

function completedReverseFixture(learnedLessonId = bundle.lesson.lessonId, prioritizedEntryId = null) {
  const learnedAt = '2026-10-28T12:00:00.000Z'
  // Test-only ordering lets a lesson's known-article noun participate in the
  // genuine first fifteen completions without changing the product catalog.
  const fixtureBundle = prioritizedEntryId ? { ...bundle, entries: bundle.entries.map(entry =>
    entry.entryId === prioritizedEntryId ? { ...entry, introductionOrder: 0 } : entry) } : bundle
  let state = createInitialState(fixtureBundle, 'Europe/Berlin')
  let attempt = 0
  const commit = command => { state = transition(state, command, fixtureBundle, learnedAt) }
  commit({ type: 'select-lesson', lessonId: learnedLessonId })
  for (let batch = 0; batch < 3; batch++) {
    commit({ type: 'start-session', sessionId: `reverse-fixture-${batch}`, seed: 43 + batch })
    for (let step = 0; state.session.state !== 'ended'; step++) {
      assert.ok(step < 150, 'fixture session terminates')
      const task = state.session.queue[state.session.cursor]
      if (state.session.feedback) { commit({ type: 'next', taskId: task.taskId }); continue }
      if (task.kind === 'flashcard') {
        commit({ type: 'reveal-card', taskId: task.taskId })
        commit({ type: 'next', taskId: task.taskId })
      } else if (task.kind === 'match') {
        const id = task.entryIds.find(id => !task.matchedEntryIds.includes(id))
        commit({ type: 'answer', taskId: task.taskId, entryId: id, answer: id, attemptId: `reverse-fixture-answer-${attempt++}` })
      } else {
        const entry = bundle.entries.find(entry => entry.entryId === task.entryId)
        const answer = task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0]
          : task.kind === 'write-word' ? entry.writing.acceptedAnswers[0]
            : task.kind === 'choose-article' ? entry.nounData.article : task.entryId
        commit({ type: 'answer', taskId: task.taskId, answer, attemptId: `reverse-fixture-answer-${attempt++}` })
      }
    }
  }
  assert.equal(Object.keys(state.reverseProgress).length, 15)
  return state
}

async function playUntilReverse(page) {
  // The Italian milestone has one real lesson, so due original-direction reviews
  // may precede its reverse/new-card block. Complete those genuine tasks first.
  for (let index = 0; index < 150; index++) {
    const state = await readState(page), session = state.session, task = session.queue[session.cursor]
    if (task.kind === 'reverse-card') return state
    if (session.feedback) { await continueFeedback(page, state); continue }
    if (task.kind === 'flashcard') {
      if (!task.revealed) await clickAndSave(page, page.getByRole('button', { name: 'چرخاندن کارت و نمایش معنی', exact: true }))
      await clickAndSave(page, page.locator('.flashcard-next'))
    } else if (task.kind === 'choose-meaning') {
      await clickAndSave(page, page.locator('.meaning-option').nth(task.optionIds.indexOf(task.entryId)))
    } else if (task.kind === 'cloze' || task.kind === 'write-word') {
      const entry = bundle.entries.find(entry => entry.entryId === task.entryId)
      const answer = task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0] : entry.writing.acceptedAnswers[0]
      await page.getByLabel('پاسخ تو', { exact: true }).fill(answer)
      await waitState(page, state => state.session.draft === answer)
      await clickAndSave(page, page.getByRole('button', { name: 'بررسی پاسخ', exact: false }))
    } else if (task.kind === 'choose-article') {
      const entry = bundle.entries.find(entry => entry.entryId === task.entryId)
      await clickAndSave(page, page.locator('.article-option').nth(task.options.indexOf(entry.nounData.article)))
    } else {
      const id = task.entryIds.find(id => !task.matchedEntryIds.includes(id))
      await page.locator('.match-column').nth(0).locator('.match-tile').nth(task.leftOrder.indexOf(id)).click()
      await clickAndSave(page, page.locator('.match-column').nth(1).locator('.match-tile').nth(task.rightOrder.indexOf(id)))
    }
  }
  throw new Error('No reverse card reached after preceding due reviews')
}

try {
  await readFile('dist/index.html')
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ headless: true, ...(process.env.PAROLARIO_CHROMIUM_PATH ? { executablePath: process.env.PAROLARIO_CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) })
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'fa-IR', timezoneId: 'Europe/Berlin', reducedMotion: 'reduce' })
  observeContext(context)
  let page = await context.newPage()
  await page.goto(origin)
  await page.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).waitFor()
  await checkpoint('mobile home fits 320x568, 360x800 and 390x844 without document scrolling', async () => {
    await assertViewport(page, 'home', '.hero-button')
    for (const width of [320, 360, 1280]) {
      await page.setViewportSize({ width, height: 850 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
      await saveScreenshot(page, `home-${width}.png`)
    }
    await page.setViewportSize({ width: 360, height: 800 })
  })
  await page.locator('.offline-pill').filter({ hasText: 'آمادهٔ آفلاین' }).waitFor({ timeout: 20_000 })
  await clickAndSave(page, page.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }))
  await checkpoint('background activity saves do not disable or replace the card or shift scroll', async () => {
    await page.locator('.flashcard').scrollIntoViewIfNeeded()
    const before = await readState(page)
    const changes = await page.evaluate(() => new Promise(resolve => {
      const card = document.querySelector('.flashcard-flip')
      const startY = window.scrollY
      const records = []
      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) if (mutation.type === 'attributes' && mutation.attributeName === 'disabled') records.push('disabled changed')
      })
      observer.observe(card, { attributes: true })
      setTimeout(() => {
        observer.disconnect()
        resolve({ records, connected: card.isConnected, shift: Math.abs(window.scrollY - startY) })
      }, 2400)
    }))
    assert.deepEqual(changes.records, [])
    assert.equal(changes.connected, true)
    assert.ok(changes.shift < 2)
    assert.ok((await readState(page)).session.activeMs > before.session.activeMs, 'actual background saves were exercised')
  })
  await checkpoint('five cards precede practice and card exposure is not a correct answer', async () => {
    const introduced = await finishCards(page)
    assert.equal(introduced, 5)
    assert.equal((await readState(page)).attempts.length, 0)
    const state = await readState(page), task = state.session.queue[state.session.cursor]
    const wrong = task.optionIds.findIndex(id => id !== task.entryId)
    await clickAndSave(page, page.locator('.meaning-option').nth(wrong))
    const answered = await readState(page)
    assert.equal(answered.attempts.length, 1)
    assert.equal(answered.attempts[0].correct, false)
    assert.equal(answered.progress[task.entryId].pendingError.remainingOtherAnswers, 3)
    await page.reload()
    await page.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).click()
    await page.getByRole('button', { name: 'ادامه', exact: true }).waitFor()
    assert.equal((await readState(page)).attempts.length, 1)
  })
  await checkpoint('full five-word session including retry and four correct matching pairs', async () => {
    const ended = await playToEnd(page, false, true)
    assert.equal(ended.session.introducedEntryIds.length, 5)
    assert.equal(Object.keys(ended.progress).length, 5)
    assert.equal(ended.attempts.filter(attempt => attempt.exercise === 'match' && attempt.correct).length, 4)
    assert.equal(new Set(ended.attempts.map(attempt => attempt.attemptId)).size, ended.attempts.length)
    await page.getByRole('heading', { name: /این بود نوبت/ }).waitFor()
    await saveScreenshot(page, 'summary-360.png')
  })
  await checkpoint('offline close/reopen and resume preserve progress and draft', async () => {
    const before = await readState(page)
    await context.setOffline(true)
    await page.close()
    page = await context.newPage()
    await page.goto(origin)
    await page.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).waitFor()
    assert.equal((await readState(page)).attempts.length, before.attempts.length)
    await clickAndSave(page, page.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }))
    const written = await playToEnd(page, true)
    assert.equal(written.session.state, 'active')
    await page.getByLabel('پاسخ تو', { exact: true }).fill('متنِ ذخیره‌شده')
    await waitState(page, state => state.session.draft === 'متنِ ذخیره‌شده')
    await page.reload()
    await page.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).click()
    await page.getByLabel('پاسخ تو', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('پاسخ تو', { exact: true }).inputValue(), 'متنِ ذخیره‌شده')
    await saveScreenshot(page, 'offline-cloze-360.png')
  })
  await context.setOffline(false)
  await checkpoint('second tab cannot write; lock is released after closing first tab', async () => {
    await clickAndSave(page, page.getByRole('button', { name: 'توقف و بازگشت', exact: true }))
    const stored = await readState(page)
    const other = await context.newPage()
    await other.goto(origin)
    await other.getByRole('alert').filter({ hasText: 'تب دیگری' }).waitFor()
    assert.equal(await other.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).count(), 0)
    assert.deepEqual(await readState(other), stored)
    await capture(page, 'owner-before-close')
    await capture(other, 'contender-before-close')
    await page.close()
    await capture(other, 'owner-closed-before-retry')
    await other.getByRole('button', { name: 'تلاش دوباره', exact: true }).click()
    await other.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).waitFor()
    await capture(other, 'takeover-ready')
    assert.deepEqual(await readState(other), stored, 'taking ownership does not rewrite persisted progress')
    await clickAndSave(other, other.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }), true)
    await other.getByLabel('پاسخ تو', { exact: true }).waitFor()
    assert.equal(await other.getByLabel('پاسخ تو', { exact: true }).inputValue(), stored.session.draft)
    const resumed = await readState(other)
    assert.deepEqual(resumed.attempts, stored.attempts)
    assert.deepEqual(resumed.progress, stored.progress)
    assert.deepEqual(resumed.session.queue, stored.session.queue)
    assert.equal(resumed.session.cursor, stored.session.cursor)
    assert.equal(resumed.session.sessionId, stored.session.sessionId)
    page = other
  })
  await checkpoint('queued retry cannot write while owner is active and cancelled requests are removed', async () => {
    await clickAndSave(page, page.getByRole('button', { name: 'توقف و بازگشت', exact: true }))
    const stored = await readState(page)
    const cancelled = await context.newPage()
    await cancelled.goto(origin)
    await cancelled.getByRole('alert').filter({ hasText: 'تب دیگری' }).waitFor()
    await cancelled.getByRole('button', { name: 'تلاش دوباره', exact: true }).click()
    await page.waitForFunction(async () => (await navigator.locks.query()).pending.some(lock => lock.name === 'parolario-single-writer'))
    assert.deepEqual(await readState(page), stored)
    await cancelled.close()
    await page.waitForFunction(async () => !(await navigator.locks.query()).pending.some(lock => lock.name === 'parolario-single-writer'))
    const queued = await context.newPage()
    await queued.goto(origin)
    await queued.getByRole('alert').filter({ hasText: 'تب دیگری' }).waitFor()
    await queued.getByRole('button', { name: 'تلاش دوباره', exact: true }).click()
    await page.waitForFunction(async () => (await navigator.locks.query()).pending.some(lock => lock.name === 'parolario-single-writer'))
    assert.equal(await queued.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).count(), 0)
    assert.deepEqual(await readState(queued), stored)
    await capture(queued, 'retry-pending-while-owner-active')
    await page.close()
    await queued.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).waitFor()
    assert.deepEqual(await readState(queued), stored)
    await capture(queued, 'queued-retry-acquired')
    page = queued
  })
  await checkpoint('new noun session includes word writing and applicable article exercises on mobile', async () => {
    await clickAndSave(page, page.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }), true)
    await playToEnd(page)
    await clickAndSave(page, page.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }))
    await playToEnd(page)
    assert.ok(exercisedKinds.has('write-word'))
    assert.ok(exercisedKinds.has('choose-article'))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
    await saveScreenshot(page, 'phase-two-summary-360.png')
  })
  await context.close()
  await checkpoint('German schema-4 storage stays untouched while independent Italian progress starts fresh', async () => {
    const isolated = await browser.newContext()
    observeContext(isolated)
    try {
      const isolatedPage = await isolated.newPage()
      const old = JSON.parse(await readFile('src/storage/fixtures/pre-lesson-five-schema4.json', 'utf8'))
      await isolatedPage.goto(`${origin}/__test/setup`)
      await writeState(isolatedPage, old, 'wortzeit-progress')
      await isolatedPage.goto(origin)
      await isolatedPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).waitFor()
      assert.equal(await readState(isolatedPage), null, 'the Italian app never reads German progress')
      await clickAndSave(isolatedPage, isolatedPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }))
      const started = await readState(isolatedPage)
      assert.equal(started.schemaVersion, 5)
      assert.equal(started.contentVersion, bundle.contentVersion)
      assert.ok(Object.keys(started.progress).every(id => id.startsWith('it-a1-l01-')))
      assert.deepEqual(await readState(isolatedPage, 'wortzeit-progress'), old, 'German database is byte-for-byte logically unchanged')
    } finally { await isolated.close() }
  })
  await checkpoint('foreign schema-4 data in Italian storage is rejected and preserved on load and retry', async () => {
    const isolated = await browser.newContext()
    observeContext(isolated)
    try {
      const isolatedPage = await isolated.newPage()
      const old = JSON.parse(await readFile('src/storage/fixtures/pre-lesson-five-schema4.json', 'utf8'))
      await isolatedPage.goto(`${origin}/__test/setup`)
      await writeState(isolatedPage, old)
      await isolatedPage.goto(origin)
      await isolatedPage.getByRole('alert').waitFor()
      assert.equal(await isolatedPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).count(), 0)
      assert.deepEqual(await readState(isolatedPage), old)
      await isolatedPage.getByRole('button', { name: 'تلاش دوباره', exact: true }).click()
      await isolatedPage.getByRole('alert').waitFor()
      assert.deepEqual(await readState(isolatedPage), old, 'retry never resets foreign content or schema')
    } finally { await isolated.close() }
  })
  await checkpoint('both Italian lesson deep links, source-ordered vocabularies, navigation and offline draft recovery', async () => {
    for (const lesson of bundle.lessons ?? [bundle.lesson]) {
      const isolated = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'fa-IR', reducedMotion: 'reduce' })
      observeContext(isolated)
      try {
        const lessonPage = await isolated.newPage()
        const lessonId = lesson.lessonId
        const entries = bundle.entries.filter(entry => entry.introducedInLessonId === lessonId)
        const screenshotPrefix = lessonId === bundle.lesson.lessonId ? 'italian' : 'italian-lesson-two'
        await lessonPage.goto(`${origin}/?lesson=${lessonId}`)
        await lessonPage.getByRole('heading', { name: lesson.titleIt, exact: true }).waitFor()
        await lessonPage.getByRole('button', { name: 'درس‌ها', exact: true }).click()
        assert.equal(await lessonPage.locator('.lesson-card').count(), (bundle.lessons ?? [bundle.lesson]).length)
        assert.equal(await lessonPage.locator(`[data-lesson-id="${lessonId}"] [role=progressbar]`).getAttribute('aria-valuemax'), String(entries.length))
        for (const width of [320, 360, 430, 1280]) {
          await lessonPage.setViewportSize({ width, height: 850 })
          assert.equal(await lessonPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
          await saveScreenshot(lessonPage, `${screenshotPrefix}-lessons-${width}.png`)
        }
        await lessonPage.setViewportSize({ width: 360, height: 800 })
        await lessonPage.locator(`[data-lesson-id="${lessonId}"] .lesson-open-button`).click()
        assert.ok(lessonPage.url().includes(`lesson=${lessonId}`))
        await lessonPage.getByRole('button', { name: 'واژه‌ها', exact: true }).click()
        assert.equal(await lessonPage.locator('.word-item').count(), entries.length)
        const ordered = [...entries].sort((a, b) => a.introductionOrder - b.introductionOrder)
        for (let index = 0; index < ordered.length; index++) {
          const word = lessonPage.locator('.word-item').nth(index).locator('.german-word').first()
          assert.equal(await word.innerText(), wordPronunciation(ordered[index]))
          assert.equal(await word.getAttribute('lang'), 'it')
        }
        await saveScreenshot(lessonPage, `${screenshotPrefix}-words-360.png`)
        await lessonPage.getByRole('button', { name: 'خانه', exact: true }).click()
        await clickAndSave(lessonPage, lessonPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }))
        assert.equal(await finishCards(lessonPage), 5)
        await playToEnd(lessonPage, true)
        const draft = 'bozza italiana'
        await lessonPage.getByLabel('پاسخ تو', { exact: true }).fill(draft)
        await waitState(lessonPage, state => state.session.draft === draft)
        await clickAndSave(lessonPage, lessonPage.getByRole('button', { name: 'توقف و بازگشت', exact: true }))
        const paused = await readState(lessonPage)
        await lessonPage.getByRole('button', { name: 'درس‌ها', exact: true }).click()
        await lessonPage.locator(`[data-lesson-id="${lessonId}"] .lesson-open-button`).click()
        assert.deepEqual((await readState(lessonPage)).session.queue, paused.session.queue)
        assert.equal((await readState(lessonPage)).session.draft, draft)
        await lessonPage.locator('.offline-pill').filter({ hasText: 'آمادهٔ آفلاین' }).waitFor()
        await isolated.setOffline(true)
        await lessonPage.reload()
        await clickAndSave(lessonPage, lessonPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }), true)
        await lessonPage.getByLabel('پاسخ تو', { exact: true }).waitFor()
        assert.equal(await lessonPage.getByLabel('پاسخ تو', { exact: true }).inputValue(), draft)
        const restored = await readState(lessonPage)
        assert.deepEqual(restored.session.queue, paused.session.queue)
        assert.equal(restored.session.cursor, paused.session.cursor)
        assert.deepEqual(restored.progress, paused.progress)
        await saveScreenshot(lessonPage, `${screenshotPrefix}-offline-draft-360.png`)
        const ended = await playToEnd(lessonPage)
        assert.equal(ended.session.introducedEntryIds.length, 5)
        assert.ok(ended.session.introducedEntryIds.every(id => bundle.entries.find(entry => entry.entryId === id).introducedInLessonId === lessonId))
      } finally { await isolated.close() }
    }
  })
  await checkpoint('real lesson one and two switching preserves both drafts, feedback, queues and offline lesson two', async () => {
    const firstId = bundle.lesson.lessonId, secondId = 'it-a1-lesson-02'
    const secondLesson = bundle.lessons.find(lesson => lesson.lessonId === secondId)
    assert.ok(secondLesson, 'the second sourced Italian lesson is active')
    const isolated = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'fa-IR', reducedMotion: 'reduce' })
    observeContext(isolated)
    try {
      const lessonPage = await isolated.newPage()
      const select = async lessonId => {
        await lessonPage.getByRole('button', { name: 'درس‌ها', exact: true }).click()
        await lessonPage.locator(`[data-lesson-id="${lessonId}"] .lesson-open-button`).click()
        return waitState(lessonPage, state => state.activeLessonId === lessonId)
      }
      await lessonPage.goto(`${origin}/?lesson=${firstId}`)
      await lessonPage.getByRole('heading', { name: bundle.lesson.titleIt, exact: true }).waitFor()
      await clickAndSave(lessonPage, lessonPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }))
      await finishCards(lessonPage)
      await playToEnd(lessonPage, true)
      const firstDraft = 'bozza della prima lezione'
      await lessonPage.getByLabel('پاسخ تو', { exact: true }).fill(firstDraft)
      await waitState(lessonPage, state => state.session.draft === firstDraft)
      await clickAndSave(lessonPage, lessonPage.getByRole('button', { name: 'توقف و بازگشت', exact: true }))
      const firstPaused = await readState(lessonPage)
      let selected = await select(secondId)
      assert.deepEqual(selected.savedSessions[firstId], firstPaused.session)
      assert.deepEqual(selected.progress, firstPaused.progress)
      assert.equal(selected.session, null)
      await clickAndSave(lessonPage, lessonPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }))
      await finishCards(lessonPage)
      await playToEnd(lessonPage, true)
      const secondDraft = 'bozza della seconda lezione'
      await lessonPage.getByLabel('پاسخ تو', { exact: true }).fill(secondDraft)
      await waitState(lessonPage, state => state.session.draft === secondDraft)
      await clickAndSave(lessonPage, lessonPage.getByRole('button', { name: 'توقف و بازگشت', exact: true }))
      const secondPaused = await readState(lessonPage)
      selected = await select(firstId)
      assert.deepEqual(selected.session, firstPaused.session)
      assert.deepEqual(selected.savedSessions[secondId], secondPaused.session)
      assert.deepEqual(selected.progress, secondPaused.progress)
      await clickAndSave(lessonPage, lessonPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }), true)
      assert.equal(await lessonPage.getByLabel('پاسخ تو', { exact: true }).inputValue(), firstDraft)
      const active = await readState(lessonPage), task = active.session.queue[active.session.cursor]
      assert.ok(task.kind === 'write-word' || task.kind === 'cloze')
      const entry = bundle.entries.find(entry => entry.entryId === task.entryId)
      const answer = task.kind === 'cloze' ? entry.cloze.acceptedAnswers[0] : entry.writing.acceptedAnswers[0]
      await lessonPage.getByLabel('پاسخ تو', { exact: true }).fill(answer)
      await waitState(lessonPage, state => state.session.draft === answer)
      await clickAndSave(lessonPage, lessonPage.getByRole('button', { name: 'بررسی پاسخ', exact: false }))
      await clickAndSave(lessonPage, lessonPage.getByRole('button', { name: 'توقف و بازگشت', exact: true }))
      const firstFeedback = await readState(lessonPage)
      assert.ok(firstFeedback.session.feedback?.correct)
      selected = await select(secondId)
      assert.deepEqual(selected.session, secondPaused.session)
      selected = await select(firstId)
      assert.deepEqual(selected.session, firstFeedback.session)
      assert.deepEqual(selected.session.feedback, firstFeedback.session.feedback)
      assert.deepEqual(selected.attempts, firstFeedback.attempts)
      selected = await select(secondId)
      assert.deepEqual(selected.session, secondPaused.session)
      await lessonPage.locator('.offline-pill').filter({ hasText: 'آمادهٔ آفلاین' }).waitFor()
      const beforeOffline = await readState(lessonPage)
      await isolated.setOffline(true)
      await lessonPage.reload()
      await lessonPage.getByRole('heading', { name: secondLesson.titleIt, exact: true }).waitFor()
      await clickAndSave(lessonPage, lessonPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }), true)
      assert.equal(await lessonPage.getByLabel('پاسخ تو', { exact: true }).inputValue(), secondDraft)
      const restored = await readState(lessonPage)
      assert.equal(restored.activeLessonId, secondId)
      assert.equal(restored.session.sessionId, secondPaused.session.sessionId)
      assert.equal(restored.session.cursor, secondPaused.session.cursor)
      assert.deepEqual(restored.session.queue, secondPaused.session.queue)
      assert.deepEqual(restored.savedSessions[firstId], firstFeedback.session)
      assert.deepEqual(restored.progress, beforeOffline.progress)
      assert.deepEqual(restored.attempts, beforeOffline.attempts)
      await saveScreenshot(lessonPage, 'lesson-two-switch-offline-draft-360.png')
    } finally { await isolated.close() }
  })
  await checkpoint('pre-lesson-two schema-five snapshot restores unchanged and starts sourced lesson two without resetting lesson one', async () => {
    const baseline = JSON.parse(await readFile('src/storage/fixtures/pre-lesson-two-schema5.json', 'utf8'))
    validateState(baseline, bundle)
    assert.equal(baseline.schemaVersion, 5)
    assert.equal(baseline.contentVersion, bundle.contentVersion)
    assert.ok(baseline.reverseReviews.length > 0 && baseline.session.draft)
    const isolated = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'fa-IR', reducedMotion: 'reduce' })
    observeContext(isolated)
    await installClock(isolated, '2026-11-08T10:05:00.000Z')
    try {
      const savedPage = await isolated.newPage()
      await savedPage.goto(`${origin}/__test/setup`)
      await writeState(savedPage, baseline)
      await savedPage.goto(origin)
      await savedPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).waitFor()
      assert.deepEqual(await readState(savedPage), baseline, 'adding content never rewrites a valid previous save')
      await clickAndSave(savedPage, savedPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }), true)
      assert.equal(await savedPage.getByLabel('پاسخ تو', { exact: true }).inputValue(), baseline.session.draft)
      const resumed = await readState(savedPage)
      assert.deepEqual(resumed.session.queue, baseline.session.queue)
      assert.equal(resumed.session.cursor, baseline.session.cursor)
      assert.deepEqual(resumed.progress, baseline.progress)
      assert.deepEqual(resumed.attempts, baseline.attempts)
      assert.deepEqual(resumed.reverseProgress, baseline.reverseProgress)
      assert.deepEqual(resumed.reverseReviews, baseline.reverseReviews)
      await clickAndSave(savedPage, savedPage.getByRole('button', { name: 'توقف و بازگشت', exact: true }))
      const paused = await readState(savedPage)
      await savedPage.getByRole('button', { name: 'درس‌ها', exact: true }).click()
      await savedPage.locator('[data-lesson-id="it-a1-lesson-02"] .lesson-open-button').click()
      await waitState(savedPage, state => state.activeLessonId === 'it-a1-lesson-02')
      await clickAndSave(savedPage, savedPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }))
      const withSecond = await readState(savedPage)
      assert.equal(withSecond.schemaVersion, baseline.schemaVersion)
      assert.equal(withSecond.contentVersion, baseline.contentVersion)
      assert.deepEqual(withSecond.savedSessions[baseline.activeLessonId], paused.session)
      for (const [id, progress] of Object.entries(baseline.progress)) assert.deepEqual(withSecond.progress[id], progress)
      assert.deepEqual(withSecond.attempts, baseline.attempts)
      assert.deepEqual(withSecond.reverseProgress, baseline.reverseProgress)
      assert.deepEqual(withSecond.reverseReviews, baseline.reverseReviews)
      assert.ok(withSecond.session.introducedEntryIds.every(id => bundle.entries.find(entry => entry.entryId === id).introducedInLessonId === 'it-a1-lesson-02'))
      await saveScreenshot(savedPage, 'pre-lesson-two-save-restored-360.png')
    } finally { await isolated.close() }
  })
  await checkpoint('direct Italian lesson link recovers after first load abort and never reuses an unlocked writer', async () => {
    const isolated = await browser.newContext()
    observeContext(isolated)
    await isolated.addInitScript(() => {
      const original = IDBObjectStore.prototype.get
      IDBObjectStore.prototype.get = function (...args) {
        const result = original.apply(this, args)
        if (sessionStorage.getItem('first-load-aborted') !== 'yes') {
          sessionStorage.setItem('first-load-aborted', 'yes')
          this.transaction.abort()
        }
        return result
      }
    })
    try {
      const failed = await isolated.newPage()
      await failed.goto(`${origin}/?lesson=${bundle.lesson.lessonId}`)
      await failed.getByRole('button', { name: 'تلاش دوباره', exact: true }).waitFor()
      await failed.waitForFunction(async () => !(await navigator.locks.query()).held.some(lock => lock.name === 'parolario-single-writer'))
      assert.equal(await readState(failed), null)
      await failed.getByRole('button', { name: 'تلاش دوباره', exact: true }).click()
      await failed.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).waitFor()
      await clickAndSave(failed, failed.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }))
      assert.equal((await readState(failed)).activeLessonId, bundle.lesson.lessonId)
      const second = await isolated.newPage()
      await second.goto(origin)
      await second.getByRole('alert').filter({ hasText: 'تب دیگری' }).waitFor()
    } finally { await isolated.close() }
  })
  await checkpoint('failed answer write preserves progress and retries the same answer exactly once', async () => {
    const isolated = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'fa-IR', reducedMotion: 'reduce' })
    observeContext(isolated)
    try {
      const answerPage = await isolated.newPage()
      await answerPage.goto(origin)
      await answerPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).waitFor()
      await clickAndSave(answerPage, answerPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }))
      await finishCards(answerPage)
      const before = await readState(answerPage)
      const task = before.session.queue[before.session.cursor]
      assert.equal(task.kind, 'choose-meaning')
      await answerPage.evaluate(answerCount => {
        const original = IDBObjectStore.prototype.put
        let aborted = false
        IDBObjectStore.prototype.put = function (...args) {
          const result = original.apply(this, args)
          if (!aborted && args[0]?.attempts?.length > answerCount) {
            aborted = true
            this.transaction.abort()
          }
          return result
        }
      }, before.attempts.length)
      await answerPage.locator('.meaning-option').nth(task.optionIds.indexOf(task.entryId)).click()
      await answerPage.locator('.storage-error[role=alert]').waitFor()
      const failed = await readState(answerPage)
      assert.deepEqual(failed.attempts, before.attempts)
      assert.deepEqual(failed.progress, before.progress)
      assert.equal(failed.session.cursor, before.session.cursor)
      await answerPage.getByRole('button', { name: 'تلاش دوباره', exact: true }).click()
      const recovered = await waitState(answerPage, state => state.attempts.length === before.attempts.length + 1)
      assert.equal(recovered.attempts.at(-1).correct, true)
      assert.equal(recovered.attempts.at(-1).taskId, task.taskId)
      assert.equal(new Set(recovered.attempts.map(attempt => attempt.attemptId)).size, recovered.attempts.length)
      await answerPage.reload()
      await answerPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).waitFor()
      assert.deepEqual((await readState(answerPage)).attempts, recovered.attempts)
    } finally { await isolated.close() }
  })
  await checkpoint('daily target uses a modal with contained keyboard focus and reachable continue control', async () => {
    const isolated = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, locale: 'fa-IR', timezoneId: 'Europe/Berlin', reducedMotion: 'reduce' })
    observeContext(isolated)
    await installClock(isolated, '2026-11-01T12:00:00.000Z')
    const targetPage = await isolated.newPage()
    await targetPage.goto(`${origin}/__test/setup`)
    const initial = createInitialState(bundle, 'Europe/Berlin')
    initial.dailyActivity['2026-11-01'] = initial.settings.targetActiveMs
    await writeState(targetPage, initial)
    await targetPage.goto(origin)
    await targetPage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).click()
    const dialog = targetPage.locator('.target-dialog[open]')
    await dialog.waitFor()
    await assertViewport(targetPage, 'daily goal dialog', '.target-dialog button')
    const before = await readState(targetPage)
    for (let key = 0; key < 5; key++) {
      await targetPage.keyboard.press('Tab')
      assert.equal(await targetPage.evaluate(() => document.activeElement === document.body || !!document.activeElement.closest('.target-dialog')), true, 'keyboard cannot focus underlying controls (native dialog may focus browser chrome)')
    }
    assert.equal(await dialog.evaluate(element => element.matches(':modal')), true, 'daily target is a real modal top layer')
    await targetPage.locator('.flashcard-flip').evaluate(element => element.focus())
    assert.equal(await targetPage.locator('.flashcard-flip').evaluate(element => element === document.activeElement), false, 'underlying exercise is inert to programmatic focus')
    assert.deepEqual((await readState(targetPage)).attempts, before.attempts, 'Tab does not answer the underlying exercise')
    await clickAndSave(targetPage, dialog.getByRole('button', { name: 'ادامهٔ تمرین', exact: true }))
    await targetPage.locator('.target-dialog').waitFor({ state: 'hidden' })
    assert.equal((await readState(targetPage)).session.targetAcknowledged, true)
    await assertViewport(targetPage, 'after goal acknowledgement', '.flashcard')
    await isolated.close()
  })
  await checkpoint('Italian learned evidence activates reverse cards; reveal, navigation and offline reload preserve the answer', async () => {
    const isolated = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'fa-IR', timezoneId: 'Europe/Berlin', reducedMotion: 'reduce' })
    observeContext(isolated)
    const clockNow = '2026-11-01T12:00:00.000Z'
    await installClock(isolated, clockNow)
    const reversePage = await isolated.newPage()
    await reversePage.goto(`${origin}/__test/setup`)
    const old = completedReverseFixture()
    await writeState(reversePage, old)
    await reversePage.goto(origin)
    await reversePage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).waitFor()
    let current = await readState(reversePage)
    assert.equal(current.schemaVersion, 5)
    assert.equal(Object.keys(current.reverseProgress).length, 15)
    assert.equal(current.reverseReviews.length, 0)
    assert.deepEqual(current.progress, old.progress)
    assert.deepEqual(current.attempts, old.attempts)
    diagnostics.push({ kind: 'reverse-phase', phase: 'before-start-or-resume' })
    await clickAndSave(reversePage, reversePage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }))
    current = await readState(reversePage)
    const newIds = current.session.queue.filter(task => task.kind === 'flashcard').map(task => task.entryId)
    const reverseTasks = current.session.queue.filter(task => task.kind === 'reverse-card')
    assert.equal(newIds.length, 5)
    assert.equal(reverseTasks.length, 2)
    assert.equal(new Set(reverseTasks.map(task => task.entryId)).size, 2)
    assert.ok(reverseTasks.every(task => !newIds.includes(task.entryId) && bundle.entries.find(entry => entry.entryId === task.entryId).introducedInLessonId === bundle.lesson.lessonId))
    assert.ok(reverseTasks.every(task => Date.parse(current.reverseProgress[task.entryId].nextDueAt) <= Date.parse(clockNow)))
    current = await playUntilReverse(reversePage)
    const task = current.session.queue[current.session.cursor]
    const entry = bundle.entries.find(entry => entry.entryId === task.entryId)
    const previous = structuredClone(current.progress[task.entryId])
    assert.ok((await reversePage.locator('.reverse-card').innerText()).includes(entry.meaningFa))
    assert.equal(await reversePage.locator('.task-content [lang=it]').count(), 0, 'Italian answer stays hidden before reveal')
    assert.equal(await reversePage.getByRole('button', { name: 'مثال‌های بیشتر', exact: true }).count(), 0)
    await assertViewport(reversePage, 'reverse Persian front', '.reverse-reveal')
    await saveScreenshot(reversePage, 'reverse-front-360.png')
    await clickAndSave(reversePage, reversePage.locator('.reverse-reveal'))
    assert.ok((await reversePage.locator('.reverse-card').innerText()).includes(entry.lemma))
    if (entry.nounData?.article) assert.ok((await reversePage.locator('.reverse-card').innerText()).includes(entry.nounData.article))
    assert.equal(await reversePage.locator('.reverse-example [lang=it]').innerText(), entry.examples[1].it)
    assert.ok((await reversePage.locator('.reverse-example').innerText()).includes(entry.examples[1].fa))
    await checkMoreExamples(reversePage, entry, entry.examples[1])
    await assertViewport(reversePage, 'reverse revealed answer', '.reverse-correct, .reverse-incorrect')
    await saveScreenshot(reversePage, 'reverse-answer-360.png')
    const queue = structuredClone((await readState(reversePage)).session.queue)
    diagnostics.push({ kind: 'reverse-phase', phase: 'before-pause' })
    await clickAndSave(reversePage, reversePage.getByRole('button', { name: 'توقف و بازگشت', exact: true }))
    await reversePage.getByRole('button', { name: 'درس‌ها', exact: true }).click()
    diagnostics.push({ kind: 'reverse-phase', phase: 'before-first-lesson' })
    await reversePage.locator(`[data-lesson-id="${bundle.lesson.lessonId}"] .lesson-open-button`).click()
    await reversePage.getByRole('button', { name: 'درس‌ها', exact: true }).click()
    diagnostics.push({ kind: 'reverse-phase', phase: 'before-back-to-italian-lesson' })
    await reversePage.locator(`[data-lesson-id="${bundle.lesson.lessonId}"] .lesson-open-button`).click()
    diagnostics.push({ kind: 'reverse-phase', phase: 'before-start-or-resume' })
    await clickAndSave(reversePage, reversePage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }))
    assert.equal((await readState(reversePage)).session.queue[(await readState(reversePage)).session.cursor].revealed, true)
    assert.deepEqual((await readState(reversePage)).session.queue, queue)
    await reversePage.locator('.offline-pill').filter({ hasText: 'آمادهٔ آفلاین' }).waitFor()
    await isolated.setOffline(true)
    diagnostics.push({ kind: 'reverse-phase', phase: 'before-offline-reload' })
    await reversePage.reload()
    await reversePage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).click()
    await reversePage.locator('.reverse-incorrect').waitFor()
    current = await readState(reversePage)
    assert.equal(current.reverseReviews.length, 0, 'reveal/reload never completes a review')
    assert.equal(current.session.queue[current.session.cursor].taskId, task.taskId)
    assert.deepEqual(current.session.queue, queue)
    assert.deepEqual(current.progress[task.entryId], previous)
    assert.equal(await reversePage.locator('.reverse-example [lang=it]').innerText(), entry.examples[1].it)
    await checkMoreExamples(reversePage, entry, entry.examples[1])
    const response = await reversePage.evaluate(async () => {
      const response = await window.fetch('/content/examples/italian/Lesson-01-A1.json'); return response.json()
    })
    assert.equal(response.entries.every(row => row.additionalExamples.length === 2), true, 'all source data is available offline')
    diagnostics.push({ kind: 'reverse-phase', phase: 'before-wrong-rating' })
    await clickAndSave(reversePage, reversePage.locator('.reverse-incorrect'))
    current = await readState(reversePage)
    assert.equal(current.reverseReviews.length, 1)
    assert.equal(current.reverseReviews[0].correct, false)
    assert.equal(current.reverseProgress[task.entryId].incorrectCount, 1)
    assert.equal(current.reverseProgress[task.entryId].successStreak, 0)
    assert.equal(current.reverseProgress[task.entryId].intervalDays, 1)
    assert.equal(current.reverseProgress[task.entryId].nextDueAt, '2026-11-02T12:00:00.000Z')
    assert.deepEqual(current.progress[task.entryId], previous, 'reverse rating leaves typed/recognition progress intact')
    assert.equal(current.session.queue.slice(current.session.cursor).filter(item => item.kind === 'reverse-card' && item.entryId === task.entryId).length, 0, 'wrong card never repeats immediately')
    await playToEnd(reversePage)
    current = await readState(reversePage)
    assert.equal(current.reverseReviews.length, 2)
    const correct = current.reverseReviews.find(item => item.correct)
    assert.ok(correct)
    assert.equal(current.reverseProgress[correct.entryId].intervalDays, 3)
    assert.equal(current.reverseProgress[correct.entryId].nextDueAt, '2026-11-04T12:00:00.000Z')
    assert.equal(current.activeLessonId, bundle.lesson.lessonId)
    assert.equal(current.session.introducedEntryIds.length, 5)
    const ratedIds = current.reverseReviews.map(item => item.entryId)
    diagnostics.push({ kind: 'reverse-phase', phase: 'before-start-or-resume' })
    await clickAndSave(reversePage, reversePage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }))
    current = await readState(reversePage)
    assert.ok(current.session.queue.filter(item => item.kind === 'reverse-card').every(item => !ratedIds.includes(item.entryId)), 'future-scheduled reverse words are not selected again')
    await isolated.close()
  })
  await checkpoint('second and third reverse examples rotate from completed history and survive reveal/reload without manual progress', async () => {
    for (const priorCount of [1, 2]) {
      let seedState = completedReverseFixture()
      const entryId = Object.keys(seedState.reverseProgress)[0]
      const entry = bundle.entries.find(entry => entry.entryId === entryId)
      for (let index = 0; index < priorCount; index++) {
        const at = seedState.reverseProgress[entryId].nextDueAt
        seedState.reverseReviews.push({ reviewId: `example-history-${index}`, sessionId: `example-history-${index}`,
          taskId: `example-history-${index}`, entryId, correct: index % 2 === 0, at,
          studyDate: reverseStudyDate(at, seedState.settings.studyTimeZone) })
        scheduleReverseReview(seedState.reverseProgress[entryId], index % 2 === 0, at, seedState.settings.studyTimeZone)
      }
      const now = seedState.reverseProgress[entryId].nextDueAt
      let chosen
      for (let seed = 0; seed < 1000; seed++) {
        const candidate = transition(seedState, { type: 'start-session', sessionId: `example-review-${priorCount}`, seed }, bundle, now)
        const task = candidate.session.queue.find(task => task.kind === 'reverse-card' && task.entryId === entryId)
        if (task) { chosen = candidate; chosen.session.queue = [task]; chosen.session.cursor = 0; break }
      }
      assert.ok(chosen, 'due target can be selected without forcing a future review')
      validateState(chosen, bundle)
      const isolated = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, locale: 'fa-IR', reducedMotion: 'reduce' })
      observeContext(isolated)
      await installClock(isolated, now)
      const examplePage = await isolated.newPage()
      await examplePage.goto(`${origin}/__test/setup`)
      await writeState(examplePage, chosen)
      await examplePage.goto(origin)
      await examplePage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).click()
      await examplePage.locator('.reverse-reveal').waitFor()
      assert.equal(await examplePage.locator('.reverse-example').count(), 0)
      await clickAndSave(examplePage, examplePage.locator('.reverse-reveal'))
      const expected = entry.examples[(priorCount + 1) % 3]
      assert.equal(await examplePage.locator('.reverse-example [lang=it]').innerText(), expected.it)
      await checkMoreExamples(examplePage, entry, expected)
      await assertViewport(examplePage, `rotating example ${priorCount}`, '.reverse-correct, .reverse-incorrect')
      await examplePage.reload()
      await examplePage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }).click()
      await examplePage.locator('.reverse-correct').waitFor()
      assert.equal(await examplePage.locator('.reverse-example [lang=it]').innerText(), expected.it)
      assert.equal((await readState(examplePage)).reverseReviews.length, priorCount)
      await isolated.close()
    }
  })
  await checkpoint('Italian cloze cues distinguish infinitive, person and polite address in mobile and keyboard viewports', async () => {
    const now = '2026-11-01T12:00:00.000Z'
    for (const lemma of ['essere', 'Lei', 'lei']) {
      const entry = bundle.entries.find(entry => entry.lemma === lemma)
      assert.ok(entry, `real Italian cue target exists: ${lemma}`)
      const fixtureBundle = { ...bundle, entries: bundle.entries.map(item => item === entry ? { ...item, introductionOrder: 0 } : item) }
      const state = transition(createInitialState(bundle, 'Europe/Berlin'), { type: 'start-session', sessionId: `italian-cue-${lemma}`, seed: 4 }, fixtureBundle, now)
      state.session.queue = [{ taskId: `italian-cue-${lemma}:cloze`, kind: 'cloze', entryId: entry.entryId, cycleKind: 'initial' }]
      state.session.cursor = 0
      state.session.feedback = null
      validateState(state, bundle)
      const isolated = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'fa-IR', reducedMotion: 'reduce' })
      observeContext(isolated)
      await installClock(isolated, now)
      try {
        const cuePage = await isolated.newPage()
        await cuePage.goto(`${origin}/__test/setup`)
        await writeState(cuePage, state)
        await cuePage.goto(`${origin}/?lesson=${bundle.lesson.lessonId}`)
        await clickAndSave(cuePage, cuePage.getByRole('button', { name: 'ادامهٔ یادگیری', exact: true }), true)
        assert.equal(await cuePage.locator('.cloze-question .writing-cue').innerText(), entry.cloze.cueFa ?? entry.writing.cueFa)
        assert.equal(await cuePage.locator('.cloze-question .speech-text').count(), 1)
        await assertViewport(cuePage, `Italian ${lemma} cloze cue`, '.answer-form input, .answer-form button')
        const answer = entry.cloze.acceptedAnswers[0]
        await cuePage.getByLabel('پاسخ تو', { exact: true }).fill(answer)
        await waitState(cuePage, value => value.session.draft === answer)
        await checkKeyboardViewport(cuePage, true)
        assert.equal(await cuePage.locator('.writing-cue').isVisible(), true)
      } finally { await isolated.close() }
    }
  })
  await checkpoint('browser pronunciation with simulated Italian voices: default speed, dialog and navigation cancellation without learning or rotation changes', async () => {
    await checkPronunciation({ browser, origin, bundle, observeContext, writeState, readState, learningSnapshot, clickAndSave, assertViewport, saveScreenshot, completedReverseFixture, installClock })
  })
  await checkpoint('pronunciation on visible exercise text preserves hidden answers and matching selection', async () => {
    await checkExercisePronunciation({ browser, origin, bundle, observeContext, writeState, readState, learningSnapshot,
      clickAndSave, assertViewport, completedReverseFixture, installClock })
  })
  await checkpoint('lesson two Italian noun and examples pronunciation preserves hidden reverse answers at default speed', async () => {
    await checkPronunciation({ browser, origin, bundle, observeContext, writeState, readState, learningSnapshot, clickAndSave,
      assertViewport, saveScreenshot, completedReverseFixture, installClock, lessonId: 'it-a1-lesson-02' })
  })
  await checkpoint('lesson two article reads only its noun and cloze reads only visible text without changing matching or learning', async () => {
    await checkExercisePronunciation({ browser, origin, bundle, observeContext, writeState, readState, learningSnapshot,
      clickAndSave, assertViewport, completedReverseFixture, installClock, lessonId: 'it-a1-lesson-02' })
  })
  await checkpoint('real IndexedDB atomic abort, optimistic concurrency and load/recovery', async () => {
    const isolated = await browser.newContext()
    observeContext(isolated)
    const storagePage = await isolated.newPage()
    await storagePage.goto(`${origin}/__test/setup`)
    const initial = createInitialState(bundle, 'Europe/Berlin')
    const first = transition(initial, { type: 'start-session', sessionId: 'storage-test', seed: 7 }, bundle, new Date().toISOString())
    const verdict = await storagePage.evaluate(async ({ first }) => {
      const { saveState, loadState } = await import('/__test/src/storage/index.ts')
      const { courseBundle } = await import('/__test/src/content/catalog.ts')
      await saveState(first, 0)
      const loaded = await loadState(courseBundle)
      const second = { ...first, revision: 2 }
      const writes = await Promise.allSettled([saveState(second, 1), saveState(second, 1)])
      const before = await loadState(courseBundle)
      const original = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) { const result = original.apply(this, args); this.transaction.abort(); return result }
      let aborted = false
      try { await saveState({ ...second, revision: 3 }, 2) } catch { aborted = true } finally { IDBObjectStore.prototype.put = original }
      const after = await loadState(courseBundle)
      return { paused: loaded.session.state, writes: writes.map(item => item.status), aborted, before: before.revision, after: after.revision }
    }, { first })
    assert.equal(verdict.paused, 'paused')
    assert.deepEqual(verdict.writes.sort(), ['fulfilled', 'rejected'])
    assert.equal(verdict.aborted, true)
    assert.equal(verdict.before, verdict.after)
    await isolated.close()
  })
  assert.deepEqual(pageErrors, [])
} catch (error) {
  results.push({ passed: false, error: error.message })
  for (const page of observedPages.keys()) await capture(page, 'failure')
  console.error(error.stack ?? error.message)
  process.exitCode = 1
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
  await writeFile(path.join(directory, 'browser-report.json'), JSON.stringify({ at: new Date().toISOString(), checkpointFilter: process.env.PAROLARIO_BROWSER_CHECKPOINT ?? null, results, diagnostics, exercisedKinds: [...exercisedKinds] }, null, 2))
}
