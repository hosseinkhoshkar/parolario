import sourceRows from './italian-source.json' with { type: 'json' }
import pedagogy from './italian-pedagogy.json' with { type: 'json' }
import { buildItalianLesson } from './build-italian-lesson.ts'
import type { Pedagogy } from './build-italian-lesson.ts'

export const lessonOneBundle = buildItalianLesson({
  lessonId: 'it-a1-lesson-01', entryPrefix: 'it-a1-l01', titleIt: 'Primi contatti', titleFa: 'نخستین آشنایی‌ها',
  sourceRows, pedagogy: pedagogy as Pedagogy[],
  provenance: { file: 'reference/vocabulary/italian/Lesson-01-A1.txt', reviewStatus: 'excerpt-checked',
    noteFa: '۸۵ واژه و عبارت منتخب درس اول؛ نمونهٔ هر مدخل از PDF و دو مثال تکمیلی تألیفی‌اند. این گزیده تأیید جامع اصل کتاب نیست. صورت جمع و آرتیکل نامعلوم حدس زده نشده‌اند.' },
})
