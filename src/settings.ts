import type { Camera, DefaultRenderingPipeline, Engine, PostProcess, RenderTargetTexture, Scene, SSAO2RenderingPipeline } from "@babylonjs/core";

// ─────────────────────────────────────────────────────────────────────────────
// IMPOSTAZIONI GRAFICHE — ogni effetto costoso ha il suo selettore nel menu di
// pausa, più i preset. Le scelte restano in localStorage (per browser).
// ─────────────────────────────────────────────────────────────────────────────

export interface Graphics {
  resolution: number;     // scala di rendering
  aa: "off" | "fxaa" | "msaa";
  shadows: 0 | 2048 | 4096;
  ssao: boolean;
  godrays: boolean;
  bloom: boolean;
  grass: number;          // distanza di vista dell'erba (m)
}

const PRESETS: Record<string, Graphics> = {
  Basso: { resolution: 0.75, aa: "fxaa", shadows: 2048, ssao: false, godrays: false, bloom: false, grass: 40 },
  Medio: { resolution: 1, aa: "fxaa", shadows: 4096, ssao: false, godrays: true, bloom: true, grass: 60 },
  Alto: { resolution: 1, aa: "msaa", shadows: 4096, ssao: true, godrays: true, bloom: true, grass: 75 },
  Ultra: { resolution: 1.25, aa: "msaa", shadows: 4096, ssao: true, godrays: true, bloom: true, grass: 100 },
};

type Opt<K extends keyof Graphics> = { key: K; label: string; values: [Graphics[K], string][] };
const OPTIONS = [
  { key: "resolution", label: "Risoluzione", values: [[0.75, "75%"], [1, "100%"], [1.25, "125%"]] } as Opt<"resolution">,
  { key: "aa", label: "Antialiasing", values: [["off", "No"], ["fxaa", "FXAA"], ["msaa", "MSAA 4×"]] } as Opt<"aa">,
  { key: "shadows", label: "Ombre", values: [[0, "No"], [2048, "Medie"], [4096, "Alte"]] } as Opt<"shadows">,
  { key: "ssao", label: "Occlusione ambientale", values: [[false, "No"], [true, "Sì"]] } as Opt<"ssao">,
  { key: "godrays", label: "Raggi di luce", values: [[false, "No"], [true, "Sì"]] } as Opt<"godrays">,
  { key: "bloom", label: "Bloom", values: [[false, "No"], [true, "Sì"]] } as Opt<"bloom">,
  { key: "grass", label: "Distanza erba", values: [[40, "40 m"], [60, "60 m"], [75, "75 m"], [100, "100 m"]] } as Opt<"grass">,
];

const STORE = "sidequest.graphics";

export interface GraphicsTargets {
  scene: Scene; engine: Engine; camera: Camera;
  pipeline: DefaultRenderingPipeline; ssao: SSAO2RenderingPipeline; godrays: PostProcess; shadowMap: RenderTargetTexture;
}

export function createGraphicsSettings(t: GraphicsTargets, onGrass: (d: number) => void): Graphics {
  let g: Graphics = { ...PRESETS.Alto };
  try { g = { ...g, ...JSON.parse(localStorage.getItem(STORE) ?? "{}") }; } catch { /* storage non disponibile: default */ }

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
    onGrass(g.grass);
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
  };
  apply();
  return g;
}
