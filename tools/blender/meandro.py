# ─────────────────────────────────────────────────────────────────────────────
# MEANDRO — porta nel gioco l'impianto F di citta.py ("il meandro"): il rilievo della città e la sua pianta.
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tools/blender/meandro.py -- <uscita.json>
#
# Gira in Blender perché usa lo stesso rumore (mathutils) e lo stesso piano dei render, quindi il terreno è quello delle tavole.
# Scrive:
#   public/data/rilievo.bin   il suolo della città (terrain.ts, `townGround`): Float32 x0, z0, w, h, poi Int16 in cm
#   <uscita.json>             la pianta da mettere nel file dei dati (la applica tools/editor/meandro.mjs)
# Coordinate della città: +x est, +z nord (nel piano di citta.py è y). Gli edifici sono a una volta e mezzo (`scale`).
# Ciò che abitanti e missioni nominano (posti di strada, id delle case) tiene il suo nome: i gruppi legati fra loro (la piazza
# col municipio e i banchi; la cattedrale col sagrato e il cimitero; la fucina; il pozzo) si spostano in blocco dalla pianta
# di prima, con le stesse distanze interne.
# ─────────────────────────────────────────────────────────────────────────────
import json, math, os, random, struct, sys

sys.path.insert(0, os.path.dirname(__file__))
import citta  # noqa: E402  (il piano F, il rumore, smooth, mix_terraces)
from citta import N, inside, pdist, seg, smooth, sstep  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS else os.path.join(ROOT, "meandro.json")
DB = json.load(open(os.path.join(ROOT, "public", "data", "db.json"), encoding="utf8"))
OLD = next(l for l in DB["locations"] if l["kind"] == "settlement")
OLD_AT = OLD["at"]

# ── dove sta la città nel mondo: la porta dove arriva la strada (x = 206), il resto verso est ──
GATE = (-128.0, 12.0)
CENTER = (206 - GATE[0], 10 - GATE[1])     # (334, −2)
HX, HZ = 145.0, 132.0                     # il rettangolo (mezzi lati) che contiene le mura
SCALE = 1.5

P = citta.plan_F()
WALLS = [tuple(map(float, p)) for p in citta.WALL_F]
# (il fiume entra un po' più a nord che nel piano: la grotta dei ratti, fuori dalla porta, resta sul suo crinale)
RIVER = smooth([(-180, 125), (-115, 78)] + P["rivers"][0][2:], 4)
RW = P["river_w"]


def bed(x, z):
    """Il suolo del piano F, con l'alveo (come build() di citta.py)."""
    zz = P["h"](x, z)
    g = pdist((x, z), RIVER)
    b = P["water"] - 2.5 + max(0.0, g - RW / 2) * 1.6
    return min(zz, b) if g < RW * 3 else zz


OFFSET = 5.0 - bed(*GATE)   # la porta alla quota della strada che arriva (il piano di prima: 5 m)
LEVEL = P["water"] + OFFSET  # l'acqua


def street(pts):
    """Una via: la curva per i punti di controllo, con un filo di storto (lo stesso di citta.py)."""
    # (i punti di controllo restano esatti: lì due vie si incontrano, e l'incrocio è lo stesso punto nelle due)
    return [(round(x, 2), round(z, 2)) if i % 4 == 0 or len(pts) < 3 else (round(x + N(x, z, 9, 13) * 1.2, 2), round(z + N(x, z, 9, 14) * 1.2, 2)) for i, (x, z) in enumerate(smooth(pts, 4))]


def rot(t):
    """Gli assi di un riferimento girato di t radianti (come Mason.in del gioco): x locale e z locale nel mondo."""
    return (math.cos(t), -math.sin(t)), (math.sin(t), math.cos(t))


def yaw_to(src, dst):
    """Lo yaw (gradi) che fa guardare il +Z locale da src verso dst."""
    return math.degrees(math.atan2(dst[0] - src[0], dst[1] - src[1]))


# ── i gruppi spostati in blocco ──
OLD_SPOTS = OLD["spots"]
OLD_KIDS = OLD["children"]


def move(c0, t0, c1, t1):
    """Porta un punto (e uno yaw) dal riferimento (c0, t0) della pianta di prima al riferimento (c1, t1) di questa."""
    (X0, Z0), (X1, Z1) = rot(math.radians(t0)), rot(math.radians(t1))

    def f(p, yaw=None):
        dx, dz = p[0] - c0[0], p[1] - c0[1]
        lx, lz = dx * X0[0] + dz * X0[1], dx * Z0[0] + dz * Z0[1]
        q = (round(c1[0] + lx * X1[0] + lz * Z1[0], 2), round(c1[1] + lx * X1[1] + lz * Z1[1], 2))
        return q if yaw is None else (q, round(((yaw + t1 - t0) + 540) % 360 - 180, 1))
    return f


PLAZA = (-60.0, 2.0)
plaza = move((0, 0), 0, PLAZA, 0)
CAT_OLD = next(c for c in OLD_KIDS if c["prefab"] == "cattedrale")
CAT = (64.0, 44.0)   # in cima al promontorio
CAT_YAW = round(yaw_to(CAT, GATE) + 14, 1)   # la facciata verso chi entra dalla porta, girata un poco: la si vede di tre quarti
church = move(CAT_OLD["at"], CAT_OLD["yaw"], CAT, CAT_YAW)
FORGE = (18.0, -76.0)
forge = move((-57, -12.3), 0, FORGE, 0)
WELL = (-12.0, 90.0)
well = move((-19.8, 35.4), 0, WELL, 0)
ORTO = (-44.0, 101.0)
orto = move((-62.1, 51), 0, ORTO, 0)

