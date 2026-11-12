// ─────────────────────────────────────────────────────────────────────────────
// SUONI — sintetizzati al volo con WebAudio, niente file: rumore filtrato per i fendenti,
// colpi sordi per carne e legno, parziali inarmoniche per il ferro dello scudo.
// Il contesto audio nasce al primo suono (dopo un gesto dell'utente: il click che cattura il mouse).
//
// ponytail: sintesi minima, da "feedback", non da missaggio. Quando arriveranno campioni veri
// basta sostituire il corpo di queste funzioni.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = "sidequest.sound";
let on = true;
try { on = localStorage.getItem(KEY) !== "0"; } catch { /* storage non disponibile */ }

let ctx: AudioContext | null = null;
let master: GainNode;
let white: AudioBuffer;

export const soundOn = (): boolean => on;
export function setSound(v: boolean): void {
  on = v;
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* ignora */ }
}

function ac(): AudioContext | null {
  if (!on) return null;
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
    master = ctx.createGain();
    master.gain.value = 0.45;
    master.connect(ctx.destination);
    white = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = white.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Inviluppo: sale in `attack`, poi scende esponenzialmente fino a `dur`. */
function env(c: AudioContext, gain: number, dur: number, attack: number): GainNode {
  const g = c.createGain(), t = c.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(master);
  return g;
}

function noise(type: BiquadFilterType, f0: number, f1: number, q: number, dur: number, gain: number, attack = 0.004): void {
  const c = ac();
  if (!c) return;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), t = c.currentTime;
  src.buffer = white; src.loop = true;
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  src.connect(f).connect(env(c, gain, dur, attack));
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number): void {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator(), t = c.currentTime;
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  o.connect(env(c, gain, dur, 0.003));
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  /** La lama che taglia l'aria. */
  whoosh(heavy = false): void { noise("bandpass", heavy ? 380 : 620, heavy ? 1500 : 2300, 1.1, heavy ? 0.26 : 0.19, 0.24, 0.06); },
  /** Lama nella carne. */
  hit(heavy: boolean): void {
    tone("sine", 150, 48, 0.14, 0.5);
    noise("lowpass", 2200, 320, 0.7, 0.1, 0.38);
    if (heavy) tone("sine", 78, 30, 0.28, 0.55);
  },
  /** Lama su legno o pietra. */
  thud(): void { tone("triangle", 210, 80, 0.09, 0.35); noise("bandpass", 1300, 500, 2, 0.06, 0.32); },
  /** Un morso sul ferro dello scudo. */
  block(): void {
    for (const f of [540, 1210, 1830, 2760]) tone("sine", f * (0.97 + Math.random() * 0.06), f * 0.985, 0.32, 0.11);
    noise("highpass", 2600, 1800, 0.7, 0.04, 0.3);
    tone("sine", 130, 60, 0.11, 0.35);
  },
  /** Un morso che arriva. */
  hurt(): void { tone("sawtooth", 170, 62, 0.17, 0.2); noise("lowpass", 800, 200, 0.7, 0.13, 0.32); },
  /** Un corpo che batte a terra; `k` 0..1 = quanto forte. */
  body(k: number): void { tone("sine", 96, 36, 0.17, 0.25 + 0.35 * k); noise("lowpass", 520, 110, 0.7, 0.12, 0.14 + 0.2 * k); },
  /** Un corpo che si disfa in pulviscolo. */
  dust(): void { noise("bandpass", 700, 2800, 0.8, 1.6, 0.09, 0.5); },
};
