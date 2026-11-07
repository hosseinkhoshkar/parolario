import assert from 'node:assert/strict'
import { test } from 'node:test'
import { courseBundle } from '../content/catalog.ts'
import { createPronunciation, selectGermanVoice, speechMessages, wordPronunciation } from './pronunciation.ts'

const voice = (lang: string, name = 'device voice') => ({ lang, name } as SpeechSynthesisVoice)
const german = voice('de-DE')
class MockSynthesis extends EventTarget {
  voices: SpeechSynthesisVoice[] = [voice('en-US'), voice('de-AT'), german]
  spoken: SpeechSynthesisUtterance[] = []
  cancellations = 0
  failure = false
  getVoices() { return this.voices }
  speak(utterance: SpeechSynthesisUtterance) {
    if (this.failure) throw new Error('device failure')
    this.spoken.push(utterance)
  }
  cancel() {
    this.cancellations++
    // Native engines can fire an error immediately during cancel.
    this.spoken.at(-1)?.onerror?.({ error: 'canceled' } as SpeechSynthesisErrorEvent)
  }
}
function setup() {
  const synthesis = new MockSynthesis()
  const createUtterance = (text: string) => ({ text, voice: null, lang: '', rate: 1, onend: null, onerror: null } as unknown as SpeechSynthesisUtterance)
  const environment = { synthesis: synthesis as unknown as SpeechSynthesis, createUtterance }
  return { synthesis, environment, playback: createPronunciation(environment) }
}

test('speaks only stored German, noun with its known article and complete separable infinitive', () => {
  const { synthesis, playback } = setup()
  const noun = courseBundle.entries.find(entry => entry.lemma === 'Anmeldung')!
  const verb = courseBundle.entries.find(entry => entry.lemma === 'fernsehen')!
  assert.ok(noun && verb, 'use existing vocabulary data')
  assert.equal(wordPronunciation(noun), 'die Anmeldung')
  assert.equal(wordPronunciation(verb), 'fernsehen')
  playback.toggle('noun', 'card', wordPronunciation(noun))
  const utterance = synthesis.spoken[0]
  assert.equal(utterance.text, 'die Anmeldung')
  assert.equal(utterance.voice, german)
  assert.equal(utterance.lang, 'de-DE')
  playback.toggle('verb', 'card', wordPronunciation(verb))
  assert.equal(synthesis.spoken[1].text, 'fernsehen')
  assert.equal(synthesis.cancellations, 1)
})

test('voice selection prefers de-DE, then any German language tag, and never a non-German default', () => {
  const austrian = voice('de-AT')
  assert.equal(selectGermanVoice([voice('en-US'), austrian, german]), german)
  assert.equal(selectGermanVoice([voice('en-US'), austrian]), austrian)
  assert.equal(selectGermanVoice([voice('DE_de')])?.lang, 'DE_de')
  assert.equal(selectGermanVoice([voice('en-US'), voice('den')]), undefined)
  const { playback, synthesis } = setup()
  synthesis.voices = [austrian]
  playback.toggle('word', 'card', 'Hallo')
  assert.equal(synthesis.spoken[0].voice, austrian)
  assert.equal(synthesis.spoken[0].lang, 'de-AT')
})

test('late voiceschanged clears missing-voice status without starting audio automatically; cleanup removes listener', () => {
  const { playback, synthesis } = setup()
  synthesis.voices = []
  const disconnect = playback.connect()
  playback.toggle('word', 'card', 'Hallo')
  assert.equal(playback.getSnapshot().message, speechMessages.noVoice)
  assert.equal(synthesis.spoken.length, 0)
  synthesis.voices = [german]
  synthesis.dispatchEvent(new Event('voiceschanged'))
  assert.equal(playback.getSnapshot().message, null)
  assert.equal(synthesis.spoken.length, 0)
  playback.toggle('word', 'card', 'Hallo')
  assert.equal(synthesis.spoken[0].voice, german)
  disconnect()
  assert.equal(playback.getSnapshot().activeId, null)
  synthesis.voices = []
  playback.toggle('word', 'card', 'Hallo')
  synthesis.voices = [german]
  synthesis.dispatchEvent(new Event('voiceschanged'))
  assert.equal(playback.getSnapshot().message, speechMessages.noVoice)
})

