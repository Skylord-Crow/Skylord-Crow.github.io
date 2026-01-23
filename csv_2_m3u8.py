import csv
import os
import re
import argparse

SUPPORTED_EXTS = [".mp3", ".flac", ".wav", ".m4a", ".ogg"]

def sanitise(text):
    """Remove characters that commonly break filenames."""
    return re.sub(r'[<>:"/\\|?*]', '', text).strip()

def find_track_file(artist, track, music_dir):
    artist = sanitise(artist)
    track = sanitise(track)

    for ext in SUPPORTED_EXTS:
        filename = f"{artist} - {track}{ext}"
        path = os.path.join(music_dir, filename)
        if os.path.exists(path):
            return path

    return None

def csv_to_m3u8(csv_path, music_dir, output_dir):
    playlist_name = os.path.splitext(os.path.basename(csv_path))[0]
    output_path = os.path.join(output_dir, f"{playlist_name}.m3u8")

    missing = 0

    with open(csv_path, newline="", encoding="utf-8") as csvfile, \
         open(output_path, "w", encoding="utf-8") as m3u8:

        reader = csv.DictReader(csvfile)
        m3u8.write("#EXTM3U\n")

        for row in reader:
            track = row.get("Track Name")
            artist = row.get("Artist Name(s)")

            if not track or not artist:
                continue

            # Use first artist if multiple are listed
            artist = artist.split(";")[0]

            path = find_track_file(artist, track, music_dir)
            if path:
                # Relative paths improve portability
                m3u8.write(os.path.relpath(path, output_dir) + "\n")
            else:
                missing += 1

    print(f"✔ Created: {output_path}")
    print(f"⚠ Missing tracks: {missing}")

def main():
    parser = argparse.ArgumentParser(
        description="Create M3U8 playlists from Spotify-style CSV files"
    )
    parser.add_argument(
        "csv_files",
        nargs="+",
        help="CSV playlist files"
    )
    parser.add_argument(
        "--source",
        default="./Music",
        help="Directory containing music files (default: ./Music)"
    )
    parser.add_argument(
        "--dest",
        default="./playlists",
        help="Destination directory for .m3u8 playlists (default: ./playlists)"
    )

    args = parser.parse_args()

    music_dir = os.path.abspath(args.source)
    output_dir = os.path.abspath(args.dest)

    os.makedirs(output_dir, exist_ok=True)

    for csv_file in args.csv_files:
        csv_to_m3u8(csv_file, music_dir, output_dir)

if __name__ == "__main__":
    main()
