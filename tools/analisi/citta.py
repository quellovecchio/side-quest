# ─────────────────────────────────────────────────────────────────────────────
# ANALISI DELLA CITTÀ — misura i difetti della pianta e del rilievo, senza aprire il gioco.
#
#   python tools/analisi/citta.py [cartella d'uscita]
#
# Legge public/data/db.json e public/data/rilievo.bin (gli stessi del gioco) e scrive:
#   rapporto.txt   pendenze del suolo, edifici sospesi / interrati / compenetrati / senza via, vie ripide o in trincea,
#                  scale inutili, vicoli ciechi, tratti senza selciato
#   mappa.png      il rilievo (ombre, curve ogni 2 m, in rosso oltre il 60%) con vie, edifici e i difetti numerati
#   sezioni.png    due sezioni IN SCALA VERA (niente esagerazione verticale): porta → piazza → cattedrale, e nord → sud
# Coordinate: quelle della città (+x est, +z nord), come nel file. Solo Python, numpy e PIL: niente Blender.
# ─────────────────────────────────────────────────────────────────────────────
import json, math, os, struct, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
OUT = ARGS[0] if ARGS else os.path.join(ROOT, "docs", "reference", "citta", "analisi")
os.makedirs(OUT, exist_ok=True)
DB = json.load(open(os.path.join(ROOT, "public", "data", "db.json"), encoding="utf8"))
T = next(l for l in DB["locations"] if l["kind"] == "settlement")
CX, CZ = T["at"]
WALLS, RIVER, RW, WATER = T["walls"], T["river"]["line"], T["river"]["width"], T["river"]["level"]
RWS = T["river"].get("widths")   # (un torrente a più quote: una larghezza per punto)
K = 3   # pixel per metro


class Suolo:
    """Un campo di quote su una griglia da un metro, in coordinate della città."""
    def __init__(s, x0, z0, H):
        s.x0, s.z0, s.H = x0, z0, H
        s.h, s.w = H.shape
        gz, gx = np.gradient(H)
        s.slope = np.hypot(gx, gz)   # (m/m)

    def at(s, x, z):
        fx, fz = min(max(x - s.x0, 0), s.w - 1.001), min(max(z - s.z0, 0), s.h - 1.001)
        i, j = int(fx), int(fz); a, b = fx - i, fz - j
        H = s.H
        return (H[j, i] * (1 - a) + H[j, i + 1] * a) * (1 - b) + (H[j + 1, i] * (1 - a) + H[j + 1, i + 1] * a) * b


def leggi():
    raw = open(os.path.join(ROOT, "public", "data", "rilievo.bin"), "rb").read()
    x0, z0, w, h = struct.unpack("<4f", raw[:16]); w, h = int(w), int(h)
    return Suolo(x0 - CX, z0 - CZ, np.frombuffer(raw, "<i2", w * h, 16).reshape(h, w) / 100.0)


# ── geometria ──
def rot(deg):
    t = math.radians(deg)
    return (math.cos(t), -math.sin(t)), (math.sin(t), math.cos(t))   # (x locale e z locale nel mondo, come Mason.in)


def seg(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz + 1e-9)))
    return math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t)


def pdist(p, line):
    return min(seg(p, line[i], line[i + 1]) for i in range(len(line) - 1))


def inside(p, poly):
    c = False
    for i in range(len(poly)):
        (ax, az), (bx, bz) = poly[i - 1], poly[i]
        if (az > p[1]) != (bz > p[1]) and p[0] < ax + (bx - ax) * (p[1] - az) / (bz - az):
            c = not c
    return c


def riva(p):
    """Distanza dalla riva (negativa nell'acqua): con la larghezza di quel tratto, se il torrente ne ha una per punto."""
    if not RWS:
        return pdist(p, RIVER) - RW / 2
    return min(seg(p, RIVER[k], RIVER[k + 1]) - max(RWS[k], RWS[k + 1]) / 2 for k in range(len(RIVER) - 1))


CRIPTE = [(l["at"][0] - CX, l["at"][1] - CZ) for l in DB["locations"] if l["kind"] == "crypt"]


def passo(line, d=1.0):
    """La spezzata ricampionata ogni d metri: (x, z, strada fatta)."""
    out, s = [], 0.0
    for a, b in zip(line, line[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, int(L / d))
        out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, s + L * k / n) for k in range(n)]
        s += L
    return out + [(line[-1][0], line[-1][1], s)]


