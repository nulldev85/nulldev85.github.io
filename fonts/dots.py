"""Builds the site's dot-matrix fonts from the letters drawn below.

    pip install fonttools brotli
    python3 fonts/dots.py

Every letter is drawn on a grid of round dots, five wide and seven tall for
capitals, with two more rows below for descenders. Each dot in a font is the
same small circle, placed by reference, which keeps the files small.

  dots.woff2          one dot for each point of the grid
  dots-display.woff2  the same single-line strokes with slightly larger circles

Both have the same metrics, so either can stand in for the other.
"""

import math
import pathlib

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent

HERE = pathlib.Path(__file__).resolve().parent

# Rows count down from the top of a capital (row 0) to the baseline (row 6);
# rows 7 and 8 hang below it. A letter is (first row, its rows).
CAPS, X = 0, 2
LETTERS = {
    "A": (CAPS, [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"]),
    "B": (CAPS, ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."]),
    "C": (CAPS, [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."]),
    "D": (CAPS, ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."]),
    "E": (CAPS, ["#####", "#....", "#....", "####.", "#....", "#....", "#####"]),
    "F": (CAPS, ["#####", "#....", "#....", "####.", "#....", "#....", "#...."]),
    "G": (CAPS, [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."]),
    "H": (CAPS, ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"]),
    "I": (CAPS, ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"]),
    "J": (CAPS, ["....#", "....#", "....#", "....#", "....#", "#...#", ".###."]),
    "K": (CAPS, ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"]),
    "L": (CAPS, ["#....", "#....", "#....", "#....", "#....", "#....", "#####"]),
    "M": (CAPS, ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"]),
    "N": (CAPS, ["#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"]),
    "O": (CAPS, [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."]),
    "P": (CAPS, ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."]),
    "Q": (CAPS, [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"]),
    "R": (CAPS, ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"]),
    "S": (CAPS, [".###.", "#...#", "#....", ".###.", "....#", "#...#", ".###."]),
    "T": (CAPS, ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."]),
    "U": (CAPS, ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."]),
    "V": (CAPS, ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."]),
    "W": (CAPS, ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."]),
    "X": (CAPS, ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"]),
    "Y": (CAPS, ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."]),
    "Z": (CAPS, ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"]),

    "a": (X, [".###.", "....#", ".####", "#...#", ".####"]),
    "b": (CAPS, ["#....", "#....", "####.", "#...#", "#...#", "#...#", "####."]),
    "c": (X, [".###.", "#....", "#....", "#...#", ".###."]),
    "d": (CAPS, ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"]),
    "e": (X, [".###.", "#...#", "#####", "#....", ".###."]),
    "f": (CAPS, ["..##", ".#..", "####", ".#..", ".#..", ".#..", ".#.."]),
    "g": (X, [".####", "#...#", "#...#", "#...#", ".####", "....#", ".###."]),
    "h": (CAPS, ["#....", "#....", "####.", "#...#", "#...#", "#...#", "#...#"]),
    "i": (CAPS, ["#", ".", "#", "#", "#", "#", "#"]),
    "j": (CAPS, ["..#", "...", "..#", "..#", "..#", "..#", "..#", "#.#", ".#."]),
    "k": (CAPS, ["#...", "#...", "#..#", "#.#.", "##..", "#.#.", "#..#"]),
    "l": (CAPS, ["#", "#", "#", "#", "#", "#", "#"]),
    "m": (X, ["####.", "#.#.#", "#.#.#", "#.#.#", "#.#.#"]),
    "n": (X, ["####.", "#...#", "#...#", "#...#", "#...#"]),
    "o": (X, [".###.", "#...#", "#...#", "#...#", ".###."]),
    "p": (X, ["####.", "#...#", "#...#", "#...#", "####.", "#....", "#...."]),
    "q": (X, [".####", "#...#", "#...#", "#...#", ".####", "....#", "....#"]),
    "r": (X, ["#.##", "##..", "#...", "#...", "#..."]),
    "s": (X, [".####", "#....", ".###.", "....#", "####."]),
    "t": (CAPS, [".#..", ".#..", "####", ".#..", ".#..", ".#..", "..##"]),
    "u": (X, ["#...#", "#...#", "#...#", "#...#", ".####"]),
    "v": (X, ["#...#", "#...#", "#...#", ".#.#.", "..#.."]),
    "w": (X, ["#...#", "#...#", "#.#.#", "#.#.#", ".#.#."]),
    "x": (X, ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"]),
    "y": (X, ["#...#", "#...#", "#...#", "#...#", ".####", "....#", ".###."]),
    "z": (X, ["#####", "...#.", "..#..", ".#...", "#####"]),

    "0": (CAPS, [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."]),
    "1": (CAPS, [".#.", "##.", ".#.", ".#.", ".#.", ".#.", "###"]),
    "2": (CAPS, [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"]),
    "3": (CAPS, [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."]),
    "4": (CAPS, ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."]),
    "5": (CAPS, ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."]),
    "6": (CAPS, ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."]),
    "7": (CAPS, ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."]),
    "8": (CAPS, [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."]),
    "9": (CAPS, [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."]),

    ".": (6, ["#"]),
    ",": (5, [".#", ".#", "#."]),
    ":": (2, ["#", ".", ".", "#"]),
    ";": (2, [".#", "..", "..", ".#", ".#", "#."]),
    "!": (CAPS, ["#", "#", "#", "#", "#", ".", "#"]),
    "?": (CAPS, [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."]),
    "'": (CAPS, ["#", "#"]),
    '"': (CAPS, ["#.#", "#.#"]),
    "`": (CAPS, ["#.", ".#"]),
    "-": (3, ["###"]),
    "_": (7, ["#####"]),
    "(": (CAPS, ["..#", ".#.", "#..", "#..", "#..", ".#.", "..#"]),
    ")": (CAPS, ["#..", ".#.", "..#", "..#", "..#", ".#.", "#.."]),
    "[": (CAPS, ["###", "#..", "#..", "#..", "#..", "#..", "###"]),
    "]": (CAPS, ["###", "..#", "..#", "..#", "..#", "..#", "###"]),
    "{": (CAPS, ["..##", ".#..", ".#..", "#...", ".#..", ".#..", "..##"]),
    "}": (CAPS, ["##..", "..#.", "..#.", "...#", "..#.", "..#.", "##.."]),
    "/": (CAPS, ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."]),
    "\\": (CAPS, ["#....", "#....", ".#...", "..#..", "...#.", "....#", "....#"]),
    "|": (CAPS, ["#", "#", "#", "#", "#", "#", "#", "#"]),
    "&": (CAPS, [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"]),
    "@": (CAPS, [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."]),
    "#": (CAPS, [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."]),
    "$": (CAPS, ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."]),
    "%": (CAPS, ["##...", "##..#", "...#.", "..#..", ".#...", "#..##", "...##"]),
    "^": (CAPS, ["..#..", ".#.#.", "#...#"]),
    "~": (2, [".#...", "#.#.#", "...#."]),
    "*": (1, ["..#..", "#.#.#", ".###.", "#.#.#", "..#.."]),
    "+": (1, ["..#..", "..#..", "#####", "..#..", "..#.."]),
    "=": (2, ["#####", ".....", "#####"]),
    "<": (CAPS, ["...#", "..#.", ".#..", "#...", ".#..", "..#.", "...#"]),
    ">": (CAPS, ["#...", ".#..", "..#.", "...#", "..#.", ".#..", "#..."]),

    "’": (CAPS, [".#", ".#", "#."]),           # ’
    "‘": (CAPS, [".#", "#.", "#."]),           # ‘
    "”": (CAPS, [".#.#", ".#.#", "#.#."]),     # ”
    "“": (CAPS, [".#.#", "#.#.", "#.#."]),     # “
    "–": (3, ["####"]),                        # –
    "—": (3, ["#######"]),                     # —
    "…": (6, ["#.#.#"]),                       # …
    "·": (3, ["#"]),                           # ·
    "•": (2, [".#.", "###", ".#."]),           # •
    "›": (2, ["#..", ".#.", "..#", ".#.", "#.."]),  # ›
    "‹": (2, ["..#", ".#.", "#..", ".#.", "..#"]),  # ‹
    "×": (2, ["#.#", ".#.", "#.#"]),           # ×
    "°": (CAPS, [".#.", "#.#", ".#."]),        # °
    "→": (1, ["..#..", "...#.", "#####", "...#.", "..#.."]),  # →
    "©": (CAPS, [".#####.", "#.....#", "#.###.#", "#.#...#", "#.###.#", "#.....#", ".#####."]),  # ©
    "é": (CAPS, ["...#.", "..#..", ".###.", "#...#", "#####", "#....", ".###."]),  # é
}
SPACE = 4          # columns, the gap after it included
PITCH = 100        # font units from one dot to the next
CAP_TOP = 700      # the top of a capital, above the baseline


def points(letter):
    top, rows = LETTERS[letter]
    width = max(len(row) for row in rows)
    lit = {(top + r, c) for r, row in enumerate(rows) for c, key in enumerate(row) if key == "#"}
    return lit, width


def dot(radius):
    """A circle of eight quadratic curves with no points on it, the way
    TrueType allows."""
    pen = TTGlyphPen(None)
    reach = radius / math.cos(math.pi / 8)
    pen.qCurveTo(*[(round(reach * math.cos(math.pi / 8 + k * math.pi / 4)),
                    round(reach * math.sin(math.pi / 8 + k * math.pi / 4))) for k in range(8)], None)
    pen.closePath()
    return pen.glyph()


def build(path, family, dot_size=.42):
    step = PITCH
    radius = step * dot_size
    names, glyphs, metrics, cmap = [".notdef", "space", "dot"], {}, {}, {32: "space"}
    glyphs[".notdef"] = TTGlyphPen(None).glyph()
    glyphs["space"] = TTGlyphPen(None).glyph()
    glyphs["dot"] = dot(radius)
    metrics[".notdef"] = (600, 0)
    metrics["space"] = (SPACE * PITCH, 0)
    metrics["dot"] = (0, -round(radius))
    for letter in LETTERS:
        lit, width = points(letter)
        name = f"uni{ord(letter):04X}"
        glyph = Glyph()
        glyph.numberOfContours = -1
        glyph.components = []
        for row, col in sorted(lit):
            part = GlyphComponent()
            part.glyphName = "dot"
            part.flags = 0
            # Half a pitch of space either side of the letter.
            part.x = round(PITCH / 2 + col * step + step / 2)
            part.y = round(CAP_TOP - row * step - step / 2)
            glyph.components.append(part)
        names.append(name)
        glyphs[name] = glyph
        left = min(part.x for part in glyph.components) - round(radius)
        metrics[name] = ((width + 1) * PITCH, left)
        cmap[ord(letter)] = name
    cmap[0xA0] = "space"

    font = FontBuilder(1000, isTTF=True)
    font.setupGlyphOrder(names)
    font.setupCharacterMap(cmap)
    font.setupGlyf(glyphs)
    font.setupHorizontalMetrics(metrics)
    font.setupHorizontalHeader(ascent=800, descent=-200)
    font.setupNameTable({"familyName": family, "styleName": "Regular"})
    font.setupOS2(sTypoAscender=800, sTypoDescender=-200, sTypoLineGap=0, usWinAscent=900, usWinDescent=300,
                  sxHeight=500, sCapHeight=700, achVendID="NULL")
    font.setupPost()
    font.font.flavor = "woff2"
    font.save(path)
    return path


if __name__ == "__main__":
    for file, family, dot_size in [("dots.woff2", "Null Dots", .42), ("dots-display.woff2", "Null Dots Display", .46)]:
        out = build(HERE / file, family, dot_size)
        print(out.name, out.stat().st_size, "bytes")
