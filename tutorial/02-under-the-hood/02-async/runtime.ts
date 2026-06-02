// =================================================================
// A toy Effect — Section 2.2: async.
//
// New methods: async, tryPromise.
// New idea: a node can take time. The loop pauses on it and resumes later.
// Because of that, running can no longer hand back a value immediately — it
// hands back a Promise. (runSync still exists, but refuses an async program.)
// =================================================================

// ---------- the public, opaque Effect type ----------
declare const TypeId: unique symbol
export interface Effect<out A, out E = never> {
  readonly [TypeId]: {
    readonly _A: (_: never) => A
    readonly _E: (_: never) => E
  }
}

// ---------- the internal nodes ----------
type Primitive =
  | { readonly _op: "Succeed"; readonly value: unknown }
  | { readonly _op: "Failure"; readonly error: unknown }
  | { readonly _op: "Sync"; readonly thunk: () => unknown }
  | {
      readonly _op: "OnSuccess"
      readonly self: Effect<unknown, unknown>
      readonly f: (a: unknown) => Effect<unknown, unknown>
    }
  // NEW: a node that doesn't finish now. it hands us a `resume` callback and we
  // step away; whatever it's waiting on calls resume(effect) when ready.
  | {
      readonly _op: "Async"
      readonly register: (resume: (effect: Effect<unknown, unknown>) => void) => void
    }

const fromPrimitive = (p: Primitive): Effect<unknown, unknown> => p as unknown as Effect<unknown, unknown>
const toPrimitive = (e: Effect<unknown, unknown>): Primitive => e as unknown as Primitive

// ---------- constructors ----------
export const succeed = <A>(value: A): Effect<A> => fromPrimitive({ _op: "Succeed", value }) as Effect<A>
export const fail = <E>(error: E): Effect<never, E> => fromPrimitive({ _op: "Failure", error }) as Effect<never, E>
export const sync = <A>(thunk: () => A): Effect<A> => fromPrimitive({ _op: "Sync", thunk }) as Effect<A>

// NEW: the raw async primitive. `register` starts some async work and calls
// `resume` with the resulting effect (a succeed or a fail) when it's done.
export const async = <A, E = never>(
  register: (resume: (effect: Effect<A, E>) => void) => void
): Effect<A, E> =>
  fromPrimitive({
    _op: "Async",
    register: register as (resume: (effect: Effect<unknown, unknown>) => void) => void,
  }) as Effect<A, E>

// NEW: wrap a Promise as an Effect. built entirely on `async`. no timers, no
// magic — start the promise, resume on settle.
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

// ---------- combinators ----------
export const flatMap = <A, B, E1, E2>(self: Effect<A, E1>, f: (a: A) => Effect<B, E2>): Effect<B, E1 | E2> =>
  fromPrimitive({
    _op: "OnSuccess",
    self: self as Effect<unknown, unknown>,
    f: f as (a: unknown) => Effect<unknown, unknown>,
  }) as Effect<B, E1 | E2>

export const map = <A, B, E>(self: Effect<A, E>, f: (a: A) => B): Effect<B, E> => flatMap(self, (a) => sync(() => f(a)))

export const tap = <A, B, E1, E2>(self: Effect<A, E1>, f: (a: A) => Effect<B, E2>): Effect<A, E1 | E2> =>
  flatMap(self, (a) => map(f(a), () => a))

// ---------- the result of running ----------
export type Exit<A, E> =
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly error: E }

// ---------- the runtime ----------
type Frame = (a: unknown) => Effect<unknown, unknown>

// the core engine. drives the loop and calls `onExit` when finished. on an Async
// node it returns early (parks); `resume` re-enters the loop later. note this is
// the SAME loop as Section 2.1 — we only added the Async case and the park/resume.
const unsafeRun = <A, E>(effect: Effect<A, E>, onExit: (exit: Exit<A, E>) => void): void => {
  let current: Primitive | null = toPrimitive(effect as Effect<unknown, unknown>)
  const stack: Frame[] = []
  let value: unknown = undefined
  let failure: unknown = undefined
  let inFailure = false

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
            stack.push(node.f)
            current = toPrimitive(node.self)
            continue
          case "Async": {
            // park. when the work is ready, resume sets the next node and
            // re-enters this same loop, with stack/value/failure untouched.
            let resumed = false
            const resume = (next: Effect<unknown, unknown>): void => {
              if (resumed) return
              resumed = true
              current = toPrimitive(next)
              step()
            }
            node.register(resume)
            return // leave the loop; the thread is free until resume is called
          }
        }
      }

      let frame = stack.pop()
      while (frame) {
        if (!inFailure) {
          current = toPrimitive(frame(value))
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

// run an effect that may be async; you always get a Promise of the Exit.
export const runPromiseExit = <A, E>(effect: Effect<A, E>): Promise<Exit<A, E>> =>
  new Promise((resolve) => unsafeRun(effect, resolve))

// run an effect that may be async; resolve with the value or reject with the error.
export const runPromise = <A, E>(effect: Effect<A, E>): Promise<A> =>
  runPromiseExit(effect).then((exit) => {
    if (exit._tag === "Failure") return Promise.reject(exit.error)
    return exit.value
  })

// run a FULLY SYNCHRONOUS effect now. if it turns out to be async (it parks),
// there's no value to hand back, so we throw — like real Effect's runSync.
export const runSyncExit = <A, E>(effect: Effect<A, E>): Exit<A, E> => {
  let result: Exit<A, E> | undefined
  unsafeRun(effect, (exit) => {
    result = exit
  })
  if (result === undefined) {
    throw new Error("runSyncExit: this effect is async — use runPromise instead")
  }
  return result
}