# ── gli edifici: ingombro locale (x0, x1, z0, z1; la facciata è a +Z) e altezza per le sezioni ──
FISSI = {"cattedrale": (-9.5, 9.5, -14.6, 11.8, 11), "municipio": (-11, 11, -5.5, 5.5, 9), "teatro": (-12.3, 12.3, -28, 17.3, 18), "fucina": (-3.3, 3.3, -3, 3, 3)}


class Edificio:
    def __init__(s, i, c):
        k = c.get("scale", 1)
        if c["prefab"].startswith("casa."):
            w, d = c["size"]; box = (-w / 2, w / 2, -d / 2, d / 2, {"casa.povera": 5, "casa.graticcio": 7, "casa.ricca": 9}[c["prefab"]])
        else:
            box = FISSI[c["prefab"]]
        s.i, s.c, s.nome = i, c, c.get("id") or c["prefab"]
        s.x, s.z = c["at"]; s.X, s.Z = rot(c.get("yaw", 0))
        s.x0, s.x1, s.z0, s.z1 = (v * k for v in box[:4]); s.alto = box[4] * k
        s.guai = []

    def mondo(s, lx, lz):
        return (s.x + s.X[0] * lx + s.Z[0] * lz, s.z + s.X[1] * lx + s.Z[1] * lz)

    def locale(s, x, z):
        dx, dz = x - s.x, z - s.z
        return (dx * s.X[0] + dz * s.X[1], dx * s.Z[0] + dz * s.Z[1])

    def dentro(s, x, z, m=0.0):
        lx, lz = s.locale(x, z)
        return s.x0 - m < lx < s.x1 + m and s.z0 - m < lz < s.z1 + m

    def angoli(s):
        return [s.mondo(a, b) for a, b in ((s.x0, s.z0), (s.x1, s.z0), (s.x1, s.z1), (s.x0, s.z1))]

    def punti(s, d=1.0):
        nx, nz = max(2, int((s.x1 - s.x0) / d) + 1), max(2, int((s.z1 - s.z0) / d) + 1)
        return [s.mondo(s.x0 + (s.x1 - s.x0) * a / (nx - 1), s.z0 + (s.z1 - s.z0) * b / (nz - 1)) for a in range(nx) for b in range(nz)]

    def uscio(s, fuori=0.0):
        return s.mondo((s.x0 + s.x1) / 2, s.z1 + fuori)


EDIFICI = [Edificio(i, c) for i, c in enumerate(T["children"]) if c["prefab"].startswith("casa.") or c["prefab"] in FISSI]
# ── le vie: (tipo, nome, larghezza, spezzata) ──
VIE = [("selciato", f"{p['kind']} #{i}", p["width"], [tuple(q) for q in p["line"]]) for i, p in enumerate(T["paving"])]
for i, c in enumerate(T["children"]):
    if c["prefab"].startswith("scala"):
        VIE.append(("scala", f"{c['prefab']} #{i}", c["size"][0], [(q[0], q[2]) for q in c["line"]]))
    if c["prefab"].startswith("ponte"):
        VIE.append(("ponte", f"{c['prefab']} #{i}", 5.4, [(q[0], q[2]) for q in c["line"]]))
PERCORSI = [[tuple(q) for q in w] for w in T["walks"]]


def via_vicina(p):
    """Quanto dista il punto dal bordo della via più vicina (negativo = ci sta sopra)."""
    def d(w, l):
        if w > 12:   # (una piazza: un rettangolo, non una via coi capi tondi)
            (ax, az), (bx, bz) = l[0], l[-1]; L = math.hypot(bx - ax, bz - az); ux, uz = (bx - ax) / L, (bz - az) / L
            t, n = (p[0] - ax) * ux + (p[1] - az) * uz, abs(-(p[0] - ax) * uz + (p[1] - az) * ux)
            return max(-t, t - L, n - w / 2)
        return pdist(p, l) - w / 2
    return min(d(w, l) for _, _, w, l in VIE if len(l) > 1)


