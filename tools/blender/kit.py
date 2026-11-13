# ─────────────────────────────────────────────────────────────────────────────
# KIT — i pezzi con cui il gioco monta scale, parapetti e travature, costruiti con Blender.
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tools/blender/kit.py
#
# Scrive `public/kit/kit.json` (la geometria di ogni pezzo, un blocco per materiale del gioco:
# posizioni, normali, occlusione cotta nei vertici, indici) e `docs/reference/kit/kit.png` (una
# tavola per guardarli). Il gioco li carica con `src/world/kit.ts` e li posa col suo muratore: le
# uv le calcola lui dalle posizioni (come per il resto della città), così le texture non si stirano
# quando un pezzo viene allungato.
#
# Convenzioni: metri; +Y in alto NEL GIOCO (qui Blender ha +Z in alto: si converte all'uscita);
# ogni pezzo ha l'origine dove lo si appoggia. I nomi dei materiali sono le chiavi del gioco
# ("wood", "timber", "iron"…).
# ─────────────────────────────────────────────────────────────────────────────
import bpy, bmesh, json, math, os
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "public", "kit", "kit.json")
PNG = os.path.join(ROOT, "docs", "reference", "kit", "kit.png")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
MATS = {}

def mat(name, rgb):
    if name not in MATS:
        m = bpy.data.materials.new(name); m.diffuse_color = (*rgb, 1); m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf: bsdf.inputs["Base Color"].default_value = (*rgb, 1); bsdf.inputs["Roughness"].default_value = 0.8
        MATS[name] = m
    return MATS[name]

WOOD, TIMBER, IRON = ("wood", (0.36, 0.25, 0.16)), ("timber", (0.22, 0.15, 0.1)), ("iron", (0.12, 0.12, 0.13))

def obj_from(bm, name, material):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    ob.data.materials.append(mat(*material))
    return ob

def box(name, x0, y0, z0, x1, y1, z1, material, bevel=0.006, segs=2):
    """Una scatola (coordinate di Blender: z in alto) con gli spigoli smussati."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0), (y0 + y1) / 2 + v.co.y * (y1 - y0), (z0 + z1) / 2 + v.co.z * (z1 - z0)))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, 0.45 * min(x1 - x0, y1 - y0, z1 - z0)), segments=segs, affect='EDGES', profile=0.6)
    return obj_from(bm, name, material)

def lathe(name, profile, material, sides=14, x=0.0, y=0.0):
    """Un solido di rivoluzione attorno all'asse verticale: profilo [(raggio, quota)…] dal basso in alto, chiuso in cima e in fondo."""
    bm = bmesh.new(); rings = []
    for r, z in profile:
        rings.append([bm.verts.new((x + math.cos(i / sides * 2 * math.pi) * r, y + math.sin(i / sides * 2 * math.pi) * r, z)) for i in range(sides)])
    for a, b in zip(rings, rings[1:]):
        for i in range(sides): bm.faces.new((a[i], a[(i + 1) % sides], b[(i + 1) % sides], b[i]))
    bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    for f in bm.faces: f.smooth = len(f.verts) == 4
    return obj_from(bm, name, material)

def join(name, parts):
    """Più oggetti in un pezzo solo (restano i loro materiali)."""
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    parts[0].name = name
    return parts[0]

PIECES = {}

# ── gradino: la pedata, larga 1 m (x da −0,5 a 0,5), profonda 30 cm con un naso che sporge di 3, spessa 4,5; il piano sta a quota 0.
#    Sotto il naso un listello. Nel gioco si allarga lungo x quanto è larga la scala.
PIECES["gradino"] = join("gradino", [
    box("p", -0.5, -0.03, -0.045, 0.5, 0.30, 0.0, WOOD, 0.009, 3),
    box("l", -0.5, 0.0, -0.075, 0.5, 0.022, -0.045, TIMBER, 0.004, 1),
])

# ── montante: il pilastrino a cui si attacca il corrimano. 10 × 10 cm, alto 1,12 m, con lo zoccolo, due gole e il pomo in cima; poggia a quota 0.
PIECES["montante"] = join("montante", [
    box("f", -0.045, -0.045, 0.0, 0.045, 0.045, 1.0, TIMBER, 0.007, 2),
    box("z", -0.058, -0.058, 0.0, 0.058, 0.058, 0.16, TIMBER, 0.006, 2),
    box("c", -0.058, -0.058, 0.9, 0.058, 0.058, 1.0, TIMBER, 0.006, 2),
    lathe("pomo", [(0.0, 1.0), (0.05, 1.0), (0.056, 1.02), (0.03, 1.035), (0.03, 1.045), (0.058, 1.07), (0.06, 1.09), (0.045, 1.115), (0.0, 1.125)], TIMBER, 12),
])

# ── colonnino: tornito, alto 85 cm (si accorcia o si allunga nel gioco), col fuso a pancia fra due dadi; poggia a quota 0.
PIECES["colonnino"] = join("colonnino", [
    box("d0", -0.022, -0.022, 0.0, 0.022, 0.022, 0.12, WOOD, 0.004, 1),
    box("d1", -0.022, -0.022, 0.73, 0.022, 0.022, 0.85, WOOD, 0.004, 1),
    lathe("fuso", [(0.012, 0.12), (0.022, 0.135), (0.024, 0.15), (0.013, 0.17), (0.013, 0.2), (0.021, 0.26), (0.026, 0.36), (0.022, 0.47), (0.015, 0.58), (0.013, 0.66), (0.013, 0.69), (0.024, 0.705), (0.022, 0.72), (0.012, 0.73)], WOOD, 10),
])

# ── corrimano: un metro di corrimano lungo +Y di Blender (nel gioco +Z), col dorso tondo e la gola sotto dove entrano i colonnini; il sotto a quota 0.
bm = bmesh.new()
PROFILE = [(-0.034, 0.0), (-0.036, 0.022), (-0.03, 0.045), (-0.016, 0.058), (0.0, 0.062), (0.016, 0.058), (0.03, 0.045), (0.036, 0.022), (0.034, 0.0), (0.02, 0.0), (0.02, 0.012), (-0.02, 0.012), (-0.02, 0.0)]
a = [bm.verts.new((x, 0.0, z)) for x, z in PROFILE]; b = [bm.verts.new((x, 1.0, z)) for x, z in PROFILE]
for i in range(len(PROFILE)):
    f = bm.faces.new((a[i], b[i], b[(i + 1) % len(PROFILE)], a[(i + 1) % len(PROFILE)])); f.smooth = 2 <= i <= 6
bm.faces.new(a); bm.faces.new(list(reversed(b)))
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
PIECES["corrimano"] = obj_from(bm, "corrimano", WOOD)

# ── trave: un metro di trave 16 × 20 cm lungo +Y di Blender (nel gioco +Z), con gli spigoli smussati a colpi d'ascia; il sotto a quota 0.
PIECES["trave"] = box("trave", -0.08, 0.0, 0.0, 0.08, 1.0, 0.2, TIMBER, 0.014, 1)

# ── anta: un battente di tavole, 1 m di larghezza (lungo +Y di Blender, nel gioco +Z, dal cardine), 2,1 m d'altezza, spesso 5 cm
#    (x da −0,05 a 0). Sulla faccia a x = 0, quella verso cui si apre: tre traverse, due bandelle di ferro coi chiodi, l'anello.
#    Nel gioco si adatta in larghezza, altezza e spessore; per l'altro verso d'apertura si gira di mezzo giro.
parts = [box(f"t{i}", -0.05, i * 0.2 + 0.003, 0.0, 0.0, (i + 1) * 0.2 - 0.003, 2.1, WOOD, 0.006, 2) for i in range(5)]
for z in (0.32, 1.02, 1.72): parts.append(box(f"tr{z}", 0.0, 0.03, z, 0.026, 0.97, z + 0.11, TIMBER, 0.006, 1))
for z in (0.355, 1.755):
    parts.append(box(f"b{z}", 0.026, 0.0, z, 0.034, 0.72, z + 0.04, IRON, 0.003, 1))
    parts.append(lathe(f"c{z}", [(0.0, z - 0.03), (0.016, z - 0.03), (0.016, z + 0.07), (0.0, z + 0.07)], IRON, 8, 0.012, 0.0))
    for y in (0.08, 0.3, 0.52, 0.68): parts.append(box(f"n{z}{y}", 0.034, y - 0.009, z + 0.011, 0.041, y + 0.009, z + 0.029, IRON, 0.003, 1))   # le teste dei chiodi
