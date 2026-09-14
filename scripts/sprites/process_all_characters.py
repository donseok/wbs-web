#!/usr/bin/env python3
import os
from PIL import Image
import numpy as np

CHARACTERS = {
    "char1_monitor_bot": {
        "title": "CRT 모니터봇 (Monitor Bot)",
        "file": "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/bot_active_strip_1789010858043.jpg",
        "fps": 8,
        "duration_ms": 125,
        "boxes": [
            (8, 8, 506, 506),
            (518, 8, 1016, 506),
            (8, 518, 506, 1016),
            (518, 518, 1016, 1016),
        ]
    },
    "char2_cat_dev": {
        "title": "픽셀 냥이 개발자 (Cat Dev)",
        "file": "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/cat_active_strip_1789010884970.jpg",
        "fps": 6,
        "duration_ms": 166,
        "boxes": [
            (8, 8, 506, 506),
            (518, 8, 1016, 506),
            (8, 518, 506, 1016),
            (518, 518, 1016, 1016),
        ]
    },
    "char3_human_dev": {
        "title": "인간형 테크 개발자 (Human Dev)",
        "file": "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/human_active_strip_1789010918473.jpg",
        "fps": 6,
        "duration_ms": 166,
        "boxes": [
            (8, 8, 506, 506),
            (518, 8, 1016, 506),
            (8, 518, 506, 1016),
            (518, 518, 1016, 1016),
        ]
    },
    "char4_dome_bot": {
        "title": "미니 돔 안드로이드 (Dome Bot)",
        "file": "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/dome_active_strip_1789010947197.jpg",
        "fps": 4,
        "duration_ms": 250,
        "boxes": [
            (8, 8, 506, 506),
            (518, 8, 1016, 506),
            (8, 518, 506, 1016),
            (518, 518, 1016, 1016),
        ]
    }
}

OUTPUT_DIRS = [
    "/Users/jji/project/wbs-web/public/sprites/chars",
    "/Users/jji/project/wbs-web/docs/superpowers/specs/sprites/chars",
    "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/sprites/chars"
]

def clean_frame(img_crop):
    """Clean magenta background to transparent RGBA."""
    rgba = img_crop.convert("RGBA")
    arr = np.array(rgba)
    
    # Identify magenta background
    is_magenta = (arr[:,:,0] > 175) & (arr[:,:,1] < 75) & (arr[:,:,2] > 175)
    
    # Distance to magenta
    dist_to_magenta = np.maximum(
        np.abs(arr[:,:,0].astype(int) - 255),
        np.maximum(arr[:,:,1].astype(int), np.abs(arr[:,:,2].astype(int) - 255))
    )
    is_magenta |= (dist_to_magenta < 85) & (arr[:,:,1] < 80)
    arr[is_magenta, 3] = 0
    
    # Fringe clean
    fringe = (arr[:,:,3] > 0) & (arr[:,:,0] > 160) & (arr[:,:,2] > 160) & (arr[:,:,1] < 60)
    arr[fringe, 3] = 0
    
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
        
        p_img = Image.fromarray(p_arr, mode="P")
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

def main():
    for out_dir in OUTPUT_DIRS:
        os.makedirs(out_dir, exist_ok=True)
        
    for char_id, config in CHARACTERS.items():
        print(f"Processing {char_id} ({config['title']})...")
        src_img = Image.open(config["file"])
        
        frames_hd = []
        frames_64 = []
        frames_128 = []
        
        for idx, box in enumerate(config["boxes"]):
            crop = src_img.crop(box)
            cleaned = clean_frame(crop)
            frames_hd.append(cleaned)
            
            f_64 = cleaned.resize((64, 64), Image.Resampling.NEAREST)
            f_128 = cleaned.resize((128, 128), Image.Resampling.NEAREST)
            frames_64.append(f_64)
            frames_128.append(f_128)
            
            for out_dir in OUTPUT_DIRS:
                f_64.save(os.path.join(out_dir, f"{char_id}_f{idx}_64.png"))
                f_128.save(os.path.join(out_dir, f"{char_id}_f{idx}_128.png"))
                cleaned.save(os.path.join(out_dir, f"{char_id}_f{idx}_hd.png"))
                
        # Horizontal strips
        strip_64 = Image.new("RGBA", (64 * 4, 64), (0, 0, 0, 0))
        strip_128 = Image.new("RGBA", (128 * 4, 128), (0, 0, 0, 0))
        strip_hd = Image.new("RGBA", (frames_hd[0].width * 4, frames_hd[0].height), (0, 0, 0, 0))
        
        for idx in range(4):
            strip_64.paste(frames_64[idx], (idx * 64, 0))
            strip_128.paste(frames_128[idx], (idx * 128, 0))
            strip_hd.paste(frames_hd[idx], (idx * frames_hd[0].width, 0))
            
        for out_dir in OUTPUT_DIRS:
            strip_64.save(os.path.join(out_dir, f"{char_id}_sheet_64.png"))
            strip_128.save(os.path.join(out_dir, f"{char_id}_sheet_128.png"))
            strip_hd.save(os.path.join(out_dir, f"{char_id}_sheet_hd.png"))
            
            # APNG
            frames_64[0].save(
                os.path.join(out_dir, f"{char_id}_64.png"),
                save_all=True,
                append_images=frames_64[1:],
                duration=config["duration_ms"],
                loop=0
            )
            frames_128[0].save(
                os.path.join(out_dir, f"{char_id}_128.png"),
                save_all=True,
                append_images=frames_128[1:],
                duration=config["duration_ms"],
                loop=0
            )
            
            # GIF
            make_transparent_gif(frames_64, config["duration_ms"], os.path.join(out_dir, f"{char_id}_64.gif"))
            make_transparent_gif(frames_128, config["duration_ms"], os.path.join(out_dir, f"{char_id}_128.gif"))
            make_transparent_gif(frames_hd, config["duration_ms"], os.path.join(out_dir, f"{char_id}_hd.gif"))
            
    print("All 4 characters processed successfully!")

if __name__ == "__main__":
    main()
