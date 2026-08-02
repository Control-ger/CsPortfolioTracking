/**
 * Global UI sound system.
 *
 * Sounds are synthesized with the Web Audio API instead of shipping audio
 * files: no binary assets to license or bundle, a few hundred bytes of code,
 * and it satisfies the app CSP (`script-src 'self'`) without an external host.
 * Established libraries were considered and rejected — Howler.js and `use-sound`
 * are playback wrappers that still require the sample files we do not have, and
 * Tone.js is a ~200 kB synthesis engine for what amounts to a handful of blips.
 *
 * Preference is localStorage-backed (like the theme), deliberately not part of
 * the desktop `portfolioPreferences` blob: this is a pure client-side UI setting
 * and routing it through the preferences path would mean keeping three
 * normalization sites in sync for a mute toggle.
 */

const SOUND_ENABLED_KEY = "ui:sounds:enabled:v1";
const SOUND_VOLUME_KEY = "ui:sounds:volume:v1";

const DEFAULT_ENABLED = true;
const DEFAULT_VOLUME = 0.35;

let audioContext = null;
let masterGain = null;
let enabled = DEFAULT_ENABLED;
let volume = DEFAULT_VOLUME;
let initialized = false;
const listeners = new Set();

/**
 * Sound presets. Each is a short additive blip: an oscillator swept between two
 * frequencies through a percussive gain envelope. Keeping them under ~200ms
 * avoids the "toy" feel that longer synthesized tones have.
 *
 * `detune` is the half-width of the random pitch spread in cents (100 cents =
 * one semitone) applied per playback. Without it the same preset fired twice in
 * a row is audibly identical and the UI starts to sound like a metronome; a few
 * dozen cents of wobble reads as "the same sound again" rather than "a different
 * sound", which is exactly the goal. Repeat-heavy presets get a wider spread.
 */
const SOUND_PRESETS = {
  // Slide advance — soft upward whoosh.
  slideNext: { type: "sine", from: 420, to: 720, duration: 0.18, gain: 0.5, detune: 45 },
  // Slide back — the same gesture inverted.
  slidePrev: { type: "sine", from: 720, to: 420, duration: 0.18, gain: 0.42, detune: 45 },
  // Per-digit tick while a number counts up. Very short and quiet by design:
  // this one fires dozens of times in a row — the widest spread of the set.
  tick: { type: "triangle", from: 1180, to: 1180, duration: 0.035, gain: 0.13, detune: 140 },
  // A counter finished settling.
  countDone: { type: "sine", from: 660, to: 990, duration: 0.16, gain: 0.4, detune: 35 },
  // Generic confirmation / end of story. Kept nearly fixed: it is the one
  // "musical" cue and should stay recognisable.
  success: { type: "sine", from: 523.25, to: 1046.5, duration: 0.28, gain: 0.5, detune: 15 },
  // Generic UI press — fires constantly, so it varies generously.
  click: { type: "square", from: 320, to: 320, duration: 0.03, gain: 0.16, detune: 110 },
};

/** Last detune per preset, so a value is never repeated back-to-back. */
const lastDetuneByPreset = new Map();

/**
 * Pick a detune offset in cents that is meaningfully different from the
 * previous one for this preset. Pure randomness happily returns near-identical
 * neighbours, which is precisely the monotony we are trying to avoid.
 */
function pickDetune(name, spread) {
  if (!spread) {
    return 0;
  }
  const previous = lastDetuneByPreset.get(name) ?? 0;
  let next = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    next = (Math.random() * 2 - 1) * spread;
    if (Math.abs(next - previous) > spread * 0.4) {
      break;
    }
  }
  lastDetuneByPreset.set(name, next);
  return next;
}

function readStoredBoolean(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }
    return raw === "true";
  } catch {
    return fallback;
  }
}

function readStoredVolume(fallback) {
  try {
    const raw = localStorage.getItem(SOUND_VOLUME_KEY);
    if (raw === null) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(1, Math.max(0, parsed));
  } catch {
    return fallback;
  }
}

