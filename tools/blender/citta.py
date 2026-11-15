# ─────────────────────────────────────────────────────────────────────────────
# CITTÀ SCENOGRAFICA — tre impianti possibili della città, in volumi grezzi, per sceglierne uno.
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tools/blender/citta.py -- A
#
# (A, B o C; senza lettera tutti e tre.) Per ogni impianto: un rilievo, un fiume col suo ponte, le mura, la cattedrale nel
# punto più alto, il teatro nella zona ricca, case povere / medie / ricche lungo le vie, il bosco attorno e le montagne sullo
# sfondo. Scrive i render in `docs/reference/citta/scenografia/`. Sono volumi da schizzo: misure vere (gli edifici già a una
# volta e mezzo, come nel gioco), nessun dettaglio.
# Assi: x est, y nord (nel gioco è z), quote in metri; l'origine è il centro della città.
# ─────────────────────────────────────────────────────────────────────────────
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, noise

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "docs", "reference", "citta", "scenografia")
os.makedirs(OUT, exist_ok=True)
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
WHICH = ARGS[0] if ARGS else "ABCDEF"
FAST = "fast" in ARGS


def sstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def seg(p, a, b):
    ax, ay, bx, by = *a, *b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(p[0] - ax - dx * t, p[1] - ay - dy * t)


def pdist(p, line):
    return min(seg(p, line[i], line[i + 1]) for i in range(len(line) - 1))


def N(x, y, s, k=0.0):
    return noise.noise(Vector((x / s, y / s, k)))


def inside(p, poly):
    x, y, c = p[0], p[1], False
    for i in range(len(poly)):
        (ax, ay), (bx, by) = poly[i], poly[i - 1]
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            c = not c
    return c


# ── i tre impianti ─────────────────────────────────────────────────────────────
# Ognuno: rilievo `h(x, y)`, fiume (spezzata, larghezza, quota dell'acqua), ponti, mura, vie, quartiere di ogni punto,
# edifici speciali, montagne (direzioni), inquadrature.

def plan_A():
    """La rocca: un colle che sale da ovest a est e finisce in uno sperone a picco; il fiume lambisce la città a ovest."""
    river = [(-70, 170), (-88, 60), (-80, -10), (-92, -90), (-75, -170)]

    def h(x, y):
        z = 1.5 + N(x, y, 60) * 2 + N(x, y, 15, 3) * 0.4
        hill = 40 * sstep(-75, 55, x) * (1 - sstep(62, 80, x)) * (1 - sstep(55, 115, abs(y - 5)))
        z += hill
        z += (1 - sstep(62, 80, x)) * 0 + sstep(70, 95, x) * (-14 - z) * (1 - sstep(70, 150, abs(y)) * 0.3)   # il dirupo a est
        z = mix_terraces(x, y, z, 4.0, 0.65, lambda x, y: inside((x, y), WALL_A))
        return z
    walls = WALL_A
    streets = [
        [(-150, -4), (-95, -2), (-62, 0), (-40, -6), (-15, 2), (8, 4)],          # dalla porta (sul ponte) alla piazza del mercato
        [(8, 4), (25, -10), (40, -4), (52, 8)],                                 # salita alla cattedrale
        [(8, 4), (5, 30), (25, 48), (45, 40)],                                  # la via dei palazzi, a nord
        [(-40, -6), (-48, -40), (-30, -60), (0, -55), (20, -40)],               # il borgo basso, a sud
        [(-40, -6), (-50, 30), (-35, 55), (-10, 62)],                           # verso il mulino, a nord-ovest
        [(-62, 0), (-62, -50)], [(-62, 0), (-62, 50)],                           # lungo il fiume
        [(25, -10), (20, 25)],
    ]
    def quarter(x, y):
        return "poor" if x < -32 else "rich" if x > 12 or (x > 0 and y > 25) else "mid"
    special = {
        "cattedrale": dict(at=(46, 8), yaw=0),        # portale a ovest, abside sul dirupo, verso le montagne a est
        "teatro": dict(at=(30, -48), yaw=90, kind="cavea"),   # scavato nel fianco sud del colle, guarda la valle
        "municipio": dict(at=(10, 18), yaw=180),
        "piazza": dict(at=(5, 2), r=14),
    }
    bridges = [dict(a=(-100, -2), b=(-64, 0), kind="porta")]   # il ponte fortificato è l'ingresso
    cams = {
        "veduta": ((-230, -210, 120), (10, 0, 10)),
        "cattedrale": (None, (600, 60, 40), "window"),
        "fiume": ((-132, -16, 4), (40, 10, 30)),             # sulla strada che arriva, davanti al ponte della porta
    }
    return dict(name="A — La rocca", h=h, river=river, river_w=16, water=-2.5, walls=walls, streets=streets, quarter=quarter,
                special=special, bridges=bridges, mountains=(-60, 120), cams=cams, sun=(28, 210))


WALL_A = [(-66, -55), (-50, -75), (-5, -75), (35, -68), (62, -55), (78, -20), (80, 30), (62, 62), (25, 72), (-25, 75), (-58, 62), (-68, 30)]


def plan_B():
    """Le due rive: il fiume taglia la città; a ovest la riva bassa e povera, a est una rupe con la città ricca e la cattedrale."""
    river = [(-15, 170), (2, 80), (-6, 20), (4, -40), (-8, -100), (5, 170 * -1)]

    def h(x, y):
        z = 1 + N(x, y, 50) * 1.5
        bank = 34 * sstep(14, 46, x + N(x, y, 30, 5) * 8)
        z += bank + sstep(40, 110, x) * 10 * (1 - sstep(30, 90, abs(y - 30)))
        z = mix_terraces(x, y, z, 5.0, 0.55, lambda x, y: x > 30 and inside((x, y), WALL_B))
        return z
    streets = [
        [(-160, 0), (-110, 0), (-60, -4), (-25, 0), (-12, 2)],                   # porta → piazza del mercato sulla riva ovest
        [(18, 2), (30, -12), (45, 2), (34, 18), (50, 30), (68, 22)],             # dal ponte la rampa a tornanti sulla rupe
        [(68, 22), (90, 40)], [(50, 30), (55, 62), (80, 70)],
        [(68, 22), (75, -10), (70, -45), (50, -60)],
        [(-60, -4), (-62, -45), (-40, -75), (-15, -80)], [(-60, -4), (-55, 40), (-35, 70), (-12, 80)],
        [(-25, 0), (-28, 35)], [(-25, 0), (-30, -35)],
    ]
    def quarter(x, y):
        return "poor" if x < -30 else "mid" if x < 20 else "rich"
    special = {
        "cattedrale": dict(at=(92, 42), yaw=0),
        "teatro": dict(at=(80, -30), yaw=0, kind="tondo"),        # un teatro di legno a pianta tonda, sul pianoro
        "municipio": dict(at=(-30, 14), yaw=-90),
        "piazza": dict(at=(-38, 0), r=13),
    }
    bridges = [dict(a=(-14, 1), b=(20, 1), kind="case", deck=6.5), dict(a=(-12, -70), b=(14, -72), kind="passerella", deck=2.5)]
    cams = {
        "veduta": ((-200, -230, 115), (25, 10, 10)),
        "cattedrale": (None, (600, 330, 60), "window"),
        "fiume": ((0, -71, 4.2), (6, 40, 14)),               # sulla passerella, verso il ponte con le botteghe e la rupe
    }
    return dict(name="B — Le due rive", h=h, river=river, river_w=20, water=-2.5, walls=WALL_B, streets=streets, quarter=quarter,
                special=special, bridges=bridges, mountains=(-20, 100), cams=cams, sun=(24, 220))