PLAZA_SPOTS = ["plazaW", "plazaN", "plazaS", "plazaE", "plazaNW", "plazaNE", "plazaSW", "plazaSE", "hall", "stall", "market", "market2", "fountain", "board", "bench0", "bench1", "lume.municipio"]
spots = {}
for k in PLAZA_SPOTS:
    s = OLD_SPOTS[k]; q, y = plaza(s["at"], s.get("yaw", 0)); spots[k] = {"at": list(q), "yaw": y}
for k in ["church", "church2", "lume.cattedrale", "yard"]:
    s = OLD_SPOTS[k]; q, y = church(s["at"], s.get("yaw", 0)); spots[k] = {"at": list(q), "yaw": y}
for k, f in (("forge", forge), ("well", well), ("well2", well), ("patch", orto)):
    s = OLD_SPOTS[k]; q, y = f(s["at"], s.get("yaw", 0)); spots[k] = {"at": list(q), "yaw": y}
spots["gate"] = {"at": [GATE[0] + 7.5, GATE[1] + 1.5], "yaw": -90}

# ── le vie (punti di controllo) ──
PW, PE = (PLAZA[0] - 18.75, PLAZA[1]), (PLAZA[0] + 18.75, PLAZA[1])          # dove la piazza si apre a ovest e a est
PARVIS = tuple(CAT[i] + rot(math.radians(CAT_YAW))[1][i] * 32 for i in (0, 1))  # il sagrato, davanti alla facciata
STREETS = {
    "maestra": [(-135, 12), GATE, (-110, 8), (-92, 4), PW],                                # dalla porta alla piazza
    "salita": [PE, (-30, 12), (-12, 24), (8, 30), (26, 38), (38, 50), (PARVIS[0], PARVIS[1])],  # dalla piazza al sagrato, serpeggiando
    "ponte_nord": [(26, 38), (30, 52)],                                                    # al ponte delle botteghe (che parte in alto)
    "ponte_sud": [(8, 30), (30, 14), (50, 4), (66, -2)],                                   # al ponte alto
    "palazzi": [(50, 4), (62, 24), (80, 30), (88, 42), (80, 60), (66, 68), (46, 64)],         # il giro dei palazzi, attorno alla cattedrale
    "vicolo_neck": [(-12, 24), (-16, 40), (-12, 54)],                                      # vicoli del collo
    "vicolo_piano": [(-108, -20), (-84, -22), (-62, -32)],
    "passerella": [(-30, 12), (-32, 30), (-30, 48)],                                       # alla passerella
    "borgo_nord": [(86, 102), (58, 110), (28, 114), (0, 106), (-26, 92), (-52, 92)],       # il borgo oltre l'ansa, a nord
    "passerella_nord": [(-28, 86), (-26, 92)],
    "borgo_sud": [(70, -56), (44, -62), (14, -62), (-14, -66), (-38, -72)],                # il borgo a sud-est
    "piano": [(-110, 8), (-108, -20), (-90, -44), (-70, -62)],                             # la riva bassa, verso sud
}
# i ponti: la mezzeria, dal capo su una sponda al capo sull'altra (quello alto fa una piccola svolta sopra l'acqua)
BRIDGES = [("ponte_nord", [(30, 52), (28, 114)]), ("ponte_sud", [(66, -2), (71, -28), (70, -56)]), ("passerella", [(-30, 48), (-28, 86)])]
LINES = {k: street(v) for k, v in STREETS.items()}
for k, l in LINES.items():   # nessuna via deve passare nell'acqua (i ponti sono a parte)
    wet = [p for p in l if pdist(p, RIVER) < RW / 2 + 1]
    if wet:
        print(f"! la via {k} tocca il fiume in {wet[:3]}")


# ── i profili delle vie: lisci lungo il percorso, piatti di traverso, uguali agli incroci; dove sono ripidi, scale ──
STEEP = 0.09          # oltre questa pendenza una via è una scalinata
PLAZA_LEVEL, CAT_LEVEL = bed(PLAZA[0], PLAZA[1] + 12), bed(*CAT)   # (le quote delle loro piazzole, più giù)


def arc(l):
    out = [0.0]
    for i in range(1, len(l)):
        out.append(out[-1] + math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]))
    return out


PROF = {}
for k, l in LINES.items():
    sl, raw = arc(l), [bed(*p) for p in l]
    PROF[k] = [sum(raw[j] * math.exp(-((sl[j] - sl[i]) / 6) ** 2) for j in range(len(l))) / sum(math.exp(-((sl[j] - sl[i]) / 6) ** 2) for j in range(len(l))) for i in range(len(l))]
J = {}
for k, l in LINES.items():
    for i in sorted(set(list(range(0, len(l), 4)) + [len(l) - 1])):
        J.setdefault(l[i], []).append(PROF[k][i])
