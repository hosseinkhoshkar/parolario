import { lessonOneBundle } from './lesson-one.ts'
import { withTextbookStudyOrder } from './textbook-study-order.ts'

/** Only verified Italian lessons enter the active catalog. */
export const lessonBundles = [lessonOneBundle].map(withTextbookStudyOrder)