bpy.ops.mesh.primitive_torus_add(major_radius=0.05, minor_radius=0.008, major_segments=14, minor_segments=6, location=(0.045, 0.88, 1.02), rotation=(0.0, math.radians(90), 0.0))
ring = bpy.context.active_object; ring.data.materials.append(mat(*IRON)); parts.append(ring)
parts.append(box("pl", 0.026, 0.84, 1.03, 0.032, 0.92, 1.1, IRON, 0.003, 1))
PIECES["anta"] = join("anta", parts)

# ── imposta: uno scuro di tre tavole, largo 50 cm dal cardine (x da 0 a 0,5), alto 1 m, spesso 3 cm; sul davanti (verso chi guarda,
#    +Y di Blender = +Z del gioco) due traverse, la saetta fra l'una e l'altra, due bandelle di ferro. Nel gioco si adatta alla finestra;
#    quella dell'altro lato è la stessa girata di mezzo giro nel piano della facciata.
parts = [box(f"s{i}", i * 0.1667 + 0.002, 0.0, 0.0, (i + 1) * 0.1667 - 0.002, 0.03, 1.0, WOOD, 0.005, 2) for i in range(3)]
for z in (0.14, 0.78): parts.append(box(f"st{z}", 0.02, 0.03, z, 0.48, 0.052, z + 0.08, TIMBER, 0.005, 1))
brace = box("sa", -0.33, 0.03, -0.03, 0.33, 0.05, 0.03, TIMBER, 0.005, 1)
brace.rotation_euler = (0.0, -math.atan2(0.48, 0.4), 0.0); brace.location = (0.25, 0.0, 0.5); parts.append(brace)
for z in (0.165, 0.805):
    parts.append(box(f"sb{z}", 0.0, 0.052, z, 0.3, 0.058, z + 0.03, IRON, 0.002, 1))
    parts.append(lathe(f"sc{z}", [(0.0, z - 0.02), (0.012, z - 0.02), (0.012, z + 0.05), (0.0, z + 0.05)], IRON, 8, -0.006, 0.04))
PIECES["imposta"] = join("imposta", parts)

# ── piombi: la rete dei piombi di una vetrata, per un vano di 1 × 1 m (x e quota da 0 a 1), spessa 6 mm: tre montanti e sette traversi.
parts = [box(f"pv{i}", i * 0.25 - 0.006, 0.0, 0.0, i * 0.25 + 0.006, 0.006, 1.0, IRON, 0) for i in (1, 2, 3)]
parts += [box(f"ph{i}", 0.0, 0.0, i * 0.125 - 0.006, 1.0, 0.006, i * 0.125 + 0.006, IRON, 0) for i in range(1, 8)]
PIECES["piombi"] = join("piombi", parts)

# ════ pietra scolpita: rosone, trafori, guglia, colonnina ════
STONE = ("stone", (0.5, 0.47, 0.42))

def named(name, material):
    # (posizione e rotazione vanno "applicate" alla mesh: il primo oggetto di un `join` tiene il suo riferimento, e l'uscita legge le coordinate locali)
    ob = bpy.context.active_object; ob.name = name; ob.data.materials.append(mat(*material))
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob

def cyl(name, r, y0, y1, x, z, material, segs=20):
    """Un cilindro con l'asse lungo +Y di Blender (verso chi guarda la facciata), centrato in (x, z)."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=segs, radius=r, depth=y1 - y0, location=(x, (y0 + y1) / 2, z), rotation=(math.radians(90), 0, 0))
    return named(name, material)

def torus(name, R, r, y, x, z, material, segs=24):
    """Una modanatura tonda sul piano della facciata."""
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=segs, minor_segments=6, location=(x, y, z), rotation=(math.radians(90), 0, 0))
    return named(name, material)

def prism(name, pts, y0, y1, material):
    """Un poligono sul piano della facciata [(x, z)…] estruso lungo y."""
    bm = bmesh.new(); n = len(pts)
    a = [bm.verts.new((x, y0, z)) for x, z in pts]; b = [bm.verts.new((x, y1, z)) for x, z in pts]
    for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(a); bm.faces.new(list(reversed(b)))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return obj_from(bm, name, material)

def cut(ob, cutters):
    """Toglie i `cutters` da `ob` (booleana esatta) e li butta."""
    c = join("taglio", cutters) if len(cutters) > 1 else cutters[0]
    m = ob.modifiers.new("b", 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = c; m.solver = 'EXACT'; m.use_self = True
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier="b")
    bpy.data.objects.remove(c, do_unlink=True)
    return ob

def soften(ob, angle=40):
    """Facce lisce, spigoli vivi solo oltre `angle` gradi."""
    for f in ob.data.polygons: f.use_smooth = True
    ob.data.set_sharp_from_angle(angle=math.radians(angle))
    return ob

def rot2(x, z, a): return (x * math.cos(a) - z * math.sin(a), x * math.sin(a) + z * math.cos(a))

# ── rosone: sul modello del rosone ovest di Chartres (traforo a lastra). Raggio 1 (nel gioco si ingrandisce), centro nell'origine,
#    sul piano della facciata; la lastra è spessa 12 cm (y da 0 a 0,12), le modanature sporgono fino a 0,17. Dal centro: l'occhio,
#    dodici luci a petalo fra dodici colonnine a raggiera, la corona di dodici tondi a quadrilobo, dodici tondini verso il bordo.
plate = cyl("rosone", 1.0, 0.0, 0.12, 0, 0, STONE, 48)
cutters = [cyl("occhio", 0.16, -0.1, 0.3, 0, 0, STONE, 20)]
PETALO = [(0.24, -0.034), (0.48, -0.1)] + [(0.48 + 0.1 * math.cos(t), 0.1 * math.sin(t)) for t in [(-0.5 + k / 8) * math.pi for k in range(1, 8)]] + [(0.48, 0.1), (0.24, 0.034)]
for i in range(12):
    a = i / 12 * 2 * math.pi; b = a + math.pi / 12
    cutters.append(prism(f"petalo{i}", [rot2(x, z, a) for x, z in PETALO], -0.1, 0.3, STONE))
    cx, cz = rot2(0.745, 0, a)
    cutters.append(cyl(f"t{i}", 0.05, -0.1, 0.3, cx, cz, STONE, 12))
    for k in range(4):                                                                    # i quattro lobi
        lx, lz = rot2(0.052, 0, a + k * math.pi / 2 + math.pi / 4)
        cutters.append(cyl(f"l{i}{k}", 0.058, -0.1, 0.3, cx + lx, cz + lz, STONE, 12))
    cutters.append(cyl(f"q{i}", 0.04, -0.1, 0.3, *rot2(0.905, 0, b), STONE, 10))
parts = [soften(cut(plate, cutters))]
parts.append(torus("bordo", 0.975, 0.05, 0.11, 0, 0, STONE, 48)); parts.append(torus("bordo2", 0.885, 0.018, 0.12, 0, 0, STONE, 48))
parts.append(torus("occhio", 0.185, 0.026, 0.12, 0, 0, STONE, 20)); parts.append(torus("mezzo", 0.615, 0.014, 0.12, 0, 0, STONE, 40))
for i in range(12):
    a = i / 12 * 2 * math.pi; b = a + math.pi / 12
    parts.append(torus(f"m{i}", 0.125, 0.016, 0.12, *rot2(0.745, 0, a), STONE, 16))
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.02, depth=0.34, location=(0.4 * math.cos(b), 0.135, 0.4 * math.sin(b)), rotation=(0, math.pi / 2 - b, 0))
    parts.append(named(f"col{i}", STONE))                                                 # la colonnina, col suo capitello
    cap = box(f"cap{i}", -0.032, 0.11, -0.02, 0.032, 0.165, 0.02, STONE, 0.004, 1); cap.rotation_euler = (0, math.pi / 2 - b, 0); cap.location = (0.575 * math.cos(b), 0, 0.575 * math.sin(b)); parts.append(cap)
for q in parts[1:]: soften(q, 60)
PIECES["rosone"] = join("rosone", parts)

# ── trafori: la testa di una bifora, per un vano largo 1 (nel gioco si ingrandisce quanto è largo il vano): la sagoma è il sesto
#    acuto del gioco (`Mason.archSide`), dall'imposta (quota 0) alla chiave (0,75); dentro, le teste di due luci e un tondo. Spessa 10 cm.
def sesto(w, n=10):
    """Il sesto acuto del gioco, largo w, dall'imposta sinistra alla destra."""
    side = [(0.5 * w * (1 - t * t), w * (1.2 * t - 0.45 * t * t)) for t in [k / n for k in range(n + 1)]]
    return [(-x, z) for x, z in side] + [(x, z) for x, z in reversed(side[:-1])]