J_ALL = dict(J)   # (punto → i profili che ci passano: più d'uno = un incrocio)
J = {q: sum(v) / len(v) for q, v in J.items()}
J[tuple(map(lambda v: round(v, 2), PW))] = J[tuple(map(lambda v: round(v, 2), PE))] = PLAZA_LEVEL   # (la piazza è spianata)
J[tuple(map(lambda v: round(v, 2), PARVIS))] = CAT_LEVEL
for k, l in LINES.items():   # la correzione ai punti di controllo, distribuita lungo il tratto fra l'uno e l'altro
    sl, H = arc(l), PROF[k]
    C = sorted(set(list(range(0, len(l), 4)) + [len(l) - 1]))
    d = {i: J[l[i]] - H[i] for i in C}
    for a, b in zip(C, C[1:]):
        for i in range(a, b + 1):
            t = (sl[i] - sl[a]) / max(sl[b] - sl[a], 1e-6)
            H[i] += d[a] + (d[b] - d[a]) * t
    PROF[k] = H


def simplify(pts, tol):
    """Douglas-Peucker: i punti che contano (le svolte, dove andranno i pianerottoli)."""
    if len(pts) < 3:
        return list(pts)
    (ax, az), (bx, bz) = pts[0], pts[-1]
    far, at = 0, 0
    for i in range(1, len(pts) - 1):
        dd = seg(pts[i], pts[0], pts[-1])
        if dd > far:
            far, at = dd, i
    if far < tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:at + 1], tol)[:-1] + simplify(pts[at:], tol)


STAIRS = []          # (via, da, a, punti): i tratti ripidi
for k, l in LINES.items():
    H, sl = PROF[k], arc(l)
    steep = [abs(H[i + 1] - H[i]) / max(sl[i + 1] - sl[i], 0.01) > STEEP for i in range(len(l) - 1)]
    i = 0
    while i < len(steep):
        if not steep[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(steep) and (steep[j + 1] or (j + 2 < len(steep) and steep[j + 2])):   # (un tratto piano di un pezzo non spezza la scala)
            j += 1
        if sl[j + 1] - sl[i] >= 4:
            # gli incroci dentro la scala restano punti (pianerottoli: senza parapetti, ci si stacca di lato)
            run, cuts = l[i:j + 2], [0]
            cuts += [m for m in range(1, len(run) - 1) if len(J_ALL.get(run[m], ())) > 1] + [len(run) - 1]
            pts = []
            for a, b in zip(cuts, cuts[1:]):
                pts += simplify(run[a:b + 1], 1.2)[:-1]
            STAIRS.append((k, i, j + 1, pts + [run[-1]]))
        i = j + 1
print("scale:", [(k, len(p), round(PROF[k][b] - PROF[k][a], 1)) for k, a, b, p in STAIRS])


def level_at(lname, i):
    """La quota della via a metà del suo tratto i."""
    return (PROF[lname][i] + PROF[lname][i + 1]) / 2


def quarter(x, z):
    if math.hypot(x - 62, z - 40) < 58:
        return "rich"
    return "poor" if z > 86 or z < -40 or x < -70 else "mid"


# ── gli edifici speciali, gli ingombri e le piazzole ──
taken = []   # (x, z, raggio)
pads = []    # (x, z, mezzo lato x, mezzo lato z, yaw in radianti, quota)
kids = []


def pad(x, z, hx, hz, yaw_deg, level=None):
    pads.append((x, z, hx, hz, math.radians(yaw_deg), bed(x, z) if level is None else level))


def child(**c):
    c.setdefault("variant", random.Random(len(kids) * 7919 + 17).randrange(1000000))
    kids.append(c)
    return c


child(id="cattedrale", prefab="cattedrale", at=list(CAT), yaw=CAT_YAW, interior="cattedrale", scale=SCALE)
pad(CAT[0], CAT[1], 19, 34, CAT_YAW)
taken.append((CAT[0], CAT[1], 30))
for c in OLD_KIDS:   # il resto del gruppo della cattedrale: la panca di pietra, il cimitero
    if c["prefab"] in ("panca.pietra", "lapidi"):
        q, y = church(c["at"], c.get("yaw", 0))
        child(**{**{k: v for k, v in c.items() if k not in ("at", "yaw", "variant")}, "at": list(q), "yaw": y})
        taken.append((q[0], q[1], 7 if c["prefab"] == "lapidi" else 2))
# la piazza: il municipio, la fontana, i banchi, le panchine, la bacheca, il carretto, come prima fra loro
for c in OLD_KIDS:
    if c["prefab"] in ("municipio", "fontana", "banco", "panchina", "bacheca", "carretto"):
        q, y = plaza(c["at"], c.get("yaw", 0))
        child(**{**{k: v for k, v in c.items() if k not in ("at", "yaw", "variant")}, "at": list(q), "yaw": y})
pad(PLAZA[0], PLAZA[1] + 12, 24, 34, 0)
taken.append((PLAZA[0], PLAZA[1] + 2, 24)); taken.append((PLAZA[0], PLAZA[1] + 32, 14))
for c in OLD_KIDS:
    if c["prefab"] == "fucina":
        child(**{**{k: v for k, v in c.items() if k not in ("at", "variant")}, "at": list(FORGE)})
    if c["prefab"] == "pozzo":
        child(**{**{k: v for k, v in c.items() if k not in ("at", "variant")}, "at": list(WELL)})
    if c["prefab"] == "orto":
        child(**{**{k: v for k, v in c.items() if k not in ("at", "variant")}, "at": list(ORTO)})
pad(FORGE[0], FORGE[1], 9, 8, 0); taken.append((FORGE[0], FORGE[1], 9))
pad(WELL[0], WELL[1], 6, 6, 0); taken.append((WELL[0], WELL[1], 6))
pad(ORTO[0] + 3.5, ORTO[1] + 1.5, 6, 4, 0); taken.append((ORTO[0] + 3.5, ORTO[1] + 1.5, 6))
THEATRE = (86.0, 13.0)   # sul fianco sud del promontorio, la facciata verso il ponte alto
THEATRE_YAW = round(yaw_to(THEATRE, (50, 4)), 1)
child(prefab="teatro", at=list(THEATRE), yaw=THEATRE_YAW, scale=0.8)
pad(THEATRE[0], THEATRE[1], 12, 21, THEATRE_YAW); taken.append((THEATRE[0], THEATRE[1], 19))
pad(GATE[0] + 6, GATE[1], 10, 12, 0)

# i ponti: un capo per sponda, alla quota della sponda (quota 0 = sul suolo)
for name, line in BRIDGES:   # (quello verso il borgo nord ha le botteghe; i capi stanno sul suolo delle sponde)
    child(prefab="ponte.botteghe" if name == "ponte_nord" else "ponte", line=[[q[0], 0, q[1]] for q in line])   # ([x, quota dal suolo, z])
    for a, b in zip(line, line[1:]):
        taken.append(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + 4))

