"""Gatherly brand kit generator. Usage: python generate.py <Inter-Bold.ttf> <outdir>
Needs: resvg_py, fonttools, ImageMagick (`magick`) for favicon.ico."""
import os, sys, subprocess
import resvg_py
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONT, OUT = sys.argv[1], sys.argv[2]
for d in ("", "png", "web", "stream-deck"):
    os.makedirs(os.path.join(OUT, d), exist_ok=True)

INK, WHITE, MINT, LEAF = "#111111", "#ffffff", "#CDEFD9", "#1E5C41"
FOREST_A, FOREST_B = "#0B2A1E", "#14402E"   # tile / Stream Deck canvas

# ── Symbol: a doorway inside a doorway, 256 grid ───────────────────────
# Outer arch: legs 36 (44 small), inner arch: solid, gap = leg width.
# Feet share one baseline (y 230); the pair is optically centred on 128.
def symbol(color, small=False):
    if small:  # ≤32 px: thicker legs, narrower gap
        outer = "M20 230V130A108 108 0 0 1 236 130V230H192V130A64 64 0 0 0 64 130V230Z"
        inner = "M92 230V138A36 36 0 0 1 164 138V230Z"
    else:
        outer = "M24 230V130A104 104 0 0 1 232 130V230H196V130A68 68 0 0 0 60 130V230Z"
        inner = "M96 230V138A32 32 0 0 1 160 138V230Z"
    return f'<g fill="{color}"><path d="{outer}"/><path d="{inner}"/></g>'

def grad(id_, a, b):
    return (f'<defs><linearGradient id="{id_}" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient></defs>')

def svg(vb, body, title="Gatherly"):
    w, h = vb.split()[2:]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w}" height="{h}" role="img">'
            f'<title>{title}</title>{body}</svg>\n')

# ── Wordmark: Inter Bold outlined (SIL OFL), tracking -3 ───────────────
font = TTFont(FONT)
gs, cmap = font.getGlyphSet(), font.getBestCmap()
CAP = font["OS/2"].sCapHeight

def line(text, cap_px, tracking=-3):
    k = cap_px / CAP
    pen = SVGPathPen(gs)
    x = 0
    for ch in text:
        g = cmap[ord(ch)]
        gs[g].draw(TransformPen(pen, (k, 0, 0, -k, x, 0)))
        x += gs[g].width * k + tracking
    return pen.getCommands(), x - tracking

CAPH = 112
word, ww = line("Gatherly", CAPH)
TX = 232 + 60                                  # text starts 60 after the symbol's right edge
BASE = 128 + CAPH / 2                          # cap block centred on the symbol
LOCK_W = int(TX + ww + 24)                     # right margin = the symbol's left margin
def lockup(color):
    return symbol(color) + f'<path fill="{color}" transform="translate({TX} {BASE})" d="{word}"/>'
LVB = f"0 0 {LOCK_W} 256"

def tile(vb, size, inner, rx=True):
    r = f' rx="{size * 0.225:.1f}"' if rx else ""
    return (grad("g", FOREST_A, FOREST_B) + f'<rect width="{size}" height="{size}"{r} fill="url(#g)"/>' + inner)

files = {
    "gatherly-lockup.svg": svg(LVB, lockup(INK)),
    "gatherly-lockup-black.svg": svg(LVB, lockup("#000000")),
    "gatherly-lockup-white.svg": svg(LVB, lockup(WHITE)),
    "gatherly-lockup-leaf.svg": svg(LVB, lockup(LEAF)),
    "gatherly-lockup-mono-cdefd9.svg": svg(LVB, lockup(MINT)),
    "gatherly-symbol.svg": svg("0 0 256 256", symbol(INK)),
    "gatherly-symbol-black.svg": svg("0 0 256 256", symbol("#000000")),
    "gatherly-symbol-white.svg": svg("0 0 256 256", symbol(WHITE)),
    "gatherly-symbol-leaf.svg": svg("0 0 256 256", symbol(LEAF)),
    "gatherly-symbol-mono-cdefd9.svg": svg("0 0 256 256", symbol(MINT)),
    "gatherly-symbol-small.svg": svg("0 0 256 256", symbol(INK, True), "Gatherly (small sizes)"),
    "gatherly-symbol-small-white.svg": svg("0 0 256 256", symbol(WHITE, True)),
    "gatherly-symbol-small-mono-cdefd9.svg": svg("0 0 256 256", symbol(MINT, True)),
    "gatherly-symbol-square.svg": svg("0 0 256 256", f'<g transform="translate(25.6 25.6) scale(0.8)">{symbol(INK)}</g>'),
    "gatherly-symbol-app-icon.svg": svg("0 0 256 256",
        tile("0 0 256 256", 256, f'<g transform="translate(38.4 38.4) scale(0.7)">{symbol(MINT)}</g>')),
    # adapts to the tab bar: ink on light, mint on dark
    "gatherly-symbol-favicon.svg": svg("10 10 236 236",
        f'<style>g{{color:{LEAF}}}@media (prefers-color-scheme:dark){{g{{color:{MINT}}}}}</style>'
        f'<g>{symbol("currentColor", True)}</g>'),
    # Stream Deck: full bleed (the key is already square), symbol at 60 %
    "gatherly-stream-deck-forest.svg": svg("0 0 288 288",
        tile("0 0 288 288", 288, f'<g transform="translate(57.6 57.6) scale(0.675)">{symbol(WHITE)}</g>', rx=False)),
    "gatherly-stream-deck-dark.svg": svg("0 0 288 288",
        '<rect width="288" height="288" fill="#0d1117"/>'
        f'<g transform="translate(57.6 57.6) scale(0.675)">{symbol(MINT)}</g>'),
}
for name, content in files.items():
    open(os.path.join(OUT, name), "w").write(content)

def png(src_svg, dst, width):
    data = resvg_py.svg_to_bytes(svg_string=src_svg, width=width)
    open(os.path.join(OUT, dst), "wb").write(bytes(data))

png(files["gatherly-lockup-black.svg"], "png/gatherly-lockup-black.png", 1000)
png(files["gatherly-lockup-leaf.svg"], "png/gatherly-lockup-leaf.png", 1000)
png(files["gatherly-lockup-white.svg"], "../../app_logo.png", 1035)
for v in ("black", "white", "mono-cdefd9"):
    png(files[f"gatherly-symbol-{v}.svg"], f"png/gatherly-symbol-{v}.png", 512)
icon = files["gatherly-symbol-app-icon.svg"]
for n in (16, 32, 48):
    # small cut, larger in the tile: at 16 px every pixel of margin is lost legibility
    small_tile = icon.replace(f'<g transform="translate(38.4 38.4) scale(0.7)">{symbol(MINT)}',
                              f'<g transform="translate(18 18) scale(0.86)">{symbol(MINT, True)}')
    png(small_tile, f"web/favicon-{n}.png", n)
for n in (192, 512):
    png(icon, f"web/icon-{n}.png", n)
# Apple masks the corners itself: full-bleed square
png(icon.replace(' rx="57.6"', ""), "web/apple-touch-icon.png", 180)
for v in ("forest", "dark"):
    for n in (288, 144):
        png(files[f"gatherly-stream-deck-{v}.svg"], f"stream-deck/gatherly-{v}-{n}.png", n)
w = os.path.join(OUT, "web")
subprocess.run(["magick", f"{w}/favicon-16.png", f"{w}/favicon-32.png", f"{w}/favicon-48.png", f"{w}/favicon.ico"], check=True)
print("lockup width", LOCK_W)
