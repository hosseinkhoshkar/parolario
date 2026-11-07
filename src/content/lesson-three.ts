import sourceRows from './italian-source-03.json' with { type: 'json' }
import pedagogy from './lesson-three-pedagogy.json' with { type: 'json' }
import { buildItalianLesson } from './build-italian-lesson.ts'
import type { Pedagogy } from './build-italian-lesson.ts'

export const lessonThreeBundle = buildItalianLesson({
  lessonId: 'it-a1-lesson-03', entryPrefix: 'it-a1-l03', titleIt: 'Buon appetito', titleFa: 'نوش جان',
  sourceRows, pedagogy: pedagogy as Pedagogy[],
  provenance: { file: 'reference/vocabulary/italian/Lesson-03-A1.txt', reviewStatus: 'excerpt-checked',
    noteFa: '۱۰۹ مدخل تازهٔ منتخب برای غذا، نوشیدنی، سفارش و رزرو؛ یک نمونهٔ نوشته‌شدهٔ کتاب و دو مثال تألیفی دوزبانه در هر مدخل. برچسب تصویر، عنوان و منو جملهٔ کامل نیستند. تکرارهای درس‌های قبلی دوباره معرفی نمی‌شوند. صفحات۳۳تا۴۵ و تمرین‌های۱۵۸تا۱۶۲ بررسی شده‌اند؛ این گزیده پوشش جامع کتاب نیست.' },
})
