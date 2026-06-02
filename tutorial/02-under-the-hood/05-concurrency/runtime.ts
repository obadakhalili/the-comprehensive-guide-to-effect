// =================================================================
// A toy Effect — Part 5: concurrency.
//
// New methods: fork, raceFirst, forEachConcurrent (plus sleep, timeout).
// New idea: more than one walk of the tree at the same time. Each walk is a
// Fiber — its own current/stack/registers. fork starts a second one; race and
// forEach wait on several and can interrupt the ones they no longer need.
// =================================================================

declare const TypeId: unique symbol
export interface Effect<out A, out E = never, out R = never> {
  readonly [TypeId]: {
    readonly _A: (_: never) => A
    readonly _E: (_: never) => E
    readonly _R: (_: never) => R
  }
}
type SuccessOf<T> = [T] extends [Effect<infer A, any, any>] ? A : never
type ErrorOf<T> = [T] extends [Effect<any, infer E, any>] ? E : never
type ContextOf<T> = [T] extends [Effect<any, any, infer R>] ? R : never

declare const TagTypeId: unique symbol
export interface Tag<Id extends string, Service> {
  readonly key: Id
  readonly [TagTypeId]: (_: never) => Service
}
export const makeTag =
  <Service>() =>
  <const Id extends string>(key: Id): Tag<Id, Service> =>
    ({ key }) as unknown as Tag<Id, Service>

// a Fiber is a running effect you can wait on. (the value fork hands back.)
declare const FiberTypeId: unique symbol
export interface Fiber<out A, out E> {
  readonly [FiberTypeId]: {
    readonly _A: (_: never) => A
    readonly _E: (_: never) => E
  }
}

export interface TimeoutError {
  readonly _tag: "Timeout"
  readonly ms: number
}

// ---------- internal nodes ----------
type Primitive =
  | { readonly _op: "Succeed"; readonly value: unknown }
  | { readonly _op: "Failure"; readonly error: unknown }
  | { readonly _op: "Sync"; readonly thunk: () => unknown }
  | {
      readonly _op: "OnSuccess"
      readonly self: Effect<unknown, unknown, unknown>
      readonly f: (a: unknown) => Effect<unknown, unknown, unknown>
    }
  | {
      readonly _op: "Async"
      readonly register: (resume: (effect: Effect<unknown, unknown, unknown>) => void) => (() => void) | void
    }
  | { readonly _op: "Service"; readonly key: string }
  | {
      readonly _op: "Provide"
      readonly self: Effect<unknown, unknown, unknown>
      readonly key: string
      readonly impl: unknown
    }
  | {
      readonly _op: "OnFailure"
      readonly self: Effect<unknown, unknown, unknown>
      readonly g: (e: unknown) => Effect<unknown, unknown, unknown>
    }
  // NEW: start `self` as a separate fiber, hand back a handle to it.
  | { readonly _op: "Fork"; readonly self: Effect<unknown, unknown, unknown> }

const fromPrimitive = (p: Primitive): Effect<unknown, unknown, unknown> =>
  p as unknown as Effect<unknown, unknown, unknown>
const toPrimitive = (e: Effect<unknown, unknown, unknown>): Primitive => e as unknown as Primitive

// ---------- result ----------
export type Exit<A, E> =
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly error: E }

const exitToEffect = (exit: Exit<unknown, unknown>): Effect<unknown, unknown, unknown> =>
  exit._tag === "Success" ? succeed(exit.value) : fail(exit.error)

// ---------- constructors ----------
export const succeed = <A>(value: A): Effect<A> => fromPrimitive({ _op: "Succeed", value }) as Effect<A>
export const fail = <E>(error: E): Effect<never, E> => fromPrimitive({ _op: "Failure", error }) as Effect<never, E>
export const sync = <A>(thunk: () => A): Effect<A> => fromPrimitive({ _op: "Sync", thunk }) as Effect<A>

// async's register can now return a canceler — called if the fiber is interrupted.
export const async = <A, E = never>(
  register: (resume: (effect: Effect<A, E>) => void) => (() => void) | void
): Effect<A, E> =>
  fromPrimitive({
    _op: "Async",
    register: register as (resume: (effect: Effect<unknown, unknown, unknown>) => void) => (() => void) | void,
  }) as Effect<A, E>

