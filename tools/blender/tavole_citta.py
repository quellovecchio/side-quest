# Compone le tavole degli impianti della città (i render di citta.py) in docs/reference/citta/scenografia/:
# una tavola per impianto (veduta, dal fiume, dalla finestra della cattedrale, pianta) con titolo e note, e un confronto.
#   python tools/blender/tavole_citta.py
import os
from PIL import Image, ImageDraw, ImageFont

D = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "reference", "citta", "scenografia")
F = lambda s: ImageFont.truetype("C:/Windows/Fonts/georgia.ttf", s)
NOTE = {
    "A": ("A — La rocca", [
        "Un colle sale da ovest a est e finisce in uno sperone a picco: la cattedrale in cima, l'abside sul dirupo.",
        "Il fiume lambisce le mura a ovest: si entra da un ponte fortificato con la torre della porta.",
        "Povera: in basso lungo il fiume (case basse, tetti di paglia). Media: la piazza a metà salita.",
        "Ricca: le terrazze alte attorno alla cattedrale. Teatro: una cavea scavata nel fianco sud, guarda la valle.",
        "Dalle vetrate: la valle a est, sotto il dirupo, e le montagne oltre."]),
    "B": ("B — Le due rive", [
        "Il fiume taglia la città da nord a sud. Riva ovest: bassa, piana, fitta, povera (la porta è qui).",
        "Riva est: una rupe di 35 m con i palazzi a torre, la cattedrale in cima; le vie salgono a tornanti.",
        "Due ponti: uno grande con le botteghe sopra (alla Ponte Vecchio), una passerella bassa a sud.",
        "Teatro: un tamburo di legno a gallerie sul pianoro della rupe, fra i palazzi.",
        "Dalle vetrate: le montagne a nord-est sopra il bosco."]),
    "C": ("C — L'anfiteatro", [
        "La città a gradoni su un pendio rivolto a sud, come una cavea; la cattedrale al vertice, in asse.",
        "In fondo una gola profonda (14 m) col ponte alto; oltre, il borgo basso dei poveri, fuori le mura.",
        "Le terrazze sono archi lungo le curve di livello, cuciti da una scalinata maggiore dal ponte alla cattedrale.",
        "Povera: il borgo oltre la gola. Media: le terrazze basse. Ricca: le alte. Teatro: coperto, all'italiana, in alto a ovest.",
        "Dalle vetrate: l'abside guarda a nord, sulle montagne."]),
}
NOTE2 = {
    "D": ("D — L'ansa", [
        "Il fiume taglia la città in obliquo, da nord-ovest a sud-est, con una curva a S. A sud-ovest la riva bassa e povera, a nord-est la rupe.",
        "Si entra da sud-ovest: la via della porta serpeggia fra le case povere fino al ponte delle botteghe; di là sale a tornanti.",
        "La cattedrale sta su uno sperone a nord-est, fuori asse, girata verso la porta: la si vede di tre quarti appena entrati.",
        "Una passerella a monte; teatro tondo di legno sulla rupe, fra i palazzi."]),
    "E": ("E — L'isola", [
        "Il fiume, in obliquo da sud-ovest a nord-est, si apre in due bracci attorno a uno scoglio alto 40 m: sullo scoglio la cattedrale.",
        "Riva sud-est bassa e povera (la porta), riva nord-ovest alta e ricca, con un teatro a gradinate rivolto all'isola.",
        "Tre ponti: delle botteghe (dalla riva povera allo scoglio), ad arco alto (dallo scoglio alla riva ricca), una passerella a valle.",
        "Entrando, la cattedrale sta di là dall'acqua, sopra le case, girata di tre quarti."]),
    "F": ("F — Il meandro", [
        "Il fiume entra da nord-ovest, gira attorno a un promontorio e riparte verso sud-ovest: la città sta su tutte e due le rive.",
        "Sul promontorio i ricchi, a terrazze, con la cattedrale in punta, fuori asse; fuori dall'ansa i borghi poveri, a nord e a sud-est.",
        "Si entra da ovest sul collo del promontorio: la via sale serpeggiando e la cattedrale chiude la vista in fondo.",
        "Due ponti dal promontorio ai borghi (uno con le botteghe, uno ad arco alto), una passerella a ovest; teatro coperto sul promontorio."]),
}
for t, (title, lines) in NOTE2.items():
    if not os.path.exists(os.path.join(D, f"{t}_ingresso.png")):
        continue
    im = {k: Image.open(os.path.join(D, f"{t}_{k}.png")).convert("RGB") for k in ("veduta", "ingresso", "fiume", "cattedrale", "pianta")}
    W, H, w, h = 1600, 900, 820, 461
    S = Image.new("RGB", (W + H + 60, 260 + H + h + 50), (22, 19, 16))
    d = ImageDraw.Draw(S)
    d.text((30, 22), title, font=F(54), fill=(240, 192, 112))
    for i, l in enumerate(lines):
        d.text((30, 100 + i * 36), l, font=F(26), fill=(222, 212, 192))
    y0 = 260
    S.paste(im["veduta"], (20, y0)); S.paste(im["pianta"].resize((H, H)), (W + 40, y0))
    for i, k in enumerate(("ingresso", "fiume", "cattedrale")):
        S.paste(im[k].resize((w, h)), (20 + i * (w + 20), y0 + H + 20))
    labels = ((30, y0 + 10, "veduta"), (W + 50, y0 + 10, "pianta (300 m)"), (30, y0 + H + 30, "entrando dalla porta"),
              (30 + w + 20, y0 + H + 30, "dal fiume"), (30 + 2 * (w + 20), y0 + H + 30, "dalla finestra della cattedrale"))
    for (x, y, s_) in labels:
        d.text((x + 2, y + 2), s_, font=F(30), fill=(0, 0, 0)); d.text((x, y), s_, font=F(30), fill=(255, 240, 210))
    S.save(os.path.join(D, f"tavola_{t}.png"))
