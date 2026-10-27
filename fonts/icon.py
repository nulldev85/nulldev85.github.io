"""Draws the Null's Apps icon: the site font's N, lit on a board of dots.

    pip install pillow fonttools
    python3 fonts/icon.py [more 1024-pixel copies...]

The N is the font's own capital, five dots wide and seven tall, on a grid of
unlit dots that carries on to the edges. The square is left unrounded, as
iOS and the signing apps round it themselves; only the browser tab's copy
gets its corners rounded here.

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

BACKGROUND = (10, 10, 11)        # the site's --bg
LIT = (236, 236, 238)            # the site's --text
UNLIT = (255, 255, 255, 18)
GLOW = (90, 90, 92)
RADIUS = .36                     # of the distance from one dot to the next
HEIGHT = .62                     # of the square, taken up by the N


def draw(size, supersample=4):
    lit, width = dots.points("N")
    rows = [r for r, _ in lit]
    tall = max(rows) - min(rows) + 1
    side = size * supersample
    pitch = side * HEIGHT / tall
    left = (side - width * pitch) / 2 + pitch / 2
    top = (side - tall * pitch) / 2 + pitch / 2
    centres = [(left + c * pitch, top + (r - min(rows)) * pitch) for r, c in lit]
    radius = pitch * RADIUS

    image = Image.new("RGB", (side, side), BACKGROUND)

    # The unlit dots share the N's grid, out to the edges.
    board = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    pen = ImageDraw.Draw(board)
    first_x = left - math.floor(left / pitch) * pitch
    first_y = top - math.floor(top / pitch) * pitch
    y = first_y
    while y < side:
        x = first_x
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
