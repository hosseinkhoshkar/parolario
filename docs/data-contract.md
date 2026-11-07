# قرارداد دادهٔ مستقل ایتالیایی — schema۵

[نوع‌های اجرایی](../src/contracts/index.ts) مرجع دقیق‌اند. schema۵، policy=learning-policy-v2، normalization=italian-answer-normalization-v1 و content=nuovo-espresso-a1-it-v1 مستقل‌اند. این تغییر، مهاجرت دادهٔ آلمانی نیست. [نسخهٔ تاریخی قرارداد](../reference/legacy-wortzeit/docs/data-contract.md) برای سابقه حفظ شده است.

## محتوا

Lesson.titleIt و Example.it جای فیلدهای زبان قبلی را گرفته‌اند. lessonId=it-a1-lesson-01 و شناسهٔ هر مدخل it-a1-l01-NNN از شمارهٔ ثابت سطر فایل مرجع می‌آید؛ تغییر مرتب‌سازی نباید شناسه را عوض کند. sourceHeadword/sourceRow متن و شمارهٔ اصلی را حفظ می‌کنند. introductionOrder از صفحهٔ چاپی و رتبهٔ محل منبع می‌آید.

Entry نقش دستوری، معنی، occurrence و sourceRefIds واقعی دارد. Example.origin برابر quoted یا authored است؛ quoted دارای sourceRefId همان مدخل است. نمونهٔ اول عین گزیدهٔ کتاب، دو نمونهٔ بعد تألیفی‌اند. writing پاسخ معیارِ مدخل و cue فارسی دارد. cloze پاسخ‌های مستقل و cue جدا می‌تواند داشته باشد تا صورت صرف‌شده با مصدر اشتباه نشود؛ بازسازی پاسخ معیار باید دقیقاً مثال تألیفیِ اشاره‌شده را بسازد.

nounData شامل article nullable، gender مستقل nullable و number است. آرتیکل‌های مجاز il/lo/la/l'/i/gli/le؛ برای l' جنس باید مستقلاً معلوم باشد. فقط اسم با آرتیکل معلوم article-skill و choose-article می‌گیرد؛ اسم نامعلوم نیز مدخل معتبر است. plural نامعلوم null می‌ماند و توضیح دارد. نمونهٔ جمعی حدس زده نمی‌شود.

NFC، trim و یکسان‌کردن فاصله مجازند؛ حذف اکسان، stemming و صورت صرفیِ حدسی مجاز نیست. caseSensitive و acceptedAnswers صریح‌اند. نقل کتاب، معنی و locator در sync بازنویسی نمی‌شوند.

## پیشرفت و تراکنش

progress، attempts، skills، assistanceEvents، reverseProgress/reverseReviews، dailyActivity، session و savedSessions همان قرارداد رفتاری موجود را حفظ می‌کنند. زمان مطالعه و هدف بین درس‌ها مشترک است؛ session.lessonId مالک صف و draft است. select-lesson جلسهٔ فعلی را paused بایگانی و مقصد را بازیابی می‌کند.

پاسخ/تاریخچه/بازخورد/موعد/cursor در یک snapshot و یک تراکنش ثبت می‌شوند. expectedRevision مانع writer کهنه است؛ attemptId و eventId تکراری دوباره شمرده نمی‌شوند. validator شکل داده، شمارنده‌ها در برابر تاریخچه، مالکیت درس، آرتیکل، بازخورد و شواهد مرور معکوس را بررسی می‌کند.

IndexedDB=parolario-progress، object store=user-state، key=current، قفل parolario-single-writer. migrateState فقط schema و محتوای فعلی را اعتبارسنجی و clone می‌کند؛ هر نسخه/محتوای بیگانه بدون تغییر داده رد می‌شود. هیچ خوانندهٔ frozen آلمانی در مسیر اجرایی ذخیره وارد نمی‌شود.

## مثال‌های تکمیلی

reference/vocabulary/italian/Lesson-01-A1.txt منبع انسانیِ ثابت و public/content/examples/italian/Lesson-01-A1.json دادهٔ تألیفی بازبینی‌شده است. sync:examples تطبیق سطر/کلید/متن، جفت زبانی، تکرار و تعداد را بررسی می‌کند و تنها italian-source.json و additional-examples.ts اجرایی را به صورت قطعی می‌سازد. build hash برای تازگی cache مستقل از contentVersion است.