plate = prism("trafori", sesto(1.0), 0.0, 0.1, STONE)
cutters = [cyl("tondo", 0.135, -0.1, 0.3, 0, 0.445, STONE, 20)]
for g in (-1, 1):
    cutters.append(prism(f"luce{g}", [(g * 0.235 - 0.19, -0.2)] + [(g * 0.235 + x, z) for x, z in sesto(0.38, 8)] + [(g * 0.235 + 0.19, -0.2)], -0.1, 0.3, STONE))
parts = [soften(cut(plate, cutters)), soften(torus("mt", 0.155, 0.016, 0.1, 0, 0.445, STONE, 20), 60)]
PIECES["trafori"] = join("trafori", parts)

# ── guglia: un pinnacolo. Base 40 × 40 cm a quota 0, alto 2,3 m: zoccolo, fusto, cornice, quattro timpani, la cuspide coi gattoni
#    sugli spigoli, il fiore in cima.
parts = [box("fusto", -0.17, -0.17, 0.0, 0.17, 0.17, 1.0, STONE, 0.012, 2), box("zoccolo", -0.2, -0.2, 0.0, 0.2, 0.2, 0.12, STONE, 0.01, 1), box("cornice", -0.21, -0.21, 1.0, 0.21, 0.21, 1.08, STONE, 0.01, 1)]
for k in range(4):
    t = prism(f"timpano{k}", [(-0.19, 1.08), (0.19, 1.08), (0.0, 1.44)], 0.15, 0.225, STONE); t.rotation_euler = (0, 0, k * math.pi / 2); parts.append(t)
sp = lathe("cuspide", [(0.26, 1.08), (0.03, 2.15)], STONE, 4); sp.rotation_euler = (0, 0, math.pi / 4); parts.append(sp)
for f in sp.data.polygons: f.use_smooth = False
parts.append(lathe("fiore", [(0.0, 2.1), (0.03, 2.12), (0.075, 2.2), (0.035, 2.26), (0.0, 2.3)], STONE, 8))
for sx in (-1, 1):
    for sy in (-1, 1):
        for f in (0.2, 0.45, 0.7):
            h = 0.184 * (1 - f) + 0.02 * f
            parts.append(box(f"g{sx}{sy}{f}", sx * h - 0.035, sy * h - 0.035, 1.08 + f * 1.07 - 0.03, sx * h + 0.035, sy * h + 0.035, 1.08 + f * 1.07 + 0.045, STONE, 0.012, 1))
PIECES["guglia"] = join("guglia", parts)

# ── colonnina: alta 1 m (nel gioco si allunga), base a toro, fusto, capitello a campana con l'abaco; poggia a quota 0.
PIECES["colonnina"] = join("colonnina", [
    box("abaco", -0.095, -0.095, 0.955, 0.095, 0.095, 1.0, STONE, 0.008, 1),
    box("plinto", -0.085, -0.085, 0.0, 0.085, 0.085, 0.035, STONE, 0.006, 1),
    lathe("fusto", [(0.078, 0.035), (0.08, 0.05), (0.062, 0.065), (0.07, 0.085), (0.05, 0.1), (0.045, 0.11), (0.045, 0.83), (0.056, 0.84), (0.046, 0.855), (0.05, 0.87), (0.062, 0.91), (0.088, 0.955)], STONE, 12),
])

# ════ arredi di strada ════
# ── fontana: tutta la pietra, tornita: gradino, vasca con zoccolo e orlo a toro (dentro è cava), fusto a nodi, catino, colonnina, pigna.
#    Misure vere (raggio 2,62, alta 2,96); l'acqua la mette il gioco (a 0,72 nella vasca, a 1,8 nel catino).
PIECES["fontana"] = soften(lathe("fontana", [
    (2.62, 0.0), (2.62, 0.14), (2.58, 0.16), (2.42, 0.16), (2.42, 0.22), (2.36, 0.3), (2.29, 0.34), (2.27, 0.62), (2.31, 0.68), (2.41, 0.71), (2.43, 0.76), (2.41, 0.81), (2.35, 0.84),
    (2.12, 0.84), (2.07, 0.8), (2.05, 0.5), (0.52, 0.5), (0.52, 0.6), (0.44, 0.68), (0.35, 0.76), (0.31, 1.0), (0.34, 1.05), (0.34, 1.1), (0.3, 1.15), (0.28, 1.4), (0.4, 1.44), (0.4, 1.5),
    (0.52, 1.55), (0.96, 1.72), (1.07, 1.78), (1.08, 1.83), (1.03, 1.87), (0.96, 1.83), (0.3, 1.7), (0.25, 1.74), (0.2, 2.0), (0.24, 2.05), (0.24, 2.09), (0.18, 2.13), (0.17, 2.4),
    (0.27, 2.44), (0.27, 2.5), (0.16, 2.53), (0.21, 2.64), (0.17, 2.8), (0.07, 2.93), (0.0, 2.96)], STONE, 32), 35)

# ── vera: la vera del pozzo, cava: zoccolo, tre corsi, la cimasa a toro. Raggio 1,02, alta 0,93; dentro scende fino a 0,2.
PIECES["vera"] = soften(lathe("vera", [(1.02, 0.0), (1.02, 0.1), (0.98, 0.14), (0.95, 0.3), (0.93, 0.34), (0.925, 0.465), (0.905, 0.475), (0.925, 0.485), (0.922, 0.605), (0.902, 0.615), (0.92, 0.625), (0.92, 0.74), (0.96, 0.78), (1.02, 0.81), (1.03, 0.86), (1.01, 0.91), (0.97, 0.93),
                                       (0.77, 0.93), (0.73, 0.9), (0.72, 0.2)], STONE, 24), 35)

# ── fusto: il fusto di ferro di un lampione, alto 2,39 m dalla base di pietra: piede a campana, tre nodi, il braccio coi due riccioli.
parts = [soften(lathe("fusto", [(0.1, 0.0), (0.1, 0.05), (0.075, 0.08), (0.06, 0.14), (0.075, 0.16), (0.075, 0.2), (0.055, 0.24), (0.05, 1.1), (0.068, 1.13), (0.068, 1.19), (0.048, 1.22),
                                 (0.04, 1.96), (0.06, 1.99), (0.06, 2.05), (0.035, 2.09), (0.03, 2.36), (0.07, 2.39), (0.0, 2.39)], IRON, 10), 35),
         box("braccio", -0.3, -0.015, 2.06, 0.3, 0.015, 2.09, IRON, 0.004, 1)]
