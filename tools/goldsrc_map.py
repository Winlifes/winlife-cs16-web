"""GoldSrc brush, entity and BSP build helpers for the original maps."""
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


def compile_maps(maps, description):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--tools", type=Path, required=True, help="Directory with sdHLCSG, sdHLBSP, sdHLVIS and sdHLRAD")
    parser.add_argument("--wad", type=Path, required=True, help="Your installed valve/halflife.wad")
    parser.add_argument("--output", type=Path, required=True, help="Directory for the compiled map files")
    args = parser.parse_args()
    tools, output = args.tools.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="winlife-maps-") as directory:
        work = Path(directory)
        shutil.copyfile(args.wad, work / "halflife.wad")
        for name, source in maps.items():
            (work / (name + ".map")).write_text(source)
            for stage in ("CSG", "BSP", "VIS", "RAD"):
                subprocess.run([str(tools / ("sdHL" + stage)), "-threads", "2", name], cwd=work, check=True)
            shutil.copyfile(work / (name + ".bsp"), output / (name + ".bsp"))
