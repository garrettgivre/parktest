"""Render Sims-1-style isometric sprites with Blender.

Usage (from repo root):
  blender --background --factory-startup --python art/render_sprites.py -- public/sprites

Every prop is built from primitives around the world origin, rendered with a
fixed 2:1 dimetric orthographic camera onto a transparent background (with a
shadow catcher so the drop shadow is baked into the sprite), and written to
<out>/<name>.png. <out>/manifest.json records each sprite's anchor: the pixel
where the prop's world origin (its footprint centre on the ground) lands.

World <-> game axes: game tile (i, j) = Blender (x = i, y = -j).
Screen position of game point (i, j) = ((i - j) * TILE_W/2, (i + j) * TILE_W/4).
"""
import bpy
import json
import math
import os
import sys
from mathutils import Euler, Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "sprites"
OUT = os.path.abspath(OUT)
TILE_W = 128
# Pixels per world unit measured in the camera plane. One world unit along X
# projects to cos(45deg) units horizontally, and that must equal TILE_W / 2.
PPU = (TILE_W / 2) / math.cos(math.radians(45))
CAM_ROT = Euler((math.radians(60), 0, math.radians(45)), "XYZ")

manifest = {"tileW": TILE_W, "sprites": {}}


# ---------------------------------------------------------------- scene setup

def setup_scene():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    sc.cycles.filter_width = 0.8  # crisp edges, like the old pre-renders
    sc.render.film_transparent = True
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"  # punchy, un-filmic colours
    sc.view_settings.look = "None"

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
            print("Cycles using", kind)
            break

    world = bpy.data.worlds.new("World")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.75, 0.82, 0.95, 1)
    bg.inputs["Strength"].default_value = 0.45

    sun_data = bpy.data.lights.new("Sun", "SUN")
    sun_data.energy = 4.5
    sun_data.angle = math.radians(12)  # soft-ish shadow edges
    sun_data.color = (1.0, 0.96, 0.88)
    sun = bpy.data.objects.new("Sun", sun_data)
    sc.collection.objects.link(sun)
    # Light from the viewer's upper-left so both visible faces read clearly.
    to_light = Vector((-0.35, -1.0, 2.4)).normalized()
    sun.rotation_euler = (-to_light).to_track_quat("-Z", "Y").to_euler()


def clear_props():
    keep = {"Sun"}
    for o in list(bpy.data.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o, do_unlink=True)


def make_camera(w, h, anchor_y, target=Vector((0, 0, 0))):
    sc = bpy.context.scene
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.ortho_scale = max(w, h) / PPU
    cd.clip_end = 200
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    cam.rotation_euler = CAM_ROT
    m = CAM_ROT.to_matrix()
    back, up = m @ Vector((0, 0, 1)), m @ Vector((0, 1, 0))
    # Moving the camera up by d makes the target appear d below image centre.
    cam.location = target + back * 60 + up * ((anchor_y - h / 2) / PPU)
    sc.camera = cam


def shadow_catcher():
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    bpy.context.active_object.is_shadow_catcher = True


def autocrop(path, ax, ay, pad=2):
    """Trim transparent margins (props render on a generous canvas so shadows
    never clip) and return the new size and anchor."""
    import numpy as np
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)  # rows run bottom-to-top
    ys, xs = np.nonzero(px[:, :, 3] > 0.03)
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, w)
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, h)
    crop = px[y0:y1, x0:x1].copy()
    out = bpy.data.images.new("crop", x1 - x0, y1 - y0, alpha=True)
    out.pixels.foreach_set(crop.ravel())
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(img)
    bpy.data.images.remove(out)
    top = h - y1  # crop's top edge, measured from the image top
    return int(x1 - x0), int(y1 - y0), float(ax - x0), float(ay - top)


def render(name,w, h, anchor_y, catcher=True, target=Vector((0, 0, 0))):
    if catcher:
        shadow_catcher()
    make_camera(w, h, anchor_y, target)
    path = os.path.join(OUT, name + ".png")
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    ax, ay = w / 2, anchor_y
    if catcher:
        w, h, ax, ay = autocrop(path, ax, ay)
    manifest["sprites"][name] = {"w": w, "h": h, "ax": ax, "ay": ay}
    print("rendered", path)


# ------------------------------------------------------------------ materials

