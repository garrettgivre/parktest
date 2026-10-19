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
    tall = max(a["h"], RIDE_TALL.get(a["id"], 0), 1.0) * 78 * 1.6
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
# World size (tiles) one copy of each texture covers, so bricks, logs and boards come out real-sized.
TEX_SIZE = {"brick": 2.2, "stucco": 3.0, "roof_tile": 2.4, "wood": 2.0, "tin": 2.0, "stone": 2.6,
            "concrete": 3.6, "clapboard": 2.4, "shingle": 2.2, "logs": 3.0, "canvas": 2.6}


def lin(c):
    return (*(v ** 2.2 for v in c), 1)


def hexc(s):
    s = s.lstrip("#")
    return tuple(int(s[k:k + 2], 16) / 255 for k in (0, 2, 4))


def mat(name, color, rough=0.75, kind=None, color2=None, scale=4.0, metal=0.0, emit=0.0,
        grime=0.25, tex=None, tex_size=None, glass=0.0, tint=0.18, rot=0.0, uv=False):
    """Matte material. If art/textures/<tex>.png exists it is used (tinted by color)."""
    key = (name, tuple(color), kind, tex, rot, uv)
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
        mp.inputs["Scale"].default_value = (1 / (tex_size or TEX_SIZE.get(tex, 2.0)),) * 3
        mp.inputs["Rotation"].default_value = (0, 0, math.radians(rot))  # e.g. tin ribs run down the slope
        # Roofs carry real UVs (laid out in world units along the slope); walls use box projection.
        link(nt.nodes["Texture Coordinate"].outputs["UV"] if uv else coord, mp.inputs["Vector"])
        it = nt.nodes.new("ShaderNodeTexImage")
        it.image = bpy.data.images.load(tex_path, check_existing=True)
        it.projection = "FLAT" if uv else "BOX"
        it.projection_blend = 0.2
        link(mp.outputs["Vector"], it.inputs["Vector"])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = tint  # nudge toward the zone colour, keep the texture's own
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
    if tex_path and os.path.exists(tex_path):
        grime *= 0.4
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


def beam(p0, p1, r, material, verts=8):
    """A cylinder from point p0 to point p1."""
    p0, p1 = Vector(p0), Vector(p1)
    mid, vec = (p0 + p1) / 2, p1 - p0
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=vec.length, location=mid)
    o = bpy.context.active_object
    o.rotation_euler = vec.to_track_quat("Z", "Y").to_euler()
    o.data.materials.append(material)
    return o


