import { readFileSync } from 'node:fs'
import { runInThisContext } from 'node:vm'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// Loads browser classic scripts into the current jsdom global, in order, and
// hands back the namespace they attach themselves to.
export function loadApp(...files) {
  delete globalThis.S27
  for (const f of files) {
    const path = resolve(HERE, f)
    runInThisContext(readFileSync(path, 'utf8'), { filename: path })
  }
  return globalThis.S27
}

export function clearStorage() {
  globalThis.localStorage.clear()
}