WALL_B = [(-105, -70), (-60, -95), (0, -95), (60, -85), (100, -55), (115, 0), (110, 55), (70, 88), (10, 95), (-55, 92), (-100, 65), (-112, 0)]


def plan_C():
    """L'anfiteatro: la città a gradoni su un pendio esposto a sud, la cattedrale in cima; in fondo una gola col ponte alto e il borgo basso."""
    river = [(-170, -62), (-90, -70), (-30, -76), (30, -70), (90, -78), (170, -70)]

    def h(x, y):
        z = 2 + N(x, y, 50) * 1.5
        bowl = 48 * sstep(-58, 78, y + 0.0032 * x * x * 1.0) + 16 * sstep(55, 120, abs(x))
        south = -6 + N(x, y, 25, 7) * 1.5                                    # il borgo oltre la gola
        z = bowl + z if y > -70 else south
        g = pdist((x, y), river)
        z = min(z, -14 + max(0.0, g - 8) * 2.2) if g < 30 else z               # la gola
        z = mix_terraces(x, y, z, 4.5, 0.75, lambda x, y: y > -48 and inside((x, y), WALL_C))
        return z
    streets = [
        [(-160, -40), (-110, -42), (-70, -40), (-30, -36), (0, -40)],                    # dalla porta lungo il ciglio della gola
        [(0, -45), (0, -10), (0, 20), (0, 48)],                                          # la scalinata maggiore fino alla cattedrale
        [(-80, -20), (-40, -14), (0, -12), (40, -14), (80, -20)],                         # terrazze: archi lungo le curve di livello
        [(-75, 8), (-38, 16), (0, 18), (38, 16), (75, 8)],
        [(-60, 36), (-30, 44), (0, 46), (30, 44), (60, 36)],
        [(0, -105), (-40, -100), (-90, -95)], [(0, -105), (40, -100), (90, -100)],          # il borgo basso oltre il ponte
        [(-40, -14), (-38, 16)], [(40, -14), (38, 16)],
    ]
    def quarter(x, y):
        return "poor" if y < -48 else "rich" if y > 10 else "mid"
    special = {
        "cattedrale": dict(at=(0, 66), yaw=-90),   # portale a sud verso la città, abside a nord verso le montagne
        "teatro": dict(at=(-48, 30), yaw=90, kind="coperto"),
        "municipio": dict(at=(30, -2), yaw=180),
        "piazza": dict(at=(0, -26), r=12),
    }
    bridges = [dict(a=(2, -100), b=(0, -46), kind="alto", deck=2)]
    cams = {
        "veduta": ((-150, -280, 95), (0, 10, 20)),
        "cattedrale": (None, (60, 900, 110), "window"),
        "fiume": ((4, -128, 9), (0, 40, 42)),                # dal borgo basso, oltre la gola: il ponte alto e la città a gradoni
    }
    streets.append([(-90, -112), (90, -112)])
    return dict(name="C — L'anfiteatro", borgo=[(-95, -88), (95, -88), (95, -135), (-95, -135)], h=h, river=river, river_w=10, water=-12.5, walls=WALL_C, streets=streets, quarter=quarter,
                special=special, bridges=bridges, mountains=(40, 140), cams=cams, sun=(30, 200))


WALL_C = [(-100, -48), (-50, -52), (0, -50), (50, -52), (100, -48), (115, 0), (95, 50), (55, 82), (0, 92), (-55, 82), (-95, 50), (-115, 0)]


# ── seconda tornata (dopo B): fiume in obliquo, vie che serpeggiano, cattedrale fuori asse girata verso chi entra ──

def side(p, line):
    """Distanza con segno da una spezzata: positiva a sinistra del verso in cui è disegnata."""
    best, sgn = 1e9, 1
    for i in range(len(line) - 1):
        (ax, ay), (bx, by) = line[i], line[i + 1]
        d = seg(p, line[i], line[i + 1])
        if d < best:
            best, sgn = d, 1 if (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) > 0 else -1
    return best * sgn


def facing(cat, gate, tilt):
    """L'asse della cattedrale (dal portale all'abside) perché la facciata guardi chi arriva dalla porta, girata di `tilt` gradi."""
    return math.degrees(math.atan2(cat[1] - gate[1], cat[0] - gate[0])) + tilt


def plan_D():
    """L'ansa: il fiume taglia la città da nord-ovest a sud-est con una curva a S; a nord-est la rupe, a sud-ovest la riva bassa."""
    river = [(-180, 125), (-120, 95), (-70, 55), (-30, 22), (8, 8), (45, -20), (85, -52), (130, -75), (180, -120)]

    def h(x, y):
        s_ = side((x, y), river)   # positiva a nord-est
        z = 1.5 + N(x, y, 50) * 1.5
        if s_ > 0:
            z += 30 * sstep(18, 50, s_ + N(x, y, 25, 4) * 7) + 13 * math.exp(-((x - 80) ** 2 + (y - 58) ** 2) / 34 ** 2)
        else:
            z += 4 * sstep(60, 140, -s_)
        return mix_terraces(x, y, z, 4.5, 0.6, lambda x, y: side((x, y), river) > 22 and inside((x, y), WALL_D))
    gate, cat = (-106, -52), (80, 58)
    streets = [
        [(-175, -84), (-130, -66), (-106, -52), (-80, -50), (-58, -36), (-42, -20), (-26, -14), (-7, -11)],   # dalla porta al ponte
        [(22, 27), (28, 12), (44, 4), (60, 8), (56, 20), (52, 28)],                                           # la salita a tornanti fino al sagrato
        [(56, 20), (78, 6), (100, -2), (108, -25)],
        [(22, 27), (26, 44), (22, 62), (34, 82), (58, 90)],
        [(-80, -50), (-88, -20), (-80, 8), (-64, 30), (-83, 40)],
        [(-58, -36), (-40, -62), (-12, -72), (20, -66), (45, -58)],
        [(-42, -20), (-52, 8), (-40, 30)], [(-26, -14), (-14, -40), (4, -48)],
        [(-57, 70), (-34, 80), (-6, 90), (20, 82), (34, 82)],
    ]
    def quarter(x, y):
        s_ = side((x, y), river)
        return "poor" if s_ < 0 else "mid" if s_ < 24 else "rich"
    special = {
        "cattedrale": dict(at=cat, yaw=facing(cat, gate, 22)),
        "teatro": dict(at=(96, -20), yaw=0, kind="tondo"),
        "municipio": dict(at=(-22, -36), yaw=30),
        "piazza": dict(at=(-36, -28), r=11),
    }
    bridges = [dict(a=(-7, -11), b=(22, 27), kind="case", deck=5), dict(a=(-83, 40), b=(-57, 70), kind="passerella", deck=3)]
    cams = {
        "veduta": ((-215, -205, 115), (20, 10, 20)),
        "ingresso": ((-98, -52, None), "cat"),
        "fiume": ((50, -40, None), (8, 12, 22)),
        "cattedrale": (None, (650, 520, 60), "window"),
    }
    return dict(name="D — L'ansa", h=h, rivers=[river], river_w=22, water=-2.5, walls=WALL_D, streets=streets, quarter=quarter,
                special=special, bridges=bridges, cams=cams, sun=(24, 215), organic=True)


