import type { Camera, DefaultRenderingPipeline, Engine, PostProcess, RenderTargetTexture, Scene, SSAO2RenderingPipeline } from "@babylonjs/core";
import { setSound, soundOn } from "./sfx";
import { setLampLight } from "./world/materials";
import { setInteriorDetail, setWindowReach } from "./world/interiors";
import { setCloudShadowsOn } from "./world/materials";
import { setPixelStyle } from "./pixel";

// ─────────────────────────────────────────────────────────────────────────────
// IMPOSTAZIONI GRAFICHE — ogni effetto costoso ha il suo selettore nel menu di
// pausa, più i preset. Le scelte restano in localStorage (per browser).
// ─────────────────────────────────────────────────────────────────────────────

export interface Graphics {
  resolution: number;     // scala di rendering
  aa: "off" | "fxaa" | "msaa";
  shadows: 0 | 2048 | 4096;
  shadowStep: number;     // di quanti gradi si sposta il sole prima che le ombre si ridisegnino
  ssao: boolean;
  godrays: boolean;
  bloom: boolean;
  grass: number;          // distanza di vista dell'erba (m)
  mist: boolean;          // foschia a terra reattiva
  mistDensity: number;    // quanta foschia (1 = come la vuole l'ora del giorno)
  mistWeight: number;     // quanto è pesante: pesante si sposta meno e si ricompone prima, leggera vola via
  lamps: boolean;         // la luce dei lampioni sulla strada, di notte
  cloudShadows: boolean;  // le ombre delle nuvole che passano a terra (un rumore in più per pixel all'aperto)
  cel: boolean;           // cel shading: la luce a gradini e una riga scura attorno ai personaggi (un disegno in più per personaggio)
  pixelLook: "palette" | "retro";   // come si vede lo stile a pixel: la tavolozza a mano (poche righe vere) o retrò (colore pieno, luce morbida sopra i blocchi, righe dello schermo)
  pixel: number;          // stile a pixel: a quante righe si disegna (0 = spento); toglie antialiasing, nitidezza e grana, riduce i colori
  bodyShadows: boolean;   // l'ombra di chi si muove (chi gioca, gli abitanti vicini) rispetto a sole, lampioni e luci degli interni: un conto in più per pixel
  windows: number;        // da quanti metri si vede dentro dalle finestre (0 = da fuori mai): più lontano, più interni disegnati insieme
  interiors: 0 | 1 | 2;   // dettaglio degli interni: arredi minuti (mai / solo dove si è / sempre) e da quanto lontano si accendono
  flames: 0 | 1 | 2;      // la luce vera delle fiamme vicine: spenta / luci / luci e ombre
}

const PRESETS: Record<string, Graphics> = {
  Basso: { resolution: 0.75, aa: "fxaa", shadows: 2048, shadowStep: 12, ssao: false, godrays: false, bloom: false, grass: 40, mist: false, mistDensity: 1, mistWeight: 1, lamps: false, interiors: 0, windows: 0, cloudShadows: false, cel: false, pixelLook: "retro", pixel: 0, bodyShadows: false, flames: 0 },
  Medio: { resolution: 1, aa: "fxaa", shadows: 4096, shadowStep: 4, ssao: false, godrays: true, bloom: true, grass: 60, mist: true, mistDensity: 1, mistWeight: 1, lamps: true, interiors: 1, windows: 10, cloudShadows: true, cel: false, pixelLook: "retro", pixel: 0, bodyShadows: true, flames: 1 },
  Alto: { resolution: 1, aa: "msaa", shadows: 4096, shadowStep: 2, ssao: true, godrays: true, bloom: true, grass: 75, mist: true, mistDensity: 1, mistWeight: 1, lamps: true, interiors: 2, windows: 16, cloudShadows: true, cel: false, pixelLook: "retro", pixel: 0, bodyShadows: true, flames: 2 },
  Ultra: { resolution: 1.25, aa: "msaa", shadows: 4096, shadowStep: 1, ssao: true, godrays: true, bloom: true, grass: 100, mist: true, mistDensity: 1, mistWeight: 1, lamps: true, interiors: 2, windows: 24, cloudShadows: true, cel: false, pixelLook: "retro", pixel: 0, bodyShadows: true, flames: 2 },
};

