import { readFile } from 'node:fs/promises'

const logPath = process.argv[2] || '.evancod/performance.log'
const content = await readFile(logPath, 'utf8')
const events = content
  .split(/\r?\n/)
  .map(line => {
    try {
      return JSON.parse(line)
    } catch {
      return undefined
    }
  })
  .filter(Boolean)

const terminations = events.filter(event => event.event === 'query.termination')
const iterations = terminations.map(event => Number(event.iteration) || 0).sort((a, b) => a - b)
const completed = terminations.filter(event => event.completed).length
const percentile = value =>
  iterations.length ? iterations[Math.min(iterations.length - 1, Math.ceil(iterations.length * value) - 1)] : 0

const report = {
  runs: terminations.length,
  completed,
  completionRate: terminations.length ? Number((completed / terminations.length).toFixed(4)) : 0,
  iterations: {
    average: iterations.length
      ? Number((iterations.reduce((sum, value) => sum + value, 0) / iterations.length).toFixed(2))
      : 0,
    p95: percentile(0.95),
    maximum: iterations.at(-1) || 0,
  },
  reasons: Object.fromEntries(
    Object.entries(
      terminations.reduce((counts, event) => {
        const reason = event.terminationReason || 'unknown'
        counts[reason] = (counts[reason] || 0) + 1
        return counts
      }, {})
    ).sort(([left], [right]) => left.localeCompare(right))
  ),
}

console.log(JSON.stringify(report, null, 2))
