import type { Vector3 } from "@babylonjs/core";

// HUD alla Skyrim: bussola in alto con il segnalino della meta, barre di magicka /
// salute / vigore in basso (il vigore si vede solo quando non è pieno), overlay di pausa.

export interface Hud {
  update(s: { yaw: number; stamina: number; health: number; pos: Vector3 }): void;
  /** Barra del nemico sotto la bussola (null = nascosta). */
  enemy(e: { name: string; frac: number } | null): void;
  /** Lampo rosso ai bordi quando si viene colpiti, 0..1. */
  hurt(k: number): void;
  setDead(d: boolean): void;
  /** Il mirino scatta quando un colpo va a segno (più forte se uccide). */
  hitMarker(kill: boolean): void;
  setPaused(p: boolean): void;
  flashStamina(): void;
  /** Cosa fa il tasto d'interazione su ciò che si ha davanti (null = niente). */
  prompt(text: string | null): void;
  /** La missione seguita, sotto la bussola: nome e tappa in corso (null = nessuna). */
  quest(name: string | null, text?: string): void;
  /** La barra della magicka, 0..1 (piena: nascosta, come la salute). */
  magicka(frac: number): void;
  /** Una riga che compare e svanisce: ciò che si è appena ricevuto o usato. */
  notice(text: string): void;
  ready(): void;
}

const CARDINALS: [string, number][] = [
  ["N", 0], ["NE", 45], ["E", 90], ["SE", 135], ["S", 180], ["SO", 225], ["O", 270], ["NO", 315],
];
const SPAN = 100 * Math.PI / 180;   // metà ampiezza della bussola

export function createHud(marker: { x: number; z: number; label: string }): Hud {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const strip = $("compass-strip"), stamina = $("bar-stamina"), staminaWrap = $("stamina-wrap");
  const health = $("bar-health"), healthWrap = $("health-wrap");
  const enemyWrap = $("enemy"), enemyName = $("enemy-name"), enemyBar = $("bar-enemy");
  const hurtEl = $("hurt"), deadEl = $("dead"), cross = $("crosshair");
  const overlay = $("overlay"), loading = $("loading"), promptEl = $("prompt"), promptText = $("prompt-text");
  const marks = CARDINALS.map(([l, deg]) => {
    const el = document.createElement("span");
    el.className = l.length === 1 ? "c-main" : "c-sub";
    el.textContent = l;
    strip.appendChild(el);
    return { el, a: deg * Math.PI / 180 };
  });
  for (let d = 0; d < 360; d += 15) {
    if (d % 45 === 0) continue;
    const el = document.createElement("i");
    el.className = "c-tick";
    strip.appendChild(el);
    marks.push({ el, a: d * Math.PI / 180 });
  }
  const quest = document.createElement("b");
  quest.className = "c-quest";
  quest.title = marker.label;
  strip.appendChild(quest);

  const place = (el: HTMLElement, a: number, yaw: number): void => {
    let d = a - yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const v = Math.abs(d) < SPAN;
    el.style.opacity = v ? String(1 - Math.pow(Math.abs(d) / SPAN, 3)) : "0";
    el.style.left = `${50 + (d / SPAN) * 50}%`;
  };

  let lastSt = -1, lastHp = -1, lastEnemy = "", lastPrompt: string | null = null;
  return {
    update({ yaw, stamina: st, health: hp, pos }) {
      if (Math.abs(hp - lastHp) > 0.1) {
        health.style.width = `${hp}%`;
        healthWrap.style.opacity = hp >= 99.9 ? "0" : "1";
        lastHp = hp;
      }
      for (const m of marks) place(m.el, m.a, yaw);
      place(quest, Math.atan2(marker.x - pos.x, marker.z - pos.z), yaw);
      if (Math.abs(st - lastSt) > 0.2) {
        stamina.style.width = `${st}%`;
        staminaWrap.classList.toggle("hidden", st >= 99.9);
        lastSt = st;
      }
    },
    enemy(e) {
      const key = e ? `${e.name}|${e.frac.toFixed(3)}` : "";
      if (key === lastEnemy) return;
      lastEnemy = key;
      enemyWrap.classList.toggle("hidden", !e);
      if (e) { enemyName.textContent = e.name; enemyBar.style.width = `${Math.max(0, e.frac) * 100}%`; }
    },
    hurt(k) {
      hurtEl.style.transition = "none"; hurtEl.style.opacity = String(k);
      void hurtEl.offsetWidth;
      hurtEl.style.transition = "opacity .9s ease-out"; hurtEl.style.opacity = "0";
    },
    setDead(d) { deadEl.classList.toggle("hidden", !d); },
    hitMarker(kill) {
      cross.classList.remove("hit", "kill"); void cross.offsetWidth;
      cross.classList.add(kill ? "kill" : "hit");
    },
    setPaused(p) { overlay.classList.toggle("hidden", !p); document.body.classList.toggle("paused", p); },
    prompt(text) {
      if (text === lastPrompt) return;
      lastPrompt = text;
      promptEl.classList.toggle("hidden", text === null);
      if (text !== null) promptText.textContent = text;
    },
    quest(name, text = "") {
      $("quest").classList.toggle("hidden", name === null);
      if (name !== null) { $("quest-name").textContent = name; $("quest-text").textContent = text; }
    },
    magicka(frac) {
      $("bar-magicka").style.width = `${frac * 100}%`;
      $("magicka-wrap").style.opacity = frac >= 0.999 ? "0" : "1";
    },
    notice(text) {
      const d = $("notices").appendChild(document.createElement("div"));
      d.textContent = text;
      setTimeout(() => d.remove(), 4200);
    },
    flashStamina() { staminaWrap.classList.remove("flash"); void staminaWrap.offsetWidth; staminaWrap.classList.add("flash"); },
    ready() { loading.classList.add("hidden"); overlay.classList.remove("hidden"); },
  };
}
