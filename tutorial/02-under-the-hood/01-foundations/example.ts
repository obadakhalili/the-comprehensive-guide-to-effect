// =================================================================
// Part 1 example. Run: bun tutorial/02-under-the-hood/01-foundations/example.ts
// =================================================================

import { succeed, fail, sync, flatMap, map, tap, runSyncExit, type Effect } from "./runtime"

// a small program: start at 10, double it, add 1, and log the value in the middle.
const doubled = flatMap(succeed(10), (n) => succeed(n * 2)) // 10 → 20
const plusOne = map(doubled, (n) => n + 1) // 20 → 21
const program = tap(plusOne, (n) => sync(() => console.log("tap sees:", n))) // logs, keeps 21

console.log("1) Building the program above printed nothing. It didn't run.")
console.log("2) The program is just a nested object (functions show as [Function]):")
console.dir(program, { depth: null })

console.log("3) Now run it:")
console.log("exit:", runSyncExit(program))

// a failing program: the failure short-circuits, so the map after it never runs.
const failing: Effect<number, string> = map(
  flatMap(succeed(1), () => fail("boom")),
  (n) => {
    console.log(">>> this map should never run")
    return n + 1
  }
)
console.log("4) A failing program (note the map never prints):")
console.log("exit:", runSyncExit(failing))
