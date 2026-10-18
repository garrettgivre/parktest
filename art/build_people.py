"""Render the park's people as animated sprite sheets (Sims-1-style pre-renders).

Usage (from repo root):  npm run people

Each character is a low-poly figure built from primitives, rendered from the
game's camera in 4 facings x 4 walk frames into one sprite sheet:
rows = facing (0 SE/+i, 1 NE/-j, 2 NW/-i, 3 SW/+j), columns = walk frame
(frame 0 is the standing pose). Output: public/sprites/people/<id>.webp plus
manifest.json (frame size and the foot anchor).
"""
import bpy
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from to_webp import convert as to_webp  # noqa: E402
from mathutils import Euler, Vector  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "public", "sprites", "people")
TILE_W = 128
PPU = (TILE_W / 2) / math.cos(math.radians(45))
CAM_ROT = Euler((math.radians(60), 0, math.radians(45)), "XYZ")
FW, FH, AY = 112, 176, 150  # frame size and where the feet land (y)
FACINGS = [0, 90, 180, 270]  # degrees about Z: +x (SE), +y (NE), -x (NW), -y (SW)
SWING = [0, 28, 0, -28]  # leg swing per walk frame


def lin(c):
    return (*(v ** 2.2 for v in c), 1)


_m = {}


def mat(color, rough=0.7, emit=0.0):
    key = (tuple(round(v, 3) for v in color), rough, emit)
    if key in _m:
        return _m[key]
    m = bpy.data.materials.new("m")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Specular IOR Level"].default_value = 0.25
    if emit:
        b.inputs["Emission Color"].default_value = lin(color)
        b.inputs["Emission Strength"].default_value = emit
    _m[key] = m
    return m


def setup():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.cycles.filter_width = 0.8
    sc.render.film_transparent = True
    sc.render.resolution_x, sc.render.resolution_y = FW, FH
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
        except TypeError:
            continue
        devs = [d for d in prefs.devices if d.type == kind]
        if devs:
            for d in devs:
                d.use = True
            sc.cycles.device = "GPU"
            break
    world = bpy.data.worlds.new("World")
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.75, 0.82, 0.95, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    sd = bpy.data.lights.new("Sun", "SUN")
    sd.energy = 4.5
    sd.angle = math.radians(14)
    sun = bpy.data.objects.new("Sun", sd)
    sc.collection.objects.link(sun)
    to_light = Vector((-0.35, -1.0, 2.4)).normalized()
    sun.rotation_euler = (-to_light).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.mesh.primitive_plane_add(size=20)
    bpy.context.active_object.is_shadow_catcher = True
    bpy.context.active_object.name = "Ground"
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.ortho_scale = max(FW, FH) / PPU
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    cam.rotation_euler = CAM_ROT
    m = CAM_ROT.to_matrix()
    cam.location = (m @ Vector((0, 0, 1))) * 40 + (m @ Vector((0, 1, 0))) * ((AY - FH / 2) / PPU)
    sc.camera = cam


def clear_figure():
    for o in list(bpy.data.objects):
        if o.name not in ("Sun", "Ground", "cam"):
            bpy.data.objects.remove(o, do_unlink=True)


def part(kind, size, loc, material, parent=None, rot=(0, 0, 0)):
    if kind == "box":
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
        o = bpy.context.active_object
        o.scale = size
        bev = o.modifiers.new("b", "BEVEL")
        bev.width = min(size) * 0.25
        bev.segments = 2
    elif kind == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=size[0], depth=size[1], location=loc, rotation=rot)
        o = bpy.context.active_object
    else:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=size[0], segments=16, ring_count=8, location=loc)
        o = bpy.context.active_object
        if len(size) > 1:
            o.scale = size[1]
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    if parent:
        bpy.context.view_layer.update()
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    return o


def pivot(name, loc, parent):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    e.parent = parent
    bpy.context.view_layer.update()
    return e


def figure(p):
    """Build a person facing +x around a root empty. Returns (root, legs, arms)."""
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)
    skin, shirt, pants, hair, shoes = (mat(p[k]) for k in ("skin", "shirt", "pants", "hair", "shoes"))
    legs, arms = [], []
    for side in (-1, 1):
        hip = pivot("hip", (0, side * 0.075, 0.6), root)
        part("cyl", (0.065, 0.5), (0, side * 0.075, 0.35), pants, hip)
        part("box", (0.17, 0.08, 0.06), (0.03, side * 0.075, 0.04), shoes, hip)
        legs.append(hip)
        sh = pivot("sh", (0, side * 0.2, 0.98), root)
        part("cyl", (0.045, 0.4), (0, side * 0.2, 0.78), shirt if p.get("sleeves", True) else skin, sh)
        part("ball", (0.05,), (0, side * 0.2, 0.57), skin, sh)
        arms.append(sh)
    part("box", (0.22, 0.34, 0.44), (0, 0, 0.8), shirt, root)
    if p.get("vest"):
        part("box", (0.235, 0.355, 0.36), (0, 0, 0.84), mat(p["vest"]), root)
        part("box", (0.02, 0.06, 0.04), (0.125, -0.08, 0.92), mat((0.95, 0.95, 0.95)), root)  # name badge
    if p.get("tie"):
        part("box", (0.02, 0.05, 0.26), (0.115, 0, 0.86), mat(p["tie"]), root)
    part("cyl", (0.05, 0.08), (0, 0, 1.05), skin, root)
    part("ball", (0.13, (0.95, 0.92, 1.05)), (0, 0, 1.18), skin, root)
    part("ball", (0.135, (0.98, 0.98, 0.7)), (-0.02, 0, 1.24), hair, root)
    for side in (-1, 1):  # eyes
        part("ball", (0.016,), (0.115, side * 0.045, 1.2), mat((0.05, 0.05, 0.05)), root)
    if p.get("ponytail"):
        part("ball", (0.07, (1, 0.8, 1.3)), (-0.15, 0, 1.14), hair, root)
    if p.get("cap"):
        part("ball", (0.14, (1, 1, 0.45)), (-0.01, 0, 1.28), mat(p["cap"]), root)
        part("box", (0.14, 0.2, 0.025), (0.12, 0, 1.28), mat(p["cap"]), root)
    if p.get("glasses"):
        part("box", (0.02, 0.17, 0.035), (0.125, 0, 1.2), mat((0.1, 0.1, 0.1)), root)
    if p.get("clipboard"):
        part("box", (0.2, 0.02, 0.26), (0.12, -0.27, 0.7), mat((0.75, 0.6, 0.4)), arms[0])
    if p.get("bag"):
        part("box", (0.18, 0.08, 0.22), (-0.02, 0.27, 0.58), mat(p["bag"]), root)
    return root, legs, arms


