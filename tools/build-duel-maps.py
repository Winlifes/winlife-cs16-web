#!/usr/bin/env python3
"""Compile the two original Winlife arenas with locally supplied SDHLT and WAD."""
import argparse
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory


def brush(low, high, texture):
    faces = []
    for axis in range(3):
        for upper in (False, True):
            origin = list(low)
            origin[axis] = high[axis] if upper else low[axis]
            first, second = origin.copy(), origin.copy()
            first[(axis + 1) % 3] += 16
            second[(axis + 2) % 3] += 16
            # GoldSrc plane normals use (p0-p1) × (p2-p1).
            points = (origin, second, first) if upper else (origin, first, second)
            plane = " ".join("( " + " ".join(map(str, point)) + " )" for point in points)
            faces.append(f"{plane} {texture} 0 0 0 1 1")
    return "{\n" + "\n".join(faces) + "\n}"


def entity(classname, **fields):
    values = {"classname": classname, **fields}
    return "{\n" + "\n".join(f'"{key}" "{value}"' for key, value in values.items()) + "\n}"


def arena(half_x, half_y, spawn_y, wall, cover):
    xmin, ymin = -half_x, -half_y
    bounds = (
        ((xmin - 32, ymin - 32, -32), (half_x + 32, half_y + 32, 0), "crete3_flr04"),
        ((xmin - 32, ymin - 32, 192), (half_x + 32, half_y + 32, 224), "crete3_ceil01"),
        ((xmin - 32, ymin - 32, 0), (xmin, half_y + 32, 192), wall),
        ((half_x, ymin - 32, 0), (half_x + 32, half_y + 32, 192), wall),
        ((xmin, ymin - 32, 0), (half_x, ymin, 192), wall),
        ((xmin, half_y, 0), (half_x, half_y + 32, 192), wall),
    )
    world = entity("worldspawn", wad="halflife.wad")[:-1]
    world += "\n".join(brush(*box) for box in (*bounds, *cover)) + "\n}"
    spawn_x = half_x - 58
    parts = [world, entity("info_map_parameters", buying=3),
             entity("info_player_deathmatch", origin=f"{-spawn_x} {spawn_y} 38", angle=0),
             entity("info_player_start", origin=f"{spawn_x} {-spawn_y} 38", angle=180)]
    for x, y in [(-spawn_x, spawn_y), (spawn_x, -spawn_y), (0, half_y - 48), (0, ymin + 48)]:
        parts.append(entity("light", origin=f"{x} {y} 168", _light="241 230 207 260"))
    return "\n".join(parts) + "\n"


MAPS = {
    "wl_duel_yard": arena(344, 208, 0, "out_w1a", (
        ((-152, -42, 0), (-64, 42, 96), "crate01"),
        ((64, -42, 0), (152, 42, 96), "crate01"),
        ((-34, -174, 0), (34, -114, 72), "crate04"),
        ((-34, 114, 0), (34, 174, 72), "crate04"),
    )),
    "wl_duel_cross": arena(368, 224, 82, "crete3_wall02", (
        ((-206, -120, 0), (-114, 66, 132), "steel"),
        ((114, -66, 0), (206, 120, 132), "steel"),
        ((-35, -70, 0), (35, 70, 132), "crete2_wall02"),
    )),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tools", type=Path, required=True, help="Directory with sdHLCSG, sdHLBSP, sdHLVIS and sdHLRAD")
    parser.add_argument("--wad", type=Path, required=True, help="Your installed valve/halflife.wad")
    parser.add_argument("--output", type=Path, required=True, help="Directory for the compiled map files")
    args = parser.parse_args()
    tools, output = args.tools.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="winlife-duel-maps-") as directory:
        work = Path(directory)
        shutil.copyfile(args.wad, work / "halflife.wad")
        for name, source in MAPS.items():
            (work / (name + ".map")).write_text(source)
            for stage in ("CSG", "BSP", "VIS", "RAD"):
                subprocess.run([str(tools / ("sdHL" + stage)), "-threads", "2", name], cwd=work, check=True)
            shutil.copyfile(work / (name + ".bsp"), output / (name + ".bsp"))


if __name__ == "__main__":
    main()
