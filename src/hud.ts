import type { Vector3 } from "@babylonjs/core";

// HUD alla Skyrim: bussola in alto con il segnalino della meta, barre di magicka /
// salute / vigore in basso (il vigore si vede solo quando non è pieno), overlay di pausa.

export interface Hud {
  update(s: { yaw: number; stamina: number; pos: Vector3 }): void;
  setPaused(p: boolean): void;
  flashStamina(): void;
  ready(): void;
}

const CARDINALS: [string, number][] = [
  ["N", 0], ["NE", 45], ["E", 90], ["SE", 135], ["S", 180], ["SO", 225], ["O", 270], ["NO", 315],
];
const SPAN = 100 * Math.PI / 180;   // metà ampiezza della bussola

export function createHud(marker: { x: number; z: number; label: string }): Hud {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const strip = $("compass-strip"), stamina = $("bar-stamina"), staminaWrap = $("stamina-wrap");
  const overlay = $("overlay"), loading = $("loading");
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

  let lastSt = -1;
  return {
    update({ yaw, stamina: st, pos }) {
      for (const m of marks) place(m.el, m.a, yaw);
      place(quest, Math.atan2(marker.x - pos.x, marker.z - pos.z), yaw);
      if (Math.abs(st - lastSt) > 0.2) {
        stamina.style.width = `${st}%`;
        staminaWrap.classList.toggle("hidden", st >= 99.9);
        lastSt = st;
      }
    },
    setPaused(p) { overlay.classList.toggle("hidden", !p); document.body.classList.toggle("paused", p); },
    flashStamina() { staminaWrap.classList.remove("flash"); void staminaWrap.offsetWidth; staminaWrap.classList.add("flash"); },
    ready() { loading.classList.add("hidden"); overlay.classList.remove("hidden"); },
  };
}
