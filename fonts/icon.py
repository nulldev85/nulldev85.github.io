"""Draws the Null's Apps icon: the site's name in its dot font, lit on a board
of dots.

    pip install pillow fonttools
    python3 fonts/icon.py [more 1024-pixel copies...]

"Null's" over "Apps", in the font's own letters, on a grid of unlit dots that
carries on to the edges. The square is left unrounded, as iOS and the
signing apps round it themselves; only the browser tab's copy gets its
corners rounded here.

  assets/apple-touch-icon.png  180 pixels, for a phone's Home Screen
  assets/favicon.png            64 pixels, for the browser tab

Each path given is written at 1024 pixels: the app source's icon in
AppSource is `icons/source.png`.
"""

import importlib.util
import math
import pathlib
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("dots", HERE / "dots.py")
dots = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dots)

LINES = ["Null's", "Apps"]
LINE_GAP = 2                     # empty rows between the lines
BACKGROUND = (10, 10, 11)        # the site's --bg
LIT = (236, 236, 238)            # the site's --text
UNLIT = (255, 255, 255, 18)
GLOW = (90, 90, 92)
RADIUS = .36                     # of the distance from one dot to the next
SPAN = .7                        # of the square, taken up by the longer side of the lettering


def lettering(text):
    """The lit points of a line, (row, column), from its top left."""
    points, across = set(), 0
    for letter in text:
        lit, width = dots.points(letter)
        points |= {(r, c + across) for r, c in lit}
        across += width + 1
    top = min(r for r, _ in points)
    return {(r - top, c) for r, c in points}


def draw(size, supersample=4):
    lines = [lettering(text) for text in LINES]
    widths = [max(c for _, c in line) + 1 for line in lines]
    heights = [max(r for r, _ in line) + 1 for line in lines]
    wide = max(widths)
    tall = sum(heights) + LINE_GAP * (len(lines) - 1)
    side = size * supersample
    pitch = side * SPAN / max(wide, tall)
    left = (side - wide * pitch) / 2 + pitch / 2
    top = (side - tall * pitch) / 2 + pitch / 2
    centres, down = [], 0
    for line, width, height in zip(lines, widths, heights):
        shift = (wide - width) // 2   # whole columns, so each line stays on the grid
        centres += [(left + (c + shift) * pitch, top + (r + down) * pitch) for r, c in line]
        down += height + LINE_GAP
    radius = pitch * RADIUS

    image = Image.new("RGB", (side, side), BACKGROUND)

    # The unlit dots share the lettering's grid, out to the edges.
    board = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    pen = ImageDraw.Draw(board)
    y = top - math.floor(top / pitch) * pitch
    while y < side:
        x = left - math.floor(left / pitch) * pitch
        while x < side:
            pen.ellipse((x - radius, y - radius, x + radius, y + radius), fill=UNLIT)
            x += pitch
        y += pitch
    image.paste(board, (0, 0), board)

    # A soft glow behind the lit dots, as on a sign.
    glow = Image.new("RGB", (side, side), (0, 0, 0))
    pen = ImageDraw.Draw(glow)
    for x, y in centres:
        pen.ellipse((x - radius * 1.25, y - radius * 1.25, x + radius * 1.25, y + radius * 1.25), fill=GLOW)
    image = ImageChops.add(image, glow.filter(ImageFilter.GaussianBlur(pitch * 1.1)))

    pen = ImageDraw.Draw(image)
    for x, y in centres:
        pen.ellipse((x - radius, y - radius, x + radius, y + radius), fill=LIT)
    return image.resize((size, size), Image.LANCZOS)


def rounded(image, share=.225):
    side = image.width * 4
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, side - 1, side - 1), round(side * share), fill=255)
    out = image.convert("RGBA")
    out.putalpha(mask.resize(image.size, Image.LANCZOS))
    return out


if __name__ == "__main__":
    assets = HERE.parent / "assets"
    draw(180).save(assets / "apple-touch-icon.png", optimize=True)
    rounded(draw(64)).save(assets / "favicon.png", optimize=True)
    for path in sys.argv[1:]:
        draw(1024).save(path, optimize=True)
