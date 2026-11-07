import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Entry } from '../contracts/index.ts'
import { lessonOneBundle as fixture } from '../testing/legacy-fixture.ts'
import { createPronunciation, selectItalianVoice, speechMessages, wordPronunciation } from './pronunciation.ts'

const voice = (lang: string, name = 'device voice') => ({ lang, name } as SpeechSynthesisVoice)
const italian = voice('it-IT')
class MockSynthesis extends EventTarget {
  voices: SpeechSynthesisVoice[] = [voice('en-US'), voice('it_CH'), italian]
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

const noun: Entry = { ...fixture.entries[0], lemma: 'casa', partOfSpeech: 'noun', nounData: {
  article: 'la', gender: 'feminine', number: 'singular', plural: null, pluralNote: 'دادهٔ ساختگی آزمون' }, }
const verb: Entry = { ...fixture.entries[0], lemma: 'chiamarsi', partOfSpeech: 'verb', nounData: undefined }

test('speaks only stored Italian, noun with its known article and complete reflexive infinitive', () => {
  const { synthesis, playback } = setup()
  assert.equal(wordPronunciation(noun), 'la casa')
  assert.equal(wordPronunciation(verb), 'chiamarsi')
  playback.toggle('noun', 'card', wordPronunciation(noun))
  const utterance = synthesis.spoken[0]
  assert.equal(utterance.text, 'la casa')
  assert.equal(utterance.voice, italian)
  assert.equal(utterance.lang, 'it-IT')
  playback.toggle('verb', 'card', wordPronunciation(verb))
  assert.equal(synthesis.spoken[1].text, 'chiamarsi')
  assert.equal(synthesis.cancellations, 1)
})

test('elided articles join the word without a space and never determine its stored gender', () => {
  const masculine: Entry = { ...noun, lemma: 'amico', nounData: { ...noun.nounData!, article: "l'", gender: 'masculine' } }
  const feminine: Entry = { ...noun, lemma: 'amica', nounData: { ...noun.nounData!, article: "l'", gender: 'feminine' } }
  assert.equal(wordPronunciation(masculine), "l'amico")
  assert.equal(wordPronunciation(feminine), "l'amica")
  assert.equal(masculine.nounData!.gender, 'masculine')
  assert.equal(feminine.nounData!.gender, 'feminine')
  assert.equal(wordPronunciation({ ...noun, lemma: 'cognome', nounData: { ...noun.nounData!, article: null, gender: null } }), 'cognome')
  for (const article of ['i', 'gli', 'le'] as const) {
    assert.equal(wordPronunciation({ ...noun, lemma: 'forme', nounData: { ...noun.nounData!, article, number: 'plural' } }), `${article} forme`)
  }
})

test('voice selection prefers it-IT, then any Italian language tag, and never a non-Italian default', () => {
  const swiss = voice('it_CH')
  assert.equal(selectItalianVoice([voice('en-US'), swiss, italian]), italian)
  assert.equal(selectItalianVoice([voice('en-US'), swiss]), swiss)
  assert.equal(selectItalianVoice([voice('IT_it')])?.lang, 'IT_it')
  assert.equal(selectItalianVoice([voice('en-US'), voice('de-DE'), voice('itn')]), undefined)
  const { playback, synthesis } = setup()
  synthesis.voices = [swiss]
  playback.toggle('word', 'card', 'Ciao')
  assert.equal(synthesis.spoken[0].voice, swiss)
  assert.equal(synthesis.spoken[0].lang, 'it_CH')
})

test('late voiceschanged clears missing-voice status without starting audio automatically; cleanup removes listener', () => {
  const { playback, synthesis } = setup()
  synthesis.voices = []
  const disconnect = playback.connect()
  playback.toggle('word', 'card', 'Ciao')
  assert.equal(playback.getSnapshot().message, speechMessages.noVoice)
  assert.equal(synthesis.spoken.length, 0)
  synthesis.voices = [italian]
  synthesis.dispatchEvent(new Event('voiceschanged'))
  assert.equal(playback.getSnapshot().message, null)
  assert.equal(synthesis.spoken.length, 0)
  playback.toggle('word', 'card', 'Ciao')
  assert.equal(synthesis.spoken[0].voice, italian)
  disconnect()
  assert.equal(playback.getSnapshot().activeId, null)
  synthesis.voices = []
  playback.toggle('word', 'card', 'Ciao')
  synthesis.voices = [italian]
  synthesis.dispatchEvent(new Event('voiceschanged'))
  assert.equal(playback.getSnapshot().message, speechMessages.noVoice)
})

test('missing API, missing utterance constructor, and native failures leave playback idle and retryable', () => {
  const unsupported = createPronunciation({})
  unsupported.toggle('word', 'card', 'Ciao')
  assert.equal(unsupported.getSnapshot().message, speechMessages.unsupported)
  const { environment, synthesis, playback } = setup()
  const noConstructor = createPronunciation({ synthesis: environment.synthesis })
  noConstructor.toggle('word', 'card', 'Ciao')
  assert.equal(noConstructor.getSnapshot().message, speechMessages.unsupported)
  synthesis.failure = true
  playback.toggle('word', 'card', 'Ciao')
  assert.equal(playback.getSnapshot().activeId, null)
  assert.equal(playback.getSnapshot().message, speechMessages.failed)
  synthesis.failure = false
  playback.toggle('word', 'card', 'Ciao')
  synthesis.spoken[0].onerror?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent)
  assert.equal(playback.getSnapshot().message, speechMessages.failed)
  assert.equal(playback.getSnapshot().activeId, null)
  playback.toggle('word', 'card', 'Ciao')
  assert.equal(playback.getSnapshot().message, null)
  synthesis.spoken[1].onend?.({} as SpeechSynthesisEvent)
  assert.equal(playback.getSnapshot().activeId, null)
})

test('words and sentences always play at the default rate', () => {
  const { playback, synthesis } = setup()
  for (const text of ['la casa', 'Oggi leggo una frase.']) {
    playback.toggle(text, 'card', text)
    assert.equal(synthesis.spoken.at(-1)?.rate, 1)
  }
})

test('same button stops; rapid replacement invalidates all old end/error callbacks, including a restarted button', () => {
  const { playback, synthesis } = setup()
  playback.toggle('word', 'card', 'Ciao')
  const first = synthesis.spoken[0]
  playback.toggle('word', 'card', 'Ciao')
  assert.equal(synthesis.spoken.length, 1)
  assert.equal(playback.getSnapshot().activeId, null)
  playback.toggle('word', 'card', 'Ciao')
  first.onend?.({} as SpeechSynthesisEvent)
  first.onerror?.({} as SpeechSynthesisErrorEvent)
  assert.equal(playback.getSnapshot().activeId, 'word')
  playback.toggle('sentence', 'dialog', 'Leggiamo.')
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
  playback.toggle('example', 'dialog', 'Leggiamo.')
  playback.stopScope('card')
  playback.stopButton('word')
  assert.equal(synthesis.cancellations, 0)
  playback.stopScope('dialog')
  playback.stopScope('dialog')
  assert.equal(synthesis.cancellations, 1)
  playback.toggle('word', 'card', 'Ciao')
  playback.stopButton('word')
  playback.toggle('word', 'card', 'Ciao')
  playback.stop()
  playback.stop()
  assert.equal(synthesis.cancellations, 3)
  assert.equal(updates, 6)
  unsubscribe()
  playback.toggle('word', 'card', 'Ciao')
  assert.equal(updates, 6)
})
