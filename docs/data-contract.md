# قرارداد داده و ذخیرهٔ نسخهٔ۳

منبع دقیق typeها [contracts/index.ts](../src/contracts/index.ts) و قراردادهای منجمد قدیمی [legacy-v1.ts](../src/contracts/legacy-v1.ts) و [legacy-v2.ts](../src/contracts/legacy-v2.ts) هستند. schema=3، policy=learning-policy-v2، normalization=answer-normalization-v2 و content=course-a1-lessons-01-04-v1 مستقل‌اند. شناسه‌های همان۲۰ مدخل ثابت‌اند و۸۴ مدخل درس چهارم شناسهٔ جدید مستقل دارند.

## بخش‌های درس و ادامهٔ مستقل

ContentBundle فهرست lessons دارد؛ lesson پیش‌فرض برای سازگاری بسته‌های تک‌درس حفظ شده است. AppState یک progress/attempts/dailyActivity مشترک، activeLessonId و savedSessions دارد. Session.lessonId مالک درس را مشخص می‌کند. select-lesson جلسهٔ فعلی را paused و بایگانی، و جلسهٔ درس مقصد را بازیابی می‌کند؛ متن، صف و بازخورد از بین نمی‌روند. session فعال در savedSessions دوباره ذخیره نمی‌شود. واژه‌های جدید، مرور، بازی و آمار هر بخش متعلق به همان درس‌اند؛ todayActiveMs مجموع فعالیت روز بین درس‌هاست.

## محتوا

Entry علاوه بر معنی/نقش/منابع/مثال authored و cloze، فیلد writing با promptFa، cueFa، acceptedAnswers صریح و caseSensitive دارد. پاسخ اول صورت معیار است. جایگزین‌ها از فهرست بازبینی‌شده می‌آیند. choose-article فقط برای nounData دارای آرتیکل معلوم فعال است. هیچ مثال به کتاب نسبت داده نشده و coverage=partial باقی است.

## پیشرفت و جلسه

AppState شامل progress، attempts، session، savedSessions، activeLessonId، assistanceEvents، dailyActivity و activityEventIds است؛ settings منطقهٔ مطالعه، سقف۵ و targetActiveMs=1200000 را دارد. محتوا در snapshot کپی نمی‌شود.

- EntryProgress موعد، پله، تاریخ‌های مرور مستقل و pendingError با reason و شمارندهٔ سه پاسخ دیگر دارد. skills شامل meaning، writing و articleِ قابل اعمال است؛ هر مهارت correct/wrong/assisted/unassistedCorrect/lastAttemptAt دارد.
- Attempt پاسخ خام، نتیجه، independent، assisted، normalizationVersion، سؤال/جلسه/مدخل و زمان/روز را حفظ می‌کند. قدیمی‌ها normalization-v1 می‌مانند و دوباره نمره‌دهی نمی‌شوند.
- AssistanceEvent با eventId پایدار، سؤال/جلسه/مدخل و kind جدا ثبت می‌شود؛ کمک غلطِ ساختگی نیست.
- Session صف/ترتیب تصادفی، cursor، draft، feedback، activeMs و تأیید هدف با targetAcknowledged/targetAcknowledgedDate دارد؛ تأیید ادامه فقط برای همان روز مطالعه است. فلشکارت، معنی، جای خالی، نوشتن، آرتیکل و اتصال با قابلیت داده انتخاب می‌شوند. وضعیت assisted سؤال ماندگار است.
- فعالیت با eventId، sessionId، from/to و elapsedMs یکتا commit می‌شود. ساعت monotonic فقط زمان فعال و قابل مشاهده را نمونه‌برداری می‌کند؛ موتور با ورودی زمان و منطقه، سهم روزها را محاسبه می‌کند. زمان بسته‌بودن از timestamp قدیمی استنتاج نمی‌شود.

## مالکیت و commit

APIهای محتوا، موتور و ذخیرهٔ مرحلهٔ۱ حفظ می‌شوند. موتور خالص و بدون DOM/شبکه/IndexedDB است. ui فقط command و visibility ارائه می‌کند. controller زمان و صف commit/retry را مدیریت می‌کند. تمام پاسخ و موعد و cursor/feedback در یک snapshot transaction IndexedDB ثبت می‌شوند. revision و expectedRevision مانع بازنویسی state کهنه‌اند؛ eventId/attemptId تکراری اثر دوباره ندارد.

قفل Web Locks تا پایان صف writer حفظ می‌شود؛ shutdown کار تازه را رد و صف پذیرفته‌شده را جمع می‌کند. probe اولیه ifAvailable و retry صریح signalدار و صف‌شونده است؛ این دو option با هم استفاده نمی‌شوند. نتیجهٔ دیررس startup لغوشده writer نمی‌سازد. pagehide/cleanup تکراری idempotent است.

