// Sound.
//
// Everything is synthesized from a few oscillators — no audio files, no
// licences, and nothing to download. Short blips suit a simulation better than
// stock foley anyway, and the master gain is deliberately low: this is feedback,
// not a soundtrack.
//
// The interesting half of this file is `cuesForTransition`, which is pure. All
// the trigger logic lives there, driven by diffing consecutive store states, so
// the rules can be tested without an AudioContext and without a single play()
// call sprinkled through the store or the components.

export type Cue =
  | 'place'
  | 'connect'
  | 'run-start'
  | 'spike'
  | 'outage'
  | 'probe'
  | 'attack'
  | 'incident'
  | 'result-great'
  | 'result-ok'
  | 'result-poor'
  | 'achievement'

/** The slice of store state the cue rules look at. Kept narrow on purpose. */
export interface SoundState {
  phase: 'edit' | 'run' | 'results'
  runPhase: 'baseline' | 'spike' | 'recovery' | 'outage' | 'probe'
  attackRps: number
  hasPendingDecision: boolean
  stars: number | null
  nodeCount: number
  edgeCount: number
  achievementCount: number
}

/**
 * What to play, given where the store was and where it just went.
 *
 * Everything here keys off a *transition*, never off a state — a level whose
 * spike is a square wave re-enters that phase ten times a run, and per-tick
 * values like attack rps change on every single tick. Playing on the state
 * rather than the edge would turn either of those into a machine gun.
 */
export function cuesForTransition(prev: SoundState, next: SoundState): Cue[] {
  const cues: Cue[] = []

  // Building. Only while editing, so a canvas rebuilt by a reveal or a scenario
  // switch does not fire a burst of clicks.
  if (prev.phase === 'edit' && next.phase === 'edit') {
    if (next.nodeCount === prev.nodeCount + 1) cues.push('place')
    if (next.edgeCount === prev.edgeCount + 1) cues.push('connect')
  }

  if (prev.phase !== 'run' && next.phase === 'run') cues.push('run-start')

  // Phase changes, but only while a run is actually in progress.
  if (next.phase === 'run' && prev.runPhase !== next.runPhase) {
    if (next.runPhase === 'spike') cues.push('spike')
    if (next.runPhase === 'outage') cues.push('outage')
    if (next.runPhase === 'probe') cues.push('probe')
  }

  // The flood arriving is an event; the flood continuing is not.
  if (prev.attackRps === 0 && next.attackRps > 0) cues.push('attack')

  if (!prev.hasPendingDecision && next.hasPendingDecision) cues.push('incident')

  if (prev.stars === null && next.stars !== null) {
    cues.push(next.stars >= 3 ? 'result-great' : next.stars >= 1 ? 'result-ok' : 'result-poor')
  }

  if (next.achievementCount > prev.achievementCount) cues.push('achievement')

  return cues
}

// ---------------------------------------------------------------- synthesis

/** One oscillator note: frequency, when it starts, how long it lasts. */
interface Note {
  freq: number
  /** Seconds after the cue begins */
  at: number
  dur: number
  type?: OscillatorType
  gain?: number
}

// Kept quiet on purpose. Loud enough to notice, quiet enough to leave on.
const MASTER_GAIN = 0.09

const CUES: Record<Cue, Note[]> = {
  // Building: two soft, short taps that do not demand attention.
  place: [{ freq: 420, at: 0, dur: 0.06, type: 'sine' }],
  connect: [
    { freq: 520, at: 0, dur: 0.05, type: 'sine' },
    { freq: 780, at: 0.05, dur: 0.06, type: 'sine' },
  ],
  // A rising sweep: the run is starting.
  'run-start': [
    { freq: 330, at: 0, dur: 0.08, type: 'triangle' },
    { freq: 440, at: 0.07, dur: 0.08, type: 'triangle' },
    { freq: 660, at: 0.14, dur: 0.12, type: 'triangle' },
  ],
  // Traffic climbing: two urgent beeps, same shape as an alert tone.
  spike: [
    { freq: 720, at: 0, dur: 0.09, type: 'square', gain: 0.5 },
    { freq: 720, at: 0.13, dur: 0.09, type: 'square', gain: 0.5 },
  ],
  // Something died: a power-down slide.
  outage: [
    { freq: 400, at: 0, dur: 0.14, type: 'sawtooth', gain: 0.45 },
    { freq: 280, at: 0.12, dur: 0.16, type: 'sawtooth', gain: 0.45 },
    { freq: 170, at: 0.26, dur: 0.24, type: 'sawtooth', gain: 0.45 },
  ],
  // Someone is scanning you: a quiet, cold tick.
  probe: [
    { freq: 1400, at: 0, dur: 0.03, type: 'sine', gain: 0.5 },
    { freq: 1400, at: 0.09, dur: 0.03, type: 'sine', gain: 0.35 },
  ],
  // The botnet opens up: a two-tone klaxon.
  attack: [
    { freq: 300, at: 0, dur: 0.16, type: 'square', gain: 0.5 },
    { freq: 230, at: 0.16, dur: 0.2, type: 'square', gain: 0.5 },
  ],
  // The pager: three insistent beeps, the audio twin of the countdown bar.
  incident: [
    { freq: 880, at: 0, dur: 0.07, type: 'square', gain: 0.5 },
    { freq: 880, at: 0.11, dur: 0.07, type: 'square', gain: 0.5 },
    { freq: 880, at: 0.22, dur: 0.1, type: 'square', gain: 0.5 },
  ],
  // Three stars: a major arpeggio that lands on the octave.
  'result-great': [
    { freq: 523, at: 0, dur: 0.11, type: 'triangle' },
    { freq: 659, at: 0.1, dur: 0.11, type: 'triangle' },
    { freq: 784, at: 0.2, dur: 0.11, type: 'triangle' },
    { freq: 1047, at: 0.3, dur: 0.26, type: 'triangle' },
  ],
  // It ran, it just was not good: two flat notes, no verdict.
  'result-ok': [
    { freq: 523, at: 0, dur: 0.12, type: 'triangle' },
    { freq: 587, at: 0.12, dur: 0.2, type: 'triangle' },
  ],
  // It fell over: a descending minor third.
  'result-poor': [
    { freq: 392, at: 0, dur: 0.14, type: 'triangle' },
    { freq: 311, at: 0.13, dur: 0.28, type: 'triangle' },
  ],
  // A badge: a bright two-note sparkle, distinct from the results chord.
  achievement: [
    { freq: 1047, at: 0, dur: 0.07, type: 'sine' },
    { freq: 1568, at: 0.07, dur: 0.18, type: 'sine' },
  ],
}

let ctx: AudioContext | null = null

/** Created on the first cue, which always follows a click — browsers refuse to
 *  start an AudioContext any earlier, and one made too soon starts suspended. */
function audioContext(): AudioContext | null {
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Play one cue. A no-op anywhere without Web Audio, including under vitest. */
export function playCue(cue: Cue): void {
  const audio = audioContext()
  if (!audio) return
  const notes = CUES[cue]
  if (!notes) return

  const now = audio.currentTime
  for (const note of notes) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = note.type ?? 'sine'
    osc.frequency.value = note.freq

    // A short attack and an exponential decay. Without the ramps every note
    // starts and ends on a click, which is louder than the note itself.
    const peak = MASTER_GAIN * (note.gain ?? 1)
    const start = now + note.at
    const end = start + note.dur
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)

    osc.connect(gain)
    gain.connect(audio.destination)
    osc.start(start)
    osc.stop(end + 0.02)
  }
}
