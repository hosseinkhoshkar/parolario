import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export const referenceDirectory = path.resolve('reference/vocabulary')
export const examplesDirectory = path.resolve('public/content/examples')
export async function discoverExampleCatalog() {
  const filenames = (await readdir(referenceDirectory)).filter(name => /^Lesson-\d+-(?:A1|A2|B1)\.txt$/u.test(name))
    .sort((a, b) => Number(a.match(/Lesson-(\d+)/u)[1]) - Number(b.match(/Lesson-(\d+)/u)[1]))
  return Promise.all(filenames.map(async filename => {
    const source = await readFile(path.join(referenceDirectory, filename), 'utf8')
    const rows = [...source.matchAll(/^(\d+)\. (.+?) — (.+)$/gmu)].map(match => ({ row: Number(match[1]), word: match[2], meaningFa: match[3] }))
    const declared = Number(source.match(/واژه‌ها و عبارت‌های جدید:\s*(\d+)/u)?.[1])
    if (!rows.length || rows.length !== declared || rows.some((row, index) => row.row !== index + 1)) throw new Error(`Invalid source rows: ${filename}`)
    const catalogFile = filename.replace(/\.txt$/u, '.json')
    const catalog = JSON.parse(await readFile(path.join(examplesDirectory, catalogFile), 'utf8'))
    return { filename, catalogFile, rows, catalog }
  }))
}
export function validateExampleCatalog(lessons) {
  const issues = [], sentences = new Map(), keys = new Set()
  for (const { filename, rows, catalog } of lessons) {
    const stem = filename.replace(/\.txt$/u, '')
    const number = Number(filename.match(/Lesson-(\d+)/u)[1]), level = filename.match(/-(A1|A2|B1)\.txt$/u)[1]
    if (catalog.version !== 1 || catalog.sourceFile !== `reference/vocabulary/${filename}` || catalog.lessonNumber !== number || catalog.level !== level
      || !Array.isArray(catalog.entries) || catalog.entries.length !== rows.length) { issues.push(`${filename}: catalog/source mismatch`); continue }
    for (let index = 0; index < rows.length; index++) {
      const source = rows[index], row = catalog.entries[index], at = `${filename}:${source.row}`
      if (!row || row.row !== source.row || row.sourceKey !== `${stem}:${String(source.row).padStart(3, '0')}`
        || row.word !== source.word || row.meaningFa !== source.meaningFa || keys.has(row.sourceKey)) issues.push(`${at}: changed source metadata`)
      if (!row) continue
      keys.add(row.sourceKey)
      if (!Array.isArray(row.additionalExamples) || row.additionalExamples.length !== 2) { issues.push(`${at}: exactly two additional examples required`); continue }
      const local = new Set()
      for (const example of row.additionalExamples) {
        if (!example || example.origin !== 'authored' || typeof example.de !== 'string' || !/[A-Za-zÄÖÜäöüß]/u.test(example.de)
          || typeof example.fa !== 'string' || !/[\u0600-\u06ff]/u.test(example.fa)
          || example.de !== example.de.trim() || example.fa !== example.fa.trim()
          || /TODO|PLACEHOLDER|___|لطفا تکمیل/u.test(`${example.de} ${example.fa}`)) { issues.push(`${at}: incomplete German/Persian pair`); continue }
        const normalized = example.de.normalize('NFC').trim().toLocaleLowerCase('de').replace(/\s+/gu, ' ')
        if (local.has(normalized)) issues.push(`${at}: repeated example`)
        local.add(normalized)
        if (sentences.has(normalized)) issues.push(`${at}: duplicate sentence (also ${sentences.get(normalized)})`)
        else sentences.set(normalized, at)
      }
      if (row.additionalExamples[0].fa === row.additionalExamples[1].fa) issues.push(`${at}: identical translations`)
    }
  }
  return issues
}
