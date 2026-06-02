// =================================================================
// Part 5 example. Run: bun tutorial/02-under-the-hood/05-concurrency/example.ts
// =================================================================

import { fail, map, flatMap, sleep, raceFirst, forEachConcurrent, timeout, runPromise, runPromiseExit } from "./runtime"

// an effect that produces `value` after `ms`.
const delayed = <A>(ms: number, value: A) => map(sleep(ms), () => value)

async function main() {
  // 1) three 50ms tasks run AT ONCE — total is ~50ms, not 150ms.
  const start = Date.now()
  const results = await runPromise(forEachConcurrent([1, 2, 3], (n) => delayed(50, n * 10)))
  console.log(`1) forEachConcurrent: ${JSON.stringify(results)} in ~${Date.now() - start}ms`)

  // 2) race: the faster effect wins, the slower one is interrupted.
  const winner = await runPromise(raceFirst(delayed(20, "fast"), delayed(100, "slow")))
  console.log("2) raceFirst winner:", winner)

  // 3) timeout: the work takes 100ms but the limit is 30ms → a Timeout failure.
  const timed = await runPromiseExit(timeout(delayed(100, "too slow"), 30))
  console.log("3) timeout exit:", timed)

  // 4) forEachConcurrent stops on the first failure (and interrupts the rest).
  const withFailure = await runPromiseExit(
    forEachConcurrent([1, 2, 3], (n) =>
      n === 2 ? flatMap(sleep(10), () => fail("item 2 failed")) : delayed(50, n)
    )
  )
  console.log("4) forEachConcurrent with a failure:", withFailure)
}

main()
