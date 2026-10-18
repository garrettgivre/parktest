"""Bake ground textures into seamless *isometric* tiles for the game's ground.

Usage:  npm run ground

A square texture that repeats every T tiles on the ground repeats on screen every
128*T x 64*T pixels (the iso lattice contains that axis-aligned rectangle), so we
render exactly one such rectangle of a big textured plane from the game camera.
The result tiles seamlessly with a plain 2D repeating pattern in the game.

Reads art/textures/<name>.png for every name in GROUND, writes
public/sprites/ground/<name>.webp and manifest.json.
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
TEX = os.path.join(ROOT, "art", "textures")
OUT = os.path.join(ROOT, "public", "sprites", "ground")
PPU = 64 / math.cos(math.radians(45))
CAM_ROT = Euler((math.radians(60), 0, math.radians(45)), "XYZ")

# name -> tiles per texture repeat (integer so the tile is seamless)
GROUND = {"brick": 2, "stone": 3, "concrete": 4, "wood": 2, "grass": 3, "sand": 3, "pavers": 2, "asphalt": 3}


def bake(name, T):
    path = os.path.join(TEX, name + ".png")
    if not os.path.exists(path):
        return None
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = 128 * T, 64 * T
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    # A flat, unlit textured plane: the game does its own shading.
    bpy.ops.mesh.primitive_plane_add(size=T * 8)
    plane = bpy.context.active_object
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / T, 1 / T, 1)
    it = nt.nodes.new("ShaderNodeTexImage")
    it.image = bpy.data.images.load(path, check_existing=True)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], it.inputs["Vector"])
    nt.links.new(it.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    plane.data.materials.append(m)
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.ortho_scale = (128 * T) / PPU
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    cam.rotation_euler = CAM_ROT
    cam.location = (CAM_ROT.to_matrix() @ Vector((0, 0, 1))) * 50
    sc.camera = cam
    os.makedirs(OUT, exist_ok=True)
    png = os.path.join(OUT, name + ".png")
    sc.render.filepath = png
    bpy.ops.render.render(write_still=True)
    to_webp(png, quality=85)
    print("ground", name, T)
    return {"w": 128 * T, "h": 64 * T, "tiles": T}


def main():
    done = {}
    for name, T in GROUND.items():
        r = bake(name, T)
        if r:
            done[name] = r
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump({"textures": done}, f, indent=1)


main()