type Opt<K extends keyof Graphics> = { key: K; label: string; values: [Graphics[K], string][] };
const OPTIONS = [
  { key: "resolution", label: "Risoluzione", values: [[0.75, "75%"], [1, "100%"], [1.25, "125%"]] } as Opt<"resolution">,
  { key: "aa", label: "Antialiasing", values: [["off", "No"], ["fxaa", "FXAA"], ["msaa", "MSAA 4×"]] } as Opt<"aa">,
  { key: "shadows", label: "Ombre", values: [[0, "No"], [2048, "Medie"], [4096, "Alte"]] } as Opt<"shadows">,
  { key: "shadowStep", label: "Ombre che seguono il sole", values: [[12, "Di rado"], [4, "Lente"], [2, "Medie"], [1, "Fluide"]] } as Opt<"shadowStep">,
  { key: "ssao", label: "Occlusione ambientale", values: [[false, "No"], [true, "Sì"]] } as Opt<"ssao">,
  { key: "godrays", label: "Raggi di luce", values: [[false, "No"], [true, "Sì"]] } as Opt<"godrays">,
  { key: "bloom", label: "Bloom", values: [[false, "No"], [true, "Sì"]] } as Opt<"bloom">,
  { key: "mist", label: "Foschia a terra", values: [[false, "No"], [true, "Sì"]] } as Opt<"mist">,
  { key: "mistDensity", label: "Densità della foschia", values: [[0.5, "Rada"], [1, "Normale"], [1.6, "Fitta"], [2.4, "Molto fitta"]] } as Opt<"mistDensity">,
  { key: "mistWeight", label: "Pesantezza della foschia", values: [[0.5, "Leggera"], [1, "Normale"], [2, "Pesante"]] } as Opt<"mistWeight">,
  { key: "pixel", label: "Stile a pixel", values: [[0, "No"], [180, "180 righe"], [240, "240 righe"], [360, "360 righe"], [480, "480 righe"], [540, "540 righe"], [720, "720 righe"]] } as Opt<"pixel">,
  { key: "pixelLook", label: "Resa a pixel", values: [["retro", "Retrò"], ["palette", "Tavolozza"]] } as Opt<"pixelLook">,
  { key: "cloudShadows", label: "Ombre delle nuvole", values: [[false, "No"], [true, "Sì"]] } as Opt<"cloudShadows">,
  { key: "cel", label: "Cel shading", values: [[false, "No"], [true, "Sì"]] } as Opt<"cel">,
  { key: "bodyShadows", label: "Ombre di chi si muove", values: [[false, "No"], [true, "Sì"]] } as Opt<"bodyShadows">,
  { key: "windows", label: "Finestre trasparenti", values: [[0, "Solo da dentro"], [10, "Da vicino"], [16, "Normale"], [24, "Da lontano"]] } as Opt<"windows">,
  { key: "lamps", label: "Luce dei lampioni", values: [[false, "No"], [true, "Sì"]] } as Opt<"lamps">,
  { key: "flames", label: "Luce delle fiamme", values: [[0, "Spenta"], [1, "Luci"], [2, "Luci e ombre"]] } as Opt<"flames">,
  { key: "interiors", label: "Dettaglio degli interni", values: [[0, "Basso"], [1, "Medio"], [2, "Alto"]] } as Opt<"interiors">,
  { key: "grass", label: "Distanza erba", values: [[40, "40 m"], [60, "60 m"], [75, "75 m"], [100, "100 m"]] } as Opt<"grass">,
];

const STORE = "sidequest.graphics";

export interface GraphicsTargets {
  scene: Scene; engine: Engine; camera: Camera;
  pipeline: DefaultRenderingPipeline; ssao: SSAO2RenderingPipeline; godrays: PostProcess; shadowMap: RenderTargetTexture;
  mist: { setEnabled(on: boolean): void; tune(density: number, weight: number): void };
  flameLights: { setLevel(level: number): void };
}

