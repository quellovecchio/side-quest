# ─────────────────────────────────────────────────────────────────────────────
# TESTE — le teste degli abitanti, scolpite: blender --background --python tools/blender/teste.py [-- tavola]
#
# Una testa è una scultura di METABALL (cranio, mascella, zigomi, arcate, naso, labbra, orecchie, e due
# cavità per le orbite) convertita in mesh e alleggerita. Misure in "teste": alta 1 dal mento al vertice,
# il mento a quota 0, il viso verso +Y di Blender (= +Z del gioco).
# Con `tavola` rende docs/reference/npc/occhi.png: la stessa testa con sei modi di fare gli occhi, da scegliere.
# Senza, scrive public/kit/teste.json (posizioni, normali, occlusione, indici, come kit.json) per il gioco.
# ─────────────────────────────────────────────────────────────────────────────
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHEET = "tavola" in sys.argv
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def mat(name, rgb, rough=0.6, metal=0.0, emit=None, sss=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    if sss: b.inputs["Subsurface Weight"].default_value = sss
    if emit: b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = 0.9
    return m

# ── la scultura: forme nette fuse da un remesh a voxel, poi le orbite scavate ──
def ell(c, r, rot=(0, 0, 0), seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=1, location=c, rotation=rot)
    o = bpy.context.active_object; o.scale = r; return o
def cube(c, r, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=2, location=c, rotation=rot); o = bpy.context.active_object; o.scale = r; return o

def cyl(c, r, d):
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=r, depth=d, location=c); return bpy.context.active_object

def head_parts(p):
    """p = i tratti: mascella, naso, arcata, zigomi, labbra, età (1 = medio; `old` scava le guance)."""
    j, n, b, c, l = p.get("jaw", 1), p.get("nose", 1), p.get("brow", 1), p.get("cheek", 1), p.get("lip", 1)
    P = [
        ell((0, -0.07, 0.62), (0.325, 0.425, 0.375)),                                   # cranio
        ell((0, 0.085, 0.4), (0.27, 0.285, 0.33)),                                      # il viso
        ell((0, 0.075, 0.2), (0.235 * j, 0.265, 0.18)),                                 # mascella
        ell((0, 0.235, 0.08), (0.092 * j, 0.072, 0.062)),                               # mento
        ell((0, 0.27, 0.67), (0.22, 0.09, 0.12)),                                       # fronte
        cube((0, 0.375, 0.49), (0.03, 0.05, 0.13), (math.radians(-18), 0, 0)),         # dorso del naso
        ell((0, 0.445, 0.39), (0.05 * n, 0.055 * n, 0.045 * n)),                       # punta
        ell((0, 0.345, 0.262), (0.1 * l, 0.04, 0.021 * l)),                            # labbro di sopra
        ell((0, 0.338, 0.222), (0.085 * l, 0.04, 0.026 * l)),                          # labbro di sotto
        ell((0, 0.3, 0.3), (0.13, 0.06, 0.09)),                                         # il muso sotto il naso
        cyl((0, -0.085, 0.02), 0.15, 0.5),                                              # collo
    ]
    for sx in (-1, 1):
        P += [ell((sx * 0.18, 0.18, 0.41), (0.09 * c, 0.095, 0.062)),                                              # zigomo
              ell((sx * 0.13, 0.325, 0.6), (0.12, 0.045 * b, 0.026 * b), (0, sx * math.radians(-10), sx * math.radians(-14))),   # arcata sopracciliare
              ell((sx * 0.045, 0.405, 0.372), (0.034 * n, 0.04 * n, 0.03 * n)),                                    # pinna del naso
              ell((sx * 0.322, -0.04, 0.465), (0.026, 0.08, 0.12), (math.radians(-12), 0, sx * math.radians(12))),   # orecchio
              ell((sx * 0.33, -0.02, 0.465), (0.02, 0.05, 0.085), (math.radians(-12), 0, sx * math.radians(12)))]
    return P

def sculpt(name, p, voxel=0.011):
    parts = head_parts(p)
    bpy.ops.object.select_all(action='DESELECT')
    for q in parts: q.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]; bpy.ops.object.join()
    ob = parts[0]; ob.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.data.remesh_voxel_size = voxel; ob.data.use_remesh_fix_poles = True
    bpy.ops.object.voxel_remesh()
    # le orbite, la bocca, la conca dell'orecchio: scavate
    cut = [ell((sx * 0.148, 0.385, 0.512), (0.082, 0.085, 0.052)) for sx in (-1, 1)] + [cube((0, 0.395, 0.243), (0.072, 0.03, 0.0028))] + [ell((sx * 0.358, -0.02, 0.47), (0.018, 0.038, 0.066), (math.radians(-12), 0, sx * math.radians(12))) for sx in (-1, 1)]
    bpy.ops.object.select_all(action='DESELECT')
    for q in cut: q.select_set(True)
    bpy.context.view_layer.objects.active = cut[0]; bpy.ops.object.join()
    m = ob.modifiers.new("b", 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = cut[0]; m.solver = 'EXACT'; m.use_self = True
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier="b"); bpy.data.objects.remove(cut[0], do_unlink=True)
    ob.data.remesh_voxel_size = voxel; bpy.ops.object.voxel_remesh()
    bm = bmesh.new(); bm.from_mesh(ob.data)
    for _ in range(14): bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(ob.data); bm.free()
    for f in ob.data.polygons: f.use_smooth = True
    return ob

