"""Convert rendered PNG sprites to WebP (much smaller downloads). Run by build_park.py
after rendering, or standalone:
  blender --background --factory-startup --python art/to_webp.py
"""
import bpy
import glob
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def convert(path, quality=88):
    img = bpy.data.images.load(path)
    sc = bpy.context.scene
    s = sc.render.image_settings
    s.file_format = "WEBP"
    s.color_mode = "RGBA"
    s.quality = quality
    out = path[:-4] + ".webp"
    img.save_render(out, scene=sc)
    bpy.data.images.remove(img)
    os.remove(path)
    return out


if __name__ == "__main__":
    for p in glob.glob(os.path.join(ROOT, "public", "sprites", "park", "*.png")):
        convert(p)
        print("webp", os.path.basename(p))