def sat(a, b):
    """Due rettangoli girati si toccano? (assi separatori) → di quanto si compenetrano, o 0."""
    A, B, deep = a.angoli(), b.angoli(), 1e9
    for X in (a.X, a.Z, b.X, b.Z):
        pa, pb = [p[0] * X[0] + p[1] * X[1] for p in A], [p[0] * X[0] + p[1] * X[1] for p in B]
        o = min(max(pa), max(pb)) - max(min(pa), min(pb))
        if o <= 0:
            return 0.0
        deep = min(deep, o)
    return deep


def analizza(G, R):
    P = R.append
    # ── A. il suolo ──
    m = np.zeros(G.H.shape, bool)
    for j in range(G.h):
        for i in range(G.w):
            p = (G.x0 + i, G.z0 + j)
            m[j, i] = inside(p, WALLS) and pdist(p, RIVER) > RW / 2 + 8
    s = G.slope[m]
    P("A. IL SUOLO DENTRO LE MURA (a più di 8 m dalla riva)")
    P(f"   quote {G.H[m].min():.1f} … {G.H[m].max():.1f} m (acqua a {WATER} m); area {m.sum()} m²")
    for a, b, n in ((0, .05, "piano, ci si costruisce"), (.05, .12, "in salita, via carrabile"), (.12, .30, "ripido: scale, terrazze"), (.30, .60, "scarpata"), (.60, 9, "parete (oltre il 60%)")):
        P(f"   {a * 100:3.0f}–{min(b, 1) * 100:3.0f}%  {100 * ((s >= a) & (s < b)).mean():5.1f}%  {n}")
    top = G.H[m].max()
    P(f"   la cima: {int((G.H[m] > top - 1.5).sum())} m² entro 1,5 m dalla quota massima; la cattedrale ne occupa "
      + ", ".join(f"{(e.x1 - e.x0) * (e.z1 - e.z0):.0f}" for e in EDIFICI if e.nome == "cattedrale") + " m²")

    # ── B. gli edifici ──
    P("\nB. GLI EDIFICI  (#indice in children; quota del piano = suolo al centro, come rise() nel gioco)")
    for e in EDIFICI:
        piano = G.at(e.x, e.z); q = [G.at(*p) for p in e.punti()]
        e.piano, e.sotto, e.sopra = piano, piano - min(q), max(q) - piano
        if e.sotto > 1.0:
            e.guai.append(f"sospeso: il suolo scende di {e.sotto:.1f} m sotto l'ingombro")
        if e.sopra > 0.6:
            e.guai.append(f"interrato: il suolo sale di {e.sopra:.1f} m dentro l'ingombro")
        # davanti all'uscio: lo spazio fino a 8 m; se lì passa una via basta quella (oltre la via il pendio è di qualcun altro)
        fin = (2, 4) if via_vicina(e.uscio(0.3)) < 2 else (2, 4, 6, 8)
        dav = [G.at(*q) - piano for q in (e.mondo(e.x0 + (e.x1 - e.x0) * a / 4, e.z1 + d) for a in range(5) for d in fin) if riva(q) > 4] or [0]
        if max(dav) > 1.5:
            e.guai.append(f"ingresso contro il pendio: a 8 m dalla facciata il suolo è {max(dav):.1f} m più alto")
        if min(dav) < -2.5:
            e.guai.append(f"ingresso sul vuoto: a 8 m dalla facciata il suolo è {-min(dav):.1f} m più basso")
        d = via_vicina(e.uscio(0.3))
        if d > 4:
            e.guai.append(f"senza via: l'uscio è a {d:.0f} m dal selciato più vicino")
        over = min((via_vicina(p) for p in e.punti(1.5)))
        if over < -0.8:
            e.guai.append(f"sopra una via: l'ingombro entra nel selciato di {-over:.1f} m")
        dm = min(min(seg(p, WALLS[i - 1], WALLS[i]) for i in range(len(WALLS))) for p in e.angoli())
        if dm < 1.5 or not all(inside(p, WALLS) for p in e.angoli()):
            e.guai.append(f"nelle mura: un angolo è a {dm:.1f} m dal muro" + ("" if all(inside(p, WALLS) for p in e.angoli()) else " (fuori)"))
        dr = min(riva(p) for p in e.punti(2))
        if dr < 1:
            e.guai.append(f"nel fiume: a {dr:.1f} m dalla riva")
    for a in range(len(EDIFICI)):
        for b in range(a + 1, len(EDIFICI)):
            ea, eb = EDIFICI[a], EDIFICI[b]
            if math.hypot(ea.x - eb.x, ea.z - eb.z) < 60:
                o = sat(ea, eb)
                if o > 0.15:
                    ea.guai.append(f"compenetrato con #{eb.i} {eb.nome} per {o:.1f} m"); eb.guai.append(f"compenetrato con #{ea.i} {ea.nome} per {o:.1f} m")
    bad = [e for e in EDIFICI if e.guai]
    P(f"   {len(EDIFICI)} edifici, {len(bad)} con difetti")
    for k in ("sospeso", "interrato", "ingresso contro", "ingresso sul vuoto", "senza via", "sopra una via", "nelle mura", "nel fiume", "compenetrato"):
        P(f"   {sum(1 for e in EDIFICI if any(g.startswith(k) for g in e.guai)):3d}  {k}")
    for e in bad:
        P(f"   #{e.i:<3d} {e.nome:<15s} ({e.x:.0f}, {e.z:.0f}) quota {e.piano:.1f}: " + "; ".join(e.guai))

    # ── C. le vie ──
    P("\nC. LE VIE  (pendenza lungo la via sul suolo vero; di traverso: il suolo 1,5 m oltre il bordo rispetto alla mezzeria)")
    guai_vie = []
    for tipo, nome, w, line in VIE:
        if tipo == "ponte" or len(line) < 2:
            continue
        S = passo(line); q = [G.at(x, z) for x, z, _ in S]
        L, dh = S[-1][2], q[-1] - q[0]
        pend = max(abs(q[i + 4] - q[i]) / 4 for i in range(len(q) - 4)) if len(q) > 4 else abs(dh) / max(L, 1)
        tr = []
        for i in range(len(S) - 1):
            dx, dz = S[i + 1][0] - S[i][0], S[i + 1][1] - S[i][1]; n = math.hypot(dx, dz) or 1
            for sg in (-1, 1):
                tr.append((G.at(S[i][0] - dz / n * sg * (w / 2 + 1.5), S[i][1] + dx / n * sg * (w / 2 + 1.5)) - q[i], S[i][:2]))
        svolte = []
        for a, b, c in zip(line, line[1:], line[2:]):
            t = abs((math.degrees(math.atan2(c[1] - b[1], c[0] - b[0]) - math.atan2(b[1] - a[1], b[0] - a[0])) + 180) % 360 - 180)
            if t > 60:
                svolte.append((round(t), b))
        usci = sum(1 for e in EDIFICI if pdist(e.uscio(0.3), line) < w / 2 + 6)
        g = []
        (su, dove_su), (giu, dove_giu) = max(tr), min(tr)
        if tipo == "selciato" and pend > 0.14:
            g.append(f"ripida senza gradini ({pend * 100:.0f}%)")
        if tipo == "scala" and abs(dh) / max(L, 1) < 0.06:
            g.append(f"scalinata quasi in piano ({abs(dh):.1f} m su {L:.0f} m)")
        if tipo == "scala" and pend > 0.55:
            g.append(f"scala a pioli: tratti al {pend * 100:.0f}%")
        if su > 1.5:
            g.append(f"in trincea: il terreno a fianco sale di {su:.1f} m in ({dove_su[0]:.0f}, {dove_su[1]:.0f})")
        if giu < -1.5 and riva(dove_giu) > w / 2 + 4:
            g.append(f"sul ciglio: il terreno a fianco scende di {-giu:.1f} m in ({dove_giu[0]:.0f}, {dove_giu[1]:.0f})")
        if svolte:
            g.append("svolte secche: " + ", ".join(f"{t}° in ({b[0]:.0f}, {b[1]:.0f})" for t, b in svolte))
        if usci == 0 and L > 20:
            g.append("non serve nessun uscio")
        P(f"   {nome:<22s} larga {w:4.1f}  lunga {L:5.0f} m  dislivello {dh:+5.1f}  max {pend * 100:3.0f}%  usci {usci:2d}" + ("  ⚠ " + "; ".join(g) if g else ""))
        if g:
            guai_vie.append((nome, line, g))
    # gli estremi dei selciati: dove un nastro finisce, ce n'è un altro sotto? con che angolo si incontrano?
    P("   giunzioni fra nastri di selciato (un nastro finisce dentro un altro: lì la texture si interrompe)")
    giunti = []
    for tipo, nome, w, line in VIE:
        if tipo != "selciato" or len(line) < 3:
            continue
        for end, nxt in ((line[0], line[1]), (line[-1], line[-2])):
            for t2, n2, w2, l2 in VIE:
                if l2 is line or len(l2) < 2 or pdist(end, l2) > w2 / 2:
                    continue
                k = min(range(len(l2) - 1), key=lambda i: seg(end, l2[i], l2[i + 1]))
                a1 = math.atan2(nxt[1] - end[1], nxt[0] - end[0]); a2 = math.atan2(l2[k + 1][1] - l2[k][1], l2[k + 1][0] - l2[k][0])
                ang = abs((math.degrees(a1 - a2) + 90) % 180 - 90)
                giunti.append((end, ang, nome, n2))
    P(f"   {len(giunti)} giunzioni, {sum(1 for g in giunti if g[1] > 50)} quasi ad angolo retto (nessun raccordo: due nastri sovrapposti)")
    # ── D. la rete ──
    P("\nD. LA RETE DEI PERCORSI")
    deg = {}
    for wk in PERCORSI:
        for i, p in enumerate(wk):
            k = (round(p[0], 1), round(p[1], 1)); deg[k] = deg.get(k, 0) + (1 if i in (0, len(wk) - 1) else 2)
    ciechi = [p for p, d in deg.items() if d == 1 and inside(p, WALLS) and not any(math.hypot(p[0] - e.uscio()[0], p[1] - e.uscio()[1]) < 9 for e in EDIFICI) and not any(math.hypot(p[0] - c[0], p[1] - c[1]) < 6 for c in CRIPTE)]
    nudi = 0.0
    for wk in PERCORSI:
        nudi += sum(1 for x, z, _ in passo(wk) if inside((x, z), WALLS) and via_vicina((x, z)) > 0.5)
    P(f"   {len(deg)} nodi, {len(ciechi)} vicoli ciechi dentro le mura senza un uscio a 9 m: " + ", ".join(f"({p[0]:.0f}, {p[1]:.0f})" for p in ciechi))
    P(f"   {nudi:.0f} m di percorso dentro le mura senza selciato, scala o ponte sotto")
    return m, bad, guai_vie, ciechi


