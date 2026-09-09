// Firefox exposes `browser` with promise-returning APIs; Chrome exposes `chrome`, which
// also returns promises for the APIs used here under MV3.
export const api = globalThis.browser ?? globalThis.chrome

export const browserKind = typeof globalThis.browser !== 'undefined' ? 'firefox' : 'chrome'
