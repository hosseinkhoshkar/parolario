import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { ContentBundle, Entry, EntryProgress, Example, LearningCommand, LessonDefinition, LessonSummary, ReverseProgress, ReverseReview, SessionTask, ParolarioUIProps } from '../contracts/index.ts'
import { getReverseExample } from '../learning/examples.ts'
import { browserPronunciation, wordPronunciation } from './pronunciation.ts'
import type { Pronunciation } from './pronunciation.ts'
import '../App.css'

type Page = 'home' | 'lessons' | 'words' | 'about' | 'session' | 'summary'
type IconName = 'arrow' | 'book' | 'home' | 'leaf' | 'spark' | 'clock' | 'check' | 'close' | 'flip' | 'pause' | 'link' | 'info'

function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <path d="m14 6-6 6 6 6M8 12h13" />,
    book: <path d="M12 6c-3-3-7-2-9-1v14c3-2 6-2 9 0 3-2 6-2 9 0V5c-2-1-6-2-9 1Zm0 0v13" />,
    home: <path d="m3 10 9-7 9 7v10H3Zm6 10v-7h6v7" />,
    leaf: <path d="M19 3C8 2 2 8 5 15c3 6 14 3 14-12ZM5 20 16 8" />,
    spark: <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    flip: <path d="M4 9a8 8 0 0 1 14-3l2 3M20 4v5h-5M20 15a8 8 0 0 1-14 3l-2-3M4 20v-5h5" />,
    pause: <path d="M8 5v14M16 5v14" />,
    link: <path d="m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 0 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v.1" /></>,
  }
  return <svg className={`wz-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function GardenIllustration() {
  return <svg className="garden-illustration" viewBox="0 0 340 300" fill="none" aria-hidden="true">
    <circle cx="174" cy="151" r="115" fill="#E6DDFB" />
    <g transform="rotate(-14 138 150)"><rect x="52" y="55" width="155" height="196" rx="26" fill="#B8E8D6" stroke="#41335F" strokeWidth="2" /><path d="M82 91h63M82 105h42" stroke="#398370" strokeWidth="5" strokeLinecap="round" /></g>
    <g transform="rotate(10 211 156)"><rect x="124" y="67" width="158" height="197" rx="26" fill="#FFF9ED" stroke="#41335F" strokeWidth="2" /><text x="203" y="132" textAnchor="middle" fontFamily="Georgia,serif" fontSize="32" fill="#594385" lang="it" direction="ltr">Ciao!</text><circle cx="185" cy="171" r="4" fill="#594385" /><circle cx="220" cy="171" r="4" fill="#594385" /><path d="M188 188q14 15 28 0" stroke="#594385" strokeWidth="3" strokeLinecap="round" /><ellipse cx="174" cy="185" rx="9" ry="5" fill="#FFB6A9" /><ellipse cx="231" cy="185" rx="9" ry="5" fill="#FFB6A9" /></g>
    <path d="m275 26 7 17 18 7-18 7-7 18-7-18-17-7 17-7Z" fill="#F5B95E" /><path d="m43 202 5 12 13 5-13 5-5 13-5-13-12-5 12-5Z" fill="#B29CDD" /><circle cx="84" cy="35" r="8" fill="#F2A296" /><path d="m279 246 9 9 18-20" stroke="#398370" strokeWidth="7" strokeLinecap="round" />
  </svg>
}

const number = (value: number) => value.toLocaleString('fa-IR')
const lessonNumber = (lesson: LessonDefinition) => Number(lesson.lessonId.match(/\d+$/u)?.[0] ?? 1)
function lessonLabel(lesson: LessonDefinition) {
  return lessonNumber(lesson) === 1 ? 'درس اول' : lessonNumber(lesson) === 2 ? 'درس دوم' : lessonNumber(lesson) === 4 ? 'درس چهارم' : lessonNumber(lesson) === 5 ? 'درس پنجم' : 'درس ' + number(lessonNumber(lesson))
}
function lessonEntries(bundle: ContentBundle, lessonId: string) {
  return bundle.entries.filter(entry => entry.introducedInLessonId === lessonId)
    .sort((a, b) => a.introductionOrder - b.introductionOrder)
}
function LessonCards({ summaries, activeLessonId, disabled, onChoose }: {
  summaries: LessonSummary[]; activeLessonId: string; disabled: boolean; onChoose: (lessonId: string) => Promise<void>
}) {
  return <div className="lesson-grid">{summaries.map(item => <article className={`lesson-card ${item.lesson.lessonId === activeLessonId ? 'lesson-current' : ''}`} data-lesson-id={item.lesson.lessonId} key={item.lesson.lessonId}>
    <div className="lesson-card-top"><span className="level-pill" lang="it" dir="ltr">{item.lesson.level} · Lezione {String(lessonNumber(item.lesson)).padStart(2, '0')}</span>{item.lesson.lessonId === activeLessonId && <span className="current-lesson-label"><Icon name="check" /> درس انتخاب‌شده</span>}</div>
    <span className="eyebrow">{lessonLabel(item.lesson)}</span><h3 lang="it" dir="ltr">{item.lesson.titleIt}</h3><p className="lesson-card-topic">{item.lesson.titleFa}</p>
    <dl className="lesson-card-stats"><div><dt>واژه و عبارت</dt><dd>{number(item.total)}</dd></div><div><dt>معرفی‌شده</dt><dd>{number(item.introduced)}</dd></div><div><dt>موعد مرور</dt><dd>{number(item.due)}</dd></div><div><dt>تثبیت‌شده</dt><dd>{number(item.stabilized)}</dd></div></dl>
    <div className="lesson-card-progress" role="progressbar" aria-label={`واژه‌های معرفی‌شدهٔ ${lessonLabel(item.lesson)}`} aria-valuemin={0} aria-valuemax={item.total} aria-valuenow={item.introduced}><span style={{ width: `${item.total ? Math.min(100, item.introduced / item.total * 100) : 0}%` }} /></div>
    <button type="button" className="lesson-open-button" disabled={disabled} onClick={() => void onChoose(item.lesson.lessonId)}>ورود به {lessonLabel(item.lesson)}<Icon name="arrow" /></button>
  </article>)}</div>
}
const statusLabels = { new: 'جدید', learning: 'در حال یادگیری', due: 'موعد مرور', stabilized: 'تثبیت‌شده' }
function durationLabel(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
  return `${number(Math.floor(seconds / 60)).padStart(2, '۰')}:${number(seconds % 60).padStart(2, '۰')}`
}
function dateLabel(value: string | null, now: string) {
  if (!value) return 'هنوز زمان‌بندی نشده'
  if (new Date(value).getTime() <= new Date(now).getTime()) return 'اکنون، آمادهٔ مرور'
  return new Intl.DateTimeFormat('fa-IR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
function ItalianWord({ entry, showArticle = true }: { entry: Entry; showArticle?: boolean }) {
  return <span lang="it" dir="ltr" className="german-word">{showArticle && entry.nounData?.article && <span className="article">{entry.nounData.article}{entry.nounData.article === "l'" ? '' : ' '}</span>}{entry.lemma}</span>
}
const PronunciationContext = createContext<Pronunciation | null>(null)
const SpeechScope = createContext('page')
function usePronunciation() {
  const playback = useContext(PronunciationContext)
  if (!playback) throw new Error('PronunciationProvider is required')
  return playback
}
function PronunciationProvider({ children }: { children: ReactNode }) {
  const [playback] = useState(browserPronunciation)
  useEffect(() => {
    const disconnect = playback.connect()
    const stop = () => playback.stop()
    const hide = () => { if (document.visibilityState !== 'visible') stop() }
    window.addEventListener('pagehide', stop)
    document.addEventListener('visibilitychange', hide)
    return () => { disconnect(); window.removeEventListener('pagehide', stop); document.removeEventListener('visibilitychange', hide) }
  }, [playback])
  return <PronunciationContext value={playback}>{children}</PronunciationContext>
}
function SpeakerButton({ text, sentence = false, children }: { text: string; sentence?: boolean; children?: ReactNode }) {
  const playback = usePronunciation()
  const scope = useContext(SpeechScope)
  const id = useId()
  const snapshot = useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot)
  const playing = snapshot.activeId === id
  useEffect(() => () => playback.stopButton(id), [playback, id, text])
  const label = `${playing ? 'توقف پخش' : 'پخش تلفظ'} ${sentence ? 'جملهٔ ایتالیایی' : 'واژهٔ ایتالیایی'}`
  return <button type="button" className={children ? 'speech-text' : 'speaker-button'} lang={children ? 'it' : undefined} dir={children ? 'ltr' : undefined} aria-label={children ? `${label} — ${text}` : label} title={label} aria-pressed={playing} onClick={event => { event.preventDefault(); event.stopPropagation(); playback.toggle(id, scope, text) }}>
    {children ?? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{playing ? <path d="M6 6h12v12H6Z" /> : <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></>}</svg>}
  </button>
}
function PronunciationStatus() {
  const playback = usePronunciation()
  const { message } = useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot)
  return <p className="pronunciation-status" role="status" aria-live="polite">{message}</p>
}
function SpokenWord({ entry, showArticle = true, icon = false }: { entry: Entry; showArticle?: boolean; icon?: boolean }) {
  const text = showArticle ? wordPronunciation(entry) : entry.lemma
  const word = <ItalianWord entry={entry} showArticle={showArticle} />
  return icon ? <span className="spoken-word">{word}<SpeakerButton text={text} /></span>
    : <SpeakerButton text={text}>{word}</SpeakerButton>
}
function DetailSheet({ title, label, children, disabled = false, beforeOpen }: {
  title: string; label?: string; children: ReactNode; disabled?: boolean; beforeOpen?: () => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const speechScope = useId()
  const playback = usePronunciation()
  useEffect(() => () => playback.stopScope(speechScope), [playback, speechScope])
  const [opening, setOpening] = useState(false)
  return <><button type="button" className="text-button details-trigger" disabled={disabled || opening} onClick={async () => {
    if (opening) return
    setOpening(true)
    try { await beforeOpen?.(); dialog.current?.showModal() } catch { /* Application keeps the retryable command. */ } finally { setOpening(false) }
  }}><Icon name="info" />{label ?? title}</button><dialog ref={dialog} className="detail-sheet" aria-labelledby={titleId} onClose={() => playback.stopScope(speechScope)} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close() }}><div className="detail-sheet-header"><h2 id={titleId}>{title}</h2><button type="button" className="sheet-close" aria-label="بستن جزئیات" onClick={() => dialog.current?.close()}><Icon name="close" /></button></div><div className="detail-sheet-body"><SpeechScope value={speechScope}>{children}<PronunciationStatus /></SpeechScope></div></dialog></>
}
function TargetPrompt({ active, minutes, disabled, onFinish, onContinue }: {
  active: boolean; minutes: number; disabled: boolean; onFinish: () => Promise<void>; onContinue: () => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current
    if (active) { if (!element?.open) element?.showModal() }
    else element?.close()
    return () => { element?.close() }
  }, [active])
  return <dialog ref={dialog} className="target-banner target-dialog" aria-labelledby={titleId} onCancel={event => event.preventDefault()}><div><h2 id={titleId}>به هدف حدود {number(minutes)} دقیقهٔ امروز رسیدی.</h2><p>می‌توانی جلسه را تمام کنی یا با همان صف، به تمرین ادامه بدهی.</p><div className="target-actions"><button className="primary-button" type="button" disabled={disabled} onClick={() => void onFinish()}>پایان و دیدن خلاصه</button><button className="secondary-button" type="button" autoFocus disabled={disabled} onClick={() => void onContinue().catch(() => {})}>ادامهٔ تمرین</button></div></div></dialog>
}
function Sources({ entry, bundle }: { entry: Entry; bundle: ContentBundle }) {
  return <DetailSheet title="ارجاع این واژه"><div className="entry-sources"><ul>{entry.sourceRefIds.map(id => {
    const ref = bundle.sourceRefs.find(item => item.sourceRefId === id)
    if (!ref) return null
    const source = bundle.sources.find(item => item.sourceId === ref.sourceId)
    return <li key={id}>{source?.title} · {ref.locator}</li>
  })}</ul>{entry.sourceHeadword && <p>صورت در منبع: <span lang="it" dir="ltr">{entry.sourceHeadword}</span></p>}{entry.formNoteFa && <p>{entry.formNoteFa}</p>}<p>تطبیق با گزیدهٔ موجود؛ اصل کتاب به‌طور جامع بررسی نشده است.</p></div></DetailSheet>
}
function ExampleBlock({ entry, example = entry.examples[0], card = false, icon = card }: { entry: Entry; example?: Example; card?: boolean; icon?: boolean }) {
  return <div className={`example-block${card ? ' card-example' : ''}`} data-example-id={example?.exampleId} data-source-ref-id={example?.sourceRefId}><span className="tiny-label">{example?.origin === 'quoted' ? 'مثال از کتاب' : 'مثال تألیفی'}</span><div className="example-sentence" dir="ltr"><p className={`example-de${card ? ' card-example-de' : ''}`} lang="it" dir="ltr">{example && !icon ? <SpeakerButton text={example.it} sentence>{example.it}</SpeakerButton> : example?.it}</p>{example?.it && icon && <SpeakerButton text={example.it} sentence />}</div><p className={card ? 'card-example-fa' : undefined}>{example?.fa}</p></div>
}
function MoreExamples({ entry, currentExampleId }: { entry: Entry; currentExampleId?: string }) {
  const others = entry.examples.filter(example => example.exampleId !== currentExampleId)
  if (!others.length || entry.examples.length < 2) return null
  return <DetailSheet title="مثال‌های بیشتر"><div className="more-examples"><p className="speaking-note">این جمله‌ها را بلند بخوان.</p>{others.map(example => <ExampleBlock key={example.exampleId} entry={entry} example={example} />)}<p className="example-reading-note">دیدن مثال‌ها امتیاز مرور را تغییر نمی‌دهد.</p></div></DetailSheet>
}
function SkillDetails({ entry, progress }: { entry: Entry; progress?: EntryProgress }) {
  const skills = [
    { key: 'meaning' as const, label: 'شناخت معنی' },
    { key: 'writing' as const, label: 'نوشتن واژه' },
    { key: 'article' as const, label: 'آرتیکل' },
  ]
  return <section className="skill-details" aria-label="عملکرد جداگانهٔ مهارت‌ها"><h3>عملکرد در هر مهارت</h3><p>درست و غلط، تعداد پاسخ‌ها هستند؛ «بدون کمک» پاسخ درستِ بدون راهنماست. جمع این آمار، معیار تسلط نیست.</p><dl>{skills.map(skill => {
    const value = progress?.skills[skill.key]
    return <div className="skill-row" key={skill.key}><dt>{skill.label}</dt><dd>{skill.key === 'article' && !entry.nounData?.article ? <span className="skill-not-applicable">برای این مدخل کاربرد ندارد</span> : <><span>درست <strong>{number(value?.correct ?? 0)}</strong></span><span>غلط <strong>{number(value?.wrong ?? 0)}</strong></span><span>با کمک <strong>{number(value?.assisted ?? 0)}</strong></span><span>بدون کمک <strong>{number(value?.unassistedCorrect ?? 0)}</strong></span></>}</dd></div>
  })}</dl></section>
}

function ReverseSkillDetails({ progress, now }: { progress?: ReverseProgress; now: string }) {
  return <section className="reverse-skill-details" aria-label="پیشرفت مستقل یادآوری فارسی به ایتالیایی"><h3>یادآوری فارسی به ایتالیایی</h3>{progress ? <><p>ارزیابی شخصی؛ جدا از شناخت معنی و نوشتن.</p><dl><div><dt>درست گفتم</dt><dd>{number(progress.correctCount)}</dd></div><div><dt>اشتباه گفتم</dt><dd>{number(progress.incorrectCount)}</dd></div><div><dt>مرور بعدی</dt><dd>{dateLabel(progress.nextDueAt, now)}</dd></div></dl></> : <p>پس از تکمیل تمرین اولیه و رسیدن به ۱۵ واژه، مرور معکوس فعال می‌شود.</p>}</section>
}

function ReverseReviewSummary({ reviews }: { reviews: ReverseReview[] }) {
  if (!reviews.length) return null
  const words = new Set(reviews.map(review => review.entryId)).size
  const correct = reviews.filter(review => review.correct).length
  return <section className="summary-reverse" aria-label="نتیجهٔ ارزیابی شخصی فارسی به ایتالیایی"><span className="summary-direction-label"><Icon name="flip" /> مرور معکوس · ارزیابی شخصی</span><div><span><strong>{number(words)}</strong> واژه</span><span><strong>{number(correct)}</strong> درست گفتم</span><span><strong>{number(reviews.length - correct)}</strong> اشتباه گفتم</span></div></section>
}

function TaskPanel({ task, props }: { task: SessionTask; props: ParolarioUIProps }) {
  const { bundle, state, busy, error, onCommand } = props
  const session = state.session!
  const feedback = session.feedback
  const [draft, setDraft] = useState(session.draft)
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null)
  const [showBack, setShowBack] = useState(task.kind === 'flashcard' && task.revealed)
  const sending = useRef(false)
  const playback = usePronunciation()
  useEffect(() => () => playback.stop(), [playback, task.taskId])
  const disabled = busy || !!error
  const commandRef = useRef(onCommand)
  useEffect(() => { commandRef.current = onCommand }, [onCommand])
  const matchAttemptId = task.kind === 'match' ? feedback?.attemptId : undefined
  const matchCorrect = feedback?.correct
  useEffect(() => {
    if (!matchAttemptId || error || session.state !== 'active') return
    let timer: ReturnType<typeof setTimeout> | undefined
    let dispatched = false
    const schedule = () => {
      clearTimeout(timer)
      if (document.visibilityState !== 'visible' || dispatched) return
      timer = setTimeout(() => {
        dispatched = true
        setSelectedLeft(null)
        void commandRef.current({ type: 'next', taskId: task.taskId }).catch(() => {})
      }, matchCorrect ? 380 : 700)
    }
    schedule()
    document.addEventListener('visibilitychange', schedule)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', schedule) }
  }, [matchAttemptId, matchCorrect, error, session.state, task.taskId])
  const matchAttempt = feedback && state.attempts.find(item => item.attemptId === feedback.attemptId)
  const cards = session.queue.filter(item => item.kind === 'flashcard')
  const cardIndex = cards.findIndex(item => item.taskId === task.taskId)
  const nextTask = session.queue[session.cursor + 1]
  const nextIsCard = nextTask?.kind === 'flashcard' || nextTask?.kind === 'reverse-card'
  const entry = task.kind === 'match'  ? null : bundle.entries.find(item => item.entryId === task.entryId)!
  async function send(command: LearningCommand) {
    if (sending.current || disabled) return
    sending.current = true
    try { await onCommand(command) } catch { /* The application owns the saved retry and error. */ } finally { sending.current = false }
  }
  function answer(value: string, entryId?: string) {
    void send({ type: 'answer', taskId: task.taskId, attemptId: crypto.randomUUID(), answer: value, ...(entryId ? { entryId } : {}) })
  }
  function next() {
    setSelectedLeft(null)
    void send({ type: 'next', taskId: task.taskId })
  }
  async function flipCard() {
    if (disabled || task.kind !== 'flashcard') return
    playback.stop()
    if (!task.revealed) {
      try { await onCommand({ type: 'reveal-card', taskId: task.taskId }); setShowBack(true) } catch { /* Remain on the saved side. */ }
    } else setShowBack(value => !value)
  }
  const feedbackEntry = feedback && bundle.entries.find(item => item.entryId === feedback.entryId)
  const assistance = state.assistanceEvents.filter(event => event.taskId === task.taskId).at(-1)
  const helpedEntry = assistance ? bundle.entries.find(item => item.entryId === assistance.entryId) : entry
  const writtenTask = task.kind === 'write-word' || task.kind === 'cloze'
  const reverseExample = entry && task.kind === 'reverse-card' && task.revealed ? getReverseExample(entry, state.reverseReviews) : null
  return <div className={`task-content task-${task.kind} ${feedback ? 'has-feedback' : ''}`}>
    <PronunciationStatus />
    {task.kind === 'flashcard' && entry && <>
      <div className="task-heading"><span className="eyebrow"><Icon name="book" /> کارت {number(cardIndex + 1)} از {number(cards.length)}</span><h1>یک دوست تازه برای حافظه‌ات.</h1><p>کارت را بچرخان و معنی و مثال را ببین.</p></div>
      <div className={`flashcard ${showBack ? 'is-flipped' : ''}`} onClick={() => void flipCard()}>
        <div className="flashcard-inner">
          <button type="button" className="flashcard-flip" aria-label={showBack ? 'نمایش روی کارت' : 'چرخاندن کارت و نمایش معنی'} aria-pressed={showBack} disabled={disabled} />
          <div className="card-face card-front" aria-hidden={showBack} inert={showBack}><span className="tiny-label">واژهٔ ایتالیایی</span><div className="card-word spoken-word"><ItalianWord entry={entry} />{!showBack && <SpeakerButton text={wordPronunciation(entry)} />}</div><span className="flip-hint"><Icon name="flip" /> برای دیدن معنی، لمس کن</span></div>
          <div className="card-face card-back" aria-hidden={!showBack} inert={!showBack}><span className="tiny-label">معنی فارسی</span><strong className="card-meaning">{entry.meaningFa}</strong>{showBack && <ExampleBlock entry={entry} card />}<span className="flip-hint"><Icon name="flip" /> برگشت به واژه</span></div>
        </div>
      </div>
      <div className="card-detail-row">{task.revealed ? <><MoreExamples entry={entry} currentExampleId={entry.examples[0]?.exampleId} /><Sources entry={entry} bundle={bundle} /></> : <span>برای دیدن معنی، کارت را لمس کن.</span>}</div>
      <button type="button" className="primary-button wide flashcard-next" onClick={next} disabled={disabled || !task.revealed}>{nextIsCard ? 'کارت بعدی' : 'برویم سراغ تمرین'} <Icon name="arrow" /></button>
    </>}
    {task.kind === 'reverse-card' && entry && <>
      <div className="task-heading reverse-heading"><span className="eyebrow"><Icon name="flip" /> مرور · فارسی به ایتالیایی</span><h1>{task.revealed ? 'چطور به خاطر آوردی؟' : 'به ایتالیایی بگو.'}</h1><p>{task.revealed ? 'جوابت را خودت ارزیابی کن.' : 'بلند بگو، بعد پاسخ را ببین.'}</p></div>
      <div className={`reverse-card ${task.revealed ? 'is-revealed' : ''}`}>
        <span className="tiny-label">{lessonLabel((bundle.lessons ?? [bundle.lesson]).find(lesson => lesson.lessonId === entry.introducedInLessonId) ?? bundle.lesson)}</span>
        <strong className="reverse-meaning">{entry.meaningFa}</strong>
        {!task.revealed && <p className="reverse-cue">{entry.writing.cueFa}</p>}
        {task.revealed && <><div className="reverse-answer" role="status"><SpokenWord entry={entry} icon /></div>{reverseExample && <div className="reverse-example"><ExampleBlock entry={entry} example={reverseExample} icon /><p className="speaking-note">این جمله را بلند بخوان.</p></div>}</>}
      </div>
      {task.revealed ? <><div className="card-detail-row"><MoreExamples entry={entry} currentExampleId={reverseExample?.exampleId} /><Sources entry={entry} bundle={bundle} /></div><div className="reverse-rating" aria-label="ارزیابی یادآوری ایتالیایی"><button type="button" className="secondary-button reverse-incorrect" disabled={disabled} onClick={() => void send({ type: 'rate-reverse', taskId: task.taskId, reviewId: crypto.randomUUID(), correct: false })}><Icon name="close" />اشتباه گفتم</button><button type="button" className="primary-button reverse-correct" disabled={disabled} onClick={() => void send({ type: 'rate-reverse', taskId: task.taskId, reviewId: crypto.randomUUID(), correct: true })}><Icon name="check" />درست گفتم</button></div></>
        : <><div className="card-detail-row"><span>یادآوری کن؛ نمایش پاسخ امتیاز نیست.</span></div><button type="button" className="primary-button wide reverse-reveal" disabled={disabled} onClick={() => void send({ type: 'reveal-card', taskId: task.taskId })}>نمایش پاسخ<Icon name="flip" /></button></>}
    </>}
    {task.kind === 'choose-meaning' && entry && !feedback && <>
      <div className="task-heading"><span className="eyebrow"><Icon name="spark" /> انتخاب معنی</span><h1>معنی درست کدام است؟</h1><p>یکی از چهار گزینه را انتخاب کن.</p></div>
      <div className="question-word"><SpokenWord entry={entry} icon /></div>
      <div className="meaning-options">{task.optionIds.map((id, index) => {
        const option = bundle.entries.find(item => item.entryId === id)!
        const attempt = feedback && state.attempts.find(item => item.attemptId === feedback.attemptId)
        const selected = attempt?.answer === id
        const correctOption = !!feedback && id === entry.entryId
        return <button key={id} type="button" className={`meaning-option ${selected ? 'selected' : ''} ${correctOption ? 'answer-correct' : ''} ${selected && !feedback?.correct ? 'answer-wrong' : ''}`} disabled={disabled || !!feedback} onClick={() => answer(id)}><span className="option-number">{number(index + 1)}</span><span>{option.meaningFa}</span>{correctOption && <Icon name="check" />}{selected && !feedback?.correct && <Icon name="close" />}</button>
      })}</div>
    </>}
    {(task.kind === 'cloze' || task.kind === 'write-word') && entry && !feedback && <>
      <div className="task-heading"><span className="eyebrow"><Icon name="book" /> {task.cycleKind === 'scheduled' ? 'مرور موعدرسیده' : task.cycleKind === 'recovery' ? 'یک فرصت دیگر' : task.kind === 'write-word' ? 'نوشتن واژه' : 'جای خالی'}</span><h1>{task.kind === 'write-word' ? 'واژه را به ایتالیایی بنویس.' : 'جمله را کامل کن.'}</h1><p>{task.kind === 'write-word' ? 'از روی معنی و سرنخ فارسی، واژه را به خاطر بیاور.' : 'واژهٔ مناسب را به ایتالیایی بنویس.'}</p></div>
      {task.kind === 'cloze' ? <div className="cloze-question"><span className="tiny-label">جملهٔ تألیفی</span><p lang="it" dir="ltr"><SpeakerButton text={entry.cloze.sentence.replace('___', '…')} sentence>{entry.cloze.sentence.split('___').map((part, i) => <span key={i}>{i > 0 && <span className="blank-mark" aria-label="جای خالی">…</span>}{part}</span>)}</SpeakerButton></p><p className="cloze-translation">{entry.cloze.translationFa}</p><p className="writing-cue">{entry.cloze.cueFa ?? entry.writing.cueFa}</p></div>
        : <div className="writing-question"><span className="tiny-label">معنی هدف</span><p className="writing-prompt">{entry.writing.promptFa}</p><p className="writing-cue">{entry.writing.cueFa}</p></div>}
      <form onSubmit={event => { event.preventDefault(); if (draft.trim() && !feedback) { event.currentTarget.querySelector('input')?.blur(); answer(draft) } }} className="answer-form">
        <label htmlFor="italian-answer">پاسخ تو</label>
        <input id="italian-answer" lang="it" dir="ltr" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="La tua risposta …" value={draft} disabled={!!feedback || !!error} onChange={event => {
          const value = event.target.value
          setDraft(value)
          void onCommand({ type: 'draft', taskId: task.taskId, value }).catch(() => {})
        }} />
        <DetailSheet title="راهنمای نوشتن"><p>{entry.writing.caseSensitive ? 'حروف بزرگ و کوچک در این پاسخ مهم‌اند.' : 'در این پاسخ، تفاوت حروف بزرگ و کوچک پذیرفته می‌شود؛ صورت معیار را پس از ثبت می‌بینی.'} اکسان در واژه‌هایی مثل è و sì و آپاستروف را رعایت کن؛ صورت جایگزین فقط اگر برای همین تمرین ثبت شده باشد پذیرفته می‌شود.</p></DetailSheet>
        {!feedback && <button className="primary-button wide" type="submit" disabled={disabled || !draft.trim()}>بررسی پاسخ <Icon name="check" /></button>}
      </form>
    </>}
    {task.kind === 'choose-article' && entry?.nounData?.article && !feedback && <>
      <div className="task-heading"><span className="eyebrow"><Icon name="book" /> آرتیکل اسم</span><h1>این اسم با کدام آرتیکل می‌آید؟</h1><p>آرتیکل را همراه خود واژه به خاطر بسپار.</p></div>
      <div className="question-word article-question-word"><span className="article-question-mark" aria-hidden="true">?</span><SpokenWord entry={entry} showArticle={false} icon /></div>
      <p className="article-meaning">{entry.meaningFa}</p>
      <div className="article-options">{task.options.map(option => {
        const attempt = feedback && state.attempts.find(item => item.attemptId === feedback.attemptId)
        const selected = attempt?.answer === option
        const correctOption = !!feedback && option === entry.nounData?.article
        return <button type="button" key={option} lang="it" dir="ltr" className={`meaning-option article-option ${correctOption ? 'answer-correct' : ''} ${selected && !feedback?.correct ? 'answer-wrong' : ''}`} disabled={disabled || !!feedback} onClick={() => answer(option)}>{option}{correctOption && <Icon name="check" />}{selected && !feedback?.correct && <Icon name="close" />}</button>
      })}</div>
    </>}
    {task.kind === 'match' && <>
      <div className="task-heading"><span className="eyebrow"><Icon name="link" /> چهار جفت، یک بازی</span><h1>واژه‌ها را به معنی وصل کن.</h1><p>اول یک واژه، بعد معنی‌اش را لمس کن.</p></div>
      <div className="match-status"><span>{number(task.matchedEntryIds.length)} از ۴ جفت پیدا شده</span><span className="match-dots" aria-hidden="true">{[0, 1, 2, 3].map(index => <i key={index} className={index < task.matchedEntryIds.length ? 'found' : ''} />)}</span></div>
      <div className="match-board" dir="ltr">
        <div className="match-column"><span className="tiny-label" lang="it">Italiano</span>{task.leftOrder.map(id => {
          const word = bundle.entries.find(item => item.entryId === id)!
          const matched = task.matchedEntryIds.includes(id)
          return <div className="match-word-tile" key={id}><button className={`match-tile word-tile ${selectedLeft === id ? 'is-selected' : ''} ${matched ? 'is-matched' : ''} ${feedback && !feedback.correct && feedback.entryId === id ? 'answer-wrong' : ''}`} type="button" disabled={disabled || !!feedback || matched} aria-pressed={selectedLeft === id} onClick={() => setSelectedLeft(id)}><ItalianWord entry={word} />{matched && <><Icon name="check" /><span className="sr-only">وصل شد</span></>}</button><SpeakerButton text={wordPronunciation(word)} /></div>
        })}</div>
        <div className="match-column" dir="rtl"><span className="tiny-label">فارسی</span>{task.rightOrder.map(id => {
          const word = bundle.entries.find(item => item.entryId === id)!
          const matched = task.matchedEntryIds.includes(id)
          return <button className={`match-tile ${matched ? 'is-matched' : ''} ${feedback && !feedback.correct && matchAttempt?.answer === id ? 'answer-wrong' : ''}`} type="button" key={id} disabled={disabled || !!feedback || matched || !selectedLeft} onClick={() => selectedLeft && answer(id, selectedLeft)}>{word.meaningFa}{matched && <><Icon name="check" /><span className="sr-only">وصل شد</span></>}</button>
        })}</div>
      </div><p className="match-message" role="status" aria-live="polite">{feedback ? feedback.correct ? task.matchedEntryIds.length === 4 ? 'همه را پیدا کردی! ✦' : 'آفرین! جفت بعدی را پیدا کن.' : 'این دو جفت نیستند؛ دوباره امتحان کن.' : 'با هر جفت، یک قدم جلوتر ✦'}</p>
    </>}
    {task.kind !== 'flashcard' && task.kind !== 'reverse-card' && (!feedback || task.kind === 'match') && <section className="assistance-panel" aria-label="کمک در تمرین"><div className="assistance-actions">
      <DetailSheet title="مثال راهنما" label="دیدن مثال راهنما" disabled={disabled || !!feedback} beforeOpen={() => send({ type: 'assist', taskId: task.taskId, eventId: crypto.randomUUID(), kind: 'hint' })}><p>با دیدن راهنما این تلاش با کمک ثبت می‌شود.</p>{task.assisted && helpedEntry && <ExampleBlock entry={helpedEntry} />}</DetailSheet>
      <DetailSheet title="پاسخ تمرین" label="نمایش پاسخ" disabled={disabled || !!feedback} beforeOpen={() => send({ type: 'assist', taskId: task.taskId, eventId: crypto.randomUUID(), kind: 'answer' })}><p>این تلاش مستقل محسوب نمی‌شود.</p>{task.assisted && helpedEntry && <p>پاسخ: {task.kind === 'choose-article' || task.kind === 'match' ? <><SpokenWord entry={helpedEntry} /><span> — {helpedEntry.meaningFa}</span></> : task.kind === 'cloze' ? <SpeakerButton text={helpedEntry.cloze.acceptedAnswers[0]}>{helpedEntry.cloze.acceptedAnswers[0]}</SpeakerButton> : writtenTask ? <SpokenWord entry={helpedEntry} showArticle={false} /> : <bdi lang="fa" dir="rtl">{helpedEntry.meaningFa}</bdi>}</p>}</DetailSheet>
    </div></section>}
    {feedback && task.kind !== 'match' && task.kind !== 'reverse-card' && <div className={`feedback ${feedback.correct ? 'feedback-correct' : 'feedback-wrong'} ${feedback.assisted ? 'feedback-assisted' : ''}`} role="status" aria-live="polite">
      <div className="feedback-title"><span className="feedback-symbol"><Icon name={feedback.correct ? 'check' : 'close'} /></span><strong>{feedback.correct ? feedback.assisted ? 'درست بود؛ این تلاش با کمک ثبت شد.' : 'درست بود، آفرین!' : 'این بار درست نبود؛ با هم مرور کنیم.'}</strong></div>
      {(writtenTask || !feedback.correct) && <p className="correct-answer">{writtenTask ? 'صورت معیار:' : 'پاسخ درست:'} {writtenTask || task.kind === 'choose-article'
        ? <SpeakerButton text={feedback.expectedAnswer}>{feedback.expectedAnswer}</SpeakerButton>
        : <bdi lang="fa" dir="rtl">{feedback.expectedAnswer}</bdi>}</p>}
      {task.kind === 'choose-article' && feedbackEntry && <p className="article-answer"><SpokenWord entry={feedbackEntry} /><span>{feedbackEntry.meaningFa}</span></p>}
      {feedback.assisted && <p className="assisted-feedback-note">این پاسخ، یادآوری مستقل یا پلهٔ تازهٔ مرور محسوب نمی‌شود.</p>}
      {feedbackEntry && task.kind !== 'choose-article' && <div className="feedback-word"><SpokenWord entry={feedbackEntry} /><p>{feedbackEntry.meaningFa}</p></div>}
      <DetailSheet title="مثال و توضیح پاسخ"><p>{feedback.explanationFa}</p>{feedbackEntry && <ExampleBlock entry={feedbackEntry} />}</DetailSheet>
      <button className="primary-button wide feedback-next" type="button" onClick={next} disabled={disabled}>ادامه<Icon name="arrow" /></button>
    </div>}
  </div>
}

function LessonWordList({ entries, props }: { entries: Entry[]; props: ParolarioUIProps }) {
  const { bundle, state, statuses, now } = props
  const playback = usePronunciation()
  return <div className="word-list">{entries.map(entry => <details className="word-item" key={entry.entryId} onToggle={event => { if (!event.currentTarget.open) playback.stopScope(entry.entryId) }}>
          <summary><span className="word-item-main"><SpeechScope value={entry.entryId}><SpokenWord entry={entry} /></SpeechScope><span>{entry.meaningFa}</span></span><span className={`word-status status-${statuses[entry.entryId]}`}><i />{statusLabels[statuses[entry.entryId]]}</span><span className="details-chevron" aria-hidden="true">⌄</span></summary>
          <div className="word-item-details"><SpeechScope value={entry.entryId}><ExampleBlock entry={entry} /><MoreExamples entry={entry} currentExampleId={entry.examples[0]?.exampleId} /><SkillDetails entry={entry} progress={state.progress[entry.entryId]} /><ReverseSkillDetails progress={state.reverseProgress?.[entry.entryId]} now={now} /><Sources entry={entry} bundle={bundle} />{state.progress[entry.entryId]?.nextDueAt && <p className="word-due">مرور بعدی: {dateLabel(state.progress[entry.entryId].nextDueAt, now)}</p>}</SpeechScope></div>
        </details>)}</div>
}

export function ParolarioUI(props: ParolarioUIProps) {
  return <PronunciationProvider><ParolarioView {...props} /></PronunciationProvider>
}
function ParolarioView(props: ParolarioUIProps) {
  const { bundle, state, stats, summary, statuses, busy, error, offlineStatus, now, onCommand, onRetry, onSessionVisibilityChange } = props
  const [page, setPage] = useState<Page>('home')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const playback = usePronunciation()
  const selectingLesson = useRef(false)
  const session = state.session
  const task = session && session.state !== 'ended' ? session.queue[session.cursor] : null
  const effectivePage = page === 'session' && session?.state === 'ended' ? 'summary'
    : page === 'session' && session?.state === 'paused' ? 'home' : page
  useEffect(() => () => playback.stop(), [playback, effectivePage, state.activeLessonId])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [effectivePage])
  useEffect(() => {
    const viewport = window.visualViewport
    const resize = () => {
      const height = viewport?.height ?? window.innerHeight
      document.documentElement.style.setProperty('--app-height', `${height}px`)
      document.documentElement.style.setProperty('--app-top', `${viewport?.offsetTop ?? 0}px`)
      document.documentElement.classList.toggle('keyboard-open', height < window.innerHeight * .75)
    }
    resize()
    viewport?.addEventListener('resize', resize)
    viewport?.addEventListener('scroll', resize)
    window.addEventListener('resize', resize)
    return () => { viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); window.removeEventListener('resize', resize) }
  }, [])
  const sessionIsVisible = effectivePage === 'session' && session?.state === 'active'
  useEffect(() => {
    onSessionVisibilityChange(sessionIsVisible)
    return () => onSessionVisibilityChange(false)
  }, [onSessionVisibilityChange, sessionIsVisible])
  const disabled = busy || !!error
  const activeLesson = props.activeLesson ?? (bundle.lessons ?? [bundle.lesson]).find(lesson => lesson.lessonId === state.activeLessonId) ?? bundle.lesson
  const activeEntries = lessonEntries(bundle, activeLesson.lessonId)
  const total = activeEntries.length
  const summaries = props.lessonSummaries ?? (bundle.lessons ?? [bundle.lesson]).map(lesson => {
    const entries = lessonEntries(bundle, lesson.lessonId)
    return { lesson, total: entries.length, introduced: entries.filter(entry => state.progress[entry.entryId]).length,
      due: entries.filter(entry => statuses[entry.entryId] === 'due').length,
      stabilized: entries.filter(entry => statuses[entry.entryId] === 'stabilized').length }
  })
  const activeProvenance = props.activeProvenance ?? bundle.provenance
  async function chooseLesson(lessonId: string) {
    if (disabled || selectingLesson.current) return
    selectingLesson.current = true
    try {
      if (lessonId !== activeLesson.lessonId) await onCommand({ type: 'select-lesson', lessonId })
      setSearch(''); setFilter('all'); setPage('home')
    } catch { /* Keep the current lesson until its selection and session are saved. */ } finally { selectingLesson.current = false }
  }
  const targetReached = stats.todayActiveMs >= state.settings.targetActiveMs && !session?.targetAcknowledged
  async function start() {
    try { await onCommand({ type: 'start-session', sessionId: crypto.randomUUID(), seed: Math.floor(Math.random() * 0xffffffff) }); setPage('session') } catch { /* Root displays the persistent failure. */ }
  }
  async function pause() { try { await onCommand({ type: 'pause' }); setPage('home') } catch { /* Root owns retry and failure feedback. */ } }
  async function finish() { try { await onCommand({ type: 'end-session' }); setPage('summary') } catch { /* Keep the session visible until its end is saved. */ } }
  async function navigate(destination: Page) {
    try {
      // The word list exposes the pending answer even when the session is paused.
      if (destination === 'words' && task && task.kind !== 'flashcard' && task.kind !== 'reverse-card' && (!session?.feedback || task.kind === 'match')) {
        if (task.kind === 'match') {
          const exposed = new Set(state.assistanceEvents.filter(event => event.taskId === task.taskId).map(event => event.entryId))
          for (const entryId of task.entryIds.filter(id => !task.matchedEntryIds.includes(id) && !exposed.has(id))) {
            await onCommand({ type: 'assist', taskId: task.taskId, eventId: crypto.randomUUID(), kind: 'answer', entryId })
          }
        } else if (!task.assisted) {
          await onCommand({ type: 'assist', taskId: task.taskId, eventId: crypto.randomUUID(), kind: 'answer' })
        }
      }
      setPage(destination)
    } catch { /* Keep the answer concealed until its assistance event is stored. */ }
  }
  const navigation: { page: Page; label: string; icon: IconName }[] = [{ page: 'home', label: 'خانه', icon: 'home' }, { page: 'lessons', label: 'درس‌ها', icon: 'book' }, { page: 'words', label: 'واژه‌ها', icon: 'spark' }, { page: 'about', label: 'دربارهٔ درس', icon: 'info' }]
  const learnedCount = Object.keys(state.reverseProgress ?? {}).length
  const reverseDueCount = Object.values(state.reverseProgress ?? {}).filter(item => Date.parse(item.nextDueAt) <= Date.parse(now)).length
  const reverseSessionReviews = (state.reverseReviews ?? []).filter(review => review.sessionId === session?.sessionId)
  const hasOriginalSessionWork = summary.totalAnswers > 0 || summary.introduced > 0
  const summaryNextDueAt = [summary.nextDueAt, ...reverseSessionReviews.map(review => state.reverseProgress[review.entryId]?.nextDueAt)].filter((value): value is string => !!value).sort()[0] ?? null
  const selectedWords = activeEntries.filter(entry => (filter === 'all' || statuses[entry.entryId] === filter) && `${entry.lemma} ${entry.meaningFa}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  return <div className={`wortzeit-app page-${effectivePage}`} dir="rtl" lang="fa">
    <header className="app-header"><button type="button" className="brand" aria-label="Parolario، خانه" onClick={() => setPage('home')}><span className="brand-mark"><Icon name="leaf" /></span><span><strong lang="it" dir="ltr">Parolario<span className="brand-dot">.</span></strong><small>وقتِ واژه‌هاست</small></span></button><nav className="desktop-nav" aria-label="ناوبری اصلی">{navigation.map(item => <button type="button" key={item.page} className={effectivePage === item.page ? 'active' : ''} onClick={() => void navigate(item.page)}>{item.label}</button>)}</nav><div className={`offline-pill ${offlineStatus === 'ready' ? 'offline-ready' : ''}`} role="status"><span className="status-dot" />{offlineStatus === 'ready' ? 'آمادهٔ آفلاین' : offlineStatus === 'checking' ? 'آماده‌سازی آفلاین…' : 'آفلاین آماده نیست'}</div></header>
    <main className="app-main">
      <div className="active-lesson-strip"><span><Icon name="book" /><strong>{lessonLabel(activeLesson)}</strong><span>{activeLesson.titleFa}</span></span><button type="button" className="text-button" onClick={() => void navigate('lessons')} disabled={disabled}>تغییر درس<Icon name="arrow" /></button></div>
      {effectivePage === 'lessons' && <section className="lessons-page"><div className="page-intro"><div><span className="eyebrow">بخش جداگانهٔ هر درس</span><h1>درس خودت را انتخاب کن<span className="orange-dot">.</span></h1><p>واژه‌ها، تمرین‌ها و ادامهٔ هر درس در بخش خودش می‌ماند. هدف روزانه برای مطالعهٔ همهٔ درس‌ها مشترک است.</p></div></div><LessonCards summaries={summaries} activeLessonId={activeLesson.lessonId} disabled={disabled} onChoose={chooseLesson} /><p className="lessons-note">هر درس آماده را می‌توانی مستقیم باز کنی؛ مرورهای هر درس در همان بخش در دسترس‌اند.</p></section>}
      {error && <div className="storage-error" role="alert"><Icon name="info" /><div><strong>ذخیره کامل نشد</strong><p>{error}</p></div><button type="button" className="text-button" onClick={onRetry} disabled={busy}>تلاش دوباره</button></div>}
      {effectivePage === 'home' && <section className="home-page">
        <div className="page-intro"><div><span className="eyebrow">هر روز، چند واژه نزدیک‌تر</span><h1>وقتِ یک قدم کوچکه<span className="orange-dot">.</span></h1></div><span className="level-pill" lang="it" dir="ltr">{activeLesson.level} · Lezione {String(lessonNumber(activeLesson)).padStart(2, '0')}</span></div>
        <div className="home-grid"><section className="hero-panel"><div className="hero-copy"><span className="eyebrow lesson-eyebrow"><span className="mini-line" /> {lessonLabel(activeLesson)} · {activeLesson.titleFa}</span><h2 lang="it" dir="ltr">{activeLesson.titleIt}</h2><p>اول چند فلش‌کارت، بعد کمی بازی.<br />واژه‌های تازه را با ریتم خودت یاد بگیر.</p><button type="button" className="primary-button hero-button" disabled={disabled} onClick={() => void start()}>ادامهٔ یادگیری<Icon name="arrow" /></button><span className="hero-caption">{session && session.state !== 'ended' ? 'جلسهٔ ناتمام تو از همان‌جا ادامه پیدا می‌کند.' : 'شروع یادگیری · حداکثر ۵ واژهٔ جدید در هر جلسه'}</span></div><GardenIllustration /></section>
          <aside className="today-panel"><span className="eyebrow"><Icon name="clock" /> نوبت مرور</span><div className="review-number">{number(stats.due)}<span>واژه</span></div><h2>{stats.due ? 'منتظر یک دیدار دوباره‌اند' : 'مرور عقب‌افتاده‌ای نداری'}</h2><p>{stats.due ? 'مرورهای موعدرسیده پیش از واژه‌های تازه می‌آیند.' : 'پس از تمرین، وقت مرور بعدی اینجا مشخص می‌شود.'}</p><div className="next-review"><Icon name="clock" /><span>مرور بعدی<strong>{dateLabel(stats.nextDueAt, now)}</strong></span></div></aside></div>
        <section className="progress-panel"><div><span className="eyebrow">ردِ قدم‌های تو</span><h2>پیشرفت در {lessonLabel(activeLesson)}</h2><p>واژه‌های همین درس و پیشرفت واقعی تو.</p></div><div className="progress-overview"><div className="progress-count"><strong>{number(stats.introduced)}</strong><span>از {number(total)} واژه معرفی شده</span></div><div className="word-progress" role="progressbar" aria-label="واژه‌های معرفی‌شده در بسته" aria-valuemin={0} aria-valuemax={total} aria-valuenow={stats.introduced}><span style={{ width: `${total ? stats.introduced / total * 100 : 0}%` }} /></div><span className="progress-note">معرفی شدن با تسلط یکی نیست؛ مرورهای روزهای بعد مهم‌اند.</span></div><div className="answer-stat"><span className="stat-icon"><Icon name="check" /></span><strong>{number(stats.correct)} <small>از {number(stats.totalAnswers)}</small></strong><span>پاسخ درست</span></div></section>
        <div className="daily-glance"><span><Icon name="clock" /> امروز <bdi dir="ltr">{durationLabel(stats.todayActiveMs)}</bdi> مطالعه</span><span><Icon name="flip" />{learnedCount < 15 ? `مرور معکوس · ${number(learnedCount)} از ۱۵ واژه` : `مرور معکوس · ${number(reverseDueCount)} آماده`}</span></div>
        <section className="home-lessons-section" aria-label="دسترسی به درس‌ها"><button type="button" className="lesson-shortcut" onClick={() => void navigate('lessons')}><span><Icon name="book" /> درس‌های من</span><span>{number(summaries.length)} درس آماده <Icon name="arrow" /></span></button></section>
        <div className="home-footnote"><Icon name="leaf" /><p>پیشرفتت در همین مرورگر می‌ماند؛ هر وقت برگشتی، از همین‌جا ادامه بده.</p><button type="button" className="text-button" onClick={() => setPage('about')}>دربارهٔ محتوا و ذخیره</button></div>
      </section>}
      {effectivePage === 'session' && <section className="session-page">
        <div className="session-toolbar"><button type="button" className="text-button" onClick={() => void pause()} disabled={disabled}><Icon name="pause" /> توقف و بازگشت</button><span>{lessonLabel(activeLesson)} <span className="toolbar-dot">·</span> {number(summary.practiced)} واژه تمرین شده</span><button type="button" className="text-button finish-button" onClick={() => void finish()} disabled={disabled}>پایان جلسه</button></div>
        <div className="session-progress"><span style={{ width: `${session?.queue.length ? Math.min(100, session.cursor / session.queue.length * 100) : 0}%` }} /></div>
        <div className="session-activity"><span><Icon name="clock" /> زمان فعال این جلسه <bdi dir="ltr">{durationLabel(summary.activeMs)}</bdi></span><span className="session-phase">{task?.kind === 'reverse-card' ? 'مرور · فارسی به ایتالیایی' : task?.kind === 'flashcard' ? '۱ · آشنایی با واژه‌ها' : task?.kind === 'match' ? '۳ · بازی جفت‌ها' : '۲ · یادآوری و تمرین'}</span></div>
        <TargetPrompt active={targetReached} minutes={state.settings.targetActiveMs / 60_000} disabled={disabled} onFinish={finish} onContinue={() => onCommand({ type: 'continue-after-target' })} />
        {task ? <TaskPanel key={task.taskId} task={task} props={props} /> : <div className="empty-state"><Icon name="check" /><h1>تمرین‌های این نوبت تمام شد.</h1><p>خلاصهٔ واقعی جلسه و وقت مرور بعدی را ببین.</p><button className="primary-button" type="button" onClick={() => void finish()} disabled={disabled}>دیدن خلاصه <Icon name="arrow" /></button></div>}
      </section>}
      {effectivePage === 'summary' && <section className={`summary-page ${reverseSessionReviews.length ? 'with-reverse-summary' : ''}`}>
        <div className="summary-art"><Icon name="leaf" /><span className="summary-spark">✦</span></div><span className="eyebrow">یک قدم دیگر برداشتی</span><h1>این بود نوبتِ امروزت<span className="orange-dot">.</span></h1><p>{lessonLabel(activeLesson)} · {activeLesson.titleFa}؛ هر برخورد با یک واژه، فرصتی برای یادگیری است.</p>
        {hasOriginalSessionWork && <section className="summary-original" aria-label="نتیجهٔ تمرین‌های اصلی"><span className="summary-direction-label">تمرین‌های اصلی · شناخت معنی و نوشتن</span><div className="summary-stats"><div><strong>{number(summary.practiced)}</strong><span>واژهٔ تمرین‌شده</span></div><div><strong>{number(summary.correct)}<small> / {number(summary.totalAnswers)}</small></strong><span>پاسخ درست</span></div><div><strong>{number(summary.needsReview)}</strong><span>نیازمند مرور</span></div><div><strong>{number(summary.introduced)}</strong><span>واژهٔ معرفی‌شده</span></div></div></section>}
        <ReverseReviewSummary reviews={reverseSessionReviews} />
        <div className="summary-activity"><span>زمان فعال جلسه <strong dir="ltr">{durationLabel(summary.activeMs)}</strong></span>{hasOriginalSessionWork && <span>پاسخ تمرین با کمک <strong>{number(summary.assisted)}</strong></span>}</div>
        <div className="summary-next"><Icon name="clock" /><div><strong>وقت دیدار دوباره</strong><p>{dateLabel(summaryNextDueAt, now)}</p></div></div>
        {summary.remaining > 0 && <p className="summary-unfinished">{number(summary.remaining)} واژه با تمرین ناتمام برای ادامه باقی مانده؛ انجام‌شده حساب نشده‌اند.</p>}
        <DetailSheet title="دربارهٔ نتیجهٔ جلسه"><p>پاسخ‌های درست ممکن است با کمک باشند؛ تعداد پاسخ درست به‌تنهایی تسلط را نشان نمی‌دهد. فاصلهٔ مرور با یادآوری مستقل در روزهای جدا بیشتر می‌شود. این گزیده، پایان همهٔ واژگان اصل این درس نیست.</p><p>مرور معکوس، ارزیابی شخصیِ فارسی به ایتالیایی است و امتیازش جدا از تمرین نوشتن ذخیره می‌شود.</p></DetailSheet><div className="summary-actions"><button className="primary-button" type="button" disabled={disabled} onClick={() => void start()}>ادامهٔ یادگیری<Icon name="arrow" /></button><button className="secondary-button" type="button" onClick={() => setPage('home')}>بازگشت به خانه</button></div>
      </section>}
      {effectivePage === 'words' && <section className="words-page">
        <PronunciationStatus />
        <div className="page-intro"><div><span className="eyebrow">واژه‌نامهٔ کوچک تو</span><h1>واژه‌های {lessonLabel(activeLesson)}<span className="orange-dot">.</span></h1><p>{number(total)} مدخل از گزیدهٔ موجود؛ وضعیت‌ها براساس پیشرفت واقعی تو هستند.</p></div><span className="level-pill" lang="it" dir="ltr">A1</span></div>
        <p className="stabilization-note">«تثبیت‌شده» یعنی دست‌کم سه مرور مستقلِ موعدرسیده در روزهای جدا، بدون خطا یا کمک در میان آن‌ها؛ برای اسمِ دارای آرتیکل معلوم، پاسخ آرتیکلِ بدون کمک هم لازم است. مرور بلندمدت همچنان ادامه دارد.</p>
        <label className="word-search"><span className="sr-only">جست‌وجوی واژه یا معنی</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="واژه یا معنی‌اش را جست‌وجو کن…" /></label>
        <div className="word-filters" aria-label="فیلتر وضعیت">{[{ id: 'all', label: 'همه' }, { id: 'new', label: statusLabels.new }, { id: 'learning', label: statusLabels.learning }, { id: 'due', label: statusLabels.due }, { id: 'stabilized', label: statusLabels.stabilized }].map(item => <button type="button" key={item.id} className={filter === item.id ? 'active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{number(item.id === 'all' ? total : activeEntries.filter(entry => statuses[entry.entryId] === item.id).length)}</span></button>)}</div>
        <LessonWordList entries={selectedWords} props={props} />
        {!selectedWords.length && <div className="empty-state"><Icon name="book" /><h2>واژه‌ای با این جست‌وجو پیدا نشد.</h2><button className="text-button" type="button" onClick={() => { setSearch(''); setFilter('all') }}>نمایش همهٔ واژه‌ها</button></div>}
      </section>}
      {effectivePage === 'about' && <section className="about-page"><span className="eyebrow">شفاف، ساده، روی همین دستگاه</span><h1>پشتِ این واژه‌ها<span className="orange-dot">.</span></h1><article className="about-card"><span className="about-icon"><Icon name="book" /></span><div><h2>یک گزیدهٔ کوچک برای شروع</h2><p>این بسته شامل {number(total)} مدخل از {lessonLabel(activeLesson)} <bdi lang="it" dir="ltr">{activeLesson.titleIt}</bdi> است. معنی، آرتیکل و ارجاعات با فایل گزیده تطبیق داده شده‌اند.</p><p>{activeProvenance.noteFa}</p><p>نمونهٔ نقل‌شده از کتاب و مثال‌های تألیفی با برچسب جدا نمایش داده می‌شوند. ترجمه‌های فارسی تألیفی‌اند؛ ارجاع هر واژه در کارت و فهرست واژه‌ها در دسترس است.</p><span className="source-file" dir="ltr">{activeProvenance.file}</span></div></article><article className="about-card"><span className="about-icon peach"><Icon name="clock" /></span><div><h2>یادگیری با فاصله</h2><p>نخستین یادآوری موفق، مرور را برای یک روز بعد برنامه‌ریزی می‌کند. با مرورهای موفقِ موعدرسیده در روزهای جدا، فاصله‌ها به ۳، ۷، ۱۴ و ۳۰ روز می‌رسند.</p><p>چند جواب درست در یک روز، چند پله را جلو نمی‌برد. کارت و بازی جای یادآوری مستقل را نمی‌گیرند. پاسخ غلط پس از چند سؤال دیگر دوباره تمرین می‌شود؛ اگر تمرین کافی نماند، برای جلسهٔ بعد محفوظ است.</p></div></article><article className="about-card"><span className="about-icon yellow"><Icon name="leaf" /></span><div><h2>پیشرفتت روی همین مرورگر</h2><p>پاسخ‌ها، موعد مرور و محل ادامهٔ جلسه در حافظهٔ محلی مرورگر این دستگاه ذخیره می‌شوند. حساب کاربری و همگام‌سازی ابری وجود ندارد.</p><p>تازه‌سازی و بستن عادی برنامه پیشرفت را حفظ می‌کنند. پاک‌کردن دادهٔ سایت یا حذف داده‌ها توسط مرورگر می‌تواند پیشرفت را پاک کند؛ پشتیبان خودکار وجود ندارد.</p><p>{offlineStatus === 'ready' ? 'پوسته و بستهٔ این نسخه بررسی شده‌اند و برای مطالعهٔ آفلاین آماده‌اند.' : 'آمادگی آفلاین هنوز تأیید نشده است؛ پس از آماده‌شدن، نشان بالای صفحه تغییر می‌کند.'}</p></div></article><article className="about-card"><span className="about-icon"><Icon name="spark" /></span><div><h2>معنی، نوشتن و آرتیکل جدا سنجیده می‌شوند</h2><p>شناخت معنی و اتصال جفت‌ها یک مهارت‌اند؛ جای خالی و نوشتن واژه مهارت نوشتن را تمرین می‌دهند. آرتیکل فقط برای اسم مناسب مطرح می‌شود. شمار پاسخ درست، غلط، پاسخ با کمک و پاسخ درستِ بدون کمک را در جزئیات هر واژه می‌بینی.</p><p>تثبیت در این برنامه یک وضعیت عملیاتی است: دست‌کم سه مرور مستقلِ موعدرسیده در روزهای جدا، بدون خطا یا کمک میانی؛ برای اسمِ دارای آرتیکل معلوم، دست‌کم یک پاسخ آرتیکلِ بدون کمک هم لازم است. بازی یا چند جواب درست در یک روز این وضعیت را نمی‌سازد.</p><p>هدف روزانه حدود {number(state.settings.targetActiveMs / 60_000)} دقیقه مطالعهٔ فعال است. فقط زمان حضور در جلسهٔ فعال شمرده می‌شود؛ صفحهٔ پنهان، توقف، واژه‌نامه و زمان بسته‌بودن برنامه به آن اضافه نمی‌شوند. رسیدن به هدف، پیشنهاد پایان است و ادامه‌دادن مجاز می‌ماند.</p></div></article></section>}
    </main>
    <footer className="app-footer"><span lang="it" dir="ltr">Piccoli passi. Nuove parole.</span><span>واژه‌های کوچک، قدم‌های ماندگار.</span></footer>
    {effectivePage !== 'session' && <nav className="mobile-nav" aria-label="ناوبری اصلی موبایل">{navigation.map(item => <button type="button" key={item.page} className={effectivePage === item.page ? 'active' : ''} aria-current={effectivePage === item.page ? 'page' : undefined} onClick={() => void navigate(item.page)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav>}
  </div>
}
