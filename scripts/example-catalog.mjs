import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
export const referenceDirectory = path.resolve('reference/vocabulary/italian')
export const examplesDirectory = path.resolve('public/content/examples/italian')
export function parseItalianSource(source, filename) {
  const rows = [...source.matchAll(/^(\d+)\. (.+?) — (.+)\r?\n\s+منبع: (.+)\r?\n\s+مثال از کتاب: (.+)\r?\n\s+معنی مثال: (.+)(?:\r?\n[ \t]+نکته: (.+))?/gmu)]
    .map(match => ({ row: Number(match[1]), word: match[2], meaningFa: match[3], locator: match[4], exampleIt: match[5], exampleFa: match[6], noteFa: match[7] ?? '' }))
  const declared = Number(source.match(/واژه‌ها و عبارت‌های منتخب:\s*(\d+)/u)?.[1])
  if (!rows.length || rows.length !== declared || rows.some((row, index) => row.row !== index + 1)) throw new Error(`Invalid source rows: ${filename}`)
  return rows
}
export async function discoverExampleCatalog() {
  const filenames = (await readdir(referenceDirectory)).filter(name => /^Lesson-\d+-A1\.txt$/u.test(name))
    .sort((a, b) => Number(a.match(/Lesson-(\d+)/u)[1]) - Number(b.match(/Lesson-(\d+)/u)[1]))
  return Promise.all(filenames.map(async filename => {
    const rows = parseItalianSource(await readFile(path.join(referenceDirectory, filename), 'utf8'), filename)
    const catalogFile = filename.replace(/\.txt$/u, '.json')
    const catalog = JSON.parse(await readFile(path.join(examplesDirectory, catalogFile), 'utf8'))
    return { filename, catalogFile, rows, catalog }
  }))
}
export function validateExampleCatalog(lessons) {
  const issues = [], sentences = new Map(), keys = new Set()
  for (const { filename, rows, catalog } of lessons) {
    const stem = `italian-${filename.replace(/\.txt$/u, '')}`
    const number = Number(filename.match(/Lesson-(\d+)/u)[1])
    if (catalog.version !== 1 || catalog.language !== 'it' || catalog.sourceFile !== `reference/vocabulary/italian/${filename}`
      || catalog.lessonNumber !== number || catalog.level !== 'A1' || !Array.isArray(catalog.entries) || catalog.entries.length !== rows.length) {
      issues.push(`${filename}: catalog/source mismatch`); continue
    }
    for (let index = 0; index < rows.length; index++) {
      const source = rows[index], row = catalog.entries[index], at = `${filename}:${source.row}`
      if (!row || row.row !== source.row || row.sourceKey !== `${stem}:${String(source.row).padStart(3, '0')}`
        || row.word !== source.word || row.meaningFa !== source.meaningFa || keys.has(row.sourceKey)) issues.push(`${at}: changed source metadata`)
      if (!row) continue
      keys.add(row.sourceKey)
      if (!Array.isArray(row.additionalExamples) || row.additionalExamples.length !== 2) { issues.push(`${at}: exactly two additional examples required`); continue }
      for (const example of row.additionalExamples) {
        if (!example || example.origin !== 'authored' || typeof example.it !== 'string' || !/[A-Za-zÀ-ÖØ-öø-ÿ]/u.test(example.it)
          || typeof example.fa !== 'string' || !/[\u0600-\u06ff]/u.test(example.fa) || example.it !== example.it.trim()
          || example.fa !== example.fa.trim() || /TODO|PLACEHOLDER|___|لطفا تکمیل/u.test(`${example.it} ${example.fa}`)) {
          issues.push(`${at}: incomplete Italian/Persian pair`); continue
        }
        const normalized = example.it.normalize('NFC').toLocaleLowerCase('it').replace(/\s+/gu, ' ')
        if (normalized === source.exampleIt.normalize('NFC').toLocaleLowerCase('it').replace(/\s+/gu, ' ')) issues.push(`${at}: authored example duplicates book quote`)
        if (sentences.has(normalized)) issues.push(`${at}: duplicate sentence (also ${sentences.get(normalized)})`)
        else sentences.set(normalized, at)
      }
      if (row.additionalExamples[0]?.fa === row.additionalExamples[1]?.fa) issues.push(`${at}: identical translations`)
    }
  }
  return issues
}
