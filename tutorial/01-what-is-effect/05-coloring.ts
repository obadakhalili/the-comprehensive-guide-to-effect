// ============================================================
// The async coloring problem — and how Effect sidesteps it.
//
// "Coloring": in plain JS, the moment one function becomes async, every function
// that calls it must also become async and await it. The change spreads up the
// whole call chain. In Effect it doesn't, because sync and async are the same
// type and compose the same way.
//
// Run: bun tutorial/01-what-is-effect/05-coloring.ts
// ============================================================

import { Effect } from "effect"

// ---------- plain JS ----------

// version A: loadName is sync, so greet is sync.
function loadNameSync(id: string): string {
  return `user-${id}`
}
function greetSync(id: string): string {
  const name = loadNameSync(id)
  return `hello, ${name}`
}

// version B: loadName becomes async (say it now hits a database). look what that
// forced: greet had to become `async`, add `await`, and return a Promise. And
// every caller of greet must now do the same. The color spread.
async function loadNameAsync(id: string): Promise<string> {
  return `user-${id}`
}
async function greetAsync(id: string): Promise<string> {
  const name = await loadNameAsync(id)
  return `hello, ${name}`
}

// ---------- Effect ----------

// greet is written ONCE. it never says sync or async. it just sequences a step.
const greet =
  (loadName: (id: string) => Effect.Effect<string>) =>
  (id: string): Effect.Effect<string> =>
    Effect.gen(function* () {
      const name = yield* loadName(id)
      return `hello, ${name}`
    })

// two implementations of the same step — one sync, one async. SAME type.
const loadNameSyncE = (id: string) => Effect.sync(() => `user-${id}`)
const loadNameAsyncE = (id: string) => Effect.promise(() => Promise.resolve(`user-${id}`))

async function main() {
  console.log("plain sync   :", greetSync("1"))
  console.log("plain async  :", await greetAsync("1"))

  // greet did not change between these two lines. only the step we passed in did.
  console.log("effect sync  :", await Effect.runPromise(greet(loadNameSyncE)("1")))
  console.log("effect async :", await Effect.runPromise(greet(loadNameAsyncE)("1")))
}
main()