SOCKET = Vector((0.148, 0.318, 0.512))   # il fondo dell'orbita: lì sta l'occhio

def eyes(kind, x0=0.0):
    """Gli occhi, per i due lati; restituisce gli oggetti."""
    out = []
    for sx in (-1, 1):
        c = Vector((x0 + sx * SOCKET.x, SOCKET.y, SOCKET.z))
        if kind == "gemma":          # una gemma sfaccettata, incastonata: brilla appena
            bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.046, radius2=0.024, depth=0.026, location=c + Vector((0, 0.02, 0)), rotation=(math.radians(-90), 0, math.radians(22.5)))
            o = bpy.context.active_object; o.data.materials.append(mat("gemma", (0.25, 0.75, 0.62), 0.05, 0.0, (0.2, 0.9, 0.7)))
            bpy.ops.mesh.primitive_torus_add(major_radius=0.048, minor_radius=0.009, major_segments=16, minor_segments=6, location=c + Vector((0, 0.008, 0)), rotation=(math.radians(90), 0, 0))
            r = bpy.context.active_object; r.data.materials.append(mat("castone", (0.35, 0.27, 0.12), 0.35, 1.0)); out += [o, r]
        elif kind == "perla":        # un cabochon nero lucido: solo il riflesso della luce
            bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.05, location=c + Vector((0, 0.008, 0)))
            o = bpy.context.active_object; bpy.ops.object.shade_smooth(); o.scale = (1, 0.6, 0.78); o.data.materials.append(mat("perla", (0.012, 0.012, 0.015), 0.04)); out.append(o)
        elif kind == "brace":        # un punto di brace in fondo all'orbita buia
            bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.02, location=c + Vector((0, -0.01, 0)))
            o = bpy.context.active_object; o.data.materials.append(mat("brace", (1, 0.45, 0.1), 0.5, 0, (1.0, 0.42, 0.08))); out.append(o)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.06, location=c + Vector((0, 0.0, 0)))
            d = bpy.context.active_object; d.scale = (1, 0.4, 0.8); d.data.materials.append(mat("buio", (0.004, 0.004, 0.004), 1)); out.append(d)
        elif kind == "moneta":       # un disco d'ottone inciso, come le monete sugli occhi
            bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.047, depth=0.012, location=c + Vector((0, 0.022, 0)), rotation=(math.radians(90), 0, 0))
            o = bpy.context.active_object; o.data.materials.append(mat("ottone", (0.55, 0.4, 0.14), 0.3, 1.0))
            bpy.ops.mesh.primitive_cylinder_add(vertices=4, radius=0.024, depth=0.016, location=c + Vector((0, 0.025, 0)), rotation=(math.radians(90), 0, math.radians(45)))
            q = bpy.context.active_object; q.data.materials.append(mat("inciso", (0.05, 0.035, 0.015), 0.6, 1.0)); out += [o, q]
        elif kind == "vetro":        # un occhio di vetro soffiato: bulbo chiaro, iride scura a tacca
            bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.05, location=c + Vector((0, 0.0, 0)))
            o = bpy.context.active_object; bpy.ops.object.shade_smooth(); o.data.materials.append(mat("bulbo", (0.62, 0.6, 0.52), 0.12))
            bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.022, depth=0.01, location=c + Vector((0, 0.047, 0)), rotation=(math.radians(90), 0, 0))
            q = bpy.context.active_object; q.data.materials.append(mat("iride", (0.02, 0.03, 0.035), 0.1)); out += [o, q]
        # "ombra": niente occhio, solo l'orbita profonda in ombra
        elif kind == "ombra":
            bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.06, location=c + Vector((0, 0.0, 0)))
            d = bpy.context.active_object; d.scale = (1, 0.4, 0.8); d.data.materials.append(mat("buio", (0.004, 0.004, 0.004), 1)); out.append(d)
    return out

