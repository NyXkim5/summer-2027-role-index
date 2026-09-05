// Builds row keys for every row on the real index.html and reports collisions.
// Two rows sharing a key is a defect unless the two rows are the same row.
//
// The criterion is the whole <tr> markup, not company and title. Company and
// title is the expression the fallback key is built from, so every group
// sitting on a t: key agreed with itself by construction and the tool could
// only ever report zero. Comparing the markup asks a question the key does not
// already answer: two rows may share a key only if a reader could not tell
// them apart on the page.
//
// Run with: node tools/key-collisions.mjs
import { readFileSync } from 'node:fs'
import { runInThisContext } from 'node:vm'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dom = new JSDOM(readFileSync(resolve(ROOT, 'index.html'), 'utf8'))
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.URL = dom.window.URL
globalThis.S27 = undefined
runInThisContext(readFileSync(resolve(ROOT, 'app/rowindex.js'), 'utf8'), { filename: 'rowindex.js' })

const RowIndex = globalThis.S27.RowIndex
const { rows } = RowIndex.build(document, new Date().toISOString().slice(0, 10))

const linked = rows.filter((r) => r.url)
const groups = new Map()
rows.forEach((r) => {
  if (!groups.has(r.key)) groups.set(r.key, [])
  groups.get(r.key).push(r)
})

const ident = (r) => r.tr.outerHTML
const label = (r) => `${r.co} - ${r.title}`
let badKeys = 0
let badRows = 0
let dupKeys = 0
let dupRows = 0
const lines = []
for (const [key, group] of groups) {
  if (group.length < 2) continue
  const distinct = new Set(group.map(ident))
  if (distinct.size > 1) {
    badKeys++
    badRows += group.length
    lines.push(`  DEFECT ${key} claimed by ${group.length} rows, ${distinct.size} distinct <tr>`)
    group.slice(0, 4).forEach((r) => lines.push(`      ${label(r)}`))
    if (group.length > 4) lines.push(`      ... and ${group.length - 4} more`)
  } else {
    dupKeys++
    dupRows += group.length
    lines.push(`  IDENTICAL ${key} x${group.length}: ${label(group[0])} -> ${group[0].url}`)
  }
}

console.log(`rows indexed:        ${rows.length}`)
console.log(`rows with a link:    ${linked.length}`)
console.log(`distinct keys:       ${groups.size}`)
console.log(`defect keys:         ${badKeys} (shared by rows whose markup differs)`)
console.log(`rows in defect keys: ${badRows}`)
console.log(`identical-row keys:  ${dupKeys} (byte-identical duplicate rows in index.html)`)
console.log(`rows in those keys:  ${dupRows}`)
if (lines.length) console.log(lines.join('\n'))
process.exit(badKeys ? 1 : 0)
