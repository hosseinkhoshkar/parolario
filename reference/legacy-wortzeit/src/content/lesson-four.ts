import type { ContentBundle, Entry, SourceRef } from '../contracts/index.ts'
import { lessonFourSourceRows } from './lesson-four-source.ts'

const lessonId = 'lesson-04'
type Pedagogy = readonly [partOfSpeech: Entry['partOfSpeech'], exampleDe: string, exampleFa: string, cueFa: string]

// These sentences are authored learning examples, never quotations from the books.
// Keys are the stable IDs in the checked-in source snapshot, not editable headwords.
const pedagogy: Record<string, Pedagogy> = {
  'a1-l04-001': ['adjective', 'Die beiden Bilder sind ähnlich.', 'این دو تصویر شبیه هم هستند.', 'صفتِ بیان شباهت را به شکل پایه بنویس.'],
  'a1-l04-002': ['adverb', 'Ich wohne allein.', 'من تنها زندگی می‌کنم.', 'واژه‌ای برای انجام کار بدون همراه؛ شکل آموخته‌شدهٔ این درس.'],
  'a1-l04-003': ['noun', 'Das Alter steht im Formular.', 'سن در فرم نوشته شده است.', 'اسم خنثی برای سن؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-004': ['noun', 'Die Anmeldung ist kostenlos.', 'ثبت‌نام رایگان است.', 'اسم مؤنث برای ثبت‌نام؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-005': ['adjective', 'Die Familie ist arm.', 'این خانواده فقیر است.', 'صفتِ نداشتن پول کافی؛ شکل پایه با حرف کوچک.'],
  'a1-l04-006': ['noun', 'Mein Arm tut weh.', 'بازوی من درد می‌کند.', 'اسم مذکر برای عضو بدن از شانه تا دست؛ حالت پایه، بدون آرتیکل و با حرف بزرگ.'],
  'a1-l04-007': ['adverb', 'Der Bus kommt bald.', 'اتوبوس به‌زودی می‌آید.', 'قیدِ زمان برای اتفاقی در آیندهٔ نزدیک را بنویس.'],
  'a1-l04-008': ['verb', 'Wir bekommen heute Besuch.', 'امروز مهمان داریم.', 'فعلِ دریافت‌کردن؛ حالت مصدر را بنویس.'],
  'a1-l04-009': ['noun', 'Das Buch liegt auf dem Tisch.', 'کتاب روی میز است.', 'اسم خنثی برای کتاب؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-010': ['verb', 'Wir dürfen hier spielen.', 'ما اجازه داریم اینجا بازی کنیم.', 'فعل وجهی برای اجازه‌داشتن؛ حالت مصدر را بنویس.'],
  'a1-l04-011': ['adverb', 'Was möchtest du eigentlich machen?', 'راستی، در واقع می‌خواهی چه کار کنی؟', 'قید آموخته‌شده با معنی «در واقع؛ اصولاً» را بنویس.'],
  'a1-l04-012': ['pronoun', 'Hier warten einige auf den Bus.', 'اینجا چند نفر منتظر اتوبوس هستند.', 'صورت جمعِ آموخته‌شده برای «چند نفر / برخی» را بنویس.'],
  'a1-l04-013': ['verb', 'Meine Eltern erlauben das.', 'پدر و مادرم اجازهٔ این کار را می‌دهند.', 'فعلِ اجازه‌دادن به دیگری؛ حالت مصدر را بنویس.'],
  'a1-l04-014': ['noun', 'Der Erwachsene hilft dem Kind.', 'آن مرد بزرگسال به کودک کمک می‌کند.', 'اسمِ صفت‌شدهٔ مذکر برای بزرگسال؛ همان صورتِ همراه با حرف تعریف معین در درس، بدون آرتیکل.'],
  'a1-l04-015': ['noun', 'Diese Fähigkeit ist wichtig.', 'این توانایی مهم است.', 'اسم مؤنث برای توانایی؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-016': ['noun', 'Mein Fahrrad ist neu.', 'دوچرخهٔ من نو است.', 'اسم خنثی برای وسیلهٔ دوچرخِ پدالی؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-017': ['noun', 'Die Fahrt dauert eine Stunde.', 'این سفر با وسیلهٔ نقلیه یک ساعت طول می‌کشد.', 'اسم مؤنث برای سفر با وسیلهٔ نقلیه؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-018': ['verb', 'Wir feiern heute meinen Geburtstag.', 'امروز تولد مرا جشن می‌گیریم.', 'فعلِ جشن‌گرفتن؛ حالت مصدر را بنویس.'],
  'a1-l04-019': ['noun', 'Das Fenster ist offen.', 'پنجره باز است.', 'اسم خنثی برای پنجره؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-020': ['verb', 'Wir möchten heute fernsehen.', 'ما می‌خواهیم امروز تلویزیون تماشا کنیم.', 'فعلِ تلویزیون‌تماشاکردن؛ مصدر کاملِ یک‌واژه‌ای را بنویس.'],
  'a1-l04-021': ['adjective', 'Nach dem Sport bin ich fit.', 'بعد از ورزش سرحال هستم.', 'صفت کوتاه برای سرحال و آمادهٔ جسمانی بودن را بنویس.'],
  'a1-l04-022': ['noun', 'Das Gefühl ist schön.', 'این احساس زیباست.', 'اسم خنثی برای احساس؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-023': ['adverb', 'Wir waren gestern im Kino.', 'ما دیروز در سینما بودیم.', 'قیدِ روز قبل از امروز را بنویس.'],
  'a1-l04-024': ['adjective', 'Obst und Gemüse sind gesund.', 'میوه و سبزیجات سالم هستند.', 'صفتِ سالم و مفید برای سلامتی؛ شکل پایه را بنویس.'],
  'a1-l04-025': ['adjective', 'Mit meinen Freunden bin ich glücklich.', 'کنار دوستانم خوشحال هستم.', 'صفتِ خوشحال و خوشبخت؛ شکل پایهٔ آموخته‌شده در درس.'],
  'a1-l04-026': ['noun', 'Das ist der Grund für meine Frage.', 'این دلیلِ سؤال من است.', 'اسم مذکر برای دلیلِ یک موضوع؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-027': ['noun', 'Meine Heimat ist weit weg.', 'زادبوم من دور است.', 'اسم مؤنث برای زادبوم یا وطن؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-028': ['noun', 'Danke für deine Hilfe!', 'برای کمکت ممنونم!', 'اسم مؤنث برای کمک؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-029': ['noun', 'Mein Interesse an Musik ist groß.', 'علاقهٔ من به موسیقی زیاد است.', 'اسم خنثی برای علاقه به یک موضوع؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-030': ['other', 'Wir lernen Italienisch.', 'ما زبان ایتالیایی یاد می‌گیریم.', 'نام زبان کشور ایتالیا را با حرف بزرگ و بدون آرتیکل بنویس.'],
  'a1-l04-031': ['adverb', 'Der Kurs findet jährlich statt.', 'این دوره سالانه برگزار می‌شود.', 'قیدِ تکرار یک‌بار در سال را بنویس.'],
  'a1-l04-032': ['phrase', 'Wir lernen jeden Tag Deutsch.', 'ما هر روز آلمانی یاد می‌گیریم.', 'عبارت دوواژه‌ای برای تکرار در تک‌تک روزها را کامل بنویس.'],
  'a1-l04-033': ['pronoun', 'Hier darf jeder mitmachen.', 'اینجا هر کسی اجازه دارد شرکت کند.', 'ضمیرِ آموخته‌شده برای «هر کس» در صورت مذکر را بنویس.'],
  'a1-l04-034': ['noun', 'Das Klavier steht im Wohnzimmer.', 'پیانو در اتاق نشیمن است.', 'اسم خنثی برای سازِ دارای کلیدهای سیاه و سفید؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-035': ['verb', 'Wir laufen jeden Morgen im Park.', 'ما هر صبح در پارک می‌دویم.', 'فعلِ دویدن یا راه‌رفتنِ آموخته‌شده در این درس؛ حالت مصدر.'],
  'a1-l04-036': ['noun', 'Die Lösung steht im Buch.', 'پاسخ تمرین در کتاب است.', 'اسم مؤنث برای راه‌حل یا پاسخ تمرین؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-037': ['noun', 'Eine Minute hat sechzig Sekunden.', 'یک دقیقه شصت ثانیه دارد.', 'اسم مؤنث برای واحد زمانِ شصت‌ثانیه‌ای؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-038': ['verb', 'Wir mögen Musik.', 'ما موسیقی را دوست داریم.', 'فعل وجهی برای دوست‌داشتن؛ همان مصدر آموخته‌شده در این درس.'],
  'a1-l04-039': ['noun', 'Das ist eine gute Möglichkeit.', 'این امکان خوبی است.', 'اسم مؤنث برای امکانِ انجام یک کار؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-040': ['adverb', 'Wir bezahlen den Beitrag monatlich.', 'ما حق عضویت را ماهانه پرداخت می‌کنیم.', 'قیدِ تکرار یک‌بار در ماه را بنویس.'],
  'a1-l04-041': ['adverb', 'Du kannst natürlich mitkommen.', 'البته که می‌توانی همراه ما بیایی.', 'قید آموخته‌شده برای «البته؛ طبیعتاً» را بنویس.'],
  'a1-l04-042': ['pronoun', 'Heute fehlt nichts.', 'امروز هیچ‌چیزی کم نیست.', 'واژهٔ منفی برای «هیچ‌چیز» را بنویس.'],
  'a1-l04-043': ['adjective', 'Die Tür ist offen.', 'در باز است.', 'صفتِ بازبودن در یا پنجره؛ شکل پایه را بنویس.'],
  'a1-l04-044': ['verb', 'Das kann passieren.', 'ممکن است این اتفاق بیفتد.', 'فعلِ اتفاق‌افتادن؛ حالت مصدر را بنویس.'],
  'a1-l04-045': ['noun', 'Das ist meine Pflicht.', 'این وظیفهٔ من است.', 'اسم مؤنث برای وظیفه یا تکلیف الزامی؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-046': ['noun', 'Dieser Platz ist frei.', 'این جا خالی است.', 'اسم مذکر برای جا یا میدان؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-047': ['adverb', 'Es regnet plötzlich.', 'ناگهان باران می‌بارد.', 'قیدِ رخ‌دادن ناگهانی یک اتفاق را بنویس.'],
  'a1-l04-048': ['noun', 'Die Prüfung beginnt um neun Uhr.', 'آزمون ساعت نه شروع می‌شود.', 'اسم مؤنثِ آموخته‌شده برای آزمون؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-049': ['verb', 'Wir putzen heute die Küche.', 'ما امروز آشپزخانه را تمیز می‌کنیم.', 'فعلِ تمیزکردن؛ حالت مصدر را بنویس.'],
  'a1-l04-050': ['phrase', 'Wir möchten am Sonntag Rad fahren.', 'ما می‌خواهیم یکشنبه دوچرخه‌سواری کنیم.', 'عبارت دوواژه‌ایِ این درس برای دوچرخه‌سواری؛ با نام کوتاهِ سه‌حرفیِ دوچرخه و فعل در حالت مصدر.'],
  'a1-l04-051': ['adverb', 'Wir trainieren regelmäßig.', 'ما به‌طور مرتب تمرین می‌کنیم.', 'واژهٔ آموخته‌شده برای انجام کاری به‌طور منظم را بنویس.'],
  'a1-l04-052': ['verb', 'Wir reisen im Sommer nach Italien.', 'ما تابستان به ایتالیا سفر می‌کنیم.', 'فعلِ سفرکردن؛ حالت مصدر را بنویس.'],
  'a1-l04-053': ['noun', 'Der Rock ist blau.', 'دامن آبی است.', 'اسم مذکر برای پوشاکِ دامن؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-054': ['adjective', 'Das Kleid ist rosa.', 'پیراهن زنانه صورتی است.', 'نام رنگِ صورتی را به شکل آموخته‌شده در درس بنویس.'],
  'a1-l04-055': ['noun', 'Mein Rücken tut weh.', 'کمر من درد می‌کند.', 'اسم مذکر برای کمر یا پشت بدن؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-056': ['verb', 'Wir schaffen die Aufgabe zusammen.', 'ما با هم از عهدهٔ این تکلیف برمی‌آییم.', 'فعلِ از عهدهٔ کاری برآمدن در این درس؛ حالت مصدر.'],
  'a1-l04-057': ['verb', 'Wir schlafen heute im Hotel.', 'ما امشب در هتل می‌خوابیم.', 'فعلِ خوابیدن؛ حالت مصدر را بنویس.'],
  'a1-l04-058': ['noun', 'Mein Schuh ist nass.', 'کفش من خیس است.', 'اسم مذکر برای یک کفش؛ حالت مفرد و پایه، بدون آرتیکل.'],
  'a1-l04-059': ['noun', 'Der Schüler liest ein Buch.', 'آن دانش‌آموز پسر یک کتاب می‌خواند.', 'اسم مذکر برای دانش‌آموز پسر؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-060': ['noun', 'Die Schülerin spielt Klavier.', 'آن دانش‌آموز دختر پیانو می‌نوازد.', 'اسم مؤنث برای دانش‌آموز دختر؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-061': ['verb', 'Wir schwimmen gern im See.', 'ما با علاقه در دریاچه شنا می‌کنیم.', 'فعلِ شناکردن؛ حالت مصدر را بنویس.'],
  'a1-l04-062': ['noun', 'Das Sofa ist bequem.', 'مبل راحتی راحت است.', 'اسم خنثی برای مبل راحتی؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-063': ['verb', 'Wir stehen vor dem Kino.', 'ما جلوی سینما ایستاده‌ایم.', 'فعلِ ایستاده‌بودن؛ حالت مصدر را بنویس.'],
  'a1-l04-064': ['noun', 'Diese Strecke ist drei Kilometer lang.', 'این مسیر سه کیلومتر طول دارد.', 'اسم مؤنث برای مسیر یا مسافت؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-065': ['verb', 'Wir studieren in Berlin.', 'ما در برلین در دانشگاه تحصیل می‌کنیم.', 'فعلِ تحصیل دانشگاهی؛ حالت مصدر را بنویس.'],
  'a1-l04-066': ['noun', 'Eine Stunde hat sechzig Minuten.', 'یک ساعت شصت دقیقه دارد.', 'اسم مؤنث برای مدت شصت دقیقه؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-067': ['verb', 'Wir suchen einen Tanzkurs.', 'ما دنبال یک کلاس رقص می‌گردیم.', 'فعلِ جست‌وجوکردن؛ حالت مصدر را بنویس.'],
  'a1-l04-068': ['verb', 'Wir tanzen gern zusammen.', 'ما با علاقه با هم می‌رقصیم.', 'فعلِ رقصیدن؛ حالت مصدر را بنویس.'],
  'a1-l04-069': ['noun', 'Der Test dauert zehn Minuten.', 'این امتحان ده دقیقه طول می‌کشد.', 'اسم مذکرِ کوتاه برای امتحان یا آزمایش؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-070': ['noun', 'Das Theater ist heute offen.', 'تئاتر امروز باز است.', 'اسم خنثی برای تئاتر؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-071': ['other', 'Der Ball liegt unter dem Tisch.', 'توپ زیر میز است.', 'حرف اضافهٔ مکان برای زیرِ چیزی بودن را بنویس.'],
  'a1-l04-072': ['adjective', 'Mit dem Ergebnis bin ich unzufrieden.', 'من از نتیجه ناراضی هستم.', 'صفتِ ناراضی‌بودن را به شکل پایه بنویس.'],
  'a1-l04-073': ['verb', 'Meine Eltern verbieten das.', 'پدر و مادرم این کار را ممنوع می‌کنند.', 'فعلِ ممنوع‌کردن؛ حالت مصدر را بنویس.'],
  'a1-l04-074': ['verb', 'Wir verwenden ein Wörterbuch.', 'ما از یک فرهنگ لغت استفاده می‌کنیم.', 'فعلِ به‌کاربردنِ آموخته‌شده در این درس؛ حالت مصدر.'],
  'a1-l04-075': ['adverb', 'Ich verstehe nicht, warum er lacht.', 'من نمی‌فهمم چرا او می‌خندد.', 'واژهٔ پرسش از دلیلِ یک کار را بنویس.'],
  'a1-l04-076': ['adjective', 'Die Wand ist weiß.', 'دیوار سفید است.', 'نام رنگ سفید؛ شکل پایه با حرف کوچک را بنویس.'],
  'a1-l04-077': ['adverb', 'Sag mir bitte, wohin du gehst.', 'لطفاً به من بگو به کجا می‌روی.', 'واژهٔ پرسش از مقصد یا جهت حرکت را بنویس.'],
  'a1-l04-078': ['verb', 'Wir wollen heute Fußball spielen.', 'ما می‌خواهیم امروز فوتبال بازی کنیم.', 'فعل وجهی برای خواستن؛ حالت مصدر را بنویس.'],
  'a1-l04-079': ['noun', 'Mein Wunsch ist eine Reise.', 'آرزوی من یک سفر است.', 'اسم مذکر برای آرزو یا خواسته؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-080': ['verb', 'Wir wünschen dir viel Erfolg.', 'ما برایت آرزوی موفقیت زیاد داریم.', 'فعلِ آرزوکردن برای کسی؛ حالت مصدر را بنویس.'],
  'a1-l04-081': ['noun', 'Die Zeitung liegt auf dem Tisch.', 'روزنامه روی میز است.', 'اسم مؤنث برای روزنامه؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-082': ['noun', 'Mein Ziel ist ein Deutschkurs in Berlin.', 'هدف من یک دورهٔ آلمانی در برلین است.', 'اسم خنثی برای هدف یا مقصد؛ حالت پایه و بدون آرتیکل.'],
  'a1-l04-083': ['adjective', 'Mit dem Kurs bin ich zufrieden.', 'من از این دوره راضی هستم.', 'صفتِ راضی‌بودن را به شکل پایه بنویس.'],
  'a1-l04-084': ['phrase', 'Wir spielen zum Beispiel Schach.', 'ما برای مثال شطرنج بازی می‌کنیم.', 'عبارت دوواژه‌ایِ آوردن مثال را کامل بنویس.'],
}

/** Explicitly reviewed alternatives for German keyboard input. */
const keyboardAlternatives: Record<string, string[]> = {
  ähnlich: ['aehnlich'], dürfen: ['duerfen'], Fähigkeit: ['Faehigkeit'], Gefühl: ['Gefuehl'],
  glücklich: ['gluecklich'], jährlich: ['jaehrlich'], Lösung: ['Loesung'], mögen: ['moegen'],
  Möglichkeit: ['Moeglichkeit'], natürlich: ['natuerlich'], plötzlich: ['ploetzlich'], Prüfung: ['Pruefung'],
  regelmäßig: ['regelmaessig', 'regelmässig'], Rücken: ['Ruecken'], Schüler: ['Schueler'],
  Schülerin: ['Schuelerin'], weiß: ['weiss'], wünschen: ['wuenschen'],
}

function sourceIdFor(locator: string): string {
  if (locator.startsWith('کتاب درسی:')) return 'source-textbook'
  if (locator.startsWith('کتاب تمرین:')) return 'source-workbook'
  if (locator.startsWith('متن گفت‌وگوهای صوتی:')) return 'source-audio-transcript'
  throw new Error(`Unknown lesson-four source: ${locator}`)
}

const sourceRefs: SourceRef[] = lessonFourSourceRows.flatMap(row => row.refs.map((locator, index) => ({
  sourceRefId: `${row.entryId}-ref-${index + 1}`, sourceId: sourceIdFor(locator), lessonId, locator,
})))

const entries: Entry[] = lessonFourSourceRows.map((row, index) => {
  const [partOfSpeech, exampleDe, exampleFa, cueFa] = pedagogy[row.entryId]
  const nounMatch = row.headword.match(/^(der|die|das) (.+)$/)
  const article = nounMatch?.[1] as 'der' | 'die' | 'das' | undefined
  const lemma = nounMatch?.[2] ?? row.headword
  const answers = [lemma, ...(keyboardAlternatives[lemma] ?? [])]
  const sourceRefIds = sourceRefs.filter(ref => ref.sourceRefId.startsWith(`${row.entryId}-ref-`)).map(ref => ref.sourceRefId)
  if (!exampleDe.includes(lemma)) throw new Error(`Example must contain canonical headword: ${row.entryId}`)
  // Near-synonymous exam nouns are not distractors for one another.
  const excludedPair = lemma === 'Prüfung' ? 'der Test' : lemma === 'Test' ? 'die Prüfung' : null
  const sameRole = lessonFourSourceRows.filter(other => other.entryId !== row.entryId && other.headword !== excludedPair && pedagogy[other.entryId][0] === partOfSpeech)
  const otherRole = lessonFourSourceRows.filter(other => other.entryId !== row.entryId && other.headword !== excludedPair && pedagogy[other.entryId][0] !== partOfSpeech)
  const optionPool = sameRole.length >= 3 ? sameRole : [...sameRole, ...otherRole]
  const options = [0, 1, 2].map(offset => optionPool[(index + offset) % optionPool.length].entryId)
  return {
    entryId: row.entryId, introducedInLessonId: lessonId, introductionOrder: index + 1,
    lemma, partOfSpeech, meaningFa: row.meaningFa,
    ...(article ? { nounData: { article, plural: null, pluralNote: 'جمع در فایل واژگان ارائه نشده است؛ صورت جمع حدس زده نشده است.' } } : {}),
    sourceRefIds, occurrences: [{ lessonId, sourceRefIds: [...sourceRefIds] }],
    examples: [{ exampleId: `${row.entryId}-example`, de: exampleDe, fa: exampleFa, origin: 'authored' }],
    cloze: { sentence: exampleDe.replace(lemma, '___'), translationFa: exampleFa, acceptedAnswers: [...answers], exampleId: `${row.entryId}-example` },
    writing: { promptFa: row.meaningFa, cueFa, acceptedAnswers: [...answers], caseSensitive: lemma === 'arm' || lemma === 'Arm' },
    meaningOptionEntryIds: [row.entryId, ...options],
    enabledExercises: ['flashcard', 'choose-meaning', 'cloze', 'match', 'write-word', ...(article ? ['choose-article' as const] : [])],
    reviewStatus: 'excerpt-checked',
  }
})

export const lessonFourBundle: ContentBundle = {
  contentVersion: 'lesson-04-excerpt-v1',
  sources: [
    { sourceId: 'source-textbook', kind: 'textbook', title: 'DaF kompakt A1–B1 — کتاب درسی', edition: null },
    { sourceId: 'source-workbook', kind: 'workbook', title: 'DaF kompakt A1–B1 — کتاب تمرین', edition: null },
    { sourceId: 'source-audio-transcript', kind: 'audioTranscript', title: 'DaF kompakt A1–B1 — متن گفت‌وگوهای صوتی', edition: null },
  ],
  sourceRefs,
  lesson: { lessonId, titleDe: 'Spiel und Spaß', titleFa: 'بازی و سرگرمی', level: 'A1', coverage: 'partial', introducedEntryIds: entries.map(entry => entry.entryId) },
  entries,
  provenance: {
    file: 'reference/vocabulary/Lesson-04-A1.txt', reviewStatus: 'excerpt-checked',
    noteFa: 'هر ۸۴ مدخل فایل واژگان درس چهارم با معنی، آرتیکل و تمام ارجاع‌های درج‌شده حفظ شده‌اند. تطبیق این گزیده تأیید جامع اصل کتاب نیست. تمام مثال‌ها و جمله‌های تمرین تألیفی‌اند؛ جمع اسم‌ها و ویرایش کتاب در فایل مشخص نشده‌اند.',
  },
}
