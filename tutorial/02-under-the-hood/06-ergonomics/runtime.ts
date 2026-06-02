// =================================================================
// A toy Effect — Section 2.6: ergonomics (pipe + dual).
//
// No new runtime behavior. This part is pure source-level sugar: `pipe` to read
// chains top-to-bottom, and `dual` so each combinator works both standalone
// (`map(self, f)`) and inside a pipe (`pipe(self, map(f))`). By the time the
// runtime sees the effect, pipe and dual are gone — it's the same node tree.
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

// ---------- pipe and dual (the new bits) ----------

// pipe(x, f, g) = g(f(x)). plain left-to-right function application.
export function pipe<A>(a: A): A
export function pipe<A, B>(a: A, ab: (a: A) => B): B
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C
export function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D
export function pipe<A, B, C, D, E>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D, de: (d: D) => E): E
export function pipe<A, B, C, D, E, F>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F
): F
export function pipe<A, B, C, D, E, F, G>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G
): G
export function pipe<A, B, C, D, E, F, G, H>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H
): H
export function pipe(a: unknown, ...fns: Array<(x: unknown) => unknown>): unknown {
  return fns.reduce((acc, fn) => fn(acc), a)
}

// dual: if given >= arity args, run now (data-first). if given fewer, return a
// function waiting for `self` (data-last, for pipe). it always defers `self`.
const dual =
  (arity: number, body: (...args: any[]) => any) =>
  (...args: any[]): any =>
    args.length >= arity ? body(...args) : (self: any) => body(self, ...args)

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

// ---------- constructors (single-arg ones don't need dual) ----------
export const succeed = <A>(value: A): Effect<A> => fromPrimitive({ _op: "Succeed", value }) as Effect<A>
export const fail = <E>(error: E): Effect<never, E> => fromPrimitive({ _op: "Failure", error }) as Effect<never, E>
export const sync = <A>(thunk: () => A): Effect<A> => fromPrimitive({ _op: "Sync", thunk }) as Effect<A>

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

export const sleep = (ms: number): Effect<void> =>
  async<void>((resume) => {
    const timer = setTimeout(() => resume(succeed(undefined)), ms)
    return () => clearTimeout(timer)
  })

export const service = <Id extends string, Service>(tag: Tag<Id, Service>): Effect<Service, never, Id> =>
  fromPrimitive({ _op: "Service", key: tag.key }) as Effect<Service, never, Id>

// fork takes a single effect, so it's already pipe-friendly: pipe(self, fork).
export const fork = <A, E, R>(self: Effect<A, E, R>): Effect<Fiber<A, E>, never, R> =>
  fromPrimitive({ _op: "Fork", self: self as Effect<unknown, unknown, unknown> }) as Effect<Fiber<A, E>, never, R>

// ---------- combinators, now DUAL ----------
export const flatMap: {
  <A, B, E1, E2, R1, R2>(self: Effect<A, E1, R1>, f: (a: A) => Effect<B, E2, R2>): Effect<B, E1 | E2, R1 | R2>
  <A, B, E2, R2>(f: (a: A) => Effect<B, E2, R2>): <E1, R1>(self: Effect<A, E1, R1>) => Effect<B, E1 | E2, R1 | R2>
} = dual(2, (self: Effect<unknown, unknown, unknown>, f: (a: unknown) => Effect<unknown, unknown, unknown>) =>
  fromPrimitive({ _op: "OnSuccess", self, f })
)

export const map: {
  <A, B, E, R>(self: Effect<A, E, R>, f: (a: A) => B): Effect<B, E, R>
  <A, B>(f: (a: A) => B): <E, R>(self: Effect<A, E, R>) => Effect<B, E, R>
} = dual(2, (self: Effect<unknown, unknown, unknown>, f: (a: unknown) => unknown) =>
  flatMap(self, (a) => sync(() => f(a)))
)

export const tap: {
  <A, B, E1, E2, R1, R2>(self: Effect<A, E1, R1>, f: (a: A) => Effect<B, E2, R2>): Effect<A, E1 | E2, R1 | R2>
  <A, B, E2, R2>(f: (a: A) => Effect<B, E2, R2>): <E1, R1>(self: Effect<A, E1, R1>) => Effect<A, E1 | E2, R1 | R2>
} = dual(2, (self: Effect<unknown, unknown, unknown>, f: (a: unknown) => Effect<unknown, unknown, unknown>) =>
  flatMap(self, (a) => map(f(a), () => a))
)

export const catchAll: {
  <A, E, R, B, E2, R2>(self: Effect<A, E, R>, g: (e: E) => Effect<B, E2, R2>): Effect<A | B, E2, R | R2>
  <E, B, E2, R2>(g: (e: E) => Effect<B, E2, R2>): <A, R>(self: Effect<A, E, R>) => Effect<A | B, E2, R | R2>
} = dual(2, (self: Effect<unknown, unknown, unknown>, g: (e: unknown) => Effect<unknown, unknown, unknown>) =>
  fromPrimitive({ _op: "OnFailure", self, g })
)

export const retry: {
  <A, E, R>(self: Effect<A, E, R>, options: { times: number; while: (e: E) => boolean }): Effect<A, E, R>
  <A, E, R>(options: { times: number; while: (e: E) => boolean }): (self: Effect<A, E, R>) => Effect<A, E, R>
} = dual(2, (self: Effect<unknown, unknown, unknown>, options: { times: number; while: (e: unknown) => boolean }) =>
  catchAll(self, (e) =>
    options.times > 0 && options.while(e)
      ? retry(self as Effect<unknown, unknown, unknown>, { times: options.times - 1, while: options.while })
      : fail(e)
  )
)

export const timeout: {
  <A, E, R>(self: Effect<A, E, R>, ms: number): Effect<A, E | TimeoutError, R>
  (ms: number): <A, E, R>(self: Effect<A, E, R>) => Effect<A, E | TimeoutError, R>
} = dual(2, (self: Effect<unknown, unknown, unknown>, ms: number) =>
  raceFirst(self, flatMap(sleep(ms), () => fail<TimeoutError>({ _tag: "Timeout", ms })))
)

export const provide: {
  <A, E, R, Id extends string, Service>(
    self: Effect<A, E, R>,
    tag: Tag<Id, Service>,
    impl: Service
  ): Effect<A, E, Exclude<R, Id>>
  <Id extends string, Service>(
    tag: Tag<Id, Service>,
    impl: Service
  ): <A, E, R>(self: Effect<A, E, R>) => Effect<A, E, Exclude<R, Id>>
} = dual(3, (self: Effect<unknown, unknown, unknown>, tag: Tag<string, unknown>, impl: unknown) =>
  fromPrimitive({ _op: "Provide", self, key: tag.key, impl })
)

// catchTags is left data-first: its result type depends on which tags you handle,
// which makes the data-last form much hairier. the dual *principle* is identical.
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
  catchAll(self, (e: E) => {
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

// ---------- runtime (unchanged from Section 2.5) ----------
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

export const raceFirst = <A, E1, R1, B, E2, R2>(
  a: Effect<A, E1, R1>,
  b: Effect<B, E2, R2>
): Effect<A | B, E1 | E2, R1 | R2> =>
  flatMap(fork(a), (fa) =>
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