export const tryPromise = <A, E>(options: {
  try: () => Promise<A>
  catch: (error: unknown) => E
}): Effect<A, E> =>
  async<A, E>((resume) => {
    options.try().then(
      (value) => resume(succeed(value)),
      (error) => resume(fail(options.catch(error)))
    )
  })

// resume after `ms`. the canceler clears the timer if we're interrupted.
export const sleep = (ms: number): Effect<void> =>
  async<void>((resume) => {
    const timer = setTimeout(() => resume(succeed(undefined)), ms)
    return () => clearTimeout(timer)
  })

export const service = <Id extends string, Service>(tag: Tag<Id, Service>): Effect<Service, never, Id> =>
  fromPrimitive({ _op: "Service", key: tag.key }) as Effect<Service, never, Id>

export const provide = <A, E, R, Id extends string, Service>(
  self: Effect<A, E, R>,
  tag: Tag<Id, Service>,
  impl: Service
): Effect<A, E, Exclude<R, Id>> =>
  fromPrimitive({
    _op: "Provide",
    self: self as Effect<unknown, unknown, unknown>,
    key: tag.key,
    impl,
  }) as Effect<A, E, Exclude<R, Id>>

// NEW: start `self` as its own fiber. returns immediately with a handle.
export const fork = <A, E, R>(self: Effect<A, E, R>): Effect<Fiber<A, E>, never, R> =>
  fromPrimitive({ _op: "Fork", self: self as Effect<unknown, unknown, unknown> }) as Effect<Fiber<A, E>, never, R>

// ---------- combinators ----------
export const flatMap = <A, B, E1, E2, R1, R2>(
  self: Effect<A, E1, R1>,
  f: (a: A) => Effect<B, E2, R2>
): Effect<B, E1 | E2, R1 | R2> =>
  fromPrimitive({
    _op: "OnSuccess",
    self: self as Effect<unknown, unknown, unknown>,
    f: f as (a: unknown) => Effect<unknown, unknown, unknown>,
  }) as Effect<B, E1 | E2, R1 | R2>

export const map = <A, B, E, R>(self: Effect<A, E, R>, f: (a: A) => B): Effect<B, E, R> =>
  flatMap(self, (a) => sync(() => f(a)))

export const tap = <A, B, E1, E2, R1, R2>(
  self: Effect<A, E1, R1>,
  f: (a: A) => Effect<B, E2, R2>
): Effect<A, E1 | E2, R1 | R2> => flatMap(self, (a) => map(f(a), () => a))

export const catchAll = <A, E, R, B, E2, R2>(
  self: Effect<A, E, R>,
  g: (e: E) => Effect<B, E2, R2>
): Effect<A | B, E2, R | R2> =>
  fromPrimitive({
    _op: "OnFailure",
    self: self as Effect<unknown, unknown, unknown>,
    g: g as (e: unknown) => Effect<unknown, unknown, unknown>,
  }) as Effect<A | B, E2, R | R2>

export const catchTags = <
  A,
  E extends { _tag: string },
  R,
  H extends Partial<{
    [Tag in E["_tag"]]: (e: Extract<E, { _tag: Tag }>) => Effect<unknown, unknown, unknown>
  }>,
>(
  self: Effect<A, E, R>,
  handlers: H
): Effect<
  A | SuccessOf<ReturnType<NonNullable<H[keyof H]>>>,
  Exclude<E, { _tag: keyof H }> | ErrorOf<ReturnType<NonNullable<H[keyof H]>>>,
  R | ContextOf<ReturnType<NonNullable<H[keyof H]>>>
> =>
  catchAll(self, (e) => {
    const error = e as { _tag: string }
    const handler = (handlers as Record<string, ((e: unknown) => Effect<unknown, unknown, unknown>) | undefined>)[
      error._tag
    ]
    return handler ? handler(error) : fail(error)
  }) as unknown as Effect<
    A | SuccessOf<ReturnType<NonNullable<H[keyof H]>>>,
    Exclude<E, { _tag: keyof H }> | ErrorOf<ReturnType<NonNullable<H[keyof H]>>>,
    R | ContextOf<ReturnType<NonNullable<H[keyof H]>>>
  >

