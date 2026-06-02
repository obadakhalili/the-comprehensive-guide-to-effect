// =================================================================
// A toy Effect runtime, faithful to with-effect.ts.
//
// Layers, bottom to top:
//   1. primitives        — the ~9 tags the loop understands (incl. Async)
//   2. dual + pipe        — the ergonomics that make `x.pipe(op, op)` work
//   3. library combinators — tryPromise, sleep, retry, timeout, forEach... (these
//                            are the ONLY place `async` appears)
//   4. the runtime        — Fiber + step loop
//   5. user land          — getUser/getPosts/... written in pipe style, NO async
// =================================================================

// ---------- 1. primitives (the only tags the loop understands) ----------
type Effect =
  | { _op: "Succeed"; value: any }
  | { _op: "Fail"; error: any }
  | { _op: "Sync"; thunk: () => any }
  | { _op: "Async"; register: (resume: (e: Effect) => void) => (() => void) | void }
  | { _op: "OnSuccess"; self: Effect; f: (a: any) => Effect }
  | { _op: "OnFailure"; self: Effect; g: (e: any) => Effect }
  | { _op: "Service"; tag: string }
  | { _op: "Provide"; self: Effect; tag: string; impl: any }
  | { _op: "Fork"; self: Effect }

const succeed = (value: any): Effect => ({ _op: "Succeed", value })
const fail = (error: any): Effect => ({ _op: "Fail", error })
const sync = (thunk: () => any): Effect => ({ _op: "Sync", thunk })
const async = (register: (r: (e: Effect) => void) => (() => void) | void): Effect =>
  ({ _op: "Async", register })
const service = (tag: string): Effect => ({ _op: "Service", tag })
const fork = (self: Effect): Effect => ({ _op: "Fork", self })

// ---------- 2. dual + pipe (the ergonomics) ----------
// `dual` makes a combinator usable BOTH ways:
//   flatMap(self, f)   (data-first, used internally)
//   flatMap(f)         (data-last, returns self => Effect, used in pipe)
// It just checks how many args it got.
const dual =
  (arity: number, body: (...args: any[]) => any): any =>
  (...args: any[]) =>
    args.length >= arity ? body(...args) : (self: any) => body(self, ...args)

// `pipe(x, f, g)` = g(f(x)). This is what `effect.pipe(...)` does under the hood.
function pipe(value: any, ...fns: Array<(x: any) => any>): any {
  return fns.reduce((acc, fn) => fn(acc), value)
}

// ---------- core combinators (dual) ----------
const flatMap: {
  (self: Effect, f: (a: any) => Effect): Effect
  (f: (a: any) => Effect): (self: Effect) => Effect
} = dual(2, (self: Effect, f: (a: any) => Effect): Effect => ({ _op: "OnSuccess", self, f }))

const map: {
  (self: Effect, f: (a: any) => any): Effect
  (f: (a: any) => any): (self: Effect) => Effect
} = dual(2, (self: Effect, f: (a: any) => any): Effect => flatMap(self, (a) => succeed(f(a))))

const catchAll: {
  (self: Effect, g: (e: any) => Effect): Effect
  (g: (e: any) => Effect): (self: Effect) => Effect
} = dual(2, (self: Effect, g: (e: any) => Effect): Effect => ({ _op: "OnFailure", self, g }))

const provide: {
  (self: Effect, tag: string, impl: any): Effect
  (tag: string, impl: any): (self: Effect) => Effect
} = dual(3, (self: Effect, tag: string, impl: any): Effect => ({ _op: "Provide", self, tag, impl }))

// ---------- 3. library combinators (sugar — and the only home of `async`) ----------

// tryPromise: wrap a Promise as an Effect. THE bridge from the async world.
// Built on `async`: start the promise, resume when it settles. No timers here.
const tryPromise = (options: {
  try: () => Promise<any>
  catch: (error: unknown) => any
}): Effect =>
  async((resume) => {
    options.try().then(
      (value) => resume(succeed(value)),
      (error) => resume(fail(options.catch(error)))
    )
  })

// sleep: resume after ms. Uses setTimeout because sleeping IS waiting on a timer.
// (This is the only combinator where a timer is intrinsic.)
const sleep = (ms: number): Effect =>
  async((resume) => {
    const t = setTimeout(() => resume(succeed(undefined)), ms)
    return () => clearTimeout(t) // canceler, run if this fiber is interrupted
  })