PEOPLE = {
    "deb": dict(skin=(0.86, 0.66, 0.52), shirt=(0.9, 0.26, 0.58), pants=(0.2, 0.25, 0.45), hair=(0.55, 0.32, 0.15), shoes=(0.95, 0.95, 0.95), ponytail=True, bag=(0.95, 0.85, 0.3)),
    "gary": dict(skin=(0.8, 0.6, 0.46), shirt=(0.95, 0.6, 0.12), pants=(0.42, 0.38, 0.3), hair=(0.3, 0.22, 0.15), shoes=(0.35, 0.25, 0.18), cap=(0.15, 0.3, 0.65)),
    "me": dict(skin=(0.72, 0.52, 0.38), shirt=(0.95, 0.95, 0.92), pants=(0.15, 0.15, 0.18), hair=(0.15, 0.1, 0.08), shoes=(0.1, 0.1, 0.1), vest=(0.18, 0.7, 0.35), cap=(0.12, 0.38, 0.2)),
    "brad": dict(skin=(0.9, 0.72, 0.6), shirt=(0.88, 0.9, 0.95), pants=(0.25, 0.27, 0.32), hair=(0.75, 0.6, 0.35), shoes=(0.2, 0.12, 0.08), tie=(0.75, 0.12, 0.12), glasses=True, clipboard=True),
}
CROWD = [
    ((0.6, 0.42, 0.3), (0.2, 0.55, 0.85), (0.25, 0.25, 0.3), (0.12, 0.1, 0.08)),
    ((0.9, 0.75, 0.62), (0.85, 0.2, 0.2), (0.75, 0.7, 0.6), (0.85, 0.7, 0.3)),
    ((0.45, 0.3, 0.2), (0.95, 0.85, 0.2), (0.2, 0.3, 0.5), (0.08, 0.06, 0.05)),
    ((0.8, 0.6, 0.48), (0.3, 0.7, 0.4), (0.3, 0.25, 0.2), (0.4, 0.25, 0.15)),
    ((0.65, 0.45, 0.32), (0.6, 0.35, 0.75), (0.15, 0.15, 0.2), (0.1, 0.08, 0.06)),
    ((0.92, 0.78, 0.66), (0.95, 0.95, 0.95), (0.3, 0.4, 0.6), (0.7, 0.45, 0.2)),
]
for k, (skin, shirt, pants, hair) in enumerate(CROWD):
    PEOPLE[f"crowd{k}"] = dict(skin=skin, shirt=shirt, pants=pants, hair=hair, shoes=(0.9, 0.9, 0.9), cap=(0.8, 0.2, 0.2) if k == 3 else None, ponytail=k % 2 == 1)


def render_sheet(pid, p):
    import numpy as np
    clear_figure()
    root, legs, arms = figure(p)
    sheet = np.zeros((FH * 4, FW * 4, 4), dtype=np.float32)
    tmp = os.path.join(OUT, f"_{pid}.png")
    for row, face in enumerate(FACINGS):
        root.rotation_euler = (0, 0, math.radians(face))
        for col, sw in enumerate(SWING):
            for k, leg in enumerate(legs):
                leg.rotation_euler = (0, math.radians(sw if k == 0 else -sw), 0)
            for k, arm in enumerate(arms):
                arm.rotation_euler = (0, math.radians(-sw * 0.8 if k == 0 else sw * 0.8), 0)
            root.location = (0, 0, 0.015 if sw == 0 and col > 0 else 0)
            bpy.context.scene.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(tmp)
            px = np.empty(FW * FH * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            bpy.data.images.remove(img)
            # Blender rows are bottom-up; the sheet is built bottom-up too, so row 0 sits at the top.
            r0 = (3 - row) * FH
            sheet[r0:r0 + FH, col * FW:(col + 1) * FW] = px.reshape(FH, FW, 4)
    out = bpy.data.images.new(pid, FW * 4, FH * 4, alpha=True)
    out.pixels.foreach_set(sheet.ravel())
    path = os.path.join(OUT, pid + ".png")
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    os.remove(tmp)
    to_webp(path)
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.image_settings.color_mode = "RGBA"
    print("sheet", pid)


def main():
    os.makedirs(OUT, exist_ok=True)
    setup()
    only = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for pid, p in PEOPLE.items():
        if not only or pid in only:
            render_sheet(pid, p)
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump({"frameW": FW, "frameH": FH, "ax": FW / 2, "ay": AY, "people": list(PEOPLE)}, f, indent=1)


main()
