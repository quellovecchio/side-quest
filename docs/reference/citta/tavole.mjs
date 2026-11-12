// Tavole di reference per la città, stile dark (Gothic / Oblivion / Two Worlds): props, NPC e interni.
// `node docs/reference/citta/tavole.mjs` riscrive gli SVG qui accanto.
// I colori sono sRGB, scelti a occhio: in gioco gli albedo vanno portati in lineare (vedi CLAUDE.md).
import { writeFileSync } from "node:fs";
import { PIECES, face, footprint, lamps, layout, local, thick } from "../../../src/world/layouts.ts";
import { mulberry32 } from "../../../src/world/noise.ts";

const INK = "#1a1613";
const K = {
  lino: "#a89c80", lana: "#5c4a38", cuoio: "#4a3423", ruggine: "#74402a", ocra: "#8c7034", muschio: "#4c5434",
  vino: "#592a30", petrolio: "#3c4f52", viola: "#46344d", nero: "#2a2623", grigio: "#6a665e", bianco: "#c9c0a8",
  pelle: "#b48d6e", pallido: "#c3a385", ferro: "#35373a", oro: "#9a7b34", legno: "#5a4330", paglia: "#8a7743",
  pietra: "#77756c", pietraScura: "#52514b", intonaco: "#948a72", trave: "#3a2a1e", ardesia: "#3c4247", coppo: "#6e3d2b",
  lume: "#d79a3a", vetro: "#27363a", tonaca: "#3b3029", buio: "#191613", freddo: "#9db3ae",
};

let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, R = (a, b) => a + (b - a) * rnd();
const shade = (c, k = 0.58) => "#" + [1, 3, 5].map((i, j) => Math.min(255, Math.round(parseInt(c.slice(i, i + 2), 16) * k * (j == 2 && k < 1 ? 1.1 : 1))).toString(16).padStart(2, "0")).join("");
// path con i numeri arrotondati
const d = (s, ...v) => s.reduce((a, t, i) => a + t + (i < v.length ? (typeof v[i] === "number" ? +v[i].toFixed(1) : v[i]) : ""), "");
const J = (a) => a.flat(9).join("");
const P = (p, fill, x = "") => `<path d="${p}" fill="${fill}" ${x}/>`;
const S = (p, fill, x = "") => P(p, shade(fill), x) + P(p, fill, `transform="scale(-1 1)" ${x}`); // metà sinistra in luce, metà destra in ombra
const M = (p, fill, x = "") => P(p, fill, x) + P(p, fill, `transform="scale(-1 1)" ${x}`);       // specchiato, stessa tinta
const L = (p, w = 1, x = "") => `<path d="${p}" fill="none" stroke-width="${w}" ${x}/>`;
const O = (x, y, r, fill, e = "") => `<circle cx="${+x.toFixed(1)}" cy="${+y.toFixed(1)}" r="${r}" fill="${fill}" ${e}/>`;
const G = (x, y, s, body, e = "") => `<g class="f" transform="translate(${x} ${y}) scale(${s}) ${e}">${J([body])}</g>`;
const T = (x, y, cls, s, a = "start") => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${a}">${s}</text>`;
const NOSTROKE = `stroke="none"`;

