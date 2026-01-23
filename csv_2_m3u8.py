import csv
import os
import re
import argparse
from difflib import SequenceMatcher

SUPPORTED_EXTS = [".mp3", ".flac", ".wav", ".m4a", ".ogg"]
MIN_SIMILARITY = 0.60

def normalise(text):
    """Normalise text for fuzzy matching."""
    text = text.lower()
    text = re.sub(r'\(.*?\)', '', text)   # remove remaster/remix tags
    text = re.sub(r'[^a-z0-9 ]', '', text)
    return re.sub(r'\s+', ' ', text).strip()

def similarity(a, b):
    return SequenceMatcher(None, a, b).ratio()

def index_music_files(music_dir):
    """Map normalised filename -> full path"""
    index = {}
    for root, _, files in os.walk(music_dir):
        for file in files:
            name, ext = os.path.splitext(file)
            if ext.lower() in SUPPORTED_EXTS:
                index[normalise(name)] = os.path.join(root, file)
    return index

def find_best_match(track_name, music_index):
    key = normalise(track_name)
    best_score = 0.0
    best_path = None

    for name_key, path in music_index.items():
        score = similarity(key, name_key)
        if score > best_score:
            best_score = score
            best_path = path

    if best_score >= MIN_SIMILARITY:
        return best_path, best_score
    return None, best_score

def rockbox_path(real_path, source_dir, rockbox_root):
    """Convert real filesystem path to Rockbox-style absolute path"""
    rel = os.path.relpath(real_path, source_dir)
    rb_path = os.path.join(rockbox_root, rel)
    return rb_path.replace(os.sep, "/")

def csv_to_m3u8(csv_path, music_index, source_dir, output_dir, rockbox_root):
    playlist_name = os.path.splitext(os.path.basename(csv_path))[0]
    output_path = os.path.join(output_dir, f"{playlist_name}.m3u8")

    total = matched = 0

    with open(csv_path, newline="", encoding="utf-8") as csvfile, \
         open(output_path, "w", encoding="utf-8", newline="\n") as m3u8:

        reader = csv.DictReader(csvfile)
        m3u8.write("#EXTM3U\n")

        for row in reader:
            track = row.get("Track Name")
            if not track:
                continue

            total += 1
            path, score = find_best_match(track, music_index)

            if path:
                matched += 1
                m3u8.write(rockbox_path(path, source_dir, rockbox_root) + "\n")
            else:
                print(f"No match: {track} (best={score:.2f})")

    print(f"✔ {playlist_name}: {matched}/{total} matched")

def main():
    parser = argparse.ArgumentParser(
        description="Create Rockbox-compatible M3U8 playlists from CSV files"
    )
    parser.add_argument("csv_files", nargs="+", help="CSV playlist files")
    parser.add_argument("--source", default="./Music", help="Music directory")
    parser.add_argument("--dest", default="./playlists", help="Playlist output directory")
    parser.add_argument(
        "--rockbox-root",
        default="/Music",
        help="Rockbox music root path (default: /Music)"
    )

    args = parser.parse_args()

    source_dir = os.path.abspath(args.source)
    output_dir = os.path.abspath(args.dest)

    os.makedirs(output_dir, exist_ok=True)

    print("Indexing music files...")
    music_index = index_music_files(source_dir)
    print(f"   Indexed {len(music_index)} tracks")

    for csv_file in args.csv_files:
        csv_to_m3u8(
            csv_file,
            music_index,
            source_dir,
            output_dir,
            args.rockbox_root
        )

if __name__ == "__main__":
    main()