# ── le case lungo le vie: prima quelle con un nome (hanno dentro qualcuno), poi le altre ──
NAMED = [c for c in OLD_KIDS if c["prefab"].startswith("casa.") and c.get("id")]
want = {"poor": [c for c in NAMED if c["prefab"] == "casa.povera"], "mid": [c for c in NAMED if c["prefab"] == "casa.graticcio"],
        "rich": [c for c in NAMED if c["prefab"] == "casa.ricca" and c.get("interior") != "locanda"]}
inn = next(c for c in NAMED if c.get("interior") == "locanda")
FILL = {"poor": ("casa.povera", (5.6, 6.6), (5.6, 6.4)), "mid": ("casa.graticcio", (6, 7.4), (7, 8)), "rich": ("casa.ricca", (8, 9.5), (8.5, 9.5))}
rnd = random.Random(11)
segs = [(l[i], l[i + 1]) for l in LINES.values() for i in range(len(l) - 1)]


def wall_dist(x, z):
    return min(seg((x, z), WALLS[i - 1], WALLS[i]) for i in range(len(WALLS)))


def clear(x, z, W, D, yaw, m=1.8):
    """Nessuna via passa dentro il rettangolo (W lungo la x locale, D lungo la z locale, girato di `yaw` gradi), allargato di m."""
    (X, Z) = rot(math.radians(yaw))
    for a, b in segs:
        if min(a[0], b[0]) - 30 > x or max(a[0], b[0]) + 30 < x or min(a[1], b[1]) - 30 > z or max(a[1], b[1]) + 30 < z:
            continue
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1])))
        for k in range(n + 1):
            px, pz = a[0] + (b[0] - a[0]) * k / n - x, a[1] + (b[1] - a[1]) * k / n - z
            if abs(px * X[0] + pz * X[1]) < W / 2 + m and abs(px * Z[0] + pz * Z[1]) < D / 2 + m:
                return False
    return True


def free(x, z, r):
    if not inside((x, z), WALLS) or wall_dist(x, z) < r + 1.5 or pdist((x, z), RIVER) < RW / 2 + r + 1:
        return False
    if any(seg((x, z), a, b) < r * 0.55 + 2.4 for a, b in segs if abs(a[0] - x) < 40 and abs(a[1] - z) < 40):
        return False
    return all(math.hypot(x - a, z - b) > r + rr for a, b, rr in taken)


fillers = 0
rects = []   # le case: centro, mezzi lati, yaw
placed = []  # le case messe lungo una via: (via, tratto, lato, x, z, W, D, yaw, quartiere): per festoni, panni, insegne


def reach(x, z):
    """Dal punto si va dritti al nodo di via più vicino (lì passa chi accende i lampioni) senza attraversare una casa."""
    vx, vz = min((p for l in LINES.values() for p in l), key=lambda p: math.hypot(p[0] - x, p[1] - z))
    n = max(1, int(math.hypot(vx - x, vz - z) * 2))
    return not any(in_rect(x + (vx - x) * k / n, z + (vz - z) * k / n, 1.5) for k in range(n + 1))


def in_rect(x, z, m):
    """(x, z) cade dentro una casa, allargata di m."""
    for cx, cz, hw, hd, yaw in rects:
        (X, Z) = rot(math.radians(yaw))
        dx, dz = x - cx, z - cz
        if abs(dx * X[0] + dz * X[1]) < hw + m and abs(dx * Z[0] + dz * Z[1]) < hd + m:
            return True
    return False


def put(src, x, z, yaw, size, prefab, level=None):
    global fillers
    W, D = size[0] * SCALE, size[1] * SCALE
    c = {"prefab": prefab, "at": [round(x, 2), round(z, 2)], "yaw": round(yaw, 1), "size": list(size), "scale": SCALE}
    if src:
        c = {**{k: v for k, v in src.items() if k not in ("at", "yaw", "variant")}, **{"at": c["at"], "yaw": c["yaw"]}}
    else:
        fillers += 1
    child(**c)
    taken.append((x, z, math.hypot(W, D) / 2 * 0.8))
    rects.append((x, z, W / 2, D / 2, yaw))
    pad(x, z, W / 2 + 0.6, D / 2 + 0.6, yaw, level)


