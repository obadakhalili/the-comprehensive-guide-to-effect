// =================================================================
// Section 2.4 example. Run: bun tutorial/02-under-the-hood/04-errors/example.ts
// =================================================================

import { succeed, fail, sync, flatMap, catchAll, catchTags, retry, runSyncExit, type Effect } from "./runtime"

// two tagged errors.
interface NotFound {
  readonly _tag: "NotFound"
  readonly id: string
}
interface NetworkError {
  readonly _tag: "Network"
  readonly message: string
}
const notFound = (id: string): NotFound => ({ _tag: "NotFound", id })
const networkError = (message: string): NetworkError => ({ _tag: "Network", message })

// 1) catchAll turns a failure into a success.
const recovered = catchAll(fail(notFound("42")), (e) => succeed(`recovered from ${e._tag}`))
console.log("1) catchAll:", runSyncExit(recovered))

// 2) catchTags dispatches on the error's _tag. each handler gets the right type.
const handle = (eff: Effect<string, NotFound | NetworkError>) =>
  catchTags(eff, {
    NotFound: (e) => succeed(`404: user ${e.id}`),
    Network: (e) => succeed(`500: ${e.message}`),
  })
console.log("2a) catchTags NotFound:", runSyncExit(handle(fail(notFound("7")))))
console.log("2b) catchTags Network :", runSyncExit(handle(fail(networkError("timeout")))))

// 3) retry re-runs a flaky effect until it works. it fails twice, then succeeds.
let attempts = 0
const flaky: Effect<string, NetworkError> = flatMap(sync(() => ++attempts), (n) =>
  n < 3 ? fail(networkError(`attempt ${n} failed`)) : succeed(`ok on attempt ${n}`)
)
const retried = retry(flaky, { times: 5, while: (e) => e._tag === "Network" })
console.log("3) retry:", runSyncExit(retried))

// 4) a failure deep in a chain skips every step until a handler catches it.
const deep = catchAll(
  flatMap(succeed(1), () =>
    flatMap(succeed(2), () =>
      flatMap(fail("boom" as const), () => {
        console.log("  >>> this step should never run")
        return succeed(99)
      })
    )
  ),
  (e) => succeed(`caught: ${e}`)
)
console.log("4) deep failure caught:", runSyncExit(deep))