WALL_D = [(-118, -30), (-95, -75), (-45, -100), (15, -105), (70, -95), (112, -60), (125, -5), (110, 50), (75, 90), (20, 105), (-40, 100), (-90, 75), (-120, 30)]

# E: tutto è scritto lungo l'asse del fiume (s lungo, n di traverso, n positiva a nord-ovest), girato di 32°
_A = math.radians(32)
def _w(s_, n_):
    return (s_ * math.cos(_A) - n_ * math.sin(_A), s_ * math.sin(_A) + n_ * math.cos(_A))
def _l(x, y):
    return (x * math.cos(_A) + y * math.sin(_A), -x * math.sin(_A) + y * math.cos(_A))
def _off(s_):
    return 30 * (1 - sstep(45, 85, abs(s_)))
def _wig(s_):
    return 8 * math.sin(s_ / 60)


def plan_E():
    """L'isola: il fiume, in obliquo da sud-ovest a nord-est, si apre in due bracci attorno a uno scoglio; sullo scoglio la cattedrale."""
    arms = [[_w(s_, k * _off(s_) + _wig(s_)) for s_ in range(-220, 230, 10)] for k in (1, -1)]
    W = lambda pts: [_w(*q) for q in pts]

    def h(x, y):
        s_, n_ = _l(x, y)
        o, c = _off(s_), _wig(s_)
        z = 1.5 + N(x, y, 50) * 1.5
        if n_ - c > o:
            z += 17 * sstep(o + 16, o + 48, n_ - c + N(x, y, 25, 4) * 6)          # la riva alta, dei ricchi
        elif n_ - c < -o:
            z += 3 * sstep(60, 150, -(n_ - c))                                     # la riva bassa, dei poveri
        else:
            e = math.hypot((s_ - 5) / 52, (n_ - c) / 18)
            z = max(z, 6 + 34 * (1 - sstep(0.4, 1.0, e)) + N(x, y, 12, 6) * 2)   # lo scoglio
        return mix_terraces(x, y, z, 4.0, 0.6, lambda x, y: _l(x, y)[1] > 45 and inside((x, y), WALL_E))
    gate, cat = _w(-130, -75), _w(18, 2)
    streets = [W(l) for l in (
        [(-190, -95), (-130, -75), (-105, -60), (-80, -50), (-60, -44), (-38, -40), (-20, -52)],      # dalla porta al ponte delle botteghe
        [(-16, -14), (-30, -8), (-38, 4), (-24, 10), (-6, 8), (0, 2)],                                # su per lo scoglio
        [(-38, 4), (-52, 8)],
        [(-60, 48), (-40, 62), (-10, 68), (20, 62), (50, 50), (70, 30)],                              # la riva alta
        [(-60, 48), (-85, 60), (-110, 70)], [(-10, 68), (-20, 92)], [(20, 62), (30, 86)],
        [(-80, -50), (-75, -75), (-50, -90), (-10, -85), (30, -70), (60, -50), (70, -14)],           # la riva bassa
        [(-38, -40), (-30, -64), (-5, -72)], [(30, -70), (45, -45)],
        [(70, 28), (70, 34), (70, 30)],
    )]
    def quarter(x, y):
        s_, n_ = _l(x, y)
        o, c = _off(s_), _wig(s_)
        return "poor" if n_ - c < -o else "mid" if n_ - c < o + 26 else "rich"
    special = {
        "cattedrale": dict(at=cat, yaw=facing(cat, gate, -18)),
        "teatro": dict(at=_w(-5, 62), yaw=math.degrees(_A) + 90, kind="cavea"),
        "municipio": dict(at=_w(-50, -74), yaw=math.degrees(_A)),
        "piazza": dict(at=_w(-62, -58), r=11),
    }
    bridges = [dict(a=_w(-20, -52), b=_w(-16, -14), kind="case", deck=5), dict(a=_w(-52, 8), b=_w(-60, 48), kind="alto", deck=12),
               dict(a=_w(70, -14), b=_w(70, 28), kind="passerella", deck=3)]
    cams = {
        "veduta": ((-60, -260, 120), (5, 10, 20)),
        "ingresso": ((*_w(-118, -68), None), "cat"),
        "fiume": ((*_w(165, 10), 16), (*_w(10, 0), 26)),              # lungo il fiume, da fuori le mura a valle
        "cattedrale": (None, (-600, 700, 60), "window"),
    }
    return dict(name="E — L'isola", h=h, rivers=arms, river_w=16, water=-2.5, walls=WALL_E, streets=streets, quarter=quarter,
                special=special, bridges=bridges, cams=cams, sun=(24, 200), organic=True)


WALL_E = [_w(*q) for q in [(-150, -55), (-110, -95), (-30, -105), (40, -90), (85, -55), (95, 0), (85, 60), (30, 100), (-50, 105), (-120, 80), (-160, 20)]]


