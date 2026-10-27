"""Builds the site's dot-matrix fonts from the letters drawn below.

    pip install fonttools brotli
    python3 fonts/dots.py

Every letter is drawn on a grid of round dots, five wide and seven tall for
capitals, with two more rows below for descenders. Each dot in a font is the
same small circle, placed by reference, which keeps the files small.

  dots.woff2        one dot for each point of the grid
  dots-thick.woff2  for big text: each point becomes two rows and two columns
                    of smaller dots, and the steps of curves and diagonals are
                    filled in, so strokes are thick bands of dots

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


def thicken(lit):
    """Each point as two by two smaller ones, with the inside of each step of
    a curve or diagonal filled (the Scale2x rule, which leaves the one-point
    gaps between strokes open)."""
    fine = set()
    rows = {r for r, _ in lit}
    cols = {c for _, c in lit}
    for r in range(min(rows) - 1, max(rows) + 2):
        for c in range(min(cols) - 1, max(cols) + 2):
            if (r, c) in lit:
                fine |= {(2 * r, 2 * c), (2 * r, 2 * c + 1), (2 * r + 1, 2 * c), (2 * r + 1, 2 * c + 1)}
                continue
            up, down, left, right = ((r - 1, c) in lit, (r + 1, c) in lit, (r, c - 1) in lit, (r, c + 1) in lit)
            if up and left and not down and not right: fine.add((2 * r, 2 * c))
            if up and right and not down and not left: fine.add((2 * r, 2 * c + 1))
            if down and left and not up and not right: fine.add((2 * r + 1, 2 * c))
            if down and right and not up and not left: fine.add((2 * r + 1, 2 * c + 1))
    return fine


def widen(fine):
    """One more dot to the right of and below every dot, so each stroke is
    three dots across; the gaps between strokes stay open."""
    return fine | {(r + down, c + across) for r, c in fine for down, across in ((0, 1), (1, 0), (1, 1))}


def dot(radius):
    """A circle of eight quadratic curves with no points on it, the way
    TrueType allows."""
    pen = TTGlyphPen(None)
    reach = radius / math.cos(math.pi / 8)
    pen.qCurveTo(*[(round(reach * math.cos(math.pi / 8 + k * math.pi / 4)),
                    round(reach * math.sin(math.pi / 8 + k * math.pi / 4))) for k in range(8)], None)
    pen.closePath()
    return pen.glyph()


def build(path, family, thick, wide=True):
    split = 2 if thick else 1
    step = PITCH // split
    radius = step * (.44 if thick else .42)
    names, glyphs, metrics, cmap = [".notdef", "space", "dot"], {}, {}, {32: "space"}
    glyphs[".notdef"] = TTGlyphPen(None).glyph()
    glyphs["space"] = TTGlyphPen(None).glyph()
    glyphs["dot"] = dot(radius)
    metrics[".notdef"] = (600, 0)
    metrics["space"] = (SPACE * PITCH, 0)
    metrics["dot"] = (0, -round(radius))
    for letter in LETTERS:
        lit, width = points(letter)
        spots = (widen(thicken(lit)) if wide else thicken(lit)) if thick else lit
        # Widening reaches half a point further right and down; keep the
        # letter centred where it was, and the space after it.
        shift = step / 2 if thick and wide else 0
        name = f"uni{ord(letter):04X}"
        glyph = Glyph()
        glyph.numberOfContours = -1
        glyph.components = []
        for row, col in sorted(spots):
            part = GlyphComponent()
            part.glyphName = "dot"
            part.flags = 0
            # Half a pitch of space either side of the letter.
            part.x = round(PITCH / 2 + col * step + step / 2 - shift)
            part.y = round(CAP_TOP - row * step - step / 2 + shift)
            glyph.components.append(part)
        names.append(name)
        glyphs[name] = glyph
        left = min(part.x for part in glyph.components) - round(radius)
        metrics[name] = (round((width + 1) * PITCH + shift * 2), left)
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
    for file, family, thick in [("dots.woff2", "Null Dots", False), ("dots-thick.woff2", "Null Dots Thick", True)]:
        out = build(HERE / file, family, thick)
        print(out.name, out.stat().st_size, "bytes")
