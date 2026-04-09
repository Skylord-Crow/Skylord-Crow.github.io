# M3U8 Maker

A browser-based `.m3u8` playlist generator built with **React + Vite**. Point it at your local music library and a Spotify playlist (or CSV export), and it fuzzy-matches your tracks and generates a ready-to-use M3U8 file.

All processing happens locally in your browser — no audio, metadata, or credentials are ever uploaded to a server.

---

## Features

- **Three playlist sources** — Spotify (via PKCE OAuth), CSV export (e.g. from [Exportify](https://exportify.net/)), or a local directory
- **ID3-aware matching** — reads artist and title tags from your audio files for more accurate results than filename matching alone
- **Fuzzy matching** — LCS + token overlap algorithm tolerates minor differences in punctuation, formatting, and metadata between your files and the playlist
- **Rich M3U8 output** — includes `#EXTINF` durations, `#PLAYLIST`, `#ARTIST`, and `#DATE` headers
- **Web Worker** — matching runs off the main thread so the UI stays responsive on large libraries
- **Supports MP3, FLAC, WAV, M4A, OGG, AAC**

---

## Getting Started

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080).

### Building for production

```bash
npm run build
npm run preview
```

---

## Spotify Setup

> **Note:** Spotify's API requires each user to authenticate with a registered Developer app. Because of Spotify's quota restrictions for new apps, the simplest public deployment model is for each user to register their own free Client ID (takes ~2 minutes).

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and create a new app.
2. Under **Settings → Redirect URIs**, add the URL where your app is hosted (e.g. `http://127.0.0.1:8080` for local dev, or your GitHub Pages URL for production).
3. Under **Settings → User Management**, add your Spotify account email to the allowlist.
4. Copy your **Client ID** and paste it into the Spotify Settings panel inside the app.

Your Client ID is stored in `localStorage` — you only need to enter it once per browser.

---

## Project Structure

```
src/
├── components/
│   ├── ErrorBanner.jsx       # Dismissible error notification
│   ├── PlaylistSource.jsx    # Mode switcher: Spotify / CSV / Directory
│   ├── MusicLibrary.jsx      # Music folder picker + progress bar
│   └── GenerateSection.jsx   # Generate button + colourised log output
├── hooks/
│   └── useGenerator.js       # All generation logic as a React hook
├── lib/
│   ├── matcherUtils.js       # normalise(), STOPWORDS, MIN_SIMILARITY
│   ├── Song.js               # Audio file model + ID3 tag loading
│   ├── MDatabase.js          # Batched ingestion + bucket index
│   ├── Playlist.js           # CSV/Spotify/dir parsing + M3U8 output
│   └── SpotifyPlaylistFetch.js   # PKCE OAuth + Spotify API
├── workers/
│   └── matcher.worker.js     # Fuzzy matching (off main thread)
├── styles/
│   └── index.css
├── App.jsx
└── main.jsx
```

---

## How Matching Works

1. **Indexing** — your music files are read in parallel batches of 50. ID3 tags (artist + title) are loaded where available; filenames are used as a fallback. Each song is normalised and placed into an alphabet bucket for fast lookup.

2. **Normalisation** — both the playlist track names and your file metadata are lowercased, stripped of bracketed content, punctuation, and common junk words (`remastered`, `official`, `feat`, etc.) before comparison.

3. **Scoring** — each candidate match is scored as `0.7 × LCS similarity + 0.3 × token overlap`. Scores above `0.8` are marked as high-confidence (`✔`); scores between `0.6` and `0.8` are medium-confidence (`⚠`). Anything below `0.6` is discarded.

4. **Output** — matched tracks are written to an M3U8 file with full path, duration, and display name per entry.

---

## M3U8 Output Format

```m3u8
#EXTM3U
#PLAYLIST:My Playlist
#ARTIST:C418
#DATE:2026-04-09

#EXTINF:209,C418 - Subwoofer Lullaby
Music/C418/Minecraft Volume Alpha/03 - Subwoofer Lullaby.flac

#EXTINF:254,C418 - Minecraft
Music/C418/Minecraft Volume Alpha/08 - Minecraft.flac
```

Paths are relative to the root of the folder you selected, so the file works on any device as long as the relative structure is preserved.

---

## Known Limitations

- **Spotify quota** — newly created Spotify Developer apps are limited to 5 allowlisted users. Extended Quota Mode for unlimited users has been closed to individual developers since May 2025. See [Spotify's quota documentation](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) for details.
- **FLAC duration** — browsers cannot decode FLAC for duration probing, so FLAC tracks are written with a duration of `-1` in the M3U8. Most players handle this gracefully.
- **Short track names** — very short titles (under 4 characters after normalisation) are skipped by the matcher to avoid false positives.

---

## Dependencies

| Package | Purpose |
|---|---|
| `react` / `react-dom` | UI |
| `vite` + `@vitejs/plugin-react` | Build tooling |
| `papaparse` | CSV parsing |
| `jsmediatags` (CDN) | ID3 tag reading |

---

## Privacy

No data leaves your browser. Music files are read locally via the File API. Spotify authentication uses PKCE (no client secret, no server). Your Client ID and tokens are stored only in your browser's `localStorage`.