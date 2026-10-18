"""Render every park building as a Sims-1-style isometric sprite.

Usage (from repo root):
  npm run assets         # refresh art/assets.json from the park data
  npm run art            # render all of them (or: npm run art -- emporium bbq)

Reads art/assets.json (footprint, zone, kind for each building) and builds each
one from a "kit": the zone decides materials and roof style, the kind decides
the shape (food counter, ride station, restroom...). Drop seamless textures
into art/textures/ (brick.png, wood.png, ...) and they replace the procedural
materials on the next render. See docs/art.md.

Output: public/sprites/park/<id>.png and manifest.json with each sprite's
anchor (the pixel where the footprint centre on the ground lands).
Camera and scale match the game exactly: 128 px per tile, 2:1 dimetric.
"""
import bpy
import json
import math
import os
import sys
from mathutils import Euler, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from to_webp import convert as _to_webp  # noqa: E402


def to_webp(path):
    _to_webp(path)
    sc = bpy.context.scene
    sc.render.image_settings.file_format = "PNG"  # back to PNG for the next render
    sc.render.image_settings.color_mode = "RGBA"


ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "public", "sprites", "park")
TEX = os.path.join(ROOT, "art", "textures")
TILE_W = 128
PPU = (TILE_W / 2) / math.cos(math.radians(45))
CAM_ROT = Euler((math.radians(60), 0, math.radians(45)), "XYZ")
CANVAS = (768, 896, 704)  # width, height, anchor_y: roomy, then auto-cropped
manifest = {"tileW": TILE_W, "sprites": {}}


# ------------------------------------------------------------------ scene

def setup_scene():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 32
    sc.cycles.use_denoising = True
    sc.cycles.filter_width = 0.8
    sc.render.film_transparent = True
    sc.render.resolution_percentage = 100
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
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.75, 0.82, 0.95, 1)
    bg.inputs["Strength"].default_value = 0.5
    sun_data = bpy.data.lights.new("Sun", "SUN")
    sun_data.energy = 4.5
    sun_data.angle = math.radians(12)
    sun_data.color = (1.0, 0.96, 0.88)
    sun = bpy.data.objects.new("Sun", sun_data)
    sc.collection.objects.link(sun)
    to_light = Vector((-0.35, -1.0, 2.4)).normalized()
    sun.rotation_euler = (-to_light).to_track_quat("-Z", "Y").to_euler()


def clear():
    for o in list(bpy.data.objects):
        if o.name != "Sun":
            bpy.data.objects.remove(o, do_unlink=True)