def walk_streets(pick, cap):
    """Una passata lungo tutte le vie, ai due lati: `pick(quartiere)` dice che casa mettere (o None)."""
    for lname, line in LINES.items():
        for i in range(len(line) - 1):
            (ax, az), (bx, bz) = line[i], line[i + 1]
            L = math.hypot(bx - ax, bz - az)
            if L < 0.01:
                continue
            ux, uz = (bx - ax) / L, (bz - az) / L
            for sgn in (-1, 1):
                q = quarter((ax + bx) / 2, (az + bz) / 2)
                got = pick(q)
                if not got:
                    continue
                src, prefab, size = got
                W, D = size[0] * SCALE, size[1] * SCALE
                off = 3.2 + D / 2
                x, z = (ax + bx) / 2 - uz * off * sgn, (az + bz) / 2 + ux * off * sgn
                r = math.hypot(W, D) / 2 * 0.8
                yaw = yaw_to((x, z), ((ax + bx) / 2, (az + bz) / 2))
                if free(x, z, r) and clear(x, z, W, D, yaw):
                    put(src, x, z, yaw, size, prefab, level_at(lname, i) + 0.12)   # (la soglia appena sopra la via)
                    placed.append((lname, i, sgn, x, z, W, D, yaw, q))
                    if src:
                        for v in want.values():
                            if src in v:
                                v.remove(src)
                    if cap():
                        return


