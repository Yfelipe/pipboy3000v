#!/usr/bin/env python3
"""Make Endurance's three SD card pictures (sd/ENDURANC/*.IMG) from the files in
assets/official/interstellar. Raw 2 bit images, 4 pixels a byte, rows top to bottom: the format
the page buffer uses, so the app copies them straight in.

Needs Pillow and numpy, pdfimages (poppler) for the paper's figures and ffmpeg to read the
watch picture (it is AVIF, whatever its name says). Run from this folder: ./make-images.py
"""
import os, subprocess, tempfile
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
import numpy as np

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'official', 'interstellar')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sd', 'ENDURANC')
os.makedirs(OUT, exist_ok=True)
PAL = Image.new('P', (1, 1))
PAL.putpalette([0, 0, 0, 85, 85, 85, 170, 170, 170, 255, 255, 255] + [0, 0, 0] * 252)


def write(name, levels):
    """levels: h x w array of 0..3, w a multiple of 4."""
    h, w = levels.shape
    r = levels.astype(np.uint8).reshape(h, w // 4, 4)
    packed = (r[..., 0] << 6 | r[..., 1] << 4 | r[..., 2] << 2 | r[..., 3]).astype(np.uint8)
    open(os.path.join(OUT, name), 'wb').write(packed.tobytes())
    print(name, w, 'x', h, packed.size, 'bytes')


def photo(im, name, w, h, gamma=1.0, contrast=1.0, floor=0):
    """A photograph: scaled, then dithered down to the four shades. floor: this level and below is black."""
    im = im.convert('L').resize((w, h), Image.LANCZOS)
    if floor: im = im.point(lambda v: max(0, v - floor) * 255 // (255 - floor))
    if contrast != 1: im = ImageEnhance.Contrast(im).enhance(contrast)
    if gamma != 1: im = im.point(lambda v: int(255 * (v / 255) ** gamma))
    write(name, np.asarray(im.convert('RGB').quantize(palette=PAL, dither=Image.FLOYDSTEINBERG)))


with tempfile.TemporaryDirectory() as tmp:
    # TITLE.IMG: the wordmark from the poster. Its first half is dark letters on a bright sky and
    # its second half white letters on a dark smear, so each is picked out against what is behind it.
    c = Image.open(os.path.join(SRC, 'interstellar-poster-ver6.jpg')).convert('L').crop((60, 485, 1640, 645))
    a = np.asarray(c).astype(float) / 255
    bg = np.asarray(c.filter(ImageFilter.GaussianBlur(30))).astype(float) / 255
    dark, light = np.clip((bg - a - 0.12) * 3.5, 0, 1), np.clip((a - 0.62) / 0.3, 0, 1)
    t = np.clip((bg - 0.45) / 0.2, 0, 1)
    im = Image.fromarray(((dark * t + light * (1 - t)) * 255).astype(np.uint8)).resize((400, 40), Image.LANCZOS)
    q = np.clip(np.round(np.asarray(im) / 85.0), 0, 3).astype(np.uint8)
    q[:, 392:] = 0  # the poster's edge
    write('TITLE.IMG', q)

    # GARGANTU.IMG: the black hole with its disc, from the paper (the 14th picture in the PDF)
    subprocess.run(['pdfimages', '-j', os.path.join(SRC, 'gargantua-paper-arxiv-1502.03808.pdf'), os.path.join(tmp, 'fig')], check=True)
    photo(Image.open(os.path.join(tmp, 'fig-013.jpg')), 'GARGANTU.IMG', 400, 184, gamma=0.7, floor=20)

    # MURPH.IMG: the black-dial watch, the middle one of the three in Hamilton's picture
    png = os.path.join(tmp, 'watch.png')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(SRC, 'hamilton-murph-watches.png'), png], check=True)
    w = Image.open(png).convert('RGB').crop((342, 130, 638, 470))
    # its white background becomes black: filled in from the edges, so the white on the dial stays
    for x in range(0, w.width, 4):
        for y in (0, w.height - 1):
            if min(w.getpixel((x, y))) > 235: ImageDraw.floodfill(w, (x, y), (0, 0, 0), thresh=40)
    for y in range(0, w.height, 4):
        for x in (0, w.width - 1):
            if min(w.getpixel((x, y))) > 235: ImageDraw.floodfill(w, (x, y), (0, 0, 0), thresh=40)
    photo(w, 'MURPH.IMG', 184, 210, contrast=1.15)
