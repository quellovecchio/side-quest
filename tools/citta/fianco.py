# ─────────────────────────────────────────────────────────────────────────────
# FIANCO — la città sul fianco del monte (ADR 0015): il rilievo e la pianta, senza Blender.
#
#   python tools/citta/fianco.py <uscita.json>      poi:  node tools/editor/meandro.mjs <uscita.json>
#                                                    e:    python tools/analisi/citta.py   (deve uscire pulita)
#
# L'idea: IL TERRENO NASCE DALLE VIE. Ogni nodo della rete ha una quota decisa a mano (le vie carrabili salgono al 10% di
# sbieco sul versante, la cordonata va dritta dal ponte al sagrato); piazze, edifici e il letto del torrente sono altri
# vincoli; fra un vincolo e l'altro il suolo è l'interpolazione più liscia possibile (armonica), e lontano dalla città torna
# la forma di base (piana, versante, spalla, monte). Così nessuna via è in trincea e nessun edificio è su un tappo.
# Le case stanno solo in schiera lungo le vie, con l'uscio sul selciato; un lotto si scarta se tocca qualcosa (rettangoli veri)
# o se il suolo sotto varia troppo.
# Scrive public/data/rilievo.bin (terrain.ts) e <uscita.json> (la stessa forma che scriveva tools/blender/meandro.py).
# Ciò che abitanti e missioni nominano tiene il suo nome: i gruppi legati fra loro (municipio e piazza, cattedrale e cimitero,
# fucina, pozzo, orto) si spostano in blocco da dove sono OGGI nel file, quindi lo script si può rilanciare.
# Coordinate: quelle della città (+x est, +z nord); la porta resta dov'è (la strada del bosco arriva lì).
# ─────────────────────────────────────────────────────────────────────────────
import json, math, os, random, struct, sys
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "fianco.json")
MAX_HOUSES = int(sys.argv[2]) if len(sys.argv) > 2 else 92
DB = json.load(open(os.path.join(ROOT, "public", "data", "db.json"), encoding="utf8"))
OLD = next(l for l in DB["locations"] if l["kind"] == "settlement")
OLD_KIDS, OLD_SPOTS = OLD["children"], OLD["spots"]
CENTER = tuple(OLD["at"])
GATE = (-128.0, 12.0)
HX, HZ, SCALE = 155.0, 132.0, 1.5
X0, X1, Z0, Z1 = -175, 226, -162, 162      # la griglia del rilievo (il terreno del gioco finisce a x = 226)
GW, GH = X1 - X0 + 1, Z1 - Z0 + 1

# ── geometria ──
def sstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


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


def smooth(line, k=4):
    """Catmull-Rom: la curva che passa per i punti di controllo (che restano esatti, ogni k)."""
    if len(line) < 3:
        return list(line)
    P_ = [line[0]] + list(line) + [line[-1]]
    out = []
    for i in range(1, len(P_) - 2):
        p0, p1, p2, p3 = P_[i - 1], P_[i], P_[i + 1], P_[i + 2]
        for j in range(k):
            t = j / k
            out.append(tuple(0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t * t + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t ** 3) for c in (0, 1)))
    out.append(line[-1])
    return out


def rot(deg):
    t = math.radians(deg)
    return (math.cos(t), -math.sin(t)), (math.sin(t), math.cos(t))   # (x locale e z locale nel mondo, come Mason.in)


def yaw_to(src, dst):
    return math.degrees(math.atan2(dst[0] - src[0], dst[1] - src[1]))


def move(c0, t0, c1, t1):
    """Porta un punto (e uno yaw) dal riferimento (c0, t0) a (c1, t1)."""
    (A0, B0), (A1, B1) = rot(t0), rot(t1)

    def f(p, yaw=None):
        dx, dz = p[0] - c0[0], p[1] - c0[1]
        lx, lz = dx * A0[0] + dz * A0[1], dx * B0[0] + dz * B0[1]
        q = (round(c1[0] + lx * A1[0] + lz * B1[0], 2), round(c1[1] + lx * A1[1] + lz * B1[1], 2))
        return q if yaw is None else (q, round(((yaw + t1 - t0) + 540) % 360 - 180, 1))
    return f


class Rect:
    """Un rettangolo girato: centro, mezzi lati (x e z locali), yaw in gradi."""
    def __init__(s, x, z, hw, hd, yaw=0.0):
        s.x, s.z, s.hw, s.hd, s.yaw = x, z, hw, hd, yaw
        s.X, s.Z = rot(yaw)

    def world(s, lx, lz):
        return (s.x + s.X[0] * lx + s.Z[0] * lz, s.z + s.X[1] * lx + s.Z[1] * lz)

    def corners(s, m=0.0):
        return [s.world(a * (s.hw + m), b * (s.hd + m)) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]

    def has(s, p, m=0.0):
        dx, dz = p[0] - s.x, p[1] - s.z
        return abs(dx * s.X[0] + dz * s.X[1]) < s.hw + m and abs(dx * s.Z[0] + dz * s.Z[1]) < s.hd + m

    def hits(s, o, m=0.0):
        """Assi separatori: i due rettangoli (allargati di m in tutto) si toccano."""
        if math.hypot(s.x - o.x, s.z - o.z) > math.hypot(s.hw, s.hd) + math.hypot(o.hw, o.hd) + m:
            return False
        A, B = s.corners(m), o.corners()
        for ax in (s.X, s.Z, o.X, o.Z):
            pa, pb = [p[0] * ax[0] + p[1] * ax[1] for p in A], [p[0] * ax[0] + p[1] * ax[1] for p in B]
            if min(max(pa), max(pb)) - max(min(pa), min(pb)) <= 0:
                return False
        return True

    def points(s, d=1.5):
        nx, nz = max(2, int(2 * s.hw / d) + 1), max(2, int(2 * s.hd / d) + 1)
        return [s.world(-s.hw + 2 * s.hw * a / (nx - 1), -s.hd + 2 * s.hd * b / (nz - 1)) for a in range(nx) for b in range(nz)]


