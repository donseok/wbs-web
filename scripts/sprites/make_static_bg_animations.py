#!/usr/bin/env python3
import os
from PIL import Image
import numpy as np

QUADS = [
    (18, 18, 498, 498),
    (526, 18, 1006, 498),
    (18, 526, 498, 1006),
    (526, 526, 1006, 1006)
]

def clean_bg(img, clean_top_halo=False):
    arr = np.array(img.convert("RGBA"))
    dist_to_mag = np.maximum(
        np.abs(arr[:,:,0].astype(int) - 255),
        np.maximum(arr[:,:,1].astype(int), np.abs(arr[:,:,2].astype(int) - 255))
    )
    is_mag = (dist_to_mag < 90) & (arr[:,:,1] < 85)
    is_mag |= (arr[:,:,0] > 170) & (arr[:,:,1] < 75) & (arr[:,:,2] > 170)
    if clean_top_halo:
        is_mag |= (arr[:,:,0] > 200) & (arr[:,:,2] > 140) & (np.arange(arr.shape[0])[:, None] < 22)
    arr[is_mag, 3] = 0
    fringe = (arr[:,:,3] > 0) & (arr[:,:,0] > 155) & (arr[:,:,2] > 155) & (arr[:,:,1] < 65)
    arr[fringe, 3] = 0
    arr[:4, :, 3] = 0
    arr[-4:, :, 3] = 0
    arr[:, :4, 3] = 0
    arr[:, -4:, 3] = 0
    return Image.fromarray(arr)

def make_transparent_gif(frames, duration_ms, out_path):
    p_frames = []
    for f in frames:
        alpha = f.split()[-1]
        mask = Image.eval(alpha, lambda a: 255 if a <= 128 else 0)
        rgb = Image.new("RGB", f.size, (255, 255, 255))
        rgb.paste(f, mask=f.split()[-1])
        p = rgb.convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=255)
        p_arr = np.array(p)
        mask_arr = np.array(mask)
        p_arr[mask_arr > 0] = 255
        p_img = Image.fromarray(p_arr)
        palette = list(p.getpalette())
        palette[255*3:255*3+3] = [255, 255, 255]
        p_img.putpalette(palette)
        p_img.info["transparency"] = 255
        p_frames.append(p_img)
        
    p_frames[0].save(
        out_path,
        save_all=True,
        append_images=p_frames[1:],
        duration=duration_ms,
        loop=0,
        transparency=255,
        disposal=2
    )

def export_char(name, frames_128, fps, duration_ms):
    dest_dirs = [
        "/Users/jji/project/wbs-web/public/sprites/chars",
        "/Users/jji/project/wbs-web/docs/superpowers/specs/sprites/chars",
        "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/sprites/chars"
    ]
    frames_64 = [f.resize((64, 64), Image.Resampling.NEAREST) for f in frames_128]
    
    for d in dest_dirs:
        os.makedirs(d, exist_ok=True)
        for i in range(4):
            frames_64[i].save(os.path.join(d, f"{name}_f{i}_64.png"))
            frames_128[i].save(os.path.join(d, f"{name}_f{i}_128.png"))
            
        strip_64 = Image.new("RGBA", (64 * 4, 64), (0, 0, 0, 0))
        strip_128 = Image.new("RGBA", (128 * 4, 128), (0, 0, 0, 0))
        for i in range(4):
            strip_64.paste(frames_64[i], (i * 64, 0))
            strip_128.paste(frames_128[i], (i * 128, 0))
            
        strip_64.save(os.path.join(d, f"{name}_sheet_64.png"))
        strip_128.save(os.path.join(d, f"{name}_sheet_128.png"))
        
        frames_64[0].save(os.path.join(d, f"{name}_64.png"), save_all=True, append_images=frames_64[1:], duration=duration_ms, loop=0)
        frames_128[0].save(os.path.join(d, f"{name}_128.png"), save_all=True, append_images=frames_128[1:], duration=duration_ms, loop=0)
        
        make_transparent_gif(frames_64, duration_ms, os.path.join(d, f"{name}_64.gif"))
        make_transparent_gif(frames_128, duration_ms, os.path.join(d, f"{name}_128.gif"))

