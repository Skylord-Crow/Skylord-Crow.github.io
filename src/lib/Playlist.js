import Papa from "papaparse";
import { SpotifyPlaylistFetch } from "./SpotifyPlaylistFetch.js";

/**
 * Represents a playlist and handles all source-parsing modes
 * (Spotify, CSV, directory) plus worker-based matching and M3U8 output.
 */
export class Playlist {
  constructor(name) {
    this.name = name || "New Playlist";
    this.tracksToFind = [];
    this.matchedTracks = [];
    this.spotifyTracks = [];
  }

  /* ─── CSV ─────────────────────────────────────────────────── */

  async parseCSV(file) {
    this.name = file.name.replace(/\.[^.]+$/, "");
    const text = await file.text();

    return new Promise((resolve, reject) => {
      Papa.parse(text, {
        header: true,
        complete: (results) => {
          this.tracksToFind = results.data
            .filter((r) => r["Track Name"])
            .map((r) => {
              const artist = r["Artist Name"] || "";
              const track = r["Track Name"];
              return `${artist} ${track}`.trim();
            });

          resolve(this.tracksToFind.length);
        },
        error: reject,
      });
    });
  }

  /* ─── Spotify ─────────────────────────────────────────────── */

  async parseSpotify(url) {
    if (!url) throw new Error("Spotify URL is required.");

    const { name, tracks } = await SpotifyPlaylistFetch.fetchFromUrl(url);

    console.log(`Spotify returned ${tracks.length} tracks for playlist: ${name}`);

    if (!tracks.length) {
      throw new Error(
        "No tracks found in this playlist. It may be empty, contain only podcast episodes, " +
        "or all tracks may be unavailable in your region. Check the console for the raw item structure."
      );
    }

    this.spotifyTracks = tracks;
    this.name = name;
    this.tracksToFind = tracks.map((t) => `${t.artists} ${t.name}`.trim());

    return this.tracksToFind.length;
  }

  /* ─── Directory ───────────────────────────────────────────── */

  parseDirectory(files) {
    this.name = "Directory Playlist";

    this.tracksToFind = Array.from(files)
      .filter((f) => /\.(mp3|flac|ogg|m4a)$/i.test(f.name))
      .map((f) => f.name);

    return this.tracksToFind.length;
  }

  /* ─── Matching ────────────────────────────────────────────── */

  /**
   * Runs fuzzy matching in a Web Worker.
   *
   * @param {import("./MDatabase.js").MDatabase} database
   * @param {new () => Worker} WorkerClass  Vite-imported worker constructor
   * @param {{ onProgress?: (done: number, total: number) => void }} [callbacks]
   * @returns {Promise<Array>}
   */
  matchAgainst(database, WorkerClass, callbacks) {
    return new Promise((resolve, reject) => {
      const worker = new WorkerClass();

      worker.postMessage({
        tracks: this.tracksToFind,
        index: database.getIndexForWorker(),
      });

      worker.onmessage = (e) => {
        if (e.data.progress !== undefined && callbacks?.onProgress) {
          callbacks.onProgress(e.data.progress, this.tracksToFind.length);
        } else if (e.data.done) {
          this.matchedTracks = e.data.results;
          worker.terminate();
          resolve(this.matchedTracks);
        }
      };

      worker.onerror = (e) => {
        worker.terminate();
        reject(e);
      };
    });
  }

  /* ─── M3U8 output ─────────────────────────────────────────── */

  generateM3U8() {
    const today = new Date().toISOString().split("T")[0];

    // Collect matched entries
    const entries = [];
    this.matchedTracks.forEach((match) => {
      if (!match) return;
      entries.push(match);
    });

    // Use #ARTIST: header only when every track shares the same artist
    const artists = [...new Set(entries.map((e) => e.artist).filter(Boolean))];
    const singleArtist = artists.length === 1 ? artists[0] : null;

    // Build output
    let output = "#EXTM3U\n";
    output += `#PLAYLIST:${this.name}\n`;
    if (singleArtist) output += `#ARTIST:${singleArtist}\n`;
    output += `#DATE:${today}\n`;

    let count = 0;

    this.matchedTracks.forEach((match) => {
      if (!match) return;

      const artist = match.artist || "";
      const title = match.title || match.path.split("/").pop().replace(/\.[^.]+$/, "");
      const duration = match.duration ?? -1;
      const displayName = artist ? `${artist} - ${title}` : title;
      const cleanPath = match.path.replace(/^\//, "");

      output += `\n#EXTINF:${duration},${displayName}\n`;
      output += `${cleanPath}\n`;
      count++;
    });

    return { content: output, count, total: this.tracksToFind.length };
  }

  download(content) {
    const blob = new Blob([content], { type: "audio/x-mpegurl" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${this.name}.m3u8`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
