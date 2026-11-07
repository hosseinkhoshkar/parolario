# انتشار در Vercel

ریشهٔ مخزن شامل `package.json` است؛ Root Directory در Vercel باید ریشهٔ همین مخزن باشد، نه مسیر پوشه‌های محلی ویندوز.

تنظیمات نسخه‌دار در `vercel.json`:

- Framework: Vite
- Node.js: شاخهٔ 24.x، مطابق package.json
- Install Command: npm ci
- Build Command: npm run build
- Output Directory: dist

بررسی پیش از انتشار در یک پوشهٔ تمیز:

```sh
npm ci
npm test
npm run lint
npm run build
npm run verify:dist
```

## اصلاح خطای نصب

فایل قفل commit `e435a89` تعداد ۵۲ مدخل بستهٔ بدون `version` داشت؛ npm هنگام مقایسهٔ نسخه‌ها در مرحلهٔ dedupe با `Invalid Version:` متوقف می‌شد. همان خطا در کپی مجزای این commit بازتولید شد.

مدخل‌های ناقص از کپی فایل قفل حذف و اطلاعات آن‌ها با خود npm و رجیستری رسمی بازسازی شدند. نسخه‌های مستقیم dependency و devDependency در package.json تغییر نکردند. فایل نهایی اطلاعات نسخه‌دار بسته‌های اختیاری Linux، از جمله esbuild و Rollup، را نیز نگه می‌دارد. فایل قفل را با ابزارهای حذف دستی بسته‌های سایر سیستم‌عامل‌ها کوچک نکنید.

محدودهٔ Node از `>=24` به `24.x` محدود شده است؛ هشدار نسخهٔ باز Node و هشدار `cache-dir` در لاگ ارسالی، خطای نهایی نصب نبودند.

## کامل‌بودن commit

نسخهٔ قبلی به فایل‌های مرحلهٔ دوم ارجاع می‌داد که هنوز untracked بودند. فایل‌های لازمِ startup-lock، activity، schedule و خواننده‌های legacy-v1 باید همراه آزمون‌ها و اسناد همان مرحله در Git ثبت شوند؛ موفقیت ساخت در پوشهٔ محلی به‌تنهایی نشان نمی‌دهد همهٔ فایل‌ها به GitHub رسیده‌اند.

موفقیت نصب و ساخت محلی، جای تأیید وضعیت نهایی deployment در Vercel یا بررسی گوشی واقعی را نمی‌گیرد.
