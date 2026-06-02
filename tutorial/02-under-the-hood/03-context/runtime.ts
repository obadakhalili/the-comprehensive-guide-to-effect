// =================================================================
// A toy Effect — Part 3: context (dependencies).
//
// New: a third type parameter R (Requirements), a `Tag` to name a dependency,
// and `service` / `provide` to read and supply one.
//
// R is modeled as a union of the dependency keys an effect still needs. `service`
// adds a key to R; `provide` removes one. When R is `never`, nothing is missing
// and the effect can run.
// =================================================================

// ---------- the public, opaque Effect type (now with R) ----------
declare const TypeId: unique symbol
export interface Effect<out A, out E = never, out R = never> {
  readonly [TypeId]: {
    readonly _A: (_: never) => A
    readonly _E: (_: never) => E
    readonly _R: (_: never) => R
  }
}

// ---------- a Tag names a dependency and remembers its service type ----------
declare const TagTypeId: unique symbol
export interface Tag<Id extends string, Service> {
  readonly key: Id
  readonly [TagTypeId]: (_: never) => Service
}
// makeTag<Service>()("Key") — the curry lets you pin Service, then name it.
export const makeTag =
  <Service>() =>
  <const Id extends string>(key: Id): Tag<Id, Service> =>
    ({ key }) as unknown as Tag<Id, Service>

// ---------- the internal nodes ----------
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
  // NEW: read a dependency by key from the context.
  | { readonly _op: "Service"; readonly key: string }
  // NEW: add a dependency to the context for the duration of `self`.
  | {
      readonly _op: "Provide"
      readonly self: Effect<unknown, unknown, unknown>
      readonly key: string
      readonly impl: unknown
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

// NEW: ask the context for a service. this is the effect that PRODUCES the
// dependency — and records that it's NEEDED, by putting the tag's key in R.
export const service = <Id extends string, Service>(tag: Tag<Id, Service>): Effect<Service, never, Id> =>
  fromPrimitive({ _op: "Service", key: tag.key }) as Effect<Service, never, Id>

// NEW: supply a service for `self`. this SATISFIES the requirement — it removes
// the tag's key from R (Exclude<R, Id>).
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

// ---------- combinators (now threading R) ----------
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

// ---------- the result of running ----------
export type Exit<A, E> =
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly error: E }

// ---------- the runtime ----------
// frames now come in two kinds: a postponed step, and a context restore.
type Frame =
  | { readonly _op: "OnSuccess"; readonly f: (a: unknown) => Effect<unknown, unknown, unknown> }
  | { readonly _op: "RestoreContext"; readonly context: Map<string, unknown> }

const unsafeRun = <A, E>(effect: Effect<A, E, never>, onExit: (exit: Exit<A, E>) => void): void => {
  let current: Primitive | null = toPrimitive(effect as Effect<unknown, unknown, unknown>)
  const stack: Frame[] = []
  let value: unknown = undefined
  let failure: unknown = undefined
  let inFailure = false
  let context = new Map<string, unknown>() // NEW: the dependency register

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
            // found → produce it as the value; missing → fail (R should prevent this).
            if (context.has(node.key)) {
              value = context.get(node.key)
              inFailure = false
            } else {
              failure = { _tag: "MissingService", key: node.key }
              inFailure = true
            }
            break
          case "Provide": {
            // copy the context, add the impl, and schedule a restore for after self.
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
          // transparent: fix the context, keep unwinding (whether value or failure).
          context = frame.context
          frame = stack.pop()
          continue
        }
        if (!inFailure) {
          current = toPrimitive(frame.f(value))
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

// runners require R = never: every dependency must be provided before running.
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