for sx in (-1, 1): parts.append(torus(f"riccio{sx}", 0.06, 0.012, 0.0, sx * 0.24, 2.0, IRON, 14))
PIECES["fusto"] = join("fusto", parts)

# ── ruota: di carro, raggio 0,42, sul piano della facciata (x, z di Blender), spessa 6 cm: cerchione di legno col ferro attorno,
#    otto raggi, il mozzo col suo cappello.
parts = [soften(torus("cerchione", 0.375, 0.035, 0.0, 0, 0, TIMBER, 24), 60), soften(torus("ferro", 0.408, 0.016, 0.0, 0, 0, IRON, 24), 60),
         cyl("mozzo", 0.075, -0.06, 0.06, 0, 0, TIMBER, 12), cyl("cappello", 0.035, -0.08, 0.08, 0, 0, IRON, 8)]
for i in range(8):
    b = i / 8 * 2 * math.pi
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.017, depth=0.3, location=(0.21 * math.cos(b), 0.0, 0.21 * math.sin(b)), rotation=(0, math.pi / 2 - b, 0))
    parts.append(named(f"raggio{i}", TIMBER))
PIECES["ruota"] = join("ruota", parts)

# ── incudine: lunga 50 cm lungo x, alta 24: piede, vita, il piano, il corno.
parts = [box("piano", -0.2, -0.065, 0.16, 0.14, 0.065, 0.24, IRON, 0.008, 2), box("piede", -0.15, -0.09, 0.0, 0.15, 0.09, 0.055, IRON, 0.01, 2), box("vita", -0.085, -0.055, 0.055, 0.085, 0.055, 0.16, IRON, 0.02, 2)]
horn = lathe("corno", [(0.058, 0.0), (0.04, 0.1), (0.0, 0.19)], IRON, 10); horn.rotation_euler = (0, math.pi / 2, 0); horn.location = (0.14, 0.0, 0.195); parts.append(horn)
PIECES["incudine"] = join("incudine", parts)

# ════ arredi di casa (origine a terra, al centro; il davanti è +Y di Blender = +Z del gioco) ════
def gamba(name, x, y, z0, z1, r=0.03, material=TIMBER):
    """Una gamba tornita fra due dadi."""
    h = z1 - z0
    return [box(name + "a", x - r, y - r, z0, x + r, y + r, z0 + h * 0.22, material, 0.005, 1), box(name + "b", x - r, y - r, z1 - h * 0.25, x + r, y + r, z1, material, 0.005, 1),
            lathe(name + "t", [(r * 0.75, z0 + h * 0.22), (r * 1.05, z0 + h * 0.27), (r * 0.7, z0 + h * 0.33), (r * 1.0, z0 + h * 0.5), (r * 0.7, z0 + h * 0.68), (r * 1.05, z0 + h * 0.72), (r * 0.75, z1 - h * 0.25)], material, 8, x, y)]

def pomo(name, x, y, z, r=0.04, material=TIMBER):
    return lathe(name, [(r * 0.5, z), (r * 0.55, z + r * 0.4), (r, z + r * 1.1), (r * 0.9, z + r * 1.7), (r * 0.3, z + r * 2.2), (0.0, z + r * 2.3)], material, 8, x, y)

# ── tavolo: 1,8 × 0,8, alto 0,76: cinque tavole, due cavalletti a gambe divaricate, il traverso passante coi cunei.
parts = [box(f"t{i}", -0.9, -0.4 + i * 0.16 + 0.003, 0.705, 0.9, -0.4 + (i + 1) * 0.16 - 0.003, 0.76, WOOD, 0.007, 1) for i in range(5)]
for sx in (-1, 1):
    x = sx * 0.7
    parts.append(box(f"testa{sx}", x - 0.04, -0.34, 0.645, x + 0.04, 0.34, 0.705, TIMBER, 0.008, 1))
    parts.append(box(f"catena{sx}", x - 0.022, -0.25, 0.2, x + 0.022, 0.25, 0.26, TIMBER, 0.006, 1))
    for sy in (-1, 1):
        leg = box(f"g{sx}{sy}", -0.032, -0.04, 0.0, 0.032, 0.04, 0.68, TIMBER, 0.008, 1); leg.rotation_euler = (sy * 0.3, 0, 0); leg.location = (x, sy * 0.31, 0.0); parts.append(leg)
    parts.append(box(f"cuneo{sx}", sx * 0.75, -0.012, 0.25, sx * 0.79, 0.012, 0.37, TIMBER, 0.004, 1))
parts.append(box("traverso", -0.82, -0.03, 0.27, 0.82, 0.03, 0.35, TIMBER, 0.008, 1))
PIECES["tavolo"] = join("tavolo", parts)

# ── panca: 1,6 × 0,32, alta 0,42: l'asse, due gambe a tavola, il traverso.
PIECES["panca"] = join("panca", [box("asse", -0.8, -0.16, 0.37, 0.8, 0.16, 0.42, WOOD, 0.01, 2), box("g0", -0.625, -0.13, 0.0, -0.575, 0.13, 0.37, TIMBER, 0.008, 1),
                                 box("g1", 0.575, -0.13, 0.0, 0.625, 0.13, 0.37, TIMBER, 0.008, 1), box("tr", -0.66, -0.02, 0.17, 0.66, 0.02, 0.25, TIMBER, 0.006, 1)])

# ── sgabello: il sedile tondo e tre gambe tornite, divaricate.
parts = [soften(lathe("sedile", [(0.0, 0.37), (0.16, 0.37), (0.175, 0.385), (0.175, 0.405), (0.16, 0.42), (0.0, 0.42)], WOOD, 14), 35)]
T = math.atan2(0.07, 0.38)
for i in range(3):
    a = i * 2 * math.pi / 3 + 0.5
    leg = lathe(f"g{i}", [(0.018, 0.0), (0.025, 0.1), (0.019, 0.14), (0.027, 0.2), (0.021, 0.3), (0.018, 0.39)], TIMBER, 8)
    rx = math.asin(math.sin(T) * math.sin(a)); ry = math.asin(-math.sin(T) * math.cos(a) / math.cos(rx))
    leg.rotation_euler = (rx, ry, 0); leg.location = (0.16 * math.cos(a), 0.16 * math.sin(a), 0.0); parts.append(leg)
PIECES["sgabello"] = join("sgabello", parts)

# ── scranno: chi siede guarda +Y; schienale alto a pannello fra due montanti col pomo, gambe davanti tornite, braccioli.
parts = [box("sedile", -0.26, -0.26, 0.4, 0.26, 0.28, 0.46, WOOD, 0.01, 2)]
for sx in (-1, 1):
    x = sx * 0.23
    parts.append(box(f"m{sx}", x - 0.03, -0.26, 0.0, x + 0.03, -0.2, 1.25, TIMBER, 0.006, 1)); parts.append(pomo(f"p{sx}", x, -0.23, 1.25, 0.034))
    parts += gamba(f"g{sx}", x, 0.23, 0.0, 0.4); parts += gamba(f"b{sx}", x, 0.2, 0.46, 0.66, 0.022)
    parts.append(box(f"br{sx}", x - 0.028, -0.2, 0.66, x + 0.028, 0.25, 0.7, TIMBER, 0.008, 1)); parts.append(box(f"tl{sx}", x - 0.015, -0.2, 0.14, x + 0.015, 0.2, 0.18, TIMBER, 0.004, 1))
parts += [box("pannello", -0.2, -0.25, 0.64, 0.2, -0.215, 1.12, WOOD, 0.004, 1), box("cima", -0.2, -0.262, 1.1, 0.2, -0.198, 1.21, TIMBER, 0.01, 2),
          box("sotto", -0.2, -0.258, 0.56, 0.2, -0.202, 0.65, TIMBER, 0.006, 1), box("davanti", -0.2, 0.21, 0.1, 0.2, 0.25, 0.14, TIMBER, 0.004, 1)]