## مهاجرت و ناسازگاری

validator نسخهٔ۱ در [storage/legacy-v1.ts](../src/storage/legacy-v1.ts) منجمد است. loadState فقط نسخهٔ۱ شناخته‌شده را پس از validation و نگاشت هویت به۲ ارتقا می‌دهد: پاسخ‌ها، شناسه‌ها، موعد/پله/تاریخ‌ها، صف/cursor/draft/feedback حفظ؛ فقط فیلدهای جدید افزوده و مهارت‌ها از تاریخچهٔ موجود استخراج می‌شوند. زمان قدیمی حدس زده نمی‌شود. migration با revision+1 در همان transaction نوشته می‌شود؛ شکست، دادهٔ قدیمی را دست‌نخورده باقی می‌گذارد. کلید پشتیبان یا قابلیت export/import اضافه نمی‌شود.

دادهٔ نسخهٔ۲ شناخته‌شده با reader منجمد۲ بررسی و سپس به۳ تبدیل می‌شود؛ session قدیمی به درس اول با شناسهٔ اصلی a1-lesson-01 تعلق می‌گیرد. همهٔ مهارت‌ها، پاسخ‌ها، فعالیت‌ها و وضعیت‌های قبلی حفظ می‌شوند. نسخهٔ۳ تک‌درسِ شناخته‌شده نیز می‌تواند به فهرست جدید ارتقا یابد. ارتقا در همان transaction ذخیره می‌شود و شکست، snapshot قبلی را حفظ می‌کند.

نسخهٔ۳ در load بعدی دوباره مهاجرت نمی‌کند. دادهٔ خراب یا ناشناخته حفظ و صریحاً رد می‌شود. abort پیش از commit مسیر برگشت است؛ reader قدیمی پس از ثبت۳ باید fail-closed باشد، نه reset یا نوشتن دادهٔ قدیمی. بازگشت اجرایی به reader قدیمی بدون تبدیل معکوس پشتیبانی نمی‌شود.

cache مستقل از پیشرفت است. آمادگی cache باید با شناسهٔ buildِ همین کد تطبیق یابد. داده به origin و پروفایل همین مرورگر تعلق دارد و حذف دادهٔ سایت/eviction می‌تواند آن را حذف کند.

## سازگاری بازطراحی جلسه
در بازطراحی ۲۰۲۶-۱۰-۳۱ schema۳، شناسه‌های task و قرارداد feedback/next عوض نشده‌اند. صف جلسه‌های تازه همهٔ کارت‌های جدید را پیش از تمرین همان دسته قرار می‌دهد؛ صف جلسهٔ ذخیره‌شده بازچینی نمی‌شود. رابط اتصال با فرمان next پس از بازخورد کوتاه ادامه می‌دهد؛ پاسخ و feedback قبل از ادامه ذخیره می‌شوند.

## مرحلهٔ مرور معکوس
درخواست جدید و قرارداد نسخه۴، رفتار موبایل و پذیرش در [برنامهٔ مرور معکوس](reverse-review-plan.md) تعریف شده و در موارد تعارض بر سابقهٔ بالا اولویت دارد.

## مرحلهٔ فعال مثال‌ها
دامنه، قرارداد دادهٔ جانبی و پذیرش در [برنامهٔ مثال‌های تکمیلی](examples-plan.md) تعریف شده‌اند.

## افزودن درس‌های ۵ تا ۸ به کاتالوگ

قرارداد جاری ذخیره همچنان schema۴ است؛ بخش‌های بالاتر سابقهٔ نسخه۳ هستند. درس‌های فعال ۱/۴/۵/۶/۷/۸ با ۲۰/۸۴/۷۶/۸۰/۵۵/۵۲ مدخل از یک registry می‌آیند. افزودن درس‌های ۵ تا ۸، `contentVersion: course-a1-lessons-01-04-v1` را تغییر نمی‌دهد: validatorهای نسخه۲/۳ که validator فعلی۴ نیز از آن‌ها استفاده می‌کند، برابری دقیق این رشته را بررسی می‌کنند. این رشته شناسهٔ سازگاری است؛ build hash مستقل، cache محتوای تازه را تعیین می‌کند. ذخیرهٔ۴ قبلی بدون migration، تغییر revision یا بازنویسی صف خوانده می‌شود؛ خوانش نسخه‌های۱/۲/۳ نیز حفظ است. [fixture و معیارهای پذیرش](lesson-five-acceptance.md).
