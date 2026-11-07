import sourceRows from './italian-source-02.json' with { type: 'json' }
import pedagogy from './lesson-two-pedagogy.json' with { type: 'json' }
import { buildItalianLesson } from './build-italian-lesson.ts'
import type { Pedagogy } from './build-italian-lesson.ts'

export const lessonTwoBundle = buildItalianLesson({
  lessonId: 'it-a1-lesson-02', entryPrefix: 'it-a1-l02', titleIt: 'Io e gli altri', titleFa: 'من و دیگران',
  sourceRows, pedagogy: pedagogy as Pedagogy[],
  provenance: { file: 'reference/vocabulary/italian/Lesson-02-A1.txt', reviewStatus: 'excerpt-checked',
    noteFa: '۹۲ واژه و عبارت تازهٔ منتخب درس دوم از PDF؛ نمونهٔ هر مدخل نقل‌شده و دو مثال تکمیلی تألیفی‌اند. واژه‌های تکراری درس۱ دوباره جدید نمی‌شوند. این گزیده تأیید جامع اصل کتاب نیست؛ برچسب‌های تصویر و ردیف‌های عدد، جمله معرفی نمی‌شوند.' },
})