// tap: run f for its effect, keep the ORIGINAL value
const tap: {
  (self: Effect, f: (a: any) => Effect): Effect
  (f: (a: any) => Effect): (self: Effect) => Effect
} = dual(2, (self: Effect, f: (a: any) => Effect): Effect => flatMap(self, (a) => map(f(a), () => a)))

// retry: catch a failure and, if allowed, run the SAME effect again
const retry = (self: Effect, times: number, while_: (e: any) => boolean): Effect =>
  catchAll(self, (err) => (times > 0 && while_(err) ? retry(self, times - 1, while_) : fail(err)))

// catchTags: a catchAll that dispatches on the error's _tag
const catchTags: {
  (self: Effect, handlers: Record<string, (e: any) => Effect>): Effect
  (handlers: Record<string, (e: any) => Effect>): (self: Effect) => Effect
} = dual(2, (self: Effect, handlers: Record<string, (e: any) => Effect>): Effect =>
  catchAll(self, (err) => {
    const handler = handlers[err._tag]
    return handler ? handler(err) : fail(err)
  }))

// raceFirst: run a & b concurrently, take the first to settle, interrupt the loser.
const raceFirst = (a: Effect, b: Effect): Effect =>
  flatMap(fork(a), (fa: Fiber) =>
    flatMap(fork(b), (fb: Fiber) =>
      async((resume) => {
        let done = false
        const onSettle = (loser: Fiber) => (exit: Exit) => {
          if (done) return
          done = true
          loser.interrupt()
          resume(exit._tag === "Success" ? succeed(exit.value) : fail(exit.failure))
        }
        fa.addObserver(onSettle(fb))
        fb.addObserver(onSettle(fa))
      })
    )
  )

// timeout: race the work against a sleep that fails.
const timeout: {
  (self: Effect, ms: number): Effect
  (ms: number): (self: Effect) => Effect
} = dual(2, (self: Effect, ms: number): Effect =>
  raceFirst(self, flatMap(sleep(ms), () => fail({ _tag: "Timeout", message: `timed out after ${ms}ms` }))))

// forEach with unbounded concurrency: fork every item, then await them all.
const forEachConcurrent = (items: any[], f: (x: any) => Effect): Effect => {
  let forkAll: Effect = succeed([] as Fiber[])
  for (const item of items) {
    forkAll = flatMap(forkAll, (acc: Fiber[]) => map(fork(f(item)), (fb: Fiber) => [...acc, fb]))
  }
  return flatMap(forkAll, (fibers: Fiber[]) =>
    async((resume) => {
      const results = new Array(fibers.length)
      let remaining = fibers.length
      let settled = false
      if (remaining === 0) return resume(succeed([]))
      fibers.forEach((fb, i) =>
        fb.addObserver((exit) => {
          if (settled) return
          if (exit._tag === "Failure") {
            settled = true
            fibers.forEach((o) => o !== fb && o.interrupt())
            return resume(fail(exit.failure))
          }
          results[i] = exit.value
          if (--remaining === 0) {
            settled = true
            resume(succeed(results))
          }
        })
      )
    })
  )
}

// ============================== 4. the runtime ==============================
// an Exit is EITHER a success OR a failure — never both. (a tagged union, like real Effect)
type Exit = { _tag: "Success"; value: any } | { _tag: "Failure"; failure: any }
type Frame =
  | { kind: "onSuccess"; f: (a: any) => Effect }
  | { kind: "onFailure"; g: (e: any) => Effect }
  | { kind: "restoreContext"; ctx: Map<string, any> }

class Fiber {
  current: Effect | null
  stack: Frame[] = []
  value: any = undefined
  failure: any = undefined
  inFailure = false
  context: Map<string, any>
  done = false
  exit: Exit | null = null
  observers: ((e: Exit) => void)[] = []
  suspended = false
  canceler: (() => void) | null = null

  constructor(effect: Effect, context: Map<string, any>) {
    this.current = effect
    this.context = new Map(context)
  }

  addObserver(cb: (e: Exit) => void) {
    if (this.done) cb(this.exit!)
    else this.observers.push(cb)
  }

  complete(exit: Exit) {
    this.done = true
    this.exit = exit
    this.observers.forEach((o) => o(exit))
  }