def plan_F():
    """Il meandro: il fiume entra da nord-ovest, gira attorno a un promontorio e riparte verso sud-ovest; sul promontorio i ricchi e la cattedrale."""
    river = [(-180, 95), (-110, 70), (-55, 58), (-10, 72), (30, 94), (72, 88), (100, 55), (106, 15), (86, -20), (48, -36), (10, -26), (-20, -22), (-45, -45), (-75, -100), (-110, -180)]
    C = (62, 40)

    def h(x, y):
        z = 1.5 + N(x, y, 50) * 1.5
        d = math.hypot(x - C[0], y - C[1])
        z += 34 * (1 - sstep(12, 58, d + N(x, y, 25, 4) * 6)) + 9 * math.exp(-((x + 15) ** 2 + (y - 22) ** 2) / 32 ** 2)
        return mix_terraces(x, y, z, 4.0, 0.6, lambda x, y: math.hypot(x - C[0], y - C[1]) < 52)
    gate, cat = (-128, 12), (80, 52)
    streets = [
        [(-185, 15), (-128, 12), (-100, 6), (-75, 10), (-50, 18), (-30, 20), (-10, 24), (10, 30), (26, 36), (36, 46), (48, 40), (52, 32)],
        [(10, 30), (18, 50), (34, 66), (32, 70)], [(34, 66), (60, 74), (86, 76)],
        [(26, 36), (38, 18), (62, 8), (66, 0)], [(62, 8), (84, 18), (94, 36)],
        [(28, 114), (0, 110), (-30, 100), (-62, 82)], [(28, 114), (60, 112), (92, 100)],
        [(70, -54), (40, -62), (10, -58), (-18, -66)], [(70, -54), (100, -42), (118, -22)],
        [(-100, 6), (-105, -25), (-85, -50), (-62, -70)], [(-75, 10), (-82, 36), (-64, 42)],
    ]
    def quarter(x, y):
        if math.hypot(x - C[0], y - C[1]) < 58:
            return "rich"
        return "poor" if y > 86 or y < -40 or x < -70 else "mid"
    special = {
        "cattedrale": dict(at=cat, yaw=facing(cat, gate, 25)),
        "teatro": dict(at=(16, 64), yaw=-60, kind="coperto"),
        "municipio": dict(at=(-60, -6), yaw=10),
        "piazza": dict(at=(-46, 4), r=11),
    }
    bridges = [dict(a=(32, 70), b=(28, 114), kind="case", deck=8), dict(a=(66, 0), b=(70, -54), kind="alto", deck=12),
               dict(a=(-64, 42), b=(-62, 82), kind="passerella", deck=3)]
    cams = {
        "veduta": ((-90, -250, 125), (30, 30, 20)),
        "ingresso": ((-118, 11, None), "cat"),
        "fiume": ((-82, -118, 16), (45, 35, 26)),                   # lungo il fiume, da fuori le mura a valle
        "cattedrale": (None, (750, 250, 60), "window"),
    }
    return dict(name="F — Il meandro", h=h, rivers=[river], river_w=18, water=-2.5, walls=WALL_F, streets=streets, quarter=quarter,
                special=special, bridges=bridges, cams=cams, sun=(26, 210), organic=True)


WALL_F = [(-125, -10), (-100, -60), (-55, -95), (10, -88), (70, -72), (125, -38), (142, 20), (128, 80), (80, 125), (15, 130), (-50, 108), (-105, 78), (-130, 35)]


def smooth(line, k=5):
    """Catmull-Rom: una spezzata diventa una curva che passa per i suoi punti."""
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


def mix_terraces(x, y, z, step, k, where):
    """Dentro le mura il pendio si fa a gradoni (terrazze con il loro muro di sostegno)."""
    if not where(x, y):
        return z
    q = math.floor(z / step) * step + step * sstep(0.82, 1.0, (z / step) % 1.0)
    return z + (q - z) * k


# ── la scena ───────────────────────────────────────────────────────────────────
MATS = {}


def haze(m, near=250.0, far=2200.0, color=(0.36, 0.42, 0.52)):
    """Prospettiva aerea: lontano il colore va verso la foschia (al posto di un volume nel mondo)."""
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    src = b.inputs["Base Color"].links[0].from_socket if b.inputs["Base Color"].links else None
    cam = nt.nodes.new("ShaderNodeCameraData")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value, mr.inputs["From Max"].default_value = near, far
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(cam.outputs["View Distance"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], mix.inputs["Factor"])
    if src:
        nt.links.new(src, mix.inputs["A"])
    else:
        mix.inputs["A"].default_value = b.inputs["Base Color"].default_value
    mix.inputs["B"].default_value = (*color, 1)
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    em = b.inputs["Emission Color"]
    nt.links.new(mix.outputs["Result"], em)
    nt.links.new(mr.outputs["Result"], b.inputs["Emission Strength"])
    return m


def mat(name, rgb, rough=0.85, vcol=False, emit=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    if vcol:
        a = nt.nodes.new("ShaderNodeVertexColor")
        a.layer_name = "col"
        nt.links.new(a.outputs["Color"], b.inputs["Base Color"])
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 3
    MATS[name] = m
    return m


def obj(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(material)
    return o


def box(bm, cx, cy, z0, w, d, hgt, yaw=0.0, top=None):
    """Una scatola (w lungo x, d lungo y prima della rotazione) dal suolo z0 alta hgt; `top` = falda a capanna alta tanto."""
    c, s = math.cos(yaw), math.sin(yaw)
    P = lambda x, y, z: bm.verts.new((cx + x * c - y * s, cy + x * s + y * c, z))
    v = [P(x, y, z) for z in (z0, z0 + hgt) for (x, y) in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]
    for f in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f])
    return v


def roof(bm, cx, cy, z0, w, d, rise, yaw=0.0, over=0.5, hip=False):
    """Una falda a capanna (colmo lungo x) o a padiglione."""
    c, s = math.cos(yaw), math.sin(yaw)
    P = lambda x, y, z: bm.verts.new((cx + x * c - y * s, cy + x * s + y * c, z))
    a, b = w / 2 + over, d / 2 + over
    e = [P(-a, -b, z0), P(a, -b, z0), P(a, b, z0), P(-a, b, z0)]
    k = b if hip else 0
    r = [P(-a + k, 0, z0 + rise), P(a - k, 0, z0 + rise)]
    bm.faces.new((e[0], e[1], r[1], r[0]))
    bm.faces.new((e[2], e[3], r[0], r[1]))
    bm.faces.new((e[1], e[2], r[1]))
    bm.faces.new((e[3], e[0], r[0]))
    bm.faces.new(e)


def cylinder(bm, cx, cy, z0, r, hgt, n=16, cone=0.0, r2=None):
    r2 = r if r2 is None else r2
    lo = [bm.verts.new((cx + r * math.cos(t), cy + r * math.sin(t), z0)) for t in (i / n * math.tau for i in range(n))]
    hi = [bm.verts.new((cx + r2 * math.cos(t), cy + r2 * math.sin(t), z0 + hgt)) for t in (i / n * math.tau for i in range(n))]
    for i in range(n):
        bm.faces.new((lo[i], lo[i - 1], hi[i - 1], hi[i]))
    bm.faces.new(lo)
    if cone:
        tip = bm.verts.new((cx, cy, z0 + hgt + cone))
        for i in range(n):
            bm.faces.new((hi[i - 1], hi[i], tip))
    else:
        bm.faces.new(hi)


