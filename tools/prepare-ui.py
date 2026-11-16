#!/usr/bin/env python3
"""Convert the existing CS menu artwork to browser formats; no game ZIP changes."""
import os
from pathlib import Path
from PIL import Image

here = Path(__file__).resolve().parent.parent
game = Path(os.environ["CS16_GAME_DIR"]) / "cstrike"
output = here / "web/public/ui"
output.mkdir(parents=True, exist_ok=True)
background = Image.new("RGB", (800, 600))
for row in range(1, 4):
    for column, letter in enumerate("abcd"):
        tile = Image.open(game / "resource/background" / f"800_{row}_{letter}_loading.tga")
        background.paste(tile, (column * 256, (row - 1) * 256))
background.save(output / "cs-background.webp", quality=92)
logo = Image.open(game / "resource/logo_game.tga")
logo.crop(logo.getbbox()).save(output / "cs-logo.png")
for name in ["terror", "urban", "CS_logo"]:
    Image.open(game / "gfx/vgui" / (name + ".tga")).save(output / (name.lower() + ".png"))