if SHEET:
    KINDS = [("gemma", "A  gemma incastonata"), ("perla", "B  perla nera"), ("brace", "C  brace nell'orbita"), ("moneta", "D  moneta d'ottone"), ("vetro", "E  occhio di vetro"), ("ombra", "F  orbita vuota")]
    skin = mat("pelle", (0.42, 0.27, 0.19), 0.6)
    for i, (k, _) in enumerate(KINDS):
        h = sculpt(f"testa{i}", {}); h.data.materials.append(skin)
        piv = bpy.data.objects.new(f"perno{i}", None); scene.collection.objects.link(piv)
        for e in [h] + eyes(k, 0.0): e.parent = piv
        piv.location.x = (2.5 - i) * 1.05; piv.rotation_euler.z = math.radians(-24)
    world = bpy.data.worlds.new("w"); world.use_nodes = True; world.node_tree.nodes["Background"].inputs[0].default_value = (0.012, 0.014, 0.018, 1); scene.world = world
    def light(name, kind, loc, energy, col, size=1.0):
        d = bpy.data.lights.new(name, kind); d.energy = energy; d.color = col
        if kind == 'AREA': d.size = size
        o = bpy.data.objects.new(name, d); o.location = loc; scene.collection.objects.link(o)
        o.rotation_euler = (Vector((0, 0.2, 0.45)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler(); return o
    light("chiave", 'AREA', (3.5, 3.6, 2.2), 420, (1.0, 0.82, 0.62), 3); light("controluce", 'AREA', (-4.5, -2.5, 1.8), 500, (0.45, 0.6, 1.0), 2.0); light("riempi", 'AREA', (0, 5, -0.4), 40, (1, 0.9, 0.8), 5)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam); scene.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 6.5; cam.location = (0, 6, 0.55)
    cam.rotation_euler = (Vector((0, 0, 0.45)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = 96
    scene.render.resolution_x, scene.render.resolution_y = 2000, 440
    out = os.path.join(ROOT, "docs", "reference", "npc", "occhi.png"); os.makedirs(os.path.dirname(out), exist_ok=True)
    scene.render.filepath = out; bpy.ops.render.render(write_still=True)
    print("[teste] tavola:", out, "·", " | ".join(n for _, n in KINDS))

if not SHEET:
    # ── le teste del gioco: quattro tipi, alleggeriti (circa 2600 triangoli l'uno), con l'occlusione cotta nei vertici ──
    TIPI = {"uomo": {}, "donna": {"jaw": 0.86, "brow": 0.6, "nose": 0.82, "lip": 1.12, "cheek": 1.05}, "vecchio": {"jaw": 0.93, "nose": 1.22, "brow": 1.15, "cheek": 0.8, "lip": 0.85},
            "bimbo": {"jaw": 0.84, "nose": 0.72, "brow": 0.5, "cheek": 1.12, "lip": 1.0}}
    scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = 32
    heads = {}
    for name, p in TIPI.items():
        ob = sculpt(name, p)
        m = ob.modifiers.new("d", 'DECIMATE'); m.ratio = min(1.0, 2600 / max(1, sum(len(f.vertices) - 2 for f in ob.data.polygons)))
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier="d")
        bm = bmesh.new(); bm.from_mesh(ob.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.16], context='VERTS')   # il collo finisce dentro il colletto
        bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(ob.data); bm.free()
        for f in ob.data.polygons: f.use_smooth = True
        heads[name] = ob
    for ob in heads.values():
        me = ob.data; attr = me.color_attributes.new("ao", 'FLOAT_COLOR', 'POINT'); me.color_attributes.active_color = attr; me.color_attributes.render_color_index = me.color_attributes.find("ao")
        ob.data.materials.append(mat("pelle", (0.5, 0.5, 0.5)))
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
        for o in heads.values(): o.hide_render = o is not ob
        scene.render.bake.target = 'VERTEX_COLORS'; bpy.ops.object.bake(type='AO')
    data = {"eye": [SOCKET.x, SOCKET.z, SOCKET.y]}
    for name, ob in heads.items():
        me = ob.data; ao = me.color_attributes["ao"]; P, N, C, I = [], [], [], []
        for v in me.vertices:
            P += [round(v.co.x, 4), round(v.co.z, 4), round(v.co.y, 4)]; n = v.normal; N += [round(n.x, 3), round(n.z, 3), round(n.y, 3)]; C.append(round(ao.data[v.index].color[0], 3))
        for f in me.polygons: I += [f.vertices[0], f.vertices[2], f.vertices[1]]
        data[name] = {"p": P, "n": N, "c": C, "i": I}
    out = os.path.join(ROOT, "public", "kit", "teste.json")
    json.dump(data, open(out, "w"), separators=(",", ":"))
    print("[teste]", {k: len(v["p"]) // 3 for k, v in data.items() if k != "eye"}, os.path.getsize(out) // 1024, "KB")