def build(P):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    scene = bpy.context.scene
    h, rw = P["h"], P["river_w"]
    rnd = random.Random(7)
    rivers = [smooth(l, 4) for l in P["rivers"]] if "rivers" in P else [P["river"]]
    river = rivers[0]
    rdist = lambda p: min(pdist(p, l) for l in rivers)
    streets = P["streets"]
    if P.get("organic"):   # le vie curve, con un filo di storto che non è disegnato
        streets = [[(x + N(x, y, 9, 13) * 1.2, y + N(x, y, 9, 14) * 1.2) for x, y in smooth(l, 4)] for l in streets]
        P["streets"] = streets

    def ground(x, y):
        z = h(x, y)
        g = rdist((x, y))
        bed = P["water"] - 2.5 + max(0.0, g - rw / 2) * 1.6     # l'alveo con le sponde
        return min(z, bed) if g < rw * 3 else z

    # ── il terreno, coi colori nei vertici: prato, roccia sul ripido, selciato sulle vie, terra in città ──
    S, R = 2.0, 230
    n = int(2 * R / S) + 1
    bm = bmesh.new()
    vs = [[bm.verts.new((-R + i * S, -R + j * S, ground(-R + i * S, -R + j * S))) for i in range(n)] for j in range(n)]
    for j in range(n - 1):
        for i in range(n - 1):
            bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
    col = bm.loops.layers.color.new("col")
    bm.normal_update()
    # (le vie spezzate in tratti, ognuno col suo riquadro: si misura solo dove serve; un colore per vertice, non per angolo)
    segs = [(l[i], l[i + 1]) for l in streets for i in range(len(l) - 1)]
    near = lambda x, y, r: [q for q in segs if min(q[0][0], q[1][0]) - r < x < max(q[0][0], q[1][0]) + r and min(q[0][1], q[1][1]) - r < y < max(q[0][1], q[1][1]) + r]
    vc = {}
    for v in bm.verts:
        x, y, z = v.co
        steep = 1 - v.normal.z
        c = Vector((0.13, 0.17, 0.07)) * (0.85 + 0.3 * N(x, y, 9, 2))
        if inside((x, y), P["walls"]):
            c = Vector((0.2, 0.17, 0.12))
        if any(seg((x, y), a, b) < 3.5 for a, b in near(x, y, 3.5)):
            c = Vector((0.33, 0.3, 0.26))
        if steep > 0.25:
            c = c.lerp(Vector((0.3, 0.29, 0.27)), min(1, (steep - 0.25) * 4))
        if rdist((x, y)) < rw / 2 + 3:
            c = Vector((0.18, 0.16, 0.12))
        vc[v] = (*c, 1)
    for f in bm.faces:
        for l in f.loops:
            l[col] = vc[l.vert]
    obj("terreno", bm, mat("terreno", (0.2, 0.2, 0.2), vcol=True))

    # ── l'acqua ──
    bm = bmesh.new()
    cylinder(bm, 0, 0, P["water"] - 0.05, 232, 0.05, 48)   # (un piano solo: il terreno lo copre dove non c'è l'alveo)
    w = obj("acqua", bm, mat("acqua", (0.03, 0.06, 0.07), rough=0.05))

    # ── le mura con le torri ──
    bm = bmesh.new()
    wall = P["walls"]
    for i in range(len(wall)):
        (ax, ay), (bx, by) = wall[i - 1], wall[i]
        L = math.hypot(bx - ax, by - ay)
        k = max(1, int(L / 6))
        for t in range(k):
            px, py = ax + (bx - ax) * (t + 0.5) / k, ay + (by - ay) * (t + 0.5) / k
            if rdist((px, py)) < rw / 2 + 2 or min(pdist((px, py), s) for s in streets) < 3.5:
                continue
            g = ground(px, py)
            box(bm, px, py, g - 4, L / k + 0.2, 2.4, 13, math.atan2(by - ay, bx - ax))
        g = ground(bx, by)
        box(bm, bx, by, g - 4, 8, 8, 20)
        roof(bm, bx, by, g + 16, 8, 8, 6, hip=True)
    obj("mura", bm, mat("pietra", (0.24, 0.23, 0.21)))

    # ── edifici speciali ──
    sp = P["special"]
    taken = []   # (x, y, raggio) occupati
    stone = mat("pietra_chiara", (0.36, 0.34, 0.3))
    slate = mat("ardesia", (0.09, 0.1, 0.12), rough=0.6)
    glow = mat("finestre", (0.1, 0.06, 0.02), emit=(1.0, 0.55, 0.2))

    def footing(x, y, r):
        return min(ground(x + dx, y + dy) for dx in (-r, 0, r) for dy in (-r, 0, r))

    c = sp["cattedrale"]
    (cx, cy), yaw = c["at"], math.radians(c["yaw"])
    ux, uy = math.cos(yaw), math.sin(yaw)          # lungo la navata, dal portale all'abside
    g = footing(cx, cy, 20)
    top = h(cx, cy)
    bm, br = bmesh.new(), bmesh.new()
    box(bm, cx, cy, g - 2, 76, 32, top - g + 2, yaw)                       # il basamento (il sagrato a terrazza)
    g = top - 1
    box(bm, cx, cy, g - 8, 64, 22, top - g + 8 + 26, yaw)                  # navata
    roof(br, cx, cy, top + 26, 64, 22, 14, yaw, over=0.8)
    box(bm, cx + ux * 8, cy + uy * 8, g - 8, 14, 40, top - g + 8 + 22, yaw)  # transetto
    roof(br, cx + ux * 8, cy + uy * 8, top + 22, 40, 14, 11, yaw + math.pi / 2)
    for sgn in (-1, 1):                                                    # le due torri della facciata
        tx, ty = cx - ux * 34 - uy * 9 * sgn, cy - uy * 34 + ux * 9 * sgn
        box(bm, tx, ty, g - 8, 11, 11, top - g + 8 + 48, yaw)
        cylinder(br, tx, ty, top + 48, 5.2, 0.1, 8, cone=24)
    cylinder(bm, cx + ux * 32, cy + uy * 32, g - 8, 11, top - g + 8 + 24, 12)   # abside
    cylinder(br, cx + ux * 32, cy + uy * 32, top + 24, 11.6, 0.1, 12, cone=9)
    obj("cattedrale", bm, stone); obj("cattedrale_tetti", br, slate)
    taken.append((cx, cy, 40))

    c = sp["municipio"]
    (mx, my), yaw = c["at"], math.radians(c["yaw"])
    g, top = footing(mx, my, 12), h(mx, my)
    bm, br = bmesh.new(), bmesh.new()
    box(bm, mx, my, g - 3, 26, 15, top - g + 3 + 16, yaw)
    roof(br, mx, my, top + 16, 26, 15, 6, yaw, hip=True)
    box(bm, mx + math.cos(yaw) * 10, my + math.sin(yaw) * 10, g - 3, 6, 6, top - g + 3 + 34, yaw)
    roof(br, mx + math.cos(yaw) * 10, my + math.sin(yaw) * 10, top + 34, 6, 6, 7, yaw, hip=True)
    obj("municipio", bm, stone); obj("municipio_tetti", br, slate)
    taken.append((mx, my, 16))

    c = sp["teatro"]
    (tx, ty), yaw, kind = c["at"], math.radians(c["yaw"]), c["kind"]
    top = h(tx, ty)
    bm, br = bmesh.new(), bmesh.new()
    if kind == "cavea":   # gradinate a semicerchio scavate nel pendio, la scena davanti
        for k in range(9):
            r = 9 + k * 2.6
            for i in range(14):
                a0 = yaw - math.pi / 2 + i / 14 * math.pi
                box(bm, tx + math.cos(a0) * r, ty + math.sin(a0) * r, top - 6, r * math.pi / 14 + 0.6, 2.6, 6 + k * 1.1, a0 + math.pi / 2)
        box(bm, tx - math.cos(yaw) * 6, ty - math.sin(yaw) * 6, top - 6, 4, 30, 18, yaw)
        roof(br, tx - math.cos(yaw) * 6, ty - math.sin(yaw) * 6, top + 12, 30, 4, 2.5, yaw + math.pi / 2)
    elif kind == "tondo":   # un tamburo di legno a gallerie, tetto a corona
        g = footing(tx, ty, 18)
        cylinder(bm, tx, ty, g - 3, 18, top - g + 3 + 15, 20)
        cylinder(br, tx, ty, top + 15, 19.5, 0.1, 20, cone=0)
        cylinder(br, tx, ty, top + 15, 19.5, 5, 20, r2=11)
        cylinder(bm, tx, ty, top + 0.5, 10.8, 0.4, 20)
    else:   # coperto: un teatro all'italiana, scatola con la cavea curva
        g = footing(tx, ty, 16)
        box(bm, tx, ty, g - 3, 34, 24, top - g + 3 + 20, yaw)
        cylinder(bm, tx + math.cos(yaw) * 17, ty + math.sin(yaw) * 17, g - 3, 12, top - g + 3 + 20, 16)
        roof(br, tx, ty, top + 20, 34, 24, 8, yaw, hip=True)
        box(bm, tx - math.cos(yaw) * 19, ty - math.sin(yaw) * 19, top - 1, 4, 18, 9, yaw)   # il portico d'ingresso
    obj("teatro", bm, mat("teatro", (0.5, 0.42, 0.32) if kind != "coperto" else (0.6, 0.5, 0.42)))
    obj("teatro_tetti", br, mat("teatro_tetto", (0.3, 0.12, 0.08)))
    taken.append((tx, ty, 26))

    px, py = sp["piazza"]["at"]
    taken.append((px, py, sp["piazza"]["r"]))
    bm = bmesh.new()
    g = h(px, py)
    cylinder(bm, px, py, g - 0.2, 2.5, 1.0, 12)
    cylinder(bm, px, py, g, 0.5, 3.2, 8)
    obj("fontana", bm, stone)

    # ── i ponti ──
    for b in P["bridges"]:
        (ax, ay), (bx, by) = b["a"], b["b"]
        L, a = math.hypot(bx - ax, by - ay), math.atan2(by - ay, bx - ax)
        mx, my = (ax + bx) / 2, (ay + by) / 2
        deck = b.get("deck", max(ground(ax, ay), ground(bx, by)) + 0.5)
        if b["kind"] == "porta":
            deck = max(ground(ax, ay), ground(bx, by)) + 0.3
        bm = bmesh.new()
        box(bm, mx, my, deck - 1.2, L + 4, 7 if b["kind"] != "passerella" else 3, 1.2, a)
        nseg = max(2, int(L / 14))
        for k in range(1, nseg if b["kind"] != "alto" else 1):   # le pile, fino all'alveo
            qx, qy = ax + (bx - ax) * k / nseg, ay + (by - ay) * k / nseg
            box(bm, qx, qy, P["water"] - 4, 3, 8, deck - 1.2 - P["water"] + 4, a)
        if b["kind"] == "alto":                      # l'arco unico sulla gola
            for k in range(13):
                t = k / 12
                qx, qy = ax + (bx - ax) * t, ay + (by - ay) * t
                z = deck - 2 - 14 * (1 - (2 * t - 1) ** 2) ** 0.5 * 0 - (1 - math.sin(t * math.pi)) * 16
                box(bm, qx, qy, z, L / 12 + 0.5, 6, 2.5, a)
        for sgn in (-1, 1):                          # i parapetti
            box(bm, mx - math.sin(a) * 3.3 * sgn, my + math.cos(a) * 3.3 * sgn, deck, L + 4, 0.5, 1.1, a)
        obj(f"ponte_{b['kind']}", bm, stone)
        if b["kind"] == "case":                      # le botteghe sul ponte, alla Ponte Vecchio
            bm, br = bmesh.new(), bmesh.new()
            for k in range(int(L / 7)):
                for sgn in (-1, 1):
                    t = (k + 0.5) / int(L / 7)
                    qx, qy = ax + (bx - ax) * t - math.sin(a) * 6 * sgn, ay + (by - ay) * t + math.cos(a) * 6 * sgn
                    hh = 7 + rnd.random() * 4
                    box(bm, qx, qy, deck - 2.5, 6.4, 5, hh + 2.5, a)
                    roof(br, qx, qy, deck + hh, 6.4, 5, 2.5, a + math.pi / 2)
            obj("ponte_case", bm, mat("intonaco_medio", (0.55, 0.45, 0.33)))
            obj("ponte_tetti", br, mat("coppi", (0.33, 0.13, 0.08)))
        if b["kind"] == "porta":                     # la torre della porta in capo al ponte
            bm = bmesh.new()
            box(bm, bx + 3, by, deck - 3, 12, 14, 24, a)
            roof(bm, bx + 3, by, deck + 21, 12, 14, 6, a, hip=True)
            obj("porta", bm, mat("pietra", (0.24, 0.23, 0.21)))
        taken.append((mx, my, L / 2 + 4))

    # ── le case lungo le vie: povere, medie, ricche ──
    STYLE = {
        "poor": dict(w=(7, 9), d=(6.5, 8.5), h=(4.5, 6.5), wall=(0.17, 0.14, 0.11), roof=(0.2, 0.15, 0.08), rise=3.2, gap=1.0),
        "mid": dict(w=(8.5, 11), d=(9, 12), h=(9, 13), wall=(0.4, 0.34, 0.25), roof=(0.33, 0.13, 0.08), rise=4.5, gap=0.6),
        "rich": dict(w=(13, 17), d=(12, 16), h=(14, 19), wall=(0.48, 0.45, 0.39), roof=(0.11, 0.12, 0.14), rise=3.5, gap=4.0),
    }
    meshes = {q: (bmesh.new(), bmesh.new()) for q in STYLE}
    lit = bmesh.new()
    count = {q: 0 for q in STYLE}

    # il cannocchiale: dall'ingresso alla cattedrale niente case per tre quarti della strada (la si deve vedere entrando)
    cor = None
    if "ingresso" in P["cams"]:
        (ix, iy, _), cc = P["cams"]["ingresso"][0], P["special"]["cattedrale"]["at"]
        cor = ((ix, iy), (ix + (cc[0] - ix) * 0.75, iy + (cc[1] - iy) * 0.75))

    def free(x, y, r):
        if cor and seg((x, y), *cor) < r + 3.5:
            return False
        if not (inside((x, y), P["walls"]) or inside((x, y), P.get("borgo", []))) or rdist((x, y)) < rw / 2 + r + 2:
            return False
        if min(pdist((x, y), s) for s in streets) < r * 0.55 + 2.4:
            return False
        return all(math.hypot(x - a, y - b) > r + rr for a, b, rr in taken)

    for line in streets:
        for i in range(len(line) - 1):
            (ax, ay), (bx, by) = line[i], line[i + 1]
            L, a = math.hypot(bx - ax, by - ay), math.atan2(by - ay, bx - ax)
            for sgn in (-1, 1):
                t = 0.0
                while t < L:
                    q = P["quarter"](ax + (bx - ax) * t / L, ay + (by - ay) * t / L)
                    S_ = STYLE[q]
                    w, d, hh = (rnd.uniform(*S_[k]) for k in ("w", "d", "h"))
                    t += w / 2
                    off = 3.2 + d / 2
                    x = ax + (bx - ax) * t / L - math.sin(a) * off * sgn
                    y = ay + (by - ay) * t / L + math.cos(a) * off * sgn
                    r = math.hypot(w, d) / 2 * 0.8
                    if free(x, y, r):
                        g, top = footing(x, y, r * 0.7), ground(x, y)
                        yaw = a + rnd.uniform(-0.04, 0.04)
                        bw, bwr = meshes[q]
                        box(bw, x, y, g - 2, w, d, top - g + 2 + hh, yaw)
                        roof(bwr, x, y, top + hh, d, w, S_["rise"] if q != "rich" else 4, yaw + math.pi / 2, hip=q == "rich")
                        if q == "rich" and rnd.random() < 0.25:     # la torre di famiglia
                            box(bw, x + w / 4, y, top, 4.5, 4.5, hh + 10, yaw)
                        if rnd.random() < 0.35:                       # una finestra accesa
                            box(lit, x + math.sin(a) * (d / 2 + 0.06) * sgn, y - math.cos(a) * (d / 2 + 0.06) * sgn, top + hh * 0.55, 1.0, 0.05, 1.5, a)
                        taken.append((x, y, r))
                        count[q] += 1
                    t += w / 2 + S_["gap"]
    def near_dir(x, y):
        best, a = 1e9, 0.0
        for line in streets:
            for i in range(len(line) - 1):
                d = seg((x, y), line[i], line[i + 1])
                if d < best:
                    best, a = d, math.atan2(line[i + 1][1] - line[i][1], line[i + 1][0] - line[i][0])
        return a

    for k in range(5000):   # gli isolati si riempiono: case dietro le case, girate come la via più vicina
        x, y = rnd.uniform(-130, 130), rnd.uniform(-130, 130)
        q = P["quarter"](x, y)
        S_ = STYLE[q]
        w, d, hh = (rnd.uniform(*S_[k2]) for k2 in ("w", "d", "h"))
        r = math.hypot(w, d) / 2 * 0.8
        if not free(x, y, r):
            continue
        a = near_dir(x, y) + rnd.choice((0, math.pi / 2)) + rnd.uniform(-0.05, 0.05)
        g, top = footing(x, y, r * 0.7), ground(x, y)
        bw, bwr = meshes[q]
        box(bw, x, y, g - 2, w, d, top - g + 2 + hh, a)
        roof(bwr, x, y, top + hh, d, w, S_["rise"], a + math.pi / 2, hip=q == "rich")
        taken.append((x, y, r))
        count[q] += 1

    for q, (bw, bwr) in meshes.items():
        obj(f"case_{q}", bw, mat(f"muro_{q}", STYLE[q]["wall"]))
        obj(f"tetti_{q}", bwr, mat(f"tetto_{q}", STYLE[q]["roof"]))
    obj("finestre_accese", lit, glow)

    # ── il bosco fuori dalle mura ──
    bm = bmesh.new()
    for k in range(2600):
        x, y = rnd.uniform(-225, 225), rnd.uniform(-225, 225)
        if inside((x, y), P["walls"]) or inside((x, y), P.get("borgo", [])) or rdist((x, y)) < rw + 4 or min(pdist((x, y), s) for s in streets) < 7:
            continue
        if any(math.hypot(x - b["a"][0], y - b["a"][1]) < 25 for b in P["bridges"]) or math.hypot(x - cx, y - cy) < 75:
            continue
        if N(x, y, 40, 11) < -0.15:
            continue
        g, s = ground(x, y), rnd.uniform(0.7, 1.4)
        if g > 70:
            continue
        cylinder(bm, x, y, g - 0.5, 0.35 * s, 3 * s, 5)
        cylinder(bm, x, y, g + 2 * s, 2.6 * s, 0.1, 7, cone=9 * s)
    obj("bosco", bm, mat("abeti", (0.04, 0.07, 0.04)))

    # ── la pianura fra il terreno e le montagne ──
    bm = bmesh.new()
    cylinder(bm, 0, 0, -26, 3200, 0.1, 64)
    obj("pianura", bm, haze(mat("pianura", (0.05, 0.07, 0.04))))

    # ── le montagne sullo sfondo: un anello frastagliato, con la neve in cima ──
    a0, a1 = P.get("mountains", (0, 360))
    bm = bmesh.new()
    rows, cols_ = 40, 360
    grid = []
    for j in range(rows):
        rr = 520 + j * 40
        row = []
        for i in range(cols_):
            t = i / (cols_ - 1) * math.tau   # (tutto attorno: da ogni parte, sullo sfondo)
            x, y = math.cos(t) * rr, math.sin(t) * rr
            ridge = 1 - abs(N(x, y, 420, 21))
            z = (ridge ** 1.6) * 380 * sstep(520, 950, rr) + N(x, y, 140, 22) * 45 * sstep(520, 800, rr) - 30
            row.append(bm.verts.new((x, y, max(z, 0))))
        grid.append(row)
    for j in range(rows - 1):
        for i in range(cols_ - 1):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    col = bm.loops.layers.color.new("col")
    bm.normal_update()
    for f in bm.faces:
        for l in f.loops:
            z, steep = l.vert.co.z, 1 - l.vert.normal.z
            c = Vector((0.16, 0.17, 0.15)).lerp(Vector((0.3, 0.3, 0.32)), min(1, z / 220))
            if z > 230 and steep < 0.45:
                c = Vector((0.85, 0.87, 0.9))
            l[col] = (*c, 1)
    obj("montagne", bm, haze(mat("montagne", (0.3, 0.3, 0.3), vcol=True), 500, 2600))

    # ── luce e cielo ──
    elev, rot = P["sun"]
    sun = bpy.data.objects.new("sole", bpy.data.lights.new("sole", "SUN"))
    scene.collection.objects.link(sun)
    sun.data.energy = 3.0
    sun.data.angle = math.radians(1.5)
    sun.data.color = (1.0, 0.86, 0.7)
    sun.rotation_euler = (math.radians(90 - elev), 0, math.radians(rot))
    world = bpy.data.worlds.new("cielo")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes.get("Background")
    try:
        sky = nt.nodes.new("ShaderNodeTexSky")
        sky.sky_type = "MULTIPLE_SCATTERING"
        sky.sun_elevation, sky.sun_rotation = math.radians(elev), math.radians(rot + 90)
        nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 0.08
    except Exception as e:  # (cielo a tinta unita se il nodo non c'è)
        print("cielo:", e)
        bg.inputs["Color"].default_value = (0.35, 0.42, 0.5, 1)
    # foschia: un volume nel mondo, che allontana le montagne
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = 0.0009
    vol.inputs["Color"].default_value = (0.6, 0.66, 0.75, 1)
    nt.nodes.remove(vol)   # (il volume nel mondo anneriva tutto in EEVEE: la foschia sta nei materiali lontani, `haze`)

    scene.render.engine = "BLENDER_EEVEE"
    ee = scene.eevee
    for k, v in (("taa_render_samples", 16 if FAST else 48), ("use_shadows", True), ("volumetric_end", 2500), ("volumetric_tile_size", "4")):
        try:
            setattr(ee, k, v)
        except Exception:
            pass
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    scene.render.resolution_x, scene.render.resolution_y = (960, 540) if FAST else (1600, 900)
    P["ground"], P["cat"] = ground, (cx, cy, h(cx, cy))
    return count


