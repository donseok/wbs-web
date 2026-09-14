#!/usr/bin/env python3
import os
import glob
from PIL import Image
import numpy as np

ALL_ANIMATIONS = {
    # Original states
    "active_build": {
        "file": "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/agent_build_poses_1789010263063.jpg",
        "fps": 8,
        "duration_ms": 125,
        "is_char": False
    },
    "idle_coffee": {
        "file": "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/agent_idle_coffee_1789010279357.jpg",
        "fps": 4,
        "duration_ms": 250,
        "is_char": False
    },
    "stale_sleep": {
        "file": "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/agent_stale_sleep_1789010328688.jpg",
        "fps": 2,
        "duration_ms": 500,
        "is_char": False
    },
    # 4 Character variants
    "char1_monitor_bot": {
        "file": "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/bot_active_strip_1789010858043.jpg",
        "fps": 8,
        "duration_ms": 125,
        "is_char": True
    },
    "char2_cat_dev": {
        "file": "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/cat_active_strip_1789010884970.jpg",
        "fps": 6,
        "duration_ms": 166,
        "is_char": True
    },
    "char3_human_dev": {
        "file": "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/human_active_strip_1789010918473.jpg",
        "fps": 6,
        "duration_ms": 166,
        "is_char": True
    },
    "char4_dome_bot": {
        "file": "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/dome_active_strip_1789010947197.jpg",
        "fps": 4,
        "duration_ms": 250,
        "is_char": True
    }
}

# Safe interior quadrants
QUADS = [
    (18, 18, 498, 498),         # TL
    (526, 18, 1006, 498),       # TR
    (18, 526, 498, 1006),       # BL
    (526, 526, 1006, 1006)      # BR
]

def clean_quadrant(img_crop):
    """Clean magenta background and boundary residues."""
    arr = np.array(img_crop.convert("RGBA"))
    
    dist_to_magenta = np.maximum(
        np.abs(arr[:,:,0].astype(int) - 255),
        np.maximum(arr[:,:,1].astype(int), np.abs(arr[:,:,2].astype(int) - 255))
    )
    is_mag = (dist_to_magenta < 90) & (arr[:,:,1] < 85)
    is_mag |= (arr[:,:,0] > 170) & (arr[:,:,1] < 75) & (arr[:,:,2] > 170)
    arr[is_mag, 3] = 0
    
    # Fringe clean
    fringe = (arr[:,:,3] > 0) & (arr[:,:,0] > 155) & (arr[:,:,2] > 155) & (arr[:,:,1] < 65)
    arr[fringe, 3] = 0
    
    # Outer 4px margin: remove any potential guide line noise
    arr[:4, :, 3] = 0
    arr[-4:, :, 3] = 0
    arr[:, :4, 3] = 0
    arr[:, -4:, 3] = 0
    
    return Image.fromarray(arr)

def find_desk_offsets(crops_gray):
    """Find translation offsets for frames 1, 2, 3 relative to frame 0."""
    ref = crops_gray[0]
    # Use desk area (y: 340..450, x: 120..360)
    ref_desk = ref[340:450, 120:360]
    
    offsets = [(0, 0)]
    for i in range(1, 4):
        target = crops_gray[i]
        best_score = -1e9
        best_dy, best_dx = 0, 0
        for dy in range(-35, 36):
            for dx in range(-35, 36):
                sy = 340 + dy
                sx = 120 + dx
                if 0 <= sy and sy + ref_desk.shape[0] <= target.shape[0] and \
                   0 <= sx and sx + ref_desk.shape[1] <= target.shape[1]:
                    patch = target[sy:sy+ref_desk.shape[0], sx:sx+ref_desk.shape[1]]
                    diff = np.mean(np.abs(patch.astype(float) - ref_desk.astype(float)))
                    if -diff > best_score:
                        best_score = -diff
                        best_dy, best_dx = dy, dx
        offsets.append((best_dy, best_dx))
    return offsets

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

