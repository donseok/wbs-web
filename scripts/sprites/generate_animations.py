#!/usr/bin/env python3
import os
import sys
from PIL import Image
import numpy as np

SOURCES = {
    "active_build": {
        "file": "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/agent_build_poses_1789010263063.jpg",
        "fps": 8,
        "duration_ms": 125,
        "boxes": [
            (10, 10, 502, 502),
            (521, 10, 1013, 502),
            (26, 505, 518, 997),
            (536, 505, 1028, 997),
        ]
    },
    "idle_coffee": {
        "file": "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/agent_idle_coffee_1789010279357.jpg",
        "fps": 4,
        "duration_ms": 250,
        "boxes": [
            (10, 10, 502, 502),
            (518, 10, 1010, 502),
            (10 - 13, 518, 502 - 13, 1010),
            (518, 518, 1010, 1010),
        ]
    },
    "stale_sleep": {
        "file": "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/agent_stale_sleep_1789010328688.jpg",
        "fps": 2,
        "duration_ms": 500,
        "boxes": [
            (10, 10, 502, 502),
            (518 - 8, 10, 1010 - 8, 502),
            (10, 518, 502, 1010),
            (518 - 8, 518, 1010 - 8, 1010),
        ]
    }
}

OUTPUT_DIRS = [
    "/Users/jji/project/wbs-web/public/sprites",
    "/Users/jji/project/wbs-web/docs/superpowers/specs/sprites",
    "/Users/jji/.gemini/antigravity-cli/brain/3b868d89-cbf8-4231-9e02-6a6776d61834/sprites"
]

def clean_frame(img_crop):
    """Clean magenta background to transparent RGBA."""
    rgba = img_crop.convert("RGBA")
    arr = np.array(rgba)
    
    # Identify magenta background pixels
    is_magenta = (arr[:,:,0] > 175) & (arr[:,:,1] < 75) & (arr[:,:,2] > 175)
    
    dist_to_magenta = np.maximum(
        np.abs(arr[:,:,0].astype(int) - 255),
        np.maximum(arr[:,:,1].astype(int), np.abs(arr[:,:,2].astype(int) - 255))
    )
    is_magenta |= (dist_to_magenta < 90) & (arr[:,:,1] < 85)
    
    arr[is_magenta, 3] = 0
    
    # Clean up faint purple border fringe
    fringe = (arr[:,:,3] > 0) & (arr[:,:,0] > 160) & (arr[:,:,2] > 160) & (arr[:,:,1] < 60)
    arr[fringe, 3] = 0
    
    return Image.fromarray(arr)

def make_transparent_gif(frames, duration_ms, out_path):
    """Save animated GIF preserving transparency."""
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
        
    for state_name, config in SOURCES.items():
        print(f"Processing {state_name}...")
        src_img = Image.open(config["file"])
        
        frames_hd = []
        frames_64 = []
        frames_128 = []
        
        for idx, box in enumerate(config["boxes"]):
            crop = src_img.crop(box)
            cleaned = clean_frame(crop)
            frames_hd.append(cleaned)
            
            # Downsample using Nearest Neighbor for pixel-art retro crispness
            f_64 = cleaned.resize((64, 64), Image.Resampling.NEAREST)
            f_128 = cleaned.resize((128, 128), Image.Resampling.NEAREST)
            frames_64.append(f_64)
            frames_128.append(f_128)
            
            for out_dir in OUTPUT_DIRS:
                f_64.save(os.path.join(out_dir, f"{state_name}_f{idx}_64.png"))
                f_128.save(os.path.join(out_dir, f"{state_name}_f{idx}_128.png"))
                cleaned.save(os.path.join(out_dir, f"{state_name}_f{idx}_hd.png"))
                
        strip_64 = Image.new("RGBA", (64 * 4, 64), (0, 0, 0, 0))
        strip_128 = Image.new("RGBA", (128 * 4, 128), (0, 0, 0, 0))
        strip_hd = Image.new("RGBA", (frames_hd[0].width * 4, frames_hd[0].height), (0, 0, 0, 0))
        
        for idx in range(4):
            strip_64.paste(frames_64[idx], (idx * 64, 0))
            strip_128.paste(frames_128[idx], (idx * 128, 0))
            strip_hd.paste(frames_hd[idx], (idx * frames_hd[0].width, 0))
            
        for out_dir in OUTPUT_DIRS:
            strip_64.save(os.path.join(out_dir, f"{state_name}_sheet_64.png"))
            strip_128.save(os.path.join(out_dir, f"{state_name}_sheet_128.png"))
            strip_hd.save(os.path.join(out_dir, f"{state_name}_sheet_hd.png"))
            
            # Save Animated APNG (32-bit alpha transparency)
            frames_64[0].save(
                os.path.join(out_dir, f"{state_name}_64.png"),
                save_all=True,
                append_images=frames_64[1:],
                duration=config["duration_ms"],
                loop=0
            )
            frames_128[0].save(
                os.path.join(out_dir, f"{state_name}_128.png"),
                save_all=True,
                append_images=frames_128[1:],
                duration=config["duration_ms"],
                loop=0
            )
            frames_hd[0].save(
                os.path.join(out_dir, f"{state_name}_hd.png"),
                save_all=True,
                append_images=frames_hd[1:],
                duration=config["duration_ms"],
                loop=0
            )
            
            # Save Animated GIF
            make_transparent_gif(frames_64, config["duration_ms"], os.path.join(out_dir, f"{state_name}_64.gif"))
            make_transparent_gif(frames_128, config["duration_ms"], os.path.join(out_dir, f"{state_name}_128.gif"))
            make_transparent_gif(frames_hd, config["duration_ms"], os.path.join(out_dir, f"{state_name}_hd.gif"))
            
    print("All sprites and animations successfully generated!")

if __name__ == "__main__":
    main()
