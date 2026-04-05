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

    if (!tracks.length) {
      throw new Error("Spotify playlist is empty or inaccessible.");
    }

    this.spotifyTracks = tracks;
    this.name = name;  // real playlist name from Spotify

    this.tracksToFind = tracks.map((t) =>
      `${t.artists} ${t.name}`.trim()
    );

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

  generateM3U8(rootPath) {
    let output = "#EXTM3U\n";
    let count = 0;

    this.matchedTracks.forEach((match) => {
      if (!match) return;

      const cleanRoot = rootPath.replace(/\/$/, "");
      const cleanPath = match.path.replace(/^\//, "");
      output += `${cleanRoot}/${cleanPath}\n`;
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
