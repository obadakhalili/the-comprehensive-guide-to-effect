// =================================================================
// Section 2.2 example. Run: bun tutorial/02-under-the-hood/02-async/example.ts
// =================================================================

import { succeed, map, tryPromise, runPromise, runPromiseExit, runSyncExit } from "./runtime"

// a fake async fetch: a Promise that resolves after 50ms.
const fetchName = (id: string) =>
  tryPromise({
    try: () => new Promise<string>((res) => setTimeout(() => res(`user-${id}`), 50)),
    catch: (error) => `fetch failed: ${String(error)}`,
  })

// a program that mixes an ASYNC step (fetchName) and a SYNC step (map). notice:
// no `await`, no `async` anywhere in how we build it. it's still just data.
const program = map(fetchName("1"), (name) => name.toUpperCase())

async function main() {
  console.log("1) a fully sync effect runs synchronously:")
  console.log(runSyncExit(succeed(10)))

  console.log("2) the async program — run as a Promise:")
  console.log("result:", await runPromise(program))

  console.log("3) running the async program with runSyncExit throws:")
  try {
    runSyncExit(program)
  } catch (error) {
    console.log("threw:", (error as Error).message)
  }

  console.log("4) a rejected Promise becomes a typed Failure:")
  const failing = tryPromise({
    try: () => Promise.reject(new Error("nope")),
    catch: (error) => (error as Error).message,
  })
  console.log("exit:", await runPromiseExit(failing))
}
main()