# ── i disegni ──
try:
    FONT = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 13)
except OSError:
    FONT = ImageFont.load_default()


def mappa(G, nome, titolo, pianta=True, bad=(), ciechi=()):
    H = G.H
    gz, gx = np.gradient(H)
    sh = np.clip(0.62 + 0.9 * (-gx * 0.6 + gz * 0.6) / np.sqrt(1 + gx * gx + gz * gz), 0.15, 1.0)   # (luce da nord-ovest)
    rgb = np.stack([sh * 205, sh * 198, sh * 170], -1)
    rgb[G.slope > 0.6] = rgb[G.slope > 0.6] * 0.45 + np.array([200, 40, 30]) * 0.55
    rgb[(G.slope > 0.3) & (G.slope <= 0.6)] = rgb[(G.slope > 0.3) & (G.slope <= 0.6)] * 0.75 + np.array([220, 140, 40]) * 0.25
    lev = np.floor(H / 2)
    cur = np.zeros(H.shape, bool); cur[:, :-1] |= lev[:, :-1] != lev[:, 1:]; cur[:-1, :] |= lev[:-1, :] != lev[1:, :]
    rgb[cur] *= 0.72
    if pianta and RWS:   # (l'acqua del torrente: dalla mezzeria, non dalla quota)
        G.acqua = np.array([[any(seg((G.x0 + i, G.z0 + j), RIVER[k], RIVER[k + 1]) < max(RWS[k], RWS[k + 1]) / 2 for k in range(len(RIVER) - 1) if abs(RIVER[k][0] - G.x0 - i) < 90) for i in range(G.w)] for j in range(G.h)])
    rgb[getattr(G, "acqua", H < WATER)] = (45, 80, 115)
    im = Image.fromarray(rgb[::-1].astype(np.uint8)).resize((G.w * K, G.h * K), Image.NEAREST)
    d = ImageDraw.Draw(im)
    Q = lambda x, z: ((x - G.x0) * K, (G.h - 1 - (z - G.z0)) * K)
    if pianta:
        d.line([Q(*p) for p in WALLS + WALLS[:1]], fill=(120, 30, 20), width=3)
        for tipo, _, w, line in VIE:
            if len(line) > 1:
                d.line([Q(*p) for p in line], fill={"selciato": (150, 135, 110), "scala": (190, 60, 190), "ponte": (240, 240, 240)}[tipo], width=max(2, int(w * K)) if w < 12 else 3, joint="curve")
        for wk in PERCORSI:
            d.line([Q(*p) for p in wk], fill=(250, 230, 90), width=1)
        for e in EDIFICI:
            d.polygon([Q(*p) for p in e.angoli()], fill=(205, 60, 50) if e.guai else (95, 130, 95), outline=(0, 0, 0))
            d.line([Q(*e.uscio()), Q(*e.uscio(2.5))], fill=(255, 255, 255), width=2)   # (da che parte guarda)
        for e in bad:
            d.text(Q(e.x - 2.5, e.z + 2.5), str(e.i), font=FONT, fill=(255, 255, 255))
        for p in ciechi:
            x, y = Q(*p); d.line([x - 6, y - 6, x + 6, y + 6], fill=(255, 0, 0), width=3); d.line([x - 6, y + 6, x + 6, y - 6], fill=(255, 0, 0), width=3)
    d.rectangle([0, 0, im.width, 20], fill=(20, 20, 20))
    d.text((6, 3), titolo + "   ·   curve ogni 2 m, arancio oltre il 30%, rosso oltre il 60%; rosso = edificio con difetti (col suo #)", font=FONT, fill=(255, 255, 255))
    im.save(os.path.join(OUT, nome))