def process_char1():
    print("Processing char1_monitor_bot (100% static desk, no extra monitor)...")
    src = Image.open("/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/bot_active_clean_1789011703721.jpg")
    crops = [clean_bg(src.crop(q), clean_top_halo=True) for q in QUADS]
    offsets = [(0, 0), (0, 2), (0, 2), (0, 1)]
    padded = []
    for i in range(4):
        dy, dx = offsets[i]
        canvas = Image.new("RGBA", (520, 520), (0, 0, 0, 0))
        canvas.paste(crops[i], (20 - dx, 20 - dy), mask=crops[i].split()[-1])
        padded.append(canvas)
    crop_box = (25, 25, 495, 495)
    f128 = [p.crop(crop_box).resize((128, 128), Image.Resampling.NEAREST) for p in padded]
    export_char("char1_monitor_bot", f128, 8, 125)

def process_char2():
    print("Processing char2_cat_dev (100% static background plate, monitor never flips)...")
    src = Image.open("/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/cat_active_strip_1789010884970.jpg")
    cleaned = [clean_bg(src.crop(q)) for q in QUADS]
    arr0 = np.array(cleaned[0])
    
    final_frames = []
    for i in range(4):
        arri = np.array(cleaned[i])
        base = arr0.copy()
        # Cat is in x > 140, y < 385
        cat_mask = (arri[:, :, 3] > 0) & (np.arange(480)[:, None] < 385) & (np.arange(480)[None, :] > 140)
        base[cat_mask] = arri[cat_mask]
        # Desk surface strictly from Frame 0
        desk_area = (np.arange(480)[:, None] >= 385) & (arr0[:, :, 3] > 0)
        base[desk_area] = arr0[desk_area]
        final_frames.append(Image.fromarray(base))
        
    crop_box = (20, 30, 480, 490)
    f128 = [f.crop(crop_box).resize((128, 128), Image.Resampling.NEAREST) for f in final_frames]
    export_char("char2_cat_dev", f128, 6, 166)

def process_char3():
    print("Processing char3_human_dev (100% static background plate)...")
    src = Image.open("/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/human_active_strip_1789010918473.jpg")
    cleaned = [clean_bg(src.crop(q)) for q in QUADS]
    arr0 = np.array(cleaned[0])
    
    final_frames = []
    for i in range(4):
        arri = np.array(cleaned[i])
        base = arr0.copy()
        char_mask = (arri[:, :, 3] > 0) & (np.arange(480)[:, None] < 385) & (np.arange(480)[None, :] > 115)
        base[char_mask] = arri[char_mask]
        desk_area = (np.arange(480)[:, None] >= 385) & (arr0[:, :, 3] > 0)
        base[desk_area] = arr0[desk_area]
        final_frames.append(Image.fromarray(base))
        
    crop_box = (15, 25, 485, 495)
    f128 = [f.crop(crop_box).resize((128, 128), Image.Resampling.NEAREST) for f in final_frames]
    export_char("char3_human_dev", f128, 6, 166)

def process_char4():
    print("Processing char4_dome_bot (100% static background plate)...")
    src = Image.open("/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/dome_active_strip_1789010947197.jpg")
    cleaned = [clean_bg(src.crop(q)) for q in QUADS]
    arr0 = np.array(cleaned[0])
    
    final_frames = []
    for i in range(4):
        arri = np.array(cleaned[i])
        base = arr0.copy()
        char_mask = (arri[:, :, 3] > 0) & (np.arange(480)[:, None] < 365) & (np.arange(480)[None, :] < 345)
        base[char_mask] = arri[char_mask]
        desk_area = (np.arange(480)[:, None] >= 365) & (arr0[:, :, 3] > 0)
        base[desk_area] = arr0[desk_area]
        final_frames.append(Image.fromarray(base))
        
    crop_box = (25, 15, 495, 485)
    f128 = [f.crop(crop_box).resize((128, 128), Image.Resampling.NEAREST) for f in final_frames]
    export_char("char4_dome_bot", f128, 4, 250)

def main():
    process_char1()
    process_char2()
    process_char3()
    process_char4()
    print("\nALL 4 CHARACTERS REGENERATED WITH 100% STATIC BACKGROUND PLATES!")

if __name__ == "__main__":
    main()
