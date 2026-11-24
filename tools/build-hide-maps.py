#!/usr/bin/env python3
"""Compile the original Winlife prop hunt maps with locally supplied SDHLT and WAD."""
from goldsrc_map import brush, compile_maps, entity


PROPS = ("pallet_with_bags", "bush", "big_rock", "filecabinet", "uplant2")


def scene(half_x, half_y, floor, walls, cover, clusters, lights, outdoors=False):
    ceiling = 224 if outdoors else 176
    floor_low = (-half_x - 32, -half_y - 32, -32)
    boundary = (
        (floor_low, (half_x + 32, half_y + 32, 0), floor),
        ((floor_low[0], floor_low[1], ceiling), (half_x + 32, half_y + 32, ceiling + 32),
         "sky" if outdoors else "crete3_ceil01"),
        ((floor_low[0], floor_low[1], 0), (-half_x, half_y + 32, ceiling), walls),
        ((half_x, floor_low[1], 0), (half_x + 32, half_y + 32, ceiling), walls),
        ((-half_x, floor_low[1], 0), (half_x, -half_y, ceiling), walls),
        ((-half_x, half_y, 0), (half_x, half_y + 32, ceiling), walls),
    )
    world = entity("worldspawn", wad="halflife.wad", skyname="desert")[:-1]
    world += "\n".join(brush(*box) for box in (*boundary, *cover)) + "\n}"
    parts = [world, entity("info_map_parameters", buying=3)]
    for team, side, facing in (("info_player_deathmatch", -1, 0), ("info_player_start", 1, 180)):
        for setback in (72, 152):
            for row in (-2, -1, 0, 1, 2):
                parts.append(entity(team, origin=f"{side * (half_x - setback)} {row * (half_y - 92) // 2} 38",
                                    angle=facing))
    for cx, cy, objects in clusters:
        for i, model in enumerate(objects):
            dx, dy = ((0, 0), (56, 10), (-54, -12), (12, 60))[i]
            parts.append(entity("info_target", targetname="winlife_hide_prop", model=f"models/{PROPS[model]}.mdl",
                                origin=f"{cx + dx} {cy + dy} 0", angles=f"0 {(i * 90 + model * 30) % 360} 0"))
    if outdoors:
        parts.append(entity("light_environment", origin="0 0 192", angle=120, pitch=-60,
                            _light="255 239 203 330"))
    for x, y, color in lights:
        parts.append(entity("light", origin=f"{x} {y} {ceiling - 18}", _light=color))
    return "\n".join(parts) + "\n"


DEPOT = scene(
    768, 560, "crete3_flr04", "crete3_wall02",
    (
        ((-354, -410, 0), (-246, -112, 114), "crate04"),
        ((-354, 102, 0), (-246, 402, 114), "crate04"),
        ((246, -410, 0), (354, -112, 114), "crate01"),
        ((246, 102, 0), (354, 402, 114), "crate01"),
        ((-68, -282, 0), (68, -164, 82), "out_boxa"),
        ((-68, 164, 0), (68, 282, 82), "out_boxa"),
        ((-222, -560, 0), (-194, -355, 144), "steel"),
        ((194, 355, 0), (222, 560, 144), "steel"),
        ((-620, -120, 0), (-536, -62, 70), "crate02"),
        ((536, 62, 0), (620, 120, 70), "crate02"),
    ),
    (
        (-488, -372, (0, 3, 3)), (-488, 358, (3, 4, 0)), (484, -346, (3, 0, 0)),
        (484, 365, (0, 3, 4)), (-150, -399, (0, 3, 2)), (100, -400, (0, 2, 4)),
        (-150, 412, (3, 0, 1)), (110, 435, (0, 1, 2)), (-154, -50, (1, 3)),
        (144, 47, (4, 3)), (-493, 177, (4, 2, 1)), (492, -175, (1, 4, 2)),
        (-43, -486, (0, 2, 1)), (44, 490, (0, 4, 1)), (124, -250, (0, 2)),
        (-119, 262, (3, 1)), (-545, -510, (2, 1, 4)), (545, 510, (4, 2, 1)),
    ),
    tuple((x, y, color) for x, color in (
        (-553, "232 205 169 340"), (-162, "215 227 249 290"), (157, "234 227 194 305"), (550, "232 205 169 340"),
    ) for y in (-421, 0, 421)),
)

NURSERY = scene(
    816, 608, "out_grnd1", "out_w1a",
    (
        ((-402, -360, 0), (-365, 120, 100), "out_w1b"),
        ((-402, 120, 0), (-122, 157, 100), "out_w1b"),
        ((365, -120, 0), (402, 360, 100), "out_w1b"),
        ((122, -157, 0), (402, -120, 100), "out_w1b"),
        ((-236, -608, 0), (-200, -352, 100), "out_w1a"),
        ((200, 352, 0), (236, 608, 100), "out_w1a"),
        ((-80, -53, 0), (80, 53, 78), "out_box2"),
        ((-172, 334, 0), (-44, 419, 54), "crate04"),
        ((44, -419, 0), (172, -334, 54), "crate04"),
        ((-627, 106, 0), (-538, 172, 78), "crate04"),
        ((538, -172, 0), (627, -106, 78), "crate04"),
    ),
    (
        (-466, -402, (1, 2, 4)), (466, 402, (1, 4, 2)), (-463, -132, (2, 4, 1)),
        (460, 151, (2, 1, 4)), (-504, 359, (1, 0, 2)), (505, -358, (2, 1, 0)),
        (-260, -259, (0, 1, 2)), (251, 250, (2, 4, 0)), (-254, -70, (4, 1, 4)),
        (260, 70, (4, 4, 1)), (-250, 243, (1, 3, 2)), (252, -246, (1, 2, 3)),
        (-66, 505, (0, 3, 4)), (67, -503, (0, 4, 3)), (-124, -140, (2, 1)),
        (132, 140, (1, 2)), (-475, -541, (0, 3, 3)), (475, 538, (3, 0, 3)),
        (-704, -571, (1, 4, 2)), (700, 571, (4, 2, 1)),
    ),
    ((-615, 220, "252 233 197 160"), (616, -220, "252 233 197 160")),
    outdoors=True,
)


if __name__ == "__main__":
    compile_maps({"wl_hide_depot": DEPOT, "wl_hide_nursery": NURSERY}, __doc__)
