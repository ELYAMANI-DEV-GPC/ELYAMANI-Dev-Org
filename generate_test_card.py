#!/usr/bin/env python3
"""Generate a clearly-fake ID-like test card image for development/testing.

The output is obviously synthetic: no national emblem, no real card layout,
prominent SPECIMEN markings, and fictional data. Safe for KYC-flow testing,
UI mockups, and OCR pipeline development.

Usage:
    pip install Pillow
    python generate_test_card.py [output.png] [--count N]
"""

import argparse
import random
import string

from PIL import Image, ImageDraw, ImageFont

W, H = 1013, 638  # ID-1 card ratio at ~300 dpi

FIRST_NAMES = ["TEST", "SAMPLE", "DEMO", "MOCK", "FAKE"]
LAST_NAMES = ["USER", "PERSON", "DOE", "CARD", "DATA"]


def load_font(size):
    for name in ("Arial.ttf", "Helvetica.ttc", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def random_digits(n):
    return "".join(random.choices(string.digits, k=n))


def build_card():
    """Return (fields_dict) with clearly fictional data."""
    first = random.choice(FIRST_NAMES)
    last = random.choice(LAST_NAMES)
    return {
        "Name": f"{first} {last}",
        "DOB": "01.01.1990",
        "ID No": f"TEST{random_digits(6)}",
        "Issued": "01.01.2020",
        "Valid until": "01.01.2030",
    }


def draw_card(fields, out_path):
    img = Image.new("RGB", (W, H), (230, 235, 240))
    d = ImageDraw.Draw(img)

    font_lg = load_font(40)
    font_md = load_font(30)
    font_sm = load_font(24)

    # Header band
    d.rectangle([0, 0, W, 80], fill=(90, 90, 160))
    d.text((30, 20), "SPECIMEN - TEST DATA ONLY", fill="white", font=font_lg)

    # Photo placeholder
    d.rectangle([40, 120, 300, 480], outline=(120, 120, 120), width=2)
    d.text((120, 285), "PHOTO", fill=(120, 120, 120), font=font_md)

    # Fields
    y = 130
    for label, value in fields.items():
        d.text((340, y), f"{label}:", fill=(100, 100, 100), font=font_sm)
        d.text((340, y + 30), value, fill=(30, 30, 30), font=font_md)
        y += 85

    # Footer band
    d.rectangle([0, H - 60, W, H], fill=(90, 90, 160))
    d.text((30, H - 45), "NOT A REAL DOCUMENT - FOR SOFTWARE TESTING",
           fill="white", font=font_sm)

    # Diagonal red SPECIMEN stripes so it can't be mistaken for real
    d.line([0, 0, W, H], fill=(255, 0, 0), width=5)
    d.line([W, 0, 0, H], fill=(255, 0, 0), width=5)

    img.save(out_path)
    print(f"Saved: {out_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", default="test_card_specimen.png",
                        help="Output file (default: test_card_specimen.png)")
    parser.add_argument("--count", type=int, default=1,
                        help="Generate N cards (output_1.png, output_2.png, ...)")
    args = parser.parse_args()

    for i in range(args.count):
        fields = build_card()
        if args.count > 1:
            base = args.output.rsplit(".", 1)
            out = f"{base[0]}_{i + 1}.{base[1] if len(base) > 1 else 'png'}"
        else:
            out = args.output
        draw_card(fields, out)


if __name__ == "__main__":
    main()