PIECES["scranno"] = join("scranno", parts)

# ── letto: il telaio (pagliericcio, cuscino e coperta li mette il gioco). Testa a +Y, alta 0,95; piedi a 0,65; quattro montanti col pomo.
parts = [box(f"sp{sx}", sx * 0.48 - 0.02, -0.92, 0.25, sx * 0.48 + 0.02, 0.92, 0.45, WOOD, 0.006, 1) for sx in (-1, 1)]
for sx in (-1, 1):
    x = sx * 0.46
    parts.append(box(f"mt{sx}", x - 0.04, 0.92, 0.0, x + 0.04, 1.0, 0.95, TIMBER, 0.008, 1)); parts.append(pomo(f"pt{sx}", x, 0.96, 0.95, 0.045))
    parts.append(box(f"mp{sx}", x - 0.04, -1.0, 0.0, x + 0.04, -0.92, 0.65, TIMBER, 0.008, 1)); parts.append(pomo(f"pp{sx}", x, -0.96, 0.65, 0.045))
parts += [box("testiera", -0.42, 0.945, 0.45, 0.42, 0.975, 0.86, WOOD, 0.004, 1), box("cimasa", -0.42, 0.93, 0.84, 0.42, 0.99, 0.92, TIMBER, 0.01, 2),
          box("pediera", -0.42, -0.975, 0.25, 0.42, -0.945, 0.56, WOOD, 0.004, 1), box("cimasa2", -0.42, -0.99, 0.54, 0.42, -0.93, 0.61, TIMBER, 0.01, 2)]
PIECES["letto"] = join("letto", parts)

# ── botte: in piedi, alta 0,9, panciuta, il fondo incassato, quattro cerchi di ferro.
def raggio(z): return 0.27 + 0.065 * math.sin(z / 0.9 * math.pi)
parts = [soften(lathe("doghe", [(raggio(z), z) for z in [k * 0.09 for k in range(11)]] + [(0.25, 0.9), (0.245, 0.87), (0.0, 0.87)], WOOD, 18), 35)]
for z in (0.1, 0.27, 0.63, 0.8):
    parts.append(lathe(f"c{z}", [(raggio(z - 0.025) + 0.002, z - 0.025), (raggio(z) + 0.011, z - 0.02), (raggio(z) + 0.011, z + 0.02), (raggio(z + 0.025) + 0.002, z + 0.025)], IRON, 18))
PIECES["botte"] = join("botte", parts)

# ── forziere: 0,9 × 0,5, il coperchio a botte fino a 0,5; due bandelle di ferro che girano sul coperchio, la serratura davanti (−Y).
def volta(name, hy, rise, x0, x1, material):
    """Un coperchio a botte lungo x: profilo ad arco ribassato sopra quota 0,34."""
    ob = prism(name, [(-hy * math.cos(k / 8 * math.pi), 0.34 + rise * math.sin(k / 8 * math.pi)) for k in range(9)], -x1, -x0, material)
    ob.rotation_euler = (0, 0, math.pi / 2)
    return ob
parts = [box("cassa", -0.45, -0.25, 0.0, 0.45, 0.25, 0.34, WOOD, 0.008, 1), volta("coperchio", 0.25, 0.16, -0.45, 0.45, WOOD)]
for sx in (-1, 1):
    parts.append(box(f"bn{sx}", sx * 0.28 - 0.03, -0.257, 0.0, sx * 0.28 + 0.03, 0.257, 0.345, IRON, 0.003, 1)); parts.append(volta(f"bc{sx}", 0.257, 0.168, sx * 0.28 - 0.03, sx * 0.28 + 0.03, IRON))
parts.append(box("serratura", -0.055, -0.272, 0.2, 0.055, -0.25, 0.36, IRON, 0.004, 1))
PIECES["forziere"] = join("forziere", parts)

# ════ il resto degli arredi ════
CLOTH, BRICK = ("cloth", (0.6, 0.55, 0.45)), ("brick", (0.55, 0.35, 0.25))

def prisma_x(name, pts, x0, x1, material):
    """Un profilo sul piano (y, z) di Blender estruso lungo x: piani inclinati, fianchi sagomati."""
    ob = prism(name, pts, -x1, -x0, material); ob.rotation_euler = (0, 0, math.pi / 2)
    return ob

def colonna(name, x, y, z0, z1, r=0.04, material=TIMBER):
    """Una colonna di letto: dado in basso, fuso tornito a nodi, dado in cima."""
    h = z1 - z0
    return [box(name + "a", x - r, y - r, z0, x + r, y + r, z0 + 0.5, material, 0.006, 1), box(name + "b", x - r, y - r, z1 - 0.16, x + r, y + r, z1, material, 0.006, 1),
            lathe(name + "t", [(r * 0.8, z0 + 0.5), (r * 1.1, z0 + 0.54), (r * 0.7, z0 + 0.6), (r * 0.95, z0 + 0.5 + (h - 0.66) * 0.35), (r * 0.6, z0 + 0.5 + (h - 0.66) * 0.7), (r * 1.1, z1 - 0.2), (r * 0.8, z1 - 0.16)], material, 8, x, y)]

# ── lettone: il telaio a quattro colonne (i panni li mette il gioco). 1,6 × 2,06, colonne alte 1,9; la testa a +Y.
parts = [box(f"sp{sx}", sx * 0.78 - 0.02, -0.97, 0.25, sx * 0.78 + 0.02, 0.97, 0.45, WOOD, 0.006, 1) for sx in (-1, 1)]
for sx in (-1, 1):
    for sy in (-1, 1): parts += colonna(f"c{sx}{sy}", sx * 0.76, sy * 1.01, 0.0, 1.9)
    parts.append(box(f"cl{sx}", sx * 0.76 - 0.025, -1.01, 1.84, sx * 0.76 + 0.025, 1.01, 1.9, TIMBER, 0.006, 1))
for sy in (-1, 1): parts.append(box(f"ct{sy}", -0.76, sy * 1.01 - 0.025, 1.84, 0.76, sy * 1.01 + 0.025, 1.9, TIMBER, 0.006, 1))
parts += [box("testiera", -0.72, 0.985, 0.45, 0.72, 1.015, 1.14, WOOD, 0.004, 1), box("cimasa", -0.72, 0.97, 1.1, 0.72, 1.03, 1.2, TIMBER, 0.012, 2),
          box("pediera", -0.72, -1.015, 0.25, 0.72, -0.985, 0.56, WOOD, 0.004, 1), box("cimasa2", -0.72, -1.03, 0.54, 0.72, -0.97, 0.61, TIMBER, 0.01, 2)]
for i in (-1, 0, 1): parts.append(box(f"sp{i}", i * 0.46 - 0.2, 1.015, 0.56, i * 0.46 + 0.2, 1.028, 1.04, TIMBER, 0.01, 1))   # tre specchiature sulla testiera
PIECES["lettone"] = join("lettone", parts)

# ── bancone: banco di bottega, 1,7 × 0,66, alto 1,05: il fronte di tavole verso +Y fra due correnti, i fianchi, un ripiano, il piano di tre assi.
parts = [box(f"f{i}", -0.8 + i * 0.2 + 0.003, 0.24, 0.0, -0.8 + (i + 1) * 0.2 - 0.003, 0.3, 0.97, WOOD, 0.006, 1) for i in range(8)]
parts += [box("c0", -0.82, 0.3, 0.06, 0.82, 0.325, 0.16, TIMBER, 0.006, 1), box("c1", -0.82, 0.3, 0.8, 0.82, 0.325, 0.9, TIMBER, 0.006, 1), box("rip", -0.74, -0.26, 0.48, 0.74, 0.24, 0.52, WOOD, 0.004, 1)]
for sx in (-1, 1): parts.append(box(f"fi{sx}", sx * 0.77 - 0.03, -0.3, 0.0, sx * 0.77 + 0.03, 0.24, 0.97, WOOD, 0.006, 1))
parts += [box(f"p{i}", -0.85, -0.3 + i * 0.22 + 0.002, 0.97, 0.85, -0.3 + (i + 1) * 0.22 - 0.002, 1.05, WOOD, 0.009, 2) for i in range(3)]
PIECES["bancone"] = join("bancone", parts)

