// =================================================================
// Section 2.6 example. Run: bun tutorial/02-under-the-hood/06-ergonomics/example.ts
// =================================================================

import {
  pipe,
  succeed,
  fail,
  sync,
  map,
  flatMap,
  tap,
  catchAll,
  retry,
  timeout,
  provide,
  makeTag,
  service,
  runPromise,
  type Effect,
} from "./runtime"

// a flaky API service: fails twice with a Network error, then succeeds.
interface NetworkError {
  readonly _tag: "Network"
  readonly message: string
}
interface Api {
  readonly get: (path: string) => Effect<string, NetworkError>
}
const Api = makeTag<Api>()("Api")

let attempts = 0
const ApiLive: Api = {
  get: (path) => {
    attempts++
    return attempts < 3
      ? fail({ _tag: "Network", message: `attempt ${attempts} failed` })
      : succeed(`<body of ${path}>`)
  },
}

// the same chain, two ways.

// 1) nested calls — reads inside-out, the innermost thing runs first.
const nested = provide(
  catchAll(
    timeout(
      tap(
        map(
          retry(
            flatMap(service(Api), (api) => api.get("/user")),
            { times: 5, while: (e) => e._tag === "Network" }
          ),
          (body) => body.toUpperCase()
        ),
        (value) => sync(() => console.log("  nested fetched:", value))
      ),
      1000
    ),
    (e) => succeed(`recovered: ${JSON.stringify(e)}`)
  ),
  Api,
  ApiLive
)

// 2) the SAME thing with pipe — reads top-to-bottom, in the order it runs.
const piped = pipe(
  flatMap(service(Api), (api) => api.get("/user")),
  retry({ times: 5, while: (e) => e._tag === "Network" }),
  map((body) => body.toUpperCase()),
  tap((value) => sync(() => console.log("  piped fetched:", value))),
  timeout(1000),
  catchAll((e) => succeed(`recovered: ${JSON.stringify(e)}`)),
  provide(Api, ApiLive)
)

// dual proof: map(self, f) and pipe(self, map(f)) build the SAME thing.
const a = map(succeed(1), (n) => n + 1)
const b = pipe(succeed(1), map((n: number) => n + 1))

async function main() {
  attempts = 0
  console.log("1) nested result:", await runPromise(nested))
  attempts = 0
  console.log("2) piped result :", await runPromise(piped))
  console.log("3) dual — both forms run to the same value:", await runPromise(a), await runPromise(b))
}
main()