# ── la rete: i nodi (x, z, quota) e le vie ──
PLAZA = (-68.0, 4.0)                       # la fontana, al centro della piazza del mercato
CAT, CAT_YAW = (113.0, 12.0), -90.0        # la cattedrale sulla spalla, la facciata a ovest: in asse con la cordonata e la porta
THEATRE, THEATRE_YAW = (100.0, -48.0), -90.0
ND = {
    "out": (-135, 12, 5.0), "gate": (-128, 12, 5.0), "m1": (-112, 9, 5.0), "m2": (-98, 5, 5.0),
    "PW": (PLAZA[0] - 18.75, PLAZA[1], 5.0), "PE": (PLAZA[0] + 18.75, PLAZA[1], 5.0),
    "b0": (-46.5, 4.2, 5.0), "b1": (-19, 7, 6.3), "pp": (-9, 8, 6.6),
    "c1": (20, 9, 12.6), "c2": (46, 10.5, 18.0), "sagW": (65, 12, 22.0), "sagC": (80, 12, 22.0), "sagS": (80, -3, 22.0), "sagN": (80, 27, 22.0),
    "n1": (0, -24, 9.3), "n2": (16, -52, 12.2), "n3": (40, -68, 15.0), "n4": (62, -66, 17.3), "ptW": (64, -50, 19.2), "pt": (76, -48, 19.5), "n5": (80, -26, 20.8),
    "u1": (-4, 30, 9.2), "u2": (14, 44, 11.8), "u3": (38, 50, 14.6), "u4": (62, 54, 17.4), "u5": (84, 48, 19.9),
    "k1": (18, -22, 12.4), "k2": (16, 28, 12.2), "h1": (44, -36, 17.0), "h2": (42, 32, 16.4),
    "r1": (98, 35, 22.0), "r2": (124, 35, 22.0), "r3": (141, 30, 22.0), "r4": (142, -6, 22.0), "q1": (102, -31, 21.3), "q2": (126, -29, 21.7),
    "o0": (-22, 84, 6.2), "o1": (6, 90, 9.0), "o2": (34, 96, 12.0), "o3": (62, 102, 15.2), "o4": (90, 106, 18.4), "o5": (106, 105, 20.2),
    "a1": (36, 62, 13.8), "a2": (33, 84, 12.6), "e1": (86, 70, 19.4), "e2": (83, 96, 18.6),
    "w1": (-110, 36, 5.2), "w2": (-94, 58, 5.3), "w2b": (-70, 66, 5.4), "w3": (-45, 74, 5.6), "v1": (-40, 50, 5.4), "v2": (-43, 26, 5.2), "x1": (-92, 30, 5.1),
    "s1": (-113, -16, 5.1), "s2": (-102, -42, 5.2), "s3": (-82, -60, 5.3), "s4": (-64, -68, 5.3), "s5": (-54, -48, 5.3), "s6": (-50, -24, 5.2),
    "t1": (-92, -24, 5.1), "t2": (-72, -30, 5.2), "sb0": (-46, -26, 5.2), "sb1": (-24, -27, 5.8), "eb1": (-16, -10, 6.2), "eb2": (-18, -52, 6.4),
}
def Q(y):
    """Le quote sopra la piazzetta del ponte, ristrette: la spalla sta a 20,5 m invece di 22 (le carrabili restano sul 10%)."""
    return y if y <= 6.6 else round(6.6 + (y - 6.6) * 13.9 / 15.4, 2)


ND = {k: (x, z, Q(y)) for k, (x, z, y) in ND.items()}
TOP = Q(22.0)
# (nome, nodi, larghezza del selciato, tipo: "via" | "scala", lampioni)   — nell'ordine in cui si riempiono di case
STREETS = [
    ("maestra", ["out", "gate", "m1", "m2", "PW"], 6.0, "via", True),               # dalla porta alla piazza
    ("ponte_est", ["b1", "pp"], 6.0, "via", True),                                  # dal ponte delle botteghe alla piazzetta
    ("cordonata", ["pp", "c1", "c2", "sagW"], 6.0, "scala", False),                 # dritta dal ponte al sagrato: l'asse della città
    ("mulini", ["pp", "u1", "u2", "u3", "u4", "u5", "sagN"], 5.0, "via", True),     # la carrabile di nord, lungo il torrente
    ("nuova", ["pp", "n1", "n2", "n3", "n4", "ptW", "pt", "n5", "sagS"], 5.0, "via", True),   # la carrabile di sud, per la piazza del teatro
    ("mezzo", ["n2", "k1", "c1", "k2", "u2"], 4.6, "via", False),                   # le due vie in piano sul versante
    ("alta", ["n3", "h1", "c2", "h2", "u3"], 4.6, "via", False),
    ("canonici", ["sagN", "r1", "r2", "r3", "r4", "q2"], 4.6, "via", True),         # il giro dietro l'abside
    ("camposanto", ["n5", "q1", "q2"], 4.6, "via", False),
    ("lungofiume", ["PE", "v2", "v1", "w3"], 4.6, "via", True),
    ("municipio", ["PW", "x1", "w2"], 4.6, "via", False),
    ("mercato", ["PE", "s6"], 4.6, "via", False),
    ("borgo_nord", ["m1", "w1", "w2", "w2b", "w3", "o0"], 4.6, "via", True),
    ("oltretorrente", ["o0", "o1", "o2", "o3", "o4"], 4.6, "via", True),
    ("ponticello_a", ["u3", "a1"], 4.0, "via", False), ("ponticello_a2", ["a2", "o2"], 4.0, "via", False),
    ("ponticello_b", ["u5", "e1"], 4.0, "via", False), ("ponticello_b2", ["e2", "o4"], 4.0, "via", False),
    ("piano", ["m1", "s1", "s2", "s3", "s4", "s5", "s6"], 4.6, "via", True),
    ("vicolo", ["s1", "t1", "t2", "s6"], 4.0, "via", False),
    ("ponte_sud", ["s6", "sb0"], 4.0, "via", False),
    ("riva", ["pp", "eb1", "sb1", "eb2"], 4.6, "via", True),
    ("scalette", ["eb2", "n2"], 4.0, "scala", False),
]
PASSI = [["sagS", "sagC", "sagN"], ["sagW", "sagC"]]   # (si cammina, ma è piazza: niente nastro né case)
BRIDGES = [("ponte.botteghe", ["b0", "b1"]), ("ponte", ["a1", "a2"]), ("ponte", ["e1", "e2"]), ("ponte", ["sb0", "sb1"])]
# il torrente: (x, z, quota dell'acqua, larghezza). Due punti alla stessa quota = una vasca; un salto in pochi metri = una cascatella
TORRENT = [(232, 118, 96, 7), (200, 108, 64, 7), (160, 97.5, 30, 7), (155, 96.5, 21.8, 7), (128, 92, 21.8, 7), (125, 91.5, 18.6, 7), (98, 86, 18.6, 7),
           (95, 85.5, 15.4, 7), (70, 80, 15.4, 7), (67, 79.5, 12.0, 7), (42, 74, 12.0, 7), (39, 73.5, 8.6, 7), (14, 68, 8.6, 7), (11, 67.2, 5.2, 7),
           (-8, 60, 5.2, 8), (-11, 58, 2.8, 10), (-28, 36, 2.8, 14), (-33, 10, 2.8, 14), (-35, -14, 2.8, 14), (-40, -45, 2.8, 14), (-58, -100, 2.8, 14), (-80, -180, 2.8, 14)]
