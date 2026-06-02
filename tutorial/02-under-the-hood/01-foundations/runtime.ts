// =================================================================
// A toy Effect — Section 2.1: foundations.
//
// Methods: succeed, fail, sync, flatMap, map, tap.
// The whole idea in one file: an Effect is a data structure, and a loop runs it.
//
// Two representations live here:
//   - the PUBLIC type `Effect<A, E>` is opaque. it carries the types A and E and
//     nothing else. this is what users see, and it's what makes inference work.
//   - the INTERNAL `Primitive` is the actual object the runtime walks. every
//     constructor builds a Primitive and casts it to Effect; the runtime casts
//     back. this split — typed surface, untyped core — is how real Effect is built.
// =================================================================

// ---------- the public, opaque Effect type ----------
declare const TypeId: unique symbol
export interface Effect<out A, out E = never> {
  readonly [TypeId]: {
    readonly _A: (_: never) => A
    readonly _E: (_: never) => E
  }
}

// ---------- the internal nodes the runtime understands ----------
type Primitive =
  | { readonly _op: "Succeed"; readonly value: unknown }
  | { readonly _op: "Failure"; readonly error: unknown }
  | { readonly _op: "Sync"; readonly thunk: () => unknown }
  | {
      readonly _op: "OnSuccess"
      readonly self: Effect<unknown, unknown>
      readonly f: (a: unknown) => Effect<unknown, unknown>
    }

// the two casts that bridge the typed surface and the untyped core.
const fromPrimitive = (p: Primitive): Effect<unknown, unknown> => p as unknown as Effect<unknown, unknown>
const toPrimitive = (e: Effect<unknown, unknown>): Primitive => e as unknown as Primitive

// ---------- constructors ----------

// a value, right now. cannot fail.
export const succeed = <A>(value: A): Effect<A> => fromPrimitive({ _op: "Succeed", value }) as Effect<A>

// a failure, right now. no success value.
export const fail = <E>(error: E): Effect<never, E> => fromPrimitive({ _op: "Failure", error }) as Effect<never, E>

// a synchronous thunk the runtime runs when it reaches this node.
export const sync = <A>(thunk: () => A): Effect<A> => fromPrimitive({ _op: "Sync", thunk }) as Effect<A>

// ---------- combinators ----------

// run `self`, then feed its value to `f`, which returns the NEXT effect.
export const flatMap = <A, B, E1, E2>(self: Effect<A, E1>, f: (a: A) => Effect<B, E2>): Effect<B, E1 | E2> =>
  fromPrimitive({
    _op: "OnSuccess",
    self: self as Effect<unknown, unknown>,
    f: f as (a: unknown) => Effect<unknown, unknown>,
  }) as Effect<B, E1 | E2>

// run `self`, then transform its value with `f`, which returns a plain value.
// map is flatMap where we wrap the plain result back into an effect.
export const map = <A, B, E>(self: Effect<A, E>, f: (a: A) => B): Effect<B, E> => flatMap(self, (a) => sync(() => f(a)))

// run `self`, run the effect `f` returns for its side effect, then keep the
// ORIGINAL value. used to do something in the middle without changing the value.
export const tap = <A, B, E1, E2>(self: Effect<A, E1>, f: (a: A) => Effect<B, E2>): Effect<A, E1 | E2> =>
  flatMap(self, (a) => map(f(a), () => a))

// ---------- the result of running ----------
export type Exit<A, E> =
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly error: E }

// ---------- the runtime: a loop that walks the tree ----------
// a frame is a postponed step: an `f` waiting for the value its child will produce.
type Frame = (a: unknown) => Effect<unknown, unknown>

export const runSyncExit = <A, E>(effect: Effect<A, E>): Exit<A, E> => {
  let current: Primitive | null = toPrimitive(effect as Effect<unknown, unknown>)
  const stack: Frame[] = []
  let value: unknown = undefined // the success register
  let failure: unknown = undefined // the failure register
  let inFailure = false // which register is live

  while (true) {
    // 1. evaluate the current node (if any)
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
          // postpone f, go run the child first.
          stack.push(node.f)
          current = toPrimitive(node.self)
          continue
      }
    }

    // 2. carry the result up the stack to the next step that wants it.
    let frame = stack.pop()
    while (frame) {
      if (!inFailure) {
        // a value meets a postponed step → run it.
        current = toPrimitive(frame(value))
        break
      }
      // a failure skips postponed (success) steps. this is the short-circuit:
      // once we're failing, the rest of the happy path is thrown away.
      frame = stack.pop()
    }

    // 3. nothing left to run → we're done.
    if (current === null) {
      return inFailure ? { _tag: "Failure", error: failure as E } : { _tag: "Success", value: value as A }
    }
  }
}

// convenience: run and return the value, or throw the failure.
export const runSync = <A, E>(effect: Effect<A, E>): A => {
  const exit = runSyncExit(effect)
  if (exit._tag === "Failure") throw exit.error
  return exit.value
}
