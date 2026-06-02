// =================================================================
// A toy Effect — Part 4: error handling.
//
// New methods: catchAll, catchTags, retry.
// New node: OnFailure. So far a failure unwinds everything; now a frame can
// catch it. catchTags and retry are both built on catchAll — no new primitive.
// =================================================================

declare const TypeId: unique symbol
export interface Effect<out A, out E = never, out R = never> {
  readonly [TypeId]: {
    readonly _A: (_: never) => A
    readonly _E: (_: never) => E
    readonly _R: (_: never) => R
  }
}

// helpers to read A / E / R back out of an Effect type (used by catchTags).
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
      readonly register: (resume: (effect: Effect<unknown, unknown, unknown>) => void) => void
    }
  | { readonly _op: "Service"; readonly key: string }
  | {
      readonly _op: "Provide"
      readonly self: Effect<unknown, unknown, unknown>
      readonly key: string
      readonly impl: unknown
    }
  // NEW: run self; if it fails, hand the error to g, which returns the next effect.
  | {
      readonly _op: "OnFailure"
      readonly self: Effect<unknown, unknown, unknown>
      readonly g: (e: unknown) => Effect<unknown, unknown, unknown>
    }

const fromPrimitive = (p: Primitive): Effect<unknown, unknown, unknown> =>
  p as unknown as Effect<unknown, unknown, unknown>
const toPrimitive = (e: Effect<unknown, unknown, unknown>): Primitive => e as unknown as Primitive

// ---------- constructors ----------
export const succeed = <A>(value: A): Effect<A> => fromPrimitive({ _op: "Succeed", value }) as Effect<A>
export const fail = <E>(error: E): Effect<never, E> => fromPrimitive({ _op: "Failure", error }) as Effect<never, E>
export const sync = <A>(thunk: () => A): Effect<A> => fromPrimitive({ _op: "Sync", thunk }) as Effect<A>

export const async = <A, E = never>(
  register: (resume: (effect: Effect<A, E>) => void) => void
): Effect<A, E> =>
  fromPrimitive({
    _op: "Async",
    register: register as (resume: (effect: Effect<unknown, unknown, unknown>) => void) => void,
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

// NEW: if self fails, run g with the error. on success, g is skipped.
// note how the error type changes from E to E2 — the failure is "handled away".
export const catchAll = <A, E, R, B, E2, R2>(
  self: Effect<A, E, R>,
  g: (e: E) => Effect<B, E2, R2>
): Effect<A | B, E2, R | R2> =>
  fromPrimitive({
    _op: "OnFailure",
    self: self as Effect<unknown, unknown, unknown>,
    g: g as (e: unknown) => Effect<unknown, unknown, unknown>,
  }) as Effect<A | B, E2, R | R2>

// NEW: a catchAll that dispatches on the error's _tag. handlers is a partial map
// from tag to handler; tags you don't handle stay in the error type.
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

// NEW: run self again on failure, up to `times`, but only while `while` holds.
// pure sugar over catchAll that points back at the same effect.
export const retry = <A, E, R>(
  self: Effect<A, E, R>,
  options: { times: number; while: (e: E) => boolean }
): Effect<A, E, R> =>
  catchAll(self, (e) =>
    options.times > 0 && options.while(e)
      ? retry(self, { times: options.times - 1, while: options.while })
      : fail(e)
  )

// ---------- result ----------
export type Exit<A, E> =
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly error: E }

// ---------- runtime ----------
type Frame =
  | { readonly _op: "OnSuccess"; readonly f: (a: unknown) => Effect<unknown, unknown, unknown> }
  | { readonly _op: "OnFailure"; readonly g: (e: unknown) => Effect<unknown, unknown, unknown> }
  | { readonly _op: "RestoreContext"; readonly context: Map<string, unknown> }

const unsafeRun = <A, E>(effect: Effect<A, E, never>, onExit: (exit: Exit<A, E>) => void): void => {
  let current: Primitive | null = toPrimitive(effect as Effect<unknown, unknown, unknown>)
  const stack: Frame[] = []
  let value: unknown = undefined
  let failure: unknown = undefined
  let inFailure = false
  let context = new Map<string, unknown>()

  const step = (): void => {
    while (true) {
      if (current !== null) {
        const node: Primitive = current
        current = null
        switch (node._op) {
          case "Succeed":
            value = node.value
            inFailure = false
            break
          case "Failure":
            failure = node.error
            inFailure = true
            break
          case "Sync":
            try {
              value = node.thunk()
              inFailure = false
            } catch (e) {
              failure = e
              inFailure = true
            }
            break
          case "OnSuccess":
            stack.push({ _op: "OnSuccess", f: node.f })
            current = toPrimitive(node.self)
            continue
          case "OnFailure":
            stack.push({ _op: "OnFailure", g: node.g })
            current = toPrimitive(node.self)
            continue
          case "Async": {
            let resumed = false
            const resume = (next: Effect<unknown, unknown, unknown>): void => {
              if (resumed) return
              resumed = true
              current = toPrimitive(next)
              step()
            }
            node.register(resume)
            return
          }
          case "Service":
            if (context.has(node.key)) {
              value = context.get(node.key)
              inFailure = false
            } else {
              failure = { _tag: "MissingService", key: node.key }
              inFailure = true
            }
            break
          case "Provide": {
            const previous = context
            context = new Map(previous)
            context.set(node.key, node.impl)
            stack.push({ _op: "RestoreContext", context: previous })
            current = toPrimitive(node.self)
            continue
          }
        }
      }

      let frame = stack.pop()
      while (frame) {
        if (frame._op === "RestoreContext") {
          context = frame.context
          frame = stack.pop()
          continue
        }
        // a value runs the next OnSuccess and skips OnFailure;
        // a failure runs the next OnFailure and skips OnSuccess (short-circuit).
        if (!inFailure && frame._op === "OnSuccess") {
          current = toPrimitive(frame.f(value))
          break
        }
        if (inFailure && frame._op === "OnFailure") {
          current = toPrimitive(frame.g(failure))
          break
        }
        frame = stack.pop()
      }

      if (current === null) {
        return onExit(inFailure ? { _tag: "Failure", error: failure as E } : { _tag: "Success", value: value as A })
      }
    }
  }

  step()
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