function sheet(file, titolo, sotto, body, chips) {
  const sw = chips.map((k, i) => `<g transform="translate(${60 + i * 108} 950)"><rect width="24" height="24" fill="${K[k]}" stroke="${INK}"/><text x="31" y="17" class="n">${k}</text></g>`).join("");
  writeFileSync(new URL(file, import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" font-family="Georgia, 'Times New Roman', serif">
<defs>
<filter id="carta" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="3" seed="7"/><feColorMatrix values="0 0 0 0 .1  0 0 0 0 .08  0 0 0 0 .06  .9 0 0 0 -.22"/></filter>
<filter id="nero"><feColorMatrix values="0 0 0 0 .1  0 0 0 0 .086  0 0 0 0 .075  0 0 0 1 0"/></filter>
<radialGradient id="vig" cx=".5" cy=".5" r=".78"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
<radialGradient id="lume"><stop offset="0" stop-color="#e9b24a" stop-opacity=".6"/><stop offset="1" stop-color="#e9b24a" stop-opacity="0"/></radialGradient>
<clipPath id="tile"><rect width="440" height="320"/></clipPath>
</defs>
<style>
.f{stroke:${INK};stroke-width:1.3;stroke-linejoin:round;stroke-linecap:round}
.f *{vector-effect:non-scaling-stroke}
text{fill:${INK}}
.t{font-size:30px;letter-spacing:7px}
.s{font-size:15px;font-style:italic;fill:#3a3028}
.h{font-size:15px;letter-spacing:3px}
.n{font-size:13px;font-style:italic;fill:#3a3028}
</style>
<rect width="1600" height="1000" fill="#b7ab8e"/>
${T(60, 62, "t", titolo)}${T(60, 88, "s", sotto)}
${J([body])}
${sw}
<rect width="1600" height="1000" filter="url(#carta)"/><rect width="1600" height="1000" fill="url(#vig)"/>
</svg>
`);
}

// ───────────────────────── figure ─────────────────────────
// Unità: centimetri, origine a terra fra i piedi, y verso l'alto negativa. Vista frontale, braccia appena staccate.

function frame(o) {
  const H = o.h, hd = H / (o.heads ?? 7.3), top = -H, chin = top + hd, shy = chin + hd * (0.28 - (o.stoop ?? 0));
  const sh = H * (o.sh ?? 0.122), w = sh * (o.w ?? 0.7), hw = sh * (o.hip ?? 0.84), out = Math.max(sh, w);
  return { H, hd, top, chin, shy, sh, w, hw, nw: hd * 0.17, fw: hd * 0.36, hl: hd * 0.42, skin: o.skin ?? K.pelle,
    wy: -H * 0.6, hy: -H * 0.52, cy: -H * 0.47, ky: -H * 0.27, ay: -H * 0.05,
    kid: (o.heads ?? 7.3) < 7, ex: out + 3.2, ey: -H * 0.615, wx: out + 4.4, wry: -H * 0.465, y: (k) => top + hd * k };
}

const legs = (b, col, shoe = K.cuoio) =>
  S(d`M0,${b.hy} L${b.hw},${b.hy} L${b.hw * 0.86},${b.ky} L${b.hw * 0.72},${b.ay} L${b.hw * 0.26},${b.ay} L${b.hw * 0.36},${b.ky} L1,${b.cy} L0,${b.cy}`, col) +
  S(d`M${b.hw * 0.22},${b.ay - 0.5} L${b.hw * 0.76},${b.ay - 0.5} L${b.hw * 0.95},-2.2 L${b.hw * 0.95},0 L${b.hw * 0.14},0 Z`, shoe);

const arms = (b, col, cuff = 2.4, bare = false) => {
  const { sh, shy, ex, ey, wx, wry, hl, skin } = b;
  return S(d`M${wx - 2},${wry - 1} L${wx + 2.1},${wry - 1} L${wx + 2.8},${wry + hl * 0.5} L${wx + 1.2},${wry + hl} L${wx - 1.5},${wry + hl * 0.9} Z`, skin) +
    S(d`M${ex + 2.8},${ey} L${wx + cuff},${wry} L${wx - cuff},${wry + (cuff > 3 ? 2.5 : 0)} L${ex - 2.8},${ey + 1} Z`, bare ? skin : col) +
    S(d`M${sh - 1.5},${shy + 0.5} L${sh + 1.4},${shy + 4.5} L${ex + 3},${ey + (bare ? 2 : 0)} L${ex - 3},${ey + (bare ? 3 : 1)} L${sh - 4.5},${shy + 11} Z`, col);
};

// veste dalle spalle all'orlo; wk allarga o stringe la vita
const robe = (b, col, hem = b.hy + 5, hemW = b.hw + 1.5, wk = 1) =>
  S(d`M0,${b.shy + 1.5} L${b.nw + 1},${b.shy - b.hd * 0.1} L${b.sh},${b.shy + b.hd * 0.12} L${b.sh + 0.3},${b.shy + 6} L${b.w * wk},${b.wy}` +
    (hem > b.hy + 1 ? d` L${Math.max(b.hw, b.w * wk) + 0.8},${b.hy}` : "") + d` L${hemW},${hem} L0,${hem + 1}`, col);

const belt = (b, col = K.cuoio, wk = 1, y = b.wy, buckle = true) =>
  S(d`M0,${y - 1.6} L${b.w * wk + 0.9},${y - 1.6} L${b.w * wk + 1.1},${y + 1.6} L0,${y + 1.6}`, col) +
  (buckle ? P(d`M-1.8,${y - 2.2} h3.6 v4.4 h-3.6 Z`, K.ferro) : L(d`M2,${y + 1.6} q1,9 -1,15 M3.5,${y + 1.6} q3,8 2,13`, 1.2));

const head = (b, old) => {
  const { top, chin, hd, nw, fw, shy, skin, y, kid } = b, e = y(0.47);
  return S(d`M0,${chin - 3} L${nw},${chin - 2} L${nw + 0.6},${shy} L0,${shy + 1.2}`, shade(skin, 0.8)) +
    S(d`M0,${top} Q${fw * 1.03},${top} ${fw},${y(0.36)} L${fw * 0.97},${y(0.6)} L${fw * 0.52},${chin - hd * 0.04} L0,${chin}`, skin) +
    M(kid ? d`M${fw * 0.3},${e - hd * 0.03} L${fw * 0.7},${e - hd * 0.035} L${fw * 0.68},${e + hd * 0.045} L${fw * 0.32},${e + hd * 0.045} Z` : d`M${fw * 0.14},${e - hd * 0.03} L${fw * 0.86},${e - hd * 0.075} L${fw * 0.8},${e + hd * 0.06} L${fw * 0.2},${e + hd * 0.05} Z`, INK, NOSTROKE) + // occhi in ombra
    P(d`M0,${e} L${fw * 0.3},${y(0.67)} L0,${y(0.7)} Z`, shade(skin, 0.38), NOSTROKE) +
    L(d`M${-fw * 0.28},${y(0.82)} L${fw * 0.28},${y(0.82)}`, 0.9) +
    (old ? L(d`M${-fw * 0.8},${y(0.56)} L${-fw * 0.5},${y(0.74)} M${fw * 0.8},${y(0.56)} L${fw * 0.5},${y(0.74)} M${-fw * 0.5},${y(0.27)} L${fw * 0.5},${y(0.27)}`, 0.7) : "");
};

const hair = (b, kind, col) => {
  const { top, hd, fw, shy, y } = b;
  switch (kind) {
    case "corti": return S(d`M0,${top - 1} Q${fw * 1.18},${top - 1} ${fw * 1.1},${y(0.4)} L${fw * 0.88},${y(0.33)} L${fw * 0.7},${y(0.16)} L0,${y(0.2)}`, col);
    case "arruffati": return S(d`M0,${top - 2.5} L${fw * 0.5},${top - 1.5} L${fw * 0.9},${top - 2.5} L${fw * 1.3},${y(0.12)} L${fw * 1.15},${y(0.25)} L${fw * 1.3},${y(0.45)} L${fw * 0.9},${y(0.36)} L${fw * 0.75},${y(0.2)} L${fw * 0.4},${y(0.3)} L0,${y(0.18)}`, col);
    case "dietro": return S(d`M0,${top - 1} Q${fw * 1.3},${top - 1} ${fw * 1.28},${y(0.5)} L${fw * 1.7},${shy + 5} L0,${shy + 5}`, col); // lunghi: strato dietro la testa
    case "riga": return S(d`M0,${top - 1} Q${fw * 1.2},${top - 1} ${fw * 1.12},${y(0.5)} L${fw * 0.9},${y(0.42)} L${fw * 0.8},${y(0.2)} L0,${y(0.1)}`, col);
    case "crocchia": return S(d`M0,${top - hd * 0.3} Q${fw * 0.7},${top - hd * 0.3} ${fw * 0.6},${top} L0,${top}`, col) + hair(b, "riga", col);
    case "trecce": return hair(b, "riga", col) + S(d`M${fw * 0.95},${y(0.45)} L${fw * 1.5},${y(0.7)} L${fw * 1.2},${y(1.0)} L${fw * 1.6},${y(1.3)} L${fw * 1.25},${y(1.6)} L${fw * 1.45},${y(1.85)} L${fw * 1.0},${y(1.6)} L${fw * 1.25},${y(1.3)} L${fw * 0.9},${y(1.0)} L${fw * 1.15},${y(0.72)} Z`, col);
    case "tonsura": return S(d`M${fw * 0.6},${y(0.08)} L${fw * 1.12},${y(0.22)} L${fw * 1.08},${y(0.46)} L${fw * 0.86},${y(0.36)} Z`, col);
  }
};

const beard = (b, col, len = 0.12, wk = 1) =>
  S(d`M0,${b.y(0.72)} L${b.fw * 0.42},${b.y(0.78)} Q${b.fw * 0.8},${b.y(0.8)} ${b.fw * 0.99},${b.y(0.56)} L${b.fw * 0.85 * wk},${b.chin + b.hd * len * 0.4} L0,${b.chin + b.hd * len}`, col) +
  L(d`M${-b.fw * 0.35},${b.y(0.95)} v${b.hd * len * 0.6} M${b.fw * 0.35},${b.y(0.95)} v${b.hd * len * 0.6}`, 0.6, `opacity=".5"`) +
  L(d`M${-b.fw * 0.25},${b.y(0.85)} L${b.fw * 0.25},${b.y(0.85)}`, 0.8);

const cuffia = (b, col = K.bianco) => S(d`M0,${b.top - 1.4} Q${b.fw * 1.25},${b.top - 1.4} ${b.fw * 1.15},${b.y(0.5)} L${b.fw * 1.02},${b.y(0.78)} L${b.fw * 0.86},${b.y(0.7)} L${b.fw * 0.9},${b.y(0.32)} Q${b.fw * 0.6},${b.y(0.1)} 0,${b.y(0.14)}`, col);
const fazzoletto = (b, col) => P(d`M${b.fw * 1.1},${b.y(0.3)} L${b.fw * 2},${b.y(0.8)} L${b.fw * 1.3},${b.y(0.72)} Z`, shade(col)) +
  S(d`M0,${b.top - 1.6} Q${b.fw * 1.3},${b.top - 1.4} ${b.fw * 1.2},${b.y(0.42)} L${b.fw * 0.9},${b.y(0.34)} Q${b.fw * 0.5},${b.y(0.14)} 0,${b.y(0.2)}`, col);
const soggolo = (b, col = K.bianco) => S(d`M0,${b.top - 1.5} Q${b.fw * 1.3},${b.top - 1.5} ${b.fw * 1.22},${b.y(0.5)} L${b.fw * 1.15},${b.chin} L${b.fw * 1.9},${b.shy + 4} L0,${b.shy + 10} M0,${b.y(0.2)} L${b.fw * 0.8},${b.y(0.26)} L${b.fw * 0.9},${b.y(0.6)} L${b.fw * 0.5},${b.chin - 0.6} L0,${b.chin - 0.2}`, col, `fill-rule="evenodd"`);
const veloDietro = (b, col) => S(d`M0,${b.top - 2.6} Q${b.fw * 1.6},${b.top - 2.6} ${b.fw * 1.55},${b.y(0.5)} L${b.sh * 1.02},${b.shy + 16} L0,${b.shy + 16}`, col);
const veloFronte = (b, col) => S(d`M0,${b.top - 2.6} Q${b.fw * 1.6},${b.top - 2.6} ${b.fw * 1.55},${b.y(0.5)} L${b.fw * 1.28},${b.y(0.46)} Q${b.fw * 1.2},${b.y(0.02)} 0,${b.y(-0.02)}`, col);
// cappuccio alzato con mantellina; deep = quanto è buio il viso
const cappuccio = (b, col, deep = 0.45) => S(d`M0,${b.top - 3.5} Q${b.fw * 1.7},${b.top - 2.5} ${b.fw * 1.55},${b.y(0.55)} L${b.fw * 1.35},${b.chin + 1} L${b.sh * 0.92},${b.shy + 4} L${b.sh * 0.8},${b.shy + 11} L0,${b.shy + 15} M0,${b.y(0.13)} L${b.fw * 0.9},${b.y(0.24)} L${b.fw * 0.98},${b.y(0.66)} L${b.fw * 0.45},${b.chin + 0.6} L0,${b.chin + 1.4}`, col, `fill-rule="evenodd"`) +
  P(d`M${-b.fw * 0.9},${b.y(0.24)} L0,${b.y(0.13)} L${b.fw * 0.9},${b.y(0.24)} L${b.fw * 0.95},${b.y(0.55)} L${-b.fw * 0.95},${b.y(0.5)} Z`, INK, `opacity="${deep}" stroke="none"`);
const cappelloPaglia = (b) => S(d`M0,${b.top - b.hd * 0.3} L${b.fw * 0.7},${b.top - b.hd * 0.26} L${b.fw * 0.95},${b.y(0.14)} L${b.fw * 2.5},${b.y(0.24)} L${b.fw * 2.4},${b.y(0.34)} L0,${b.y(0.3)}`, K.paglia);
const berretto = (b, col) => { // floscio, con la piuma
  const { fw, hd, top, y } = b;
  return P(d`M${-fw * 0.8},${y(0.04)} Q${-fw * 2.6},${top - hd * 0.2} ${-fw * 2.1},${top - hd * 0.85} Q${-fw * 1.2},${top - hd * 0.4} ${-fw * 0.5},${y(-0.04)} Z`, K.bianco) +
    P(d`M0,${y(0.22)} L${-fw * 1.25},${y(0.2)} L${-fw * 1.2},${y(0.02)} Q${-fw * 0.9},${top - hd * 0.32} 0,${top - hd * 0.36}`, col) +
    P(d`M0,${top - hd * 0.36} Q${fw * 2.1},${top - hd * 0.34} ${fw * 1.95},${y(0.3)} L${fw * 1.2},${y(0.1)} L${fw * 1.25},${y(0.24)} L0,${y(0.22)}`, shade(col));
};
const tocco = (b, col) => S(d`M0,${b.top - b.hd * 0.22} L${b.fw * 1.1},${b.top - b.hd * 0.2} L${b.fw * 1.45},${b.y(0.02)} L${b.fw * 1.5},${b.y(0.16)} L0,${b.y(0.2)}`, col);

const toppa = (x, y, s, col) => P(d`M${x},${y} l${s},${-s * 0.15} l${s * 0.15},${s} l${-s},${s * 0.15} Z`, col, `stroke-dasharray="2 1.5"`);
const borsa = (x, y, s = 1) => P(d`M${x - 3 * s},${y} h${6 * s} l${1.5 * s},${7 * s} q${-4.5 * s},${3 * s} ${-9 * s},0 Z`, K.cuoio);
const cesto = (x, y, w = 10) => P(d`M${x - w},${y} h${2 * w} l-3,11 h${-2 * w + 6} Z`, K.paglia) + L(d`M${x - w},${y} Q${x},${y - 14} ${x + w},${y} M${x - w + 1.5},${y + 4} h${2 * w - 3} M${x - w + 2.5},${y + 7.5} h${2 * w - 5}`, 0.8);

const NPC = {
  monello: { nome: "Monello", h: 124, o: { heads: 5.5, sh: 0.125 }, note: ["tunica di lino troppo grande, toppe,", "corda in vita · scalzo · spada di legno"],
    f: (b) => [legs(b, b.skin, b.skin), robe(b, K.lino, b.ky - 4, b.hw + 5, 1.25), toppa(-9, b.hy + 2, 6, K.lana), toppa(4, b.wy - 13, 5, K.ruggine), belt(b, K.paglia, 1.25, b.wy + 3, false),
      P(d`M${-b.wx - 1.5},${b.wry + 7} L${-b.wx - 12},${b.wry - 40} L${-b.wx - 9.5},${b.wry - 41} L${-b.wx + 1.5},${b.wry + 6} Z`, K.legno), P(d`M${-b.wx - 8},${b.wry - 4} l9,-2.4 l0.6,2.4 l-9,2.4 Z`, K.legno),
      arms(b, K.lino, 3.2), head(b), hair(b, "arruffati", K.lana)] },
  garzone: { nome: "Garzone", h: 140, o: { heads: 6.2, sh: 0.122 }, note: ["camicia di lino, gilet di cuoio,", "brache di lana · cuffia · secchio"],
    f: (b) => { const x0 = -b.wx, y0 = b.wry + b.hl + 8; return [legs(b, K.lana), robe(b, K.lino, b.hy + 4, b.hw + 2, 1.1),
      S(d`M3,${b.shy + 4} L${b.nw + 2},${b.shy - 1} L${b.sh - 1},${b.shy + 2} L${b.w * 1.1 + 0.6},${b.wy} L${b.hw + 1.4},${b.hy + 1} L4.5,${b.hy + 2} Z`, K.cuoio), belt(b, K.nero, 1.1),
      P(d`M${x0 - 8},${y0} h16 l-2,15 h-12 Z`, K.legno), L(d`M${x0 - 8},${y0} Q${x0},${y0 - 13} ${x0 + 8},${y0} M${x0 - 7.4},${y0 + 4} h14.8 M${x0 - 6.6},${y0 + 11} h13.2`, 1),
      arms(b, K.lino, 2.4, true), head(b), hair(b, "corti", K.trave), cuffia(b, K.lino)]; } },
  bambina: { nome: "Bambina", h: 118, o: { heads: 5.5, sh: 0.115 }, note: ["veste color muschio, grembiule di lino,", "trecce · bambola di pezza"],
    f: (b) => { const x0 = b.wx, y0 = b.wry + b.hl; return [legs(b, b.skin), robe(b, K.muschio, b.ay - 9, b.hw + 9, 0.95),
      S(d`M0,${b.wy - 7} L${b.w * 0.7},${b.wy - 7} L${b.w * 0.8},${b.wy} L${b.hw + 3.5},${b.ay - 15} L0,${b.ay - 14}`, K.lino),
      P(d`M${x0 - 1},${y0 + 4} L${x0 - 5},${y0 + 17} L${x0 + 4},${y0 + 17} Z`, K.ruggine), O(x0 - 0.5, y0 + 2, 3, K.lino),
      arms(b, K.muschio), head(b), hair(b, "trecce", "#7a683c")]; } },
  educanda: { nome: "Educanda", h: 138, o: { heads: 6.2, sh: 0.112 }, note: ["veste lunga petrolio, mantellina di lana,", "fazzoletto ruggine · cesto"],
    f: (b) => [hair(b, "dietro", K.trave), legs(b, K.lana), robe(b, K.petrolio, b.ay - 4, b.hw + 8, 0.9), belt(b, K.paglia, 0.9, b.wy, false), cesto(-b.wx, b.wry + b.hl + 9),
      arms(b, K.petrolio), S(d`M0,${b.shy + 2} L${b.nw + 1.5},${b.shy - 2} L${b.sh + 2.5},${b.shy + 2} L${b.sh + 4},${b.shy + 15} L0,${b.shy + 20}`, K.lana), head(b), fazzoletto(b, K.ruggine)] },

  contadino: { nome: "Contadino", h: 174, o: {}, note: ["camicia di lino rimboccata,", "brache di lana,", "cappello di paglia · zappa"],
    f: (b) => { const x0 = b.wx + 1; return [P(d`M${x0 - 1.2},0 L${x0 - 0.6},${-b.H - 12} h2.4 L${x0 + 1.4},0 Z`, K.legno), P(d`M${x0 + 1},${-b.H - 11} l12,3 l1,8 l-13,-5 Z`, K.ferro),
      legs(b, K.lana), robe(b, K.lino, b.hy + 9, b.hw + 3, 1.15), belt(b, K.cuoio, 1.15), arms(b, K.lino, 2.4, true), head(b), beard(b, K.lana, 0.06), cappelloPaglia(b)]; } },
  fabbro: { nome: "Fabbro", h: 178, o: { sh: 0.138, w: 0.85, hip: 0.8 }, note: ["grembiule di cuoio al ginocchio,", "braccia nude · calvo,", "barba nera · martello"],
    f: (b) => { const x0 = -b.wx; return [legs(b, "#3a332c"), robe(b, K.ruggine, b.hy + 6, b.hw + 2),
      S(d`M0,${b.shy + 9} L${b.sh * 0.5},${b.shy + 9} L${b.w + 0.6},${b.wy} L${b.hw + 2.5},${b.ky + 2} L0,${b.ky + 4}`, K.cuoio), L(d`M${-b.sh * 0.5},${b.shy + 9} L${-b.nw - 1},${b.shy - 1} M${b.sh * 0.5},${b.shy + 9} L${b.nw + 1},${b.shy - 1}`, 1.6), belt(b, K.nero),
      P(d`M${x0 - 1.2},${b.wry - 4} h2.4 v26 h-2.4 Z`, K.legno), P(d`M${x0 - 6.5},${b.wry + 22} h13 v8 h-13 Z`, K.ferro),
      arms(b, b.skin, 2.8, true), head(b), beard(b, K.nero, 0.75, 1.1)]; } },
  cittadino: { nome: "Cittadino", h: 172, o: { sh: 0.118 }, note: ["tunica ruggine, calze petrolio,", "cappuccio con mantellina,", "borsa alla cintura"],
    f: (b) => [legs(b, K.petrolio), robe(b, K.ruggine, b.cy + 12, b.hw + 4, 1.05), belt(b, K.cuoio, 1.05), borsa(-8, b.wy + 1.6), arms(b, K.ruggine), head(b), cappuccio(b, K.muschio, 0.25)] },
  lavandaia: { nome: "Lavandaia", h: 164, o: { sh: 0.105, w: 0.66, hip: 0.98 }, note: ["veste ocra, grembiule,", "maniche rimboccate, fazzoletto,", "cesta dei panni sul fianco"],
    f: (b) => [legs(b, K.lana), robe(b, K.ocra, b.ay - 4, b.hw + 10),
      S(d`M0,${b.wy + 1} L${b.w * 0.85},${b.wy} L${b.hw + 4},${b.ay - 12} L0,${b.ay - 11}`, K.lino),
      P(d`M${b.hw - 2},${b.hy - 4} q6,-11 14,-7 q10,-6 15,7 Z`, K.bianco), P(d`M${b.hw - 4},${b.hy - 4} h32 l-4,14 h-24 Z`, K.paglia), L(d`M${b.hw - 2.5},${b.hy + 1} h29 M${b.hw - 1.5},${b.hy + 5.5} h27`, 0.8),
      arms(b, K.ocra, 2.4, true), head(b), fazzoletto(b, K.ruggine)] },
  ostessa: { nome: "Ostessa", h: 168, o: { sh: 0.108, w: 0.64, hip: 1 }, note: ["gonna vino, corpetto di cuoio", "allacciato, camicia di lino,", "crocchia · brocca"],
    f: (b) => { const x0 = -b.wx, y0 = b.wry + b.hl - 2; return [legs(b, K.lana), robe(b, K.vino, b.ay - 3, b.hw + 11),
      S(d`M0,${b.shy + 1.5} L${b.nw + 1},${b.shy - b.hd * 0.1} L${b.sh},${b.shy + b.hd * 0.12} L${b.sh + 0.3},${b.shy + 6} L${b.sh * 0.9},${b.shy + 9} L0,${b.shy + 10}`, K.lino),
      S(d`M0,${b.shy + 9} L${b.sh * 0.68},${b.shy + 7} L${b.w + 0.8},${b.wy + 1} L0,${b.wy + 4}`, K.cuoio),
      L(d`M-2,${b.shy + 12} l4,3 l-4,3 l4,3 l-4,3 l4,3 l-4,3`, 0.9),
      S(d`M0,${b.wy + 3} L${b.w * 0.85},${b.wy + 2} L${b.hw + 2},${b.ky} L0,${b.ky + 2}`, K.lino),
      P(d`M${x0 - 5},${y0} h9 l2.5,7 l-1.5,10 h-11 l-1.5,-10 Z`, K.coppo), L(d`M${x0 - 6.5},${y0 + 3} q-6,5 0,11`, 1.6),
      arms(b, K.lino, 3), head(b), hair(b, "crocchia", "#5e3323")]; } },
  cittadina: { nome: "Cittadina", h: 166, o: { sh: 0.106, w: 0.66, hip: 0.95 }, note: ["veste muschio fino a terra,", "scialle viola, soggolo bianco,", "chiavi alla cintura"],
    f: (b) => [legs(b, K.lana), robe(b, K.muschio, b.ay - 2, b.hw + 9), belt(b, K.cuoio), L(d`M5,${b.wy + 1.6} v9 m-1.5,0 l1.5,4 l1.5,-4`, 1.3), arms(b, K.muschio, 2.8),
      S(d`M0,${b.shy + 3} L${b.nw + 2},${b.shy - 2.5} L${b.sh + 2.5},${b.shy + 2} L${b.sh + 4},${b.wy - 8} L${b.sh * 0.5},${b.wy - 2} L0,${b.wy + 6}`, K.viola), head(b), soggolo(b)] },

  mercante: { nome: "Mercante", h: 170, o: { sh: 0.128, w: 1.1, hip: 1.12, skin: K.pallido }, note: ["cappa vino bordata di pelo, ventre largo,", "berretto ocra con piuma · borsa gonfia"],
    f: (b) => { const hem = b.ay - 16, hw = b.hw + 6; return [legs(b, K.nero), robe(b, K.vino, hem, hw),
      S(d`M0,${b.shy + 4} L${b.nw + 3},${b.shy - 2} L${b.nw + 7},${b.shy} L5,${b.wy} L5.5,${hem} L0,${hem + 1}`, K.lana), S(d`M0,${hem - 4} L${hw - 0.6},${hem - 5} L${hw},${hem} L0,${hem + 1}`, K.lana),
      belt(b, K.cuoio, 1.02, b.wy + 7), borsa(10, b.wy + 8.6, 1.5), arms(b, K.vino, 3.6),
      S(d`M${b.wx - 3.8},${b.wry - 4} L${b.wx + 3.8},${b.wry - 5} L${b.wx + 3.8},${b.wry} L${b.wx - 3.8},${b.wry + 2.5} Z`, K.lana),
      head(b), L(d`M${-b.fw * 0.5},${b.chin + 1.2} Q0,${b.chin + 4} ${b.fw * 0.5},${b.chin + 1.2}`, 0.9), S(d`M0,${b.y(0.72)} L${b.fw * 0.6},${b.y(0.78)} L0,${b.y(0.79)}`, K.lana), berretto(b, K.ocra)]; } },
  sindaco: { nome: "Sindaco", h: 184, o: { sh: 0.112, w: 0.7, hip: 0.85, skin: K.pallido }, note: ["toga nera fino a terra, pannello viola,", "catena d'oro · tocco · bastone della carica"],
    f: (b) => { const x0 = -b.wx - 0.5; return [P(d`M${x0 - 1},0 L${x0 - 0.8},${-b.H * 0.8} h1.8 L${x0 + 1},0 Z`, K.trave), O(x0, -b.H * 0.8 - 2, 2.8, K.oro),
      legs(b, K.nero), robe(b, K.nero, b.ay - 3, b.hw + 7), S(d`M0,${b.shy + 5} L4,${b.shy + 4} L5,${b.ay - 3} L0,${b.ay - 2}`, K.viola),
      S(d`M0,${b.shy + 1} L${b.nw + 2.5},${b.shy - 2} L${b.nw + 3},${b.shy + 2.5} L0,${b.shy + 5}`, K.bianco),
      `<path d="${d`M${-b.sh * 0.8},${b.shy + 3} L0,${b.wy - 14} L${b.sh * 0.8},${b.shy + 3}`}" fill="none" stroke="${K.oro}" stroke-width="4" stroke-dasharray="5 2"/>`, O(0, b.wy - 11, 3.4, K.oro),
      arms(b, K.nero, 3.4), head(b), beard(b, K.grigio, 0.5, 0.5), tocco(b, K.nero)]; } },
  parroco: { nome: "Parroco", h: 172, o: { sh: 0.12, w: 0.88, hip: 0.9 }, note: ["tonaca bruna, stola viola con bande ocra,", "corda in vita · tonsura · libro, amuleto"],
    f: (b) => { const x0 = b.wx; return [legs(b, K.nero), robe(b, K.tonaca, b.ay - 2, b.hw + 6),
      S(d`M${b.nw + 0.5},${b.shy - 1} L${b.nw + 5},${b.shy + 0.5} L7.5,${b.ky - 4} L2.5,${b.ky - 4} Z`, K.viola), S(d`M2.6,${b.ky - 9} h4.8 v2.5 h-4.8 Z`, K.ocra),
      belt(b, K.paglia, 1, b.wy + 2, false), L(d`M0,${b.shy + 4} V${b.shy + 15}`, 0.9), O(0, b.shy + 17, 2.6, K.oro),
      P(d`M${x0 - 4},${b.wry - 6} h9 v13 h-9 Z`, K.cuoio), L(d`M${x0 - 4},${b.wry} h9`, 0.8),
      arms(b, K.tonaca, 3.2), head(b), hair(b, "tonsura", K.grigio)]; } },
  suora: { nome: "Suora", h: 160, o: { sh: 0.104, w: 0.75, hip: 1, skin: K.pallido }, note: ["abito grigio scuro fino a terra, scapolare,", "soggolo bianco, velo nero · rosario"],
    f: (b) => [veloDietro(b, K.nero), legs(b, K.nero), robe(b, "#3d3c3e", -1.5, b.hw + 9), S(d`M0,${b.shy + 8} L6,${b.shy + 7} L7,-7 L0,-6`, K.grigio), belt(b, K.paglia, 1, b.wy, false),
      `<path d="${d`M${b.w * 0.6},${b.wy + 2} Q${b.w + 3},${b.hy + 14} ${b.w * 0.7},${b.ky + 2}`}" fill="none" stroke="${K.legno}" stroke-width="3.2" stroke-dasharray="0.1 6"/>`, O(b.w * 0.7, b.ky + 5, 1.6, K.oro),
      arms(b, "#3d3c3e", 4.4), head(b), soggolo(b), veloFronte(b, K.nero)] },

  avventuriero: { nome: "Avventuriero", h: 180, o: { sh: 0.128, w: 0.72 }, note: ["giaco di cuoio su maglia di ferro, mantello", "logoro, stivali · spada al fianco, rotolo in spalla"],
    f: (b) => [S(d`M0,${b.shy} L${b.sh + 4},${b.shy + 1} L${b.sh + 11},${b.wy} L${b.sh + 13},${b.ky - 2} L${b.sh + 8},${b.ky + 5} L${b.sh + 5},${b.ky - 1} L${b.sh},${b.ky + 6} L0,${b.ky + 2}`, "#3f4436"),
      P(d`M${-b.sh * 0.8},${b.shy - 9} h${b.sh * 1.6} q3,4.5 0,9 h${-b.sh * 1.6} q-3,-4.5 0,-9 Z`, K.ruggine), L(d`M${-b.sh * 0.4},${b.shy - 9} v9 M${b.sh * 0.4},${b.shy - 9} v9`, 1.6),
      legs(b, K.lana), S(d`M${b.hw * 0.3},${b.ky + 5} L${b.hw * 0.9},${b.ky + 3} L${b.hw * 0.76},${b.ay} L${b.hw * 0.22},${b.ay} Z`, K.cuoio),
      robe(b, K.ferro, b.cy + 10, b.hw + 3, 1.05), L(d`M${-b.hw - 1},${b.cy + 4} h${2 * b.hw + 2} M${-b.hw - 2},${b.cy + 7} h${2 * b.hw + 4}`, 0.7, `stroke-dasharray="1.5 1.5"`),
      robe(b, K.cuoio, b.hy + 4, b.hw + 2.2, 1.05), belt(b, K.nero, 1.05),
      P(d`M${-b.sh * 0.75},${b.shy + 3} L${-b.sh * 0.5},${b.shy + 1.5} L${b.w * 1.05 + 1},${b.wy - 2} L${b.w * 1.05 + 0.5},${b.wy + 1.5} Z`, K.nero),
      P(d`M${b.hw + 1},${b.hy - 4} l4,-1 l13,${b.H * 0.36} l-3,2 Z`, K.trave), P(d`M${b.hw - 2.5},${b.hy - 16} l3.4,-1 l3,12 l-3.4,1 Z`, K.nero), P(d`M${b.hw - 5},${b.hy - 3} l13,-3.6 l0.7,2.4 l-13,3.6 Z`, K.ferro), O(b.hw - 1.4, b.hy - 18, 2, K.ferro),
      arms(b, K.lana), S(d`M${b.ex + 2.6},${b.ey + 8} L${b.wx + 2.6},${b.wry - 1} L${b.wx - 2.6},${b.wry - 1} L${b.ex - 2.4},${b.ey + 9} Z`, K.cuoio),
      S(d`M0,${b.shy + 6} L${b.nw + 4},${b.shy - 4} L${b.sh * 0.8},${b.shy} L${b.sh * 0.66},${b.shy + 7} L0,${b.shy + 12}`, K.muschio), head(b),
      P(d`M${-b.fw * 0.97},${b.y(0.6)} L${-b.fw * 0.5},${b.chin - 1} L0,${b.chin} L${b.fw * 0.5},${b.chin - 1} L${b.fw * 0.97},${b.y(0.6)} L0,${b.y(0.72)} Z`, INK, `opacity=".28" stroke="none"`),
      L(d`M${-b.fw * 0.62},${b.y(0.3)} L${-b.fw * 0.36},${b.y(0.68)}`, 0.9), hair(b, "corti", K.nero)] },
  mago: { nome: "Mago", h: 182, o: { sh: 0.11, w: 0.8, hip: 0.9, skin: K.pallido }, note: ["veste viola stinta bordata d'ocra, maniche", "larghe, cappuccio fondo · bastone con cristallo"],
    f: (b) => { const x0 = -b.wx - 1, H = b.H; return [
      P(d`M${x0 - 1.3},0 L${x0 - 0.6},${-H * 0.5} L${x0 - 1.6},${-H * 0.8} L${x0 - 0.4},${-H - 14} L${x0 - 5},${-H - 24} L${x0 - 3.4},${-H - 25} L${x0 + 0.4},${-H - 18} L${x0 + 4},${-H - 26} L${x0 + 5.4},${-H - 24.6} L${x0 + 1.8},${-H - 13} L${x0 + 0.6},${-H * 0.8} L${x0 + 1.5},${-H * 0.5} L${x0 + 1.3},0 Z`, K.trave),
      P(d`M${x0},${-H - 32} l3.2,5.5 l-3,6 l-3.2,-6 Z`, "#7fa39d"),
      legs(b, K.nero), robe(b, K.viola, -1.5, b.hw + 10), S(d`M0,-7 L${b.hw + 9.3},-8.5 L${b.hw + 10},-1.5 L0,-0.5`, K.ocra),
      belt(b, K.cuoio), borsa(-9, b.wy + 1.6, 1.2), P(d`M7,${b.wy + 1} h4.5 v11 h-4.5 Z`, K.lino),
      arms(b, K.viola, 5.5), S(d`M${b.wx - 5.6},${b.wry - 1.5} L${b.wx + 5.6},${b.wry - 4} L${b.wx + 5.5},${b.wry} L${b.wx - 5.5},${b.wry + 2.5} Z`, K.ocra),
      head(b, true), cappuccio(b, K.viola, 0.5), beard(b, "#a9a595", 1.5, 0.6), L(d`M0,${b.chin + b.hd * 1.5} v5`, 0.9), O(0, b.chin + b.hd * 1.5 + 7.5, 2.6, K.oro)]; } },
  vecchio: { nome: "Vecchio", h: 164, o: { stoop: 0.42, sh: 0.112, w: 0.8 }, note: ["schiena curva, palandrana di lana rattoppata,", "coperta sulle spalle · barba bianca · bastone"],
    f: (b) => { const x0 = -b.wx; return [P(d`M${x0 - 1},${b.wry - 3} L${x0 + 1.6},${b.wry - 3} L${x0 - 4},0 L${x0 - 6.6},0 Z`, K.legno),
      legs(b, K.grigio), robe(b, K.lana, b.ky + 2, b.hw + 4, 1.05), toppa(-10, b.hy + 6, 7, K.grigio), toppa(3, b.wy + 6, 5, K.ruggine), belt(b, K.paglia, 1.05, b.wy, false), arms(b, K.lana, 2.8),
      S(d`M0,${b.shy + 6} L${b.nw + 3},${b.shy - 4} L${b.sh + 3},${b.shy + 1} L${b.sh + 4.5},${b.shy + 20} L${b.sh * 0.4},${b.shy + 14} L0,${b.shy + 22}`, K.muschio),
      head(b, true), hair(b, "tonsura", K.bianco), beard(b, K.bianco, 1.1, 0.7)]; } },
  vecchia: { nome: "Vecchia", h: 150, o: { stoop: 0.45, sh: 0.112, w: 0.85, hip: 1.05 }, note: ["veste scura fino a terra, grembiule grigio,", "scialle sul capo · cesto d'erbe · bastone"],
    f: (b) => { const x0 = -b.wx, x1 = b.wx, y1 = b.wry + b.hl + 9; return [P(d`M${x0 - 1},${b.wry - 3} L${x0 + 1.6},${b.wry - 3} L${x0 - 3},0 L${x0 - 5.6},0 Z`, K.legno),
      legs(b, K.nero), robe(b, "#33292a", -1.5, b.hw + 8), S(d`M0,${b.wy + 1} L${b.w * 0.8},${b.wy} L${b.hw + 3},-12 L0,-11`, K.grigio),
      L(d`M${x1 - 5},${y1} l-3,-13 M${x1 - 1},${y1} l-1,-16 M${x1 + 3},${y1} l3,-14 M${x1 + 6},${y1} l5,-10`, 1.6, `stroke="${K.muschio}"`), cesto(x1, y1),
      arms(b, "#33292a", 3), head(b, true), cappuccio(b, "#5e3b2e", 0.3)]; } },
};

function npcSheet(file, titolo, sotto, ids, s) {
  const base = 800, col = 1440 / ids.length, out = [`<path d="M60,${base} H1540" stroke="${INK}" stroke-width="1.6"/>`];
  for (let cm = 50; cm <= 200 && base - cm * s > 130; cm += 50) out.push(`<path d="M96,${base - cm * s} H1540" stroke="${INK}" stroke-width=".7" stroke-dasharray="2 8" opacity=".4"/>`, T(60, base - cm * s + 4, "n", cm + " cm"));
  out.push(T(1540, 40, "n", "sagome", "end"));
  ids.forEach((id, i) => {
    const c = NPC[id], x = 100 + col * (i + 0.5);
    out.push(`<g class="f" transform="translate(${x} ${base}) scale(${s})"><g id="${id}">${J(c.f(frame({ h: c.h, ...c.o })))}</g></g>`,
      `<use href="#${id}" class="f" filter="url(#nero)" transform="translate(${1540 - (ids.length - i - 0.5) * 60} 150) scale(${s * 0.17})"/>`,
      T(x, base + 34, "h", c.nome.toUpperCase(), "middle"), T(x, base + 54, "n", `altezza ${c.h} cm`, "middle"), c.note.map((n, j) => T(x, base + 72 + j * 17, "n", n, "middle")));
  });
  sheet(file, titolo, sotto, out, ["lino", "lana", "cuoio", "ruggine", "ocra", "muschio", "vino", "petrolio", "viola", "nero", "grigio", "bianco", "pelle", "ferro"]);
}

const REGOLE = "Sagome spigolose, teste piccole, occhi in ombra · tinte spente di lana e lino, mai sature · luce dura da sinistra · niente di nuovo: tutto è rattoppato, stinto, consumato";
npcSheet("npc-1-bambini.svg", "NPC · I BAMBINI", REGOLE, ["monello", "garzone", "bambina", "educanda"], 3.5);
npcSheet("npc-2-popolani.svg", "NPC · I POPOLANI", REGOLE, ["contadino", "fabbro", "cittadino", "lavandaia", "ostessa", "cittadina"], 2.9);
npcSheet("npc-3-notabili.svg", "NPC · I NOTABILI", REGOLE, ["mercante", "sindaco", "parroco", "suora"], 3);
npcSheet("npc-4-viandanti.svg", "NPC · VIANDANTI E VECCHI", REGOLE, ["avventuriero", "mago", "vecchio", "vecchia"], 3);

// ───────────────────────── props ─────────────────────────
// Edifici in decimetri, arredo in centimetri; origine a terra al centro, y verso l'alto negativa.

const blocks = (x0, y0, x1, y1, n, col, sz = 5) => Array.from({ length: n }, () => { // conci sparsi: la muratura è accennata, non disegnata tutta
  const w = R(sz, sz * 2), h = sz * 0.6, x = R(x0, x1 - w), y = y0 + Math.floor(R(0, (y1 - y0) / h - 0.01)) * h;
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${shade(col, R(0.8, 1.12))}" stroke-width=".6"/>`;
}).join("");
const beam = (x1, y1, x2, y2, t = 2.4, col = K.trave) => {
  const l = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / l * t / 2, ny = (x2 - x1) / l * t / 2;
  return P(d`M${x1 + nx},${y1 + ny} L${x2 + nx},${y2 + ny} L${x2 - nx},${y2 - ny} L${x1 - nx},${y1 - ny} Z`, col, `stroke-width=".7"`);
};
const arco = (x, y, w, h) => d`M${x - w / 2},${y} V${y - h + w * 0.7} Q${x - w / 2},${y - h + w * 0.15} ${x},${y - h} Q${x + w / 2},${y - h + w * 0.15} ${x + w / 2},${y - h + w * 0.7} V${y} Z`; // sesto acuto
const fin = (x, y, w, h, lit, ar) => P(ar ? arco(x, y, w, h) : d`M${x - w / 2},${y} v${-h} h${w} v${h} Z`, lit ? K.lume : K.vetro, `stroke-width="2.2"`) + L(d`M${x},${y} v${-h} M${x - w / 2},${y - h * 0.45} h${w}`, 0.8);
const tetto = (xl0, xr0, y0, xl1, xr1, y1, n) => Array.from({ length: n }, (_, i) => { // filari del manto
  const t = (i + 1) / (n + 1), y = y0 + (y1 - y0) * t, a = xl0 + (xl1 - xl0) * t, b = xr0 + (xr1 - xr0) * t;
  return L(d`M${a},${y} Q${(a + b) / 2},${y + R(-1.5, 1.5)} ${b},${y}`, 0.7, `opacity=".55"`);
});
const omino = (x) => P(d`M${x - 2.2},-14.8 h4.4 l-0.6,6.8 l-0.3,8 h-1.2 l-0.1,-7 l-0.1,7 h-1.2 l-0.3,-8 Z`, INK, NOSTROKE) + O(x, -16.3, 1.15, INK, NOSTROKE); // 1,75 m, in decimetri
const terra = (y) => `<path d="M40,${y} H1560" stroke="${INK}" stroke-width="1.6"/>`;
const metro = (x, y, px, label) => `<path d="M${x},${y} h${px} M${x},${y - 4} v8 M${x + px},${y - 4} v8" stroke="${INK}" stroke-width="1.4" fill="none"/>` + T(x + px / 2, y - 8, "n", label, "middle");
const cap = (x, y, nome, note) => [T(x, y, "h", nome, "middle"), note.map((n, i) => T(x, y + 19 + i * 16, "n", n, "middle"))];
const OMBRA = `opacity=".38" stroke="none"`;

const casaPovera = () => [P(`M12,-46 L13.5,-71 h8 L22,-46 Z`, K.pietraScura), P(`M11.5,-71 h12 v-3 h-12 Z`, K.pietra),
  P(`M-27,0 V-28 H27 V0 Z`, K.intonaco), P(`M-28.5,0 V-9 H28.5 V0 Z`, K.pietraScura), blocks(-28, -9, 28, 0, 18, K.pietra, 5),
  beam(-26, -9, -26, -28, 2.6), beam(26, -9, 26, -28, 2.6), beam(-2, -9, -2, -28, 2.2), beam(-2, -9, 14, -28, 1.8),
  P(`M-27,-28 H27 v4.5 H-27 Z`, INK, OMBRA),
  P(`M-19,0 v-17 q5,-2.5 10,0 v17 Z`, K.trave), L(`M-15.7,0 v-17.8 M-12.3,0 v-17.8`, 0.7, `opacity=".6"`),
  fin(13, -11, 8, 7, true), P(`M18,-19 h5 v8.5 h-5 Z`, K.legno),
  P(`M-33,-25 L-22,-59 Q0,-55 22,-59 L33,-25 Q24,-22.5 16,-25 Q8,-22.5 0,-25 Q-8,-22.5 -16,-25 Q-24,-22.5 -33,-25 Z`, K.paglia), tetto(-32, 32, -27, -22, 22, -59, 7)];

const casaGraticcio = () => [
  P(`M-31,0 V-31 H31 V0 Z`, K.pietra), blocks(-31, -31, 31, 0, 40, K.pietra, 6),
  P(arco(-13, 0, 14, 24), K.pietraScura), P(arco(-13, 0, 10, 21), K.trave), L(`M-13,0 v-21`, 0.7, `opacity=".6"`), P(`M-23,0 h20 v-1.6 h-20 Z`, K.pietraScura),
  P(`M4,-9 h22 v-13 h-22 Z`, K.lume, `stroke-width="2.2"`), L(`M11.3,-9 v-13 M18.6,-9 v-13`, 0.8), P(`M2.5,-9 h25 v2.4 h-25 Z`, K.legno), P(`M2.5,-22 h25 l1.5,-4 h-28 Z`, K.legno),
  P(`M-31,-31 H31 v5 H-31 Z`, INK, OMBRA),
  P(`M-34.5,-34 H34.5 V-63 H-34.5 Z`, K.intonaco),
  [-33.3, -16.6, 0, 16.6, 33.3].map((x) => beam(x, -34, x, -63)), beam(-34.5, -42, 34.5, -42, 2), beam(-32, -62, -18, -43, 2), beam(32, -62, 18, -43, 2), beam(-32, -35, -18, -41, 1.8), beam(32, -35, 18, -41, 1.8),
  fin(-8.3, -43, 10, 14, false), fin(8.3, -43, 10, 14, true),
  P(`M-34.5,-63 H34.5 v4.5 H-34.5 Z`, INK, OMBRA),
  P(`M-35.5,-31 H35.5 v-3.4 H-35.5 Z`, K.trave), [-30, -15, 0, 15, 30].map((x) => P(d`M${x - 1.5},-31 h3 l-1.5,3.5 Z`, K.trave)),
  P(`M-36.5,-66 L0,-113 L36.5,-66 Z`, K.intonaco), beam(0, -66, 0, -110), beam(-19, -90, 19, -90, 2), beam(-29, -66, -12, -89, 2), beam(29, -66, 12, -89, 2),
  fin(-9, -71, 8, 10, false), fin(9, -71, 8, 10, true), fin(0, -94, 5, 7, false),
  P(`M-37.5,-63 H37.5 v-3.2 H-37.5 Z`, K.trave),
  P(`M-43,-62 L0,-120 L43,-62 L38,-62.5 L0,-112.5 L-38,-62.5 Z`, K.ardesia),
  L(`M-31,-27 h-8 v3`, 1.8), P(`M-41.5,-24 h5 l-1,6.5 h-3 Z`, K.lume)];

const casaRicca = () => [
  [-34, 25].map((x) => [P(d`M${x},-110 v-44 h9 v44 Z`, K.pietraScura), P(d`M${x - 1.5},-154 h12 v-3 h-12 Z`, K.pietra)]),
  P(`M-40,0 V-36 H40 V0 Z`, K.pietra), blocks(-40, -36, 40, 0, 50, K.pietra, 7),
  P(arco(0, 0, 24, 32), K.pietraScura), P(arco(0, 0, 17, 27), K.trave), L(`M0,0 V-27 M-5,-8 h3 M2,-8 h3`, 0.9),
  fin(-26, -11, 9, 14, false, true), fin(26, -11, 9, 14, false, true), L(`M-29,-11 v-12 M-23,-11 v-12 M23,-11 v-12 M29,-11 v-12`, 0.8),
  P(`M-40,-39 H40 V-70 H-40 Z`, K.intonaco), blocks(-40, -70, -33, -39, 7, K.pietra, 4), blocks(33, -70, 40, -39, 7, K.pietra, 4),
  P(`M-41.5,-36 H41.5 v-3 H-41.5 Z`, K.pietraScura), P(`M-5,-48 h10 v6 l-5,5 l-5,-5 Z`, K.vino),
  fin(-25, -45, 10, 19, true, true), fin(25, -45, 10, 19, false, true),
  P(`M-41,-72.6 H41 V-96 H-41 Z`, K.intonaco), [-39.6, -26.4, -13.2, 0, 13.2, 26.4, 39.6].map((x) => beam(x, -72.6, x, -96)),
  beam(-39, -74, -27, -95, 1.8), beam(-27, -74, -39, -95, 1.8), beam(39, -74, 27, -95, 1.8), beam(27, -74, 39, -95, 1.8), beam(-13, -85, 13, -85, 1.8),
  fin(-19.8, -78, 8.5, 12, false), fin(19.8, -78, 8.5, 12, true), fin(-6.6, -86, 8, 7, false), fin(6.6, -86, 8, 7, false),
  P(`M-41,-96 H41 v4 H-41 Z`, INK, OMBRA), P(`M-42.5,-70 H42.5 v-2.6 H-42.5 Z`, K.trave),
  P(`M-11,-43 L0,-35 L11,-43 Z`, K.trave), P(`M-13,-43 H13 V-66 H-13 Z`, K.legno), fin(-6, -47, 8, 15, true), fin(6, -47, 8, 15, true), P(`M-16,-66 L0,-77 L16,-66 Z`, K.ardesia), // bovindo
  P(`M-45,-96 H45 v-3 H-45 Z`, K.trave),
  P(`M-47,-99 L-36,-137 Q0,-134 36,-137 L47,-99 Z`, K.ardesia), tetto(-46, 46, -101, -36, 36, -137, 9),
  [-18, 18].map((x) => [P(d`M${x - 6},-103 v-12 l6,-7 l6,7 v12 Z`, K.intonaco), fin(x, -105, 6, 8, x > 0), P(d`M${x - 8.5},-114 L${x},-125 L${x + 8.5},-114 l-2.5,0 L${x},-121.5 L${x - 6},-114 Z`, K.ardesia)])];

const cattedrale = () => [
  P(`M-127,-300 L-90,-468 L-53,-300 Z`, K.ardesia), tetto(-127, -53, -300, -90, -90, -468, 12), [-124, -56].map((x) => P(d`M${x - 6},-300 L${x},-340 L${x + 6},-300 Z`, K.pietraScura)), L(`M-90,-468 v-13`, 1.8), O(-90, -486, 5, K.oro),
  // la torre sud non è mai stata finita: tetto provvisorio, ponteggio e argano
  P(`M52,-300 L90,-336 L128,-300 Z`, K.legno), beam(60, -300, 60, -372, 1.8, K.legno), beam(120, -300, 120, -362, 1.8, K.legno), beam(56, -346, 124, -346, 1.5, K.legno), beam(60, -372, 120, -346, 1.3, K.legno), beam(100, -346, 136, -384, 1.8, K.legno), L(`M136,-384 v44`, 0.9), P(`M132,-340 h8 v7 h-8 Z`, K.pietra),
  M(`M-0.5,0 H55 V-190 L-0.5,-252 Z`, K.pietra), M(`M55,0 H125 V-300 H55 Z`, K.pietra),
  blocks(-125, -300, -55, 0, 50, K.pietra, 9), blocks(55, -300, 125, 0, 50, K.pietra, 9), blocks(-55, -190, 55, 0, 60, K.pietra, 9),
  P(`M55,0 H125 V-300 H55 Z`, INK, `opacity=".17" stroke="none"`), P(`M0,0 H55 V-190 L0,-252 Z`, INK, `opacity=".07" stroke="none"`),
  M(`M117,0 H135 V-95 L128,-106 V-196 L123,-206 V-292 H117 Z`, K.pietraScura), M(`M49,0 H62 V-150 L57,-160 V-236 H49 Z`, K.pietraScura),
  M(`M-0.5,-98 H127 v-4 H-0.5 Z`, K.pietraScura), M(`M55,-205 H127 v-4 H55 Z`, K.pietraScura), M(`M52,-300 H128 v-6 H52 Z`, K.pietraScura),
  P(`M-46,0 h92 v-3 h-92 Z`, K.pietraScura), P(`M-40,-3 h80 v-3 h-80 Z`, K.pietra), P(`M-34,-6 h68 v-3 h-68 Z`, K.pietraScura),
  P(arco(0, -9, 52, 82), K.pietraScura), P(arco(0, -9, 42, 73), K.pietra), P(arco(0, -9, 32, 63), K.trave), L(`M0,-9 V-70 M-13,-22 h9 M4,-22 h9 M-13,-44 h9 M4,-44 h9`, 1),
  [-42, -28, -14, 0, 14, 28, 42].map((x) => P(arco(x, -106, 9, 21), K.pietraScura)),
  O(0, -158, 27, K.pietraScura), O(0, -158, 21, K.vetro), Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6; return [L(d`M0,-158 L${21 * Math.cos(a)},${-158 + 21 * Math.sin(a)}`, 0.8), O(13.5 * Math.cos(a + 0.26), -158 + 13.5 * Math.sin(a + 0.26), 2.6, i % 2 ? K.vino : K.ocra, NOSTROKE)]; }), O(0, -158, 6, K.pietraScura),
  O(0, -217, 7, K.vetro), L(`M0,-252 v-10`, 1.8), O(0, -266, 4, K.oro),
  [-1, 1].map((s) => [[78, 102].map((x) => [P(arco(s * x, -125, 10, 42), K.vetro), P(arco(s * x, -222, 13, 54), K.buio), L(d`M${s * x - 6},-232 h12 M${s * x - 6},-242 h12 M${s * x - 6},-252 h12`, 0.8, `stroke="${K.pietra}"`)]),
    P(arco(s * 90, 0, 22, 36), K.pietraScura), P(arco(s * 90, 0, 15, 29), K.trave), P(arco(s * 90, -58, 5, 20), K.buio)])];

const municipio = () => [
  P(`M-110,0 V-128 H110 V0 Z`, K.intonaco), P(`M-112,0 V-56 H112 V0 Z`, K.pietra), blocks(-112, -56, 112, 0, 60, K.pietra, 8),
  [-88, -44, 0, 44, 88].map((x) => [P(arco(x, 0, 32, 46), K.pietraScura), P(arco(x, 0, 26, 42), K.buio)]), P(arco(0, 0, 14, 27), K.trave),
  P(`M-114,-56 H114 v-4 H-114 Z`, K.pietraScura),
  [-88, -44, 44, 88].map((x, i) => fin(x, -76, 14, 36, i % 2 == 0, true)), fin(0, -66, 16, 44, true, true),
  P(`M-9,-60 h18 v36 l-9,-8 l-9,8 Z`, K.vino), O(0, -44, 4.5, K.oro),
  P(`M-26,-60 h52 v-4 h-52 Z`, K.pietraScura), P(`M-25,-64 h50 v-11 h-50 Z`, K.pietra), L(`M-19,-64 v-11 M-13,-64 v-11 M-7,-64 v-11 M-1,-64 v-11 M5,-64 v-11 M11,-64 v-11 M17,-64 v-11`, 0.8),
  P(`M-110,-128 H110 v5 H-110 Z`, INK, OMBRA), P(`M-116,-128 H116 v-5 H-116 Z`, K.trave),
  P(`M-119,-133 L-78,-184 H78 L119,-133 Z`, K.coppo), tetto(-117, 117, -136, -78, 78, -184, 8),
  [-66, 66].map((x) => [P(d`M${x - 8},-138 v-14 l8,-9 l8,9 v14 Z`, K.intonaco), fin(x, -140, 8, 10, x < 0), P(d`M${x - 11},-151 L${x},-164 L${x + 11},-151 l-3,0 L${x},-160 L${x - 8},-151 Z`, K.coppo)]),
  P(`M-22,-128 H22 V-264 H-22 Z`, K.pietra), blocks(-22, -264, 22, -128, 26, K.pietra, 8), P(`M0,-128 H22 V-264 H0 Z`, INK, `opacity=".15" stroke="none"`),
  O(0, -196, 13, K.bianco), L(`M0,-196 L7,-205 M0,-207 v2 M0,-187 v2 M-11,-196 h2 M9,-196 h2`, 1.6), P(arco(-9, -222, 10, 28), K.buio), P(arco(9, -222, 10, 28), K.buio),
  P(`M-25,-264 H25 v-5 H-25 Z`, K.pietraScura), P(`M-24,-269 L0,-326 L24,-269 Z`, K.ardesia), L(`M0,-326 v-18 M0,-340 l11,3 l-11,3`, 1.5)];

const lanterna = (y, s = 1, glow = true) => { const a = 9 * s, c = 14 * s, h = 40 * s; return [ // y = fondo
  glow ? O(0, y - h * 0.5, 75 * s, "url(#lume)", NOSTROKE) : "",
  P(d`M${-a},${y} L${-c},${y - h} L${c},${y - h} L${a},${y} Z`, K.lume),
  P(d`M${-1.5 * s},${y - 5 * s} q${-4 * s},${-9 * s} ${1.5 * s},${-17 * s} q${5 * s},${8 * s} ${1.5 * s},${17 * s} Z`, "#f3d27a", NOSTROKE),
  P(d`M${-2.5 * s},${y} h${5 * s} v${-5 * s} h${-5 * s} Z`, K.ferro),
  L(d`M0,${y - 22 * s} V${y - h} M${-a - (c - a) * 0.5},${y - h * 0.5} h${a + c}`, 1),
  P(d`M${-a - 2 * s},${y} h${2 * a + 4 * s} v${3 * s} h${-2 * a - 4 * s} Z`, K.ferro),
  P(d`M${-c - 3 * s},${y - h} L0,${y - h - 16 * s} L${c + 3 * s},${y - h} Z`, K.ferro),
  O(0, y - h - 19 * s, 3 * s, "none", `stroke-width="2"`)]; };

const porta = () => [
  M(`M44,0 H150 V-80 H44 Z`, K.pietra), blocks(-150, -80, -46, 0, 40, K.pietra, 9), blocks(46, -80, 150, 0, 40, K.pietra, 9),
  [50, 72, 94, 116, 138].map((x) => M(d`M${x},-80 h12 v-11 h-12 Z`, K.pietra)), M(`M44,-80 H150 v4 H44 Z`, INK, `opacity=".3" stroke="none"`),
  P(`M-46,0 V-150 H46 V0 Z`, K.pietra), blocks(-46, -150, 46, 0, 70, K.pietra, 9), P(`M0,0 H46 V-150 H0 Z`, INK, `opacity=".14" stroke="none"`),
  P(arco(0, 0, 46, 66), K.pietraScura), P(arco(0, 0, 37, 59), K.buio),
  L(`M-15,-56 V-28 M-9,-58 V-28 M-3,-59 V-28 M3,-59 V-28 M9,-58 V-28 M15,-56 V-28 M-18,-36 h36 M-18,-46 h36`, 1.4, `stroke="${K.ferro}"`), [-15, -9, -3, 3, 9, 15].map((x) => P(d`M${x - 1.6},-28 h3.2 l-1.6,5 Z`, K.ferro)),
  P(arco(-27, -84, 4, 16), K.buio), P(arco(27, -84, 4, 16), K.buio), P(`M-8,-104 h16 v10 l-8,8 l-8,-8 Z`, K.vino), O(0, -97, 3, K.oro),
  [-38, 38].map((x) => P(d`M${x - 5},-142 h10 v40 l-5,-6 l-5,6 Z`, K.vino)),
  Array.from({ length: 9 }, (_, i) => P(d`M${-50 + i * 11.8},-150 h6 l-3,8 Z`, K.pietraScura)), P(`M-52,-150 H52 v-16 H-52 Z`, K.pietraScura),
  [-52, -35, -18, -1, 16, 33].map((x) => P(d`M${x},-166 h11 v-10 h-11 Z`, K.pietraScura)), P(`M42,-166 h10 v-10 h-10 Z`, K.pietraScura),
  P(`M-57,-176 L-30,-216 H30 L57,-176 Z`, K.ardesia), tetto(-56, 56, -178, -30, 30, -216, 6),
  [-31, 31].map((x) => [L(d`M${x},-62 h${x < 0 ? -8 : 8}`, 2), `<g transform="translate(${x + (x < 0 ? -8 : 8)} -45) scale(.13)">${J(lanterna(-70))}</g>`])];

const lampione = () => [P(`M-20,0 h40 v-10 h-5 v-22 h-30 v22 h-5 Z`, K.pietra), L(`M-15,-10 h30 M-15,-21 h30 M-3,-10 v-11 M6,-21 v-11`, 0.7),
  P(`M-4,-32 L-2.6,-262 h5.2 L4,-32 Z`, K.ferro), P(`M-6.5,-32 h13 v-9 h-13 Z`, K.ferro), P(`M-4.6,-128 h9.2 v6 h-9.2 Z`, K.ferro),
  P(`M-25,-236 h50 v3.5 h-50 Z`, K.ferro), L(`M-25,-234 q-7,0 -7,7 q0,5 5,5 M25,-234 q7,0 7,7 q0,5 -5,5`, 2),
  P(`M-7,-262 h14 l3,-4 h-20 Z`, K.ferro), lanterna(-266)];
const lampioneMuro = () => [P(`M-34,0 V-338 l9,-7 l8,6 l9,-5 l8,4 V0 Z`, K.pietra), blocks(-33, -330, -1, 0, 26, K.pietra, 12),
  P(`M0,-302 h72 v4 h-72 Z`, K.ferro), L(`M0,-262 Q30,-266 46,-298 M72,-300 q8,0 8,-8 q0,-6 -6,-6`, 2.4), P(`M-3,-306 h6 v50 h-6 Z`, K.ferro),
  L(`M60,-298 v12`, 1.2), `<g transform="translate(60 0)">${J(lanterna(-235, 0.85))}</g>`];
const insegna = () => [P(`M-6,0 L-5,-300 h10 L6,0 Z`, K.trave), P(`M-8,-286 h104 v6 h-104 Z`, K.trave), beam(4, -250, 40, -283, 4), L(`M30,-280 v14 M86,-280 v14`, 1.2),
  P(`M18,-266 h80 v52 q-40,10 -80,0 Z`, K.legno), L(`M18,-250 h80`, 0.6, `opacity=".5"`),
  P(`M46,-256 h22 l-2,30 h-18 Z`, K.ocra), L(`M68,-250 q10,0 10,9 q0,9 -11,9`, 2), P(`M44,-256 q4,-7 9,-3 q5,-6 9,0 q5,-3 8,3 Z`, K.bianco)];
const pozzo = () => [P(`M-70,0 L-75,-70 h150 L70,0 Z`, K.pietra), blocks(-68, -68, 68, -2, 22, K.pietra, 14), P(`M-81,-70 h162 v-9 h-162 Z`, K.pietraScura),
  P(`M-68,-79 h10 v-150 h-10 Z`, K.trave), P(`M58,-79 h10 v-150 h-10 Z`, K.trave), P(`M-58,-178 h116 v10 h-116 Z`, K.legno), L(`M68,-173 h16 v24 h12`, 3),
  L(`M-10,-168 V-112 M-6,-178 v10 M-14,-178 v10`, 1.4), P(`M-21,-112 h22 l-3,24 h-16 Z`, K.legno), L(`M-20,-104 h20 M-19,-94 h18`, 0.8),
  P(`M-98,-222 L0,-292 L98,-222 Z`, K.ardesia), tetto(-98, 98, -222, 0, 0, -292, 6), P(`M-98,-222 h196 v5 h-196 Z`, K.trave)];
const banco = () => [beam(-118, 0, -100, -78, 6), beam(-82, 0, -100, -78, 6), beam(118, 0, 100, -78, 6), beam(82, 0, 100, -78, 6),
  P(`M-128,-85 h7 V-240 h-7 Z`, K.trave), P(`M121,-85 h7 V-224 h-7 Z`, K.trave),
  P(`M-124,-78 h248 v24 q-62,12 -124,0 q-62,-12 -124,0 Z`, K.lino), P(`M-132,-86 h264 v8 h-264 Z`, K.legno),
  P(`M-112,-86 v-22 h54 v22 Z`, K.legno), [-100, -85, -70].map((x) => O(x, -110, 9, K.muschio)), L(`M-112,-97 h54`, 0.7),
  [-30, -8, 14].map((x) => `<ellipse cx="${x}" cy="-92" rx="12" ry="6.5" fill="${K.ocra}"/>`), P(`M50,-86 h44 l-5,-20 h-34 Z`, K.paglia), [58, 72, 86].map((x) => O(x, -108, 7, K.ruggine)),
  L(`M-121,-200 L121,-186`, 1.6), [-70, -50, 40, 60, 80].map((x) => P(d`M${x - 3},${-196 + x * 0.058} h6 l1,26 q-4,5 -8,0 Z`, K.ruggine)),
  Array.from({ length: 8 }, (_, i) => { const x0 = -152 + i * 38, x1 = x0 + 38, t = (x) => -262 + (x + 152) * 0.05, bt = (x) => -226 + (x + 152) * 0.06;
    return P(d`M${x0},${t(x0)} L${x1},${t(x1)} L${x1},${bt(x1)} Q${(x0 + x1) / 2},${bt(x0) + 11} ${x0},${bt(x0)} Z`, i % 2 ? K.vino : K.lino); })];
const fontana = () => [L(`M-58,-150 q-26,8 -34,78 M58,-150 q26,8 34,78`, 1.4, `stroke="#9db3ae"`),
  P(`M-190,0 L-200,-62 h400 L190,0 Z`, K.pietra), blocks(-188, -56, 188, -4, 14, K.pietra, 22), L(`M-100,-2 v-58 M0,-2 v-58 M100,-2 v-58`, 0.8), P(`M-207,-62 h414 v-11 h-414 Z`, K.pietraScura),
  P(`M-22,-73 h44 L16,-134 h-32 Z`, K.pietra), P(`M-76,-158 h152 q-12,24 -56,26 h-40 q-44,-2 -56,-26 Z`, K.pietraScura),
  P(`M-12,-158 h24 L9,-214 h-18 Z`, K.pietra), O(0, -224, 11, K.pietra), P(`M-16,-212 h32 v-5 h-32 Z`, K.pietraScura)];
const panchina = () => [P(`M-84,-48 h8 v-46 h-8 Z`, K.trave), P(`M76,-48 h8 v-46 h-8 Z`, K.trave), P(`M-92,-92 q4,-6 10,0 h164 q6,-6 10,0 v14 h-184 Z`, K.legno), L(`M-90,-85 h180`, 0.6, `opacity=".5"`),
  P(`M-80,0 l4,-40 h20 l4,40 Z`, K.trave), P(`M52,0 l4,-40 h20 l4,40 Z`, K.trave), P(`M-94,-48 h188 v8 h-188 Z`, K.legno), L(`M-60,-44 h50 M10,-45 h70`, 0.6, `opacity=".5"`)];
const pancaPietra = () => [M(`M36,0 v-34 h22 l-4,34 Z`, K.pietraScura), P(`M-66,-46 h132 v12 h-132 Z`, K.pietra), L(`M-66,-40 h132`, 0.6, `opacity=".4"`),
  P(`M-66,-46 q14,-5 26,0 q10,3 20,0 v4 q-22,5 -46,2 Z`, K.muschio, `opacity=".85"`), P(`M30,-34 q8,6 20,2 v-2 Z`, K.muschio, `opacity=".85"`)];
const botti = () => [P(`M-88,0 Q-98,-46 -88,-92 h58 Q-20,-46 -30,0 Z`, K.legno), L(`M-74,-92 Q-80,-46 -74,0 M-59,-92 V0 M-44,-92 Q-38,-46 -44,0`, 0.7, `opacity=".6"`),
  P(`M-91,-76 h64 v6 h-64 Z`, K.ferro), P(`M-93,-49 h68 v6 h-68 Z`, K.ferro), P(`M-91,-22 h64 v6 h-64 Z`, K.ferro),
  P(`M-14,0 v-48 h62 v48 Z`, K.legno), L(`M-14,-32 h62 M-14,-16 h62 M-8,0 v-48 M42,0 v-48`, 0.8),
  P(`M-6,-48 q-5,-24 9,-32 q8,-9 16,0 q17,8 13,32 Z`, K.lino), L(`M7,-78 q9,4 18,0`, 1.2),
  O(92, -34, 34, K.legno), O(92, -34, 27, shade(K.legno, 1.15)), L(`M70,-49 h44 M66,-34 h52 M70,-19 h44`, 0.7, `opacity=".6"`), O(92, -34, 3.5, K.trave)];
const ruota = (cx, cy, r) => [P(d`M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 M${cx - r + 7},${cy} a${r - 7},${r - 7} 0 1,1 ${2 * r - 14},0 a${r - 7},${r - 7} 0 1,1 ${-2 * r + 14},0`, K.trave, `fill-rule="evenodd"`),
  Array.from({ length: 4 }, (_, i) => { const a = i * Math.PI / 4, c = Math.cos(a) * (r - 6), s = Math.sin(a) * (r - 6); return beam(cx - c, cy - s, cx + c, cy + s, 4, K.legno); }), O(cx, cy, 7, K.trave)];
const carretto = () => [P(`M-70,-66 l-78,-12 v-6 l78,8 Z`, K.trave), beam(-56, -62, -64, 0, 5),
  P(`M-58,-106 q30,-36 72,-22 q32,-12 58,22 Z`, K.paglia), P(`M-72,-106 h156 l-6,34 h-144 Z`, K.legno), L(`M-70,-95 h152 M-68,-84 h148 M-40,-106 l2,34 M0,-106 v34 M44,-106 l-2,34`, 0.8),
  P(`M-70,-72 h150 v10 h-150 Z`, K.trave), ruota(22, -42, 42)];
const bacheca = () => [P(`M-58,0 h9 V-190 h-9 Z`, K.trave), P(`M49,0 h9 V-190 h-9 Z`, K.trave), P(`M-62,-172 h124 v90 h-124 Z`, K.legno), L(`M-62,-142 h124 M-62,-112 h124`, 0.6, `opacity=".45"`),
  P(`M-76,-176 L0,-206 L76,-176 L76,-167 L0,-195 L-76,-167 Z`, K.ardesia),
  P(`M-52,-164 l34,3 l-3,42 l-34,-3 Z`, K.lino), L(`M-46,-155 l24,2 M-47,-147 l24,2 M-47,-139 l18,1.5`, 0.7),
  P(`M-8,-160 h30 v32 h-30 Z`, K.bianco), L(`M-3,-152 h20 M-3,-145 h20 M-3,-138 h12`, 0.7),
  P(`M26,-152 l28,-4 l6,48 l-28,4 Z`, K.lino), O(42, -136, 7, K.pelle), L(`M33,-118 l18,-2.6`, 0.8), P(`M-30,-112 h34 v24 h-34 Z`, K.lino), L(`M-25,-105 h22 M-25,-98 h22`, 0.7),
  P(`M40,-100 l2.4,-1 l8,20 l-4,3 Z`, K.ferro)];

const PIETRE = ["pietra", "pietraScura", "intonaco", "trave", "legno", "ardesia", "coppo", "paglia", "ferro", "lume", "vetro", "vino", "muschio"];

sheet("props-1-case.svg", "PROPS · LE CASE", "Prospetti sulla strada alla stessa scala · pietra al piede, graticcio sopra, tetti ripidi · niente è a piombo", [terra(840),
  G(215, 840, 4.7, [omino(-40), casaPovera()], "skewX(1.2)"), G(590, 840, 4.7, [omino(-46), casaGraticcio()], "skewX(-1)"), G(1040, 840, 4.7, [omino(-52), casaRicca()]),
  cap(215, 868, "CASA POVERA", ["fronte 5,5 m · colmo 6 m", "sasso, intonaco sporco, tetto di paglia"]),
  cap(590, 868, "CASA A GRATICCIO", ["fronte 6,5 m · colmo 12 m", "bottega al piano terra, due sporti, timpano sulla strada"]),
  cap(1040, 868, "CASA DEL RICCO", ["fronte 8 m · colmo 13,7 m", "portone, bovindo, ultimo piano a graticcio, abbaini"]),
  metro(1300, 800, 47, "1 m"), T(1300, 190, "h", "REGOLE"),
  ["Piede in pietra, sopra graticcio", "e intonaco sporco, mai bianco.", "", "Ogni piano sporge di 30–40 cm", "su quello di sotto.", "", "Tetti ripidi, 55–60°: ardesia in città,", "paglia ai margini.", "", "Niente è a piombo: colmi insellati,", "pali storti, facciate che pendono.", "",
    "Travi quasi nere. Finestre poche", "e piccole, a piombo.", "", "Di sera una finestra su due è accesa:", "quel lume caldo è l'unico colore", "vivo della strada."].map((n, i) => T(1300, 216 + i * 18, "n", n))], PIETRE);

sheet("props-2-edifici.svg", "PROPS · CATTEDRALE, MUNICIPIO, PORTA", "Prospetti alla stessa scala · pietra grigia fredda, ardesia, coppi spenti · il colore sta solo negli stendardi e nei lumi", [terra(850),
  G(270, 850, 1.5, [omino(-150), cattedrale()]), G(730, 850, 1.5, [omino(-128), municipio()]), G(1250, 850, 1.5, [omino(-62), porta()]),
  cap(270, 878, "CATTEDRALE", ["fronte 25 m · torre nord 48 m", "la torre sud non è mai stata finita: tetto provvisorio e ponteggio"]),
  cap(730, 878, "MUNICIPIO", ["fronte 22 m · torre dell'orologio 34 m", "portico in pietra, balcone con lo stendardo, tetto di coppi"]),
  cap(1250, 878, "PORTA DELLA CITTÀ", ["torre 9 × 21 m · mura 8 m con i merli", "saracinesca a metà, caditoie, lanterne a olio ai lati"]),
  metro(1485, 820, 75, "5 m"), T(1010, 160, "h", "REGOLE"),
  ["Gli edifici civici sono di pietra da cima a fondo:", "è così che si distinguono dalle case.", "", "Alti e stretti, archi a sesto acuto. Le torri si vedono", "da ogni vicolo e fanno da bussola a chi gira la città.", "",
    "Qualcosa è sempre rotto o non finito: una torre mozza,", "un ponteggio, un tetto rappezzato.", "", "Stendardi color vino e un disco d'oro: lo stesso emblema", "su porta, municipio, cattedrale e addosso al clero."].map((n, i) => T(1010, 186 + i * 18, "n", n))], PIETRE);

sheet("props-3-arredo.svg", "PROPS · L'ARREDO DI STRADA", "Ferro battuto nero, legno scuro, pietra consunta · i lampioni a olio sono l'unica luce calda della città", [
  terra(470), G(40, 470, 10, omino(0)), G(120, 470, 1, lampione()), G(250, 470, 1, lampioneMuro()), G(385, 470, 1, insegna()), G(640, 470, 1, pozzo()), G(930, 470, 1, banco()), G(1320, 470, 1, fontana()),
  cap(120, 494, "LAMPIONE A OLIO", ["3,3 m, base in pietra"]), cap(262, 494, "A MURO", ["braccio in ferro"]), cap(425, 494, "INSEGNA", ["locanda, botteghe"]),
  cap(640, 494, "POZZO", ["vera in pietra, argano, tettuccio"]), cap(930, 494, "BANCO DEL MERCATO", ["cavalletti, tenda a strisce stinte"]), cap(1320, 494, "FONTANA", ["vasca di 4 m, catino e due getti"]),
  metro(1440, 140, 100, "1 m"),
  terra(850), G(110, 850, 3.4, lanterna(-3, 1, false)), G(335, 850, 1.35, panchina()), G(575, 850, 1.35, pancaPietra()), G(815, 850, 1.35, botti()), G(1215, 850, 1.35, carretto()), G(1450, 850, 1.35, bacheca()),
  cap(110, 874, "LANTERNA", ["vetri piombati, serbatoio", "e stoppino, sfiato in cima"]), cap(335, 874, "PANCHINA", ["asse su due ceppi, schienale"]), cap(575, 874, "PANCA DI PIETRA", ["lastra su due blocchi, muschio"]),
  cap(830, 874, "BOTTI, CASSE, SACCHI", ["a mucchi contro i muri"]), cap(1190, 874, "CARRETTO A MANO", ["due ruote, stanghe, puntello"]), cap(1450, 874, "BACHECA", ["avvisi, taglie, un pugnale"]),
  metro(1010, 610, 135, "1 m")], PIETRE);

{ // mattonati: campioni visti dall'alto, 2,2 × 1,6 m (1 px = 5 mm)
  const W = 440, H = 320, n1 = (v) => v.toFixed(1), tint = (c, k = 0.14) => shade(c, R(1 - k, 1 + k)), t = [];
  const rect = (x, y, w, h, fill, rx = 2) => `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" rx="${rx}" fill="${fill}"/>`;
  const elli = (x, y, rx, ry, fill, e = "") => `<ellipse cx="${n1(x)}" cy="${n1(y)}" rx="${n1(rx)}" ry="${n1(ry)}" fill="${fill}" ${e}/>`;
  const moss = (n) => Array.from({ length: n }, () => O(R(0, W), R(0, H), R(3, 8).toFixed(1), K.muschio, `opacity=".45" stroke="none"`));
  const bg = (c) => `<rect width="${W}" height="${H}" fill="${c}" stroke="none"/>`;
  { const a = [bg("#2a251e")];
    for (let y = -10, r = 0; y < H + 20; y += 24, r++) for (let x = -20 + (r % 2) * 15; x < W + 20; x += 30) {
      const cx = x + R(-4, 4), cy = y + R(-3, 3), rx = R(11, 14.5), ry = R(8.5, 11), rot = `transform="rotate(${R(-35, 35).toFixed(0)} ${n1(cx)} ${n1(cy)})"`;
      a.push(elli(cx, cy, rx, ry, tint(K.pietra), rot), elli(cx - 2, cy - 2, rx * 0.55, ry * 0.5, "#fff", `opacity=".1" stroke="none" ${rot}`));
    }
    t.push(["ACCIOTTOLATO", ["vicoli e strade secondarie · ciottoli di fiume da 10–14 cm", "fughe di terra scura, muschio dove non si passa"], [a, moss(14)]]); }
  { const a = [bg("#2a251e")];
    for (let y = 0; y < H;) { const h = R(50, 74); for (let x = R(-70, 0); x < W;) { const w = R(64, 135); a.push(rect(x + 2, y + 2, w - 4, h - 4, tint(K.pietra, 0.12), 3));
      if (rnd() < 0.25) a.push(L(d`M${x + w * 0.3},${y + 2} l${R(-8, 8)},${h * 0.5} l${R(-8, 8)},${h * 0.5 - 4}`, 0.8, `opacity=".6"`)); x += w; } y += h; }
    t.push(["LASTRICATO", ["vie principali · lastre irregolari da 30–70 cm a correre", "qualcuna spaccata, fughe larghe e sporche"], [a, moss(10)]]); }
  { const a = [bg("#25211c")], s = 21;
    for (let y = 0, r = 0; y < H; y += s, r++) { const ch = r == 7 || r == 8; // canaletta
      for (let x = -(r % 2) * (ch ? 30 : s / 2); x < W; x += ch ? 60 : s) a.push(rect(x + 1 + R(-0.8, 0.8), y + 1, (ch ? 60 : s) - 2, s - 2, tint(ch ? K.pietra : K.pietraScura, ch ? 0.08 : 0.2), 1.5)); }
    a.push(`<path d="M0,${8 * s} H${W}" stroke="${K.buio}" stroke-width="4" opacity=".7"/>`);
    t.push(["CUBETTI CON CANALETTA", ["piazza del mercato · cubetti da 10 cm a filari sfalsati", "al centro la canaletta di scolo in pietra chiara"], [a, moss(6)]]); }
  { const a = [bg("#2a201b")], s = 22;
    for (let cy = -2; cy < H / s + 1; cy++) for (let cx = -2; cx < W / s + 1; cx++) { const m = (((cx - cy) % 4) + 4) % 4;
      if (m == 0) a.push(rect(cx * s + 1, cy * s + 1, 2 * s - 2, s - 2, tint(K.coppo, 0.2), 1)); else if (m == 3) a.push(rect(cx * s + 1, cy * s + 1, s - 2, 2 * s - 2, tint(K.coppo, 0.2), 1)); }
    t.push(["MATTONI A SPINA DI PESCE", ["cortili, locanda, botteghe · mattone cotto 22 × 11 cm", "tinte ruggine disuguali, qualche mattone annerito"], [a]]); }
  { const a = [bg("#2a251e")], s = 78, g = [];
    for (let j = -6; j < 8; j++) for (let i = -2; i < 10; i++) g.push(rect(i * s + 2, j * s + 2, s - 4, s - 4, tint((i + j) % 2 ? "#8b877a" : K.pietra, 0.07), 2));
    for (let j = -6; j < 8; j++) for (let i = -2; i < 10; i++) g.push(rect(i * s - 9, j * s - 9, 18, 18, tint(K.pietraScura, 0.1), 1));
    a.push(`<g transform="rotate(45 220 160)">${g.join("")}</g>`);
    t.push(["SAGRATO DELLA CATTEDRALE", ["lastre quadre da 40 cm posate in diagonale", "tozzetti scuri agli incroci, due tinte di pietra"], [a]]); }
  { const a = [bg("#3a3026")];
    for (let i = 0; i < 7; i++) a.push(L(d`M0,${R(0, H)} Q${W / 2},${R(0, H)} ${W},${R(0, H)}`, R(2, 5).toFixed(1), `stroke="#2b241d" opacity=".6"`));
    for (let i = 0; i < 4; i++) { const x = R(40, W - 40), y = R(30, H - 30), rx = R(20, 42); a.push(elli(x, y, rx, rx * 0.45, "#23282a"), elli(x - rx * 0.2, y - rx * 0.1, rx * 0.4, rx * 0.12, "#6f7f80", `opacity=".35" stroke="none"`)); }
    for (let i = 0; i < 22; i++) a.push(elli(R(0, W), R(0, H), R(3, 9), R(2, 6), tint(K.pietraScura, 0.2)));
    for (let r = 0; r < 3; r++) for (let x = R(-80, -10); x < W;) { const w = R(120, 210); a.push(rect(x, 118 + r * 29 + R(-2, 2), w - 5, 26, tint(K.legno, 0.18), 1), O(x + 6, 131 + r * 29, 1.6, K.buio, NOSTROKE), O(x + w - 12, 131 + r * 29, 1.6, K.buio, NOSTROKE)); x += w; }
    for (let i = 0; i < 40; i++) { const x = R(0, W), y = R(0, H), an = R(0, 6.28); a.push(L(d`M${x},${y} l${Math.cos(an) * 12},${Math.sin(an) * 12}`, 1, `stroke="${K.paglia}" opacity=".7"`)); }
    t.push(["TERRA BATTUTA E ASSI", ["quartiere povero e fuori le mura · fango, pozze, paglia", "passerella di assi inchiodate dove si affonda"], [a]]); }
  sheet("props-4-mattonati.svg", "PROPS · I MATTONATI", "Campioni visti dall'alto, 2,2 × 1,6 m · pietra grigia e cotto spento, fughe scure, sporco e muschio dove non si cammina", t.map(([nome, note, g], i) => {
    const x = 70 + (i % 3) * 500, y = 125 + Math.floor(i / 3) * 400;
    return [`<g class="f" style="stroke-width:.8" transform="translate(${x} ${y})"><g clip-path="url(#tile)">${J(g)}</g><rect width="${W}" height="${H}" fill="none" style="stroke-width:2"/></g>`, T(x, y + H + 24, "h", nome), note.map((n, j) => T(x, y + H + 43 + j * 16, "n", n))];
  }), PIETRE);
}

// ───────────────────────── interni ─────────────────────────
// Piante e sezione in metri nel riferimento dell'edificio, che è quello di house() in town.ts: origine a terra al
// centro dell'ingombro, +Z verso la strada, +X a destra per chi da dentro guarda la strada, y in alto.
// In tavola la strada è in basso e +X va a SINISTRA: è la locanda come sta sulla mappa, col nord in alto.
// Questi numeri sono la specifica dell'interno in gioco: `node docs/reference/citta/tavole.mjs posti` stampa i posti e le luci.

const HW = 4.5, IW = 4.1, QUOTA = [0.12, 3.52], TRAVI = [3.2, 6.3], TRAVE_X = [[-2.4, -1.2, 0, 1.2, 2.4], [-2.5, -1.25, 0, 1.25, 2.5]];   // semi-ingombro, faccia interna dei muri, pavimenti, intradosso delle travi (lungo Z) e dove stanno, piano per piano: sopra, due poggiano sui tramezzi
const SCALA = { x0: -2, x1: 2.8, z0: -4.1, z1: -2.9, vano: -0.8, alzate: 17 };                              // rampa lungo il muro di fondo: piede, cima, larghezza, dove comincia il vano nel solaio
const TAVOLI = [[-0.5, -2, 1], [-3, 3.3, 1], [3, 3.3, 1]];                                                   // centro; 1 = lato lungo secondo X. Tutti contro un muro: il centro della sala resta libero
const CAMERE = [[-4.1, -1.4, -2.1, -1.5, -3.55, -2.2, -2.75], [-1.1, 1.1, -0.4, -1, 0.55, -0.45, -0.75], [1.4, 4.1, 2.1, 1.5, 3.55, 2.2, 2.75]];   // da x, a x, porta, cardine, letto, centro, sgabello
const sedute = ([x, z, ax]) => [-1, 1].flatMap((b) => [-1, 1].map((a) => (ax ? [x + a * 0.45, z + b * 0.62, b < 0 ? 0 : 180] : [x + b * 0.62, z + a * 0.45, b < 0 ? 90 : 270])));
// posti con nome: piano, x, z, verso (0° guarda +Z, 90° guarda +X; per i letti dalla testa ai piedi)
const POSTI = [
  ["porta.fuori", 0, 0, 5.45, 180], ["porta", 0, 0, 2.6, 180], ["sala", 0, -0.5, 1.2, 180], ["sala.fondo", 0, -2.5, -2.2, 180], ["scala", 0, -2.5, -3.5, 90],
  ["focolare", 0, -2.35, 0, 270], ["focolare.sgabello1", 0, -2.45, -1.05, 310], ["focolare.sgabello2", 0, -2.45, 1.05, 230],
  ["bancone", 0, 1.25, 0, 90], ["bancone.sgabello1", 0, 1.35, -2.3, 90], ["bancone.sgabello2", 0, 1.35, -1.5, 90],
  ["bancone.varco", 0, 2.9, 1.8, 180], ["bancone.oste", 0, 2.75, -0.9, 270], ["cucina", 0, 2.85, 0, 90], ["botti", 0, 2.8, -1.9, 90],
  ...TAVOLI.map(([x, z], i) => [`tavolo${i + 1}`, 0, x, z, null]),
  ["scala.cima", 1, 3.45, -3.5, 0], ["pianerottolo", 1, 3.45, -2.25, 270], ["corridoio", 1, 0.6, -2.3, 180], ["ripostiglio", 1, -2.9, -3.2, 180],
  ...CAMERE.flatMap(([, , p, , l, c], i) => [[`camera${i + 1}.porta`, 1, p, -2.25, 0], [`camera${i + 1}`, 1, c, 2.3, 0], [`camera${i + 1}.letto`, 1, l, 3, 180], [`camera${i + 1}.forziere`, 1, l, 1, 0]]),
];
const SEDUTE = TAVOLI.flatMap((t, i) => sedute(t).map(([x, z, yaw], j) => [`tavolo${i + 1}.${j + 1}`, 0, x, z, yaw]));
// percorsi: tratti dritti e sgombri fra un posto e l'altro (almeno 0,9 m di largo); "scala"–"scala.cima" è la rampa
const PASSI = [
  ["porta.fuori", "porta"], ["porta", "sala"], ["sala", "sala.fondo"], ["sala.fondo", "scala"], ["scala", "scala.cima"], ["sala", "focolare"], ["sala", "bancone"],
  ["sala", "bancone.varco"], ["bancone.varco", "cucina"], ["cucina", "bancone.oste"], ["bancone.oste", "botti"],
  ["scala.cima", "pianerottolo"], ["pianerottolo", "camera3.porta"], ["camera3.porta", "corridoio"], ["corridoio", "camera2.porta"], ["camera2.porta", "camera1.porta"], ["camera1.porta", "ripostiglio"],
  ...[1, 2, 3].flatMap((i) => [[`camera${i}.porta`, `camera${i}`], [`camera${i}`, `camera${i}.forziere`]]),
];
// sorgenti di luce: tipo, piano, x, z, altezza sul pavimento di quel piano. Sono quelle di src/world/interiors.ts, provate in gioco:
// il punto è la fiamma (o, per le finestre, il filo interno del muro), non l'oggetto.
const LUCI = [
  ["focolare", 0, -3.1, 0, 0.65], ["cucina", 0, 3.62, 0, 0.85], ["candelabro", 0, -0.5, 1.2, 2.5], ["muro", 0, 0.4, -3.9, 3.54],
  ["candela", 0, -1, -2, 0.98], ["candela", 0, -3.5, 3.3, 0.98], ["candela", 0, 3.5, 3.3, 0.98], ["candela", 0, 2, -2.5, 1.27], ["candela", 0, 2, 0.6, 1.27],
  ["finestra", 0, -2.97, 3.98, 1.68], ["finestra", 0, 2.97, 3.98, 1.68], ["finestra", 1, -2.7, 3.98, 1.63], ["finestra", 1, 0, 3.98, 1.63], ["finestra", 1, 2.7, 3.98, 1.63],
  ["candela", 1, -2.75, 3.75, 0.64], ["candela", 1, -0.75, 3.75, 0.64], ["candela", 1, 2.75, 3.75, 0.64], ["muro", 1, -1.25, -1.8, 1.8], ["muro", 1, 0.85, -1.8, 1.8],
];
const TIPI_LUCE = {   // nome, raggio in metri, forza (la luce cala col quadrato di 1 − distanza / raggio)
  focolare: ["focolare", 9, 1], cucina: ["fuoco di cucina", 5.5, 0.6], candelabro: ["candelabro a ruota, 8 candele", 6.5, 0.8],
  muro: ["candela a muro", 4, 0.45], candela: ["candela", 3.5, 0.4], finestra: ["finestra", 5.5, 0.9],
};

const deve = (ok, msg) => { if (!ok) throw new Error("locanda: " + msg); };
{ // i vincoli del giocatore (capsula di raggio 0,35 m, occhi a 1,68 m)
  const s = SCALA, k = (QUOTA[1] - QUOTA[0]) / (s.x1 - s.x0);
  deve(Math.atan(k) * 180 / Math.PI <= 38 && s.z1 - s.z0 >= 1.1, "scala troppo ripida o stretta");
  deve(TRAVI[0] - QUOTA[0] - (s.vano - s.x0) * k >= 2.1, "sulla rampa si batte la testa prima del vano");
  deve(TRAVI[0] - QUOTA[0] >= 2.6 && TRAVI[1] - QUOTA[1] >= 2.6, "soffitti sotto i 2,6 m");
}

const SM = 42, RAD = Math.PI / 180, r1 = (v) => +v.toFixed(1), c1 = (v) => +(v * 100).toFixed(1);   // px per metro; dentro i gruppi si disegna in centimetri
const it = (v, n = 2) => v.toFixed(n).replace(".", ",").replace("-", "−");
const mpts = (a) => a.map(([x, y]) => c1(x) + "," + c1(y)).join(" L");
const Rm = (x0, y0, x1, y1, fill, e = "") => `<rect x="${c1(Math.min(x0, x1))}" y="${c1(Math.min(y0, y1))}" width="${c1(Math.abs(x1 - x0))}" height="${c1(Math.abs(y1 - y0))}" fill="${fill}" ${e}/>`;
const Pm = (a, fill, e = "") => `<path d="M${mpts(a)} Z" fill="${fill}" ${e}/>`;
const Lm = (a, w = 1, e = "") => `<path d="M${mpts(a)}" fill="none" stroke-width="${w}" ${e}/>`;
const Om = (x, y, r, fill, e = "") => `<circle cx="${c1(x)}" cy="${c1(y)}" r="${c1(r)}" fill="${fill}" ${e}/>`;
const arcM = (x, y, r, a0, a1) => Lm(Array.from({ length: 9 }, (_, i) => [x + r * Math.cos((a0 + (a1 - a0) * i / 8) * RAD), y + r * Math.sin((a0 + (a1 - a0) * i / 8) * RAD)]), 0.7, `stroke-dasharray="2 2.5"`);
// quote e segni in coordinate di pagina
const Tq = (x, y, s, a = "middle", st = "") => `<text x="${x}" y="${y}" class="n" style="font-size:11.5px;${st}" text-anchor="${a}">${s}</text>`;
const ALO = "paint-order:stroke;stroke:#b7ab8e;stroke-width:3.5px;stroke-linejoin:round";   // alone color carta, per le scritte sopra un disegno
const qh = (x0, x1, y, s, up = true, st = "") => `<path d="M${x0},${y} H${x1} M${x0},${y - 3} v6 M${x1},${y - 3} v6" stroke="${INK}" stroke-width=".8" fill="none"/>` + (s ? Tq(r1((x0 + x1) / 2), up ? y - 4 : y + 12, s, "middle", st) : "");
const qv = (x, y0, y1, s, left = true, st = "") => `<path d="M${x},${y0} V${y1} M${x - 3},${y0} h6 M${x - 3},${y1} h6" stroke="${INK}" stroke-width=".8" fill="none"/>` + (s ? Tq(left ? x - 5 : x + 5, r1((y0 + y1) / 2 + 4), s, left ? "end" : "start", st) : "");
const freccia = (x0, y0, x1, y1, col = INK) => { const a = Math.atan2(y1 - y0, x1 - x0), h = (b) => `${r1(x1 - 8 * Math.cos(a + b))},${r1(y1 - 8 * Math.sin(a + b))}`;
  return `<path d="M${x0},${y0} L${x1},${y1} M${h(0.4)} L${x1},${y1} L${h(-0.4)}" stroke="${col}" stroke-width="1.2" fill="none"/>`; };
const fiamma = (x, y, k = 1) => `<path d="M${x},${r1(y + 5 * k)} q${-5 * k},${-5 * k} 0,${-12 * k} q${5 * k},${7 * k} 0,${12 * k} Z" fill="#f3d27a" stroke="${INK}" stroke-width=".8"/>`;
const bollo = (x, y, n, yaw, r = 7) => (yaw == null ? "" : `<path d="M${x},${y} l${r1(-Math.sin(yaw * RAD) * 12.5)},${r1(Math.cos(yaw * RAD) * 12.5)}" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`) +
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${K.bianco}" stroke="${INK}"/><text x="${x}" y="${r1(y + 3.2)}" text-anchor="middle" style="font-size:9px;font-weight:bold">${n}</text>`;

{ // ── la locanda: piante e sezione ──
  const [y0, y1] = QUOTA, [t0, t1] = TRAVI, sc = SCALA, ped = (sc.x1 - sc.x0) / (sc.alzate - 1), alz = (y1 - y0) / sc.alzate, pend = (y1 - y0) / (sc.x1 - sc.x0), tratt = `stroke-dasharray="4 3"`;
  const mattoni = Array.from({ length: 64 }, (_, i) => { const cx = i % 8 - 2, cy = (i >> 3) - 2, m = (((cx - cy) % 4) + 4) % 4;
    return m == 0 ? `<rect x="${cx * 11}" y="${cy * 11}" width="22" height="11"/>` : m == 3 ? `<rect x="${cx * 11}" y="${cy * 11}" width="11" height="22"/>` : ""; }).join("");
  const defs = (ids) => `<defs><pattern id="cotto" width="44" height="44" patternUnits="userSpaceOnUse"><rect width="44" height="44" fill="${K.coppo}"/><g fill="none" stroke="${K.buio}" stroke-width="1.4" opacity=".55">${mattoni}</g></pattern>` +
    `<pattern id="assi" width="240" height="50" patternUnits="userSpaceOnUse"><rect width="240" height="50" fill="${K.legno}"/><path d="M0,0 H240 M0,25 H240 M70,0 V25 M190,25 V50" stroke="${K.buio}" stroke-width="1.4" opacity=".55" fill="none"/></pattern>` +
    `<radialGradient id="freddo"><stop offset="0" stop-color="#c3dad8" stop-opacity=".6"/><stop offset="1" stop-color="#c3dad8" stop-opacity="0"/></radialGradient>` +
    ids.map(([id, x, y]) => `<clipPath id="${id}"><rect x="${x - IW * SM}" y="${y - IW * SM}" width="${2 * IW * SM}" height="${2 * IW * SM}"/></clipPath>`).join("") + `</defs>`;

  // arredi visti dall'alto
  const tavoloP = ([x, z, ax]) => { const [a, b] = ax ? [0.9, 0.4] : [0.4, 0.9], [pa, pb] = ax ? [0.8, 0.16] : [0.16, 0.8], [ox, oz] = ax ? [0, 0.62] : [0.62, 0];
    return [[-1, 1].map((s) => Rm(x + s * ox - pa, z + s * oz - pb, x + s * ox + pa, z + s * oz + pb, shade(K.legno, 0.8))), Rm(x - a, z - b, x + a, z + b, K.legno),
      Lm(ax ? [[x - a, z], [x + a, z]] : [[x, z - b], [x, z + b]], 0.6, `opacity=".5"`)]; };
  const lettoP = (x, z) => [Rm(x - 0.5, z - 1, x + 0.5, z + 1, K.trave), Rm(x - 0.44, z - 0.94, x + 0.44, z + 0.94, K.lino), Rm(x - 0.44, z - 0.94, x + 0.44, z + 0.3, K.lana), Rm(x - 0.3, z + 0.5, x + 0.3, z + 0.86, K.bianco)];
  const forziereP = (x, z, ax = 1) => { const [a, b] = ax ? [0.45, 0.25] : [0.25, 0.45];
    return [Rm(x - a, z - b, x + a, z + b, K.legno), [-1, 1].map((s) => (ax ? Rm(x + s * 0.28 - 0.035, z - b, x + s * 0.28 + 0.035, z + b, K.ferro) : Rm(x - a, z + s * 0.28 - 0.035, x + a, z + s * 0.28 + 0.035, K.ferro)))]; };
  const sgabelloP = (x, z) => Om(x, z, 0.17, K.legno);
  const botteP = (z) => [Pm([[3.2, z - 0.29], [3.65, z - 0.35], [4.08, z - 0.29], [4.08, z + 0.29], [3.65, z + 0.35], [3.2, z + 0.29]], K.legno),
    [3.34, 3.94].map((x) => Lm([[x, z - 0.31], [x, z + 0.31]], 2, `stroke="${K.ferro}"`)), Lm([[3.2, z], [3.06, z]], 2.2)];
  const ominoP = (x, z) => `<ellipse cx="${c1(x)}" cy="${c1(z)}" rx="24" ry="12" fill="${INK}" stroke="none"/>` + Om(x, z, 0.1, INK, NOSTROKE);
  const gradini = (da) => Array.from({ length: sc.alzate - 2 }, (_, i) => sc.x0 + (i + 1) * ped).filter((x) => x > da + 0.01).map((x) => Lm([[x, sc.z0], [x, sc.z1]], 0.7));

  const sala = [
    Rm(-IW, -1.1, -2.8, 1.1, K.pietra), Rm(-IW, -0.75, -2.8, 0.75, K.buio), [-0.24, 0.2].map((z) => Rm(-3.9, z - 0.06, -3.1, z + 0.06, K.trave)), Om(-3.5, 0, 0.27, K.lume, NOSTROKE),   // il focolare
    sgabelloP(-2.45, -1.05), sgabelloP(-2.45, 1.05),
    Rm(-IW, -2.65, -3.6, -1.25, K.legno), Array.from({ length: 5 }, (_, i) => Lm([[-IW, -2.41 + i * 0.23], [-3.6, -2.41 + i * 0.23]], 0.6, `opacity=".6"`)),                                // la legna
    Rm(sc.x0, sc.z0, sc.x1, sc.z1, K.legno), gradini(sc.x0), Rm(sc.vano, sc.z0, sc.x1, sc.z1, "none", tratt), Lm([[sc.x0, sc.z1], [sc.x1, sc.z1], [sc.x1, sc.z0]], 2.8),                // la scala, chiusa sotto da un assito
    Om(3.72, -3.72, 0.33, K.legno), Om(3.72, -3.72, 0.25, shade(K.legno, 1.15)), Om(3.15, -3.74, 0.27, K.lino),                                                                           // sotto l'arrivo: una botte, un sacco
    Rm(1.7, -2.9, 2.3, 1.1, K.legno), Lm([[1.78, -2.9], [1.78, 1.1]], 0.6, `opacity=".5"`), sgabelloP(1.35, -2.3), sgabelloP(1.35, -1.5), botteP(-2.3), botteP(-1.45),                // il bancone e le botti
    Rm(3.3, -0.8, IW, 0.8, K.pietra), Om(3.7, 0, 0.34, K.lume, NOSTROKE), Om(3.7, 0, 0.25, K.ferro), Om(3.7, 0, 0.18, K.buio), Rm(2.7, -0.9, IW, 0.9, "none", tratt),                 // la cucina: banco, paiolo, cappa
    Rm(3.7, 1, IW, 2.4, K.legno), Lm([[3.9, 1], [3.9, 2.4]], 0.6, `opacity=".5"`), TAVOLI.map(tavoloP),
    Rm(-0.95, 4.05, 0.95, HW, K.pietra, NOSTROKE),                                                                                                                                         // il vano del portone
    Pm([[-HW, -HW], [HW, -HW], [HW, HW], [0.85, HW], [0.85, 4.42], [0.95, 4.42], [0.95, IW], [IW, IW], [IW, -IW], [-IW, -IW], [-IW, IW], [-0.95, IW], [-0.95, 4.42], [-0.85, 4.42], [-0.85, HW], [-HW, HW]], K.pietraScura),
    [-2.97, 2.97].map((x) => Rm(x - 0.45, IW, x + 0.45, HW, K.vetro)), Rm(-1.05, HW, 1.05, 4.95, K.pietra),
    [-1, 1].map((m) => [Rm(m * 0.89, 3.47, m * 0.95, 4.42, K.legno), arcM(m * 0.95, 4.42, 0.95, m > 0 ? 180 : 0, m > 0 ? 270 : -90)]), ominoP(0, 4.28),
  ];
  const vani = CAMERE.flatMap(([, , p]) => [p - 0.6, p + 0.6]), pezzi = [-IW, ...vani, IW];
  const camere = [
    Rm(sc.vano, sc.z0, sc.x1, sc.z1, shade(K.legno, 0.55)), gradini(sc.vano),                                                                                                             // il vano: sotto si vede la rampa
    Lm([[sc.vano, sc.z0], [sc.vano, sc.z1], [sc.x1, sc.z1]], 2.4, `stroke="${K.trave}"`), [[sc.vano, sc.z0 + 0.07], [sc.vano, sc.z1], [0.4, sc.z1], [1.6, sc.z1], [sc.x1 - 0.07, sc.z1]].map(([x, z]) => Rm(x - 0.07, z - 0.07, x + 0.07, z + 0.07, K.trave)),
    Rm(-3.7, -IW, -2.3, -3.7, K.legno), Lm([[-3.7, -3.9], [-2.3, -3.9]], 0.6, `opacity=".5"`), forziereP(-3.82, -3.05, 0),                                                                // il ripostiglio
    [-1, 1].map((m) => [Rm(m * IW, -0.5, m * 2.8, 0.5, K.pietraScura), Rm(m * 3.45, -0.2, m * 3.05, 0.2, K.buio)]),                                                                       // le due canne
    CAMERE.map(([, , , , l, , s]) => [lettoP(l, 3), forziereP(l, 1.65), sgabelloP(s, 3.75)]),
    [0, 2, 4, 6].map((i) => Rm(pezzi[i], -1.6, pezzi[i + 1], -1.3, K.trave)), [-1.4, 1.1].map((x) => Rm(x, -1.3, x + 0.3, IW, K.trave)),                                                  // i tramezzi
    CAMERE.map(([, , p, h]) => [Rm(h - 0.03, -1.3, h + 0.03, -0.1, K.legno), arcM(h, -1.3, 1.2, h > p ? 180 : 0, 90)]),
    `<path fill-rule="evenodd" d="M-446,-446 H446 V446 H-446 Z M-410,-410 V410 H410 V-410 Z" fill="${K.pietraScura}"/>`, [-2.7, 0, 2.7].map((x) => Rm(x - 0.5, IW, x + 0.5, 4.46, K.vetro)), ominoP(-3.4, -2.25),
  ];

  const pianta = (cx, cy, p) => {
    const X = (x) => r1(cx - x * SM), Z = (z) => r1(cy + z * SM), gm = (b) => `<g class="f" transform="translate(${cx} ${cy}) scale(${-SM / 100} ${SM / 100})">${J([b])}</g>`;
    const top = Z(-HW) - 13, dx = X(-HW) + 30, alone = { focolare: 3.3, cucina: 2.1, candelabro: 2.3, muro: 1.3, candela: 1.1, finestra: 2.4 };
    const luci = LUCI.filter((l) => l[1] == p || (p == 1 && l[4] > 3));
    return [
      gm(Rm(-IW, -IW, IW, IW, p ? "url(#assi)" : "url(#cotto)", `fill-opacity=".6" stroke="none"`)),
      `<g clip-path="url(#dentro${p})">${luci.map(([t, , x, z]) => `<circle cx="${X(x)}" cy="${Z(z)}" r="${r1(alone[t] * SM)}" fill="url(#${t == "finestra" ? "freddo" : "lume"})"/>`).join("")}</g>`,
      gm(p ? camere : sala),
      luci.map(([t, , x, z]) => (t == "finestra" ? "" : t == "candelabro" ? [`<circle cx="${X(x)}" cy="${Z(z)}" r="${0.6 * SM}" fill="none" stroke="${INK}" stroke-width="1.1" stroke-dasharray="3 3"/>`,
        Array.from({ length: 8 }, (_, i) => O(X(x) + Math.cos((i + 0.5) * 45 * RAD) * 0.6 * SM, Z(z) + Math.sin((i + 0.5) * 45 * RAD) * 0.6 * SM, 2.2, "#f3d27a", `stroke="${INK}" stroke-width=".7"`))]
        : t == "candela" || t == "muro" ? O(X(x), Z(z), 3.2, "#f3d27a", `stroke="${INK}" stroke-width=".8"`) : fiamma(X(x), Z(z), 1.1))),
      p ? [
        qh(X(IW), X(sc.x1), top, it(IW - sc.x1)), qh(X(sc.x1), X(sc.vano), top, "vano " + it(sc.x1 - sc.vano)), qh(X(sc.vano), X(-IW), top, it(sc.vano + IW)),
        qv(dx, Z(-IW), Z(sc.z1), it(sc.z1 - sc.z0), false), qv(dx, Z(sc.z1), Z(-1.6), it(1.3), false), qv(dx, Z(-1.3), Z(IW), it(5.4), false),
        CAMERE.map(([a, b], i) => [qh(X(b), X(a), Z(4.46) + 13, it(b - a), false), Tq(X((a + b) / 2 - (i - 1) * 0.65), Z(0.75), "camera " + (i + 1))]),
        Tq(X(-1.6), Z(-3.3), "ripostiglio"), freccia(X(2.55), Z(-3.5), X(-0.45), Z(-3.5), K.bianco), Tq(X(1.2), Z(-3.5) - 5, "scende", "middle", `fill:${K.bianco}`),
        `<path d="M${X(0) - 5},${Z(0)} h10 m-5,-5 v10" stroke="${INK}" stroke-width=".9"/>`,
      ] : [
        qh(X(IW), X(sc.x1), top, it(IW - sc.x1)), qh(X(sc.x1), X(sc.x0), top, "rampa " + it(sc.x1 - sc.x0)), qh(X(sc.x0), X(-IW), top, it(sc.x0 + IW)),
        qv(dx, Z(-IW), Z(sc.z1), it(sc.z1 - sc.z0), false), qv(dx, Z(sc.z1), Z(IW), it(IW - sc.z1), false), Tq(X(-1.2), Z(HW) + 15, "portone " + it(1.7), "start"),
        freccia(X(sc.x0 + 0.25), Z(-3.5), X(sc.x1 - 0.3), Z(-3.5), K.bianco), Tq(X(-0.3), Z(-3.5) - 5, "sale", "middle", `fill:${K.bianco}`), Tq(X(HW), Z(HW) + 15, "strada", "start"),
        [-1, 1].map((m) => [`<path d="M${X(m * HW) - m * 4},${Z(0)} h${-m * 17} m${m * 5},0 v-11 m-3.5,5 l3.5,-6 l3.5,6" stroke="${INK}" stroke-width="1.6" fill="none"/>`, T(X(m * HW) - m * 12, Z(0) + 16, "h", "A", "middle")]),
      ],
      PASSI.map((l) => l.map((n) => POSTI.find((q) => q[0] == n))).filter(([a, b]) => a[1] == p && b[1] == p).map(([a, b]) =>
        `<path d="M${X(a[2])},${Z(a[3])} L${X(b[2])},${Z(b[3])}" stroke="${INK}" stroke-width="1.7" stroke-dasharray="0.1 4.5" stroke-linecap="round" opacity=".75"/>`),
      SEDUTE.filter(() => !p).map(([, , x, z, yaw]) => `<path d="M${X(x)},${Z(z)} l${r1(-Math.sin(yaw * RAD) * 7)},${r1(Math.cos(yaw * RAD) * 7)}" stroke="${INK}" stroke-width="1.6"/>` + O(X(x), Z(z), 2.6, INK, NOSTROKE)),
      POSTI.map((q, i) => (q[1] == p ? bollo(X(q[2]), Z(q[3]), i + 1, q[4]) : "")),
    ];
  };

  // sezione A–A: taglio a z = 0 guardando il muro di fondo (−Z); +X resta a sinistra come nelle piante. Sopra il primo piano è tutto chiuso: si ferma lì.
  const sezione = (cx, gy, s) => {
    const X = (x) => r1(cx - x * s), Y = (y) => r1(gy - y * s), gm = (b) => `<g class="f" transform="translate(${cx} ${gy}) scale(${-s / 100} ${-s / 100})">${J([b])}</g>`;
    const rampa = (x) => y0 + (x - sc.x0) * pend, vista = `fill-opacity=".55"`, TOP = 8.5;
    const denti = [[sc.x0, y0], ...Array.from({ length: sc.alzate }, (_, i) => [[sc.x0 + i * ped, y0 + (i + 1) * alz], [Math.min(sc.x1, sc.x0 + (i + 1) * ped), y0 + (i + 1) * alz]]).flat()];
    const sgabelloS = (x) => [[-1, 1].map((m) => Lm([[x + m * 0.13, y0], [x + m * 0.09, y0 + 0.37]], 2.2)), Rm(x - 0.17, y0 + 0.37, x + 0.17, y0 + 0.42, K.legno)];
    return [
      `<path d="M${X(5.5)},${gy} H${X(-5.5)}" stroke="${INK}" stroke-width="1.6"/>`,
      gm([
        // in vista: il muro di fondo della sala, il tramezzo del corridoio con le tre porte, il secondo piano chiuso
        Rm(-IW, y0, IW, 3.42, K.pietra, `fill-opacity=".3" stroke="none"`), Rm(-IW, y1, IW, 6.5, K.intonaco, `fill-opacity=".6" stroke="none"`), Rm(-4.2, 6.75, 4.2, TOP, K.pietraScura, `fill-opacity=".3" stroke="none"`),
        CAMERE.map(([, , p, h]) => [Rm(p - 0.6, y1, p + 0.6, y1 + 2.15, K.legno), Lm([[p - 0.66, y1], [p - 0.66, y1 + 2.21], [p + 0.66, y1 + 2.21], [p + 0.66, y1]], 3, `stroke="${K.trave}"`),
          [-0.3, 0, 0.3].map((d) => Lm([[p + d, y1], [p + d, y1 + 2.15]], 0.6, `opacity=".5"`)), [0.45, 1.7].map((y) => Lm([[h, y1 + y], [h + (p - h) * 1.5, y1 + y]], 2.2, `stroke="${K.ferro}"`))]),
        // la scala, chiusa sotto dall'assito, col parapetto
        Pm([...denti, [sc.x1, y0]], K.legno, vista), Array.from({ length: 7 }, (_, i) => sc.x0 + 0.6 * (i + 1)).map((x) => Lm([[x, y0], [x, rampa(x) - 0.12]], 0.6, `opacity=".4"`)),
        [0, 1.2, 2.4, 3.6].map((d) => Lm([[sc.x0 + d, rampa(sc.x0 + d) + (d ? 0.12 : 0)], [sc.x0 + d, Math.min(rampa(sc.x0 + d) + 0.98, 3.42)]], 3, `stroke="${K.trave}"`)),
        Lm([[sc.x0, y0 + 0.95], [sc.x0 + (3.42 - 0.95 - y0) / pend, 3.42]], 2.6, `stroke="${K.trave}"`),
        // arredi in vista (il tavolo e le panche contro la scala, gli sgabelli), il bancone tagliato, il candelabro che sta davanti al taglio (tratteggio)
        [-1.2, 0.14].map((x) => Rm(x, y0, x + 0.06, y0 + 0.7, K.trave)), Rm(-1.14, y0 + 0.26, 0.14, y0 + 0.34, K.legno), Rm(-1.4, y0 + 0.7, 0.4, y0 + 0.76, K.legno),
        [-1.14, 0.09].map((x) => Rm(x, y0, x + 0.05, y0 + 0.37, K.trave)), Rm(-1.09, y0 + 0.15, 0.09, y0 + 0.21, K.legno), Rm(-1.3, y0 + 0.37, 0.3, y0 + 0.42, K.legno),
        sgabelloS(-2.45), sgabelloS(1.35),
        Rm(1.76, y0, 2.24, y0 + 0.97, K.legno, `fill-opacity=".5" stroke="none"`), Rm(1.7, y0, 1.76, y0 + 0.97, K.legno), Rm(2.24, y0, 2.3, y0 + 0.97, K.legno), Rm(1.76, y0 + 0.48, 2.24, y0 + 0.52, K.legno), Rm(1.64, y0 + 0.97, 2.3, y0 + 1.05, K.legno),
        Lm([[-1.05, y0 + 2.33], [-0.5, y0 + 3], [0.05, y0 + 2.33]], 0.9, tratt), Lm([[-0.5, y0 + 3], [-0.5, 3.42]], 0.9, tratt), Rm(-1.1, y0 + 2.25, 0.1, y0 + 2.33, "none", tratt), [-1.03, -0.72, -0.28, 0.03].map((x) => Rm(x - 0.025, y0 + 2.33, x + 0.025, y0 + 2.46, K.bianco)),
        // il focolare della sala, tagliato: pietra, bocca, gola e canna, architrave, cappa
        Rm(-IW, y0, -2.8, 0.27, K.pietra), Pm([[-IW, 0.27], [-2.8, 0.27], [-2.8, 1.37], [-3.05, 1.37], [-3.05, TOP], [-3.45, TOP], [-3.45, 3], [-IW, 1.72]], K.buio),
        Rm(-3.9, 0.27, -3.1, 0.37, K.trave), Pm([[-3.85, 0.37], [-3.78, 0.62], [-3.66, 0.5], [-3.52, 0.95], [-3.4, 0.55], [-3.28, 0.72], [-3.15, 0.37]], K.lume), Pm([[-3.66, 0.37], [-3.52, 0.7], [-3.38, 0.37]], "#f3d27a", NOSTROKE),
        Rm(-3.05, 1.37, -2.8, 1.67, K.trave), Rm(-3.05, 1.67, -2.8, TOP, K.pietraScura), Pm([[-IW, 1.72], [-3.45, 3], [-3.45, TOP], [-IW, TOP]], K.pietraScura),
        // la cucina, tagliata: mensola, banco di pietra, cappa a sbalzo, paiolo alla catena
        Pm([[IW, 1.8], [3.7, 2.27], [IW, 2.27]], K.pietra), Rm(3.3, y0, IW, 0.62, K.pietraScura),
        Pm([[2.82, 2.27], [IW, 2.27], [IW, 2.6], [3.45, 3.1], [3.45, TOP], [3.05, TOP], [3.05, 3]], K.buio),
        Pm([[2.7, 2.27], [2.82, 2.27], [3.05, 3], [3.05, TOP], [2.8, TOP], [2.8, 3.2]], K.pietraScura), Pm([[IW, 2.6], [3.45, 3.1], [3.45, TOP], [IW, TOP]], K.pietraScura),
        Lm([[3.7, 1.25], [3.7, 2.5]], 0.9), Pm([[3.44, 1.25], [3.96, 1.25], [3.92, 0.98], [3.82, 0.88], [3.58, 0.88], [3.48, 0.98]], K.ferro),
        Pm([[3.5, 0.62], [3.56, 0.8], [3.64, 0.7], [3.7, 0.86], [3.78, 0.7], [3.84, 0.8], [3.9, 0.62]], K.lume),
        // muri, pavimenti, travi e tramezzi tagliati
        [-1, 1].map((m) => [Rm(m * IW, 0, m * HW, 3.3, K.pietraScura), Rm(m * IW, 3.3, m * 4.58, 3.52, K.pietraScura), Rm(m * IW, 3.52, m * 4.46, 6.5, K.pietraScura), Rm(m * 4.2, 6.75, m * 4.55, TOP, K.pietraScura), Rm(m * IW, 6.5, m * 4.6, 6.75, K.trave)]),
        Rm(-2.8, 0, 3.3, y0, K.coppo), Rm(sc.vano, t0, sc.x1, 3.42, K.trave, vista),
        TRAVE_X[0].map((x) => Rm(x - 0.1, t0, x + 0.1, 3.42, K.trave)), TRAVE_X[1].map((x) => Rm(x - 0.1, t1, x + 0.1, 6.5, K.trave)), Rm(-2.8, 3.42, 2.8, y1, K.legno), Rm(-2.8, 6.5, 2.8, 6.75, K.trave),
        [-1.4, 1.1].map((x) => Rm(x, y1, x + 0.3, 6.5, K.trave)), [sc.vano, sc.x1].map((x) => Lm([[x, 3.02], [x, 3.9]], 1, tratt)),
        // lo strappo: sopra non si sale
        Pm([[5, 7.9], [0.45, 7.9], [0.15, 8.2], [-0.15, 7.6], [-0.45, 7.9], [-5, 7.9], [-5, TOP + 0.2], [5, TOP + 0.2]], "#b7ab8e", NOSTROKE), Lm([[4.9, 7.9], [0.45, 7.9], [0.15, 8.2], [-0.15, 7.6], [-0.45, 7.9], [-4.9, 7.9]], 1.1),
      ]),
      G(X(-1.65), Y(y0), s / 10, omino(0)), G(X(-2.1), Y(y1), s / 10, omino(0)),
      [[y0, "sala"], [y1, "camere"], [6.5, "chiuso"]].map(([y, n]) => [`<path d="M${X(4.6) - 11},${Y(y)} h8" stroke="${INK}" stroke-width=".8"/>`, Tq(X(4.6) - 15, Y(y) + 4, "+" + it(y), "end"), Tq(X(4.6) - 15, Y(y) + 16, n, "end")]),
      qv(X(0.75), Y(y0), Y(t0), it(t0 - y0), false, ALO), qv(X(0.45), Y(y1), Y(t1), it(t1 - y1), true, ALO), qv(X(-2.62), Y(y0), Y(1.37), it(1.25), true, ALO), qv(X(2.5), Y(y0), Y(2.27), it(2.15), true, ALO),
      qh(X(sc.x1), X(sc.vano), Y(y1 + 0.24), "vano " + it(sc.x1 - sc.vano), true, ALO), qh(X(HW), X(-HW), gy + 9, it(9), false),
      Tq(cx, Y(7.2), "secondo piano · chiuso"), Tq(cx, Y(8.42), "sopra: secondo piano e sottotetto chiusi · le canne salgono dritte ai comignoli, a +15,79"),
      cap(cx, gy + 42, "SEZIONE A–A", ["taglio a z = 0 guardando il muro di fondo: i due focolari tagliati, la scala in vista", "17 alzate da 20 cm, 16 pedate da 30 cm, 35° · tratteggio: il vano nel solaio"]),
    ];
  };

  const righe = (x, y, titolo, p) => [T(x, y, "h", titolo), Tq(x + 205, y + 19, "x", "end"), Tq(x + 250, y + 19, "z", "end"), Tq(x + 294, y + 19, "verso", "end"),
    POSTI.map((q, i) => [q, i + 1]).filter(([q]) => q[1] == p).map(([[nome, , px, pz, yaw], n], i) => { const yy = r1(y + 37 + i * 14.2);
      return [bollo(x + 7, yy - 4, n, null, 6.2), T(x + 21, yy, "n", nome + (yaw == null ? " · .1–.4" : "")), Tq(x + 205, yy, it(px), "end"), Tq(x + 250, yy, it(pz), "end"), Tq(x + 294, yy, yaw == null ? "–" : yaw + "°", "end")]; })];

  const PT = [290, 327], P1 = [749, 327];
  sheet("interni-1-locanda.svg", "INTERNI · LA LOCANDA", "Due piante alla stessa scala e una sezione, misure in metri · la strada è in basso e il nord in alto, come sulla mappa", [
    defs([["dentro0", ...PT], ["dentro1", ...P1]]), pianta(...PT, 0), pianta(...P1, 1), sezione(1300, 546, 52), metro(498, 554, SM, "1 m"), metro(1012, 288, 52, "1 m"),
    cap(PT[0], 588, "PIANO TERRA · LA SALA", ["pavimento a +0,12, mattoni a spina di pesce · muri di pietra da 40 cm", "sotto le travi 3,08 m · finestre a x = ±2,97, larghe 0,90"]),
    cap(P1[0], 588, "PRIMO PIANO · LE CAMERE", ["pavimento a +3,52 di tavolato · tramezzi da 30 cm · finestre a x = 0, ±2,70", "sotto le travi 2,78 m · porte da 1,20 · parapetto del vano 0,95"]),
    righe(60, 655, "POSTI · PIANO TERRA", 0), righe(385, 655, "POSTI · PRIMO PIANO", 1),
    T(710, 655, "h", "LUCI"), Object.entries(TIPI_LUCE).map(([t, [nome, r, f]], i) => { const y = 678 + i * 16.5;
      return [t == "finestra" ? `<rect x="713" y="${y - 10}" width="10" height="11" fill="#c3dad8" stroke="${INK}" stroke-width=".8"/>` : t == "focolare" || t == "cucina" ? fiamma(718, y - 5, t == "cucina" ? 0.8 : 1.1) : O(718, y - 4, t == "candelabro" ? 4.5 : 3.2, "#f3d27a", `stroke="${INK}" stroke-width=".8"`),
        T(732, y, "n", `${nome} · ${t == "finestra" ? "fredda, solo di giorno" : "calda"} · raggio ${it(r, 1)} m · forza ${it(f, 2)}`)]; }),
    T(710, 799, "h", "RIFERIMENTO"), ["Origine a terra, al centro dell'ingombro di 9 × 9 m.", "+Z verso la strada, +X a sinistra in tavola, y in alto:", "è il riferimento di house() in town.ts.", "Verso: 0° guarda +Z, 90° guarda +X; i letti dalla testa ai piedi.",
      "Tavoli: i posti .1–.4 stanno sulle panche, a 0,62 dal centro", "e a ±0,45 lungo la panca.", "Tratteggio: il vano nel solaio, la cappa. Puntinato: i percorsi."].map((s, i) => T(710, 820 + i * 16.5, "n", s)),
    T(1150, 655, "h", "REGOLE"), ["Dentro è più buio che fuori: muri e travi anneriti dal fumo,", "mai un intonaco chiaro.", "",
      "La luce è poca e calda e non arriva negli angoli: un fuoco,", "qualche candela. Di giorno le finestre danno un chiarore", "freddo che si ferma a metà sala.", "",
      "Legno scuro inchiodato e ferro battuto, niente di tornito", "né di verniciato. Cotto consumato a terra, tavolato di sopra.", "",
      "Le misure sono quelle del giocatore: porte e passaggi", "da 1,2 m, soffitti oltre 2,6 m, scale che sono rampe.", "",
      "I tavoli stanno contro i muri: il centro della sala resta", "libero per camminare."].map((s, i) => T(1150, 678 + i * 16.5, "n", s)),
  ], ["pietra", "pietraScura", "intonaco", "trave", "legno", "coppo", "ardesia", "ferro", "lume", "freddo", "vetro", "lino", "lana", "buio"]);
}

// ── gli arredi: viste in centimetri, origine a terra, y in alto. Gli attrezzi per disegnarli stanno fuori dal blocco: servono anche agli arredi delle case ──
const tratt = `stroke-dasharray="4 3"`, ypts = (a) => a.map(([x, y]) => r1(x) + "," + r1(-y)).join(" L");
  const B = (x0, y0, x1, y1, fill, e = "") => `<rect x="${r1(Math.min(x0, x1))}" y="${r1(-Math.max(y0, y1))}" width="${r1(Math.abs(x1 - x0))}" height="${r1(Math.abs(y1 - y0))}" fill="${fill}" ${e}/>`;
  const Py = (a, fill, e = "") => `<path d="M${ypts(a)} Z" fill="${fill}" ${e}/>`, Ly = (a, w = 1, e = "") => `<path d="M${ypts(a)}" fill="none" stroke-width="${w}" ${e}/>`, Oy = (x, y, r, fill, e = "") => O(x, -y, r, fill, e);
  const riga_ = `opacity=".5"`, chiaro = shade(K.legno, 1.2);
  // quote di una vista messa in (ox, oy) alla scala s
  const Q = (ox, oy, s) => ({ x: (v) => r1(ox + v * s), y: (v) => r1(oy - v * s),
    h: (x0, x1, y, t, up = true, st = "") => qh(r1(ox + x0 * s), r1(ox + x1 * s), r1(oy - y * s), t, up, st), v: (y0, y1, x, t, left = true, st = "") => qv(r1(ox + x * s), r1(oy - y0 * s), r1(oy - y1 * s), t, left, st) });
  // una riga di pezzi: [nome, note, larghezza minima in px, ...viste]; vista = [ingombro a sinistra e a destra dell'origine in cm, disegno, quote, scala]
  const riga = (y, s0, dy, pezzi, x0 = 60, gap = 18) => {
    const slot = pezzi.map(([nome, note, min, ...viste]) => { const w = viste.reduce((a, [l, r, , , s = s0]) => a + (l + r) * s, 0) + gap * (viste.length - 1);
      return [w, Math.max(w, min, nome.length * 12.3 + 8, ...note.map((n) => n.length * 6.1 + 8))]; });   // la didascalia non deve uscire dal suo posto
    let x = x0 + (1540 - x0 - slot.reduce((a, [, m]) => a + m, 0) - gap * 1.2 * (pezzi.length - 1)) / 2;
    return pezzi.map(([nome, note, , ...viste], i) => { const [w, m] = slot[i], mid = r1(x + m / 2); let vx = x + (m - w) / 2; x += m + gap * 1.2;
      return [viste.map(([l, r, body, quote, s = s0]) => { const ox = r1(vx + l * s); vx = ox + r * s + gap; return [G(ox, y, s, body), quote ? quote(Q(ox, y, s)) : ""]; }), cap(mid, y + dy, nome, note)]; });
  };

  const fuoco = (x, y, k = 1) => [Py([[x - 22 * k, y], [x - 16 * k, y + 16 * k], [x - 8 * k, y + 8 * k], [x, y + 30 * k], [x + 8 * k, y + 8 * k], [x + 16 * k, y + 16 * k], [x + 22 * k, y]], K.lume), Py([[x - 9 * k, y], [x, y + 16 * k], [x + 9 * k, y]], "#f3d27a", NOSTROKE)];
  const fiammella = (x, y) => [Oy(x, y + 3, 14, "url(#lume)", NOSTROKE), Py([[x, y], [x - 2.2, y + 3], [x, y + 8.5], [x + 2.2, y + 3]], "#f3d27a", `stroke-width=".8"`)];
  const paiolo = (x, y) => [Ly([[x - 24, y + 32], [x, y + 46], [x + 24, y + 32]], 1.2), Py([[x - 26, y + 32], [x + 26, y + 32], [x + 23, y + 10], [x + 14, y], [x - 14, y], [x - 23, y + 10]], K.ferro)];
  const boccale = (x, y) => [B(x - 4.5, y, x + 4.5, y + 13, chiaro), [2.5, 9.5].map((h) => B(x - 4.7, y + h, x + 4.7, y + h + 1.3, K.ferro)), Ly([[x + 4.5, y + 10.5], [x + 8.5, y + 9.5], [x + 8.5, y + 4], [x + 4.5, y + 3]], 1.8)];
  const brocca = (x, y) => [Ly([[x + 4.5, y + 21], [x + 10, y + 17], [x + 6.5, y + 9]], 1.8), Py([[x - 5, y], [x + 5, y], [x + 7.5, y + 9], [x + 4, y + 18], [x + 5, y + 24], [x - 5.5, y + 24], [x - 4, y + 18], [x - 7.5, y + 9]], K.coppo)];
  const ciotola = (x, y) => Py([[x - 8, y + 6], [x + 8, y + 6], [x + 5, y], [x - 5, y]], chiaro);
  const ott = (x, y, r) => Array.from({ length: 8 }, (_, i) => [x + r * Math.cos((i + 0.5) * 45 * RAD), y + r * Math.sin((i + 0.5) * 45 * RAD)]);

{ // ── gli arredi della locanda ──
  // focolare della sala: fronte e fianco (il muro è a sinistra)
  const focolare = [
    [B(-110, 0, 110, 15, K.pietraScura), B(-75, 15, 75, 125, K.buio), B(-50, 15, 50, 23, K.trave), B(-38, 23, 30, 30, K.legno), fuoco(-4, 30, 1.4), [-56, 56].map((x) => B(x - 2, 15, x + 2, 42, K.ferro)),
      [-1, 1].map((m) => [B(m * 75, 0, m * 110, 125, K.pietra), blocks(m > 0 ? 76 : -109, -122, m > 0 ? 109 : -76, -3, 7, K.pietra, 10)]),
      Py([[-110, 155], [110, 155], [50, 308], [-50, 308]], K.intonaco), Py([[-110, 155], [110, 155], [96, 190], [-96, 190]], K.buio, `opacity=".3" stroke="none"`), B(-120, 125, 120, 155, K.trave), Ly([[-150, 308], [150, 308]], 1, tratt)],
    [B(-14, 0, 0, 308, K.pietraScura), B(0, 0, 130, 125, K.pietra), blocks(2, -122, 128, -18, 9, K.pietra, 10), B(0, 0, 130, 15, K.pietraScura), B(0, 155, 130, 308, K.intonaco), B(0, 125, 134, 155, K.trave), Ly([[-14, 308], [150, 308]], 1, tratt)],
  ];
  // cucina: banco di pietra col fuoco sopra, paiolo alla catena, cappa a sbalzo su due mensole
  const cucina = [B(-80, 50, 80, 215, K.buio, `opacity=".25" stroke="none"`), B(-80, 0, 80, 50, K.pietra), blocks(-78, -48, 78, -2, 8, K.pietra, 12), fuoco(0, 50, 0.9), Ly([[0, 215], [0, 122]], 1), paiolo(0, 76),
    [-1, 1].map((m) => B(m * 76, 188, m * 90, 215, K.pietraScura)), Py([[-90, 227], [90, 227], [50, 308], [-50, 308]], K.intonaco), B(-92, 215, 92, 227, K.trave), Ly([[-120, 308], [120, 308]], 1, tratt)];
  // rampa: 17 alzate da 20, 16 pedate da 30; a sinistra il solaio sopra il piede, a destra l'arrivo
  const rmp = (x) => x * 340 / 480, denti = [[0, 0], ...Array.from({ length: 17 }, (_, i) => [[i * 30, (i + 1) * 20], [Math.min(480, (i + 1) * 30), (i + 1) * 20]]).flat()];
  const rampa = [B(-45, 330, 120, 340, K.legno), B(100, 308, 120, 330, K.trave), B(480, 330, 560, 340, K.legno), B(480, 308, 500, 330, K.trave),
    Py([...denti, [480, 0]], K.legno), [60, 120, 180, 240, 300, 360, 420].map((x) => Ly([[x, 0], [x, rmp(x) - 10]], 0.6, `opacity=".45"`)),
    [0, 120, 240, 360, 480].map((x) => Ly([[x, rmp(x) + (x % 480 ? 10 : 0)], [x, rmp(x) + 99]], 3.2, `stroke="${K.trave}"`)), Ly([[552, 340], [552, 439]], 3.2, `stroke="${K.trave}"`), Ly([[0, 95], [480, 435], [556, 435]], 2.8, `stroke="${K.trave}"`)];
  const porta = [B(-72, 0, -60, 227, K.trave), B(60, 0, 72, 227, K.trave), B(-72, 215, 72, 227, K.trave), B(-60, 0, 60, 215, K.legno), [-36, -12, 12, 36].map((x) => Ly([[x, 0], [x, 215]], 0.6, riga_)),
    [44, 171].map((y) => [Py([[60, y - 6], [-8, y - 2.5], [-8, y + 2.5], [60, y + 6]], K.ferro), B(57, y - 9, 65, y + 9, K.ferro)]), B(-50, 96, -38, 120, K.ferro), Oy(-44, 104, 5.5, "none", `stroke-width="2.2"`), B(-60, 124, -30, 128, K.ferro)];
  // portone visto da dentro: due battenti rettangolari dietro la mostra a sesto acuto, stanga
  const portone = [B(-128, 0, 128, 300, K.pietra, `fill-opacity=".45" stroke="none"`), blocks(-126, -296, 126, -4, 26, K.pietra, 12), B(-105, -12, 105, 0, K.pietraScura),
    [-1, 1].map((m) => [B(0, 0, m * 95, 260, K.legno), [19, 38, 57, 76].map((x) => Ly([[m * x, 0], [m * x, 260]], 0.6, riga_)),
      [36, 130, 224].map((y) => [Py([[m * 95, y - 7], [m * 28, y - 3], [m * 28, y + 3], [m * 95, y + 7]], K.ferro), B(m * 91, y - 10, m * 99, y + 10, K.ferro)]), Oy(m * 13, 150, 6, "none", `stroke-width="2.2"`), B(m * 62, 100, m * 70, 122, K.ferro)]),
    B(-84, 105, 84, 117, K.trave), P(arco(0, 12, 170, 250), "none", tratt)];
  const letto = [
    [B(0, 0, 8, 95, K.trave), B(192, 0, 200, 65, K.trave), B(8, 25, 192, 45, K.legno), Ly([[8, 35], [192, 35]], 0.6, riga_), B(8, 45, 192, 50, K.paglia), Py([[11, 50], [46, 50], [43, 60], [14, 60]], K.bianco), Py([[62, 45], [192, 45], [192, 54], [66, 55]], K.lana)],
    [B(0, 0, 8, 95, K.trave), B(92, 0, 100, 95, K.trave), B(8, 45, 92, 90, K.legno), [29, 50, 71].map((x) => Ly([[x, 45], [x, 90]], 0.6, riga_)), B(8, 25, 92, 45, K.legno)],
  ];
  const tavolo = [
    [[20, 154].map((x) => [B(x, 0, x + 6, 70, K.trave), B(x - 6, 0, x + 12, 6, K.trave)]), B(26, 26, 154, 34, K.legno), B(0, 70, 180, 76, K.legno)],
    [Py([[10, 0], [70, 0], [64, 70], [16, 70]], K.trave), B(36, 26, 44, 34, K.legno), B(0, 70, 80, 76, K.legno)],
  ];
  const panca = [
    [[16, 139].map((x) => B(x, 0, x + 5, 37, K.trave)), B(21, 15, 139, 21, K.legno), B(0, 37, 160, 42, K.legno)],
    [Py([[2, 0], [30, 0], [26, 37], [6, 37]], K.trave), B(13, 15, 19, 21, K.legno), B(0, 37, 32, 42, K.legno)],
  ];
  const sgabello = [[-1, 1].map((m) => Py([[m * 15, 0], [m * 11, 0], [m * 7, 37], [m * 11, 37]], K.trave)), B(-2, 0, 2, 37, shade(K.trave, 0.8)), B(-17, 37, 17, 42, K.legno),
    Py(ott(0, 84, 17), K.legno), [90, 210, 330].map((a) => Oy(11 * Math.cos(a * RAD), 84 + 11 * Math.sin(a * RAD), 2.2, K.trave))];
  const forziere = [
    [B(0, 0, 90, 34, K.legno), Ly([[0, 17], [90, 17]], 0.6, riga_), B(0, 34, 90, 50, chiaro), Ly([[0, 44], [90, 44]], 0.6, riga_), [14, 70].map((x) => B(x, 0, x + 6, 50, K.ferro)), B(40, 22, 50, 38, K.ferro), Oy(45, 28, 1.6, K.buio, NOSTROKE)],
    [B(0, 0, 50, 34, K.legno), Py([[0, 34], [50, 34], [42, 50], [8, 50]], chiaro), Oy(25, 20, 5, "none", `stroke-width="2.2"`)],
  ];
  const scaffale = [B(0, 0, 140, 190, shade(K.legno, 0.62)), [0, 135].map((x) => B(x, 0, x + 5, 190, K.legno)), [8, 52, 98, 144, 186].map((y) => B(5, y, 135, y + 4, K.legno)),
    B(14, 12, 54, 46, K.legno), [20, 44].map((x) => B(x, 12, x + 4, 46, K.ferro)), Py([[70, 12], [124, 12], [128, 32], [114, 48], [82, 48], [66, 32]], K.lino),
    [24, 52, 80, 108].map((x) => Oy(x, 69, 13, K.lino)), [16, 32, 48, 64].map((x) => boccale(x, 102)), [98, 118].map((x) => brocca(x, 102)), [24, 46].map((x) => ciotola(x, 148)), brocca(108, 148)];
  // bancone: fronte verso la sala e fianco (la sala è a sinistra)
  const bancone = [
    [B(0, 0, 400, 97, shade(K.legno, 0.85)), Array.from({ length: 15 }, (_, i) => Ly([[25 + i * 25, 8], [25 + i * 25, 97]], 0.6, `opacity=".45"`)), [0, 195, 390].map((x) => B(x, 0, x + 10, 97, K.trave)), B(0, 0, 400, 8, K.trave), B(-5, 97, 405, 105, K.legno),
      boccale(70, 105), boccale(250, 105), brocca(276, 105), B(146, 105, 158, 107, K.ferro), B(150, 107, 154, 120, K.bianco), fiammella(152, 121)],
    [B(0, 0, 5, 97, K.legno), B(54, 0, 60, 97, K.legno), B(5, 48, 54, 52, K.legno), B(-6, 97, 60, 105, K.legno)],
  ];
  // botte da mescita coricata sul cavalletto: fianco e fondo con la spina
  const botte = [
    [[12, 70].map((x) => B(x, 0, x + 8, 46, K.trave)), B(20, 8, 70, 14, K.trave), Py([[0, 46], [45, 40], [90, 46], [90, 104], [45, 110], [0, 104]], K.legno),
      [[60, 56], [75, 75], [90, 94]].map(([a, b]) => Ly([[0, a], [45, b], [90, a]], 0.6, riga_)), [[7, 44.8], [30, 41.8], [56, 41.8], [79, 44.8]].map(([x, y]) => B(x, y, x + 4.5, 150 - y, K.ferro)),
      Py([[0, 54], [-11, 54], [-11, 49], [-14, 49], [-14, 58], [0, 58]], K.ferro), B(-9, 58, -6, 65, K.ferro)],
    [Py([[-38, 0], [38, 0], [38, 50], [27, 50], [18, 41], [-18, 41], [-27, 50], [-38, 50]], K.trave), Oy(0, 75, 35, K.legno), Oy(0, 75, 29, chiaro), [[64, 26.5], [75, 29], [86, 26.5]].map(([y, w]) => Ly([[-w, y], [w, y]], 0.6, riga_)),
      B(-2.5, 49, 2.5, 57, K.ferro), Oy(0, 56, 3.5, K.ferro)],
  ];
  const catasta = [[-4, 140].map((x) => B(x, 0, x + 4, 96, K.trave)), Array.from({ length: 6 }, (_, j) => Array.from({ length: j % 2 ? 8 : 9 }, (_, i) => { const x = 8 + i * 15.5 + (j % 2) * 7.75, y = 8 + j * 14;
    return [Oy(x, y, 7.6, shade(K.legno, R(0.85, 1.25))), Oy(x, y, 3, "none", `stroke-width=".6" opacity=".6"`)]; }))];
  const candelabro = [B(-34, 160, 34, 176, K.trave), Ly([[0, 160], [0, 148]], 1.6), Oy(0, 145, 3.5, "none", `stroke-width="1.8"`), [-55, -20, 20, 55].map((x) => Ly([[0, 142], [x, 71]], 0.9)),
    B(-60, 63, 60, 71, K.trave), [-55.4, -23, 23, 55.4].map((x) => [B(x - 4.5, 71, x + 4.5, 73, K.ferro), B(x - 2, 73, x + 2, 85, K.bianco), fiammella(x, 86)])];
  const candela = [B(-6, 0, 6, 1.6, K.ferro), B(-2, 1.6, 2, 15, K.bianco), Ly([[0, 15], [0, 16.5]], 1), fiammella(0, 16.5)];
  const candelaMuro = [B(-5, 0, 0, 40, K.pietra), Py([[0, 5], [16, 8.4], [16, 10], [0, 10]], K.ferro), B(11, 10, 25, 11.6, K.ferro), B(16, 11.6, 20, 24, K.bianco), Ly([[18, 24], [18, 25.5]], 1), fiammella(18, 25.5)];

  sheet("interni-2-arredi.svg", "INTERNI · GLI ARREDI DELLA LOCANDA", "Viste alla stessa scala riga per riga, misure in centimetri · legno scuro inchiodato, ferro battuto, pietra affumicata · ogni pezzo è fatto di scatole, falde e tamburi", [
    terra(398), G(80, 398, 6.2, omino(0)), metro(60, 145, 62, "1 m"),
    riga(398, 0.62, 36, [
      ["FOCOLARE DELLA SALA", ["bocca 150 × 110 sopra la pietra, profondo 130", "piedritti da 35, architrave 240 × 30,", "cappa che stringe a 100 sotto le travi"], 0,
        [157, 160, focolare[0], (q) => [q.h(-110, 110, -11, 220, false), q.h(-50, 50, 316, 100), q.v(0, 125, -124, 125), q.v(0, 308, 126, 308, false)]], [14, 150, focolare[1], (q) => q.h(0, 130, -11, 130, false)]],
      ["CUCINA", ["banco 160 × 80 × 50 col fuoco sopra,", "paiolo alla catena, cappa a sbalzo:", "180 × 140 a 215, 100 × 130 in cima"], 0,
        [128, 132, cucina, (q) => [q.h(-80, 80, -11, 160, false), q.v(0, 50, -94, 50), q.v(0, 215, 102, 215, false)]]],
      ["RAMPA DI SCALE", ["larga 120 fra il muro e il parapetto, chiusa sotto da un assito", "in gioco è una rampa liscia, da 22 a 342: gradini solo disegno"], 0,
        [50, 612, rampa, (q) => [q.h(0, 480, -11, 480, false), q.v(0, 340, 578, 340, false), q.v(85, 308, 111, 223, true, ALO), q.v(170, 265, 250, 95, false, ALO),
          ["17 alzate da 20", "16 pedate da 30", "pendenza 35°"].map((t, i) => Tq(q.x(140), q.y(412 - i * 27), t, "start"))]]],
      ["PORTA", ["delle camere: 120 × 215 × 5,", "due bandelle sui cardini,", "anello e saliscendi"], 0, [112, 76, porta, (q) => [q.h(-60, 60, -11, 120, false), q.v(0, 215, -82, 215)]]],
      ["PORTONE", ["due battenti da 95 × 260,", "stanga a 110 (di giorno tolta)", "da fuori: l'arco 170 × 250"], 0, [132, 172, portone, (q) => [q.h(-95, 95, 274, 190, true, ALO), q.v(0, 260, 138, 260, false)]]],
    ], 102),
    terra(646), G(80, 646, 7.2, omino(0)), metro(60, 512, 72, "1 m"),
    riga(646, 0.72, 36, [
      ["LETTO", ["200 × 100, piano a 50, montanti 8 × 8", "sponde di tavole, pagliericcio, coperta"], 0,
        [34, 236, letto[0], (q) => [q.h(0, 200, -11, 200, false), q.v(0, 95, -8, 95), q.v(0, 50, 208, 50, false)]], [4, 104, letto[1], (q) => q.h(0, 100, -11, 100, false)]],
      ["TAVOLO", ["180 × 80 × 76", "piano di assi su due cavalletti"], 0, [4, 216, tavolo[0], (q) => [q.h(0, 180, -11, 180, false), q.v(0, 76, 188, 76, false)]], [4, 84, tavolo[1], (q) => q.h(0, 80, -11, 80, false)]],
      ["PANCA", ["160 × 32, seduta a 42"], 0, [4, 194, panca[0], (q) => [q.h(0, 160, -11, 160, false), q.v(0, 42, 168, 42, false)]], [4, 36, panca[1], (q) => q.h(0, 32, -11, 32, false)]],
      ["SGABELLO", ["Ø 34, seduta a 42", "otto lati, tre gambe"], 0, [20, 50, sgabello, (q) => [q.h(-17, 17, -11, 34, false), q.v(0, 42, 26, 42, false)]]],
      ["FORZIERE", ["90 × 50 × 50, cassa di 34", "coperchio a falde,", "due bandelle, serratura"], 0, [4, 124, forziere[0], (q) => [q.h(0, 90, -11, 90, false), q.v(0, 50, 98, 50, false)]], [4, 84, forziere[1], (q) => [q.h(0, 50, -11, 50, false), q.v(0, 34, 58, 34, false)]]],
      ["SCAFFALE", ["140 × 40 × 190", "cinque ripiani,", "schienale di tavole"], 0, [4, 174, scaffale, (q) => [q.h(0, 140, -11, 140, false), q.v(0, 190, 148, 190, false)]]],
    ], 102),
    terra(872), metro(60, 750, 72, "1 m"), metro(1420, 790, 26, "10 cm"),
    riga(872, 0.72, 20, [
      ["BANCONE", ["400 × 60, piano a 105 che sporge 6 verso la sala", "fronte chiuso di tavole, dietro aperto con un ripiano a 50"], 0,
        [8, 442, bancone[0], (q) => [q.h(0, 400, 140, 400), q.v(0, 105, 414, 105, false)]], [8, 62, bancone[1], (q) => q.h(-6, 60, 113, 66)]],
      ["BOTTE DA MESCITA", ["Ø 70 × 90 sul cavalletto, asse a 75", "la spina di ferro sul fondo davanti"], 0, [16, 92, botte[0], (q) => q.h(0, 90, 118, 90)], [38, 74, botte[1], (q) => [q.h(-35, 35, 118, 70), q.v(0, 110, 44, 110, false)]]],
      ["CATASTA", ["di legna: 140 × 50 × 90,", "fra due pali"], 0, [6, 178, catasta, (q) => [q.h(0, 140, 104, 140), q.v(0, 90, 152, 90, false)]]],
      ["CANDELABRO", ["ruota Ø 120 a otto lati, otto candele", "catene da 75: sotto restano 225"], 0, [62, 62, candelabro, (q) => q.h(-60, 60, 52, 120, false)]],
      ["CANDELE", ["sul piattello Ø 12, o a muro", "su un braccio di ferro da 20"], 0, [8, 10, candela, null, 2.6], [6, 28, candelaMuro, null, 2.6]],
      ["STOVIGLIE", ["boccale Ø 9 × 13, brocca 24,", "ciotola Ø 16"], 0, [7, 58, [boccale(0, 0), brocca(24, 0), ciotola(48, 0)], null, 2.6]],
    ]),
  ], ["legno", "trave", "ferro", "pietra", "pietraScura", "intonaco", "buio", "lume", "paglia", "lino", "lana", "bianco", "coppo"]);
}

// ───────────────────────── interni di tutti gli edifici ─────────────────────────
// Case, cattedrale, municipio, porta della città, fucina. Le piante NON stanno qui: vengono da src/world/layouts.ts,
// lo stesso file che legge il gioco (stanze, vani, scale, arredi, posti, percorsi, luci), e qui si disegnano soltanto:
// cambiare una misura là cambia tavola e gioco insieme. Le case sono mostrate in una misura e con un seme; in basso,
// lo stesso tipo con altri semi (verso della scala, letto, tavola e arredi cambiano da una casa all'altra).
// ⚠️ Niente `rnd` qui dentro (blocks, R): le tavole che vengono dopo cambierebbero. Le piante hanno il loro generatore.
{
  const TINTA = { pietra: K.pietra, intonaco: K.intonaco, cotto: K.coppo, assi: K.legno, terra: "#6e5b45", lastre: "#85827a" }, CARTA = "#b7ab8e", OPP = { "x-": "x+", "x+": "x-", "z-": "z+", "z+": "z-" };
  const COSA = { focolare: K.pietra, camino: K.pietra, canna: K.pietraScura, altare: K.pietra, fonte: K.pietra, pilastro: K.pietraScura, braciere: K.ferro, candeliere: K.ferro, rastrelliera: K.ferro,
    sacco: K.lino, tempra: K.petrolio, carbone: K.buio, mola: K.pietra, argano: K.trave, armadio: K.trave, scaffale: K.trave, incudine: K.ferro, forgia: K.pietra };
  // quanto è alto un pezzo visto in sezione (m)
  const ALTO = { tavolo: 0.76, tavolino: 0.72, tavolone: 0.78, panca: 0.42, sgabello: 0.42, scranno: 1.25, letto: 0.6, lettone: 1.9, forziere: 0.5, botte: 0.9, sacco: 0.5, banco: 1.05, scrittoio: 0.95, leggio: 1.3, fonte: 1,
    altare: 1.05, "banco.chiesa": 0.9, candeliere: 1.6, braciere: 0.7, argano: 1.3, scaffale: 1.9, armadio: 1.9, legna: 0.9, rastrelliera: 2, mantice: 1.1, "banco.lavoro": 0.9, tempra: 0.55, carbone: 0.45, mola: 1 };
  const LUMI = ["candela", "candela.muro", "candeliere", "braciere"];
  const fatta = (kind, w, d, seme) => layout(kind, w, d, mulberry32(seme));
  const stanza = (L, n) => L.rooms.find((r) => r.name == n);
  const DEFS = `<defs><pattern id="cotto" width="44" height="44" patternUnits="userSpaceOnUse"><rect width="44" height="44" fill="${K.coppo}"/><path d="M0,0 H44 M0,22 H44 M22,0 V22 M0,22 V44" stroke="${K.buio}" stroke-width="1.4" opacity=".5" fill="none"/></pattern>` +
    `<pattern id="assi" width="240" height="50" patternUnits="userSpaceOnUse"><rect width="240" height="50" fill="${K.legno}"/><path d="M0,0 H240 M0,25 H240 M70,0 V25 M190,25 V50" stroke="${K.buio}" stroke-width="1.4" opacity=".55" fill="none"/></pattern>` +
    `<pattern id="lastre" width="120" height="120" patternUnits="userSpaceOnUse"><rect width="120" height="120" fill="#85827a"/><path d="M0,0 H120 M0,60 H120 M40,0 V60 M95,60 V120" stroke="${K.buio}" stroke-width="1.6" opacity=".5" fill="none"/></pattern>` +
    `<radialGradient id="freddo"><stop offset="0" stop-color="#c3dad8" stop-opacity=".6"/><stop offset="1" stop-color="#c3dad8" stop-opacity="0"/></radialGradient></defs>`;
  const suolo = (f) => (f == "cotto" || f == "assi" || f == "lastre" ? `url(#${f})` : TINTA[f]);

  // ── pianta di un piano: le quote da `ya` a `yb`. `num` = numero di ogni posto (nome → n); senza, niente bolli né percorsi (le miniature) ──
  const pianta = (L, ya, yb, cx, cy, sm, id, num) => {
    const X = (x) => r1(cx - x * sm), Z = (z) => r1(cy + z * sm), gm = (b) => `<g class="f" transform="translate(${cx} ${cy}) scale(${-sm / 100} ${sm / 100})">${J([b])}</g>`;
    const qui = (y) => y > ya - 0.4 && y < yb, rooms = L.rooms.filter((r) => qui(r.y) || (r.y < ya && r.y + r.h > ya + 1.5));
    const ang = (vx, vz) => Math.atan2(vz, vx) / RAD;
    const vani = L.openings.filter((o) => rooms.includes(stanza(L, o.room)) && qui(stanza(L, o.room).y + o.y0 + 0.2)).map((o) => {
      const r = stanza(L, o.room), f = face(r, o.side), t = thick(L, r, o.side), a = o.at - o.w / 2, b = o.at + o.w / 2, w1 = f.w + f.dir * t;
      const pt = (u, v) => (f.ax ? [u, v] : [v, u]), rect = (u0, u1, v0, v1, fill, e) => Rm(...pt(u0, v0), ...pt(u1, v1), fill, e);   // u lungo il muro, v attraverso
      if (o.kind == "finestra") return rect(a, b, f.w, w1, K.vetro);
      const out = [rect(a, b, f.w - f.dir * 0.03, w1 + f.dir * 0.03, CARTA, NOSTROKE)];
      if (o.kind == "varco") return out;
      // i battenti: aperti a squadra, con l'arco che descrivono. L'uscio gira dentro la stanza, la porta dentro quella accanto
      const v = o.kind == "uscio" ? w1 - f.dir * 0.12 : w1, verso = o.kind == "uscio" ? -f.dir : f.dir, ante = o.w >= 1.6 ? [[a, 1, o.w / 2], [b, -1, o.w / 2]] : [[a, 1, o.w]];
      for (const [h, lato, l] of ante) {
        const H = pt(h, v), E = pt(h, v + verso * l), c = pt(lato, 0), n = pt(0, verso), a0 = ang(...c), a1 = ang(...n);
        out.push(Lm([H, E], 2.6, `stroke="${K.legno}"`), arcM(H[0], H[1], l, a0, a0 + (((a1 - a0 + 540) % 360) - 180)));
      }
      return out;
    });
    const scale = L.stairs.map((s) => {
      const [x0, z0, x1, z1] = s.rect, al = s.up[0] == "x", sg = s.up[1] == "+" ? 1 : -1, lo = al ? (sg > 0 ? x0 : x1) : (sg > 0 ? z0 : z1), hi = al ? (sg > 0 ? x1 : x0) : (sg > 0 ? z1 : z0), len = Math.abs(hi - lo), ped = len / (s.n - 1);
      const giu = qui(s.y0), su = !giu && qui(s.y1);   // parte da questo piano, o ci arriva (e allora se ne vede solo il vano)
      if ((!giu && !su) || (su && s.vano >= len)) return "";
      const da = su ? hi - sg * s.vano : lo, r = al ? [Math.min(da, hi), z0, Math.max(da, hi), z1] : [x0, Math.min(da, hi), x1, Math.max(da, hi)], mid = al ? (z0 + z1) / 2 : (x0 + x1) / 2;
      const P2 = (c) => (al ? [X(c), Z(mid)] : [X(mid), Z(c)]);
      return [gm([Rm(...r, su ? shade(K.legno, 0.55) : K.legno), Array.from({ length: s.n - 2 }, (_, i) => lo + sg * (i + 1) * ped).filter((c) => (c - da) * sg > 0.02).map((c) => Lm(al ? [[c, z0], [c, z1]] : [[x0, c], [x1, c]], 0.7))]),
        num ? freccia(...(su ? P2(hi - sg * 0.25) : P2(da + sg * 0.25)), ...(su ? P2(da + sg * 0.3) : P2(hi - sg * 0.3)), K.bianco) : ""];
    });
    const dentro = (p) => p.y > ya - 0.4 && p.y < yb;
    const pezzo = (p) => {
      const f = footprint(p, true), raggio = typeof PIECES[p.t].foot == "number" ? PIECES[p.t].foot : 0, col = COSA[p.t] ?? K.legno, at = (dx, dz) => local(p, dx, dz);
      const box = (ax, az, bx, bz, fill, e) => { const A = at(ax, az), B_ = at(bx, bz); return Rm(A[0], A[1], B_[0], B_[1], fill, e); };
      switch (p.t) {
        case "tavolo": return [[-1, 1].map((s) => box(-0.8, s * 0.62 - 0.16, 0.8, s * 0.62 + 0.16, shade(K.legno, 0.8))), box(-0.9, -0.4, 0.9, 0.4, K.legno)];
        case "letto": case "lettone": { const w = p.t == "letto" ? 0.5 : 0.8, l = p.t == "letto" ? 1 : 1.05;
          return [box(-w, -l, w, l, K.trave), box(-w + 0.06, -l + 0.06, w - 0.06, l - 0.06, K.lino), box(-w + 0.06, -l + 0.06, w - 0.06, 0.3, p.t == "letto" ? K.lana : K.vino), box(-w + 0.2, 0.5, w - 0.2, l - 0.14, K.bianco)]; }
        case "focolare": return [box(-0.9, 0, 0.9, 0.9, K.pietra), box(-0.65, 0, 0.65, 0.9, K.buio), Om(...at(0, 0.45), 0.22, K.lume, NOSTROKE)];
        case "camino": { const D = p.foot[3]; return [box(-0.55, 0, 0.55, D, K.pietra), box(-0.35, D - 0.75, 0.35, D, K.buio), Om(...at(0, D - 0.4), 0.2, K.lume, NOSTROKE)]; }
        case "scaffale": case "armadio": case "rastrelliera": case "legna": case "mantice": case "banco.lavoro": return [Rm(...f, col), Lm([at(-0.6, 0.2), at(0.6, 0.2)], 0.6, `opacity=".5"`)];
        case "candelabro": return [Om(p.x, p.z, 0.6, "none", `stroke-dasharray="3 3" stroke-width="1.1"`), Array.from({ length: 8 }, (_, i) => Om(p.x + Math.cos((i + 0.5) * 45 * RAD) * 0.6, p.z + Math.sin((i + 0.5) * 45 * RAD) * 0.6, 0.055, "#f3d27a", `stroke-width=".7"`))];
        case "candela": case "candela.muro": return Om(...at(0, p.t == "candela" ? 0 : 0.17), 0.08, "#f3d27a", `stroke-width=".8"`);
        case "candeliere": case "braciere": return [Om(p.x, p.z, raggio, K.ferro), Om(p.x, p.z, raggio * 0.55, "#f3d27a", NOSTROKE)];
        case "stendardo": return box(-0.5, 0, 0.5, 0.07, K.vino);
        case "paiolo": return [Om(p.x, p.z, 0.26, K.ferro), Om(p.x, p.z, 0.18, K.buio, NOSTROKE)];
        case "altare": return [box(-1.2, -0.5, 1.2, 0.5, K.pietra), box(-1.25, -0.2, 1.25, 0.2, K.bianco), Om(...at(0, -0.4), 0.16, K.oro)];
        case "botte": return [Om(p.x, p.z, 0.33, K.legno), Om(p.x, p.z, 0.25, shade(K.legno, 1.15))];
        case "fonte": return [Om(p.x, p.z, 0.55, K.pietra), Om(p.x, p.z, 0.4, K.petrolio)];
        case "attrezzi": return "";
        default: return PIECES[p.t].minor ? Om(p.x, p.z, 0.05, K.bianco, `stroke-width=".6"`) : raggio ? Om(p.x, p.z, raggio, col) : Rm(...f, col);
      }
    };
    const by = new Map(L.places.map((p) => [p.name, p])), luci = lamps(L).filter(dentro);
    return [
      gm(rooms.map((r) => { const [a, b, c, e] = ["x-", "x+", "z-", "z+"].map((s) => thick(L, r, s)); return Rm(r.x0 - a, r.z0 - c, r.x1 + b, r.z1 + e, K.pietraScura); })),
      gm(rooms.map((r) => [Rm(r.x0, r.z0, r.x1, r.z1, CARTA, NOSTROKE), Rm(r.x0, r.z0, r.x1, r.z1, suolo(r.floor), `fill-opacity=".6"`)])),
      `<clipPath id="${id}">${rooms.map((r) => `<rect x="${X(r.x1)}" y="${Z(r.z0)}" width="${r1((r.x1 - r.x0) * sm)}" height="${r1((r.z1 - r.z0) * sm)}"/>`).join("")}</clipPath>`,
      `<g clip-path="url(#${id})">${luci.map((l) => `<circle cx="${X(l.x)}" cy="${Z(l.z)}" r="${r1(l.r * 0.36 * sm)}" fill="url(#${l.n ? "freddo" : "lume"})"/>`).join("")}</g>`,
      gm([vani, L.steps.map((d) => Rm(...d.rect, K.pietra)), L.decks.filter((d) => qui(d.y)).map((d) => Rm(...d.rect, shade(K.legno, 1.15), `stroke-dasharray="4 3"`))]), scale,
      gm(L.pieces.filter(dentro).sort((p, q) => p.y - q.y).map(pezzo)),
      num ? [L.links.map(([a, b]) => [by.get(a), by.get(b)]).filter(([a, b]) => (dentro(a) || a.y < 0.05) && (dentro(b) || b.y < 0.05)).map(([a, b]) =>
          `<path d="M${X(a.x)},${Z(a.z)} L${X(b.x)},${Z(b.z)}" stroke="${INK}" stroke-width="1.7" stroke-dasharray="0.1 4.5" stroke-linecap="round" opacity=".75"/>`),
        L.places.filter((p) => num.has(p.name) && (dentro(p) || (p.y < 0.05 && ya < 1))).map((p) => bollo(X(p.x), Z(p.z), num.get(p.name), p.deg, p.node ? 7 : 5.6))] : "",
    ];
  };

  // ── sezione: taglio sul piano `ax` = `at` guardando verso `dir` (±1). In orizzontale corre l'altro asse: x cresce a sinistra come nelle piante, z (la strada) a destra ──
  const sezione = (L, ax, at, dir, cx, gy, s, o = {}) => {
    const U = (u) => r1(cx + (ax == "x" ? u : -u) * s), Y = (y) => r1(gy - y * s);
    const Rs = (u0, y0, u1, y1, fill, e = "") => `<rect x="${Math.min(U(u0), U(u1))}" y="${Y(Math.max(y0, y1))}" width="${r1(Math.abs(u1 - u0) * s)}" height="${r1(Math.abs(y1 - y0) * s)}" fill="${fill}" ${e}/>`;
    const Pg = (pts, fill, e = "") => `<path d="M${pts.map(([u, y]) => U(u) + "," + Y(y)).join(" L")} Z" fill="${fill}" ${e}/>`;
    const span = (r) => (ax == "x" ? [r[1], r[3], r[0], r[2]] : [r[0], r[2], r[1], r[3]]);   // [u0, u1] lungo il disegno, [w0, w1] attraverso
    const lati = ax == "x" ? ["z-", "z+"] : ["x-", "x+"], fondo = ax + (dir > 0 ? "+" : "-"), VISTA = `fill-opacity=".5" stroke="none"`;
    const tagliate = L.rooms.filter((r) => { const [, , w0, w1] = span([r.x0, r.z0, r.x1, r.z1]); return at > w0 && at < w1; });
    const oltre = (f) => { const [, , w0, w1] = span(f); return dir > 0 ? w1 > at : w0 < at; };
    const inStanza = (x, z) => tagliate.some((r) => x > r.x0 - 0.05 && x < r.x1 + 0.05 && z > r.z0 - 0.05 && z < r.z1 + 0.05);
    const out = [(o.dietro ?? []).map(([u0, y0, u1, y1, fill]) => Rs(u0, y0, u1, y1, fill, `fill-opacity=".55"`)), `<path d="M${U(o.u0 ?? -6)},${gy} H${U(o.u1 ?? 6)}" stroke="${INK}" stroke-width="1.6" fill="none"/>`];
    for (const r of tagliate) {
      const [u0, u1] = span([r.x0, r.z0, r.x1, r.z1]), t0 = thick(L, r, lati[0]), t1 = thick(L, r, lati[1]), top = r.y + r.h, base = r.y < 1 ? 0 : r.y - 0.22, cima = top + (r.rise ?? 0);
      out.push(Rs(u0, r.y, u1, top, TINTA[r.wall], VISTA), r.foot ? Rs(u0, r.y, u1, r.y + r.foot, K.pietra, VISTA) : "");
      if (r.ridge) out.push(r.ridge == ax ? Pg([[u0, top], [u1, top], [(u0 + u1) / 2, cima]], TINTA[r.wall], VISTA) + Pg([[u0 - t0 - 0.5, top - 0.5], [(u0 + u1) / 2, cima + 0.25], [u1 + t1 + 0.5, top - 0.5], [u1 + t1 + 0.5, top - 0.3], [(u0 + u1) / 2, cima + 0.02], [u0 - t0 - 0.5, top - 0.3]], K.trave)
        : Rs(u0, top, u1, cima, K.trave, VISTA) + Rs(u0 - t0, cima, u1 + t1, cima + 0.2, K.trave), (r.ties ?? []).length && r.ridge == ax ? Rs(u0, top - 0.02, u1, top + 0.2, K.trave) : "");
      else out.push(r.beams == ax ? Array.from({ length: Math.floor((u1 - u0) / 1.2) }, (_, i) => Rs(u0 + 0.7 + i * 1.2 - 0.1, top - 0.22, u0 + 0.7 + i * 1.2 + 0.1, top, K.trave)) : Rs(u0, top - 0.22, u1, top, K.trave, `fill-opacity=".8"`), Rs(u0 - t0, top, u1 + t1, top + 0.12, K.legno));
      out.push(Rs(u0 - t0, base, u0, top, K.pietraScura), Rs(u1, base, u1 + t1, top, K.pietraScura), Rs(u0 - t0, base, u1 + t1, r.y, TINTA[r.floor]));
      // i vani del muro di fondo, in vista
      for (const v of L.openings) {
        const qui = (v.room == r.name && v.side == fondo) || (v.to == r.name && OPP[v.side] == fondo);
        if (!qui) continue;
        const y0 = stanza(L, v.room).y + v.y0, fill = v.kind == "finestra" ? "#c3dad8" : v.kind == "varco" ? K.buio : K.legno, e = v.kind == "varco" ? `fill-opacity=".45"` : v.kind == "finestra" ? `fill-opacity=".85"` : "";
        out.push(v.arch ? P(arco(U(v.at), Y(y0), v.w * s, v.h * s), fill, e) : Rs(v.at - v.w / 2, y0, v.at + v.w / 2, y0 + v.h, fill, e));
      }
    }
    for (const d of L.decks) if (oltre(d.rect)) { const [u0, u1] = span(d.rect); out.push(Rs(u0, d.y - d.t, u1, d.y, K.legno)); }
    for (const st of L.stairs) {
      if (!oltre(st.rect) || !inStanza((st.rect[0] + st.rect[2]) / 2, (st.rect[1] + st.rect[3]) / 2)) continue;
      const [u0, u1] = span(st.rect), sg = st.up[1] == "+" ? 1 : -1, lo = sg > 0 ? u0 : u1, alz = (st.y1 - st.y0) / st.n, ped = (u1 - u0) / (st.n - 1);
      if (st.up[0] == ax) { out.push(Rs(u0, st.y0, u1, st.y1, K.legno, VISTA)); continue; }
      const denti = [[lo, st.y0], ...Array.from({ length: st.n }, (_, i) => [[lo + sg * i * ped, st.y0 + (i + 1) * alz], [lo + sg * Math.min(st.n - 1, i + 1) * ped, st.y0 + (i + 1) * alz]]).flat()];
      out.push(Pg(st.under ? [...denti, [lo + sg * (u1 - u0), st.y0]] : [...denti, [lo + sg * (u1 - u0), st.y1 - 0.3], [lo, st.y0 - 0.02]], K.legno, `fill-opacity=".8"`),
        `<path d="M${U(lo)},${Y(st.y0 + 0.95)} L${U(lo + sg * (u1 - u0))},${Y(st.y1 + 0.95)}" stroke="${K.trave}" stroke-width="2.4" fill="none"/>`);
    }
    // gli arredi dalla parte verso cui si guarda: i più lontani per primi
    const visti = L.pieces.filter((p) => inStanza(p.x, p.z) && oltre(footprint(p, true))).sort((p, q) => (span(footprint(q, true))[2] - span(footprint(p, true))[2]) * dir);
    for (const p of visti) {
      const [u0, u1] = span(footprint(p, true)), um = (u0 + u1) / 2, col = COSA[p.t] ?? K.legno;
      if (p.t == "focolare" || p.t == "camino") { const largo = u1 - u0 < 1.3;   // di fronte la bocca col fuoco, di fianco la pietra; sopra, la cappa fino al soffitto
        out.push(Rs(u0, p.y, u1, p.y + 1.5, K.pietra), p.t == "focolare" || largo ? Rs(um - (largo ? 0.35 : 0.65), p.y + 0.15, um + (largo ? 0.35 : 0.65), p.y + (largo ? 0.95 : 1.25), K.buio) + fiamma(U(um), Y(p.y + 0.3), 1.3) : "",
          Pg([[u0, p.y + 1.5], [u1, p.y + 1.5], [um + (largo ? 0.4 : 0.45), p.y + Math.min(p.v, 3)], [um - (largo ? 0.4 : 0.45), p.y + Math.min(p.v, 3)]], K.intonaco), p.v > 3.1 ? Rs(um - 0.4, p.y + 3, um + 0.4, p.y + p.v, K.pietra) : "");
      } else if (p.t == "pilastro" || p.t == "canna") out.push(Rs(u0 + 0.05, p.y, u1 - 0.05, p.y + p.v, col), p.t == "pilastro" ? Rs(u0 - 0.05, p.y, u1 + 0.05, p.y + 0.4, col) + Rs(u0 - 0.05, p.y + p.v - 0.5, u1 + 0.05, p.y + p.v, col) : "");
      else if (p.t == "candelabro") out.push(`<path d="M${U(um)},${Y(p.y + 0.1)} V${Y(p.y + 1.2)}" stroke="${INK}" stroke-width=".9" stroke-dasharray="3 2" fill="none"/>`, Rs(um - 0.6 * (p.v ?? 1), p.y, um + 0.6 * (p.v ?? 1), p.y + 0.08, K.trave), [-0.5, -0.2, 0.2, 0.5].map((k) => fiamma(U(um + k * (p.v ?? 1)), Y(p.y + 0.22), 0.6)));
      else if (p.t == "stendardo") out.push(Rs(um - 0.5, p.y - 1.6, um + 0.5, p.y + 0.8, K.vino), O(U(um), Y(p.y - 0.2), 0.22 * s, K.oro, `stroke="${INK}" stroke-width=".8"`));
      else if (p.t == "paiolo") out.push(`<path d="M${U(um)},${Y(p.y + 0.95)} V${Y(p.y + 1.5)}" stroke="${INK}" stroke-width="1" fill="none"/>`, Pg([[um - 0.26, p.y + 0.95], [um + 0.26, p.y + 0.95], [um + 0.15, p.y + 0.6], [um - 0.15, p.y + 0.6]], K.ferro));
      else if (p.t == "altare") out.push(Rs(u0, p.y, u1, p.y + 1.05, K.pietra), Rs(u0 - 0.05, p.y + 0.85, u1 + 0.05, p.y + 1.08, K.bianco), `<path d="M${U(um)},${Y(p.y + 1.08)} V${Y(p.y + 1.9)}" stroke="${INK}" stroke-width="2" fill="none"/>`, O(U(um), Y(p.y + 2.1), 0.32 * s, K.oro, `stroke="${INK}" stroke-width="1"`));
      else if (p.t == "lettone") out.push(Rs(u0, p.y, u1, p.y + 0.55, K.legno), Rs(u0, p.y + 0.3, u1, p.y + 0.55, K.vino), [u0, u1 - 0.08].map((u) => Rs(u, p.y, u + 0.08, p.y + 1.9, K.trave)), Rs(u0, p.y + 1.82, u1, p.y + 1.95, K.vino));
      else if (p.t == "scranno") out.push(Rs(u0, p.y, u1, p.y + 0.47, K.legno), Rs(u0, p.y + 0.47, u0 + 0.08, p.y + 1.25, K.trave));
      else if (ALTO[p.t]) out.push(Rs(u0, p.y, u1, p.y + ALTO[p.t], col), p.t == "scaffale" || p.t == "armadio" ? [0.5, 1, 1.45].map((h) => `<path d="M${U(u0)},${Y(p.y + h)} H${U(u1)}" stroke="${INK}" stroke-width=".6" opacity=".5" fill="none"/>`) : "");
      if (LUMI.includes(p.t)) out.push(fiamma(U(um), Y(p.y + (p.t == "candeliere" ? 1.75 : p.t == "braciere" ? 0.85 : 0.2)), 0.8));
    }
    out.push((o.omini ?? []).map(([u, y]) => G(U(u), Y(y), s / 10, omino(0))));
    out.push([...new Map(tagliate.map((r) => [r.y, r])).values()].map((r) => [`<path d="M${U(o.qu ?? 6) - 9},${Y(r.y)} h8" stroke="${INK}" stroke-width=".8"/>`, Tq(U(o.qu ?? 6) + (ax == "x" ? 3 : -13), Y(r.y) + 4, "+" + it(r.y), ax == "x" ? "start" : "end")]));
    return `<g class="f">${J(out)}</g>`;
  };

  // i posti di una pianta, numerati; e la loro tabella
  const numeri = (L) => new Map(L.places.map((p, i) => [p.name, i + 1]));
  const tabella = (x, y, titolo, L, num, tieni = () => true, passo = 13.6) => [T(x, y, "h", titolo), Tq(x + 196, y + 18, "x", "end"), Tq(x + 238, y + 18, "z", "end"), Tq(x + 280, y + 18, "quota", "end"), Tq(x + 318, y + 18, "verso", "end"),
    L.places.filter(tieni).map((p, i) => { const yy = r1(y + 35 + i * passo);
      return [bollo(x + 7, yy - 4, num.get(p.name), null, p.node ? 6.2 : 5.2), T(x + 21, yy, "n", p.name), Tq(x + 196, yy, it(p.x), "end"), Tq(x + 238, yy, it(p.z), "end"), Tq(x + 280, yy, "+" + it(p.y), "end"), Tq(x + 318, yy, p.deg + "°", "end")]; })];
  const note = (x, y, titolo, righe) => [T(x, y, "h", titolo), righe.map((s, i) => T(x, y + 21 + i * 16.5, "n", s))];
  const LEGENDA = ["Bollo grande: un nodo dei percorsi (puntinati).", "Bollo piccolo: un posto, ci si arriva dritti dal nodo", "più vicino. La tacca dice dove si guarda.", "Aloni caldi: fuoco e candele. Freddi: finestre, di giorno."];
  const REGOLE_CASA = ["Dentro è più buio che fuori: un fuoco, qualche candela, il chiarore", "freddo delle finestre che di giorno si ferma a metà stanza.", "",
    "Le misure sono quelle di chi gioca (largo 0,70, occhi a 1,68):", "porte da 1 m in su e alte 2, passaggi da 0,9, rampe al posto dei gradini.", "",
    "Prima si tracciano i percorsi, poi si posano gli arredi dove non li", "intralciano: ogni posto si raggiunge (lo prova npm run check)."];
  const PALETTA = ["pietra", "pietraScura", "intonaco", "trave", "legno", "coppo", "ferro", "lume", "freddo", "vetro", "lino", "lana", "vino", "buio"];

  { // ── le case: povera e a graticcio ──
    const A = fatta("casa.povera", 6, 6, 5), B_ = fatta("casa.graticcio", 7, 8, 3), nA = numeri(A), nB = numeri(B_), sA = 40, sB = 34, pA = [205, 318], pB0 = [843, 318], pB1 = [1128, 318];
    const st = B_.stairs[0], cam = A.pieces.find((p) => p.t == "camino");
    sheet("interni-3-case.svg", "INTERNI · LE CASE", "Casa povera (6 × 6 m) e casa a graticcio (7 × 8 m): piante e sezioni in metri · la strada è in basso, +X a sinistra · una casa per tipo, con un seme: in basso lo stesso tipo con altri semi", [
      DEFS, pianta(A, 0, 3, ...pA, sA, "cA", nA), sezione(A, "x", -0.9, 1, 532, 448, sA, { u0: -3.7, u1: 3.9, qu: 3.75, omini: [[1.5, 0.1]] }), metro(60, 150, sA, "1 m"),
      qh(pA[0] - 2.7 * sA, pA[0] + 2.7 * sA, pA[1] - 3 * sA - 14, it(5.4)), qv(pA[0] - 3 * sA - 14, pA[1] - 2.7 * sA, pA[1] + 2.7 * sA, it(5.4)), Tq(pA[0] + 3 * sA, pA[1] + 3 * sA + 16, "strada", "start"),
      cap(pA[0], 478, "CASA POVERA · PIANTA", ["una stanza: terra battuta a +0,10,", "zoccolo di pietra e intonaco, muri da 30 cm", "alti 2,70 · uscio 1,00 × 2,00"]),
      cap(532, 478, "SEZIONE", ["taglio a x = −0,90 guardando il camino:", `aperta fino alla paglia (colmo a +${it(2.8 + 3.24)}),`, "due catene a +2,80"]),
      pianta(B_, 0, 3, ...pB0, sB, "cB0", nB), pianta(B_, 3, 6, ...pB1, sB, "cB1", nB), sezione(B_, "x", st.rect[0] - 0.35, 1, 1415, 452, 30, { u0: -4.4, u1: 4.7, qu: 4.6, omini: [[0.3, 0.12], [-1, 3.27]] }), metro(690, 150, sB, "1 m"),
      qh(pB0[0] - 3.1 * sB, pB0[0] + 3.1 * sB, pB0[1] - 4 * sB - 14, it(6.2)), qv(pB0[0] - 3.5 * sB - 14, pB0[1] - 3.6 * sB, pB0[1] + 3.6 * sB, it(7.2)), qh(pB1[0] - 3.3 * sB, pB1[0] + 3.3 * sB, pB1[1] - 4 * sB - 14, it(6.6)),
      cap(pB0[0], 478, "A GRATICCIO · PIANO TERRA", ["la bottega: cotto a +0,12, pietra da 40 cm,", "sotto le travi 2,73", "uscio a sesto acuto 1,15 × 2,10"]),
      cap(pB1[0], 478, "PRIMO PIANO", ["la camera: tavolato a +3,27,", "graticcio da 25 cm, in aggetto di 35", "sulla strada · sotto le travi 2,41"]),
      cap(1415, 478, "SEZIONE", ["taglio accanto alla scala, guardandola:", "16 alzate da 20 cm, 36°", "sopra, il sottotetto è chiuso"]),
      tabella(60, 578, "POSTI · CASA POVERA", A, nA), tabella(425, 578, "POSTI · CASA A GRATICCIO", B_, nB),
      note(800, 578, "VARIANTI · LO STESSO TIPO, ALTRI SEMI", []),
      [11, 23, 31, 47].map((seme, i) => { const V = fatta("casa.povera", i % 2 ? 6.4 : 6, 6, seme); return [pianta(V, 0, 3, 900 + i * 100, 652, 13, "vA" + i), Tq(900 + i * 100, 708, "seme " + seme)]; }),
      [7, 19, 29, 41].map((seme, i) => { const V = fatta("casa.graticcio", [6, 6.6, 7, 7.4][i], [7.4, 8, 8, 8][i], seme); return [pianta(V, 0, 3, 900 + i * 100, 776, 11.5, "vB" + i), pianta(V, 3, 6, 900 + i * 100, 880, 11.5, "vC" + i), Tq(900 + i * 100, 941, "seme " + seme)]; }),
      Tq(800, 656, "povera", "start"), Tq(800, 780, "terra", "start"), Tq(800, 884, "sopra", "start"),
      note(1250, 578, "COSA CAMBIA COL SEME", ["Casa povera: il letto nel cantuccio dietro il camino", "o nell'angolo; la tavola sotto la finestra o al muro;", "quali arredi (forziere, scaffale, botte, sacchi, legna)", "e contro quale muro.", "",
        "Casa a graticcio: la scala sale verso il fondo o verso", "la strada (e cambia dove si arriva di sopra); col banco", "di chi vende sotto la finestra o senza; il letto, la", "tavola piccola, armadi e forzieri dove c'è posto.", "",
        "Non cambiano: uscio, finestre e camino, che sono", "quelli che si vedono da fuori (il camino della casa", "povera esce dal colmo: dentro è una penisola di pietra).", "Accanto a ogni letto di sopra c'è un nodo: senza, il più", "vicino potrebbe essere quello della casa accanto."]),
      note(1250, 868, "LEGENDA", LEGENDA.slice(0, 3)),
    ], PALETTA);
  }

  { // ── la casa del ricco ──
    const C = fatta("casa.ricca", 8, 9, 2), n = numeri(C), s = 36, p0 = [222, 330], p1 = [570, 330];
    sheet("interni-4-ricco.svg", "INTERNI · LA CASA DEL RICCO", "8 × 9 m, due piani abitati (il terzo e il sottotetto restano chiusi): piante e sezione in metri · è la casa della locanda, abitata da una famiglia sola · il seme la specchia", [
      DEFS, pianta(C, 0, 3.3, ...p0, s, "cC0", n), pianta(C, 3.3, 6.6, ...p1, s, "cC1", n), sezione(C, "z", 0.5, -1, 1010, 500, 44, { u0: -4.6, u1: 4.6, qu: -4.5, omini: [[-1.9, 0.12], [1.9, 3.52]] }), metro(60, 150, s, "1 m"), metro(800, 150, 44, "1 m"),
      qh(p0[0] - 3.6 * s, p0[0] + 3.6 * s, p0[1] - 4.5 * s - 14, it(7.2)), qv(p0[0] - 4 * s - 14, p0[1] - 4.1 * s, p0[1] + 4.1 * s, it(8.2)), Tq(p0[0] + 4 * s, p0[1] + 4.5 * s + 16, "strada", "start"),
      cap(p0[0], 528, "PIANO TERRA · LA SALA", ["cotto a +0,12, pietra da 40 cm, sotto le travi 3,08", "un focolare per fianco · portone 1,70 × 2,50"]),
      cap(p1[0], 528, "PRIMO PIANO", ["tavolato a +3,52: corridoio, camera, studio", "tramezzi da 30 cm, porte da 1,10 e 1,20"]),
      cap(1010, 548, "SEZIONE", ["taglio a z = 0,50 guardando il fondo: i focolari tagliati, la tavola,", "la scala in vista (17 alzate da 20 cm) · sopra, camera e studio"]),
      tabella(60, 600, "POSTI · PIANO TERRA", C, n, (p) => p.y < 1), tabella(430, 600, "POSTI · PRIMO PIANO", C, n, (p) => p.y > 1),
      note(1290, 150, "COM'È FATTA", ["La sala: tavola lunga con gli scranni e il", "candelabro a ruota, un focolare per scaldarsi", "e uno per cucinare (il paiolo), scaffali e botti", "lungo i muri che restano.", "",
        "La scala corre lungo il muro di fondo, come", "nella locanda; di sopra il corridoio gira", "attorno al vano, dietro un parapetto.", "",
        "Camera padronale: letto grande col baldacchino,", "forziere ai piedi, armadio. Studio: scrittoio", "sotto la finestra, scaffali di libri."]),
      note(1290, 420, "VARIANTI", ["Il seme specchia la casa (la scala sale verso", "destra o verso sinistra, camera e studio si", "scambiano) e sceglie gli arredi lungo i muri."]),
      [5, 8].map((seme, i) => { const V = fatta("casa.ricca", 8, 9, seme); return [pianta(V, 0, 3.3, 1335 + i * 130, 540, 13, "vR" + i), pianta(V, 3.3, 6.6, 1335 + i * 130, 670, 13, "vS" + i), Tq(1335 + i * 130, 744, "seme " + seme)]; }),
      note(800, 600, "REGOLE", REGOLE_CASA), note(800, 770, "LEGENDA", LEGENDA),
      T(1290, 790, "h", "LUCI"), [...Object.entries(PIECES).filter(([, q]) => q.glow).map(([t, q]) => `${t} · raggio ${it(q.glow[3], 1)} m · forza ${it(q.glow[4])}`), "finestra · fredda, di giorno · 4,2 + 1,15 √area"].map((t, i) => T(1290, 811 + i * 15, "n", t)),
    ], PALETTA);
  }

  { // ── la cattedrale ──
    const D = fatta("cattedrale", 0, 0, 1), n = numeri(D), s = 27, p = [330, 512];
    sheet("interni-5-cattedrale.svg", "INTERNI · LA CATTEDRALE", "Nartece fra le torri, navata a tetto in vista, abside: pianta e sezione in metri · il portale è in basso, l'altare in alto · le torri e la galleria restano chiuse (la cripta verrà dalla navata)", [
      DEFS, pianta(D, 0, 20, ...p, s, "cD", n), sezione(D, "z", -3.3, -1, 880, 560, 24, { u0: -8, u1: 8, qu: -7.6, omini: [[0, 0.45], [4.5, 0.45]] }), metro(60, 150, s, "1 m"), metro(700, 150, 24, "1 m"),
      qh(p[0] - 5.9 * s, p[0] + 5.9 * s, p[1] - 14.6 * s, it(11.8)), qv(p[0] - 7.4 * s, p[1] - 10.9 * s, p[1] + 4.9 * s, it(15.8)), qv(p[0] - 7.4 * s, p[1] + 5.5 * s, p[1] + 10.6 * s, it(5.1)),
      Tq(p[0] + 4.3 * s, p[1] - 12.6 * s, "abside · +0,60", "start"), Tq(p[0] - 4.5 * s, p[1] - 9.6 * s, "navatella", "middle", ALO), Tq(p[0], p[1] + 8.8 * s, "nartece", "middle", ALO), Tq(p[0] + 4 * s, p[1] + 13.4 * s, "sagrato: tre gradini da 15 cm", "start"),
      cap(880, 598, "SEZIONE", ["taglio a z = −3,30 guardando l'altare: pilastri a ±3,00, muri alti 10,40,", "colmo a +16,25 con una catena per coppia di pilastri · in fondo l'arco dell'abside"]),
      tabella(1180, 150, "POSTI", D, n, () => true, 13.2),
      note(640, 660, "COM'È FATTA", ["Pavimento di lastre a +0,45 (tre gradini dal sagrato), l'abside un gradino più su.", "Muri di pietra da 60 cm; otto finestre alte 4,60 a sesto acuto, quattro per fianco:", "di giorno la navata è fredda e chiara al centro, buia nelle navatelle.", "",
        "Sei pilastri ottagoni, sei file di banchi ai lati della corsia (ognuna col suo nodo:", "ci si siede dal capo verso la corsia), due candelabri a ruota appesi alle catene.", "",
        "Nell'abside l'altare di pietra col disco d'oro, quello della guglia; ai lati i candelieri.", "Nel nartece il fonte e due panche. Il portale: due battenti da 1,60 dietro l'arco."]),
      note(640, 850, "LEGENDA", LEGENDA),
    ], PALETTA);
  }

  { // ── il municipio ──
    const M_ = fatta("municipio", 0, 0, 1), n = numeri(M_), s = 27, p0 = [378, 290], p1 = [378, 654];
    sheet("interni-6-municipio.svg", "INTERNI · IL MUNICIPIO", "22 × 11 m, due piani: piante e sezione in metri · la piazza è in basso · l'arco di mezzo è il portone, gli altri quattro restano ciechi · la torre dell'orologio resta chiusa", [
      DEFS, pianta(M_, 0, 4.4, ...p0, s, "cM0", n), pianta(M_, 4.4, 9, ...p1, s, "cM1", n), sezione(M_, "z", -2.6, -1, 1085, 420, 25, { u0: -11.4, u1: 11.4, qu: -12.1, omini: [[-3.5, 0.12], [3.65, 4.5]] }), metro(60, 128, s, "1 m"),
      qh(p0[0] - 10.4 * s, p0[0] + 10.4 * s, p0[1] - 5.5 * s - 14, it(20.8)), qv(p0[0] - 11 * s - 14, p0[1] - 4.9 * s, p0[1] + 4.9 * s, it(9.8)),
      ["archivio", "atrio", "esattoria"].map((t, i) => Tq(p0[0] + (1 - i) * 7.4 * s, p0[1] + 4.4 * s, t, "middle", ALO)), ["sala del consiglio", "studio"].map((t, i) => Tq(p1[0] + (i ? -6 : 4.5) * s, p1[1] + 4.6 * s, t, "middle", ALO)), Tq(p1[0] + 8 * s, p1[1] - 3.5 * s, "corridoio", "middle", ALO),
      cap(p0[0], 458, "PIANO TERRA", ["lastre nell'atrio, cotto nelle stanze, a +0,12 · pietra da 60 cm, tramezzi da 30", "sotto le travi 3,88 · nessuna finestra: candelabro e candele"]),
      cap(p1[0], 822, "PRIMO PIANO", ["tavolato a +4,50, alto 4,50 · cinque finestre a sesto acuto sulla piazza", "la scala (22 alzate da 20 cm) arriva nel corridoio, dietro il parapetto"]),
      cap(1085, 462, "SEZIONE", ["taglio a z = −2,60 guardando il fondo: la scala in vista, il corridoio di sopra"]),
      tabella(800, 520, "POSTI · PIANO TERRA", M_, n, (q) => q.y < 1, 13.2), tabella(1170, 520, "POSTI · PRIMO PIANO", M_, n, (q) => q.y > 1, 13.2),
      note(60, 888, "COM'È FATTO", ["Atrio: panche e stendardi, la scala lungo il muro di fondo. Archivio: scaffali di carte lungo i muri, lo scrittoio dell'archivista. Esattoria: il banco dove si paga,", "i forzieri dietro, la rastrelliera delle guardie. Di sopra: la sala del consiglio (due tavole in fila, gli scranni, lo stendardo) e lo studio (scrittoio alla finestra, registri)."]),
    ], PALETTA);
  }

  { // ── la porta della città e la fucina ──
    const G_ = fatta("porta", 0, 0, 1), F = fatta("fucina", 0, 0, 1), nG = numeri(G_), nF = numeri(F), s = 40, g0 = [290, 252], g1 = [290, 540], f0 = [1340, 300];
    // ciò che della fucina c'è già (town.ts): muro di fondo, forgia e canna, incudine, botte, i quattro pali
    const gia = (cx, cy, sm) => `<g class="f" transform="translate(${cx} ${cy}) scale(${-sm / 100} ${sm / 100})">${J([Rm(-3.2, -2.9, 3.2, -2.4, K.pietraScura), Rm(-2.9, -2.4, -1.3, -1, K.pietra), Rm(-2.5, -2.4, -1.7, -1.6, K.pietraScura), Rm(-2.7, -1.12, -1.5, -1, K.lume),
      [[-3.1, -2.6], [3.1, -2.6], [-3.1, 2.6], [3.1, 2.6]].map(([x, z]) => Rm(x - 0.1, z - 0.1, x + 0.1, z + 0.1, K.trave)), Om(0.2, 1.3, 0.26, K.legno), Rm(-0.22, 1.16, 0.62, 1.44, K.ferro), Om(2.5, -1.7, 0.36, K.legno),
      Rm(-3.7, -3.4, 3.7, 3.4, "none", `stroke-dasharray="6 4"`)])}</g>`;
    sheet("interni-7-porta-fucina.svg", "INTERNI · LA PORTA DELLA CITTÀ E LA FUCINA", "Piante e sezioni in metri · la porta è vista da dentro la città (la città è in basso, la campagna in alto) · la fucina è una tettoia aperta sulla via: non ha uscio, e resta com'è", [
      DEFS, gia(...f0, 40),
      // la porta: i due torrioni, il fornice, e dentro la torre sud
      `<g class="f" transform="translate(${g0[0]} ${g0[1]}) scale(${-s / 100} ${s / 100})">${J([Rm(-5, -2.6, -2.2, 2.6, K.pietraScura), Rm(2.2, -2.6, 5, 2.6, K.pietraScura), Rm(-2.2, -2.6, 2.2, 2.6, "#85827a", `fill-opacity=".35"`), Rm(-2.2, -2.3, 2.2, -2.2, K.ferro)])}</g>`,
      `<g class="f" transform="translate(${g1[0]} ${g1[1]}) scale(${-s / 100} ${s / 100})">${J([Rm(-5, -2.6, 5, 2.6, K.pietraScura)])}</g>`,
      pianta(G_, 0, 5.2, ...g0, s, "cG0", nG), pianta(G_, 5.2, 9, ...g1, s, "cG1", nG), sezione(G_, "z", 1.8, -1, 800, 590, 30, { u0: -5.6, u1: 5.6, qu: -5.7, omini: [[0, 0], [-0.5, 5.3]], dietro: [[-5, 0, -2.2, 9.4, K.pietraScura], [2.2, 0, 5, 9.4, K.pietraScura], [-2.2, 5, 2.2, 9.4, K.pietraScura]] }), Tq(800, 500, "fornice"), metro(60, 128, s, "1 m"),
      Tq(g0[0], g0[1] + 4, "fornice", "middle", ALO), Tq(g0[0] + 3.6 * s, g0[1] + 4, "torre nord · piena", "middle", `fill:${K.bianco}`), Tq(g0[0] + 5.3 * s, g0[1] - 2.2 * s, "campagna", "start"), Tq(g0[0] + 5.3 * s, g0[1] + 2.5 * s, "città", "start"),
      qh(g0[0] - 4.7 * s, g0[0] - 2.5 * s, g0[1] - 2.6 * s - 12, it(2.2)), qv(g0[0] - 5 * s - 14, g0[1] - 2.3 * s, g0[1] + 2.3 * s, it(4.6)), qh(g1[0] - 2.2 * s, g1[0] + 4.7 * s, g1[1] - 2.6 * s - 12, it(6.9)),
      cap(g0[0], 384, "PORTA · A TERRA", ["la torre sud: usciolo 1,10 × 2,20 verso la città, posto di guardia", "sotto la seconda rampa · due rampe da 10 alzate (42°), pianerottolo a +2,71"]),
      cap(g1[0], 672, "PORTA · IL CORPO DI GUARDIA", ["a +5,30, sopra il fornice: tavolato, muri di pietra, alto 3,12", "il braciere, la tavola, due brande, l'argano della saracinesca"]),
      cap(800, 628, "SEZIONE", ["taglio a z = 1,80 guardando la campagna:", "la torre sud coi due pianerottoli, il varco, il corpo di guardia"]),
      tabella(60, 745, "POSTI · PORTA", G_, nG, (q) => q.y < 5, 13.2), tabella(430, 745, "", G_, nG, (q) => q.y > 5, 13.2),
      pianta(F, 0, 3, ...f0, 40, "cF", nF), qh(f0[0] - 3.2 * 40, f0[0] + 3.2 * 40, f0[1] - 3.4 * 40 - 12, it(6.4)), Tq(f0[0], f0[1] + 3.4 * 40 + 16, "via maestra"),
      cap(f0[0], 478, "FUCINA · PIANTA", ["tratteggio: la gronda della tettoia · già in città: muro di fondo,", "forgia e canna, incudine, botte · di nuovo: mantice, banco e ferri,", "vasca di tempra, mola, carbone · la luce è quella di fuori"]),
      tabella(1150, 560, "POSTI · FUCINA", F, nF),
      note(1150, 720, "LA FUCINA NON SI CHIUDE", ["È una tettoia su quattro pali, aperta sulla via: così si vede", "da fuori, e così resta. Niente uscio da aprire: ci si entra", "camminando. Gli attrezzi stanno all'aperto, alla luce del sole", "e della forgia, come l'incudine che c'è già."]),
      note(800, 770, "LEGENDA", LEGENDA),
    ], PALETTA);
  }

  { // ── gli arredi che la locanda non aveva: viste in centimetri, come nella tavola interni-2 (stessi attrezzi, stesse regole) ──
    const riga3 = (y) => [`opacity=".5"`].map((e) => Ly([[0, y], [1, y]], 0.6, e));
    const assi = (x0, x1, y0, y1, n) => Array.from({ length: n - 1 }, (_, i) => Ly([[x0 + (x1 - x0) * (i + 1) / n, y0], [x0 + (x1 - x0) * (i + 1) / n, y1]], 0.6, riga_));
    const cero = (x, y, h = 22) => [B(x - 5, y, x + 5, y + 2, K.ferro), B(x - 2, y + 2, x + 2, y + h, K.bianco), fiammella(x, y + h + 1)];
    const camino = [
      [B(-55, 0, 55, 15, K.pietraScura), [-1, 1].map((m) => B(m * 35, 15, m * 55, 112, K.pietra)), B(-35, 15, 35, 95, K.buio), fuoco(0, 18, 0.8), B(-35, 95, 35, 112, K.pietra), B(-60, 112, 60, 128, K.trave),
        Py([[-55, 128], [55, 128], [40, 185], [-40, 185]], K.intonaco), B(-40, 185, 40, 330, K.pietra), Ly([[-70, 330], [70, 330]], 1, tratt)],
      [B(-14, 0, 0, 330, K.pietraScura), B(0, 0, 200, 128, K.pietra), B(0, 0, 200, 15, K.pietraScura), B(196, 112, 206, 128, K.trave), Py([[105, 128], [200, 128], [190, 185], [115, 185]], K.intonaco), B(115, 185, 190, 330, K.pietra), Ly([[-14, 330], [215, 330]], 1, tratt)],
    ];
    const focolare = [
      [B(-90, 0, 90, 15, K.pietraScura), [-1, 1].map((m) => B(m * 65, 15, m * 90, 125, K.pietra)), B(-65, 15, 65, 125, K.buio), B(-45, 15, 45, 22, K.trave), fuoco(0, 22, 1.2), [-52, 52].map((x) => B(x - 2, 15, x + 2, 40, K.ferro)),
        B(-100, 125, 100, 147, K.trave), Py([[-90, 147], [90, 147], [45, 295], [-45, 295]], K.intonaco), Py([[-90, 147], [90, 147], [80, 178], [-80, 178]], K.buio, `opacity=".3" stroke="none"`), Ly([[-110, 295], [110, 295]], 1, tratt)],
      [B(-14, 0, 0, 295, K.pietraScura), B(0, 0, 90, 125, K.pietra), B(0, 0, 90, 15, K.pietraScura), B(0, 125, 94, 147, K.trave), Py([[0, 147], [90, 147], [50, 295], [0, 295]], K.intonaco), Ly([[-14, 295], [110, 295]], 1, tratt)],
    ];
    const falda = (x0, x1, y) => Py([[x0, y + 10], [x1, y + 10], [x1, y - 14], ...Array.from({ length: 7 }, (_, i) => [x1 - (x1 - x0) * (i + 0.5) / 7, y - (i % 2 ? 14 : 6)]), [x0, y - 14]], K.vino);
    const lettone = [
      [B(0, 0, 8, 190, K.trave), B(202, 0, 210, 190, K.trave), B(8, 25, 202, 45, K.legno), Ly([[8, 35], [202, 35]], 0.6, riga_), B(8, 45, 202, 52, K.paglia), Py([[12, 52], [48, 52], [45, 62], [15, 62]], K.bianco), Py([[62, 47], [202, 47], [202, 57], [66, 58]], K.vino), falda(0, 210, 182)],
      [B(0, 0, 8, 190, K.trave), B(152, 0, 160, 190, K.trave), B(8, 45, 152, 120, K.legno), assi(8, 152, 45, 120, 5), B(8, 25, 152, 45, K.legno), falda(0, 160, 182)],
    ];
    const armadio = [B(0, 8, 120, 184, K.legno), assi(0, 120, 8, 184, 6), Ly([[60, 8], [60, 184]], 1.2), B(-3, 0, 123, 8, K.trave), B(-4, 184, 124, 194, K.trave), [40, 150].map((y) => [B(2, y, 24, y + 4, K.ferro), B(96, y, 118, y + 4, K.ferro)]), [54, 66].map((x) => Oy(x, 96, 2.6, K.ferro))];
    const altare = [B(-120, 0, 120, 105, K.pietra), [-1, 1].map((m) => B(m * 70, 10, m * 110, 78, K.pietraScura, `fill-opacity=".5"`)), B(-30, 10, 30, 78, K.pietraScura, `fill-opacity=".5"`), B(-125, 80, 125, 106, K.bianco), B(-125, 86, 125, 90, K.vino),
      Ly([[0, 106], [0, 182]], 2.6), Oy(0, 212, 32, K.oro), Oy(0, 212, 21, "none", `stroke-width=".8" opacity=".6"`), [-92, 92].map((x) => cero(x, 106))];
    const pilastro = [B(-55, 0, 55, 22, K.pietraScura), B(-45, 22, 45, 300, K.pietra), [-15, 15].map((x) => Ly([[x, 22], [x, 300]], 0.6, riga_)), Ly([[-70, 300], [70, 300]], 1, tratt)];
    const tavolino = [[8, 76].map((x) => B(x, 0, x + 6, 68, K.trave)), B(14, 30, 76, 36, K.legno), B(0, 68, 90, 72, K.legno)];
    const tavolone = [
      [[20, 177, 334].map((x) => [B(x, 0, x + 6, 72, K.trave), B(x - 8, 0, x + 14, 6, K.trave)]), B(26, 28, 334, 36, K.legno), B(0, 72, 360, 78, K.legno)],
      [Py([[20, 0], [90, 0], [82, 72], [28, 72]], K.trave), B(51, 28, 59, 36, K.legno), B(0, 72, 110, 78, K.legno)],
    ];
    const scranno = [
      [B(0, 0, 6, 125, K.trave), B(46, 0, 52, 125, K.trave), B(6, 10, 46, 14, K.trave), B(6, 40, 46, 46, K.legno), B(6, 62, 46, 118, K.legno), assi(6, 46, 62, 118, 3)],
      [B(0, 0, 6, 125, K.trave), B(46, 0, 52, 46, K.trave), B(6, 12, 46, 16, K.trave), B(0, 40, 54, 46, K.legno), B(0, 66, 50, 70, K.trave), B(46, 46, 50, 66, K.trave)],
    ];
    const scrittoio = [
      [B(0, 0, 6, 80, K.trave), B(114, 0, 120, 80, K.trave), B(6, 20, 114, 26, K.legno), B(6, 58, 114, 80, K.legno), Oy(60, 69, 2.6, K.ferro), B(-3, 80, 123, 95, K.legno), Ly([[-3, 84], [123, 84]], 0.6, riga_)],
      [B(0, 0, 6, 95, K.trave), B(59, 0, 65, 80, K.trave), B(6, 20, 59, 26, K.legno), Py([[-2, 95], [67, 80], [67, 84], [-2, 99]], K.legno), Py([[10, 97.5], [40, 91], [40, 93], [10, 99.5]], K.bianco)],
    ];
    const banco = [
      [B(0, 0, 160, 97, shade(K.legno, 0.85)), assi(0, 160, 8, 97, 8), [0, 150].map((x) => B(x, 0, x + 10, 97, K.trave)), B(0, 0, 160, 8, K.trave), B(-5, 97, 165, 105, K.legno), ciotola(40, 105), brocca(118, 105)],
      [B(0, 0, 5, 97, K.legno), B(54, 0, 60, 97, K.legno), B(5, 48, 54, 52, K.legno), B(-6, 97, 60, 105, K.legno)],
    ];
    const bancoChiesa = [
      [B(0, 0, 6, 90, K.trave), B(164, 0, 170, 90, K.trave), B(6, 45, 164, 88, K.legno), assi(6, 164, 45, 88, 7), B(6, 40, 164, 45, K.legno), B(6, 0, 164, 40, shade(K.legno, 0.7), `fill-opacity=".5"`)],
      [B(0, 0, 6, 90, K.trave), B(6, 40, 44, 45, K.legno), B(38, 0, 44, 40, K.trave), B(6, 45, 10, 88, K.legno), B(44, 8, 60, 12, K.legno), B(54, 0, 58, 8, K.trave)],
    ];
    const leggio = [B(-22, 0, 22, 6, K.trave), B(-4, 6, 4, 104, K.trave), Py([[-27, 104], [27, 118], [27, 124], [-27, 110]], K.legno), Py([[-20, 112], [20, 122], [20, 126], [-20, 116]], K.bianco)];
    const fonte = [B(-40, 0, 40, 10, K.pietraScura), B(-24, 10, 24, 62, K.pietra), Py([[-24, 62], [24, 62], [55, 80], [55, 100], [-55, 100], [-55, 80]], K.pietra), B(-48, 96, 48, 100, K.petrolio)];
    const candeliere = [Py([[-14, 0], [14, 0], [4, 10], [-4, 10]], K.ferro), B(-2, 10, 2, 150, K.ferro), Oy(0, 82, 4.5, K.ferro), B(-9, 150, 9, 153, K.ferro), B(-3, 153, 3, 175, K.bianco), fiammella(0, 176)];
    const rastrelliera = [[0, 134].map((x) => B(x, 0, x + 6, 200, K.trave)), B(0, 20, 140, 28, K.trave), B(0, 150, 140, 158, K.trave),
      [26, 56, 86, 116].map((x, i) => [Ly([[x, 2], [x, i % 2 ? 212 : 200]], 2.4, `stroke="${K.legno}"`), i % 2 ? Py([[x - 3, 212], [x, 240], [x + 3, 212]], K.ferro) : Py([[x - 2, 200], [x + 14, 208], [x + 12, 224], [x + 2, 216], [x, 232], [x - 2, 216]], K.ferro)])];
    const argano = [[8, 142].map((x) => [B(x, 0, x + 10, 112, K.trave), Py([[x - 16, 0], [x + 26, 0], [x + 10, 32], [x, 32]], K.trave)]), B(22, 62, 138, 100, K.legno), [42, 62, 82, 102, 122].map((x) => Ly([[x, 62], [x, 100]], 0.9, riga_)),
      B(-8, 77, 168, 85, K.ferro), Ly([[-8, 81], [-8, 50], [-24, 50]], 2.6), Ly([[168, 81], [168, 112], [184, 112]], 2.6), Ly([[80, 62], [80, 0]], 1.4, `stroke-dasharray="3 2"`)];
    const braciere = [[[-24, 0], [0, 0], [24, 0]].map(([x], i) => Ly([[x, 0], [(i - 1) * 12, 46]], 2.4)), Py([[-32, 70], [32, 70], [20, 44], [-20, 44]], K.ferro), Py([[-26, 70], [-14, 78], [-4, 72], [6, 80], [16, 73], [26, 70]], K.lume), fuoco(0, 72, 0.45)];
    const stendardo = [B(-56, 236, 56, 243, K.trave), Py([[-50, 236], [50, 236], [50, 22], [0, 0], [-50, 22]], K.vino), Oy(0, 132, 24, K.oro), Ly([[-50, 200], [50, 200]], 0.8, `stroke="${K.oro}"`)];
    const mantice = [B(0, 0, 8, 112, K.trave), B(96, 0, 104, 84, K.trave), B(0, 40, 104, 46, K.trave), Py([[10, 52], [104, 64], [104, 80], [10, 98]], K.cuoio), [34, 58, 82].map((x) => Ly([[x, 55 + (x - 10) * 0.12], [x, 95 - (x - 10) * 0.18]], 0.7, riga_)),
      Py([[104, 68], [140, 71], [140, 74], [104, 77]], K.ferro), Ly([[-4, 112], [124, 122]], 2.6, `stroke="${K.trave}"`), Ly([[10, 98], [10, 113]], 1)];
    const lavoro = [[6, 146].map((x) => B(x, 0, x + 8, 84, K.trave)), B(14, 22, 146, 28, K.legno), B(0, 84, 160, 90, K.legno), B(118, 90, 142, 104, K.ferro), Ly([[130, 104], [130, 112], [112, 112]], 2), B(30, 90, 62, 94, K.ferro), B(42, 94, 50, 104, K.trave),
      B(0, 125, 160, 131, K.trave), [20, 46, 72, 98, 124, 146].map((x, i) => [Ly([[x, 125], [x, 150 + (i % 3) * 8]], 2.2, `stroke="${K.ferro}"`), i % 2 ? B(x - 6, 150 + (i % 3) * 8, x + 6, 160 + (i % 3) * 8, K.ferro) : Ly([[x - 4, 150 + (i % 3) * 8], [x + 4, 150 + (i % 3) * 8]], 2.2, `stroke="${K.ferro}"`)])];
    const tempra = [Py([[-36, 0], [36, 0], [40, 55], [-40, 55]], K.legno), assi(-36, 36, 0, 55, 6), [12, 40].map((y) => B(-39, y, 39, y + 4, K.ferro)), B(-36, 50, 36, 55, K.petrolio)];
    const mola = [[6, 76].map((x) => B(x, 0, x + 8, 62, K.trave)), B(0, 56, 90, 62, K.trave), B(20, 30, 70, 40, K.legno), Oy(45, 72, 30, K.pietra), Oy(45, 72, 4, K.ferro), Ly([[45, 72], [84, 72], [84, 86]], 2.4)];
    const minuti = [Py([[0, 0], [36, 0], [42, 26], [-6, 26]], K.paglia), Ly([[-6, 26], [18, 46], [42, 26]], 1), [9, 17].map((y) => Ly([[-3, y], [39, y]], 0.6, riga_)),
      Py([[58, 0], [82, 0], [86, 28], [54, 28]], K.legno), [6, 20].map((y) => B(55, y, 85, y + 3, K.ferro)), Ly([[54, 28], [70, 44], [86, 28]], 1),
      B(100, 0, 128, 6, K.vino), B(102, 6, 126, 11, K.cuoio), B(101, 11, 127, 17, K.muschio), Py([[146, 0], [192, 0], [196, 34], [182, 48], [156, 48], [142, 34]], K.lino), Ly([[156, 46], [182, 46]], 1.6), Py([[214, 0], [300, 0], [282, 30], [258, 42], [232, 28]], K.buio)];
    const luci = Object.entries(PIECES).filter(([, p]) => p.glow);

    sheet("interni-8-arredi.svg", "INTERNI · GLI ARREDI DELLE CASE E DEGLI EDIFICI", "Quelli che la locanda non aveva (letto, tavolo, panca, sgabello, forziere, scaffale, botte, candele e candelabro stanno nella tavola 2) · viste in centimetri, alla stessa scala riga per riga", [
      terra(398), G(52, 398, 6.2, omino(0)), metro(60, 128, 62, "1 m"),
      riga(398, 0.62, 36, [
        ["CAMINO", ["della casa povera: una penisola di pietra", "che parte dal muro, larga 110, lunga 200;", "la bocca in testa, la canna fino al colmo"], 0,
          [64, 66, camino[0], (q) => [q.h(-55, 55, -11, 110, false), q.v(0, 128, -62, 128)]], [16, 218, camino[1], (q) => q.h(0, 200, -11, 200, false)]],
        ["FOCOLARE DI CASA", ["contro il muro: 180 × 90, bocca 130 × 110,", "architrave a 125, la cappa stringe", "fino al soffitto · alari, ciocchi"], 0,
          [112, 114, focolare[0], (q) => [q.h(-90, 90, -11, 180, false), q.v(0, 125, -98, 125)]], [16, 112, focolare[1], (q) => q.h(0, 90, -11, 90, false)]],
        ["LETTO GRANDE", ["210 × 160, quattro colonne da 190", "e il cielo di panno: è il letto", "della camera padronale"], 0,
          [4, 216, lettone[0], (q) => [q.h(0, 210, -11, 210, false), q.v(0, 190, 218, 190, false)]], [4, 164, lettone[1], (q) => q.h(0, 160, -11, 160, false)]],
        ["ARMADIO", ["120 × 50 × 190,", "due ante, bandelle"], 0, [6, 128, armadio, (q) => [q.h(0, 120, -11, 120, false), q.v(0, 190, 130, 190, false)]]],
        ["ALTARE", ["240 × 100 × 105 di pietra, la tovaglia,", "due ceri · sull'asta il disco d'oro,", "lo stesso della guglia"], 0, [130, 130, altare, (q) => [q.h(-120, 120, -11, 240, false), q.v(0, 105, 132, 105, false)]]],
        ["CANDELIERE", ["a stelo,", "alto 175"], 0, [16, 16, candeliere, null]],
        ["PILASTRO", ["ottagono, Ø 90", "su un plinto da 110:", "sale fino alle catene"], 0, [60, 60, pilastro, (q) => q.h(-45, 45, -11, 90, false)]],
      ], 96, 14),
      terra(646), G(80, 646, 7.2, omino(0)), metro(60, 512, 72, "1 m"),
      riga(646, 0.72, 36, [
        ["TAVOLINO", ["90 × 70 × 72"], 0, [4, 94, tavolino, (q) => [q.h(0, 90, -11, 90, false), q.v(0, 72, 98, 72, false)]]],
        ["TAVOLA LUNGA", ["360 × 110 × 78 su tre cavalletti:", "sala del ricco, consiglio"], 0, [4, 364, tavolone[0], (q) => q.h(0, 360, -11, 360, false)], [4, 114, tavolone[1], (q) => q.h(0, 110, -11, 110, false)]],
        ["SCRANNO", ["52 × 52, seduta a 46,", "schienale a 125"], 0, [4, 56, scranno[0], (q) => q.h(0, 52, -11, 52, false)], [4, 58, scranno[1], (q) => q.v(0, 125, 62, 125, false)]],
        ["SCRITTOIO", ["120 × 65, piano inclinato", "da 80 a 95, un cassetto"], 0, [6, 126, scrittoio[0], (q) => q.h(0, 120, -11, 120, false)], [6, 70, scrittoio[1], (q) => q.h(0, 65, -11, 65, false)]],
        ["BANCO DI BOTTEGA", ["160 × 60 × 105,", "fronte chiuso"], 0, [8, 168, banco[0], (q) => [q.h(0, 160, -11, 160, false), q.v(0, 105, 172, 105, false)]], [8, 62, banco[1], null]],
        ["BANCO DI CHIESA", ["170 × 60, seduta a 45,", "schienale a 90"], 0, [4, 174, bancoChiesa[0], (q) => q.h(0, 170, -11, 170, false)], [4, 64, bancoChiesa[1], (q) => q.v(0, 90, 66, 90, false)]],
        ["LEGGIO", ["50 × 50 × 125"], 0, [30, 30, leggio, null]],
        ["FONTE", ["Ø 110 × 100,", "otto lati"], 0, [58, 58, fonte, (q) => q.h(-55, 55, -11, 110, false)]],
      ], 70, 12),
      terra(872), metro(60, 750, 62, "1 m"),
      riga(872, 0.62, 20, [
        ["RASTRELLIERA", ["140 × 30 × 200,", "aste e alabarde"], 0, [4, 144, rastrelliera, null]],
        ["ARGANO", ["160 × 90, tamburo a 80,", "due manovelle"], 0, [26, 186, argano, null]],
        ["BRACIERE", ["Ø 64 × 70,", "tre piedi"], 0, [34, 34, braciere, null]],
        ["STENDARDO", ["100 × 240, panno", "vino, disco d'oro"], 0, [58, 58, stendardo, null]],
        ["MANTICE", ["140 × 60 × 110,", "il becco alla forgia"], 0, [6, 144, mantice, null]],
        ["BANCO E FERRI", ["160 × 60 × 90, la morsa;", "sopra, tenaglie e martelli"], 0, [4, 164, lavoro, null]],
        ["TEMPRA", ["tino Ø 80 × 55"], 0, [42, 42, tempra, null]],
        ["MOLA", ["Ø 60 sul cavalletto,", "90 × 50 × 100"], 0, [4, 94, mola, null]],
        ["MINUTI", ["cesta, secchio, libri,", "sacco, carbone"], 0, [8, 304, minuti, null]],
      ], 60, 12),
      T(1180, 128, "h", "LUCI"), luci.map(([t, p], i) => T(1180 + (i % 2) * 190, 147 + Math.floor(i / 2) * 15, "n", `${t} · ${it(p.glow[3], 1)} m · ${it(p.glow[4])}`)),
    ], ["legno", "trave", "ferro", "pietra", "pietraScura", "intonaco", "buio", "lume", "paglia", "lino", "vino", "bianco", "oro", "cuoio"]);
  }
}

// ───────────────────────── luce ─────────────────────────
// Le ore: la stessa veduta (la via maestra verso la cattedrale, guardando a est) a sette ore del giorno, nello stile dark,
// e il sonno (pannello e risveglio). Ogni ora ha i suoi colori con nome: cielo, astro, la tinta che prende un muro bianco
// alla luce e in ombra, nebbia, lumi. In gioco li applica main.ts (`LOOK`, `ORE`, `paint`, `setHour`).
// La veduta è in prospettiva centrale: i muri delle case sono piani che fuggono verso l'orizzonte (y = OR).
// ⚠️ Questo blocco sta in fondo: `rnd` è uno solo per tutte le tavole, e chi lo consuma prima cambia quelle dopo.
{
  Object.assign(K, {
    inchiostro: "#0c1119", pece: "#1a222d", osso: "#c3cbd0", lunare: "#637fa6", abisso: "#2f3d55", catrame: "#131a24",
    lavagna: "#2b3342", malva: "#6b6270", cipria: "#9b7f78", selce: "#596171", brina: "#474e5a",
    peltro: "#63717d", latte: "#b3b1a3", burro: "#f1e3bd", avorio: "#f0e4ca", piombo: "#707b82", foschia: "#8f9592",
    cenere: "#717c84", calce: "#b1b3ab", biacca: "#f4f0e2", gesso: "#f8f4e8", fumo: "#858e92", polvere: "#a1a6a0",
    stagno: "#8e989e", paglierino: "#a39f8e", miele: "#f0cd92", grano: "#f6d8a6", talpa: "#6e7274", salvia: "#8b8f85",
    vinaccia: "#4b4b62", rame: "#a5664a", fuoco: "#ee8648", zafferano: "#f69356", ametista: "#675d73", mosto: "#6f6169",
    indaco: "#1c2641", prugna: "#4e394b", oltremare: "#34436c", notturno: "#242d43",
    ambra: "#e08a2e", olio: "#f2ac4c", brace: "#6a2814", bronzo: "#6b4a26",
  });
  // glow = quanto sono accese le finestre (e i lampioni, se `gl` non dice altro) · fk = quanta nebbia in fondo alla via · sx, dx, duomo = chi prende la luce diretta
  // (1 sì, 0 no, "cima" solo in alto) · suolo = il selciato è alla luce, `om` la striscia d'ombra che gli resta [lato, quanto]
  const ORE = [
    { nome: "NOTTE FONDA", ora: "00:00", zenit: "inchiostro", orizz: "pece", astro: "osso", chi: "luna", luce: "lunare", ombra: "abisso", nebbia: "catrame", nubi: ["#27303b", "#141a23"],
      glow: 1, stelle: 0.55, fk: 0.6, bruma: 0.4, sx: 0, dx: 0, duomo: 1, suolo: 1, om: ["dx", 0.1], fin: "ambra", lam: "olio",
      note: ["Luna alta alle spalle, velata dalle nubi (se ne vede il disco in un", "alone): luce fredda sul selciato e sulla cattedrale, i muri della via", "in ombra. Cupa ma giocabile: la nebbia è più chiara delle ombre, così", "case, alberi e lupi si leggono in sagoma. Lumi pieni: sotto ogni lampione", "una pozza calda di 6 m, fuori è blu. · Moderno: più stelle, luna chiara."] },
    { nome: "CREPUSCOLO DELL'ALBA", ora: "05:30", zenit: "lavagna", orizz: "malva", astro: null, chi: "sole/luna", luce: null, ombra: "selce", nebbia: "brina", nubi: ["#6d6875", "#3c4150"],
      glow: 1, stelle: 0.15, fk: 0.78, bruma: 0.75, sx: 0, dx: 0, duomo: 0, suolo: 0, bagliore: "cipria", fin: "ambra", lam: "olio",
      note: ["Né sole né luna: nessuna ombra portata, tutto piatto e freddo.", "A est una riga color cipria sotto il coperchio delle nubi.", "Nebbia al massimo, foschia a terra fitta, le ultime stelle.", "I lumi sono ancora pieni: calano dalle 5:35, spenti entro le 6:30.", "· Moderno: orizzonte rosa e pesca, foschia leggera."] },
    { nome: "MATTINO", ora: "08:12", zenit: "peltro", orizz: "latte", astro: "burro", chi: "sole", luce: "avorio", ombra: "piombo", nebbia: "foschia", nubi: ["#c4c5bd", "#8f989d"],
      glow: 0, stelle: 0, fk: 0.5, bruma: 0.45, sx: 0, dx: 1, duomo: 0, suolo: 1, om: ["sx", 0.22], disco: [203, 24, 6], raggi: 0.11, fin: "brace", lam: "brace",
      note: ["Sole basso a est, in faccia: cattedrale in controluce, ombre", "lunghe verso chi guarda, raggi fra i tetti nella foschia che si", "alza. Luce color avorio, ombre grigio piombo. Lumi spenti: resta", "la brace di qualche finestra. · Moderno: è la sua ora di", "riferimento (sole caldo, colori pieni): non si tocca."] },
    { nome: "MEZZOGIORNO", ora: "12:00", zenit: "cenere", orizz: "calce", astro: "biacca", chi: "sole", luce: "gesso", ombra: "fumo", nebbia: "polvere", nubi: ["#c9cbc7", "#98a0a3"],
      glow: 0, stelle: 0, fk: 0.3, bruma: 0, sx: 0, dx: 1, duomo: 0, suolo: 1, om: ["sx", 0.45], fin: "brace", lam: "brace",
      note: ["Sole alto dietro le nubi: l'ora più piatta e più grigia. Ombre", "corte ai piedi dei muri di sinistra, facciate di destra in luce.", "Nebbia rada: si vede fino alle mura. Nessun raggio. Lumi spenti.", "· Moderno: cielo azzurro pieno, luce bianca."] },
    { nome: "POMERIGGIO", ora: "16:36", zenit: "stagno", orizz: "paglierino", astro: "miele", chi: "sole", luce: "grano", ombra: "talpa", nebbia: "salvia", nubi: ["#bdbdb4", "#8d9497"],
      glow: 0, stelle: 0, fk: 0.36, bruma: 0.15, sx: 0, dx: 1, duomo: 1, suolo: 0, fin: "brace", lam: "brace",
      note: ["L'ora dello stile dark: il gioco com'era prima dell'orologio.", "Non si tocca. Sole a 34° alle spalle, color miele: accende le", "facciate di destra e la cattedrale, la via resta in ombra.", "Nebbia grigio salvia, bloom largo. Lumi spenti (brace).", "· Moderno: pomeriggio dorato."] },
    { nome: "TRAMONTO", ora: "18:30", zenit: "vinaccia", orizz: "rame", astro: "fuoco", chi: "sole", luce: "zafferano", ombra: "ametista", nebbia: "mosto", nubi: ["#b58068", "#5a5068"],
      glow: 0.25, gl: 0, stelle: 0, fk: 0.5, bruma: 0.25, sx: 0, dx: 0, duomo: 0, suolo: 0, fin: "brace", finNota: "brace → ambra, a ¼", lam: "brace", lamNota: "brace (dalle 18:30)",
      note: ["Il sole è già dietro il crinale: in città non arriva più luce diretta.", "Tutto sta in un'ombra malva, viola dall'alto e calda dal basso, sotto", "un cielo ancora acceso; l'arancio resta sulle cime e sul bosco alto.", "Orizzonte color rame, nebbia più fitta e calda, raggi lunghi a ovest.", "Dalle 18:15 le finestre, dalle 18:30 i lampioni. · Moderno: oro pieno."] },
    { nome: "ORA BLU", ora: "19:45", zenit: "indaco", orizz: "prugna", astro: null, chi: "sole/luna", luce: null, ombra: "oltremare", nebbia: "notturno", nubi: ["#3f4563", "#232a44"],
      glow: 1, stelle: 0.2, fk: 0.6, bruma: 0.3, sx: 0, dx: 0, duomo: 0, suolo: 0, fin: "ambra", lam: "olio",
      note: ["Il sole è sotto: niente ombre, luce d'ambiente blu oltremare;", "all'orizzonte l'ultima riga color prugna. È l'ora dei lumi:", "finestre e lampioni pieni contro il blu, il contrasto caldo-freddo", "più forte della giornata. Le prime stelle; la luna fa luce dalle", "20:15. · Moderno: blu più saturo, orizzonte arancio."] },
  ];

  const rgb = (c) => [1, 3, 5].map((j) => parseInt(c.slice(j, j + 2), 16));
  const hex = (v) => "#" + v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
  const per = (c, m) => hex(rgb(c).map((v, j) => v * rgb(m)[j] / 255));          // un materiale sotto una luce
  const tra = (a, b, t) => hex(rgb(a).map((v, j) => v + (rgb(b)[j] - v) * t));    // da a verso b
  const VW = 360, VH = 210, OR = 122, n1 = (v) => +v.toFixed(1);
  const gy = (x) => VH - (x - 16) * 0.593;                                         // il piede del muro di sinistra (quello di destra è specchiato)
  // un punto di un muro: x lungo la via, h da 0 (piede) a 1 (gronda), k = quanto è alta la casa
  const wp = (dx, x, h, k) => { const g = gy(x); return [n1(dx ? VW - x : x), n1(g + h * (OR - k * (g - OR) - g))]; };
  const quad = (dx, x0, x1, h0, h1, k, fill, e = "") => `<path d="M${[wp(dx, x0, h0, k), wp(dx, x1, h0, k), wp(dx, x1, h1, k), wp(dx, x0, h1, k)].join(" L")} Z" fill="${fill}" ${e}/>`;
  /** Casa da x0 a x1 lungo la via: piede di pietra, graticcio, gronda, ardesia. m = la luce sul muro, top = quella che prende solo in alto; fin = [x0, x1, h0, h1, accesa]. */
  const casa = (o, dx, x0, x1, k, m, top, fin) => [
    quad(dx, x0, x1, 1.05, 1.45, k, per(K.ardesia, top ?? m)), quad(dx, x0 - 2, x1, 1, 1.05, k, per(K.trave, m)),
    quad(dx, x0, x1, 0, 0.36, k, per(K.pietra, m)), quad(dx, x0, x1, 0.4, 1, k, per(K.intonaco, m)), top ? quad(dx, x0, x1, 0.74, 1, k, per(K.intonaco, top), NOSTROKE) : "",
    quad(dx, x0 - 1.5, x1, 0.36, 0.41, k, per(K.trave, m)),
    [0, 0.34, 0.67, 1].map((t) => { const x = x0 + (x1 - x0 - 2) * t; return quad(dx, x, x + 2, 0.41, 1, k, per(K.trave, m), `stroke-width=".5"`); }),
    fin.map(([a, b, h0, h1, lit]) => { const [cx, cy] = wp(dx, (a + b) / 2, (h0 + h1) / 2, k);
      return [quad(dx, a, b, h0, h1, k, lit ? tra(K.brace, K.ambra, o.glow) : per(K.vetro, m), `stroke-width="1.6"`), lit && o.glow > 0.2 ? O(cx, cy, 5 + 15 * o.glow, "url(#lume)", `stroke="none" opacity="${o.glow}"`) : ""]; }),
  ];
  /** La cattedrale in fondo alla piazza: torre nord con la guglia, torre sud mai finita. Sta nella nebbia. */
  const duomo = (o, m) => { const st = (c) => tra(per(c, m), K[o.nebbia], 0.3); return [
    P(`M148,80 L157,46 L166,80 Z`, st(K.ardesia)), P(`M150,127 V80 h14 V127 Z`, st(K.pietra)),
    P(`M194,86 L203,79 L212,86 Z`, st(K.legno)), L(`M197,86 V71 M209,86 V73 M195,75 H211`, 0.8), P(`M196,127 V86 h14 V127 Z`, st(K.pietra)),
    P(`M163,127 V97 L180,85 L197,97 V127 Z`, st(K.pietra)), O(180, 103, 4.6, st(K.pietraScura)), O(180, 103, 3.2, per(K.vetro, m)),
    P(arco(180, 127, 9, 13), st(K.pietraScura)), P(arco(180, 127, 6, 10), st(K.trave)), P(arco(157, 127, 4, 7), st(K.trave)), P(arco(203, 127, 4, 7), st(K.trave)),
    P(arco(157, 106, 2.6, 9), st(K.buio)), P(arco(203, 110, 2.6, 9), st(K.buio))]; };
  const lampione = (o, x, y, h) => { const s = h / 62, g = o.gl ?? o.glow; return [
    g > 0.05 ? [`<ellipse cx="${x}" cy="${y + 1}" rx="${n1(46 * s)}" ry="${n1(11 * s)}" fill="url(#pozza)" stroke="none" opacity="${g}"/>`, O(x, y - h - 4 * s, 34 * s, "url(#lume)", `stroke="none" opacity="${g}"`)] : "",
    P(d`M${x - 2.4 * s},${y} h${4.8 * s} v${-5 * s} h${-4.8 * s} Z`, per(K.pietraScura, K[o.ombra])), P(d`M${x - 0.8 * s},${y - 5 * s} h${1.6 * s} V${y - h} h${-1.6 * s} Z`, K.ferro, `stroke-width=".6"`),
    P(d`M${x - 2.2 * s},${y - h} h${4.4 * s} l${1 * s},${-7 * s} h${-6.4 * s} Z`, tra(K.brace, K.olio, g), `stroke-width=".8"`), P(d`M${x - 4.2 * s},${y - h - 7 * s} h${8.4 * s} L${x},${y - h - 11.5 * s} Z`, K.ferro, `stroke-width=".6"`)]; };
  const nube = (x, y, w, c, c2) => { const h = w * 0.22;
    return P(d`M${x},${y} q${w * 0.08},${-h} ${w * 0.26},${-h * 0.7} q${w * 0.14},${-h * 0.9} ${w * 0.34},${-h * 0.2} q${w * 0.22},${-h * 0.3} ${w * 0.4},${h * 0.9} Z`, c, NOSTROKE) + P(d`M${x},${y - 0.4} h${w} q${-w * 0.5},${h * 0.8} ${-w},0 Z`, c2, NOSTROKE); };

  const veduta = (o, i) => {
    const luce = o.luce ? K[o.luce] : K[o.ombra], ombra = K[o.ombra], neb = K[o.nebbia], LASTRA = shade(K.pietra, 0.92);
    const m = (v) => (v === 1 ? luce : ombra), top = (v) => (v === "cima" ? luce : null);
    const stop = (off, c, op = 1) => `<stop offset="${off}" stop-color="${c}" stop-opacity="${n1(op * 100) / 100}"/>`;
    return [
      `<defs><linearGradient id="cielo${i}" x1="0" y1="0" x2="0" y2="1">${stop(0, K[o.zenit])}${stop(1, K[o.orizz])}</linearGradient>`,
      `<radialGradient id="neb${i}" gradientUnits="userSpaceOnUse" cx="180" cy="124" r="200">${stop(0, neb, o.fk)}${stop(0.45, neb, o.fk * 0.6)}${stop(1, neb, 0)}</radialGradient>`,
      `<linearGradient id="bruma${i}" x1="0" y1="0" x2="0" y2="1">${stop(0, tra(neb, "#ffffff", 0.18), 0)}${stop(0.45, tra(neb, "#ffffff", 0.18), 1)}${stop(1, tra(neb, "#ffffff", 0.18), 0)}</linearGradient>`,
      `<radialGradient id="alone${i}">${stop(0, K[o.astro ?? o.bagliore ?? o.orizz], 0.75)}${stop(1, K[o.astro ?? o.bagliore ?? o.orizz], 0)}</radialGradient></defs>`,
      `<rect width="${VW}" height="136" fill="url(#cielo${i})" stroke="none"/>`,
      [[150, 20], [168, 46], [205, 13], [224, 38], [188, 62], [238, 20], [129, 9], [176, 7], [214, 60], [143, 52]].map(([x, y], j) => O(x, y, j % 3 ? 0.8 : 1.2, "#dfe6ee", `stroke="none" opacity="${o.stelle}"`)),
      o.bagliore ? `<ellipse cx="188" cy="118" rx="92" ry="24" fill="url(#alone${i})" stroke="none"/>` : "",
      o.disco ? [O(o.disco[0], o.disco[1], o.disco[2] * 6, `url(#alone${i})`, NOSTROKE), O(o.disco[0], o.disco[1], o.disco[2], K[o.astro], NOSTROKE)] : "",
      [[92, 42, 96], [176, 28, 112], [146, 76, 84], [216, 64, 100], [118, 100, 74], [202, 102, 88]].map(([x, y, w]) => nube(x, y, w, ...o.nubi)),
      `<g transform="translate(180 127) scale(1.5) translate(-180 -127)">`, duomo(o, o.duomo === 1 ? luce : ombra), o.duomo === "cima" ? `<g clip-path="url(#cima)">${J(duomo(o, luce))}</g>` : "",
      [167, 193].map((x) => O(x, 121, 1.2, tra(K.brace, K.olio, o.gl ?? o.glow), `stroke-width=".4"`)), `</g>`,
      // il selciato, l'ombra che gli resta, le fughe
      P(`M16,210 L344,210 L204,127 L156,127 Z`, per(LASTRA, o.suolo ? luce : ombra)),
      o.om ? P(o.om[0] === "sx" ? d`M16,210 L${16 + 328 * o.om[1]},210 L${156 + 48 * o.om[1]},127 L156,127 Z` : d`M344,210 L${344 - 328 * o.om[1]},210 L${204 - 48 * o.om[1]},127 L204,127 Z`, per(LASTRA, ombra), NOSTROKE) : "",
      `<path d="${[-0.62, -0.22, 0.2, 0.6].map((u) => d`M${180 + u * 164},210 L${180 + u * 24},127`).join(" ")} ${[0.2, 0.4, 0.62, 0.84].map((t) => d`M${180 - 24 - 140 * t * t},${127 + 83 * t * t} H${180 + 24 + 140 * t * t}`).join(" ")}" fill="none" stroke-width=".6" opacity=".35"/>`,
      // le case, dal fondo verso chi guarda
      casa(o, 0, 128, 156, 1.9, m(o.sx), top(o.sx), [[136, 144, 0.52, 0.74, false]]), casa(o, 1, 120, 156, 2.5, m(o.dx), top(o.dx), [[130, 139, 0.54, 0.7, true]]),
      casa(o, 0, 84, 128, 2.8, m(o.sx), top(o.sx), [[98, 108, 0.54, 0.68, true], [112, 120, 0.54, 0.68, false], [100, 114, 0.1, 0.25, false]]), casa(o, 1, 70, 120, 2, m(o.dx), top(o.dx), [[88, 100, 0.52, 0.74, false], [80, 100, 0.1, 0.27, true]]),
      lampione(o, 216, 137, 36), lampione(o, 124, 150, 62),
      casa(o, 0, -30, 84, 2.2, m(o.sx), top(o.sx), [[38, 60, 0.12, 0.27, true], [30, 44, 0.56, 0.74, false], [58, 70, 0.56, 0.74, true]]), casa(o, 1, -30, 70, 2.6, m(o.dx), top(o.dx), [[24, 46, 0.1, 0.24, true], [40, 54, 0.52, 0.68, true]]),
      `<rect width="${VW}" height="${VH}" fill="url(#neb${i})" stroke="none"/>`,
      o.bruma ? `<rect y="112" width="${VW}" height="46" fill="url(#bruma${i})" stroke="none" opacity="${o.bruma}"/>` : "",
      o.raggi ? [[60, 132], [168, 236], [272, 332]].map(([a, b]) => P(d`M${o.disco[0]},${o.disco[1]} L${a},210 L${b},210 Z`, luce, `stroke="none" opacity="${o.raggi}"`)) : "",
    ];
  };

  const chip = (x, y, ruolo, k, nota) => `<g transform="translate(${x} ${y})"><rect width="13" height="13" fill="${k ? K[k] : "none"}" stroke="${INK}" stroke-width="${k ? 1 : 0.6}"/>` +
    (k ? "" : `<path d="M0,13 L13,0" stroke="${INK}" stroke-width=".6"/>`) +
    Tq(19, 10.5, `${ruolo} · <tspan style="font-style:normal">${nota ?? k ?? "nessuno"}</tspan>${k && !nota ? ` <tspan style="font-size:9px;font-style:normal">${K[k]}</tspan>` : ""}`, "start") + `</g>`;
  const PW = 350, sc = PW / VW, vh = VH * sc;
  const pannello = (o, i, x, y) => [
    `<g class="f" transform="translate(${x} ${y}) scale(${n1(sc * 1000) / 1000})"><g clip-path="url(#vista)">${J(veduta(o, i))}</g><rect width="${VW}" height="${VH}" fill="none" style="stroke-width:2"/></g>`,
    T(x, y + vh + 22, "h", o.nome), T(x + PW, y + vh + 22, "n", o.ora, "end"),
    [["zenit", o.zenit], ["orizzonte", o.orizz], [o.chi, o.astro], ["nebbia", o.nebbia]].map(([r, k], j) => chip(x, y + vh + 32 + j * 18, r, k)),
    [["luce", o.luce], ["ombra", o.ombra], ["finestre", o.fin, o.finNota], ["lampioni", o.lam, o.lamNota]].map(([r, k, nota], j) => chip(x + 172, y + vh + 32 + j * 18, r, k, nota)),
    o.note.map((n, j) => Tq(x, y + vh + 118 + j * 14.5, n, "start")),
  ];

  // ── il sonno: il pannello "Dormire" e il buio, coi caratteri e l'oro del menu ──
  const CHIARO = "#e9e2cf", ORO = "#d9b45a", BUIO = "#080705";
  const tx = (x, y, s, size, e = "", a = "middle") => `<text x="${x}" y="${y}" text-anchor="${a}" style="font-family:Cinzel,Georgia,serif;font-size:${size}px;fill:${CHIARO};${e}">${s}</text>`;
  const rombo = (x, y, r, fill = ORO) => `<path d="M${x - r},${y} l${r},${-r} l${r},${r} l${-r},${r} Z" fill="${fill}" stroke="none"/>`;
  // il quadrante: mezzanotte in basso, mezzogiorno in alto, in senso orario
  const sulQuadrante = (cx, cy, r, h) => [n1(cx - r * Math.sin(h / 12 * Math.PI)), n1(cy + r * Math.cos(h / 12 * Math.PI))];
  const arcoOre = (cx, cy, r, h0, h1, col) => `<path d="M${sulQuadrante(cx, cy, r, h0)} A${r},${r} 0 ${h1 - h0 > 12 ? 1 : 0},1 ${sulQuadrante(cx, cy, r, h1)}" fill="none" stroke="${col}" stroke-width="5"/>`;
  const glifo = (x, y, h) => (h < 5.5 || h >= 19.5 ? O(x, y, 4, "#cfd6dc", NOSTROKE) + O(x + 2, y - 1.2, 3.6, BUIO, NOSTROKE)   // luna
    : h < 8 || h >= 17.5 ? `<path d="M${x - 4},${y + 2} a4,4 0 0,1 8,0 Z" fill="#e0a05a" stroke="none"/><path d="M${x - 6},${y + 2} h12" stroke="${CHIARO}" stroke-width=".8"/>`   // sole basso
    : O(x, y, 3.2, "#ecdca4", NOSTROKE) + `<path d="${Array.from({ length: 8 }, (_, j) => d`M${x + Math.cos(j * Math.PI / 4) * 4.6},${y + Math.sin(j * Math.PI / 4) * 4.6} L${x + Math.cos(j * Math.PI / 4) * 6.2},${y + Math.sin(j * Math.PI / 4) * 6.2}`).join(" ")}" stroke="#ecdca4" stroke-width=".8" fill="none"/>`);
  const SVEGLIE = [["Notte", 0], ["Mattino", 7], ["Mezzogiorno", 12], ["Tramonto", 18.5]], ADESSO = 21.5, QX = 90, QY = 122, QR = 28;
  const hm = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round(h % 1 * 60)).padStart(2, "0")}`;
  const sonno = (x, y) => [`<g transform="translate(${x} ${y})">`,
    `<rect width="${PW}" height="${n1(vh)}" fill="#0d0b09" stroke="none"/>`, P(`M0,150 L120,124 L350,150 V${n1(vh)} H0 Z`, "#1c140d", NOSTROKE), P(`M262,10 h64 v96 h-64 Z`, "#10161d", NOSTROKE), O(40, 150, 64, "url(#lume)", `stroke="none" opacity=".45"`),
    `<rect x="24" y="12" width="302" height="180" fill="${BUIO}" fill-opacity=".88" stroke="${CHIARO}" stroke-opacity=".4"/><rect x="28" y="16" width="294" height="172" fill="none" stroke="${CHIARO}" stroke-opacity=".14"/>`,
    [[24, 12], [326, 12], [24, 192], [326, 192]].map(([cx, cy]) => rombo(cx, cy, 3.5)),
    tx(175, 41, "DORMIRE", 14, "letter-spacing:6px;font-weight:600"), `<path d="M105,51 H245" stroke="${CHIARO}" stroke-opacity=".35" stroke-width=".8"/>`, rombo(175, 51, 2.6),
    // il quadrante delle ore: notte, alba, giorno, tramonto, sera
    arcoOre(QX, QY, QR, 21, 24, K.indaco), arcoOre(QX, QY, QR, 0, 4.75, K.indaco), arcoOre(QX, QY, QR, 4.75, 6.5, K.cipria), arcoOre(QX, QY, QR, 6.5, 18.25, "#cdbb8a"), arcoOre(QX, QY, QR, 18.25, 19.5, K.fuoco), arcoOre(QX, QY, QR, 19.5, 21, K.oltremare),
    SVEGLIE.map(([, h]) => [`<path d="M${sulQuadrante(QX, QY, QR + 4, h)} L${sulQuadrante(QX, QY, QR + 8, h)}" stroke="${CHIARO}" stroke-width="1"/>`, glifo(...sulQuadrante(QX, QY, QR + 17, h), h)]),
    rombo(...sulQuadrante(QX, QY, QR, ADESSO), 4.6, BUIO), rombo(...sulQuadrante(QX, QY, QR, ADESSO), 3.2),
    tx(QX, QY + 2, hm(ADESSO), 12), tx(QX, QY + 13, "GIORNO 1", 6, "letter-spacing:1.5px;fill-opacity:.55"),
    SVEGLIE.map(([nome, h], j) => { const ry = 80 + j * 22, fra = Math.round(((h - ADESSO) % 24 + 24) % 24 || 24); return [
      `<rect x="160" y="${ry - 9.5}" width="12" height="12" rx="1" fill="#000" fill-opacity=".35" stroke="${CHIARO}" stroke-width=".8"/>`, tx(166, ry, j + 1, 8), glifo(186, ry - 3.5, h),
      tx(199, ry, nome, 9.5, "letter-spacing:.8px", "start"), tx(312, ry, hm(h), 9.5, "letter-spacing:.6px", "end"),
      tx(199, ry + 8.5, `${ADESSO + fra >= 24 ? "domani, " : ""}fra ${fra} ore`, 7, "font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;fill-opacity:.55", "start")]; }),
    `<path d="M160,160 H312" stroke="${CHIARO}" stroke-opacity=".2" stroke-width=".8"/>`,
    `<rect x="160" y="166.5" width="12" height="12" rx="1" fill="#000" fill-opacity=".35" stroke="${CHIARO}" stroke-opacity=".55" stroke-width=".8"/>`, tx(166, 176, 5, 8, "fill-opacity:.6"), tx(199, 176, "Resta sveglio", 9.5, "letter-spacing:.8px;fill-opacity:.6", "start"),
    `<rect width="${PW}" height="${n1(vh)}" fill="none" stroke="${INK}" stroke-width="2"/>`, `</g>`,
    T(x, y + vh + 22, "h", "IL SONNO"), T(x + PW, y + vh + 22, "n", "tasto E davanti a un letto", "end"),
    ["Si sceglie coi tasti numerici, senza lasciare il mouse. Sul", "quadrante la notte sta in basso, il giorno in alto: le tacche", "sono i risvegli, il rombo d'oro è adesso. Caratteri e oro del menu."].map((n, j) => Tq(x, y + vh + 38 + j * 14.5, n, "start")),
    // il buio: le palpebre si chiudono, giorno e ora, si riaprono
    [[0.74, "#3a2c1d", "si chiudono gli occhi", 0], [0, "#000000", "buio: giorno e ora", 1], [0.82, "#6b5b46", "si riaprono, riposati", 2]].map(([ap, bg, cap, j]) => { const fx = x + j * 120, fy = y + vh + 86, lid = n1(31 * (1 - ap) + 9); return [
      `<g transform="translate(${fx} ${fy})"><rect width="110" height="62" fill="${bg}" stroke="none"/>`,
      j === 0 ? P(`M68,6 h28 v34 h-28 Z`, "#151c26", `stroke="${INK}"`) + P(`M0,46 L60,38 L110,46 V62 H0 Z`, "#241a11", NOSTROKE) + O(22, 40, 26, "url(#lume)", `stroke="none" opacity=".8"`) + fiamma(22, 40, 0.7) : "",
      j === 2 ? P(`M68,6 h28 v34 h-28 Z`, "#d5d8ca", `stroke="${INK}"`) + P(`M0,46 L60,38 L110,46 V62 H0 Z`, "#4d3f31", NOSTROKE) + P(`M68,40 L96,40 L110,62 L46,62 Z`, "#cfc9ae", `stroke="none" opacity=".3"`) : "",
      `<rect width="110" height="${lid}" fill="url(#palpSu)" stroke="none"/><rect y="${n1(62 - lid)}" width="110" height="${lid}" fill="url(#palpGiu)" stroke="none"/>`,
      j === 1 ? rombo(55, 20, 2) + tx(55, 35, "Giorno 2 · 07:00", 7, "letter-spacing:1.6px;fill-opacity:.7") + `<path d="M33,42 H77" stroke="${CHIARO}" stroke-opacity=".35" stroke-width=".6"/>` : "",
      `<rect width="110" height="62" fill="none" stroke="${INK}" stroke-width="1.6"/></g>`, Tq(fx + 55, fy + 76, cap)]; }),
  ];

  const x0 = 60, passo = 375, y1 = 106, y2 = 506;
  sheet("luce-1-ore.svg", "LUCE · LE ORE", "La via maestra verso la cattedrale, guardando a est, a sette ore del giorno · stile dark: cielo coperto, tinte spente, il colore sta nei lumi · il chip dice che tinta prende un muro bianco", [
    `<defs><clipPath id="vista"><rect width="${VW}" height="${VH}"/></clipPath><clipPath id="cima"><rect width="${VW}" height="92"/></clipPath>`,
    `<radialGradient id="pozza"><stop offset="0" stop-color="#f0a850" stop-opacity=".75"/><stop offset=".6" stop-color="#c8782e" stop-opacity=".3"/><stop offset="1" stop-color="#c8782e" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="palpSu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset=".72" stop-color="#000"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`,
    `<linearGradient id="palpGiu" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#000"/><stop offset=".72" stop-color="#000"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>`,
    ORE.map((o, i) => pannello(o, i, x0 + (i % 4) * passo, i < 4 ? y1 : y2)), sonno(x0 + 3 * passo, y2),
    ["I LUMI · seguono l'ora: le finestre si accendono dalle 18:15, i lampioni dalle 18:30 (passa il lampionaio); pieni dalle 19:20 alle 5:30, spenti entro le 6:30. Le fiamme (candele, focolari, forgia) non si spengono mai. Dentro, di notte, i vetri sono blu scuro: restano fuoco e candele.",
      "LA NOTTE · pietra al chiaro di luna sul 20% di grigio, in ombra sul 10%: mai nero pieno; la spada riflette il cielo freddo. · I RAGGI · forti col sole basso (alba e tramonto), deboli a mezzogiorno, assenti senza sole."].map((n, j) => Tq(60, 912 + j * 15, n, "start", "font-size:12px")),
  ], ["pietra", "pietraScura", "intonaco", "trave", "ardesia", "vetro", "ferro", "ambra", "olio", "brace", "bronzo", "cipria"]);
}

if (process.argv[2] === "posti") console.log([...POSTI.filter((q) => q[4] != null), ...SEDUTE].map(([n, p, x, z, yaw]) =>
  `${n.padEnd(20)} x ${x.toFixed(2).padStart(6)}  y ${(z > HW ? 0 : QUOTA[p]).toFixed(2)}  z ${z.toFixed(2).padStart(6)}  verso ${String(yaw).padStart(3)}°`).join("\n") + "\n\n" +
  LUCI.map(([t, p, x, z, h]) => `${TIPI_LUCE[t][0].padEnd(30)} x ${x.toFixed(2).padStart(6)}  y ${(QUOTA[p] + h).toFixed(2)}  z ${z.toFixed(2).padStart(6)}  raggio ${TIPI_LUCE[t][1]}  forza ${TIPI_LUCE[t][2]}`).join("\n") + "\n\n" +
  PASSI.map(([a, b]) => `${a} – ${b}`).join("\n"));
