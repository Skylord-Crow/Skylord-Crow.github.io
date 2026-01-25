# Rockbox Playlist Generator (Beta)

A browser-based tool that converts Spotify-style CSV playlists into
Rockbox-compatible `.m3u8` playlists using fuzzy filename matching.

Runs entirely client-side. No uploads (kinda). No tracking.

## Features

- CSV → M3U8 playlist generation
- Folder-based or text-list music input
- Fast fuzzy matching with confidence scoring
- Web Worker–powered matching (non-blocking UI)
- Rockbox-compatible absolute paths
- GitHub Pages deployment

## Supported Formats

- `.mp3`
- `.flac`
- `.wav`
- `.m4a`
- `.ogg`

## Usage

1. Upload a Spotify CSV playlist
2. Select your music folder (or upload a text list)
3. Set Rockbox root (default `/Music`)
4. Generate and download playlist

Copy the resulting `.m3u8` file to: `\Playlists\` on your Rockbox device.

## Browser Support

| Browser | Status |
|---------|---------|
| Chrome | Full |
| Edge | Full |
| Firefox | ⚠ No folder upload |
| Safari | ⚠ Limited |

Unsupported browsers fall back to text-file input.

## Privacy

All processing happens locally in your browser.
No files are uploaded or stored.

## Known Limitations (Beta)

- Matching is filename-based (no ID3 parsing)
- Large libraries may take several seconds
- Non-English titles may require tuning

## License

Apache 2.0