# ── scrittoio: chi scrive sta a +Y; due fianchi, il traverso, il cassone, il piano inclinato che scende verso chi scrive.
parts = [box("cassone", -0.54, -0.3, 0.58, 0.54, 0.3, 0.8, WOOD, 0.006, 1), box("tr", -0.54, -0.03, 0.2, 0.54, 0.03, 0.26, TIMBER, 0.006, 1),
         prisma_x("piano", [(-0.35, 0.8), (0.35, 0.8), (0.35, 0.825), (-0.35, 0.965)], -0.62, 0.62, WOOD), box("listello", -0.62, 0.33, 0.8, 0.62, 0.36, 0.85, TIMBER, 0.005, 1)]
for sx in (-1, 1):
    parts.append(box(f"fi{sx}", sx * 0.57 - 0.03, -0.3, 0.0, sx * 0.57 + 0.03, 0.3, 0.8, TIMBER, 0.008, 1)); parts.append(box(f"pi{sx}", sx * 0.57 - 0.05, -0.34, 0.0, sx * 0.57 + 0.05, 0.34, 0.06, TIMBER, 0.008, 1))
PIECES["scrittoio"] = join("scrittoio", parts)

# ── leggio: il piede a croce, il fusto tornito, il piano inclinato col suo listello.
PIECES["leggio"] = join("leggio", [box("p0", -0.22, -0.04, 0.0, 0.22, 0.04, 0.06, TIMBER, 0.008, 1), box("p1", -0.04, -0.22, 0.0, 0.04, 0.22, 0.06, TIMBER, 0.008, 1),
    lathe("fusto", [(0.05, 0.06), (0.055, 0.1), (0.03, 0.16), (0.04, 0.4), (0.028, 0.6), (0.04, 0.66), (0.028, 0.72), (0.035, 0.98), (0.05, 1.04), (0.03, 1.1)], TIMBER, 8),
    prisma_x("piano", [(-0.2, 1.2), (0.2, 1.02), (0.2, 1.05), (-0.2, 1.23)], -0.27, 0.27, WOOD), box("listello", -0.27, 0.18, 1.04, 0.27, 0.21, 1.09, TIMBER, 0.004, 1)])

# ── scaffale: lo schienale sul muro (y = 0), il davanti a +Y; due fianchi, cinque ripiani, la cornice in cima. 1,4 × 0,4, alto 1,9.
parts = [box("schiena", -0.7, 0.0, 0.0, 0.7, 0.03, 1.9, TIMBER, 0.004, 1), box("cornice", -0.73, 0.0, 1.9, 0.73, 0.44, 1.96, TIMBER, 0.012, 2)]
for sx in (-1, 1): parts.append(box(f"fi{sx}", sx * 0.675 - 0.025, 0.03, 0.0, sx * 0.675 + 0.025, 0.4, 1.9, WOOD, 0.006, 1))
for h in (0.08, 0.52, 0.98, 1.44, 1.86): parts.append(box(f"r{h}", -0.65, 0.03, h, 0.65, 0.4, h + 0.04, WOOD, 0.006, 1))
PIECES["scaffale"] = join("scaffale", parts)

# ── armadio: 1,2 × 0,5, alto 1,94: zoccolo, cassa, cornice; due ante a telaio con la specchiatura, bandelle e maniglie di ferro.
parts = [box("cassa", -0.6, 0.0, 0.08, 0.6, 0.47, 1.84, WOOD, 0.006, 1), box("zoccolo", -0.63, 0.0, 0.0, 0.63, 0.5, 0.08, TIMBER, 0.01, 1), box("cornice", -0.65, 0.0, 1.84, 0.65, 0.53, 1.94, TIMBER, 0.02, 2)]
for sx in (-1, 1):
    x0, x1 = (0.01, 0.58) if sx > 0 else (-0.58, -0.01)
    parts += [box(f"m0{sx}", x0, 0.47, 0.1, x0 + 0.08, 0.495, 1.82, TIMBER, 0.005, 1), box(f"m1{sx}", x1 - 0.08, 0.47, 0.1, x1, 0.495, 1.82, TIMBER, 0.005, 1)]
    for z in (0.1, 0.92, 1.72): parts.append(box(f"t{sx}{z}", x0 + 0.08, 0.47, z, x1 - 0.08, 0.495, z + 0.1, TIMBER, 0.005, 1))
    for z in (0.4, 1.5): parts.append(box(f"b{sx}{z}", sx * 0.58 - (0.2 if sx > 0 else 0.0), 0.495, z, sx * 0.58 + (0.0 if sx > 0 else 0.2), 0.503, z + 0.04, IRON, 0.002, 1))
    parts.append(box(f"man{sx}", sx * 0.06 - 0.015, 0.495, 0.92, sx * 0.06 + 0.015, 0.52, 1.02, IRON, 0.004, 1))
PIECES["armadio"] = join("armadio", parts)

# ── banco di chiesa: chi siede guarda +Y; il sedile, lo schienale, due fianchi sagomati, l'inginocchiatoio davanti.
FIANCO = [(-0.22, 0.0), (0.26, 0.0), (0.26, 0.38), (0.2, 0.46), (-0.08, 0.5), (-0.12, 0.84), (-0.17, 0.92), (-0.22, 0.9)]
parts = [box("sedile", -0.85, -0.14, 0.4, 0.85, 0.24, 0.45, WOOD, 0.008, 1), box("schienale", -0.85, -0.2, 0.45, 0.85, -0.15, 0.86, WOOD, 0.006, 1), box("cima", -0.85, -0.22, 0.84, 0.85, -0.13, 0.9, TIMBER, 0.01, 1),
         box("ginocchi", -0.82, 0.4, 0.08, 0.82, 0.54, 0.12, WOOD, 0.006, 1)]
for sx in (-1, 1): parts.append(prisma_x(f"fi{sx}", FIANCO, sx * 0.82 - 0.03, sx * 0.82 + 0.03, TIMBER)); parts.append(box(f"pg{sx}", sx * 0.78 - 0.02, 0.4, 0.0, sx * 0.78 + 0.02, 0.54, 0.08, TIMBER, 0.004, 1))
PIECES["bancochiesa"] = join("bancochiesa", parts)

# ── plinto e capitello di un pilastro a otto facce (raggio 0,45): fra l'uno e l'altro il fusto lo fa il gioco, lungo quanto serve.
PIECES["plinto"] = join("plinto", [box("dado", -0.56, -0.56, 0.0, 0.56, 0.56, 0.2, STONE, 0.012, 1),
                                   soften(lathe("toro", [(0.56, 0.2), (0.58, 0.26), (0.55, 0.32), (0.49, 0.34), (0.47, 0.4), (0.5, 0.45), (0.45, 0.5)], STONE, 16), 35)])
PIECES["capitello"] = join("capitello", [box("abaco", -0.58, -0.58, 0.48, 0.58, 0.58, 0.6, STONE, 0.012, 1),
                                         soften(lathe("campana", [(0.45, 0.0), (0.49, 0.03), (0.49, 0.07), (0.45, 0.1), (0.47, 0.22), (0.54, 0.36), (0.6, 0.44), (0.6, 0.48)], STONE, 16), 35)])

# ── fonte battesimale: piede, fusto, la coppa cava. Alta 1 m; l'acqua (a 0,97) la mette il gioco.
PIECES["fonte"] = soften(lathe("fonte", [(0.42, 0.0), (0.42, 0.08), (0.32, 0.12), (0.25, 0.2), (0.22, 0.52), (0.27, 0.58), (0.27, 0.62), (0.5, 0.78), (0.56, 0.84), (0.57, 0.92), (0.55, 1.0), (0.5, 1.0), (0.47, 0.96), (0.0, 0.9)], STONE, 16), 35)