export const retry = <A, E, R>(
  self: Effect<A, E, R>,
  options: { times: number; while: (e: E) => boolean }
): Effect<A, E, R> =>
  catchAll(self, (e) =>
    options.times > 0 && options.while(e)
      ? retry(self, { times: options.times - 1, while: options.while })
      : fail(e)
  )

// ---------- the runtime: a Fiber is one walk of the tree ----------
type Frame =
  | { readonly _op: "OnSuccess"; readonly f: (a: unknown) => Effect<unknown, unknown, unknown> }
  | { readonly _op: "OnFailure"; readonly g: (e: unknown) => Effect<unknown, unknown, unknown> }
  | { readonly _op: "RestoreContext"; readonly context: Map<string, unknown> }

class FiberRuntime {
  current: Primitive | null
  stack: Frame[] = []
  value: unknown = undefined
  failure: unknown = undefined
  inFailure = false
  context: Map<string, unknown>
  done = false
  exitValue: Exit<unknown, unknown> | null = null
  observers: Array<(exit: Exit<unknown, unknown>) => void> = []
  suspended = false
  canceler: (() => void) | null = null

  constructor(effect: Effect<unknown, unknown, unknown>, context: Map<string, unknown>) {
    this.current = toPrimitive(effect)
    this.context = new Map(context)
  }

  addObserver(cb: (exit: Exit<unknown, unknown>) => void): void {
    if (this.done) cb(this.exitValue!)
    else this.observers.push(cb)
  }

  complete(exit: Exit<unknown, unknown>): void {
    this.done = true
    this.exitValue = exit
    for (const observer of this.observers) observer(exit)
  }

  // interrupt a fiber parked on an Async: cancel the pending work, then resume it
  // straight into a failure so its stack can unwind. best-effort in this toy: a
  // fiber that hasn't suspended yet can't be stopped.
  interrupt(): void {
    if (this.done || !this.suspended) return
    const canceler = this.canceler
    this.canceler = null
    this.suspended = false
    if (canceler) canceler()
    this.failure = { _tag: "Interrupted" }
    this.inFailure = true
    this.current = null
    this.step()
  }

  step(): void {
    while (true) {
      if (this.current !== null) {
        const node: Primitive = this.current
        this.current = null
        switch (node._op) {
          case "Succeed":
            this.value = node.value
            this.inFailure = false
            break
          case "Failure":
            this.failure = node.error
            this.inFailure = true
            break
          case "Sync":
            try {
              this.value = node.thunk()
              this.inFailure = false
            } catch (e) {
              this.failure = e
              this.inFailure = true
            }
            break
          case "OnSuccess":
            this.stack.push({ _op: "OnSuccess", f: node.f })
            this.current = toPrimitive(node.self)
            continue
          case "OnFailure":
            this.stack.push({ _op: "OnFailure", g: node.g })
            this.current = toPrimitive(node.self)
            continue
          case "Async": {
            let resumed = false
            const resume = (next: Effect<unknown, unknown, unknown>): void => {
              if (resumed) return
              resumed = true
              this.suspended = false
              this.canceler = null
              this.current = toPrimitive(next)
              this.step()
            }
            this.suspended = true
            this.canceler = node.register(resume) ?? null
            return
          }
          case "Service":
            if (this.context.has(node.key)) {
              this.value = this.context.get(node.key)
              this.inFailure = false
            } else {
              this.failure = { _tag: "MissingService", key: node.key }
              this.inFailure = true
            }
            break
          case "Provide": {
            const previous = this.context
            this.context = new Map(previous)
            this.context.set(node.key, node.impl)
            this.stack.push({ _op: "RestoreContext", context: previous })
            this.current = toPrimitive(node.self)
            continue
          }
          case "Fork": {
            // a new fiber, sharing this one's context, scheduled to run soon.
            const child = new FiberRuntime(node.self, this.context)
            queueMicrotask(() => child.step())
            this.value = child
            this.inFailure = false
            break
          }
        }
      }

      let frame = this.stack.pop()
      while (frame) {
        if (frame._op === "RestoreContext") {
          this.context = frame.context
          frame = this.stack.pop()
          continue
        }
        if (!this.inFailure && frame._op === "OnSuccess") {
          this.current = toPrimitive(frame.f(this.value))
          break
        }
        if (this.inFailure && frame._op === "OnFailure") {
          this.current = toPrimitive(frame.g(this.failure))
          break
        }
        frame = this.stack.pop()
      }

      if (this.current === null) {
        return this.complete(
          this.inFailure ? { _tag: "Failure", error: this.failure } : { _tag: "Success", value: this.value }
        )
      }
    }
  }
}

