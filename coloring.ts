import { Effect } from "effect"

// =================================================================
// THE COLORING PROBLEM, shown two ways.
// =================================================================

// ---------- plain JS ----------
// version A: double is SYNC
function doubleSync(n: number): number {
  return n * 2
}
function pipelineSync(n: number): number {
  const a = doubleSync(n)
  const b = doubleSync(a)
  return b
}

// version B: double becomes ASYNC. watch what it does to the callers:
async function doubleAsync(n: number): Promise<number> {
  return n * 2
}
async function pipelineAsync(n: number): Promise<number> {
  const a = await doubleAsync(n) // had to add await
  const b = await doubleAsync(a) // had to add await
  return b // and pipeline itself had to become `async` + return a Promise
}
// → every caller of pipelineAsync must ALSO become async + await. infectious.

// ---------- Effect ----------
// the pipeline is written ONCE. it never mentions sync or async.
const pipeline = (double: (n: number) => Effect.Effect<number>) =>
  Effect.gen(function* () {
    const a = yield* double(10)
    const b = yield* double(a)
    return b
  })

// two implementations of `double` — one sync, one async:
const doubleE_sync = (n: number) => Effect.sync(() => n * 2)
const doubleE_async = (n: number) => Effect.promise(() => Promise.resolve(n * 2))

// SAME pipeline code runs with EITHER. no await, no `async`, no rewrite.
async function main() {
  console.log("plain sync   :", pipelineSync(10))
  console.log("plain async  :", await pipelineAsync(10))

  console.log("effect sync  :", await Effect.runPromise(pipeline(doubleE_sync)))
  console.log("effect async :", await Effect.runPromise(pipeline(doubleE_async)))
}
main()