  interrupt() {
    if (this.done || !this.suspended) return
    const c = this.canceler
    this.canceler = null
    this.suspended = false
    if (c) c()
    this.failure = { _tag: "Interrupted" }
    this.inFailure = true
    this.current = null
    step(this)
  }
}

function step(fiber: Fiber) {
  while (true) {
    if (fiber.current !== null) {
      const eff = fiber.current
      fiber.current = null
      switch (eff._op) {
        case "Succeed":
          fiber.value = eff.value; fiber.inFailure = false; break
        case "Fail":
          fiber.failure = eff.error; fiber.inFailure = true; break
        case "Sync":
          try { fiber.value = eff.thunk(); fiber.inFailure = false }
          catch (e) { fiber.failure = e; fiber.inFailure = true }
          break
        case "OnSuccess":
          fiber.stack.push({ kind: "onSuccess", f: eff.f }); fiber.current = eff.self; continue
        case "OnFailure":
          fiber.stack.push({ kind: "onFailure", g: eff.g }); fiber.current = eff.self; continue
        case "Service":
          if (fiber.context.has(eff.tag)) { fiber.value = fiber.context.get(eff.tag); fiber.inFailure = false }
          else { fiber.failure = { _tag: "MissingService", tag: eff.tag }; fiber.inFailure = true }
          break
        case "Provide": {
          const prev = fiber.context
          fiber.context = new Map(prev)
          fiber.context.set(eff.tag, eff.impl)
          fiber.stack.push({ kind: "restoreContext", ctx: prev })
          fiber.current = eff.self
          continue
        }
        case "Fork": {
          const child = new Fiber(eff.self, fiber.context)
          queueMicrotask(() => step(child))
          fiber.value = child; fiber.inFailure = false
          break
        }
        case "Async": {
          let resumed = false
          const resume = (next: Effect) => {
            if (resumed) return
            resumed = true
            fiber.suspended = false
            fiber.canceler = null
            fiber.current = next
            step(fiber)
          }
          fiber.suspended = true
          fiber.canceler = eff.register(resume) || null
          return // park: unwind JS stack, re-enter on resume/interrupt
        }
      }
    }

    let frame: Frame | undefined
    while ((frame = fiber.stack.pop())) {
      if (frame.kind === "restoreContext") { fiber.context = frame.ctx; continue }
      if (!fiber.inFailure && frame.kind === "onSuccess") { fiber.current = frame.f(fiber.value); break }
      if (fiber.inFailure && frame.kind === "onFailure") { fiber.current = frame.g(fiber.failure); break }
    }

    if (fiber.current === null) {
      // emit ONLY the live register — success xor failure, never both.
      return fiber.complete(
        fiber.inFailure
          ? { _tag: "Failure", failure: fiber.failure }
          : { _tag: "Success", value: fiber.value }
      )
    }
  }
}

function run(effect: Effect, done: (exit: Exit) => void) {
  const root = new Fiber(effect, new Map())
  root.addObserver(done)
  step(root)
}

// ============================== 5. user land ==============================
// reads like with-effect.ts: pipe chains, no http argument, no `async` in sight.

const getUser = (id: number) =>
  pipe(
    service("Http"),
    flatMap((http) => http.get(`/users/${id}`))
  )

const getPosts = (userId: number) =>
  pipe(
    service("Http"),
    flatMap((http) => http.get(`/users/${userId}/posts`))
  )

const getCommentCount = (postId: number) =>
  pipe(
    service("Http"),
    flatMap((http) => http.get(`/posts/${postId}/comments`)),
    map((comments: any[]) => comments.length)
  )

const loadUserPosts = (userId: number) =>
  pipe(
    getUser(userId),
    flatMap((user) => getPosts(user.id)),
    flatMap((posts) =>
      forEachConcurrent(posts, (post) =>
        pipe(
          getCommentCount(post.id),
          map((comments) => ({ post, comments }))
        )
      )
    )
  )

// retry policy as a reusable pipeable step: "up to 3x, only on Network errors"
const retryNetwork = (self: Effect) => retry(self, 3, (e) => e._tag === "Network")