# ── la cripta: accanto al cimitero, girata a squadra, sulla griglia da un metro ──
crypt_old = next(l for l in DB["locations"] if l["kind"] == "crypt")
grave = next(c["at"] for c in kids if c["prefab"] == "lapidi")
LEN, DEPTH, ROOM = math.ceil(crypt_old["depth"] * 1.9), crypt_old["depth"], crypt_old["room"]
best, why = None, {}
for gx in range(-70, 71, 2):
    for gz in range(-70, 71, 2):
        x, z = CAT[0] + gx, CAT[1] + gz
        for yaw in (0, 90, 180, 270):
            dx, dz = round(math.sin(math.radians(yaw))), round(math.cos(math.radians(yaw)))
            far = LEN + ROOM[1]   # la rampa e la camera in fondo
            pts = [(x + dx * t + dz * s, z + dz * t - dx * s) for t in range(0, far + 1, 2) for s in (-ROOM[0] / 2, 0, ROOM[0] / 2)]
            if not all(inside(p, WALLS) and pdist(p, RIVER) > RW / 2 + 6 for p in pts):
                why["mura o fiume"] = why.get("mura o fiume", 0) + 1; continue
            if not all(all(math.hypot(p[0] - a, p[1] - b) > rr + 0.5 for a, b, rr in taken) for p in pts):
                why["occupato"] = why.get("occupato", 0) + 1; continue
            if not clear(x + dx * far / 2, z + dz * far / 2, ROOM[0] + 2, far, yaw, 1.0):
                why["via"] = why.get("via", 0) + 1; continue
            g0 = bed(x, z)
            if min(bed(*p) for p in pts[len(pts) // 2:]) < g0 - 0.6:   # (la camera ha bisogno di terra sopra: niente discese)
                why["discesa"] = why.get("discesa", 0) + 1; continue
            near = min(seg((x, z), a, b) for a, b in segs)
            if near > 40:
                why["lontano"] = why.get("lontano", 0) + 1; continue
            # (vicino al cimitero, e poco lontano da una via: un viottolo ci porta, se non passa per una casa)
            v = min((p for l in LINES.values() for p in l), key=lambda p: math.hypot(p[0] - x + dx * 3, p[1] - z + dz * 3))
            path = [(v[0] + (x - dx * 3 - v[0]) * k / 20, v[1] + (z - dz * 3 - v[1]) * k / 20) for k in range(21)]
            if any(in_rect(px, pz, 0.6) or pdist((px, pz), RIVER) < RW / 2 + 2 or any(math.hypot(px - a_, pz - b_) < rr_ + 1 for a_, b_, rr_ in taken) for px, pz in path):
                why["viottolo"] = why.get("viottolo", 0) + 1; continue
            score = math.hypot(x - grave[0], z - grave[1]) + near * 2
            if best is None or score < best[0]:
                best = (score, x, z, yaw, [list(v), [round(x - dx * 3, 2), round(z - dz * 3, 2)]])
if best is None:
    print("! cripta: nessun posto libero vicino al cimitero", why)
    best = (0, grave[0], grave[1] + 10, 0, None)
crypt = {"at": [round(CENTER[0] + best[1]), round(CENTER[1] + best[2])], "yaw": best[3]}
taken.append((best[1], best[2], 6))
CRYPT_WALK = best[4] or []

# la locanda: sulla via maestra, la prima che entra
placed_inn = []
def pick_inn(q):
    return None if placed_inn else (inn, inn["prefab"], inn["size"])
for line_name in ("maestra",):
    l = LINES[line_name]
    for i in range(len(l) - 1):
        if placed_inn:
            break
        (ax, az), (bx, bz) = l[i], l[i + 1]
        L = math.hypot(bx - ax, bz - az) or 1
        ux, uz = (bx - ax) / L, (bz - az) / L
        W, D = inn["size"][0] * SCALE, inn["size"][1] * SCALE
        for sgn in (1, -1):
            x, z = (ax + bx) / 2 - uz * (3.2 + D / 2) * sgn, (az + bz) / 2 + ux * (3.2 + D / 2) * sgn
            if free(x, z, math.hypot(W, D) / 2 * 0.8) and clear(x, z, W, D, yaw_to((x, z), ((ax + bx) / 2, (az + bz) / 2))):
                put(inn, x, z, yaw_to((x, z), ((ax + bx) / 2, (az + bz) / 2)), inn["size"], inn["prefab"], level_at("maestra", i) + 0.12); placed_inn.append(1); break
walk_streets(lambda q: (want[q][0], want[q][0]["prefab"], want[q][0]["size"]) if want[q] else None, lambda: not any(want.values()))
# chi è rimasto senza posto nel suo quartiere ne prende uno qualunque
for q in ("poor", "mid", "rich"):
    for src in list(want[q]):
        walk_streets(lambda _q, s=src: (s, s["prefab"], s["size"]) if s in want[q] else None, lambda: src not in want[q])
left = [c["id"] for v in want.values() for c in v]
if left or not placed_inn:
    print("! case senza posto:", left, "locanda" if not placed_inn else "")
MAX_FILL = int(ARGS[1]) if len(ARGS) > 1 else 75


def pick_fill(q):
    if fillers >= MAX_FILL:
        return None
    prefab, wr, dr = FILL[q]
    return (None, prefab, [round(rnd.uniform(*wr), 1), round(rnd.uniform(*dr), 1)])
walk_streets(pick_fill, lambda: fillers >= MAX_FILL)
# gli isolati: case dietro le case, girate verso la via più vicina (senza un nome: non ci si entra)
def nearest(x, z):
    a, b = min(segs, key=lambda s_: seg((x, z), *s_))
    L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
    t = max(0, min(1, ((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) / L / L))
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
for _ in range(6000):
    if fillers >= MAX_FILL:
        break
    x, z = rnd.uniform(-HX, HX), rnd.uniform(-HZ, HZ)
    if seg((x, z), *min(segs, key=lambda s_: seg((x, z), *s_))) > 25:   # (lontano da ogni via non ci si arriva)
        continue
    got = pick_fill(quarter(x, z))
    _, prefab, size = got
    r = math.hypot(size[0] * SCALE, size[1] * SCALE) / 2 * 0.8
    yaw = yaw_to((x, z), nearest(x, z))
    if free(x, z, r) and clear(x, z, size[0] * SCALE, size[1] * SCALE, yaw):
        put(None, x, z, yaw, size, prefab)

# ── gli addobbi ──
def front(x, z, W, D, yaw, along=0.0, out=0.05):
    """Un punto sulla facciata di una casa (+Z locale), spostato di `along` lungo di essa."""
    (X, Z) = rot(math.radians(yaw))
    return (x + Z[0] * (D / 2 + out) + X[0] * along, z + Z[1] * (D / 2 + out) + X[1] * along)


# stendardi, botti e casse della pianta di prima, coi loro gruppi: la piazza, la porta, la locanda, la cattedrale
OLD_GATE = (-OLD["ground"]["rect"][0], 0)
inn_new = next(c for c in kids if c.get("interior") == "locanda")
gate_f = move(OLD_GATE, -90, GATE, -90)
inn_f = move(inn["at"], inn["yaw"], inn_new["at"], inn_new["yaw"])
for c in OLD_KIDS:
    if c["prefab"] not in ("stendardo", "botte", "cassa"):
        continue
    x, z = c["at"]
    if math.hypot(x - CAT_OLD["at"][0], z - CAT_OLD["at"][1]) < 25:
        f = church
    elif abs(x) < 22 and -20 < z < 22:
        f = plaza
    elif math.hypot(x - inn["at"][0], z - inn["at"][1]) < 12:
        f = inn_f
    elif math.hypot(x - OLD_GATE[0], z - OLD_GATE[1]) < 14:
        f = gate_f
    else:
        continue
    q, y = f(c["at"], c.get("yaw", 0))
    if in_rect(q[0], q[1], 0.3) or any(seg(q, a, b) < 1.6 for a, b in segs):
        continue
    child(**{**{k: v for k, v in c.items() if k not in ("at", "yaw", "variant")}, "at": list(q), "yaw": y})
    taken.append((q[0], q[1], 0.6))

# festoni fra due facciate di fronte (vie di mezzo e dei ricchi), panni fra le case dei borghi; insegne sulle botteghe
TINTS = ["ocra", "vino", "muschio"]
nf = npanni = nins = 0
used = set()
for k, A in enumerate(placed):
    if A[2] != 1 or k in used:
        continue
    pa = front(*A[3:8])
    pair = None
    for j, B in enumerate(placed):
        if B[0] != A[0] or B[2] != -1 or abs(B[1] - A[1]) > 12 or j in used:
            continue
        pb = front(*B[3:8]); L = math.hypot(pb[0] - pa[0], pb[1] - pa[1])
        if 5 < L < 24 and (pair is None or L < pair[0]):
            pair = (L, j, pb)
    if not pair:
        continue
    L, j, pb = pair
    used.update((k, j))
    poor = A[8] == "poor" and placed[j][8] == "poor"
    if poor and npanni < 10:
        child(prefab="panni", **{"from": [round(pa[0], 2), 3.4, round(pa[1], 2)], "to": [round(pb[0], 2), 3.2, round(pb[1], 2)]}); npanni += 1
    elif not poor and nf < 14:
        child(prefab="festone", **{"from": [round(pa[0], 2), 5.4, round(pa[1], 2)], "to": [round(pb[0], 2), 5.2, round(pb[1], 2)]}); nf += 1
for k, (lname, i, sgn, x, z, W, D, yaw, q) in enumerate(placed):
    if lname in ("maestra", "salita", "palazzi", "borgo_nord") and q != "poor" and nins < 8:
        p_ = front(x, z, W, D, yaw, along=W * 0.32, out=0.0)
        child(prefab="insegna", at=[round(p_[0], 2), round(p_[1], 2)], yaw=round(yaw, 1), tint=TINTS[nins % 3]); nins += 1
print(f"addobbi: {nf} festoni, {npanni} panni, {nins} insegne")

# ── i lampioni lungo le vie, ogni 24 m circa, a lati alterni ──
lamps = []
# (dove un lampione è stato provato e il gioco ha detto che il suo posto è sbarrato: il controllo della rete, in main.ts)
NO_LAMP = [(28.09, 64.06)]
for name, l in LINES.items():
    run, side = 12.0, 1
    for i in range(len(l) - 1):
        (ax, az), (bx, bz) = l[i], l[i + 1]
        L = math.hypot(bx - ax, bz - az)
        if L < 0.01:
            continue
        run += L
        if run < 16:
            continue
        run, side = 0.0, -side
        ux, uz = (bx - ax) / L, (bz - az) / L
        ok = None
        for sd in (side, -side):
            if any(math.hypot(bx - uz * 3.4 * sd - qx, bz + ux * 3.4 * sd - qz) < 0.5 for qx, qz in NO_LAMP):
                continue   # (se da una parte non c'è posto, dall'altra)
            x, z = bx - uz * 3.4 * sd, bz + ux * 3.4 * sd
            if inside((x, z), WALLS) and pdist((x, z), RIVER) > RW / 2 + 2 and not any(math.hypot(x - a, z - b) < rr + 0.6 for a, b, rr in taken) and not in_rect(x, z, 4.0) and reach(x, z) and all(pdist((x, z), st[3]) > 3.0 for st in STAIRS) and all(math.hypot(x - c["at"][0], z - c["at"][1]) > 9 for c in kids if c.get("interior")):   # (il posto di Lumier si lega al nodo più vicino: non deve essere l'uscio di una casa)
                ok = (x, z); break
        if not ok:
            continue
        x, z = ok
        lamps.append((round(x, 2), round(z, 2)))
for x, z in lamps:
    child(prefab="lampione", at=[x, z], yaw=0)
    taken.append((x, z, 0.6))

# i posti delle vie: la via maestra, le due stradine dei borghi
def along(name, t):
    l = LINES[name]
    return list(l[min(len(l) - 1, int(t * (len(l) - 1)))])
spots["street"] = {"at": along("maestra", 0.55), "yaw": 90}
spots["laneN"] = {"at": along("borgo_nord", 0.45), "yaw": 0}
spots["laneS"] = {"at": along("borgo_sud", 0.5), "yaw": 180}

# ── i percorsi degli abitanti: le vie, la piazza (com'era), i ponti ──
walks = [[list(p) for p in l] for l in LINES.values()]
for w in OLD["walks"][1:3]:   # i due archi della piazza, dalla pianta di prima
    walks.append([list(plaza(p)) for p in w])
for _, line in BRIDGES:
    walks.append([list(q) for q in line])
# fuori dalla porta, lungo la strada, fino all'imbocco della grotta, in asse con la rampa (che scende verso est). ⚠️ Niente nodi
# sottoterra: un nodo non ha quota, e il gioco lo metterebbe sul terreno sopra la camera.
walks.append([[-135, 12], [-148, 48], [-162, 60], [-174, 64], [-172, 69.5], [-166, 69.5]])
if CRYPT_WALK:   # il viottolo della cripta, fino all'imbocco della rampa
    (_, cx_, cz_, cyaw, _) = best
    ddx, ddz = round(math.sin(math.radians(cyaw))), round(math.cos(math.radians(cyaw)))
    ex, ez = (round(cx_), math.floor(cz_) + 0.5) if ddx else (math.floor(cx_) + 0.5, round(cz_))   # (come pit() in terrain.ts)
    walks.append(CRYPT_WALK + [[ex, ez]])

# ── i selciati: la piazza (com'era), e un nastro per via secondo il quartiere ──
paving = []
for p in OLD["paving"]:
    if p["kind"] == "cubetti":
        paving.append({**p, "line": [list(plaza(q)) for q in p["line"]]})
KIND = {"poor": ("ciottoli", 4.6), "mid": ("lastre", 5.2), "rich": ("cubetti", 5.0)}   # (quasi da facciata a facciata: le case stanno a 3,2 m dalla mezzeria)
for name, l in LINES.items():
    q = quarter(*l[len(l) // 2])
    k, w = KIND[q]
    cut = sorted((a, b) for n_, a, b, _ in STAIRS if n_ == name)
    start = 0
    for a, b in cut + [(len(l) - 1, len(l) - 1)]:
        if a - start >= 1:
            paving.append({"kind": k, "width": w, "line": [list(p) for p in l[start:a + 1]]})
        start = b
for name, a, b, pts in STAIRS:   # fra le case senza parapetti (chiuderebbero gli usci), altrove coi parapetti
    flanked = sum(1 for p_ in placed if p_[0] == name and a <= p_[1] < b) / max(1, (b - a) / 3)
    # (né dove un'altra via le corre accanto: i parapetti la taglierebbero; ai capi, dove si incrociano, i parapetti non ci sono)
    beside = any(pdist(q, pts) < 3.5 and min(math.hypot(q[0] - pts[0][0], q[1] - pts[0][1]), math.hypot(q[0] - pts[-1][0], q[1] - pts[-1][1])) > 2.5
                 for k_, l_ in LINES.items() if k_ != name for q in l_)
    child(prefab="scala" if flanked >= 0.3 or beside else "scala.parapetto", line=[[round(x, 2), 0, round(z, 2)] for x, z in pts], size=[4.6, 0])

# ── il rilievo: il piano F con l'alveo, le piazzole spianate sotto gli edifici, alla quota della strada che arriva ──
M = 30
x0, z0 = CENTER[0] - HX - M, CENTER[1] - HZ - M
w, h = int(2 * (HX + M)) + 1, int(2 * (HZ + M)) + 1
BUCKET = {}   # i tratti di via per riquadri di 10 m (con la loro fascia), per non provarli tutti a ogni punto
for name, l in LINES.items():
    hw_ = KIND[quarter(*l[len(l) // 2])][1] / 2
    for i in range(len(l) - 1):
        a, b = l[i], l[i + 1]
        for bx_ in range(int(min(a[0], b[0]) // 10) - 1, int(max(a[0], b[0]) // 10) + 2):
            for bz_ in range(int(min(a[1], b[1]) // 10) - 1, int(max(a[1], b[1]) // 10) + 2):
                BUCKET.setdefault((bx_, bz_), []).append((a, b, PROF[name][i], PROF[name][i + 1], max(hw_, 2.3)))
grid, wgt = [], []
for j in range(h):
    for i in range(w):
        x, z = x0 + i - CENTER[0], z0 + j - CENTER[1]
        y = bed(x, z)
        for (px, pz, hx, hz, t, lv) in pads:
            if abs(x - px) > hx + hz + 6 or abs(z - pz) > hx + hz + 6:
                continue
            (X, Z) = rot(t)
            dx, dz = x - px, z - pz
            lx, lz = abs(dx * X[0] + dz * X[1]), abs(dx * Z[0] + dz * Z[1])
            out = math.hypot(max(0.0, lx - hx), max(0.0, lz - hz))
            k = (1 - sstep(0, 4, out)) * sstep(RW / 2 + 1, RW / 2 + 5, pdist((x, z), RIVER))   # (mai nell'alveo)
            y += (lv - y) * k
        # la via: la quota del suo profilo, piatta di traverso; sfuma in 4 m oltre il bordo (mai nell'alveo)
        best_ = None
        for (a, b, ha, hb, hw_) in BUCKET.get((int(x // 10), int(z // 10)), ()):
            dx, dz = b[0] - a[0], b[1] - a[1]
            t = max(0.0, min(1.0, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz + 1e-9)))
            dd = math.hypot(x - a[0] - dx * t, z - a[1] - dz * t)
            if best_ is None or dd - hw_ < best_[0] - best_[2]:
                best_ = (dd, ha + (hb - ha) * t, hw_)
        if best_:
            dd, hs, hw_ = best_
            k = (1 - sstep(hw_ + 0.8, hw_ + 4.5, dd)) * sstep(RW / 2, RW / 2 + 3, pdist((x, z), RIVER))
            y += (hs - y) * k
        grid.append(int(round((y + OFFSET) * 100)))
        # quanto vale il rilievo rispetto al terreno di prima: tutto dentro le mura e lungo il fiume, poi sfuma (a 30 m non c'è più)
        out = 0.0 if inside((x, z), WALLS) else wall_dist(x, z)
        wgt.append(int(round(255 * max(1 - sstep(8, 30, out), 1 - sstep(RW / 2 + 14, RW / 2 + 30, pdist((x, z), RIVER))))))
with open(os.path.join(ROOT, "public", "data", "rilievo.bin"), "wb") as f:
    f.write(struct.pack("<4f", x0, z0, w, h))
    f.write(struct.pack(f"<{len(grid)}h", *grid))
    f.write(bytes(wgt))

# ── il giro di Lumier: dal più vicino al più vicino, partendo da casa sua ──
home = next(c for c in kids if c.get("id") == "casa08")["at"]
todo = {f"lampione.{i}": tuple(p) for i, p in enumerate(lamps)}
todo["lume.municipio"] = tuple(spots["lume.municipio"]["at"]); todo["lume.cattedrale"] = tuple(spots["lume.cattedrale"]["at"])
tour, at = [], tuple(home)
while todo:
    k = min(todo, key=lambda n: math.hypot(todo[n][0] - at[0], todo[n][1] - at[1]))
    tour.append(k); at = todo.pop(k)

json.dump({
    "town": {"at": list(CENTER), "ground": {"rect": [HX, HZ], "level": 5}, "gate": {**OLD["gate"], "at": list(GATE), "yaw": -90},
             "walls": [list(p) for p in WALLS], "river": {"line": [[round(x, 2), round(z, 2)] for x, z in RIVER], "width": RW, "level": round(LEVEL, 2)},
             "children": kids, "spots": spots, "walks": walks, "paving": paving, "green": []},
    "crypt": crypt, "lumier": tour, "bridges": BRIDGES, "pads": pads, "offset": OFFSET,
}, open(OUT, "w", encoding="utf8"), ensure_ascii=False)
print(f"MEANDRO: {len(kids)} elementi, {sum(1 for c in kids if c['prefab'].startswith('casa.'))} case ({fillers} senza nome), {len(lamps)} lampioni, rilievo {w}×{h}, offset {OFFSET:.2f}, acqua {LEVEL:.2f}, cripta {crypt}")