# ── altare: la pietra (tovaglia, croce e ceri li mette il gioco): zoccolo, il dado con tre specchiature incassate sul davanti (+Y), la mensa. 2,5 × 1,1, alto 1,05.
body = box("altare", -1.15, -0.45, 0.1, 1.15, 0.45, 0.95, STONE, 0.01, 1)
body = cut(body, [box(f"sp{i}", i * 0.74 - 0.3, 0.41, 0.22, i * 0.74 + 0.3, 0.6, 0.83, STONE, 0) for i in (-1, 0, 1)])
PIECES["altare"] = join("altare", [body, box("zoccolo", -1.25, -0.55, 0.0, 1.25, 0.55, 0.1, STONE, 0.02, 2), box("mensa", -1.25, -0.55, 0.95, 1.25, 0.55, 1.05, STONE, 0.02, 2)])

# ── candeliere da terra (ferro), alto 1,53: piede a campana, fusto a nodi, il piattello.
PIECES["candeliere"] = soften(lathe("candeliere", [(0.14, 0.0), (0.13, 0.03), (0.05, 0.07), (0.03, 0.12), (0.02, 0.3), (0.035, 0.33), (0.02, 0.36), (0.018, 1.2), (0.035, 1.23), (0.018, 1.26), (0.018, 1.46), (0.09, 1.5), (0.09, 1.53), (0.0, 1.53)], IRON, 8), 35)

# ── braciere: la conca di ferro su tre gambe divaricate, con l'anello.
parts = [soften(lathe("conca", [(0.06, 0.44), (0.2, 0.47), (0.3, 0.6), (0.33, 0.7), (0.3, 0.7), (0.27, 0.62), (0.0, 0.58)], IRON, 12), 35)]
for i in range(3):
    a2 = i * 2 * math.pi / 3
    leg = box(f"g{i}", -0.015, -0.015, 0.0, 0.015, 0.015, 0.5, IRON, 0.003, 1); rx = math.asin(math.sin(0.2) * math.sin(a2)); leg.rotation_euler = (rx, math.asin(-math.sin(0.2) * math.cos(a2) / math.cos(rx)), 0)
    leg.location = (0.27 * math.cos(a2), 0.27 * math.sin(a2), 0.0); parts.append(leg)
bpy.ops.mesh.primitive_torus_add(major_radius=0.23, minor_radius=0.01, major_segments=16, minor_segments=5, location=(0, 0, 0.22)); parts.append(named("anello", IRON))
PIECES["braciere"] = join("braciere", parts)

# ── le cose minute: poche facce, sono tante.
PIECES["bugia"] = join("bugia", [lathe("piatto", [(0.06, 0.0), (0.065, 0.012), (0.03, 0.016), (0.0, 0.016)], IRON, 8), lathe("cera", [(0.02, 0.016), (0.021, 0.13), (0.016, 0.15), (0.0, 0.148)], CLOTH, 6)])
bpy.ops.mesh.primitive_torus_add(major_radius=0.032, minor_radius=0.007, major_segments=8, minor_segments=4, location=(0.05, 0, 0.07), rotation=(math.radians(90), 0, 0)); manico = named("manico", WOOD)
PIECES["boccale"] = join("boccale", [soften(lathe("boccale", [(0.042, 0.0), (0.046, 0.01), (0.043, 0.12), (0.046, 0.13), (0.038, 0.13), (0.036, 0.03), (0.0, 0.03)], WOOD, 8), 35), manico])
bpy.ops.mesh.primitive_torus_add(major_radius=0.05, minor_radius=0.009, major_segments=8, minor_segments=4, location=(0.065, 0, 0.16), rotation=(math.radians(90), 0, 0)); manico = named("ansa", BRICK)
PIECES["brocca"] = join("brocca", [soften(lathe("brocca", [(0.045, 0.0), (0.07, 0.04), (0.08, 0.1), (0.065, 0.16), (0.035, 0.2), (0.032, 0.22), (0.045, 0.24), (0.035, 0.24), (0.0, 0.2)], BRICK, 10), 35), manico])
PIECES["ciotola"] = soften(lathe("ciotola", [(0.035, 0.0), (0.045, 0.006), (0.08, 0.05), (0.086, 0.06), (0.078, 0.06), (0.04, 0.02), (0.0, 0.015)], WOOD, 8), 35)
PIECES["cesta"] = soften(lathe("cesta", [(0.17, 0.0), (0.2, 0.02), (0.235, 0.2), (0.25, 0.25), (0.23, 0.26), (0.21, 0.22), (0.18, 0.05), (0.0, 0.04)], CLOTH, 10), 35)
bpy.ops.mesh.primitive_torus_add(major_radius=0.15, minor_radius=0.007, major_segments=10, minor_segments=4, location=(0, 0, 0.36), rotation=(math.radians(90), 0, 0)); manico = named("manico", IRON)
PIECES["secchio"] = join("secchio", [soften(lathe("doghe", [(0.125, 0.0), (0.14, 0.02), (0.16, 0.3), (0.145, 0.3), (0.13, 0.04), (0.0, 0.03)], WOOD, 10), 35),
                                     lathe("c0", [(0.136, 0.06), (0.148, 0.065), (0.15, 0.095), (0.14, 0.1)], IRON, 10), lathe("c1", [(0.15, 0.22), (0.162, 0.225), (0.164, 0.255), (0.154, 0.26)], IRON, 10), manico])
PIECES["paiolo"] = soften(lathe("paiolo", [(0.08, 0.62), (0.2, 0.67), (0.27, 0.8), (0.25, 0.92), (0.27, 0.94), (0.24, 0.94), (0.24, 0.82), (0.0, 0.7)], IRON, 10), 35)
PIECES["sacco"] = soften(lathe("sacco", [(0.2, 0.0), (0.26, 0.06), (0.27, 0.2), (0.22, 0.36), (0.1, 0.46), (0.06, 0.5), (0.09, 0.54), (0.11, 0.57), (0.0, 0.55)], CLOTH, 9), 50)

# ── ruota del candelabro: raggio 0,54 (nel gioco si ingrandisce), in piano: il cerchio di legno, la croce, otto piattelli di ferro.
bpy.ops.mesh.primitive_torus_add(major_radius=0.54, minor_radius=0.04, major_segments=24, minor_segments=6, location=(0, 0, 0.04)); parts = [soften(named("cerchio", TIMBER), 60)]
parts += [box("x0", -0.54, -0.03, 0.01, 0.54, 0.03, 0.07, TIMBER, 0.006, 1), box("x1", -0.03, -0.54, 0.01, 0.03, 0.54, 0.07, TIMBER, 0.006, 1)]
for i in range(8):
    a2 = i * math.pi / 4 + math.atan2(0.2, 0.52)
    parts.append(lathe(f"pt{i}", [(0.0, 0.07), (0.045, 0.075), (0.05, 0.095), (0.0, 0.09)], IRON, 6, 0.557 * math.sin(a2) * 1.0, 0.557 * math.cos(a2)))
PIECES["lumiera"] = join("lumiera", parts)

# ════ ancora in strada ════
# ── panchina: 1,8 × 0,5: tre assi di sedile, due fianchi con gambe, bracciolo e montante inclinato, due assi di schienale.
parts = [box(f"s{i}", -0.9, -0.22 + i * 0.15 + 0.002, 0.38, 0.9, -0.085 + i * 0.15 - 0.002, 0.43, WOOD, 0.008, 2) for i in range(3)]
for sx in (-1, 1):
    x = sx * 0.76
    parts += [box(f"g0{sx}", x - 0.045, -0.245, 0.0, x + 0.045, -0.155, 0.38, TIMBER, 0.008, 1), box(f"g1{sx}", x - 0.045, 0.125, 0.0, x + 0.045, 0.215, 0.62, TIMBER, 0.008, 1),
              box(f"tr{sx}", x - 0.04, -0.22, 0.3, x + 0.04, 0.22, 0.38, TIMBER, 0.006, 1), box(f"br{sx}", x - 0.045, -0.28, 0.6, x + 0.045, 0.24, 0.66, TIMBER, 0.012, 2)]
    m = box(f"m{sx}", -0.04, -0.04, 0.0, 0.04, 0.04, 0.6, TIMBER, 0.008, 1); m.rotation_euler = (0.1, 0, 0); m.location = (x, -0.25, 0.38); parts.append(m)