// ---- the fake network: a plain Promise-returning function, like real `fetch` ----
const DB: Record<string, { status: number; body?: any }> = {
  "/users/1": { status: 200, body: { id: 1, name: "Ada" } },
  "/users/1/posts": { status: 200, body: [{ id: 1, title: "post one" }, { id: 2, title: "post two" }] },
  "/posts/1/comments": { status: 200, body: [{}, {}, {}] }, // 3 comments
  "/posts/2/comments": { status: 200, body: [{}, {}] },     // 2 comments
}
const attempts: Record<string, number> = {}
// like fetch: resolves with a response (even 404), REJECTS on a connection error.
const rawFetch = (url: string): Promise<any> =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      attempts[url] = (attempts[url] ?? 0) + 1
      if (url === "/posts/2/comments" && attempts[url] === 1) {
        console.log(`   [net] ${url} attempt ${attempts[url]} → connection error`)
        return reject(new Error(`failed to reach ${url}`))
      }
      const row = DB[url]
      const status = row?.status ?? 404
      console.log(`   [net] ${url} attempt ${attempts[url]} → ${status}`)
      resolve({ status, ok: status < 400, body: row?.body })
    }, 15)
  })

// the Http implementation — now uses tryPromise + pipe, like with-effect.ts's HttpLive
const HttpLive = {
  name: "live",
  get: (url: string): Effect =>
    pipe(
      tryPromise({
        try: () => rawFetch(url),
        catch: () => ({ _tag: "Network", message: `failed to reach ${url}` }),
      }),
      flatMap((res: any) =>
        res.status === 404
          ? fail({ _tag: "NotFound", url })
          : !res.ok
            ? fail({ _tag: "Network", message: `bad status ${res.status}` })
            : succeed(res.body)
      ),
      retryNetwork
    ),
}

// ---- compose everything, then run. mirrors with-effect.ts's `program` 1:1. ----
const program = pipe(
  loadUserPosts(1),
  timeout(2000),
  tap((result) => sync(() => console.log(`loaded ${result.length} posts`))),
  catchTags({
    NotFound: (e) => sync(() => console.log(`not found: ${e.url}`)),
    Network: (e) => sync(() => console.log(`network: ${e.message}`)),
    Timeout: (e) => sync(() => console.log(`timeout: ${e.message}`)),
  }),
  provide("Http", HttpLive)
)

// run(program, (exit) => {
//   console.log("\nEXIT:", exit._tag)
//   console.log(JSON.stringify(exit._tag === "Success" ? exit.value : exit.failure, null, 2))
// })

// ============================== scratch programs ==============================
// small ones to step through in the debugger. swap which line runs at the bottom.

// simplest: transform a pure value
const program2 = pipe(
  succeed(1),
  map((x) => x + 1)
)

// a service + provide
const program3 = pipe(
  getUser(1),
  map((user) => user.name.toUpperCase()),
  provide("Http", HttpLive)
)

// async, the right way: tryPromise over a Promise that resolves after 100ms
const program4 = pipe(
  tryPromise({
    try: () => new Promise<string>((resolve) => setTimeout(() => resolve("world"), 100)),
    catch: (e) => e,
  }),
  map((r: string) => r.toUpperCase())
)

const syncDouble = (x: number) => {
  return sync(() => x * 2)
}
const asyncDouble = (n: number) =>
  tryPromise({
    try: () => new Promise<number>((resolve) => resolve(n * 2)),
    catch: (e) => e,
  })

const program5 = pipe(
  succeed(10),
  flatMap((a) => asyncDouble(a)),
  flatMap((b) => syncDouble(b))
)

const program6 = pipe(
  fail(5),
  catchAll((err) => succeed(`recovered from ${err}`)) // return an EFFECT, not a raw value
)

// nested: an error deep inside, caught by an OUTER catchAll only because the
// inner handler re-fails. shows depth + rethrow + nearest-handler-wins.
const program7 = pipe(
  succeed(1),
  flatMap(() => fail("boom")), // fails deep in the chain
  flatMap(() => succeed(2)),
  catchAll((err) => fail(`inner saw ${err}, rethrowing`)), // inner: transforms + re-fails
  catchAll((err) => succeed(`outer recovered: ${err}`)) // outer: finally recovers
)

const program8 = pipe(
  fail({ _tag: "FooError", message: "hi, i'm an error" }),
  (e) => retry(e, 3, (e) => e._tag === "FooError"),
)

const program9 = pipe(
  succeed(1),
  map((x) => x + 1),
)

run(program9, console.log)