def shoot(P, key, tag):
    scene = bpy.context.scene
    cam_def = P["cams"][key]
    if cam_def[1] == "cat":   # verso la cattedrale, alla sua facciata
        cx, cy, ct = P["cat"]
        look = Vector((cx, cy, ct + 26))
    else:
        look = Vector(cam_def[1])
    if cam_def[0] is None:   # dalla cattedrale: appena fuori dal muro che guarda il bersaglio, all'altezza delle vetrate
        cx, cy, ct = P["cat"]
        d = Vector((look.x - cx, look.y - cy, 0)).normalized()
        pos = Vector((cx, cy, ct + 14)) + d * 47
    else:
        x_, y_, z_ = cam_def[0]
        pos = Vector((x_, y_, z_ if z_ is not None else P["ground"](x_, y_) + 1.7))   # (senza quota: all'altezza degli occhi)
    for o in [o for o in scene.objects if o.name.startswith("_")]:
        bpy.data.objects.remove(o)
    cam = bpy.data.objects.new("_cam", bpy.data.cameras.new("_cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = pos
    cam.rotation_euler = (look - pos).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 30 if key == "veduta" else 24
    cam.data.clip_end = 5000
    if len(cam_def) > 2:   # dalla finestra della cattedrale: un muro con una bifora davanti all'obiettivo
        d = (look - pos).normalized()
        wall = bpy.data.objects.new("_muro", bpy.data.meshes.new("_muro"))
        scene.collection.objects.link(wall)
        bm = bmesh.new()
        c = pos + d * 3.4
        right = d.cross(Vector((0, 0, 1))).normalized()
        up = right.cross(d).normalized()
        # un muro a fette attorno a due lancette a sesto acuto (larghe 0,9, alte 3,2, distanti 1,2)
        def q(u, v):
            return bm.verts.new(c + right * u + up * v)
        W, H, step = 9.0, 7.0, 0.03
        def open_at(u, v):
            for cu in (-0.62, 0.62):
                x = abs(u - cu)
                if x < 0.45 and -1.8 < v < 1.0:
                    return True
                if x < 0.45 and v >= 1.0 and (x + 0.45) ** 2 + (v - 1.0) ** 2 < 0.9 ** 2:
                    return True
            return False
        nu, nv = int(W / step), int(H / step)
        for i in range(nu):
            for j in range(nv):
                u0, v0 = -W / 2 + i * step, -H / 2 + j * step
                if not open_at(u0 + step / 2, v0 + step / 2):
                    bm.faces.new((q(u0, v0), q(u0 + step, v0), q(u0 + step, v0 + step), q(u0, v0 + step)))
        bm.to_mesh(wall.data)
        bm.free()
        wall.data.materials.append(mat("muro_interno", (0.05, 0.045, 0.04)))
        cam.data.lens = 18
    scene.render.filepath = os.path.join(OUT, f"{tag}_{key}.png")
    bpy.ops.render.render(write_still=True)


def top(P, tag):
    """La pianta vista dall'alto, ortografica."""
    scene = bpy.context.scene
    cam = bpy.data.objects.new("_top", bpy.data.cameras.new("_top"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 300
    cam.data.clip_end = 3000
    cam.location = (0, 0, 600)
    cam.rotation_euler = (0, 0, 0)
    rx, ry = scene.render.resolution_x, scene.render.resolution_y
    scene.render.resolution_x = scene.render.resolution_y = 900 if not FAST else 600
    scene.render.filepath = os.path.join(OUT, f"{tag}_pianta.png")
    bpy.ops.render.render(write_still=True)
    scene.render.resolution_x, scene.render.resolution_y = rx, ry
    bpy.data.objects.remove(cam)


if __name__ == "__main__":   # (importato da meandro.py: solo i piani, niente render)
    for tag, f in (("A", plan_A), ("B", plan_B), ("C", plan_C), ("D", plan_D), ("E", plan_E), ("F", plan_F)):
        if tag not in WHICH:
            continue
        P = f()
        n = build(P)
        print(P["name"], "case:", n)
        for key in P["cams"]:
            shoot(P, key, tag)
        top(P, tag)