for z in (0.2, 0.42):
    b = box(f"sc{z}", -0.9, -0.02, z, 0.9, 0.02, z + 0.16, WOOD, 0.008, 2); b.rotation_euler = (0.1, 0, 0); b.location = (0, -0.29, 0.38); parts.append(b)
PIECES["panchina"] = join("panchina", parts)

# ── banco del mercato: il legno (telo e merce li mette il gioco). 3 × 1,05: il piano di tre tavole su due cavalletti, la fascia,
#    quattro pali (dietro, a −Y, più alti) con le traverse e i due puntoni inclinati che reggono il telo.
parts = [box(f"t{i}", -1.5, -0.5 + i * 0.35 + 0.003, 0.8, 1.5, -0.17 + i * 0.35 - 0.003, 0.86, WOOD, 0.009, 2) for i in range(3)]
parts.append(box("fascia", -1.5, 0.5, 0.66, 1.5, 0.55, 0.8, TIMBER, 0.006, 1))
for px in (-1.1, 1.1):
    for sy in (-1, 1):
        leg = box(f"g{px}{sy}", -0.04, -0.04, 0.0, 0.04, 0.04, 0.82, TIMBER, 0.008, 1); leg.rotation_euler = (sy * 0.22, 0, 0); leg.location = (px, sy * 0.38, 0.0); parts.append(leg)
    parts.append(box(f"ct{px}", px - 0.03, -0.3, 0.3, px + 0.03, 0.3, 0.36, TIMBER, 0.006, 1))
for px in (-1.4, 1.4):
    parts += [box(f"pd{px}", px - 0.05, -0.5, 0.0, px + 0.05, -0.4, 2.4, TIMBER, 0.01, 1), box(f"pa{px}", px - 0.05, 0.45, 0.0, px + 0.05, 0.55, 2.05, TIMBER, 0.01, 1)]
    pt = box(f"pu{px}", -0.035, -0.8, -0.035, 0.035, 0.8, 0.035, TIMBER, 0.008, 1); pt.rotation_euler = (-math.atan2(0.44, 1.65), 0, 0); pt.location = (px, 0.12, 2.2); parts.append(pt)
parts += [box("tv0", -1.6, -0.49, 2.36, 1.6, -0.41, 2.42, TIMBER, 0.008, 1), box("tv1", -1.6, 0.46, 2.01, 1.6, 0.54, 2.07, TIMBER, 0.008, 1)]
PIECES["bancarella"] = join("bancarella", parts)

# ── bacheca: due pali, il tavolato di cinque assi fra due traverse (il tettuccio e gli avvisi li mette il gioco).
parts = [box(f"a{i}", -0.62 + i * 0.248 + 0.002, -0.025, 0.85, -0.62 + (i + 1) * 0.248 - 0.002, 0.025, 1.75, WOOD, 0.006, 1) for i in range(5)]
for sx in (-1, 1): parts.append(box(f"p{sx}", sx * 0.6 - 0.05, -0.05, 0.0, sx * 0.6 + 0.05, 0.05, 1.95, TIMBER, 0.01, 1))
for z in (0.82, 1.72): parts.append(box(f"t{z}", -0.66, -0.04, z, 0.66, 0.04, z + 0.07, TIMBER, 0.008, 1))
PIECES["bacheca"] = join("bacheca", parts)

# ── occlusione nei vertici: ogni pezzo cotto da solo (quanto ogni punto è nascosto dal resto del pezzo) ──
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'; scene.cycles.samples = 48
baked = True
for ob in PIECES.values():
    try:
        me = ob.data
        attr = me.color_attributes.new("ao", 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = attr; me.color_attributes.render_color_index = me.color_attributes.find("ao")
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
        for o in PIECES.values(): o.hide_render = o is not ob
        scene.render.bake.target = 'VERTEX_COLORS'
        bpy.ops.object.bake(type='AO')
    except Exception as e:
        baked = False; print("[kit] occlusione non cotta per", ob.name, "—", e)
for o in PIECES.values(): o.hide_render = False

# ── uscita: per pezzo e per materiale, vertici divisi per normale (spigoli vivi dove serve), nel sistema del gioco (x, y in alto, z) ──
def export(ob):
    me = ob.data; me.calc_loop_triangles()
    normals = me.corner_normals; ao = me.color_attributes.get("ao")
    out = {}
    for tri in me.loop_triangles:
        key = me.materials[tri.material_index].name
        g = out.setdefault(key, {"p": [], "n": [], "c": [], "i": [], "_": {}})
        for li in tri.loops:
            v = me.loops[li].vertex_index; co = me.vertices[v].co; n = normals[li].vector
            k = (v, round(n.x, 3), round(n.y, 3), round(n.z, 3))
            if k not in g["_"]:
                g["_"][k] = len(g["p"]) // 3
                g["p"] += [round(co.x, 4), round(co.z, 4), round(co.y, 4)]
                g["n"] += [round(n.x, 3), round(n.z, 3), round(n.y, 3)]
                g["c"].append(round(ao.data[v].color[0], 3) if ao and baked else 1.0)
            g["i"].append(g["_"][k])
    for g in out.values(): del g["_"]
    return out

os.makedirs(os.path.dirname(OUT), exist_ok=True)
data = {name: export(ob) for name, ob in PIECES.items()}
json.dump(data, open(OUT, "w"), separators=(",", ":"))
print("[kit]", len(data), "pezzi,", sum(len(g["p"]) // 3 for d in data.values() for g in d.values()), "vertici,", os.path.getsize(OUT) // 1024, "KB, occlusione:", baked)

# ── la tavola: i pezzi in fila su un piano, una luce di taglio, una camera di tre quarti ──
try:
    x = 0.0
    for name, ob in PIECES.items():
        w = max(ob.dimensions.x, 0.2); ob.location.x = x + w / 2; x += w + 0.35
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=6); floor = obj_from(bm, "piano", ("piano", (0.5, 0.48, 0.45)))
    floor.location = (x / 2, 0.3, -0.08)
    sun = bpy.data.objects.new("sole", bpy.data.lights.new("sole", 'SUN')); sun.data.energy = 4; sun.rotation_euler = (math.radians(50), 0, math.radians(35)); scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("w"); world.use_nodes = True; world.node_tree.nodes["Background"].inputs[0].default_value = (0.22, 0.24, 0.28, 1); scene.world = world
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 42; scene.render.resolution_x, scene.render.resolution_y = 1800, 800; scene.cycles.samples = 64
    os.makedirs(os.path.dirname(PNG), exist_ok=True)
    floor.location.y = 0.0; floor.scale = (3, 3, 1)
    # due viste: da dietro (il legno, che ha la ferramenta verso -Y) e dal davanti delle facciate (+Y: la pietra scolpita)
    for side, png in ((-1, PNG), (1, PNG.replace(".png", "_fronte.png"))):
        cam.location = (x / 2 + side * 1.5, side * (x * 0.62 + 1.5), 2.6)
        d = Vector((x / 2, 0.0, 0.8)) - cam.location; cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sun.rotation_euler = (math.radians(55), 0, math.radians(35 if side < 0 else 150))
        scene.render.filepath = png; bpy.ops.render.render(write_still=True)
        print("[kit] tavola:", png)
except Exception as e:
    print("[kit] tavola non fatta —", e)
