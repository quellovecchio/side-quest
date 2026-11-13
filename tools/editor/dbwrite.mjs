// Riscrive alcuni valori dentro il testo di db.json lasciando com'è tutto il resto del file (la formattazione a mano, i
// fine riga). Lo usano il plugin dell'editor (vite.config.mjs) e gli script di migrazione.
// Un valore riscritto va su più righe: una lista un elemento per riga, un oggetto una voce per riga; ogni elemento su una
// riga sola, coi numeri a tre decimali.

/** Un valore JSON su una riga, con gli spazi del file (`{ "a": 1, "b": [1, 2] }`) e i numeri a tre decimali. */
export function inline(v) {
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  if (v && typeof v === "object") return `{ ${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }`;
  if (typeof v === "number") return String(Number(v.toFixed(3)));
  return JSON.stringify(v);
}

/**
 * Dove sta ogni valore del testo: un lettore JSON minimo che, per l'oggetto e la lista radice e per ciò che contengono,
 * ricorda da dove a dove va ciascun valore. Restituisce l'albero { start, end, kids } (kids per chiave o per posizione).
 */
function spans(text) {
  let i = 0;
  const ws = () => { while (/\s/.test(text[i])) i++; };
  const str = () => { const s = i++; while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1; i++; return JSON.parse(text.slice(s, i)); };
  const value = () => {
    ws();
    const start = i, ch = text[i];
    if (ch === "{") {
      i++; const kids = {}; ws();
      if (text[i] === "}") { i++; return { start, end: i, kids, obj: true }; }
      for (;;) { ws(); const k = str(); ws(); i++; kids[k] = value(); ws(); if (text[i++] === "}") break; }
      return { start, end: i, kids, obj: true };
    }
    if (ch === "[") {
      i++; const kids = []; ws();
      if (text[i] === "]") { i++; return { start, end: i, kids }; }
      for (;;) { kids.push(value()); ws(); if (text[i++] === "]") break; }
      return { start, end: i, kids };
    }
    if (ch === '"') { str(); return { start, end: i }; }
    while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
    return { start, end: i };
  };
  return value();
}

/** Il valore `v` scritto su più righe, rientrato come la riga in cui sta. */
function block(v, indent, eol) {
  const inner = `${indent}  `;
  if (Array.isArray(v)) return v.length ? `[${eol}${v.map((x) => inner + inline(x)).join(`,${eol}`)}${eol}${indent}]` : "[]";
  if (v && typeof v === "object") {
    const e = Object.entries(v).filter(([, x]) => x !== undefined);
    return e.length ? `{${eol}${e.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${inline(x)}`).join(`,${eol}`)}${eol}${indent}}` : "{}";
  }
  return inline(v);
}

/**
 * Gli abitanti come li scrive la mano: una riga coi campi brevi, poi la giornata e le interazioni un elemento per riga, le
 * battute su una riga sola.
 */
function npcList(list, indent, eol) {
  const a = `${indent}  `, b = `${a}  `, c = `${b}  `, long = ["routine", "dialogue", "interactions"];
  const one = (n) => {
    const head = Object.entries(n).filter(([k, x]) => x !== undefined && !long.includes(k)).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
    const rest = long.filter((k) => n[k] !== undefined).map((k) => k === "dialogue" || !n[k].length ? `${b}"${k}": ${inline(n[k])}`
      : `${b}"${k}": [${eol}${n[k].map((x) => c + inline(x)).join(`,${eol}`)}${eol}${b}]`);
    return `${a}{ ${head.join(", ")}${rest.length ? `,${eol}${rest.join(`,${eol}`)}` : ""} }`;
  };
  return list.length ? `[${eol}${list.map(one).join(`,${eol}`)}${eol}${indent}]` : "[]";
}

/**
 * Il testo con alcuni valori sostituiti. `changes` = lista di { path, value }, dove `path` è il cammino dalla radice
 * (chiavi e indici: ["locations", 3, "walks"]); `as: "npcs"` scrive una lista di abitanti come `npcList`. Se l'ultima chiave manca nell'oggetto, la si aggiunge in fondo.
 */
export function writeValues(text, changes) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  // dall'ultimo al primo: sostituire un pezzo non sposta quelli che vengono prima
  const at = changes.map(({ path, value, as }) => {
    const write = as === "npcs" ? npcList : block;
    let node = spans(text);
    for (const k of path.slice(0, -1)) { node = node.kids?.[k]; if (!node) throw new Error(`nel file non c'è ${path.join(".")}`); }
    const last = path[path.length - 1], hit = node.kids?.[last];
    const lineStart = (pos) => text.lastIndexOf("\n", pos) + 1, indentOf = (pos) => text.slice(lineStart(pos), pos).match(/^\s*/)[0];
    if (hit) {
      // il rientro è quello della riga in cui comincia la chiave (o il valore, in una lista)
      return { start: hit.start, end: hit.end, txt: write(value, indentOf(hit.start), eol) };
    }
    if (!node.obj) throw new Error(`${path.join(".")}: posizione fuori dalla lista`);
    const close = node.end - 1, keys = Object.values(node.kids), ind = keys.length ? indentOf(keys[keys.length - 1].start).replace(/[^\s].*/, "") : indentOf(close) + "  ";
    const keyIndent = keys.length ? text.slice(lineStart(keys[keys.length - 1].start), keys[keys.length - 1].start).match(/^\s*/)[0] : ind;
    const after = keys.length ? keys[keys.length - 1].end : node.start + 1;
    return { start: after, end: after, txt: `,${eol}${keyIndent}${JSON.stringify(last)}: ${write(value, keyIndent, eol)}` };
  }).sort((a, b) => b.start - a.start);
  for (const c of at) text = text.slice(0, c.start) + c.txt + text.slice(c.end);
  return text;
}

/** Il testo con il blocco `children` del luogo `id` sostituito (il primo uso dell'editor; resta per gli script). */
export function writeChildren(text, id, children) {
  const i = JSON.parse(text).locations.findIndex((l) => l.id === id);
  if (i < 0) throw new Error(`luogo "${id}" non trovato`);
  return writeValues(text, [{ path: ["locations", i, "children"], value: children }]);
}
