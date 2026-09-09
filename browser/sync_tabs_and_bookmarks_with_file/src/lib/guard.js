// The user chose a single overwritten file with no history, so a bad snapshot is
// unrecoverable. This is the cheap insurance: refuse writes that look like data loss
// rather than data change. The realistic case it targets is the browser still starting
// up, reporting one blank window, when the interval alarm happens to fire.

const MIN_SURVIVING_FRACTION = 0.1

export function checkWrite({ count, previousCount, force = false }) {
  if (force) return { ok: true, reason: null }
  if (previousCount === undefined || previousCount === 0) return { ok: true, reason: null }

  if (count === 0) {
    return { ok: false, reason: `Refused to write an empty snapshot (previously ${previousCount} entries).` }
  }

  if (count < previousCount * MIN_SURVIVING_FRACTION) {
    return {
      ok: false,
      reason: `Refused to write ${count} entries, down from ${previousCount} — more than 90% lost.`,
    }
  }

  return { ok: true, reason: null }
}