test('missing API, missing utterance constructor, and native failures leave playback idle and retryable', () => {
  const unsupported = createPronunciation({})
  unsupported.toggle('word', 'card', 'Hallo')
  assert.equal(unsupported.getSnapshot().message, speechMessages.unsupported)
  const { environment, synthesis, playback } = setup()
  const noConstructor = createPronunciation({ synthesis: environment.synthesis })
  noConstructor.toggle('word', 'card', 'Hallo')
  assert.equal(noConstructor.getSnapshot().message, speechMessages.unsupported)
  synthesis.failure = true
  playback.toggle('word', 'card', 'Hallo')
  assert.equal(playback.getSnapshot().activeId, null)
  assert.equal(playback.getSnapshot().message, speechMessages.failed)
  synthesis.failure = false
  playback.toggle('word', 'card', 'Hallo')
  synthesis.spoken[0].onerror?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent)
  assert.equal(playback.getSnapshot().message, speechMessages.failed)
  assert.equal(playback.getSnapshot().activeId, null)
  playback.toggle('word', 'card', 'Hallo')
  assert.equal(playback.getSnapshot().message, null)
  synthesis.spoken[1].onend?.({} as SpeechSynthesisEvent)
  assert.equal(playback.getSnapshot().activeId, null)
})

test('words and sentences always play at the default rate', () => {
  const { playback, synthesis } = setup()
  for (const text of ['die Wohnung', 'Wir sehen heute fern.']) {
    playback.toggle(text, 'card', text)
    assert.equal(synthesis.spoken.at(-1)?.rate, 1)
  }
})

test('same button stops; rapid replacement invalidates all old end/error callbacks, including a restarted button', () => {
  const { playback, synthesis } = setup()
  playback.toggle('word', 'card', 'Hallo')
  const first = synthesis.spoken[0]
  playback.toggle('word', 'card', 'Hallo')
  assert.equal(synthesis.spoken.length, 1)
  assert.equal(playback.getSnapshot().activeId, null)
  playback.toggle('word', 'card', 'Hallo')
  first.onend?.({} as SpeechSynthesisEvent)
  first.onerror?.({} as SpeechSynthesisErrorEvent)
  assert.equal(playback.getSnapshot().activeId, 'word')
  playback.toggle('sentence', 'dialog', 'Wir lesen.')
  synthesis.spoken[1].onend?.({} as SpeechSynthesisEvent)
  synthesis.spoken[1].onerror?.({} as SpeechSynthesisErrorEvent)
  assert.equal(playback.getSnapshot().activeId, 'sentence')
  assert.equal(playback.getSnapshot().message, null)
  assert.equal(synthesis.cancellations, 2)
})

test('button/surface cleanup only cancels its own audio; global leaving cancels any playback once', () => {
  const { playback, synthesis } = setup()
  let updates = 0
  const unsubscribe = playback.subscribe(() => updates++)
  playback.toggle('example', 'dialog', 'Wir lesen.')
  playback.stopScope('card')
  playback.stopButton('word')
  assert.equal(synthesis.cancellations, 0)
  playback.stopScope('dialog')
  playback.stopScope('dialog')
  assert.equal(synthesis.cancellations, 1)
  playback.toggle('word', 'card', 'Hallo')
  playback.stopButton('word')
  playback.toggle('word', 'card', 'Hallo')
  playback.stop()
  playback.stop()
  assert.equal(synthesis.cancellations, 3)
  assert.equal(updates, 6)
  unsubscribe()
  playback.toggle('word', 'card', 'Hallo')
  assert.equal(updates, 6)
})
