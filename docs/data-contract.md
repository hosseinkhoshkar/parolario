# قرارداد دادهٔ مستقل ایتالیایی — schema۵

[نوع‌های اجرایی](../src/contracts/index.ts) مرجع دقیق‌اند. schema۵، policy=learning-policy-v2، normalization=italian-answer-normalization-v1 و content=nuovo-espresso-a1-it-v1 مستقل‌اند. این تغییر، مهاجرت دادهٔ آلمانی نیست. [نسخهٔ تاریخی قرارداد](../reference/legacy-wortzeit/docs/data-contract.md) برای سابقه حفظ شده است.

## محتوا

Lesson.titleIt و Example.it جای فیلدهای زبان قبلی را گرفته‌اند. lessonIdهای it-a1-lesson-01 تا it-a1-lesson-03 و شناسه‌های مدخل it-a1-l01-NNN تا it-a1-l03-NNN از شمارهٔ ثابت سطر فایل مرجع می‌آید؛ تغییر مرتب‌سازی نباید شناسه را عوض کند. sourceHeadword/sourceRow متن و شمارهٔ اصلی را حفظ می‌کنند. introductionOrder از صفحهٔ چاپی و رتبهٔ محل منبع می‌آید.

Entry نقش دستوری، معنی، occurrence و sourceRefIds واقعی دارد. Example.origin برابر quoted یا authored است؛ quoted دارای sourceRefId همان مدخل است. نمونهٔ اول عین گزیدهٔ کتاب، دو نمونهٔ بعد تألیفی‌اند. writing پاسخ معیارِ مدخل و cue فارسی دارد. cloze پاسخ‌های مستقل و cue جدا می‌تواند داشته باشد تا صورت صرف‌شده با مصدر اشتباه نشود؛ بازسازی پاسخ معیار باید دقیقاً مثال تألیفیِ اشاره‌شده را بسازد.

nounData شامل article nullable، gender مستقل nullable و number است. آرتیکل‌های مجاز il/lo/la/l'/i/gli/le؛ برای l' جنس باید مستقلاً معلوم باشد. فقط اسم با آرتیکل معلوم article-skill و choose-article می‌گیرد؛ اسم نامعلوم نیز مدخل معتبر است. plural نامعلوم null می‌ماند و توضیح دارد. نمونهٔ جمعی حدس زده نمی‌شود.

NFC، trim و یکسان‌کردن فاصله مجازند؛ حذف اکسان، stemming و صورت صرفیِ حدسی مجاز نیست. caseSensitive و acceptedAnswers صریح‌اند. نقل کتاب، معنی و locator در sync بازنویسی نمی‌شوند.

## پیشرفت و تراکنش

progress، attempts، skills، assistanceEvents، reverseProgress/reverseReviews، dailyActivity، session و savedSessions همان قرارداد رفتاری موجود را حفظ می‌کنند. زمان مطالعه و هدف بین درس‌ها مشترک است؛ session.lessonId مالک صف و draft است. select-lesson جلسهٔ فعلی را paused بایگانی و مقصد را بازیابی می‌کند.

پاسخ/تاریخچه/بازخورد/موعد/cursor در یک snapshot و یک تراکنش ثبت می‌شوند. expectedRevision مانع writer کهنه است؛ attemptId و eventId تکراری دوباره شمرده نمی‌شوند. validator شکل داده، شمارنده‌ها در برابر تاریخچه، مالکیت درس، آرتیکل، بازخورد و شواهد مرور معکوس را بررسی می‌کند.

IndexedDB=parolario-progress، object store=user-state، key=current، قفل parolario-single-writer. migrateState فقط schema و محتوای فعلی را اعتبارسنجی و clone می‌کند؛ هر نسخه/محتوای بیگانه بدون تغییر داده رد می‌شود. هیچ خوانندهٔ frozen آلمانی در مسیر اجرایی ذخیره وارد نمی‌شود.

## مثال‌های تکمیلی

فایل‌های reference/vocabulary/italian/Lesson-01-A1.txt تا Lesson-03-A1.txt منابع انسانی ثابت‌اند و sidecarهای هم‌نام در public/content/examples/italian دادهٔ تألیفی بازبینی‌شده‌اند. sync:examples تطبیق سطر/کلید/متن، جفت زبانی، تکرار و تعداد را بررسی می‌کند و تنها sourceهای اجراییِ جداگانهٔ هر درس و additional-examples.ts را قطعی می‌سازد. build hash برای تازگی cache مستقل از contentVersion است.

## افزودن درس دوم بدون تغییر schema

دادهٔ منبع هر درس مستقل تولید می‌شود: italian-source.json برای۱ و italian-source-02.json برای۲؛ pedagogy و sidecar نیز مستقل‌اند. build-italian-lesson.ts ساختار مشترک را می‌سازد. کلید سطر تنها در فضای همان درس معنا دارد.

meaningGroup اختیاری فقط metadata محتواست و در AppState ذخیره نمی‌شود؛ گزینه و اتصال با گروه مشترک ساخته نمی‌شود. نگهبان ذخیره نیز صفِ دارای معنی/گروه تکراری را رد می‌کند؛ صف معتبر قدیمی بازچینی نمی‌شود.

lesson-two-occurrences.json شامل existing entryId و refهای واقعی است. catalog به مدخل اصلی sourceRefIds و occurrence درس۲ می‌افزاید؛ معرفی، مثال‌ها، پاسخ‌ها و introductionOrder درس۱ همان‌اند. این refs به sourceRefs کاتالوگ اضافه می‌شوند، نه به فهرست معرفی درس۲.

ثابت‌ماندن schema۵ و nuovo-espresso-a1-it-v1، به‌همراه خواندن عین snapshot پیش از افزودن درس۲ و digestهای۸۵مدخل، معیار سازگاری است.

## افزودن درس سوم

italian-source-03.json و lesson-three-pedagogy.json و sidecar مستقل،۱۰۹مدخل به builder مشترک می‌دهند؛ هیچ تغییر schema/مهاجرت لازم نیست. lesson-three-occurrences.json پانزده هویت قبلی را فقط با occurrence/ref جدید وصل می‌کند. helper کاتالوگ شمارهٔ درس را برای شناسهٔ ref به‌کار می‌برد؛ refs تاریخی درس۲ عوض نمی‌شوند.

snapshot پیش از درس۳ در fixtures/pre-lesson-three-schema5.json با۳۵مدخل پیشرفت،۱۱۷پاسخ،۸مرورمعکوس، draft درس۲ و feedback درس۱ از موتور واقعی ساخته شده است؛ دادهٔ شخصی مرورگر نیست. تمام snapshot و digest هستهٔ۱۷۷مدخل قبلی باید بدون بازنویسی حفظ شوند. sourceRefIds/occurrences تنها بخش‌های افزایشی‌اند؛ مثال‌ها، پاسخ‌ها و ترتیب معرفی قدیمی ثابت‌اند.