_cat, _gate, _font = next(e for e in EDIFICI if e.nome == "cattedrale"), T["gate"]["at"], next((c["at"] for c in T["children"] if c["prefab"] == "fontana"), (0, 0))
SEZIONI = [("ovest → est: porta, piazza, cattedrale, monte", [(_gate[0] - 22, _gate[1]), tuple(_gate), tuple(_font), (_cat.x, _cat.z), (_cat.x + 100, _cat.z)]), ("sud → nord, per la cattedrale", [(_cat.x, -125), (_cat.x, 135)])]


def sezioni(G, nome, titolo, edifici=True):
    S4, alto, base = 3, 100, -8   # 4 px per metro in tutti e due i versi: scala vera
    rows = []
    for tit, line in SEZIONI:
        S = passo(line, 0.25)
        im = Image.new("RGB", (int(S[-1][2] * S4) + 1, (alto - base) * S4 + 22), (232, 228, 215)); d = ImageDraw.Draw(im)
        Y = lambda y: 22 + (alto - y) * S4
        for x, z, s in S:
            g, px = G.at(x, z), s * S4
            if edifici:
                for e in EDIFICI:
                    if e.dentro(x, z):
                        d.line([px, Y(e.piano + e.alto), px, Y(e.piano)], fill=(150, 95, 70))
                        if g < e.piano - 0.05:   # (il vuoto sotto un edificio sospeso)
                            d.line([px, Y(e.piano), px, Y(g)], fill=(230, 40, 40))
            d.line([px, Y(g), px, Y(base)], fill=(96, 88, 70))
            if g < WATER:
                d.line([px, Y(WATER), px, Y(g)], fill=(60, 110, 160))
        for y in range(0, alto, 10):
            d.line([0, Y(y), im.width, Y(y)], fill=(180, 175, 160)); d.text((3, Y(y) - 14), f"{y} m", font=FONT, fill=(90, 90, 90))
        d.text((6, 3), f"{titolo} — {tit} (scala vera 1:1, {S[-1][2]:.0f} m)" + (" · rosso = vuoto sotto l'edificio" if edifici else ""), font=FONT, fill=(0, 0, 0))
        rows.append(im)
    out = Image.new("RGB", (max(r.width for r in rows), sum(r.height for r in rows)), (232, 228, 215))
    y = 0
    for r in rows:
        out.paste(r, (0, y)); y += r.height
    out.save(os.path.join(OUT, nome))


if __name__ == "__main__":
    G, R = leggi(), []
    m, bad, guai_vie, ciechi = analizza(G, R)
    mappa(G, "mappa.png", "La città com'è", bad=bad, ciechi=ciechi)
    sezioni(G, "sezioni.png", "Com'è")
    open(os.path.join(OUT, "rapporto.txt"), "w", encoding="utf8").write("\n".join(R) + "\n")
    print("\n".join(R)); print(f"\nscritto in {OUT}")