def gable(w, d, z, rise, material, overhang=0.12):
    """A pitched roof running along x."""
    import bmesh
    mesh = bpy.data.meshes.new("gable")
    bm = bmesh.new()
    hw, hd = w / 2 + overhang, d / 2 + overhang
    v = [bm.verts.new(p) for p in [(-hw, -hd, z), (hw, -hd, z), (hw, hd, z), (-hw, hd, z), (-hw, 0, z + rise), (hw, 0, z + rise)]]
    faces = [bm.faces.new([v[k] for k in f]) for f in [(0, 1, 5, 4), (3, 4, 5, 2), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]]
    uvl = bm.loops.layers.uv.new()
    slope = math.hypot(hd, rise)
    for k, f in enumerate(faces):
        for loop in f.loops:
            x, y, zz = loop.vert.co
            if k < 2:  # the two slopes: v runs from the eave (0) up to the ridge
                loop[uvl].uv = (x, slope * (1 - abs(y) / hd))
            else:
                loop[uvl].uv = (y, zz)
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
                         trim=solid((0.3, 0.2, 0.12)), roof=mat("tinroof", (0.55, 0.57, 0.58), kind="tin", color2=(0.45, 0.46, 0.47), scale=14, metal=0.4, tex="tin", uv=True),
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
                       trim=WHITE, roof=mat("shingle", (0.32, 0.3, 0.32), kind="tin", color2=(0.26, 0.25, 0.27), scale=12, tex="shingle", uv=True),
                       accent=solid((0.9, 0.3, 0.2)), roof_type="gable", sign=(WHITE, solid((0.1, 0.3, 0.5)))),
        "ozark": dict(wall=mat("logs", (0.5, 0.33, 0.18), kind="planks", color2=(0.4, 0.26, 0.14), scale=5, tex="logs"),
                      trim=solid((0.2, 0.35, 0.2)), roof=mat("greentin", (0.22, 0.4, 0.24), kind="tin", color2=(0.18, 0.33, 0.2), scale=14, metal=0.3, tex="tin", uv=True, tint=0.55),
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
    if rid in RIDES:
        return RIDES[rid](a, st)
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
        for x in (-w * 0.38, w * 0.08):  # entrance gate: two posts and a header
            box((0.12, 0.12, 1.0), (x, -d / 2 - 0.3, 0.5), st["trim"], bevel=0.02)
        box((w * 0.6, 0.16, 0.18), (-w * 0.15, -d / 2 - 0.3, 1.04), st["trim"], bevel=0.02)
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
    # A short stretch of track through the station with the train parked in it.
    for y in (-0.12, 0.12):
        box((w + 0.8, 0.04, 0.04), (0, y, plat_h + 0.04), STEEL)
    car = st["accent"] if st["accent"] not in (BULB,) else solid((0.85, 0.15, 0.12))
    for k in range(3):
        x = -w * 0.3 + k * w * 0.3
        box((w * 0.26, 0.42, 0.22), (x, 0, plat_h + 0.18), car, bevel=0.05)
        box((w * 0.2, 0.34, 0.06), (x, 0, plat_h + 0.32), DARK)
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
    wall = mat("front_" + a["color"], hexc(a["color"]), kind="brick", color2=tuple(v * 0.85 for v in hexc(a["color"])), scale=3, tex="brick", tint=0.45)
    box((w, d, h), (0, 0, h / 2), wall, bevel=0.02)
    box((w + 0.06, d + 0.06, 0.1), (0, 0, h), CREAM)
    box((w * 0.3, d + 0.02, h * 0.18), (0, 0, h + 0.09), wall)  # false front
    awn_cols = [(0.12, 0.35, 0.22), (0.6, 0.12, 0.1), (0.15, 0.25, 0.5), (0.85, 0.65, 0.15)]
    c = awn_cols[rnd.randrange(4)]
    awn = mat("awn" + str(c), c, kind="stripes", color2=(0.95, 0.93, 0.88), scale=8, grime=0.1)
    if "right" in a["tags"]:  # right side of the street: shopfront faces the street on the -y face
        box((w * 0.75, 0.03, 0.38), (0, -d / 2 - 0.01, 0.32), GLASS)
        box((w * 0.8, 0.42, 0.04), (0, -d / 2 - 0.2, 0.7), awn, rot=(math.radians(-18), 0, 0))
        for k in range(2):
            box((w * 0.25, 0.03, 0.22), (-w * 0.25 + k * w * 0.5, -d / 2 - 0.01, h * 0.75), GLASS)
    else:  # left side: shopfront on the +x face
        box((0.03, d * 0.75, 0.38), (w / 2 + 0.01, 0, 0.32), GLASS)
        box((0.42, d * 0.8, 0.04), (w / 2 + 0.2, 0, 0.7), awn, rot=(0, math.radians(18), 0))
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
    elif icon == "🗼":  # the 14-foot Eiffel Tower (it's 14 feet)
        iron = solid((0.42, 0.36, 0.3), rough=0.5, metal=0.6)
        levels = [(0.0, 0.62), (h * 0.32, 0.36), (h * 0.62, 0.16), (h * 0.9, 0.05)]
        for (z0, r0), (z1, r1) in zip(levels, levels[1:]):
            for k in range(4):
                t = math.radians(45 + k * 90)
                beam((math.cos(t) * r0, math.sin(t) * r0, z0), (math.cos(t) * r1, math.sin(t) * r1, z1), 0.04, iron, 6)
                t2 = math.radians(45 + (k + 1) * 90)
                beam((math.cos(t) * r0, math.sin(t) * r0, z0), (math.cos(t2) * r1, math.sin(t2) * r1, z1), 0.015, iron, 4)
            box((r1 * 1.9, r1 * 1.9, 0.05), (0, 0, z1), iron)
        beam((0, 0, h * 0.9), (0, 0, h * 1.12), 0.025, iron, 6)
        box((0.5, 0.04, 0.16), (0, -0.66, 0.35), solid((0.95, 0.92, 0.85)))
        text("14 FT", (0, -0.69, 0.35), 0.1, solid((0.3, 0.2, 0.15)))
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


# ------------------------------------------------------------------ ride kit
# Every ride gets its own model so it reads as what it is at a glance. The front of a
# sprite is -y and +x (the faces the camera sees). Spinning vehicles on flat rides are
# drawn by the game on top (see SPIN in main.ts), so those models leave them out.

def torus(R, r, loc, material, rot=(0, 0, 0), seg=32):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg, minor_segments=8, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return o


def striped(o, m2):
    """Alternate a second material across the object's faces (radial stripes on cones)."""
    o.data.materials.append(m2)
    for k, p in enumerate(o.data.polygons):
        p.material_index = k % 2
    return o


def ring(n, r, fn, phase=0.0):
    for k in range(n):
        t = phase + k / n * math.pi * 2
        fn(k, t, math.cos(t) * r, math.sin(t) * r)


def gambrel(w, d, z, material, overhang=0.1):
    """A barn roof: two slopes each side, steep then shallow, running along y."""
    import bmesh
    mesh = bpy.data.meshes.new("gambrel")
    bm = bmesh.new()
    hw, hd = w / 2 + overhang, d / 2 + overhang
    prof = [(-hw, z), (-hw * 0.62, z + w * 0.38), (0, z + w * 0.56), (hw * 0.62, z + w * 0.38), (hw, z)]
    front = [bm.verts.new((x, -hd, zz)) for x, zz in prof]
    back = [bm.verts.new((x, hd, zz)) for x, zz in prof]
    for k in range(4):
        bm.faces.new([front[k], front[k + 1], back[k + 1], back[k]])
    bm.faces.new(front[::-1])
    bm.faces.new(back)
    bm.to_mesh(mesh)
    o = bpy.data.objects.new("gambrel", mesh)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(material)
    return o


def ride_color(a, k=1.0):
    c = hexc(a["color"])
    return solid(tuple(min(1, v * k) for v in c))


def platform(r, h, material, edge=None, verts=32):
    cyl(r, h, (0, 0, h / 2), edge or material, verts=verts)
    cyl(r * 0.93, 0.03, (0, 0, h + 0.015), material, verts=verts)


def queue_rails(w, d, rows=3, y0=None):
    y0 = -d / 2 - 0.2 if y0 is None else y0
    for k in range(rows):
        box((w * 0.75, 0.025, 0.025), (0, y0 - k * 0.2, 0.42), STEEL)
        for x in (-w * 0.37, w * 0.37):
            cyl(0.02, 0.42, (x, y0 - k * 0.2, 0.21), STEEL, verts=6)


def ride_sign(a, st, x, y, z, size=0.18, w=None):
    bg, fg = st["sign"]
    w = w or min(a["w"] * 0.8, 2.4)
    box((w, 0.06, size * 1.7), (x, y, z), bg, bevel=0.01)
    text(a["sign"], (x, y - 0.04, z), size, fg, max_w=w * 0.92)
    for dx in (-w * 0.4, w * 0.4):
        cyl(0.03, z, (x + dx, y + 0.03, z / 2), STEEL, verts=6)


def coaster_station(a, st, roof_fn=None, car_fn=None, n_cars=3):
    """A loading station: platform, posts, a roof, the train parked in it, a queue out front."""
    w, d = a["w"], a["d"]
    ph = 0.3
    box((w, d * 0.8, ph), (0, d * 0.1, ph / 2), st["trim"])
    for x in (-w / 2 + 0.12, w / 2 - 0.12):
        for y in (-d * 0.3 + 0.1, d / 2 - 0.1):
            cyl(0.045, 0.85, (x, y, ph + 0.42), STEEL, verts=8)
    (roof_fn or (lambda: roof(st, w, d * 0.8, ph + 0.85)))()
    for y in (-0.13, 0.13):  # rails through the station
        box((w + 1.0, 0.035, 0.035), (0, d * 0.1 + y, ph + 0.05), STEEL)
    for k in range(n_cars):
        x = -w * 0.32 + k * w * 0.32
        (car_fn or default_car(st))(k, x, d * 0.1, ph + 0.08)
    queue_rails(w, d, rows=2, y0=-d * 0.32)
    return ph


def default_car(st):
    col = st["accent"] if st["accent"] not in (BULB,) else solid((0.85, 0.15, 0.12))

    def car(k, x, y, z):
        box((0.5, 0.42, 0.2), (x, y, z + 0.1), col, bevel=0.05)
        box((0.36, 0.32, 0.06), (x, y, z + 0.2), DARK)
        box((0.05, 0.3, 0.12), (x - 0.12, y, z + 0.27), BLACK)  # lap bar
    return car


# ---- flat rides

def r_carousel(a, st):
    w, d = a["w"], a["d"]
    r = min(w, d) / 2
    gold = solid((0.95, 0.75, 0.25), rough=0.35, metal=0.5)
    red, cream = solid((0.8, 0.12, 0.12)), solid((0.97, 0.93, 0.82))
    cyl(r, 0.12, (0, 0, 0.06), solid((0.55, 0.3, 0.2)), verts=32)  # step
    cyl(r * 0.95, 0.1, (0, 0, 0.17), solid((0.62, 0.4, 0.22)), verts=32)  # turntable floor
    striped(cyl(r * 0.26, 1.0, (0, 0, 0.7), cream, verts=12), gold)  # mirrored centre drum
    z_top = 1.2
    striped(cone(r * 1.04, 0.12, 0.5, (0, 0, z_top + 0.25), red, verts=24), cream)  # striped canopy
    ring(24, r * 1.0, lambda k, t, x, y: ball(0.065, (x, y, z_top - 0.02), red if k % 2 else cream, scale=(1, 1, 1.3)))  # scallops
    ring(12, r * 1.02, lambda k, t, x, y: ball(0.035, (x, y, z_top + 0.06), BULB))
    cyl(0.16, 0.2, (0, 0, z_top + 0.58), gold, verts=12)  # crown
    ball(0.09, (0, 0, z_top + 0.74), gold)
    cyl(0.012, 0.3, (0, 0, z_top + 0.9), STEEL, verts=6)
    box((0.18, 0.01, 0.1), (0.09, 0, z_top + 1.0), solid((0.2, 0.4, 0.8)))
    coats = [WHITE, solid((0.35, 0.22, 0.12)), solid((0.15, 0.13, 0.12)), solid((0.85, 0.7, 0.45))]

    def horse(k, t, x, y, z):
        rot = (0, 0, t + math.pi / 2)  # facing round the ride
        cyl(0.018, z_top - 0.2, (x, y, 0.2 + (z_top - 0.2) / 2), gold, verts=6)
        c = coats[k % 4]
        fx, fy = -math.sin(t), math.cos(t)  # forward
        box((0.08, 0.24, 0.1), (x, y, z), c, bevel=0.03, rot=rot)  # body
        box((0.06, 0.08, 0.14), (x + fx * 0.13, y + fy * 0.13, z + 0.1), c, bevel=0.02, rot=rot)  # neck
        box((0.06, 0.12, 0.06), (x + fx * 0.18, y + fy * 0.18, z + 0.17), c, bevel=0.02, rot=rot)  # head
        for s in (-1, 1):  # legs, mid-gallop
            beam((x + fx * 0.08 * s, y + fy * 0.08 * s, z - 0.03), (x + fx * 0.14 * s, y + fy * 0.14 * s, z - 0.16), 0.014, c)
        box((0.07, 0.07, 0.02), (x, y, z + 0.06), red, rot=rot)  # saddle
    ring(10, r * 0.74, lambda k, t, x, y: horse(k, t, x, y, 0.48 + 0.08 * math.sin(k * 2.1)))
    ring(7, r * 0.5, lambda k, t, x, y: horse(k + 1, t, x, y, 0.52 + 0.08 * math.cos(k * 1.7)), phase=0.4)


def r_teacups(a, st):
    w, d = a["w"], a["d"]
    r = min(w, d) / 2
    pink, mint = solid((0.95, 0.45, 0.62)), solid((0.35, 0.8, 0.7))
    striped(cyl(r, 0.14, (0, 0, 0.07), pink, verts=24), mint)
    striped(cyl(r * 0.9, 0.03, (0, 0, 0.155), solid((0.98, 0.85, 0.9)), verts=16), mint)  # pinwheel floor
    gold = solid((0.95, 0.75, 0.25), rough=0.35, metal=0.5)
    ring(16, r * 0.98, lambda k, t, x, y: cyl(0.025, 0.36, (x, y, 0.3), gold, verts=6))  # fence posts
    torus(r * 0.98, 0.022, (0, 0, 0.47), gold)
    ring(4, r * 0.98, lambda k, t, x, y: (cyl(0.02, 0.9, (x, y, 0.45), gold, verts=6), ball(0.07, (x, y, 0.95), BULB)), phase=math.pi / 4)  # lanterns
    # A giant teapot in the middle, which is the only reason anyone looks at this ride.
    china, blue = solid((0.98, 0.9, 0.95), rough=0.25), solid((0.85, 0.25, 0.5))
    cyl(0.2, 0.12, (0, 0, 0.2), blue, verts=16)
    ball(0.3, (0, 0, 0.5), china, scale=(1, 1, 0.82))
    torus(0.3, 0.02, (0, 0, 0.5), blue)
    cyl(0.12, 0.05, (0, 0, 0.75), blue, verts=16)
    ball(0.05, (0, 0, 0.81), china)
    beam((0.22, -0.12, 0.45), (0.42, -0.24, 0.66), 0.045, china)  # spout
    torus(0.11, 0.025, (-0.3, 0.16, 0.5), china, rot=(math.radians(90), 0, math.radians(-30)))  # handle


def r_satellite(a, st):
    w, d = a["w"], a["d"]
    r = min(w, d) / 2
    teal, orange = solid((0.2, 0.75, 0.72)), solid((0.98, 0.6, 0.15))
    platform(r, 0.14, solid((0.92, 0.93, 0.9)), edge=teal)
    cyl(0.1, 1.5, (0, 0, 0.85), WHITE, verts=12)
    ring(6, 0.1, lambda k, t, x, y: beam((x, y, 0.15), (x * 3, y * 3, 0.15), 0.025, orange))  # feet
    # Sputnik on top: a chrome ball with four antennae trailing back.
    ball(0.26, (0, 0, 1.7), CHROME)
    torus(0.27, 0.02, (0, 0, 1.7), orange)
    for k in range(4):
        t = math.radians(45 + k * 90)
        beam((math.cos(t) * 0.15, math.sin(t) * 0.15, 1.65), (math.cos(t) * 0.75, math.sin(t) * 0.75, 1.15), 0.012, STEEL)
    ring(6, 0.18, lambda k, t, x, y: beam((x * 0.6, y * 0.6, 1.5), (x * 4.5, y * 4.5, 1.08), 0.02, teal))  # sweep arms
    ring(8, r * 0.97, lambda k, t, x, y: cone(0.06, 0.0, 0.14, (x, y, 0.21), orange, verts=4))  # starbursts on the rim


def r_bubble(a, st):
    w, d = a["w"], a["d"]
    r = min(w, d) / 2
    sky = solid((0.35, 0.75, 0.95), rough=0.1)
    platform(r, 0.12, solid((0.95, 0.97, 0.98), rough=0.2), edge=sky)
    ball(0.42, (0, 0, 0.12), GLASSY, scale=(1, 1, 0.6))  # glass hub
    cyl(0.07, 1.3, (0, 0, 0.75), CHROME, verts=12)
    torus(0.32, 0.03, (0, 0, 1.38), neon((0.4, 0.85, 1.0)))
    ball(0.12, (0, 0, 1.45), CHROME)
    ring(6, 0.1, lambda k, t, x, y: beam((x, y, 1.35), (x * 7.5, y * 7.5, 0.95), 0.018, CHROME))


def r_swings(a, st):
    w, d = a["w"], a["d"]
    r = min(w, d) / 2
    navy, wht = solid((0.12, 0.3, 0.55)), solid((0.95, 0.95, 0.95))
    platform(r, 0.1, solid((0.85, 0.82, 0.7)), edge=navy)
    striped(cyl(0.12, 1.7, (0, 0, 0.95), navy, verts=12), wht)
    # The tilted top that throws you out over the lagoon (in theory).
    top = striped(cone(r * 0.9, 0.12, 0.35, (0, 0, 1.85), solid((0.18, 0.65, 0.65)), verts=16), wht)
    top.rotation_euler = (math.radians(8), math.radians(-5), 0)
    ring(16, r * 0.88, lambda k, t, x, y: ball(0.04, (x, y, 1.7 + 0.08 * math.sin(t)), BULB))
    ball(0.1, (0, 0, 2.08), solid((0.95, 0.75, 0.2), metal=0.5))
    for k in range(3):  # a sea creature finial, sort of
        beam((0, 0, 2.1), (math.cos(k * 2.1) * 0.15, math.sin(k * 2.1) * 0.15, 2.3), 0.02, solid((0.95, 0.75, 0.2), metal=0.5))


def r_inferno(a, st):
    w, d = a["w"], a["d"]
    r = min(w, d) / 2
    platform(r, 0.15, solid((0.15, 0.05, 0.2)), edge=solid((0.22, 0.08, 0.3)))
    # A light-up floor: rings of neon tiles.
    for k, c in enumerate([(1.0, 0.25, 0.75), (0.4, 0.9, 1.0), (1.0, 0.85, 0.2)]):
        torus(r * (0.35 + k * 0.22), 0.035, (0, 0, 0.17), neon(c))
    flame = neon((1.0, 0.4, 0.05))
    ring(10, r * 0.98, lambda k, t, x, y: cone(0.07, 0.0, 0.3 + 0.12 * (k % 2), (x, y, 0.3), flame, verts=6))
    cyl(0.08, 1.0, (0, 0, 0.65), CHROME, verts=12)
    ball(0.24, (0, 0, 1.25), solid((0.9, 0.9, 0.95), rough=0.05, metal=1.0))  # disco ball
    ring(8, 0.25, lambda k, t, x, y: ball(0.025, (x, y, 1.25), neon((1.0, 0.3, 0.8) if k % 2 else (0.4, 0.9, 1.0))))


def r_flipphone(a, st):
    w, d = a["w"], a["d"]
    r = min(w, d) / 2
    purple, silver = solid((0.55, 0.35, 0.75), rough=0.25), solid((0.82, 0.83, 0.88), rough=0.2, metal=0.7)
    platform(r, 0.12, solid((0.82, 0.8, 0.95), rough=0.15), edge=purple)
    # A giant flip phone, flipped open. The seats swing round its middle.
    box((0.5, 0.18, 1.0), (0, 0, 0.62), silver, bevel=0.06)  # keypad half
    for row in range(4):
        for col in range(3):
            box((0.1, 0.03, 0.08), (-0.13 + col * 0.13, -0.1, 0.4 + row * 0.15), WHITE, bevel=0.01)
    cyl(0.07, 0.52, (0, 0.02, 1.14), purple, verts=12, rot=(0, math.radians(90), 0))  # hinge
    lid = box((0.5, 0.16, 0.9), (0, 0.18, 1.55), purple, bevel=0.06, rot=(math.radians(-18), 0, 0))
    box((0.38, 0.03, 0.55), (0, 0.06, 1.6), neon((0.4, 0.95, 0.85)), rot=(math.radians(-18), 0, 0))  # screen
    cyl(0.025, 0.4, (0.2, 0.32, 2.05), BLACK, verts=6, rot=(math.radians(-18), 0, 0))  # antenna
    ball(0.05, (0.2, 0.38, 2.25), neon((1.0, 0.3, 0.3)))
    torus(0.35, 0.03, (0, 0, 1.15), CHROME)


# ---- towers and wheels

def drop_tower(a, st, cap_fn):
    w, d = a["w"], a["d"]
    H = a["h"] * 1.25
    cyl(0.62, 0.28, (0, 0, 0.14), st["trim"], verts=8)
    cyl(0.5, 0.06, (0, 0, 0.31), DARK, verts=8)
    s = 0.17
    for x, y in ((-s, -s), (s, -s), (s, s), (-s, s)):
        cyl(0.03, H, (x, y, 0.3 + H / 2), STEEL, verts=6)
    k, z = 0, 0.35
    while z < H:  # lattice bracing, alternating diagonals
        for (x0, y0), (x1, y1) in (((-s, -s), (s, -s)), ((s, -s), (s, s))):
            beam((x0, y0, z), (x1, y1, z + 0.32), 0.012, STEEL) if k % 2 else beam((x1, y1, z), (x0, y0, z + 0.32), 0.012, STEEL)
        z += 0.32
        k += 1
    cyl(0.3, 0.2, (0, 0, H + 0.4), st["accent"] if st["accent"] != BULB else STEEL, verts=12)
    ring(8, 0.31, lambda k, t, x, y: ball(0.03, (x, y, H + 0.4), BULB))
    cap_fn(H + 0.5)
    box((0.7, 0.4, 0.5), (0.55, -0.3, 0.25), st["wall"], bevel=0.02)  # operator booth
    box((0.5, 0.03, 0.2), (0.55, -0.51, 0.35), WINDOW)


def r_glitter(a, st):
    def cap(z):
        ball(0.32, (0, 0, z + 0.3), solid((0.9, 0.9, 0.95), rough=0.05, metal=1.0))
        ring(10, 0.33, lambda k, t, x, y: ball(0.03, (x, y, z + 0.3), neon((1.0, 0.3, 0.8) if k % 2 else (0.4, 0.9, 1.0))))
        cyl(0.01, 0.3, (0, 0, z + 0.05), STEEL, verts=4)
    drop_tower(a, st, cap)


def r_meteor(a, st):
    def cap(z):
        rock = mat("meteor", (0.25, 0.2, 0.18), kind="speckle", color2=(0.1, 0.08, 0.08), scale=8, tex="stone")
        ball(0.36, (0, 0, z + 0.3), rock, scale=(1.1, 0.95, 0.85))
        for k, (c, ln) in enumerate((((1.0, 0.25, 0.05), 0.75), ((1.0, 0.55, 0.08), 0.6), ((1.0, 0.85, 0.25), 0.45), ((1.0, 0.4, 0.05), 0.55))):
            t = k * 1.6
            cone(0.14, 0.0, ln, (math.cos(t) * 0.16 + 0.1, math.sin(t) * 0.16 + 0.1, z + 0.55 + ln / 2), neon(c), verts=8,
                 rot=(math.radians(-25), math.radians(25), 0))  # streaming back, it has been falling a while
    drop_tower(a, st, cap)


def r_wheel(a, st):
    """The Big Wheel's base: the game draws the wheel itself turning above this deck."""
    w, d = a["w"], a["d"]
    gold = solid((0.95, 0.72, 0.15))
    box((w * 0.9, d * 0.5, 0.35), (0, 0.15, 0.175), st["trim"])  # loading deck
    for k in range(3):  # stairs up the front
        box((0.7, 0.18, 0.12 * (k + 1)), (-0.35, -d * 0.1 - 0.18 * k, 0.06 * (k + 1)), solid((0.5, 0.42, 0.35)))
    for x in (-0.55, 0.55):  # the wheel's footings
        box((0.35, 0.35, 0.25), (x, 0.15, 0.48), solid((0.55, 0.57, 0.6)), bevel=0.02)
    # Ticket booth with a striped awning.
    box((0.55, 0.5, 0.7), (w * 0.3, -d * 0.25, 0.35), st["wall"], bevel=0.02)
    box((0.62, 0.3, 0.04), (w * 0.3, -d * 0.25 - 0.32, 0.72), st["roof"], rot=(math.radians(-20), 0, 0))
    box((0.3, 0.03, 0.2), (w * 0.3, -d * 0.25 - 0.26, 0.45), WINDOW)
    for k in range(9):  # bulbs along the deck edge
        ball(0.03, (-w * 0.42 + k * w * 0.105, -d * 0.1 + 0.01, 0.36), BULB)
    queue_rails(w, d, rows=2, y0=-d * 0.38)
    box((0.9, 0.05, 0.22), (-0.35, -d * 0.42, 0.75), gold, bevel=0.01)
    text(a["sign"], (-0.35, -d * 0.42 - 0.04, 0.75), 0.12, solid((0.45, 0.1, 0.1)), max_w=0.85)


def r_balloon(a, st):
    w, d = a["w"], a["d"]
    r = min(w, d) / 2
    platform(r, 0.14, solid((0.6, 0.75, 0.5)), edge=st["trim"])
    striped(cyl(0.1, 1.9, (0, 0, 1.05), solid((0.95, 0.85, 0.3)), verts=12), solid((0.2, 0.4, 0.6)))
    striped(cone(0.35, 0.05, 0.3, (0, 0, 2.1), st["accent"], verts=12), WHITE)
    cols = [(0.9, 0.2, 0.2), (0.95, 0.8, 0.15), (0.2, 0.55, 0.9), (0.3, 0.75, 0.35), (0.95, 0.5, 0.15), (0.6, 0.3, 0.75)]
    basket = solid((0.55, 0.38, 0.2))

    def balloon(k, t, x, y):
        z = 1.25 + 0.12 * math.sin(k * 2.3)
        beam((0, 0, 1.95), (x, y, z + 0.32), 0.015, STEEL)  # arm from the crown
        striped(ball(0.24, (x, y, z), solid(cols[k]), scale=(1, 1, 1.18)), WHITE)
        cone(0.12, 0.05, 0.12, (x, y, z - 0.3), solid(cols[k]), verts=12)
        for s in (-1, 1):
            beam((x + 0.05 * s, y, z - 0.33), (x + 0.06 * s, y, z - 0.5), 0.006, DARK)
        box((0.14, 0.14, 0.1), (x, y, z - 0.55), basket, bevel=0.015)
    ring(6, r * 0.72, balloon, phase=0.3)


# ---- buildings that are rides

def r_barn(a, st):
    w, d = a["w"], a["d"]
    red = mat("barnred", (0.6, 0.12, 0.08), kind="planks", color2=(0.48, 0.09, 0.06), scale=8, tex="wood", tint=0.75)
    trim = solid((0.92, 0.9, 0.82))
    hw = 1.0
    box((w * 0.8, d * 0.85, hw), (0, 0.05, hw / 2), red)
    gambrel(w * 0.8, d * 0.85 + 0.0, hw, solid((0.25, 0.22, 0.22)))
    bpy.context.active_object.location.y = 0.05
    # Big double doors, hung crooked, with the classic white X.
    for s, tilt in ((-1, 3), (1, -5)):
        x = s * 0.28
        box((0.52, 0.04, 0.78), (x, -d * 0.375 - 0.02, 0.39), red, rot=(0, math.radians(tilt), 0))
        for diag in (1, -1):
            box((0.62, 0.05, 0.05), (x, -d * 0.375 - 0.05, 0.39), trim, rot=(0, math.radians(52 * diag + tilt), 0))
    box((1.1, 0.05, 0.05), (0, -d * 0.375 - 0.05, 0.8), trim)
    # Hayloft door, open, with something glowing inside.
    box((0.36, 0.04, 0.32), (0, -d * 0.375 - 0.02, 1.25), BLACK)
    for x in (-0.07, 0.07):
        ball(0.025, (x, -d * 0.375 - 0.05, 1.28), neon((1.0, 0.85, 0.2)))
    box((0.04, 0.3, 0.04), (0, -d * 0.375 - 0.15, 1.55), solid((0.3, 0.2, 0.12)))  # hay hoist beam
    # Boarded-up side window.
    box((0.4, 0.03, 0.35), (w * 0.4 + 0.02, 0.2, 0.6), BLACK, rot=(0, 0, math.radians(90)))
    for k in range(2):
        box((0.03, 0.5, 0.06), (w * 0.4 + 0.04, 0.2, 0.55 + k * 0.12), solid((0.5, 0.38, 0.25)), rot=(math.radians(15 - 30 * k), 0, 0))
    hay, pump = solid((0.85, 0.72, 0.35)), solid((0.95, 0.45, 0.05))
    for k, (x, y) in enumerate(((-w * 0.42, -d * 0.48), (-w * 0.3, -d * 0.52), (w * 0.38, -d * 0.45))):
        box((0.3, 0.2, 0.2), (x, y, 0.1 + (0.2 if k == 1 else 0)), hay, bevel=0.03)
    for x in (-0.75, -0.6, 0.65, 0.78):
        ball(0.08, (x, -d * 0.55, 0.07), pump, scale=(1, 1, 0.8))
    cyl(0.015, 0.4, (0, 0.05, hw + w * 0.45 + 0.2), STEEL, verts=6)  # weathervane
    box((0.25, 0.01, 0.06), (0.05, 0.05, hw + w * 0.45 + 0.35), BLACK)
    ride_sign(a, st, -0.1, -d * 0.62, 0.9, size=0.12, w=1.0)


def r_worldboat(a, st):
    """A boat ride into a whimsical facade of every-country-at-once spires."""
    w, d = a["w"], a["d"]
    white, gold = solid((0.97, 0.95, 0.9)), solid((0.95, 0.78, 0.25), metal=0.4, rough=0.35)
    box((w * 0.9, d * 0.55, 1.0), (0, d * 0.18, 0.5), st["wall"])
    roof(st, w * 0.9, d * 0.55, 1.0)
    # The facade: a row of white towers, each topped differently, all gold.
    for k, x in enumerate((-w * 0.38, -w * 0.18, 0.0, w * 0.18, w * 0.38)):
        hgt = 1.3 + (0.5 if k == 2 else 0.2 * (k % 2))
        box((0.32, 0.3, hgt), (x, -d * 0.1, hgt / 2), white, bevel=0.02)
        top = k % 3
        if top == 0:
            cone(0.2, 0.0, 0.45, (x, -d * 0.1, hgt + 0.22), gold, verts=8)
        elif top == 1:
            ball(0.17, (x, -d * 0.1, hgt + 0.1), gold, scale=(1, 1, 1.25))
            cone(0.04, 0.0, 0.18, (x, -d * 0.1, hgt + 0.36), gold, verts=6)
        else:
            for s in range(3):
                box((0.34 - s * 0.08, 0.32 - s * 0.08, 0.06), (x, -d * 0.1, hgt + 0.04 + s * 0.12), gold)
    # A big clock face in the centre tower (it is always 11:59, the minute before the parade).
    cyl(0.16, 0.03, (0, -d * 0.1 - 0.16, 1.4), WHITE, verts=24, rot=(math.radians(90), 0, 0))
    torus(0.16, 0.02, (0, -d * 0.1 - 0.17, 1.4), gold, rot=(math.radians(90), 0, 0))
    box((0.015, 0.01, 0.12), (0, -d * 0.1 - 0.19, 1.45), BLACK)
    box((0.01, 0.01, 0.09), (-0.02, -d * 0.1 - 0.19, 1.43), BLACK, rot=(0, math.radians(-30), 0))
    # The flume: a channel out front, two boats queued at the tunnel.
    box((w * 0.95, 0.55, 0.12), (0, -d * 0.4, 0.06), solid((0.6, 0.62, 0.65)))
    box((w * 0.9, 0.45, 0.04), (0, -d * 0.4, 0.13), WATER)
    box((0.5, 0.06, 0.5), (0, -d * 0.1 - 0.16, 0.25), BLACK)  # tunnel mouth
    for k, x in enumerate((-w * 0.25, w * 0.15)):
        box((0.48, 0.3, 0.1), (x, -d * 0.4, 0.17), solid([(0.95, 0.75, 0.2), (0.3, 0.7, 0.85)][k]), bevel=0.04)
        box((0.36, 0.22, 0.03), (x, -d * 0.4, 0.22), DARK)
    ride_sign(a, st, w * 0.25, -d * 0.62, 0.55, size=0.1, w=0.9)


def r_lasertag(a, st):
    w, d = a["w"], a["d"]
    wall = solid((0.12, 0.1, 0.2))
    box((w, d, 1.0), (0, 0, 0.5), wall, bevel=0.02)
    box((w + 0.06, d + 0.06, 0.08), (0, 0, 1.0), solid((0.3, 0.3, 0.35)))
    for k, c in enumerate([(1.0, 0.3, 0.7), (0.2, 0.9, 0.9)]):  # neon bands
        box((w + 0.02, d + 0.02, 0.03), (0, 0, 0.3 + k * 0.12), neon(c))
    box((0.5, 0.04, 0.6), (-w * 0.2, -d / 2 - 0.01, 0.3), BLACK)  # door
    # A huge ray gun bolted to the roof, aimed at the food court.
    gun = solid((0.85, 0.85, 0.9), metal=0.8, rough=0.2)
    box((0.5, 0.25, 0.25), (0.1, 0, 1.3), gun, bevel=0.06)
    cyl(0.07, 0.6, (0.1, -0.45, 1.33), gun, verts=12, rot=(math.radians(90), 0, 0))
    for k in range(3):
        torus(0.1, 0.02, (0.1, -0.3 - k * 0.12, 1.33), neon((0.2, 0.9, 0.9)), rot=(math.radians(90), 0, 0))
    cone(0.09, 0.0, 0.15, (0.1, -0.82, 1.33), neon((1.0, 0.2, 0.3)), verts=10, rot=(math.radians(90), 0, 0))
    box((0.12, 0.15, 0.3), (0.1, 0.05, 1.05), gun)
    # Laser beams criss-crossing the front.
    red = neon((1.0, 0.15, 0.2))
    for p0, p1 in (((-w / 2, -d / 2 - 0.03, 0.85), (w * 0.2, -d / 2 - 0.03, 0.55)), ((w * 0.45, -d / 2 - 0.03, 0.9), (-w * 0.1, -d / 2 - 0.03, 0.6))):
        beam(p0, p1, 0.012, red)
    for p0, p1 in (((w / 2 + 0.03, -d / 2, 0.8), (w / 2 + 0.03, d / 2, 0.5)),):
        beam(p0, p1, 0.012, red)
    ride_sign(a, st, w * 0.25, -d / 2 - 0.25, 0.9, size=0.11, w=1.0)


def r_trex(a, st):
    w, d = a["w"], a["d"]
    rock = st["wall"]
    wood = solid((0.4, 0.27, 0.15))
    leaf = mat("jungle", (0.18, 0.45, 0.15), kind="speckle", color2=(0.3, 0.6, 0.2), scale=10)
    # A jungle mound with the expedition gate cut into it.
    for k, (x, y, s) in enumerate(((-0.8, 0.5, 0.75), (0.6, 0.6, 0.85), (0.0, 0.9, 0.7), (-1.1, -0.1, 0.5), (1.1, 0.0, 0.55))):
        ball(s, (x, y, 0.2), rock, scale=(1.1, 1, 0.75))
        ball(s * 0.7, (x + 0.1, y + 0.1, 0.25 + s * 0.6), leaf, scale=(1, 1, 0.7))
    for x in (-0.55, 0.55):  # great timber gate
        box((0.22, 0.22, 1.5), (x, -d * 0.3, 0.75), wood, bevel=0.03)
        cone(0.12, 0.0, 0.18, (x, -d * 0.3, 1.58), wood, verts=4)
        cyl(0.03, 0.15, (x, -d * 0.3 - 0.13, 1.25), STEEL, verts=6)
        cone(0.06, 0.0, 0.16, (x, -d * 0.3 - 0.13, 1.4), neon((1.0, 0.55, 0.1)), verts=6)  # torch
    box((1.4, 0.18, 0.25), (0, -d * 0.3, 1.35), wood, bevel=0.03)
    box((0.95, 0.04, 0.16), (0, -d * 0.3 - 0.1, 1.35), solid((0.95, 0.85, 0.4)))
    text(a["sign"], (0, -d * 0.3 - 0.13, 1.35), 0.11, solid((0.15, 0.25, 0.1)), max_w=0.9)
    box((0.85, 0.3, 1.0), (0, -d * 0.18, 0.5), BLACK)  # dark way in
    # The T-Rex, looming over the gate, mid-roar.
    skin = mat("trex", (0.22, 0.42, 0.2), kind="speckle", color2=(0.16, 0.32, 0.16), scale=14)
    belly = solid((0.7, 0.68, 0.45))
    bx, by, bz = 0.2, 0.25, 1.6
    ball(0.5, (bx, by, bz), skin, scale=(0.75, 1.3, 0.8))  # body, leaning forward
    ball(0.3, (bx, by - 0.25, bz - 0.1), belly, scale=(0.9, 1.0, 1.0))
    cone(0.28, 0.02, 1.3, (bx + 0.1, by + 1.0, bz - 0.15), skin, verts=12, rot=(math.radians(-80), 0, math.radians(-8)))  # tail
    for s in (-1, 1):  # legs
        ball(0.2, (bx + s * 0.28, by + 0.1, bz - 0.4), skin, scale=(0.8, 1.1, 1.2))
        box((0.12, 0.14, 0.55), (bx + s * 0.28, by + 0.12, bz - 0.85), skin, bevel=0.04)
        box((0.16, 0.26, 0.06), (bx + s * 0.28, by + 0.04, bz - 1.12), skin)
    hx, hy, hz = bx - 0.05, by - 0.75, bz + 0.45
    beam((bx, by - 0.45, bz + 0.15), (hx, hy + 0.2, hz - 0.05), 0.14, skin)  # neck
    box((0.34, 0.6, 0.22), (hx, hy, hz + 0.05), skin, bevel=0.06, rot=(math.radians(-12), 0, 0))  # skull
    box((0.28, 0.5, 0.08), (hx, hy - 0.05, hz - 0.15), skin, bevel=0.03, rot=(math.radians(18), 0, 0))  # dropped jaw
    box((0.28, 0.44, 0.08), (hx, hy - 0.05, hz - 0.06), solid((0.6, 0.12, 0.12)), rot=(math.radians(6), 0, 0))  # mouth
    for k in range(5):
        cone(0.025, 0.0, 0.07, (hx - 0.11 + (k % 2) * 0.22, hy - 0.25 + k * 0.08, hz - 0.03), WHITE, verts=4, rot=(math.radians(180), 0, 0))
    for s in (-1, 1):
        ball(0.04, (hx + s * 0.15, hy + 0.08, hz + 0.14), solid((0.95, 0.75, 0.1), emit=1.5))
        beam((bx + s * 0.25, by - 0.45, bz + 0.1), (bx + s * 0.28, by - 0.6, bz - 0.05), 0.03, skin)  # the tiny arms


def r_dig(a, st):
    w, d = a["w"], a["d"]
    sand = mat("digsand", (0.88, 0.76, 0.52), kind="speckle", color2=(0.78, 0.65, 0.42), scale=18)
    wood = solid((0.55, 0.38, 0.22))
    box((w, d, 0.08), (0, 0, 0.04), wood)
    box((w * 0.92, d * 0.92, 0.1), (0, 0, 0.06), sand)
    bone = solid((0.94, 0.9, 0.78), rough=0.6)
    # A half-dug skeleton: skull, spine, ribs poking out of the sand.
    ball(0.17, (-0.45, -0.2, 0.12), bone, scale=(1.3, 0.9, 0.8))
    box((0.18, 0.1, 0.05), (-0.62, -0.25, 0.08), bone, bevel=0.02)
    for k in range(7):
        ball(0.05, (-0.25 + k * 0.12, -0.12 + k * 0.03, 0.11), bone)
    for k in range(5):
        torus(0.14 - k * 0.012, 0.018, (-0.1 + k * 0.13, -0.08 + k * 0.03, 0.1), bone, rot=(0, math.radians(90), math.radians(15)), seg=16)
    for k in range(3):
        cyl(0.03, 0.35, (0.55 + k * 0.08, 0.35 - k * 0.12, 0.18), bone, verts=8, rot=(math.radians(70), 0, k))
    # Buckets, shovels, an umbrella, and a stern sign about socks.
    for k, c in enumerate([(0.9, 0.2, 0.2), (0.2, 0.5, 0.9), (0.95, 0.8, 0.15)]):
        cyl(0.07, 0.12, (0.65 - k * 0.2, -0.7 + k * 0.08, 0.17), solid(c), verts=12, r2=0.09)
        box((0.04, 0.02, 0.28), (0.3 + k * 0.4, 0.75 - k * 0.2, 0.2), solid(c), rot=(math.radians(25), 0, k))
    cyl(0.02, 0.9, (0.75, 0.6, 0.45), WHITE, verts=6)
    striped(cone(0.45, 0.02, 0.18, (0.75, 0.6, 0.95), solid((0.95, 0.5, 0.15)), verts=8), WHITE)
    ride_sign(a, st, -0.6, -d / 2 - 0.12, 0.45, size=0.09, w=0.7)


def r_foampit(a, st):
    w, d = a["w"], a["d"]
    box((w, d, 0.1), (0, 0, 0.05), st["wall"])
    cols = [(1.0, 0.3, 0.75), (0.4, 0.9, 1.0), (0.7, 0.5, 1.0), (1.0, 0.85, 0.3)]
    n = 5
    for ix in range(n):  # a light-up dance floor
        for iy in range(4):
            c = solid(cols[(ix + iy * 2) % 4], emit=1.2, grime=0)
            box((w * 0.8 / n - 0.03, d * 0.7 / 4 - 0.03, 0.02), (-w * 0.4 + (ix + 0.5) * w * 0.8 / n, -d * 0.35 + (iy + 0.5) * d * 0.7 / 4, 0.11), c)
    foam = solid((0.97, 0.97, 1.0), rough=0.9, grime=0)
    for k in range(14):  # drifts of foam
        x = math.sin(k * 2.4) * w * 0.33
        y = math.cos(k * 1.7) * d * 0.28
        ball(0.18 + 0.08 * (k % 3), (x, y, 0.12), foam, scale=(1.2, 1, 0.7))
    for s in (-1, 1):  # foam cannons on poles
        cyl(0.03, 0.9, (s * w * 0.46, d * 0.4, 0.45), STEEL, verts=6)
        cyl(0.08, 0.3, (s * w * 0.42, d * 0.32, 0.92), solid((0.45, 0.3, 0.8)), verts=10, rot=(math.radians(-60), math.radians(30 * s), 0))
    box((0.6, 0.35, 0.45), (0, d * 0.42, 0.22), DARK, bevel=0.02)  # DJ booth
    box((0.62, 0.37, 0.03), (0, d * 0.42, 0.46), neon((0.6, 0.5, 1.0)))
    for s in (-1, 1):
        box((0.2, 0.2, 0.4), (s * 0.45, d * 0.42, 0.3), BLACK, bevel=0.02)
    ride_sign(a, st, w * 0.3, -d / 2 - 0.12, 0.45, size=0.09, w=0.9)


# ---- coasters and water rides

def r_minetrain(a, st):
    w, d = a["w"], a["d"]
    rock = mat("minerock", (0.55, 0.4, 0.3), kind="speckle", color2=(0.42, 0.3, 0.22), scale=6, tex="stone", tint=0.4)
    for x, y, s in ((-0.6, 0.6, 0.8), (0.4, 0.75, 0.9), (1.0, 0.3, 0.55)):
        ball(s, (x, y, 0.1), rock, scale=(1.2, 1, 0.9))
    wood = solid((0.42, 0.28, 0.16))
    # Mine portal with a bone arch over it: two professors' worth of rib.
    for x in (-0.35, 0.35):
        box((0.12, 0.12, 0.8), (x, 0.0, 0.4), wood)
    box((0.9, 0.14, 0.12), (0, 0.0, 0.82), wood)
    box((0.58, 0.1, 0.7), (0, 0.06, 0.35), BLACK)
    bone = solid((0.94, 0.9, 0.78))
    torus(0.5, 0.04, (0, -0.05, 0.6), bone, rot=(math.radians(90), 0, 0), seg=24)
    ball(0.12, (0, -0.06, 1.12), bone, scale=(1.2, 1, 0.9))
    box((0.3, 0.3, 0.3), (0.85, -0.55, 0.15), solid((0.75, 0.15, 0.1)), bevel=0.02)  # TNT, unsecured
    text("TNT", (0.85, -0.71, 0.18), 0.1, WHITE)
    # The station deck and a mine train.
    box((w * 0.9, 0.55, 0.22), (0, -d * 0.3, 0.11), wood)
    for y in (-0.12, 0.12):
        box((w + 0.6, 0.035, 0.035), (0, -d * 0.3 + y, 0.24), STEEL)
    cart = solid((0.35, 0.3, 0.28), metal=0.5)
    for k in range(3):
        x = -w * 0.3 + k * w * 0.28
        box((0.45, 0.38, 0.22), (x, -d * 0.3, 0.38), cart, bevel=0.03)
        box((0.47, 0.4, 0.04), (x, -d * 0.3, 0.46), wood)
        box((0.36, 0.3, 0.04), (x, -d * 0.3, 0.49), DARK)
    cyl(0.02, 0.6, (-w * 0.45, -d * 0.48, 0.3), wood, verts=6)
    ball(0.05, (-w * 0.45, -d * 0.48, 0.62), BULB)  # lantern
    ride_sign(a, st, w * 0.2, -d * 0.55, 0.7, size=0.11, w=1.1)


def r_raptor(a, st):
    w, d = a["w"], a["d"]
    thatch = mat("thatch", (0.75, 0.6, 0.3), kind="speckle", color2=(0.6, 0.45, 0.2), scale=16)
    bamboo = solid((0.7, 0.62, 0.35))
    green = solid((0.25, 0.65, 0.3))

    def hut_roof():
        cone(w * 0.56, 0.05, 0.4, (0, d * 0.1, 0.3 + 0.85 + 0.18), thatch, verts=8)
        bpy.context.active_object.scale = (1, d * 0.8 / w * 1.15, 1)

    def raptor_car(k, x, y, z):
        box((0.45, 0.38, 0.18), (x, y, z + 0.09), green, bevel=0.05)
        box((0.32, 0.28, 0.05), (x, y, z + 0.18), DARK)
        if k == 0:  # the front car has a head
            box((0.2, 0.16, 0.14), (x - 0.32, y, z + 0.25), green, bevel=0.04)
            box((0.16, 0.12, 0.04), (x - 0.36, y, z + 0.17), solid((0.7, 0.15, 0.15)))
            for s in (-1, 1):
                ball(0.025, (x - 0.35, y + s * 0.08, z + 0.29), solid((1.0, 0.85, 0.1)))
    coaster_station(a, st, roof_fn=hut_roof, car_fn=raptor_car)
    for x in (-w / 2 + 0.12, w / 2 - 0.12):
        for y in (-d * 0.3 + 0.1, d / 2 - 0.1):
            cyl(0.05, 0.86, (x, y, 0.3 + 0.43), bamboo, verts=8)
    # "You must be this short to ride" sign.
    box((0.08, 0.03, 0.7), (w * 0.45, -d * 0.5, 0.35), solid((0.95, 0.85, 0.3)))
    box((0.2, 0.03, 0.06), (w * 0.45, -d * 0.5, 0.55), green)
    leaf = solid((0.2, 0.55, 0.2))
    for x in (-w * 0.48, w * 0.5):
        for k in range(5):
            t = k * 1.25
            beam((x, d * 0.35, 0.0), (x + math.cos(t) * 0.3, d * 0.35 + math.sin(t) * 0.3, 0.35), 0.03, leaf)


def r_rocket(a, st):
    w, d = a["w"], a["d"]
    red, wht = solid((0.8, 0.15, 0.12), rough=0.3), solid((0.95, 0.95, 0.92), rough=0.3)

    def rocket_car(k, x, y, z):
        box((0.5, 0.4, 0.2), (x, y, z + 0.1), red, bevel=0.07)
        box((0.36, 0.3, 0.05), (x, y, z + 0.2), DARK)
        if k == 0:
            cone(0.16, 0.0, 0.3, (x - 0.38, y, z + 0.12), wht, verts=12, rot=(0, math.radians(-90), 0))
        box((0.05, 0.45, 0.12), (x + 0.2, y, z + 0.18), wht)  # tail fins
    coaster_station(a, st, car_fn=rocket_car)
    # A Googie pylon out front: a leaning blade, a starburst, and the big "88".
    teal, gold = solid((0.2, 0.75, 0.72)), solid((0.98, 0.72, 0.15))
    px, py = w / 2 + 0.3, -d * 0.3
    box((0.12, 0.4, 2.2), (px, py, 1.1), wht, rot=(math.radians(-8), 0, 0))
    box((0.14, 0.3, 0.7), (px, py - 0.12, 1.5), red, rot=(math.radians(-8), 0, 0))
    text("88", (px + 0.08, py - 0.1, 1.5), 0.26, wht, face="+x")
    for k in range(8):  # starburst
        t = k * math.pi / 4
        beam((px, py - 0.25, 2.35), (px, py - 0.25 + math.cos(t) * 0.35, 2.35 + math.sin(t) * 0.35), 0.02, gold)
    ball(0.08, (px, py - 0.25, 2.35), gold)
    torus(0.25, 0.03, (px, py + 0.1, 0.9), teal, rot=(0, math.radians(90), 0))
    ride_sign(a, st, -w * 0.2, -d * 0.55, 0.75, size=0.13, w=1.1)


def r_aero(a, st):
    w, d = a["w"], a["d"]
    white = solid((0.96, 0.97, 0.98), rough=0.2)
    sky = solid((0.35, 0.75, 0.95), rough=0.1)

    def canopy():
        ball(w * 0.5, (0, d * 0.1, 1.15), white, scale=(1, 0.5, 0.12))
        ball(w * 0.36, (0, d * 0.1, 1.2), GLASSY, scale=(1, 0.5, 0.12))
        torus(w * 0.5, 0.035, (0, d * 0.1, 1.15), neon((0.35, 0.8, 1.0)))
        bpy.context.active_object.scale = (1, 0.5, 1)

    def pod(k, x, y, z):
        box((0.55, 0.4, 0.22), (x, y, z + 0.12), white, bevel=0.1)
        box((0.4, 0.32, 0.08), (x, y, z + 0.22), sky, bevel=0.03)
        box((0.56, 0.02, 0.03), (x, y - 0.21, z + 0.08), neon((0.3, 0.8, 1.0)))
    coaster_station(a, st, roof_fn=canopy, car_fn=pod)
    # Sponsor pylon and the FunPass kiosk nobody can get to work.
    box((0.25, 0.25, 1.6), (w * 0.44, -d * 0.4, 0.8), white, bevel=0.05)
    box((0.27, 0.27, 0.5), (w * 0.44, -d * 0.4, 1.35), solid((0.1, 0.25, 0.5)))
    text("BIG BANK", (w * 0.44, -d * 0.4 - 0.15, 1.35), 0.07, WHITE)
    box((0.22, 0.15, 0.55), (-w * 0.4, -d * 0.45, 0.27), white, bevel=0.03)
    box((0.16, 0.02, 0.2), (-w * 0.4, -d * 0.53, 0.42), neon((0.4, 0.9, 1.0)))
    ride_sign(a, st, 0, -d * 0.58, 0.55, size=0.11, w=1.2)


def r_leviathan(a, st):
    w, d = a["w"], a["d"]

    def boat(k, x, y, z):
        box((0.55, 0.42, 0.18), (x, y, z + 0.09), solid((0.15, 0.4, 0.6)), bevel=0.08)
        box((0.4, 0.32, 0.04), (x, y, z + 0.18), DARK)
    coaster_station(a, st, car_fn=boat)
    # The serpent: coils breaking the surface of its pool, then a head bigger than the station.
    px, py = w / 2 + 0.45, 0.2  # its pool runs along the station's open side
    box((0.95, d * 1.1, 0.1), (px, py, 0.05), solid((0.55, 0.55, 0.55)))
    box((0.87, d * 1.02, 0.04), (px, py, 0.11), WATER)
    scales = mat("serpent", (0.12, 0.5, 0.45), kind="speckle", color2=(0.08, 0.35, 0.35), scale=16)
    for k in range(3):
        torus(0.3 - k * 0.04, 0.1 - k * 0.015, (px, py + 0.9 - k * 0.5, 0.1), scales, rot=(math.radians(90), 0, math.radians(90)), seg=20)
    hx, hy = px, py - d * 0.45
    beam((hx, hy + 0.2, 0.1), (hx, hy, 0.9), 0.13, scales)
    box((0.3, 0.55, 0.26), (hx, hy - 0.2, 1.0), scales, bevel=0.08, rot=(math.radians(-10), 0, 0))
    box((0.24, 0.4, 0.07), (hx, hy - 0.3, 0.82), scales, bevel=0.03, rot=(math.radians(15), 0, 0))
    for s in (-1, 1):
        ball(0.045, (hx + s * 0.13, hy - 0.1, 1.12), solid((1.0, 0.9, 0.2), emit=2.0))
        cone(0.06, 0.0, 0.25, (hx + s * 0.1, hy + 0.05, 1.25), solid((0.9, 0.3, 0.25)), verts=4, rot=(math.radians(-30), 0, 0))
    for k in range(6):
        ball(0.06 + 0.03 * (k % 3), (px - 0.35 + (k % 2) * 0.7, py - 0.9 + k * 0.4, 0.14), solid((0.97, 0.98, 1.0), grime=0))  # splash
    ride_sign(a, st, w * 0.25, -d * 0.55, 0.75, size=0.13, w=1.1)


def r_riptide(a, st):
    w, d = a["w"], a["d"]
    trough = solid((0.85, 0.82, 0.75))
    wood = solid((0.5, 0.34, 0.2))
    # An oval flume around a little island, a lift ramp, and the big splash.
    box((w, d, 0.12), (0, 0, 0.06), trough)
    box((w * 0.92, d * 0.86, 0.06), (0, 0, 0.12), WATER)
    box((w * 0.55, d * 0.4, 0.2), (0, 0, 0.18), mat("isle", (0.35, 0.55, 0.25), kind="speckle", color2=(0.45, 0.65, 0.3), scale=10))
    L = 1.4
    ramp = box((L, 0.32, 0.06), (w * 0.12, d * 0.25, 0.5), trough, rot=(0, math.radians(-30), 0))
    box((L, 0.24, 0.02), (w * 0.12, d * 0.25, 0.54), WATER, rot=(0, math.radians(-30), 0))
    for k in range(3):
        x = w * 0.12 - 0.45 + k * 0.45
        hgt = 0.15 + (k * 0.45) * math.tan(math.radians(30)) + 0.2
        cyl(0.03, hgt, (x, d * 0.25, hgt / 2), wood, verts=6)
    box((0.5, 0.45, 0.06), (w * 0.12 + 0.75, d * 0.25, 0.86), wood)  # the top
    for k, x in enumerate((-w * 0.25, w * 0.2)):  # log boats
        cyl(0.13, 0.55, (x, -d * 0.32, 0.22), solid((0.45, 0.3, 0.18)), verts=12, rot=(0, math.radians(90), 0))
        box((0.35, 0.16, 0.05), (x, -d * 0.32, 0.33), DARK)
    for k in range(7):
        ball(0.06 + 0.04 * (k % 3), (-w * 0.3 + k * 0.08, d * 0.25 + 0.15 * math.sin(k), 0.2), solid((0.97, 0.98, 1.0), grime=0))
    ride_sign(a, st, w * 0.3, -d / 2 - 0.12, 0.45, size=0.1, w=0.9)


def r_cruise(a, st):
    w, d = a["w"], a["d"]
    # A cove, a dock, and the party pontoon that never quite leaves it.
    box((w, d, 0.06), (0, 0, 0.03), solid((0.45, 0.4, 0.3)))
    box((w * 0.94, d * 0.9, 0.04), (0, 0, 0.07), WATER)
    plank = st["wall"]
    box((w * 0.9, 0.35, 0.12), (0, -d * 0.4, 0.14), plank)
    for x in (-w * 0.4, 0, w * 0.4):
        cyl(0.04, 0.35, (x, -d * 0.23, 0.12), plank, verts=6)
    alu = solid((0.8, 0.82, 0.85), metal=0.8, rough=0.25)
    for y in (-0.22, 0.22):
        cyl(0.11, 1.6, (0, 0.1 + y, 0.12), alu, verts=12, rot=(0, math.radians(90), 0))
        cone(0.11, 0.0, 0.2, (0.9, 0.1 + y, 0.12), alu, verts=12, rot=(0, math.radians(90), 0))
    box((1.7, 0.7, 0.06), (0.05, 0.1, 0.27), solid((0.9, 0.88, 0.8)))
    for x, y in ((-0.7, -0.22), (0.7, -0.22), (-0.7, 0.42), (0.7, 0.42)):
        cyl(0.015, 0.5, (x, y, 0.55), alu, verts=6)
    striped(box((1.6, 0.75, 0.03), (0, 0.1, 0.81), solid((0.2, 0.6, 0.85))), WHITE)  # bimini top
    box((0.5, 0.3, 0.2), (-0.3, 0.2, 0.4), solid((0.85, 0.3, 0.2)), bevel=0.04)  # couch
    box((0.18, 0.18, 0.3), (0.45, 0.25, 0.45), BLACK, bevel=0.02)  # speaker, enormous
    ball(0.13, (0.15, -0.05, 0.45), solid((1.0, 0.45, 0.7)), scale=(1.4, 0.8, 0.8))  # inflatable flamingo
    beam((0.3, -0.05, 0.45), (0.38, -0.05, 0.75), 0.03, solid((1.0, 0.45, 0.7)))
    ball(0.05, (0.4, -0.05, 0.78), solid((1.0, 0.45, 0.7)))
    for k in range(7):  # party flags strung from the bimini
        box((0.08, 0.01, 0.1), (-0.75 + k * 0.25, -0.27, 0.74), solid([(0.9, 0.2, 0.2), (0.95, 0.8, 0.15), (0.2, 0.55, 0.9)][k % 3]))
    ride_sign(a, st, -w * 0.3, -d / 2 - 0.08, 0.45, size=0.09, w=0.9)


RIDES = {
    "carousel": r_carousel, "teacups": r_teacups, "satellite": r_satellite, "bubble": r_bubble, "swings": r_swings,
    "inferno": r_inferno, "flipphone": r_flipphone, "glitter": r_glitter, "meteor": r_meteor, "wheel": r_wheel,
    "balloon": r_balloon, "barn": r_barn, "worldboat": r_worldboat, "lasertag": r_lasertag, "trex": r_trex,
    "dig": r_dig, "foampit": r_foampit, "minetrain": r_minetrain, "raptor": r_raptor, "rocket": r_rocket,
    "aero": r_aero, "leviathan": r_leviathan, "riptide": r_riptide, "cruise": r_cruise,
}
# Rides taller than their footprint height says (so the render canvas fits them).
RIDE_TALL = {"glitter": 5.0, "meteor": 5.6, "balloon": 2.6, "rocket": 2.8, "swings": 2.5, "flipphone": 2.5, "trex": 2.6, "satellite": 2.2}


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