const asRuntime = (fiber: Fiber<unknown, unknown>): FiberRuntime => fiber as unknown as FiberRuntime

// NEW: run a & b at once; take the first to finish, interrupt the other.
export const raceFirst = <A, E1, R1, B, E2, R2>(
  a: Effect<A, E1, R1>,
  b: Effect<B, E2, R2>
): Effect<A | B, E1 | E2, R1 | R2> => {
  return flatMap(fork(a), (fa) =>
    flatMap(fork(b), (fb) =>
      async<A | B, E1 | E2>((resume) => {
        const ra = asRuntime(fa)
        const rb = asRuntime(fb)
        let settled = false
        const onSettle =
          (loser: FiberRuntime) =>
          (exit: Exit<unknown, unknown>): void => {
            if (settled) return
            settled = true
            loser.interrupt()
            resume(exitToEffect(exit) as Effect<A | B, E1 | E2>)
          }
        ra.addObserver(onSettle(rb))
        rb.addObserver(onSettle(ra))
      })
    )
  )
}

// NEW: run f over every item at once; collect results in order. if any fails,
// interrupt the rest and fail.
export const forEachConcurrent = <A, B, E, R>(
  items: readonly A[],
  f: (a: A) => Effect<B, E, R>
): Effect<B[], E, R> => {
  let forkAll: Effect<FiberRuntime[], never, R> = succeed([])
  for (const item of items) {
    forkAll = flatMap(forkAll, (acc) => map(fork(f(item)), (fb) => [...acc, asRuntime(fb)]))
  }
  return flatMap(forkAll, (fibers) =>
    async<B[], E>((resume) => {
      const results: B[] = new Array(fibers.length)
      let remaining = fibers.length
      let settled = false
      if (remaining === 0) return resume(succeed([]))
      fibers.forEach((fb, i) =>
        fb.addObserver((exit) => {
          if (settled) return
          if (exit._tag === "Failure") {
            settled = true
            for (const other of fibers) if (other !== fb) other.interrupt()
            return resume(fail(exit.error) as Effect<B[], E>)
          }
          results[i] = exit.value as B
          if (--remaining === 0) {
            settled = true
            resume(succeed(results))
          }
        })
      )
    })
  )
}

// NEW: race the work against a sleep that fails. built on raceFirst.
export const timeout = <A, E, R>(self: Effect<A, E, R>, ms: number): Effect<A, E | TimeoutError, R> =>
  raceFirst(self, flatMap(sleep(ms), () => fail<TimeoutError>({ _tag: "Timeout", ms })))

// ---------- runners ----------
const unsafeRun = <A, E>(effect: Effect<A, E, never>, onExit: (exit: Exit<A, E>) => void): void => {
  const root = new FiberRuntime(effect as Effect<unknown, unknown, unknown>, new Map())
  root.addObserver((exit) => onExit(exit as Exit<A, E>))
  root.step()
}

export const runPromiseExit = <A, E>(effect: Effect<A, E, never>): Promise<Exit<A, E>> =>
  new Promise((resolve) => unsafeRun(effect, resolve))

export const runPromise = <A, E>(effect: Effect<A, E, never>): Promise<A> =>
  runPromiseExit(effect).then((exit) => {
    if (exit._tag === "Failure") return Promise.reject(exit.error)
    return exit.value
  })

export const runSyncExit = <A, E>(effect: Effect<A, E, never>): Exit<A, E> => {
  let result: Exit<A, E> | undefined
  unsafeRun(effect, (exit) => {
    result = exit
  })
  if (result === undefined) {
    throw new Error("runSyncExit: this effect is async — use runPromise instead")
  }
  return result
}

export const runSync = <A, E>(effect: Effect<A, E, never>): A => {
  const exit = runSyncExit(effect)
  if (exit._tag === "Failure") throw exit.error
  return exit.value
}