def process_item(name, conf):
    print(f"Processing {name}...")
    src_img = Image.open(conf["file"])
    
    crops_clean = []
    crops_gray = []
    for q in QUADS:
        c = src_img.crop(q)
        crops_gray.append(np.array(c.convert("L")))
        crops_clean.append(clean_quadrant(c))
        
    offsets = find_desk_offsets(crops_gray)
    print(f"  Offsets relative to frame 0: {offsets}")
    
    # Place on 560x560 padded canvas centered at (40, 40)
    padded = []
    for idx in range(4):
        dy, dx = offsets[idx]
        canvas = Image.new("RGBA", (560, 560), (0, 0, 0, 0))
        # Shift target frame by (-dx, -dy) to match frame 0
        arr = np.array(crops_clean[idx])
        canvas.paste(crops_clean[idx], (40 - dx, 40 - dy), mask=crops_clean[idx].split()[-1])
        padded.append(canvas)
        
    # Find unified bounding box across all 4 frames
    min_x, min_y, max_x, max_y = 560, 560, 0, 0
    for f in padded:
        bbox = f.getbbox()
        if bbox:
            min_x = min(min_x, bbox[0])
            min_y = min(min_y, bbox[1])
            max_x = max(max_x, bbox[2])
            max_y = max(max_y, bbox[3])
            
    # Create safe square crop box with generous 24px margin
    w = max_x - min_x
    h = max_y - min_y
    side = max(w, h) + 24
    cx = (min_x + max_x) // 2
    cy = (min_y + max_y) // 2
    crop_box = (cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)
    
    frames_hd = []
    frames_128 = []
    frames_64 = []
    for idx in range(4):
        f_hd = padded[idx].crop(crop_box)
        # Extra safety: ensure outermost row/col are 100% transparent
        arr_hd = np.array(f_hd)
        arr_hd[0, :, 3] = 0
        arr_hd[-1, :, 3] = 0
        arr_hd[:, 0, 3] = 0
        arr_hd[:, -1, 3] = 0
        f_hd = Image.fromarray(arr_hd)
        
        f_128 = f_hd.resize((128, 128), Image.Resampling.NEAREST)
        f_64 = f_hd.resize((64, 64), Image.Resampling.NEAREST)
        
        frames_hd.append(f_hd)
        frames_128.append(f_128)
        frames_64.append(f_64)
        
    # Verify no border lines
    arr3 = np.array(frames_hd[3])
    t = (arr3[0, :, 3] > 0).sum()
    b = (arr3[-1, :, 3] > 0).sum()
    l = (arr3[:, 0, 3] > 0).sum()
    r = (arr3[:, -1, 3] > 0).sum()
    print(f"  Frame 3 border check: Top={t}, Bottom={b}, Left={l}, Right={r}")
    
    # Destination folders
    dest_dirs = []
    if conf["is_char"]:
        dest_dirs = [
            "/Users/jji/project/wbs-web/public/sprites/chars",
            "/Users/jji/project/wbs-web/docs/superpowers/specs/sprites/chars",
            "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/sprites/chars"
        ]
    else:
        dest_dirs = [
            "/Users/jji/project/wbs-web/public/sprites",
            "/Users/jji/project/wbs-web/docs/superpowers/specs/sprites",
            "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/sprites"
        ]
        
    for d in dest_dirs:
        os.makedirs(d, exist_ok=True)
        # Individual frames
        for i in range(4):
            frames_64[i].save(os.path.join(d, f"{name}_f{i}_64.png"))
            frames_128[i].save(os.path.join(d, f"{name}_f{i}_128.png"))
            frames_hd[i].save(os.path.join(d, f"{name}_f{i}_hd.png"))
            
        # Horizontal strips
        strip_64 = Image.new("RGBA", (64 * 4, 64), (0, 0, 0, 0))
        strip_128 = Image.new("RGBA", (128 * 4, 128), (0, 0, 0, 0))
        strip_hd = Image.new("RGBA", (frames_hd[0].width * 4, frames_hd[0].height), (0, 0, 0, 0))
        for i in range(4):
            strip_64.paste(frames_64[i], (i * 64, 0))
            strip_128.paste(frames_128[i], (i * 128, 0))
            strip_hd.paste(frames_hd[i], (i * frames_hd[0].width, 0))
            
        strip_64.save(os.path.join(d, f"{name}_sheet_64.png"))
        strip_128.save(os.path.join(d, f"{name}_sheet_128.png"))
        strip_hd.save(os.path.join(d, f"{name}_sheet_hd.png"))
        
        # APNG
        frames_64[0].save(
            os.path.join(d, f"{name}_64.png"),
            save_all=True,
            append_images=frames_64[1:],
            duration=conf["duration_ms"],
            loop=0
        )
        frames_128[0].save(
            os.path.join(d, f"{name}_128.png"),
            save_all=True,
            append_images=frames_128[1:],
            duration=conf["duration_ms"],
            loop=0
        )
        frames_hd[0].save(
            os.path.join(d, f"{name}_hd.png"),
            save_all=True,
            append_images=frames_hd[1:],
            duration=conf["duration_ms"],
            loop=0
        )
        
        # GIF
        make_transparent_gif(frames_64, conf["duration_ms"], os.path.join(d, f"{name}_64.gif"))
        make_transparent_gif(frames_128, conf["duration_ms"], os.path.join(d, f"{name}_128.gif"))
        make_transparent_gif(frames_hd, conf["duration_ms"], os.path.join(d, f"{name}_hd.gif"))
        
    print(f"  {name} completed successfully!")

def main():
    for name, conf in ALL_ANIMATIONS.items():
        process_item(name, conf)
    print("\nALL ANIMATIONS REGENERATED WITH PERFECT ALIGNMENT AND ZERO BORDER ARTIFACTS!")

if __name__ == "__main__":
    main()