_mats = {}


def lin(c):
    """Palette colours are written as screen (sRGB) values; Blender wants linear."""
    return (*(v ** 2.2 for v in c), 1)


def _link(nt, a, b):
    nt.links.new(a, b)


def mat(name, color, rough=0.75, kind=None, color2=None, scale=4.0, metal=0.0,
        emit=0.0, grime=0.3):
    """Matte material with optional procedural pattern and a little grime."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Specular IOR Level"].default_value = 0.25
    coord = nt.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    c1 = lin(color)
    c2 = lin(color2 or color)

    if kind == "brick":
        t = nt.nodes.new("ShaderNodeTexBrick")
        _link(nt, coord, t.inputs["Vector"])
        t.inputs["Color1"].default_value = c1
        t.inputs["Color2"].default_value = c2
        t.inputs["Mortar"].default_value = lin((0.42, 0.40, 0.37))
        t.inputs["Scale"].default_value = scale
        t.inputs["Mortar Size"].default_value = 0.04
        t.inputs["Brick Width"].default_value = 0.5
        t.inputs["Row Height"].default_value = 0.25
        col = t.outputs["Color"]
    elif kind in ("stripes", "wood"):
        t = nt.nodes.new("ShaderNodeTexWave")
        _link(nt, coord, t.inputs["Vector"])
        t.wave_type = "BANDS"
        t.inputs["Scale"].default_value = scale
        t.inputs["Distortion"].default_value = 0.0 if kind == "stripes" else 6.0
        if kind == "wood":
            t.inputs["Detail"].default_value = 3.0
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        if kind == "stripes":
            ramp.color_ramp.interpolation = "CONSTANT"
        ramp.color_ramp.elements[0].color = c1
        ramp.color_ramp.elements[1].position = 0.5
        ramp.color_ramp.elements[1].color = c2
        _link(nt, t.outputs["Fac"], ramp.inputs["Fac"])
        col = ramp.outputs["Color"]
    elif kind == "speckle":
        t = nt.nodes.new("ShaderNodeTexNoise")
        _link(nt, coord, t.inputs["Vector"])
        t.inputs["Scale"].default_value = scale
        t.inputs["Detail"].default_value = 8.0
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.35
        ramp.color_ramp.elements[0].color = c1
        ramp.color_ramp.elements[1].position = 0.65
        ramp.color_ramp.elements[1].color = c2
        _link(nt, t.outputs["Fac"], ramp.inputs["Fac"])
        col = ramp.outputs["Color"]
    else:
        rgb = nt.nodes.new("ShaderNodeRGB")
        rgb.outputs[0].default_value = c1
        col = rgb.outputs[0]

    if grime:
        n = nt.nodes.new("ShaderNodeTexNoise")
        _link(nt, coord, n.inputs["Vector"])
        n.inputs["Scale"].default_value = 9.0
        n.inputs["Detail"].default_value = 6.0
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = grime
        _link(nt, col, mix.inputs[6])
        _link(nt, n.outputs["Color"], mix.inputs[7])
        col = mix.outputs[2]

    _link(nt, col, bsdf.inputs["Base Color"])
    if emit:
        bsdf.inputs["Emission Color"].default_value = c1
        bsdf.inputs["Emission Strength"].default_value = emit
    _mats[name] = m
    return m


# ------------------------------------------------------------------ geometry

def _finish(o, material, bevel):
    o.data.materials.append(material)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    bpy.ops.object.shade_smooth() if bevel else None
    return o


def box(size, loc, material, bevel=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    return _finish(o, material, bevel)


def cyl(r, depth, loc, material, verts=24, rot=(0, 0, 0), smooth=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth,
                                        location=loc, rotation=rot)
    o = bpy.context.active_object
    o.data.materials.append(material)
    if smooth:
        bpy.ops.object.shade_smooth_by_angle()
    return o


def cone(r1, r2, depth, loc, material, verts=24, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2,
                                    depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.data.materials.append(material)
    return o


def ball(r, loc, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=24,
                                         ring_count=12)
    o = bpy.context.active_object
    o.scale = scale
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return o


def text(body, loc, size, material, face="-y", extrude=0.01):
    """Text on a vertical face. '-y' = the left visible face, '+x' = the right."""
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    o = bpy.data.objects.new("txt", cu)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    rz = 0 if face == "-y" else math.radians(90)
    o.rotation_euler = (math.radians(90), 0, rz)
    cu.materials.append(material)
    return o


# ------------------------------------------------------------------- palette

WHITE = mat("white", (0.88, 0.86, 0.80))
CREAM = mat("cream", (0.93, 0.85, 0.66))
RED = mat("red", (0.72, 0.08, 0.07), rough=0.5)
DARK = mat("dark", (0.07, 0.07, 0.08), rough=0.4)
STEEL = mat("steel", (0.55, 0.57, 0.6), rough=0.35, metal=0.8)
GREEN_PAINT = mat("green_paint", (0.08, 0.30, 0.18), rough=0.5)
GLASS = mat("glass", (0.20, 0.35, 0.42), rough=0.1, grime=0.3)
AWNING = mat("awning", (0.75, 0.07, 0.08), kind="stripes", color2=(0.92, 0.90, 0.84), scale=3.0, grime=0.1)
WOOD = mat("wood", (0.42, 0.24, 0.11), kind="wood", color2=(0.30, 0.16, 0.07), scale=3.0)
HAY = mat("hay", (0.80, 0.66, 0.30), kind="speckle", color2=(0.62, 0.48, 0.18), scale=30)
PUMPKIN = mat("pumpkin", (0.95, 0.42, 0.04), rough=0.5)
STEM = mat("stem", (0.25, 0.30, 0.10))
BULB_RED = mat("bulb_red", (1.0, 0.05, 0.03), emit=6.0, grime=0)
BULB_WARM = mat("bulb_warm", (1.0, 0.85, 0.5), emit=4.0, grime=0)
TRASH_GREEN = mat("trash_green", (0.12, 0.36, 0.20), rough=0.6, grime=0.3)
TRASH_BITS = mat("trash_bits", (0.90, 0.88, 0.84), grime=0.35)
CUP_RED = mat("cup_red", (0.85, 0.10, 0.10))
YELLOW = mat("yellow", (0.98, 0.78, 0.10), rough=0.5)
ORANGE = mat("orange", (0.95, 0.45, 0.05))
BLACK_TXT = mat("black_txt", (0.04, 0.04, 0.04), grime=0)
WHITE_TXT = mat("white_txt", (0.97, 0.97, 0.95), grime=0)
SKIN = mat("skin", (0.85, 0.62, 0.48), rough=0.6, grime=0)
HAIR = mat("hair", (0.28, 0.16, 0.08), grime=0)
SHIRT = mat("shirt", (0.20, 0.55, 0.75), rough=0.8, grime=0.05)
JEANS = mat("jeans", (0.16, 0.20, 0.38), rough=0.9, grime=0.1)
SHOES = mat("shoes", (0.9, 0.9, 0.9), grime=0.1)
GRASS = mat("grass", (0.24, 0.48, 0.14), kind="speckle", color2=(0.36, 0.60, 0.18), scale=18)
PAVERS = mat("pavers", (0.66, 0.58, 0.52), kind="brick", color2=(0.56, 0.47, 0.42), scale=2.0, grime=0.25)
ASPHALT = mat("asphalt", (0.22, 0.22, 0.23), kind="speckle", color2=(0.32, 0.31, 0.30), scale=40, grime=0.25)
DIRT = mat("dirt", (0.40, 0.27, 0.15), kind="speckle", color2=(0.30, 0.20, 0.10), scale=25)


# ------------------------------------------------------------------- props

def ticket_booth():
    box((1.3, 1.3, 1.0), (0, 0, 0.5), RED, bevel=0.02)
    box((1.32, 1.32, 0.08), (0, 0, 1.02), WHITE)
    box((1.3, 1.3, 0.9), (0, 0, 1.5), CREAM, bevel=0.02)
    box((0.85, 0.04, 0.6), (0, -0.66, 1.45), GLASS)          # window, left face
    box((0.95, 0.12, 0.05), (0, -0.70, 1.12), WOOD)          # counter
    box((0.04, 0.85, 0.6), (0.66, 0, 1.45), GLASS)           # window, right face
    box((1.0, 0.06, 0.32), (0, -0.68, 2.15), WHITE, bevel=0.01)  # sign board
    text("TICKETS", (0, -0.715, 2.15), 0.2, RED)
    box((0.06, 1.0, 0.32), (0.68, 0, 2.15), WHITE, bevel=0.01)
    text("CLOSED?", (0.715, 0, 2.15), 0.17, BLACK_TXT, face="+x")
    cone(1.15, 0, 0.7, (0, 0, 2.65), AWNING, verts=4, rot=(0, 0, math.radians(45)))
    ball(0.07, (0, 0, 3.02), YELLOW)


def turnstile():
    # Scanner pedestal with a sad red light.
    box((0.22, 0.22, 1.0), (-0.3, 0, 0.5), DARK, bevel=0.02)
    box((0.3, 0.3, 0.12), (-0.3, 0, 1.06), STEEL, bevel=0.02, rot=(math.radians(-20), 0, 0))
    ball(0.05, (-0.3, -0.12, 1.14), BULB_RED)
    # Turnstile drum and arms.
    cyl(0.12, 0.95, (0.25, 0, 0.475), STEEL)
    for k in range(3):
        a = math.radians(30 + k * 120)
        mid = Vector((0.25 + math.cos(a) * 0.25, math.sin(a) * 0.25, 0.85))
        cyl(0.025, 0.5, mid, STEEL, verts=12,
            rot=(0, math.radians(90), a))
    box((0.9, 0.06, 0.05), (0, 0.42, 0.9), STEEL)
    box((0.06, 0.06, 0.9), (-0.42, 0.42, 0.45), STEEL)
    box((0.06, 0.06, 0.9), (0.42, 0.42, 0.45), STEEL)


def fence():
    for x in (-0.5, 0.0, 0.5):
        box((0.06, 0.06, 1.0), (x, 0, 0.5), DARK)
        ball(0.05, (x, 0, 1.03), DARK)
    for z in (0.25, 0.85):
        box((1.06, 0.04, 0.05), (0, 0, z), DARK)
    for k in range(9):
        x = -0.45 + k * 0.1125
        box((0.02, 0.02, 0.6), (x, 0, 0.55), DARK)


def bench():
    for x in (-0.6, 0.6):
        box((0.08, 0.5, 0.42), (x, 0, 0.21), DARK)
        box((0.08, 0.06, 0.5), (x, 0.22, 0.65), DARK)
    for k in range(3):
        box((1.4, 0.13, 0.04), (0, -0.16 + k * 0.16, 0.44), WOOD, bevel=0.01)
    for k in range(2):
        box((1.4, 0.04, 0.12), (0, 0.25, 0.6 + k * 0.16), WOOD, bevel=0.01)
    cyl(0.04, 0.11, (0.3, -0.1, 0.515), CUP_RED, verts=12)   # abandoned cup


def trash_can():
    cyl(0.3, 0.85, (0, 0, 0.425), TRASH_GREEN)
    cyl(0.33, 0.06, (0, 0, 0.86), DARK)
    for (x, y, z, s, m) in ((0.05, 0.0, 0.95, 0.14, TRASH_BITS), (-0.12, 0.08, 0.97, 0.10, TRASH_BITS),
                            (0.12, -0.12, 0.98, 0.09, CUP_RED), (-0.05, -0.1, 1.05, 0.08, YELLOW)):
        ball(s, (x, y, z), m, scale=(1.2, 1, 0.8))
    cyl(0.04, 0.11, (0.45, -0.3, 0.05), CUP_RED, verts=12, rot=(math.radians(90), 0, 0.6))
    box((0.16, 0.12, 0.02), (-0.3, -0.42, 0.01), TRASH_BITS, rot=(0, 0, 0.4))


def lamp_post():
    cyl(0.1, 0.25, (0, 0, 0.125), GREEN_PAINT)
    cyl(0.045, 2.8, (0, 0, 1.5), GREEN_PAINT)
    box((0.26, 0.26, 0.36), (0, 0, 3.05), BULB_WARM)
    cone(0.26, 0.05, 0.18, (0, 0, 3.32), GREEN_PAINT, verts=4, rot=(0, 0, math.radians(45)))
    # Limp, sun-bleached Halloween banner.
    box((0.5, 0.02, 0.06), (0.25, 0, 2.45), GREEN_PAINT)
    box((0.42, 0.02, 0.55), (0.28, -0.012, 2.12), ORANGE)
    text("BOO", (0.28, -0.03, 2.15), 0.17, BLACK_TXT)


def hay_bale():
    box((1.0, 0.6, 0.5), (0, 0, 0.25), HAY, bevel=0.05)
    ball(0.17, (0.15, -0.05, 0.62), PUMPKIN, scale=(1, 1, 0.75))
    cyl(0.02, 0.08, (0.15, -0.05, 0.77), STEM, verts=8)


def food_cart():
    box((1.3, 0.75, 0.75), (0, 0, 0.55), YELLOW, bevel=0.03)
    box((1.34, 0.79, 0.06), (0, 0, 0.95), WHITE, bevel=0.01)
    for x in (-0.45, 0.45):
        cyl(0.17, 0.08, (x, -0.38, 0.18), DARK, rot=(math.radians(90), 0, 0))
    box((0.06, 0.06, 0.45), (0.75, 0, 0.4), STEEL)            # handle
    text("VEGAN*", (0, -0.385, 0.6), 0.2, RED)
    text("*mostly", (0, -0.385, 0.38), 0.09, BLACK_TXT)
    cyl(0.03, 1.4, (0, 0, 1.65), STEEL, verts=8)
    cone(0.95, 0.05, 0.35, (0, 0, 2.25), AWNING, verts=10)
    box((0.3, 0.25, 0.18), (-0.3, 0.1, 1.07), STEEL, bevel=0.01)


def guest():
    for x in (-0.09, 0.09):
        cyl(0.075, 0.8, (x, 0, 0.45), JEANS, verts=16)
        box((0.13, 0.22, 0.08), (x, -0.04, 0.04), SHOES, bevel=0.02)
    cyl(0.2, 0.62, (0, 0, 1.12), SHIRT, verts=20)
    ball(0.2, (0, 0, 1.42), SHIRT, scale=(1, 0.8, 0.4))
    for x in (-0.25, 0.25):
        cyl(0.06, 0.58, (x, 0, 1.12), SHIRT, verts=12)
        ball(0.06, (x, 0, 0.8), SKIN)
    cyl(0.06, 0.12, (0, 0, 1.52), SKIN, verts=12)
    ball(0.15, (0, 0, 1.68), SKIN, scale=(0.9, 0.95, 1.1))
    ball(0.155, (0, 0.02, 1.73), HAIR, scale=(0.95, 1.0, 0.9))


def ground(n):
    box((n, n, 0.25), (n / 2, -n / 2, -0.125), DIRT)
    box((n, n, 0.01), (n / 2, -n / 2, 0.0), GRASS)
    box((n - 2, n - 3, 0.02), (n / 2, -(n / 2 + 1), 0.01), PAVERS)  # plaza
    box((2, 3, 0.02), (n / 2, -1.5, 0.01), ASPHALT)                 # entrance path


# -------------------------------------------------------------------- main

# Every prop renders on the same roomy canvas, then gets auto-cropped.
CANVAS = (640, 640, 480)  # width, height, anchor_y
PROPS = {
    "ticket_booth": ticket_booth,
    "turnstile": turnstile,
    "fence": fence,
    "bench": bench,
    "trash_can": trash_can,
    "lamp_post": lamp_post,
    "hay_bale": hay_bale,
    "food_cart": food_cart,
    "guest": guest,
}


def main():
    os.makedirs(OUT, exist_ok=True)
    setup_scene()
    only = sys.argv[sys.argv.index("--") + 2:] if "--" in sys.argv else []

    for name, build in PROPS.items():
        if only and name not in only:
            continue
        clear_props()
        build()
        render(name, *CANVAS)

    if not only or "ground" in only:
        n = 10
        clear_props()
        ground(n)
        render("ground", n * TILE_W + 8, n * TILE_W // 2 + 40, 4 + n * TILE_W // 4,
               catcher=False, target=Vector((n / 2, -n / 2, 0)))

    path = os.path.join(OUT, "manifest.json")
    old = {}
    if os.path.exists(path):
        with open(path) as f:
            old = json.load(f).get("sprites", {})
    old.update(manifest["sprites"])
    manifest["sprites"] = old
    with open(path, "w") as f:
        json.dump(manifest, f, indent=2)


main()
