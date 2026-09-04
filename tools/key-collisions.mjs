// Builds row keys for every row on the real index.html and reports collisions.
// A collision between two rows with different company-and-title is a defect.
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

const ident = (r) => RowIndex.slug(r.co) + '|' + RowIndex.slug(r.title)
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
    lines.push(`  DEFECT ${key} claimed by ${group.length} rows, ${distinct.size} distinct company/title`)
    group.slice(0, 4).forEach((r) => lines.push(`      ${r.co} - ${r.title}`))
    if (group.length > 4) lines.push(`      ... and ${group.length - 4} more`)
  } else {
    dupKeys++
    dupRows += group.length
    lines.push(`  IDENTICAL ${key} x${group.length}: ${group[0].co} - ${group[0].title} -> ${group[0].url}`)
  }
}

console.log(`rows indexed:        ${rows.length}`)
console.log(`rows with a link:    ${linked.length}`)
console.log(`distinct keys:       ${groups.size}`)
console.log(`defect keys:         ${badKeys} (shared by rows with different company/title)`)
console.log(`rows in defect keys: ${badRows}`)
console.log(`identical-row keys:  ${dupKeys} (same company, title and URL)`)
console.log(`rows in those keys:  ${dupRows}`)
if (lines.length) console.log(lines.join('\n'))
process.exit(badKeys ? 1 : 0)
