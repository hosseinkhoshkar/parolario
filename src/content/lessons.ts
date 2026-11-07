import { lessonOneBundle } from './lesson-one.ts'
import { lessonTwoBundle } from './lesson-two.ts'
import { withTextbookStudyOrder } from './textbook-study-order.ts'

/** Only verified Italian lessons enter the active catalog. */
export const lessonBundles = [lessonOneBundle, lessonTwoBundle].map(withTextbookStudyOrder)