TORRENT = [(x, z, Q(l) if l < 25 else l, w) for x, z, l, w in TORRENT]
RIVER = [(p[0], p[1]) for p in TORRENT]
WALLS = [(-126, -12), (-130, 36), (-122, 66), (-98, 88), (-60, 98), (-28, 108), (10, 116), (50, 122), (92, 124), (124, 118), (150, 108), (153, 60), (155, 20),
         (152, -30), (140, -66), (110, -84), (70, -92), (30, -98), (-10, -94), (-40, -86), (-72, -90), (-108, -68), (-124, -38)]


def river_at(p):
    """Il punto del torrente più vicino: (distanza dalla mezzeria, quota dell'acqua, larghezza)."""
    best = (1e9, 0, 0)
    for a, b in zip(TORRENT, TORRENT[1:]):
        dx, dz = b[0] - a[0], b[1] - a[1]
        t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)))
        d = math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t)
        if d < best[0]:
            best = (d, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t)
    return best


def bank(p):
    """Distanza dalla riva (negativa nell'acqua)."""
    d, _, w = river_at(p)
    return d - w / 2


def wall_dist(p):
    return min(seg(p, WALLS[i - 1], WALLS[i]) for i in range(len(WALLS)))


class Street:
    def __init__(s, name, nodes, width, kind, lamps):
        s.name, s.nodes, s.w, s.kind, s.lamps = name, nodes, width, kind, lamps
        ctl = [ND[n] for n in nodes]
        if kind == "scala" or len(ctl) < 3:
            s.pts = [(round(c[0], 2), round(c[1], 2), c[2]) for c in ctl]
        else:
            xz = [(round(x, 2), round(z, 2)) for x, z in smooth([(c[0], c[1]) for c in ctl], 4)]
            s.pts = []
            for i in range(len(ctl) - 1):   # la quota sale in proporzione alla strada fatta fra un nodo e l'altro
                part = xz[i * 4:i * 4 + 5]; run = [0.0]
                for a, b in zip(part, part[1:]):
                    run.append(run[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
                s.pts += [(q[0], q[1], ctl[i][2] + (ctl[i + 1][2] - ctl[i][2]) * run[k] / run[-1]) for k, q in enumerate(part[:4])]
            s.pts.append((xz[-1][0], xz[-1][1], ctl[-1][2]))
        s.line = [(p[0], p[1]) for p in s.pts]
        s.S = [0.0]
        for a, b in zip(s.line, s.line[1:]):
            s.S.append(s.S[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        s.L = s.S[-1]

    def at(s, d):
        """Il punto a d metri dall'inizio: (x, z, quota, tangente x, tangente z)."""
        d = max(0.0, min(s.L, d))
        i = max(0, min(len(s.S) - 2, next((k for k in range(len(s.S) - 1) if s.S[k + 1] >= d), len(s.S) - 2)))
        a, b = s.pts[i], s.pts[i + 1]; l = s.S[i + 1] - s.S[i] or 1; t = (d - s.S[i]) / l
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, (b[0] - a[0]) / l, (b[1] - a[1]) / l)


VIE = [Street(*s) for s in STREETS]
BY = {s.name: s for s in VIE}
for s in VIE:   # il controllo delle pendenze: una via oltre il 13% è un errore di disegno, non una scala da aggiungere
    g = max(abs(b[2] - a[2]) / max(math.hypot(b[0] - a[0], b[1] - a[1]), 0.01) for a, b in zip(s.pts, s.pts[1:]))
    if (s.kind == "via" and g > 0.135) or bank(min(s.line, key=bank)) < 1.5:
        print(f"! la via {s.name}: pendenza {g * 100:.0f}%, riva a {bank(min(s.line, key=bank)):.1f} m")


def street_edge(p, skip=None):
    """Distanza dal bordo della via più vicina (negativa = sul selciato)."""
    return min(pdist(p, s.line) - s.w / 2 for s in VIE if s is not skip)


# ── la forma di base: la piana, il versante, la spalla, il monte (vale lontano dalla città, e come punto di partenza) ──
def vnoise(X, Z, s, k=0.0):
    """Rumore a valori su reticolo, liscio, in −1…1 (numpy; basta per un terreno)."""
    x, z = np.asarray(X, float) / s + k * 17.13, np.asarray(Z, float) / s - k * 9.71
    xi, zi = np.floor(x), np.floor(z); fx, fz = x - xi, z - zi
    h = lambda a, b: np.modf(np.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453)[0]
    ux, uz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
    return ((h(xi, zi) * (1 - ux) + h(xi + 1, zi) * ux) * (1 - uz) + (h(xi, zi + 1) * (1 - ux) + h(xi + 1, zi + 1) * ux) * uz)


def base(X, Z):
    X, Z = np.asarray(X, float), np.asarray(Z, float)
    xs = X + 7 * vnoise(Z, Z * 0, 80, 1)
    t = np.clip((xs + 18) / 86, 0, 1)
    hill = 5.2 + 15.3 * (0.5 * t + 0.5 * t * t * (3 - 2 * t))                      # il versante: da 5 m a 22 in 86 m
    m = np.clip((X - 151 - 7 * vnoise(Z, Z * 0, 60, 2)) / 80, 0, 1)
    ridge = 1 - np.abs(vnoise(X, Z, 38, 3))
    mount = 62 * m ** 1.12 * (0.82 + 0.3 * ridge) + 5 * vnoise(X, Z, 17, 4) * m       # il monte, dietro la spalla
    return hill + mount + 0.35 * vnoise(X, Z, 30, 5) + 0.12 * vnoise(X, Z, 9, 6)


GX, GZ = np.meshgrid(np.arange(X0, X1 + 1), np.arange(Z0, Z1 + 1))
BASE = base(GX, GZ)


def relief(pads):
    """Il suolo: i vincoli (piazzole, vie, letto del torrente) e fra loro l'interpolazione armonica; lontano, la forma di base."""
    V, F, D = BASE.copy(), np.zeros((GH, GW), bool), np.full((GH, GW), 1e9)
    # le piazzole: piatte sotto l'ingombro e 1,2 m attorno (chi legge fra quattro punti della griglia non deve uscirne); poi
    # di nuovo il solo ingombro, perché fra due case vicine a quote diverse ognuna tenga la sua sotto di sé
    for margin in (1.2, 0.45):
        for r, level in pads:
            dx, dz = GX - r.x, GZ - r.z
            m = (np.abs(dx * r.X[0] + dz * r.X[1]) < r.hw + margin) & (np.abs(dx * r.Z[0] + dz * r.Z[1]) < r.hd + margin)
            V[m], F[m] = level, True
    for s in VIE:           # le vie: la quota del profilo, piatte di traverso
        R = s.w / 2 + 0.8
        for a, b in zip(s.pts, s.pts[1:]):
            i0, i1 = max(0, int(min(a[0], b[0]) - R) - X0), min(GW, int(max(a[0], b[0]) + R) - X0 + 2)
            j0, j1 = max(0, int(min(a[1], b[1]) - R) - Z0), min(GH, int(max(a[1], b[1]) + R) - Z0 + 2)
            x, z = GX[j0:j1, i0:i1], GZ[j0:j1, i0:i1]
            dx, dz = b[0] - a[0], b[1] - a[1]
            t = np.clip(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz + 1e-9), 0, 1)
            d = np.hypot(x - a[0] - dx * t, z - a[1] - dz * t)
            m = (d < R) & (d < D[j0:j1, i0:i1])
            V[j0:j1, i0:i1][m] = (a[2] + (b[2] - a[2]) * t)[m]; D[j0:j1, i0:i1][m] = d[m]; F[j0:j1, i0:i1][m] = True
    RD, RL, RW = np.full((GH, GW), 1e9), np.zeros((GH, GW)), np.zeros((GH, GW))   # il torrente: distanza, quota, larghezza
    for a, b in zip(TORRENT, TORRENT[1:]):
        dx, dz = b[0] - a[0], b[1] - a[1]
        t = np.clip(((GX - a[0]) * dx + (GZ - a[1]) * dz) / (dx * dx + dz * dz), 0, 1)
        d = np.hypot(GX - a[0] - dx * t, GZ - a[1] - dz * t)
        m = d < RD
        RD[m], RL[m], RW[m] = d[m], (a[2] + (b[2] - a[2]) * t)[m], (a[3] + (b[3] - a[3]) * t)[m]
    bed = RD <= RW / 2
    V[bed], F[bed] = RL[bed] - 1.2, True
    # lontano da ogni vincolo (35 m) vale la forma di base
    near = F.copy()
    for _ in range(35):
        n = near.copy(); n[1:] |= near[:-1]; n[:-1] |= near[1:]; n[:, 1:] |= near[:, :-1]; n[:, :-1] |= near[:, 1:]; near = n
    F |= ~near
    F[0], F[-1], F[:, 0], F[:, -1] = True, True, True, True
    H = V.copy()
    for _ in range(4000):
        H[1:-1, 1:-1] = 0.25 * (H[:-2, 1:-1] + H[2:, 1:-1] + H[1:-1, :-2] + H[1:-1, 2:])
        H[F] = V[F]
    # le sponde: a un passo dall'acqua il suolo sta almeno 70 cm sopra (il nastro d'acqua del gioco è più largo dell'alveo)
    ring = (RD > RW / 2 + 1.2) & (RD < RW / 2 + 4.5)
    H[ring] = np.maximum(H[ring], RL[ring] + 0.7)
    return H


def ground(H, p):
    fx, fz = min(max(p[0] - X0, 0), GW - 1.001), min(max(p[1] - Z0, 0), GH - 1.001)
    i, j = int(fx), int(fz); a, b = fx - i, fz - j
    return (H[j, i] * (1 - a) + H[j, i + 1] * a) * (1 - b) + (H[j + 1, i] * (1 - a) + H[j + 1, i + 1] * a) * b


# ── gli edifici speciali, i gruppi spostati in blocco, gli ingombri ──
kids, pads, blocks = [], [], []     # elementi del file; (Rect, quota) da spianare; Rect dove non si costruisce


def child(**c):
    c.setdefault("variant", random.Random(len(kids) * 7919 + 17).randrange(1000000))
    kids.append(c)
    return c


def old(prefab):
    return next(c for c in OLD_KIDS if c["prefab"] == prefab)


def keep(c, at, yaw=None):
    out = {k: v for k, v in c.items() if k not in ("at", "yaw")}
    out["at"] = [round(at[0], 2), round(at[1], 2)]
    if yaw is not None or "yaw" in c:
        out["yaw"] = c.get("yaw", 0) if yaw is None else yaw
    return child(**out)


spots = {}
MUN_OLD, CAT_OLD, FORGE_OLD, WELL_OLD, ORTO_OLD, FOUNT_OLD = old("municipio"), old("cattedrale"), old("fucina"), old("pozzo"), old("orto"), old("fontana")
plaza = move(FOUNT_OLD["at"], 0, PLAZA, 0)
church = move(CAT_OLD["at"], CAT_OLD["yaw"], CAT, CAT_YAW)
FORGE, WELL, ORTO = (-76.0, -37.6), (-80.0, 48.0), (-101.0, 76.0)
forge, well, orto = move(FORGE_OLD["at"], 0, FORGE, 0), move(WELL_OLD["at"], 0, WELL, 0), move(ORTO_OLD["at"], 0, ORTO, 0)
for k in ["plazaW", "plazaN", "plazaS", "plazaE", "plazaNW", "plazaNE", "plazaSW", "plazaSE", "hall", "stall", "market", "market2", "fountain", "board", "bench0", "bench1", "lume.municipio"]:
    q, y = plaza(OLD_SPOTS[k]["at"], OLD_SPOTS[k].get("yaw", 0)); spots[k] = {"at": list(q), "yaw": y}
for k in ["church", "church2", "lume.cattedrale", "yard"]:
    q, y = church(OLD_SPOTS[k]["at"], OLD_SPOTS[k].get("yaw", 0)); spots[k] = {"at": list(q), "yaw": y}
for k, f in (("forge", forge), ("well", well), ("well2", well), ("patch", orto)):
    q, y = f(OLD_SPOTS[k]["at"], OLD_SPOTS[k].get("yaw", 0)); spots[k] = {"at": list(q), "yaw": y}
spots["gate"] = {"at": [GATE[0] + 7.5, GATE[1] + 1.5], "yaw": -90}

keep(CAT_OLD, CAT, CAT_YAW)
CAT_RECT = Rect(CAT[0] + 2.1, CAT[1], 14.25, 19.8, CAT_YAW)                 # (l'ingombro vero: 19 × 26,4 per 1,5, col centro 2,1 m verso l'abside)
blocks.append(CAT_RECT); blocks.append(Rect(80, 12, 15, 15))                 # la cattedrale e il sagrato
pads.append((Rect(104.5, 12, 40.5, 18), TOP))
grave = None
for c in OLD_KIDS:
    if c["prefab"] in ("panca.pietra", "lapidi"):
        q, y = church(c["at"], c.get("yaw", 0)); keep(c, q, y)
        if c["prefab"] == "lapidi":
            grave = q; blocks.append(Rect(q[0], q[1], 8, 8)); pads.append((Rect(q[0], q[1], 8, 8), TOP))
for c in OLD_KIDS:   # la piazza: municipio, fontana, banchi, panchine, bacheca, carretto, come sono fra loro
    if c["prefab"] in ("municipio", "fontana", "banco", "panchina", "bacheca", "carretto"):
        q, y = plaza(c["at"], c.get("yaw", 0)); keep(c, q, y)
blocks.append(Rect(PLAZA[0], PLAZA[1], 21, 19.5)); blocks.append(Rect(PLAZA[0], PLAZA[1] + 30.75, 17.5, 9.25))
pads.append((Rect(PLAZA[0], PLAZA[1] + 12, 24, 34), 4.99))                   # (un filo sotto il piano: il selciato della piazza è piatto a quota 5)
keep(FORGE_OLD, FORGE); blocks.append(Rect(*FORGE, 4.5, 4.5)); pads.append((Rect(*FORGE, 5, 5), 5.2))
keep(WELL_OLD, WELL); blocks.append(Rect(*WELL, 4.5, 4.5)); pads.append((Rect(*WELL, 4, 4), 5.3))
keep(ORTO_OLD, ORTO); blocks.append(Rect(ORTO[0] + 3.5, ORTO[1] + 1.5, 7, 5)); pads.append((Rect(ORTO[0] + 3.5, ORTO[1] + 1.5, 6, 4), 5.3))
child(prefab="teatro", at=list(THEATRE), yaw=THEATRE_YAW, scale=0.8)
blocks.append(Rect(THEATRE[0] + 4.28, THEATRE[1], 10.9, 19.2, THEATRE_YAW)); blocks.append(Rect(75, -48, 11, 13))   # il teatro e la sua piazza
pads.append((Rect(94.25, -48, 29.75, 13), Q(19.5)))
pads.append((Rect(-13, 7.6, 5, 6), 6.6))   # la piazzetta del ponte
blocks.append(Rect(GATE[0] + 6, GATE[1], 9, 9)); pads.append((Rect(GATE[0] + 6, GATE[1], 10, 12), 5.0))
for prefab, nodes in BRIDGES:
    a, b = ND[nodes[0]], ND[nodes[1]]
    child(prefab=prefab, line=[[a[0], 0, a[1]], [b[0], 0, b[1]]])
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    blocks.append(Rect((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (7 if prefab != "ponte" else 4.5), L / 2 + 3, yaw_to(a, b)))

H0 = relief(pads)   # il suolo senza le case: serve a giudicare i lotti

# ── la cripta: accanto al cimitero, a squadra, sulla griglia da un metro; il suolo sopra resta piano ──
houses = []   # (Rect, elemento, via, ascissa, lato, quartiere)
crypt_old = next(l for l in DB["locations"] if l["kind"] == "crypt")
LEN, ROOM = math.ceil(crypt_old["depth"] * 1.9), crypt_old["room"]
best, why = None, {}
for gx in range(-40, 41, 2):
    for gz in range(-40, 41, 2):
        x, z = round(grave[0]) + gx, round(grave[1]) + gz
        for yaw in (0, 90, 180, 270):
            dx, dz = round(math.sin(math.radians(yaw))), round(math.cos(math.radians(yaw)))
            far = LEN + ROOM[1]
            r = Rect(x + dx * far / 2, z + dz * far / 2, ROOM[0] / 2 + 1.5, far / 2 + 1, yaw)
            if not all(inside(p, WALLS) and wall_dist(p) > 4 and bank(p) > 8 for p in r.corners()):
                why["mura"] = why.get("mura", 0) + 1; continue
            if any(r.hits(b, 1) for b in blocks) or any(r.hits(h[0], 1) for h in houses) or min(street_edge(p) for p in r.points()) < 1:
                why["occupato"] = why.get("occupato", 0) + 1; continue
            g = [ground(H0, p) for p in r.points(2)]
            if max(g) - min(g) > 2.0:
                why["pendio"] = why.get("pendio", 0) + 1; continue
            door = (x - dx * 3, z - dz * 3)
            v = min((p for s in VIE for p in s.line), key=lambda p: math.hypot(p[0] - door[0], p[1] - door[1]))
            path = [(v[0] + (door[0] - v[0]) * k / 20, v[1] + (door[1] - v[1]) * k / 20) for k in range(21)]
            if math.hypot(v[0] - door[0], v[1] - door[1]) > 30 or any(any(b.has(p, 0.6) for b in blocks) or any(h[0].has(p, 0.6) for h in houses) for p in path):
                why["viottolo"] = why.get("viottolo", 0) + 1; continue
            score = math.hypot(x - grave[0], z - grave[1]) + math.hypot(v[0] - door[0], v[1] - door[1])
            if best is None or score < best[0]:
                best = (score, x, z, yaw, r, [list(v), [round(door[0], 2), round(door[1], 2)]], sum(g) / len(g))
if best is None:
    sys.exit(f"! cripta: nessun posto libero vicino al cimitero {why}")
_, cx_, cz_, cyaw, crect, CRYPT_WALK, clevel = best
crypt = {"at": [round(CENTER[0] + cx_), round(CENTER[1] + cz_)], "yaw": cyaw}
blocks.append(crect); pads.append((crect, round(clevel, 2)))

# ── le case: in schiera lungo le vie, l'uscio sul selciato ──
NAMED = [c for c in OLD_KIDS if c["prefab"].startswith("casa.") and c.get("id")]
inn = next(c for c in NAMED if c.get("interior") == "locanda")
want = {"poor": [c for c in NAMED if c["prefab"] == "casa.povera"], "mid": [c for c in NAMED if c["prefab"] == "casa.graticcio"],
        "rich": [c for c in NAMED if c["prefab"] == "casa.ricca" and c is not inn]}
FILL = {"poor": ("casa.povera", (5.6, 6.6), (5.6, 6.4)), "mid": ("casa.graticcio", (6, 7.4), (7, 8)), "rich": ("casa.ricca", (8, 9.5), (8.5, 9.5))}
rnd = random.Random(11)


def quarter(x, z):
    if x > 56 and -72 < z < 62:
        return "rich"
    if z > 80 or (x < -20 and (z < -18 or z > 44)) or (x < 24 and z < -40):
        return "poor"
    return "mid"


def lot(s, d, side, size):
    """Il lotto di una casa larga size[0] a d metri lungo la via, dal lato `side`: (Rect, quota) o None se non ci sta."""
    W, D = size[0] * SCALE, size[1] * SCALE
    x, z, y, tx, tz = s.at(d)
    cx, cz = x - tz * side * (s.w / 2 + 0.9 + D / 2), z + tx * side * (s.w / 2 + 0.9 + D / 2)
    r = Rect(cx, cz, W / 2, D / 2, yaw_to((cx, cz), (x, z)))
    P = r.corners() + [(cx, cz)]
    if not all(inside(p, WALLS) and wall_dist(p) > 4 for p in P):
        return None
    if any(r.hits(b, 0.8) for b in blocks) or any(r.hits(h[0], 0.5) for h in houses):
        return None
    pts = r.points()
    if min(bank(p) for p in pts) < 3.5 or min(street_edge(p) for p in pts) < 0.5:
        return None
    g = [ground(H0, p) for p in pts]
    if max(g) - min(g) > 4.0 or abs(sum(g) / len(g) - y) > 2.2:   # (un lotto troppo in pendio: resta un orto)
        return None
    return r, y + 0.12


def row(s, pick, start=2.0, step=2.0):
    """Una passata lungo la via, sui due lati: `pick(quartiere)` dà (sorgente, prefab, misura) o None."""
    if s.kind == "scala" and s.name == "scalette":
        return
    for side in (1, -1):
        d = start
        while d < s.L - 2:
            x, z = s.at(d)[:2]
            got = pick(quarter(x, z))
            if not got or len(houses) >= MAX_HOUSES:
                d += step; continue
            src, prefab, size = got
            W = size[0] * SCALE
            fit = lot(s, d + W / 2, side, size)
            if not fit or d + W > s.L - 1:
                d += step; continue
            r, level = fit
            c = {"prefab": prefab, "at": [round(r.x, 2), round(r.z, 2)], "yaw": round(r.yaw, 1), "size": list(size), "scale": SCALE}
            if src:
                c = {**{k: v for k, v in src.items() if k not in ("at", "yaw")}, "at": c["at"], "yaw": c["yaw"]}
                for v in want.values():
                    if src in v:
                        v.remove(src)
            houses.append((r, child(**c), s, d + W / 2, side, quarter(r.x, r.z)))
            pads.append((r, level))
            d += W + rnd.uniform(0.3, 1.4)


row(BY["maestra"], lambda q: (inn, inn["prefab"], inn["size"]) if not any(h[1].get("interior") == "locanda" for h in houses) else None, start=14)
if not any(h[1].get("interior") == "locanda" for h in houses):
    print("! la locanda non ha trovato posto sulla via maestra")
for s in VIE:   # chi ha un nome, nel suo quartiere
    row(s, lambda q: (want[q][0], want[q][0]["prefab"], want[q][0]["size"]) if want[q] else None)
for q0 in ("poor", "mid", "rich"):   # chi è rimasto senza posto ne prende uno qualunque
    for s in VIE:
        row(s, lambda q: (want[q0][0], want[q0][0]["prefab"], want[q0][0]["size"]) if want[q0] else None)
left = [c["id"] for v in want.values() for c in v]
if left:
    print("! case senza posto:", left)
for s in VIE:   # e le altre, a riempire le schiere
    row(s, lambda q: (None, FILL[q][0], [round(rnd.uniform(*FILL[q][1]), 1), round(rnd.uniform(*FILL[q][2]), 1)]))


H = relief(pads)

# ── gli addobbi ──
def front(r, along=0.0, out=0.05):
    return r.world(along, r.hd + out)


CAT_OLD_AT, INN_OLD, OLD_GATE = CAT_OLD["at"], inn, OLD["gate"]["at"]
inn_new = next(c for c in kids if c.get("interior") == "locanda")
gate_f, inn_f = move(OLD_GATE, -90, GATE, -90), move(inn["at"], inn["yaw"], inn_new["at"], inn_new["yaw"])
for c in OLD_KIDS:   # stendardi, botti e casse coi loro gruppi: la cattedrale, la piazza, la locanda, la porta
    if c["prefab"] not in ("stendardo", "botte", "cassa"):
        continue
    x, z = c["at"]
    if math.hypot(x - CAT_OLD_AT[0], z - CAT_OLD_AT[1]) < 25:
        f = church
    elif abs(x - FOUNT_OLD["at"][0]) < 22 and -22 < z - FOUNT_OLD["at"][1] < 20:
        f = plaza
    elif math.hypot(x - inn["at"][0], z - inn["at"][1]) < 12:
        f = inn_f
    elif math.hypot(x - OLD_GATE[0], z - OLD_GATE[1]) < 14:
        f = gate_f
    else:
        continue
    q, y = f(c["at"], c.get("yaw", 0))
    if any(h[0].has(q, 0.3) for h in houses if h[1] is not inn_new) or (f is not plaza and street_edge(q) < -1.2):
        continue
    keep(c, q, y)
TINTS = ["ocra", "vino", "muschio"]
nf = npanni = nins = 0
used = set()
for k, A in enumerate(houses):   # festoni fra due facciate di fronte, panni nei borghi poveri
    if A[4] != 1 or k in used:
        continue
    pa, pair = front(A[0]), None
    for j, B in enumerate(houses):
        if B[2] is not A[2] or B[4] != -1 or abs(B[3] - A[3]) > 7 or j in used:
            continue
        pb = front(B[0]); L = math.hypot(pb[0] - pa[0], pb[1] - pa[1])
        if 5 < L < 16 and (pair is None or L < pair[0]):
            pair = (L, j, pb)
    if not pair:
        continue
    L, j, pb = pair
    poor = A[5] == "poor" and houses[j][5] == "poor"
    if poor and npanni < 10 and k % 2 == 0:
        child(prefab="panni", **{"from": [round(pa[0], 2), 3.4, round(pa[1], 2)], "to": [round(pb[0], 2), 3.2, round(pb[1], 2)]}); npanni += 1; used.update((k, j))
    elif not poor and nf < 12 and A[2].name in ("maestra", "mulini", "nuova", "mezzo", "alta") and k % 2 == 0:
        child(prefab="festone", **{"from": [round(pa[0], 2), 5.4, round(pa[1], 2)], "to": [round(pb[0], 2), 5.2, round(pb[1], 2)]}); nf += 1; used.update((k, j))
for k, (r, c, s, d, side, q) in enumerate(houses):   # insegne sulle botteghe delle vie principali
    if s.name in ("maestra", "ponte_est", "mulini", "nuova") and q != "poor" and nins < 8 and k % 2 == 1:
        p_ = front(r, along=r.hw * 0.64, out=0.0)
        child(prefab="insegna", at=[round(p_[0], 2), round(p_[1], 2)], yaw=round(r.yaw, 1), tint=TINTS[nins % 3]); nins += 1

# ── i lampioni: sul bordo del selciato delle vie principali, a lati alterni; mai davanti a un uscio ──
lamps = []
doors = [front(h[0], out=0.3) for h in houses]
for s in VIE:
    if not s.lamps:
        continue
    d, side = 9.0, 1
    while d < s.L - 4 and len(lamps) < 26:
        x, z, _, tx, tz = s.at(d)
        for sd in (side, -side):
            p = (round(x - tz * sd * (s.w / 2 - 0.35), 2), round(z + tx * sd * (s.w / 2 - 0.35), 2))
            if inside(p, WALLS) and wall_dist(p) > 6 and bank(p) > 2 and street_edge(p, s) > 0.6 and all(math.hypot(p[0] - q[0], p[1] - q[1]) > 4.5 for q in doors) \
                    and all(math.hypot(p[0] - q[0], p[1] - q[1]) > 20 for q in lamps) and not any(b.has(p, 0.5) for b in blocks[4:]):
                lamps.append(p); break
        d += 34; side = -side
for p in [(66.5, 0.5), (66.5, 23.5), (88, 0.5), (88, 23.5), (66, -58), (85, -37)]:   # il sagrato e la piazza del teatro
    lamps.append(p)
for x, z in lamps:
    child(prefab="lampione", at=[x, z], yaw=0)

spots["street"] = {"at": list(BY["maestra"].at(BY["maestra"].L * 0.6)[:2]), "yaw": 90}
spots["laneN"] = {"at": list(BY["borgo_nord"].at(BY["borgo_nord"].L * 0.45)[:2]), "yaw": 0}
spots["laneS"] = {"at": list(BY["piano"].at(BY["piano"].L * 0.5)[:2]), "yaw": 180}
for k in spots:
    spots[k]["at"] = [round(spots[k]["at"][0], 2), round(spots[k]["at"][1], 2)]
missing = set(OLD_SPOTS) - set(spots)
if missing:
    sys.exit(f"! posti che il file ha e la pianta nuova no: {missing}")

# ── i percorsi degli abitanti: le vie, gli archi della piazza, i ponti, la strada della grotta, il viottolo della cripta ──
walks = [[list(p) for p in s.line] for s in VIE] + [[list(ND[n][:2]) for n in w] for w in PASSI]
walks.append([list(ND["PE"][:2]), list(ND["b0"][:2])])
fo = FOUNT_OLD["at"]
for w in OLD["walks"]:   # i due archi della piazza (cominciano dove la piazza si apre a ovest)
    if math.hypot(w[0][0] - (fo[0] - 18.75), w[0][1] - fo[1]) < 0.1:
        walks.append([list(plaza(p)) for p in w if abs(p[0] - fo[0]) < 18.76])
for _, nodes in BRIDGES:
    walks.append([list(ND[n][:2]) for n in nodes])
# fuori dalla porta, lungo la strada, fino all'imbocco della grotta (⚠️ niente nodi sottoterra: un nodo non ha quota)
walks.append([[-135, 12], [-148, 48], [-162, 60], [-174, 64], [-172, 69.5], [-166, 69.5]])
# i posti fuori mano (il cimitero, il pozzo, l'orto): un viottolo dal nodo di via più vicino che li veda, o il gioco li lega
# al nodo più vicino in linea d'aria, che può essere dietro un muro
BIG = blocks[:1] + [b for b in blocks if b.hw > 9]
for k in ("yard", "well", "well2", "patch"):
    q = spots[k]["at"]
    for v in sorted((p for s_ in VIE for p in s_.line), key=lambda p: math.hypot(p[0] - q[0], p[1] - q[1]))[:12]:
        path = [(v[0] + (q[0] - v[0]) * i / 16, v[1] + (q[1] - v[1]) * i / 16) for i in range(17)]
        if not any(any(h[0].has(p, 0.8) for h in houses) or any(b.has(p, 0.8) for b in BIG) for p in path):
            walks.append([list(v), list(q)]); break
    else:
        print(f"! il posto {k} non vede nessuna via")
ddx, ddz = round(math.sin(math.radians(cyaw))), round(math.cos(math.radians(cyaw)))
ex, ez = (round(cx_), math.floor(cz_) + 0.5) if ddx else (math.floor(cx_) + 0.5, round(cz_))   # (come pit() in terrain.ts)
walks.append(CRYPT_WALK + [[ex, ez]])

# ── i selciati: la piazza (com'era), le piazze nuove, un nastro per via; le scale al posto del selciato ──
paving = []
for p in OLD["paving"]:
    if p["kind"] == "cubetti" and p["width"] > 20:
        paving.append({**p, "line": [list(plaza(q)) for q in p["line"]]})
paving.append({"kind": "cubetti", "width": 30, "line": [[65, 12.01], [80, 12], [95, 12.01]]})        # il sagrato (tre punti: segue il suolo)
paving.append({"kind": "cubetti", "width": 26, "line": [[64.5, -48.01], [75, -48], [86, -48.01]]})   # la piazza del teatro
paving.append({"kind": "lastre", "width": 12, "line": [[-18, 7.1], [-13, 7.6], [-8, 8.05]]})              # la piazzetta del ponte
KIND = {"poor": "ciottoli", "mid": "lastre", "rich": "cubetti"}
for s in VIE:
    if s.kind == "scala":
        child(prefab="scala", line=[[p[0], 0, p[1]] for p in s.line], size=[s.w, 0])
    else:
        paving.append({"kind": KIND[quarter(*s.line[len(s.line) // 2])], "width": s.w, "line": [list(p) for p in s.line]})

# ── il rilievo: quote in cm, e quanto vale rispetto al terreno generato (tutto dentro le mura, lungo il torrente e sul monte) ──
wgt = np.zeros((GH, GW))
for j in range(GH):
    for i in range(GW):
        p = (X0 + i, Z0 + j)
        out = 0.0 if inside(p, WALLS) else wall_dist(p)
        wgt[j, i] = max(1 - sstep(8, 30, out), 1 - sstep(14, 30, bank(p)), sstep(105, 135, p[0]))
with open(os.path.join(ROOT, "public", "data", "rilievo.bin"), "wb") as f:
    f.write(struct.pack("<4f", CENTER[0] + X0, CENTER[1] + Z0, GW, GH))
    f.write(np.round(H * 100).astype("<i2").tobytes())
    f.write(np.round(wgt * 255).astype(np.uint8).tobytes())

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
             "walls": [list(p) for p in WALLS],
             "river": {"line": [list(p) for p in RIVER], "width": max(p[3] for p in TORRENT), "level": min(p[2] for p in TORRENT), "levels": [p[2] for p in TORRENT], "widths": [p[3] for p in TORRENT]},
             "children": kids, "spots": spots, "walks": walks, "paving": paving, "green": []},
    "crypt": crypt, "lumier": tour,
}, open(OUT, "w", encoding="utf8"), ensure_ascii=False)
n = sum(1 for c in kids if c["prefab"].startswith("casa."))
print(f"FIANCO: {len(kids)} elementi, {n} case ({n - len(NAMED)} senza nome), {len(lamps)} lampioni, rilievo {GW}×{GH}, quote {H.min():.1f}…{H.max():.1f}, cripta {crypt}")