for t, (title, lines) in NOTE.items():
    im = {k: Image.open(os.path.join(D, f"{t}_{k}.png")).convert("RGB") for k in ("veduta", "fiume", "cattedrale", "pianta")}
    W, H = 1600, 900
    S = Image.new("RGB", (W * 2 + 60, H * 2 + 330), (22, 19, 16))
    d = ImageDraw.Draw(S)
    d.text((30, 22), title, font=F(54), fill=(240, 192, 112))
    for i, l in enumerate(lines):
        d.text((30, 100 + i * 36), l, font=F(26), fill=(222, 212, 192))
    y0 = 300
    S.paste(im["veduta"], (20, y0)); S.paste(im["fiume"], (W + 40, y0))
    S.paste(im["cattedrale"], (20, y0 + H + 10))
    p = im["pianta"].resize((H, H)); S.paste(p, (W + 40 + (W - H) // 2, y0 + H + 10))
    for (x, y, s) in ((30, y0 + 10, "veduta"), (W + 50, y0 + 10, "dal fiume"), (30, y0 + H + 20, "dalla finestra della cattedrale"), (W + 50 + (W - H) // 2, y0 + H + 20, "pianta (300 m)")):
        d.text((x + 2, y + 2), s, font=F(30), fill=(0, 0, 0)); d.text((x, y), s, font=F(30), fill=(255, 240, 210))
    if t == "A":
        legend = "pianta: tetti bruni = povere · rossi = medie · grigi a padiglione = ricche"
        d.text((W + 50 + (W - H) // 2, y0 + 2 * H - 30), legend, font=F(22), fill=(255, 240, 210))
    S.save(os.path.join(D, f"tavola_{t}.png"))
# il confronto: le tre vedute e le tre piante
for name, group, notes in (("confronto.png", "ABC", NOTE), ("confronto_2.png", "DEF", NOTE2)):
  if not all(os.path.exists(os.path.join(D, f"{t}_veduta.png")) for t in group):
    continue
  C = Image.new("RGB", (3 * 960 + 40, 540 + 540 + 120), (22, 19, 16))
  d = ImageDraw.Draw(C)
  for i, t in enumerate(group):
    x = 10 + i * 970
    d.text((x, 20), notes[t][0], font=F(40), fill=(240, 192, 112))
    C.paste(Image.open(os.path.join(D, f"{t}_veduta.png")).convert("RGB").resize((960, 540)), (x, 90))
    C.paste(Image.open(os.path.join(D, f"{t}_pianta.png")).convert("RGB").resize((540, 540)), (x + 210, 650))
  C.save(os.path.join(D, name))
print("ok")