def canvas_for(a):
    """A canvas just big enough for the footprint, height and shadow (then auto-cropped)."""
    span = (a["w"] + a["d"]) * 64
    tall = max(a["h"], 1.0) * 78 * 1.6
    w = int((span * 1.5 + tall * 0.8 + 260) // 32 * 32)
    h = int((span * 0.6 + tall + 300) // 32 * 32)
    return w, h, h - int(span * 0.3 + 110)


def render(name, size=None):
    sc = bpy.context.scene
    w, h, ay = size or CANVAS
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    bpy.context.active_object.is_shadow_catcher = True
    sc.render.resolution_x, sc.render.resolution_y = w, h
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.ortho_scale = max(w, h) / PPU
    cd.clip_end = 300
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    cam.rotation_euler = CAM_ROT
    m = CAM_ROT.to_matrix()
    cam.location = (m @ Vector((0, 0, 1))) * 80 + (m @ Vector((0, 1, 0))) * ((ay - h / 2) / PPU)
    sc.camera = cam
    path = os.path.join(OUT, name + ".png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    cw, ch, ax2, ay2 = autocrop(path, w / 2, ay)
    to_webp(path)
    manifest["sprites"][name] = {"w": cw, "h": ch, "ax": ax2, "ay": ay2}
    print("rendered", name, cw, "x", ch)


def autocrop(path, ax, ay, pad=2):
    import numpy as np
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    ys, xs = np.nonzero(px[:, :, 3] > 0.03)
    if xs.min() <= 0 or ys.min() <= 0 or xs.max() >= w - 1 or ys.max() >= h - 1:
        print("WARNING clipped at canvas edge:", os.path.basename(path))
    x0, x1 = max(int(xs.min()) - pad, 0), min(int(xs.max()) + pad + 1, w)
    y0, y1 = max(int(ys.min()) - pad, 0), min(int(ys.max()) + pad + 1, h)
    crop = px[y0:y1, x0:x1].copy()
    out = bpy.data.images.new("crop", x1 - x0, y1 - y0, alpha=True)
    out.pixels.foreach_set(crop.ravel())
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(img)
    bpy.data.images.remove(out)
    return x1 - x0, y1 - y0, float(ax - x0), float(ay - (h - y1))


# ------------------------------------------------------------------ materials

_mats = {}


def lin(c):
    return (*(v ** 2.2 for v in c), 1)


def hexc(s):
    s = s.lstrip("#")
    return tuple(int(s[k:k + 2], 16) / 255 for k in (0, 2, 4))


def mat(name, color, rough=0.75, kind=None, color2=None, scale=4.0, metal=0.0, emit=0.0,
        grime=0.25, tex=None, tex_size=2.0, glass=0.0):
    """Matte material. If art/textures/<tex>.png exists it is used (tinted by color)."""
    key = (name, tuple(color), kind, tex)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Specular IOR Level"].default_value = 0.25
    if glass:
        bsdf.inputs["Transmission Weight"].default_value = glass
    link = nt.links.new
    coord = nt.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    c1, c2 = lin(color), lin(color2 or color)
    tex_path = os.path.join(TEX, tex + ".png") if tex else None
    if tex_path and os.path.exists(tex_path):
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (1 / tex_size,) * 3
        link(coord, mp.inputs["Vector"])
        it = nt.nodes.new("ShaderNodeTexImage")
        it.image = bpy.data.images.load(tex_path, check_existing=True)
        it.projection = "BOX"
        it.projection_blend = 0.2
        link(mp.outputs["Vector"], it.inputs["Vector"])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 0.35
        link(it.outputs["Color"], mix.inputs[6])
        mix.inputs[7].default_value = c1
        col = mix.outputs[2]
    elif kind == "brick":
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        link(coord, sep.inputs[0])
        add = nt.nodes.new("ShaderNodeMath")
        add.operation = "ADD"
        link(sep.outputs[0], add.inputs[0])
        link(sep.outputs[1], add.inputs[1])
        comb = nt.nodes.new("ShaderNodeCombineXYZ")
        link(add.outputs[0], comb.inputs[0])
        link(sep.outputs[2], comb.inputs[1])
        t = nt.nodes.new("ShaderNodeTexBrick")
        link(comb.outputs[0], t.inputs["Vector"])
        t.inputs["Color1"].default_value = c1
        t.inputs["Color2"].default_value = c2
        t.inputs["Mortar"].default_value = lin((0.62, 0.58, 0.52))
        t.inputs["Scale"].default_value = scale
        t.inputs["Mortar Size"].default_value = 0.03
        t.inputs["Brick Width"].default_value = 0.5
        t.inputs["Row Height"].default_value = 0.22
        col = t.outputs["Color"]
    elif kind in ("stripes", "wood", "planks", "tin"):
        t = nt.nodes.new("ShaderNodeTexWave")
        link(coord, t.inputs["Vector"])
        t.wave_type = "BANDS"
        t.bands_direction = "Z" if kind == "planks" else "X"
        t.inputs["Scale"].default_value = scale
        t.inputs["Distortion"].default_value = 0.0 if kind in ("stripes", "tin") else 5.0
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        if kind == "stripes":
            ramp.color_ramp.interpolation = "CONSTANT"
        ramp.color_ramp.elements[0].color = c1
        ramp.color_ramp.elements[1].position = 0.5
        ramp.color_ramp.elements[1].color = c2
        link(t.outputs["Fac"], ramp.inputs["Fac"])
        col = ramp.outputs["Color"]
    elif kind == "speckle":
        t = nt.nodes.new("ShaderNodeTexNoise")
        link(coord, t.inputs["Vector"])
        t.inputs["Scale"].default_value = scale
        t.inputs["Detail"].default_value = 8.0
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.35
        ramp.color_ramp.elements[0].color = c1
        ramp.color_ramp.elements[1].position = 0.65
        ramp.color_ramp.elements[1].color = c2
        link(t.outputs["Fac"], ramp.inputs["Fac"])
        col = ramp.outputs["Color"]
    else:
        rgb = nt.nodes.new("ShaderNodeRGB")
        rgb.outputs[0].default_value = c1
        col = rgb.outputs[0]
    if grime:
        n = nt.nodes.new("ShaderNodeTexNoise")
        link(coord, n.inputs["Vector"])
        n.inputs["Scale"].default_value = 7.0
        n.inputs["Detail"].default_value = 6.0
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = grime
        link(col, mix.inputs[6])
        link(n.outputs["Color"], mix.inputs[7])
        col = mix.outputs[2]
    link(col, bsdf.inputs["Base Color"])
    if emit:
        bsdf.inputs["Emission Color"].default_value = c1
        bsdf.inputs["Emission Strength"].default_value = emit
    _mats[key] = m
    return m


def solid(color, **kw):
    return mat("c" + "".join(f"{int(v * 255):02x}" for v in color), color, **kw)


# ------------------------------------------------------------------ geometry

def _apply(o, material, bevel=0.0):
    o.data.materials.append(material)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    return o


def box(size, loc, material, bevel=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    return _apply(o, material, bevel)


def cyl(r, depth, loc, material, verts=24, rot=(0, 0, 0), r2=None):
    if r2 is not None:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth_by_angle()
    return o


def cone(r1, r2, depth, loc, material, verts=24, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.data.materials.append(material)
    return o


def ball(r, loc, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=24, ring_count=12)
    o = bpy.context.active_object
    o.scale = scale
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return o


def text(body, loc, size, material, face="-y", extrude=0.01, max_w=None):
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    o = bpy.data.objects.new("txt", cu)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (math.radians(90), 0, 0 if face == "-y" else math.radians(90))
    cu.materials.append(material)
    if max_w:
        bpy.context.view_layer.update()
        width = o.dimensions.x
        if width > max_w:
            cu.size = size * max_w / width
    return o


def gable(w, d, z, rise, material, overhang=0.12):
    """A pitched roof running along x."""
    import bmesh
    mesh = bpy.data.meshes.new("gable")
    bm = bmesh.new()
    hw, hd = w / 2 + overhang, d / 2 + overhang
    v = [bm.verts.new(p) for p in [(-hw, -hd, z), (hw, -hd, z), (hw, hd, z), (-hw, hd, z), (-hw, 0, z + rise), (hw, 0, z + rise)]]
    for f in [(0, 1, 5, 4), (3, 4, 5, 2), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]:
        bm.faces.new([v[k] for k in f])
    bm.to_mesh(mesh)
    o = bpy.data.objects.new("gable", mesh)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(material)
    return o


# ------------------------------------------------------------------ palette

WHITE = solid((0.92, 0.9, 0.85))
CREAM = solid((0.93, 0.86, 0.7))
DARK = solid((0.08, 0.08, 0.09), rough=0.4)
STEEL = solid((0.6, 0.62, 0.65), rough=0.3, metal=0.8)
CHROME = solid((0.85, 0.87, 0.9), rough=0.12, metal=1.0, grime=0.05)
GLASS = solid((0.35, 0.55, 0.65), rough=0.08, grime=0.15)
GLASSY = solid((0.62, 0.85, 0.95), rough=0.05, glass=0.5, grime=0.05)
WATER = solid((0.12, 0.45, 0.62), rough=0.05, grime=0.1)
BULB = solid((1.0, 0.85, 0.45), emit=5.0, grime=0)
SKIN = solid((0.85, 0.62, 0.48), grime=0)
BLACK = solid((0.03, 0.03, 0.03), grime=0)


def neon(c):
    return solid(c, emit=6.0, grime=0)


def style(zone):
    """Materials and roof style per zone. Jokes live in the signage, not the architecture."""
    S = {
        "depot": dict(wall=mat("brick_red", (0.62, 0.27, 0.2), kind="brick", color2=(0.52, 0.22, 0.17), scale=3, tex="brick"),
                      trim=CREAM, roof=solid((0.25, 0.22, 0.2)), accent=solid((0.12, 0.35, 0.22)), roof_type="parapet",
                      sign=(CREAM, solid((0.45, 0.12, 0.1)))),
        "expo": dict(wall=mat("canvas", (0.8, 0.12, 0.1), kind="stripes", color2=(0.95, 0.92, 0.85), scale=4, grime=0.12, tex="canvas"),
                     trim=solid((0.95, 0.75, 0.15)), roof=mat("tent", (0.8, 0.12, 0.1), kind="stripes", color2=(0.95, 0.92, 0.85), scale=4, grime=0.1),
                     accent=solid((0.95, 0.75, 0.15)), roof_type="tent", sign=(solid((0.95, 0.75, 0.15)), solid((0.45, 0.1, 0.1)))),
        "passport": dict(wall=mat("stucco", (0.92, 0.84, 0.66), kind="speckle", color2=(0.85, 0.76, 0.58), scale=12, tex="stucco"),
                         trim=WHITE, roof=mat("terracotta", (0.7, 0.33, 0.2), kind="tin", color2=(0.6, 0.27, 0.16), scale=8, tex="roof_tile"),
                         accent=solid((0.2, 0.4, 0.6)), roof_type="hip", sign=(WHITE, solid((0.2, 0.3, 0.5)))),
        "bonewars": dict(wall=mat("planks", (0.45, 0.32, 0.2), kind="planks", color2=(0.35, 0.24, 0.15), scale=6, tex="wood"),
                         trim=solid((0.3, 0.2, 0.12)), roof=mat("tinroof", (0.55, 0.57, 0.58), kind="tin", color2=(0.45, 0.46, 0.47), scale=14, metal=0.4, tex="tin"),
                         accent=solid((0.9, 0.88, 0.8)), roof_type="gable", sign=(solid((0.85, 0.75, 0.55)), solid((0.3, 0.15, 0.08)))),
        "fossil": dict(wall=mat("rock", (0.6, 0.53, 0.42), kind="speckle", color2=(0.45, 0.4, 0.32), scale=6, tex="stone"),
                       trim=solid((0.92, 0.9, 0.8)), roof=mat("leafy", (0.25, 0.5, 0.18), kind="speckle", color2=(0.35, 0.62, 0.22), scale=10),
                       accent=solid((0.92, 0.9, 0.82)), roof_type="flat", sign=(solid((0.95, 0.85, 0.4)), solid((0.15, 0.35, 0.12)))),
        "extinction": dict(wall=mat("scorched", (0.28, 0.25, 0.24), kind="speckle", color2=(0.18, 0.16, 0.16), scale=7, tex="stone"),
                           trim=neon((1.0, 0.35, 0.05)), roof=solid((0.15, 0.13, 0.13)), accent=neon((1.0, 0.35, 0.05)),
                           roof_type="flat", sign=(solid((0.2, 0.18, 0.18)), neon((1.0, 0.45, 0.1)))),
        "atomic": dict(wall=solid((0.92, 0.93, 0.9)), trim=solid((0.2, 0.75, 0.72)), roof=solid((0.2, 0.75, 0.72)),
                       accent=solid((0.98, 0.72, 0.15)), roof_type="boomerang", sign=(solid((0.2, 0.75, 0.72)), WHITE)),
        "mall": dict(wall=mat("concrete", (0.82, 0.76, 0.66), kind="speckle", color2=(0.72, 0.66, 0.57), scale=10, tex="concrete"),
                     trim=neon((1.0, 0.3, 0.7)), roof=solid((0.6, 0.55, 0.5)), accent=neon((0.2, 0.9, 0.9)), roof_type="flat",
                     sign=(solid((0.12, 0.1, 0.2)), neon((1.0, 0.3, 0.75)))),
        "aero": dict(wall=GLASSY, trim=solid((0.96, 0.97, 0.98), rough=0.2), roof=solid((0.96, 0.97, 0.98), rough=0.15),
                     accent=solid((0.35, 0.75, 0.95), rough=0.1), roof_type="dome", sign=(solid((0.96, 0.97, 0.98)), solid((0.1, 0.45, 0.8)))),
        "y2k": dict(wall=solid((0.82, 0.8, 0.95), rough=0.15), trim=CHROME, roof=solid((0.95, 0.75, 0.88), rough=0.2),
                    accent=CHROME, roof_type="dome", sign=(CHROME, solid((0.55, 0.2, 0.75)))),
        "mirrorball": dict(wall=solid((0.22, 0.08, 0.3)), trim=neon((1.0, 0.25, 0.75)), roof=solid((0.15, 0.05, 0.2)),
                           accent=neon((0.4, 0.9, 1.0)), roof_type="marquee", sign=(solid((0.1, 0.03, 0.12)), neon((1.0, 0.4, 0.85)))),
        "foam": dict(wall=mat("dockwood", (0.55, 0.45, 0.35), kind="planks", color2=(0.45, 0.36, 0.28), scale=6, tex="wood"),
                     trim=neon((0.6, 0.5, 1.0)), roof=solid((0.95, 0.95, 1.0)), accent=solid((0.95, 0.95, 1.0)), roof_type="flat",
                     sign=(solid((0.95, 0.95, 1.0)), solid((0.45, 0.3, 0.8)))),
        "lagoon": dict(wall=mat("clapboard", (0.45, 0.65, 0.78), kind="planks", color2=(0.38, 0.56, 0.68), scale=10, tex="clapboard"),
                       trim=WHITE, roof=mat("shingle", (0.32, 0.3, 0.32), kind="tin", color2=(0.26, 0.25, 0.27), scale=12, tex="shingle"),
                       accent=solid((0.9, 0.3, 0.2)), roof_type="gable", sign=(WHITE, solid((0.1, 0.3, 0.5)))),
        "ozark": dict(wall=mat("logs", (0.5, 0.33, 0.18), kind="planks", color2=(0.4, 0.26, 0.14), scale=5, tex="logs"),
                      trim=solid((0.2, 0.35, 0.2)), roof=mat("greentin", (0.22, 0.4, 0.24), kind="tin", color2=(0.18, 0.33, 0.2), scale=14, metal=0.3, tex="tin"),
                      accent=solid((0.95, 0.85, 0.5)), roof_type="gable", sign=(solid((0.95, 0.88, 0.6)), solid((0.2, 0.3, 0.15)))),
    }
    return S.get(zone, S["depot"])


# ------------------------------------------------------------------ building kit

def roof(st, w, d, z):
    t = st["roof_type"]
    r = st["roof"]
    if t == "gable":
        gable(w, d, z, min(w, d) * 0.45, r)
    elif t == "hip":
        cone(max(w, d) * 0.78, 0.05, min(w, d) * 0.45, (0, 0, z + min(w, d) * 0.22), r, verts=4, rot=(0, 0, math.radians(45)))
        bpy.context.active_object.scale = (w / max(w, d), d / max(w, d), 1)
    elif t == "tent":
        cone(max(w, d) * 0.72, 0.03, max(w, d) * 0.55, (0, 0, z + max(w, d) * 0.27), r, verts=12)
        cyl(0.02, 0.5, (0, 0, z + max(w, d) * 0.55 + 0.2), STEEL, verts=6)
        box((0.25, 0.01, 0.14), (0.12, 0, z + max(w, d) * 0.55 + 0.38), st["accent"])
    elif t == "dome":
        ball(min(w, d) * 0.48, (0, 0, z), r, scale=(w / min(w, d), d / min(w, d), 0.6))
    elif t == "boomerang":
        box((w * 1.15, d * 1.1, 0.08), (0, 0, z + 0.25), r, rot=(math.radians(8), math.radians(-6), 0))
        for k in range(3):
            cyl(0.03, 0.6, (-w / 2 + 0.2 + k * 0.25, -d / 2 - 0.1, z + 0.55), st["accent"], verts=6, rot=(0, math.radians(20 * (k - 1)), 0))
    elif t == "marquee":
        box((w, d, 0.1), (0, 0, z + 0.05), r)
        for k in range(int(w * 4)):
            ball(0.04, (-w / 2 + 0.12 + k * 0.25, -d / 2 - 0.02, z + 0.02), BULB)
    elif t == "parapet":
        box((w, d, 0.05), (0, 0, z + 0.02), r)
        for size, loc in (((w + 0.06, 0.08, 0.18), (0, -d / 2, z + 0.09)), ((w + 0.06, 0.08, 0.18), (0, d / 2, z + 0.09)),
                          ((0.08, d + 0.06, 0.18), (-w / 2, 0, z + 0.09)), ((0.08, d + 0.06, 0.18), (w / 2, 0, z + 0.09))):
            box(size, loc, st["trim"])
    else:  # flat
        box((w + 0.1, d + 0.1, 0.1), (0, 0, z + 0.05), r)


WINDOW = solid((0.12, 0.2, 0.26), rough=0.1, grime=0.1)


def windows(w, d, z0, hgt, n_x, n_y, material=WINDOW, frame=None):
    frame = frame or WHITE
    pane = min(0.32, hgt * 0.9)
    for k in range(n_x):
        x = -w / 2 + (k + 0.5) * w / n_x
        box((pane + 0.06, 0.03, pane * 1.25 + 0.06), (x, -d / 2 - 0.01, z0 + hgt / 2), frame)
        box((pane, 0.04, pane * 1.25), (x, -d / 2 - 0.02, z0 + hgt / 2), material)
    for k in range(n_y):
        y = -d / 2 + (k + 0.5) * d / n_y
        box((0.03, pane + 0.06, pane * 1.25 + 0.06), (w / 2 + 0.01, y, z0 + hgt / 2), frame)
        box((0.04, pane, pane * 1.25), (w / 2 + 0.02, y, z0 + hgt / 2), material)


def sign_board(st, label, w, d, z, size=0.22):
    bg, fg = st["sign"]
    box((min(w * 0.9, 2.8), 0.06, size * 1.6), (0, -d / 2 - 0.05, z), bg, bevel=0.01)
    text(label, (0, -d / 2 - 0.09, z), size, fg, max_w=min(w * 0.86, 2.7))


def building(a, st, h_wall=None, sign=True):
    w, d = a["w"], a["d"]
    hw = h_wall or max(0.7, a["h"] * 0.78)
    box((w, d, hw), (0, 0, hw / 2), st["wall"], bevel=0.02)
    box((w + 0.04, d + 0.04, 0.08), (0, 0, hw - 0.04), st["trim"])
    roof(st, w, d, hw)
    box((0.42, 0.04, 0.62), (w * 0.25, -d / 2 - 0.01, 0.31), DARK)  # door
    windows(w, d, hw * 0.42, hw * 0.34, max(1, int(w / 0.75)), max(1, int(d / 0.75)), frame=st["trim"] if st["trim"] not in (BULB,) else WHITE)
    if sign and a.get("sign"):
        sign_board(st, a["sign"], w, d, hw + 0.2)
    return hw


RIDE_TYPES = {
    "spinner": {"carousel", "teacups", "satellite", "swings", "inferno", "bubble", "flipphone"},
    "tower": {"glitter", "meteor"},
    "water": {"riptide", "foampit", "cruise"},
    "dark": {"trex", "worldboat", "lasertag", "barn"},
    "playground": {"dig"},
}


def ride(a, st):
    w, d, rid = a["w"], a["d"], a["id"]
    kind = next((k for k, ids in RIDE_TYPES.items() if rid in ids), "station")
    if kind == "spinner":
        r = min(w, d) / 2
        cyl(r, 0.18, (0, 0, 0.09), st["trim"], verts=32)
        cyl(0.12, a["h"], (0, 0, a["h"] / 2), st["accent"] if st["accent"] != BULB else STEEL, verts=12)
        cone(r * 1.02, 0.08, 0.5, (0, 0, a["h"] + 0.15), st["roof"], verts=16)
        n = 8
        cols = [solid(c) for c in [(0.9, 0.2, 0.2), (0.2, 0.55, 0.9), (0.95, 0.8, 0.2), (0.3, 0.75, 0.35)]]
        for k in range(n):
            t = k / n * math.pi * 2
            if rid == "teacups":
                cyl(0.22, 0.22, (math.cos(t) * r * 0.65, math.sin(t) * r * 0.65, 0.3), cols[k % 4], verts=16, r2=0.16)
            elif rid == "carousel":
                cyl(0.025, a["h"] * 0.8, (math.cos(t) * r * 0.7, math.sin(t) * r * 0.7, a["h"] * 0.4), CHROME, verts=6)
                box((0.12, 0.32, 0.16), (math.cos(t) * r * 0.7, math.sin(t) * r * 0.7, 0.45), WHITE, rot=(0, 0, t))
            else:
                ball(0.16, (math.cos(t) * r * 0.75, math.sin(t) * r * 0.75, a["h"] * 0.55), cols[k % 4], scale=(1, 1, 0.8))
        return
    if kind == "tower":
        cyl(0.55, 0.3, (0, 0, 0.15), st["trim"], verts=16)
        cyl(0.22, a["h"] * 1.25, (0, 0, a["h"] * 0.62), STEEL, verts=12)
        cyl(0.62, 0.22, (0, 0, a["h"] * 0.6), st["accent"], verts=16)
        cone(0.3, 0.02, 0.5, (0, 0, a["h"] * 1.25 + 0.25), st["roof"], verts=12)
        return
    if kind == "water":
        box((w, d, 0.25), (0, 0, 0.125), st["trim"])
        box((w * 0.86, d * 0.7, 0.05), (0, 0, 0.26), WATER)
        for k in range(2):
            box((0.5, 0.28, 0.16), (-w * 0.25 + k * w * 0.4, 0, 0.36), st["accent"], bevel=0.04)
        if rid == "cruise":
            box((0.9, 0.45, 0.3), (0.2, 0, 0.45), WHITE, bevel=0.06)
            box((0.4, 0.3, 0.25), (0.1, 0, 0.72), st["accent"])
        if a.get("sign"):
            sign_board(st, a["sign"], w, d, 0.8, 0.18)
        return
    if kind == "playground":
        box((w, d, 0.15), (0, 0, 0.075), mat("sand", (0.85, 0.75, 0.5), kind="speckle", color2=(0.78, 0.66, 0.42), scale=20))
        for k in range(4):
            cyl(0.06, 0.5, (-0.6 + k * 0.4, 0.3, 0.3), WHITE, verts=8, rot=(math.radians(30), 0, k))
        ball(0.3, (0.4, -0.3, 0.3), WHITE, scale=(1.4, 0.8, 0.6))
        return
    if kind == "dark":
        hw = building(a, st, h_wall=a["h"] * 0.9)
        box((w * 0.5, 0.3, 0.9), (-w * 0.15, -d / 2 - 0.15, 0.45), st["trim"])  # entrance portal
        if rid == "trex":
            ball(0.6, (0.3, -d / 2 + 0.2, hw + 0.4), solid((0.2, 0.55, 0.25)), scale=(1.4, 0.9, 0.8))
            for k in range(4):
                cone(0.06, 0.0, 0.18, (0.0 + k * 0.18, -d / 2 - 0.25, hw + 0.25), WHITE, verts=6, rot=(math.radians(180), 0, 0))
        return
    # Default: a ride station with a queue maze and a canopy.
    plat_h = 0.35
    box((w, d, plat_h), (0, 0, plat_h / 2), st["trim"])
    for k in range(4):
        x = -w / 2 + 0.15 + k * (w - 0.3) / 3
        for y in (-d / 2 + 0.12, d / 2 - 0.12):
            cyl(0.05, a["h"] * 0.8, (x, y, plat_h + a["h"] * 0.4), STEEL, verts=8)
    roof(st, w, d, plat_h + a["h"] * 0.8)
    for k in range(3):  # queue rails out front
        box((w * 0.8, 0.03, 0.03), (0, -d / 2 - 0.25 - k * 0.22, 0.45), STEEL)
    if a.get("sign"):
        sign_board(st, a["sign"], w, d, plat_h + a["h"] * 0.8 + 0.45, 0.2)


def food(a, st):
    w, d = a["w"], a["d"]
    hw = building(a, st, h_wall=max(0.8, a["h"] * 0.75))
    box((w * 0.7, 0.04, 0.35), (-w * 0.05, -d / 2 - 0.02, 0.75), DARK)  # service window
    box((w * 0.75, 0.25, 0.06), (-w * 0.05, -d / 2 - 0.12, 0.55), st["trim"])  # counter
    box((w * 0.85, 0.55, 0.04), (-w * 0.05, -d / 2 - 0.28, hw - 0.05), mat("awn", (0.85, 0.15, 0.12), kind="stripes", color2=(0.96, 0.93, 0.88), scale=7, grime=0.1), rot=(math.radians(-18), 0, 0))
    for k in range(2):  # picnic tables
        box((0.6, 0.35, 0.05), (w / 2 + 0.6, -d / 2 + 0.5 + k * 0.7, 0.35), mat("wood_t", (0.5, 0.33, 0.18), kind="wood", color2=(0.38, 0.24, 0.12), scale=3))
        for y in (-0.22, 0.22):
            box((0.6, 0.1, 0.03), (w / 2 + 0.6, -d / 2 + 0.5 + k * 0.7 + y, 0.22), solid((0.45, 0.3, 0.16)))
    if a["zone"] in ("expo", "ozark", "foam", "lagoon"):
        cyl(0.03, 1.2, (w / 2 + 0.6, -d / 2 + 0.85, 0.6), STEEL, verts=6)
        cone(0.6, 0.02, 0.25, (w / 2 + 0.6, -d / 2 + 0.85, 1.25), st["accent"], verts=8)


def restroom(a, st):
    w, d = a["w"], a["d"]
    box((w, d, 0.85), (0, 0, 0.425), st["wall"], bevel=0.02)
    roof(st, w, d, 0.85)
    for k, x in enumerate((-w * 0.22, w * 0.22)):
        box((0.28, 0.04, 0.55), (x, -d / 2 - 0.01, 0.3), DARK)
        ball(0.06, (x, -d / 2 - 0.04, 0.68), solid((0.2, 0.45, 0.85) if k == 0 else (0.85, 0.3, 0.55)))
    box((w * 0.9, 0.04, 0.18), (0, -d / 2 - 0.03, 0.95), WHITE)
    text("RESTROOMS", (0, -d / 2 - 0.06, 0.95), 0.12, DARK, max_w=w * 0.85)


def shop(a, st):
    w, d = a["w"], a["d"]
    hw = building(a, st, h_wall=max(0.9, a["h"] * 0.8), sign=True)
    for k in range(2):
        box((w * 0.32, 0.03, 0.45), (-w * 0.22 + k * w * 0.44, -d / 2 - 0.02, 0.4), GLASSY)
    for k in range(3):  # merch on display
        ball(0.08, (-w * 0.3 + k * 0.2, -d / 2 - 0.08, 0.3), solid([(0.9, 0.3, 0.3), (0.3, 0.6, 0.9), (0.95, 0.8, 0.2)][k]))
    del hw


def show(a, st):
    w, d = a["w"], a["d"]
    hw = building(a, st, h_wall=max(1.0, a["h"] * 0.85), sign=False)
    box((w * 0.8, 0.5, 0.08), (0, -d / 2 - 0.25, hw * 0.7), st["trim"])  # marquee canopy
    for k in range(int(w * 3)):
        ball(0.04, (-w * 0.38 + k * 0.33, -d / 2 - 0.5, hw * 0.7 - 0.03), BULB)
    sign_board(st, a["sign"], w, d, hw + 0.35, 0.24)
    box((w * 0.5, 0.04, 0.5), (0, -d / 2 - 0.01, 0.3), solid((0.5, 0.08, 0.1)))  # doors


def game(a, st):
    w, d = a["w"], a["d"]
    box((w, d, 0.9), (0, 0, 0.45), st["wall"], bevel=0.02)
    box((w * 0.9, 0.04, 0.45), (0, -d / 2 - 0.01, 0.6), DARK)
    box((w, 0.3, 0.08), (0, -d / 2 - 0.15, 0.38), st["trim"])
    cols = [(0.95, 0.85, 0.15), (0.9, 0.2, 0.3), (0.2, 0.7, 0.9), (0.3, 0.8, 0.3)]
    for k in range(6):  # prizes
        ball(0.09, (-w * 0.35 + k * w * 0.14, -d / 2 + 0.08, 0.75 + (k % 2) * 0.12), solid(cols[k % 4]))
    roof(st, w, d, 0.9)
    sign_board(st, a["sign"], w, d, 1.35, 0.18)


def photo(a, st):
    w, d = a["w"], a["d"]
    box((w, 0.25, 1.4), (0, 0, 0.7), st["wall"], bevel=0.04)
    for k in range(9):
        ball(0.12 + 0.08 * (k % 3), (-w * 0.4 + k * w * 0.1, -0.15, 0.3 + (k * 37 % 10) / 10 * 1.0), GLASSY)
    sign_board(st, a["sign"], w, 0.25, 1.6, 0.2)


def station(a, st):
    w, d = a["w"], a["d"]
    if "sky" in a["tags"]:
        cyl(0.18, 2.2, (0, 0, 1.1), STEEL, verts=10)
        box((1.2, 1.2, 0.15), (0, 0, 0.6), st["trim"])
        cyl(0.4, 0.08, (0, 0, 2.25), DARK, verts=24, rot=(math.radians(90), 0, 0))
        box((0.35, 0.3, 0.3), (0.5, 0, 1.7), solid((0.95, 0.78, 0.15)), bevel=0.04)
        return
    box((w, d, 0.3), (0, 0, 0.15), st["trim"])
    for x in (-w / 2 + 0.15, w / 2 - 0.15):
        for y in (-d / 2 + 0.12, d / 2 - 0.12):
            cyl(0.05, 0.9, (x, y, 0.75), STEEL, verts=8)
    gable(w, d, 1.2, 0.35, st["roof"])
    box((0.8, 0.2, 0.06), (0, -d / 2 + 0.3, 0.55), mat("wood_b", (0.5, 0.33, 0.18), kind="wood", color2=(0.38, 0.24, 0.12), scale=3))
    sign_board(st, "PRAIRIE LINE", w, d, 1.15, 0.16)


def gate(a, st):
    for x in (-0.7, 0.7):
        box((0.35, 0.35, 1.6), (x, 0, 0.8), st["wall"], bevel=0.03)
        ball(0.15, (x, 0, 1.75), st["trim"])
    box((1.9, 0.3, 0.35), (0, 0, 1.45), st["trim"], bevel=0.02)
    text("FUNTIER LANDS", (0, -0.17, 1.45), 0.16, solid((0.6, 0.12, 0.1)))
    for x in (-0.25, 0.25):
        cyl(0.07, 0.8, (x, -0.1, 0.4), STEEL, verts=10)


def relations(a, st):
    w, d = a["w"], a["d"]
    building(a, st, h_wall=0.95, sign=True)
    box((w * 0.5, 0.04, 0.35), (-w * 0.1, -d / 2 - 0.02, 0.65), DARK)
    ball(0.18, (w * 0.3, -d / 2 - 0.05, 1.35), solid((0.2, 0.45, 0.85)))
    text("?", (w * 0.3, -d / 2 - 0.24, 1.35), 0.22, WHITE)


def storefront(a, st):
    w, d, h = a["w"], a["d"], a["h"]
    import random
    rnd = random.Random(a["id"])
    wall = mat("front_" + a["color"], hexc(a["color"]), kind="brick", color2=tuple(v * 0.85 for v in hexc(a["color"])), scale=3, tex="brick")
    box((w, d, h), (0, 0, h / 2), wall, bevel=0.02)
    box((w + 0.06, d + 0.06, 0.1), (0, 0, h), CREAM)
    box((w * 0.3, d + 0.02, h * 0.18), (0, 0, h + 0.09), wall)  # false front
    awn_cols = [(0.12, 0.35, 0.22), (0.6, 0.12, 0.1), (0.15, 0.25, 0.5), (0.85, 0.65, 0.15)]
    c = awn_cols[rnd.randrange(4)]
    box((0.03, d * 0.75, 0.38), (w / 2 + 0.01, 0, 0.32), GLASS)
    box((0.42, d * 0.8, 0.04), (w / 2 + 0.2, 0, 0.7), mat("awn" + str(c), c, kind="stripes", color2=(0.95, 0.93, 0.88), scale=8, grime=0.1), rot=(0, math.radians(18), 0))
    for k in range(2):
        box((0.03, d * 0.25, 0.22), (w / 2 + 0.01, -d * 0.25 + k * d * 0.5, h * 0.75), GLASS)


def prop(a, st):
    w, d = a["w"], a["d"]
    c = solid(hexc(a["color"]), rough=0.35)
    if w < 0.5:  # turnstile
        cyl(0.08, 0.8, (0, 0, 0.4), STEEL, verts=10)
        box((0.4, 0.03, 0.03), (0, 0, 0.7), STEEL)
        return
    if d > 1.3:  # car
        box((w, d, 0.32), (0, 0, 0.3), c, bevel=0.08)
        box((w * 0.85, d * 0.5, 0.25), (0, 0.05, 0.58), GLASS, bevel=0.06)
        for x in (-w / 2, w / 2):
            for y in (-d * 0.32, d * 0.32):
                cyl(0.13, 0.08, (x, y, 0.13), DARK, verts=12, rot=(0, math.radians(90), 0))
        return
    # golf cart
    box((w, d, 0.25), (0, 0, 0.3), WHITE, bevel=0.05)
    for y in (-d * 0.3, d * 0.3):
        cyl(0.02, 0.5, (w / 2 - 0.05, y, 0.65), STEEL, verts=6)
    box((w * 1.05, d * 0.9, 0.04), (0, 0, 0.92), WHITE)


def backstage(a, st):
    w, d, h = a["w"], a["d"], a["h"]
    m = mat("warehouse", (0.6, 0.62, 0.62), kind="tin", color2=(0.52, 0.54, 0.54), scale=10, metal=0.3, tex="tin")
    box((w, d, h), (0, 0, h / 2), m)
    box((w * 0.4, 0.04, h * 0.6), (-w * 0.15, -d / 2 - 0.01, h * 0.3), solid((0.4, 0.42, 0.44)))
    box((0.3, 0.04, 0.55), (w * 0.3, -d / 2 - 0.01, 0.28), DARK)
    box((w + 0.1, d + 0.1, 0.08), (0, 0, h + 0.04), solid((0.35, 0.36, 0.37)))
    if a.get("sign"):
        box((w * 0.8, 0.04, 0.2), (0, -d / 2 - 0.03, h * 0.82), solid((0.95, 0.85, 0.2)))
        text(a["sign"], (0, -d / 2 - 0.06, h * 0.82), 0.12, DARK, max_w=w * 0.75)


def landmark(a, st):
    icon, h = a["name"], a["h"]
    if icon == "🕰️":  # Depot Street clock tower
        b = mat("brick_red", (0.62, 0.27, 0.2), kind="brick", color2=(0.52, 0.22, 0.17), scale=3, tex="brick")
        box((0.8, 0.8, h), (0, 0, h / 2), b, bevel=0.02)
        box((0.95, 0.95, 0.15), (0, 0, h), CREAM)
        for face, loc in (("-y", (0, -0.42, h - 0.45)), ("+x", (0.42, 0, h - 0.45))):
            cyl(0.28, 0.04, loc, WHITE, verts=24, rot=(math.radians(90), 0, 0) if face == "-y" else (0, math.radians(90), 0))
        cone(0.62, 0.02, 0.8, (0, 0, h + 0.47), solid((0.2, 0.35, 0.25)), verts=4, rot=(0, 0, math.radians(45)))
    elif icon == "⛲":  # the broken fountain
        cyl(0.9, 0.3, (0, 0, 0.15), CREAM, verts=32)
        cyl(0.78, 0.05, (0, 0, 0.3), solid((0.35, 0.5, 0.45)), verts=32)  # stagnant water
        cyl(0.18, 0.9, (0, 0, 0.6), CREAM, verts=12)
        cyl(0.4, 0.12, (0, 0, 1.05), CREAM, verts=16)
    elif icon == "🗼":  # the 14-foot Eiffel Tower
        for k in range(4):
            t = math.radians(45 + k * 90)
            cyl(0.06, h * 0.55, (math.cos(t) * 0.32, math.sin(t) * 0.32, h * 0.25), STEEL, verts=6,
                rot=(math.sin(t) * 0.35, -math.cos(t) * 0.35, 0))
        box((0.55, 0.55, 0.06), (0, 0, h * 0.5), STEEL)
        cyl(0.1, h * 0.5, (0, 0, h * 0.75), STEEL, verts=6, r2=0.02)
    elif icon == "🦖":
        g = solid((0.2, 0.55, 0.25))
        box((0.9, 0.5, 0.7), (0, 0, 1.0), g, bevel=0.15)
        box((0.6, 0.45, 0.45), (0.45, 0, 1.7), g, bevel=0.12)
        for x in (-0.25, 0.25):
            cyl(0.12, 0.7, (x, 0, 0.35), g, verts=10)
        cone(0.2, 0.02, 0.9, (-0.7, 0, 0.8), g, verts=8, rot=(0, math.radians(-70), 0))
        for k in range(4):
            cone(0.04, 0.0, 0.12, (0.6 + k * 0.08, -0.23, 1.55), WHITE, verts=5, rot=(math.radians(180), 0, 0))
    elif icon == "🚀":
        r = solid((0.92, 0.93, 0.9), rough=0.2)
        cyl(0.35, h * 0.7, (0, 0, h * 0.35 + 0.3), r, verts=24)
        cone(0.35, 0.0, h * 0.3, (0, 0, h * 0.85 + 0.3), solid((0.85, 0.15, 0.12)), verts=24)
        for k in range(3):
            t = k / 3 * math.pi * 2
            box((0.5, 0.06, 0.6), (math.cos(t) * 0.4, math.sin(t) * 0.4, 0.5), solid((0.85, 0.15, 0.12)), rot=(0, 0, t))
        cyl(0.12, 0.05, (0, -0.35, h * 0.6), GLASS, verts=16, rot=(math.radians(90), 0, 0))
    elif icon == "🏙️":
        cyl(0.4, h, (0, 0, h / 2), GLASSY, verts=6, r2=0.15)
        for k in range(3):
            cyl(0.5 - k * 0.08, 0.06, (0, 0, h * (0.3 + k * 0.22)), solid((0.96, 0.97, 0.98), rough=0.15), verts=24)
        ball(0.18, (0, 0, h + 0.1), solid((0.35, 0.75, 0.95), rough=0.05))
    elif icon == "🪩":
        cyl(0.07, h, (0, 0, h / 2), STEEL, verts=8)
        ball(0.7, (0, 0, h + 0.5), solid((0.85, 0.85, 0.9), rough=0.05, metal=1.0, grime=0.0))
    elif icon == "⚓":  # lighthouse
        cyl(0.4, h, (0, 0, h / 2), mat("lh", (0.92, 0.9, 0.88), kind="stripes", color2=(0.8, 0.15, 0.12), scale=1.2, grime=0.1), verts=16, r2=0.28)
        cyl(0.32, 0.4, (0, 0, h + 0.2), GLASSY, verts=12)
        cone(0.36, 0.02, 0.35, (0, 0, h + 0.57), solid((0.8, 0.15, 0.12)), verts=12)
    else:  # island buoy / anything else
        cyl(0.5, 0.3, (0, 0, 0.15), solid((0.85, 0.75, 0.5)), verts=16)
        cyl(0.12, h, (0, 0, h / 2), solid((0.85, 0.2, 0.15)), verts=12)


BUILDERS = {
    "ride": ride, "food": food, "restroom": restroom, "shop": shop, "show": show, "game": game, "photo": photo,
    "station": station, "gate": gate, "relations": relations, "storefront": storefront, "prop": prop,
    "backstage": backstage, "landmark": landmark,
}


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(ROOT, "art", "assets.json"), encoding="utf-8") as f:
        assets = json.load(f)["assets"]
    path = os.path.join(OUT, "manifest.json")
    if os.path.exists(path):
        try:
            with open(path) as f:
                manifest["sprites"] = json.load(f).get("sprites", {})
        except Exception:
            pass
    setup_scene()
    for a in assets:
        if ARGS and a["id"] not in ARGS:
            continue
        clear()
        BUILDERS.get(a["kind"], lambda a, st: building(a, st))(a, style(a["zone"]))
        render(a["id"], canvas_for(a))
        with open(path, "w") as f:
            json.dump(manifest, f, indent=1)


main()