function ensureInitialized() {
  if (initialized || typeof window === "undefined") {
    return;
  }
  enabled = readStoredBoolean(SOUND_ENABLED_KEY, DEFAULT_ENABLED);
  volume = readStoredVolume(DEFAULT_VOLUME);
  initialized = true;
}

function notifyListeners() {
  const snapshot = { enabled, volume };
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // A broken subscriber must not stop the others.
    }
  });
}

/**
 * Lazily create the AudioContext. Browsers start it suspended until a user
 * gesture, so every play attempt tries to resume it; before the first click the
 * resume simply fails and the sound is silently dropped, which is the correct
 * behaviour rather than an error.
 */
function getAudioContext() {
  if (typeof window === "undefined") {
    return null;
  }
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  if (!audioContext) {
    try {
      audioContext = new AudioContextCtor();
      masterGain = audioContext.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(audioContext.destination);
    } catch {
      audioContext = null;
      masterGain = null;
      return null;
    }
  }

  if (audioContext.state === "suspended") {
    void audioContext.resume().catch(() => {});
  }

  return audioContext;
}

export function isUiSoundsEnabled() {
  ensureInitialized();
  return enabled;
}

export function getUiSoundVolume() {
  ensureInitialized();
  return volume;
}

export function setUiSoundsEnabled(nextEnabled) {
  ensureInitialized();
  enabled = Boolean(nextEnabled);
  try {
    localStorage.setItem(SOUND_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // Preference is best-effort; a blocked storage must not break audio.
  }
  notifyListeners();
}

export function setUiSoundVolume(nextVolume) {
  ensureInitialized();
  const parsed = Number(nextVolume);
  volume = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : DEFAULT_VOLUME;
  if (masterGain) {
    masterGain.gain.value = volume;
  }
  try {
    localStorage.setItem(SOUND_VOLUME_KEY, String(volume));
  } catch {
    // see above
  }
  notifyListeners();
}

export function subscribeUiSounds(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Play a named preset. Never throws and never rejects: audio is decoration, so
 * a missing AudioContext, a blocked autoplay policy or an unknown preset name
 * must all degrade to silence rather than surface as an error.
 */
export function playUiSound(name) {
  ensureInitialized();
  if (!enabled || volume <= 0) {
    return;
  }

  const preset = SOUND_PRESETS[name];
  if (!preset) {
    return;
  }

  const context = getAudioContext();
  if (!context || !masterGain || context.state !== "running") {
    return;
  }

  try {
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    // Pitch wobble, plus matching jitter on level and length: a blip that is
    // only detuned still has an identical envelope, and the ear picks that up.
    const detune = pickDetune(name, preset.detune ?? 0);
    const gain = preset.gain * (1 + (Math.random() * 2 - 1) * 0.12);
    const duration = preset.duration * (1 + (Math.random() * 2 - 1) * 0.1);

    oscillator.type = preset.type;
    oscillator.detune.setValueAtTime(detune, now);
    oscillator.frequency.setValueAtTime(preset.from, now);
    if (preset.to !== preset.from) {
      oscillator.frequency.exponentialRampToValueAtTime(preset.to, now + duration);
    }

    // Percussive envelope: near-instant attack, exponential decay. A linear
    // ramp to exactly 0 would click, hence the small non-zero target.
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(envelope);
    envelope.connect(masterGain);

    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    oscillator.onended = () => {
      try {
        oscillator.disconnect();
        envelope.disconnect();
      } catch {
        // already torn down
      }
    };
  } catch {
    // Decoration only — swallow.
  }
}

/**
 * Resume the AudioContext from a real user gesture. Call this from the first
 * interaction on a surface that wants sound, otherwise the browser's autoplay
 * policy keeps the context suspended and every play is dropped.
 */
export function primeUiSounds() {
  ensureInitialized();
  if (!enabled) {
    return;
  }
  getAudioContext();
}

export const UI_SOUND_NAMES = Object.keys(SOUND_PRESETS);
