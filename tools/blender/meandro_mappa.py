# La mappa di controllo di meandro.py: il rilievo a toni (con le curve ogni 2 m), il fiume, le mura, le vie, gli ingombri.
#   python tools/blender/meandro_mappa.py <meandro.json> <mappa.png>
import json, math, os, struct, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
L = json.load(open(sys.argv[1], encoding="utf8"))
T = L["town"]
cx, cz = T["at"]
raw = open(os.path.join(ROOT, "public", "data", "rilievo.bin"), "rb").read()
x0, z0, w, h = struct.unpack("<4f", raw[:16]); w, h = int(w), int(h)
H = struct.unpack(f"<{w * h}h", raw[16:16 + w * h * 2])   # (dopo le quote ci sono i pesi)
K = 3   # pixel per metro
im = Image.new("RGB", (w * K, h * K))
px = im.load()
lo, hi = min(H) / 100, max(H) / 100
for j in range(h):
    for i in range(w):
        y = H[j * w + i] / 100
        g = int(40 + 180 * (y - lo) / (hi - lo + 1e-6))
        c = (g, g, int(g * 0.92))
        if y < T["river"]["level"]:
            c = (30, 60, 90)
        elif (int(y / 2) != int(H[j * w + min(i + 1, w - 1)] / 200)) or (int(y / 2) != int(H[min(j + 1, h - 1) * w + i] / 200)):
            c = (c[0] - 25, c[1] - 25, c[2] - 25)
        for a in range(K):
            for b in range(K):
                px[i * K + a, (h - 1 - j) * K + b] = c
d = ImageDraw.Draw(im)
P = lambda x, z: ((cx + x - x0) * K, (h - 1 - (cz + z - z0)) * K)   # nord in alto


def rect(x, z, hw, hd, yaw, **kw):
    t = math.radians(yaw); X = (math.cos(t), -math.sin(t)); Z = (math.sin(t), math.cos(t))
    pts = [P(x + X[0] * a + Z[0] * b, z + X[1] * a + Z[1] * b) for a, b in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]
    d.polygon(pts, **kw)


d.line([P(*p) for p in T["walls"] + T["walls"][:1]], fill=(200, 60, 40), width=3)
for wk in T["walks"]:
    d.line([P(*p) for p in wk], fill=(240, 220, 120), width=2)
COL = {"casa.povera": (120, 90, 60), "casa.graticcio": (190, 90, 60), "casa.ricca": (120, 130, 160)}
f = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 13)
for c in T["children"]:
    if c["prefab"] == "ponte":
        d.line([P(c["from"][0], c["from"][2]), P(c["to"][0], c["to"][2])], fill=(230, 230, 230), width=int(5.4 * K))
        continue
    x, z = c["at"]
    s = c.get("scale", 1)
    if c["prefab"].startswith("casa."):
        rect(x, z, c["size"][0] * s / 2, c["size"][1] * s / 2, c["yaw"], fill=COL[c["prefab"]], outline=(0, 0, 0))
        if c.get("id"):
            d.text(P(x - 3, z + 2), c["id"], font=f, fill=(255, 255, 255))
    elif c["prefab"] == "cattedrale":
        rect(x, z, 10, 22, c["yaw"], fill=(200, 200, 210), outline=(0, 0, 0)); d.text(P(x, z), "CATTEDRALE", font=f, fill=(0, 0, 0))
    elif c["prefab"] == "teatro":
        rect(x, z, 12.5 * s, 24.5 * s, c["yaw"], fill=(170, 120, 200), outline=(0, 0, 0)); d.text(P(x, z), "TEATRO", font=f, fill=(0, 0, 0))
    elif c["prefab"] == "municipio":
        rect(x, z, 16, 8, c["yaw"], fill=(200, 170, 90), outline=(0, 0, 0)); d.text(P(x, z), "MUNICIPIO", font=f, fill=(0, 0, 0))
    else:
        d.ellipse([P(x - 1.2, z + 1.2), P(x + 1.2, z - 1.2)], fill=(255, 255, 0) if c["prefab"] == "lampione" else (90, 220, 90))
for k, s in T["spots"].items():
    x, z = s["at"]; d.ellipse([P(x - 0.8, z + 0.8), P(x + 0.8, z - 0.8)], fill=(255, 0, 255))
d.text((10, 10), f"rilievo {lo:.1f}–{hi:.1f} m (curve ogni 2 m) · acqua {T['river']['level']} m · {sum(1 for c in T['children'] if c['prefab'].startswith('casa.'))} case", font=f, fill=(255, 255, 255))
im.save(sys.argv[2])