export function createGraphicsSettings(t: GraphicsTargets, on: (g: Graphics) => void): Graphics {
  let g: Graphics = { ...PRESETS.Alto };
  try { g = { ...g, ...JSON.parse(localStorage.getItem(STORE) ?? "{}") }; } catch { /* storage non disponibile: default */ }

  // (lo stile a pixel conta le righe dello schermo: se la finestra cambia misura va rifatto, dopo che il motore si è adattato)
  addEventListener("resize", () => setTimeout(() => { if (g.pixel) setPixelStyle(t.scene, t.engine, t.camera, t.pipeline, g.pixel, g.pixelLook, 1 / g.resolution, g.cel); }, 0));
  let ssaoOn = true, raysOn = true;
  const apply = (): void => {
    t.engine.setHardwareScalingLevel(1 / g.resolution);
    t.pipeline.samples = g.aa === "msaa" ? 4 : 1;
    t.pipeline.fxaaEnabled = g.aa === "fxaa";
    t.pipeline.bloomEnabled = g.bloom;
    t.scene.shadowsEnabled = g.shadows > 0;
    if (g.shadows > 0 && t.shadowMap.getSize().width !== g.shadows) {
      t.shadowMap.resize(g.shadows);
      t.shadowMap.resetRefreshCounter();
    }
    const mgr = t.scene.postProcessRenderPipelineManager;
    if (g.ssao !== ssaoOn) {
      if (g.ssao) mgr.attachCamerasToRenderPipeline("ssao", t.camera); else mgr.detachCamerasFromRenderPipeline("ssao", t.camera);
      ssaoOn = g.ssao;
    }
    if (g.godrays !== raysOn) {
      if (g.godrays) t.camera.attachPostProcess(t.godrays); else t.camera.detachPostProcess(t.godrays);
      raysOn = g.godrays;
    }
    t.mist.setEnabled(g.mist); t.mist.tune(g.mistDensity, g.mistWeight);
    setLampLight(g.lamps);
    setInteriorDetail(g.interiors); setWindowReach(g.windows); setCloudShadowsOn(g.cloudShadows);
    t.flameLights.setLevel(g.flames);
    setPixelStyle(t.scene, t.engine, t.camera, t.pipeline, g.pixel, g.pixelLook, 1 / g.resolution, g.cel);   // (per ultimo: nello stile a pixel decide lui risoluzione e antialiasing)
    on(g);
    try { localStorage.setItem(STORE, JSON.stringify(g)); } catch { /* ignora */ }
    render();
  };

  // ── pannello nel menu di pausa ──
  const panel = document.getElementById("graphics")!;
  panel.addEventListener("click", (e) => e.stopPropagation());   // il click qui non deve far partire il gioco
  const render = (): void => {
    panel.replaceChildren();
    const row = (label: string, items: [string, boolean, () => void][]): void => {
      const r = document.createElement("div");
      r.className = "g-row";
      r.appendChild(document.createElement("span")).textContent = label;
      const box = document.createElement("div");
      for (const [txt, on, fn] of items) {
        const b = document.createElement("button");
        b.textContent = txt;
        b.className = on ? "on" : "";
        b.onclick = fn;
        box.appendChild(b);
      }
      r.appendChild(box);
      panel.appendChild(r);
    };
    const preset = Object.keys(PRESETS).find((k) => JSON.stringify(PRESETS[k]) === JSON.stringify(g));
    row("Preset", Object.keys(PRESETS).map((k) => [k, k === preset, () => { g = { ...PRESETS[k] }; apply(); }]));
    for (const o of OPTIONS) {
      row(o.label, (o.values as [unknown, string][]).map(([v, txt]) => [txt, g[o.key] === v, () => { (g as unknown as Record<string, unknown>)[o.key] = v; apply(); }]));
    }
    row("Suoni", [["No", !soundOn(), () => { setSound(false); render(); }], ["Sì", soundOn(), () => { setSound(true); render(); }]]);
  };
  apply();
  return g;
}
