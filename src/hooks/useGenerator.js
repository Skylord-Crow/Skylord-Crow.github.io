import { useState, useCallback } from "react";
import { MDatabase } from "../lib/MDatabase.js";
import { Playlist } from "../lib/Playlist.js";
import { SpotifyPlaylistFetch } from "../lib/SpotifyPlaylistFetch.js";
import MatcherWorker from "../workers/matcher.worker.js?worker";

const SUPPORTED_EXTS = [".mp3", ".flac", ".wav", ".m4a", ".ogg"];

/**
 * Encapsulates all generation state and logic.
 *
 * Returns:
 *  - logs         string[]        Log lines for display
 *  - progress     { done, total } Current indexing / matching progress
 *  - isRunning    boolean
 *  - error        string | null
 *  - generate     function        Main entry point
 *  - clearError   function
 */
export function useGenerator() {
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);

  const log = (msg) => setLogs((prev) => [...prev, msg]);

  const updateProgress = (done, total) =>
    setProgress({ done, total, percent: Math.floor((done / total) * 100) });

  const clearError = () => setError(null);

  const generate = useCallback(
    async ({ mode, csvFile, spotifyUrl, musicFiles, playlistDirFiles, musicListText }) => {
      setError(null);
      setLogs([]);
      setProgress(null);
      setIsRunning(true);

      try {
        // ── 1. Build file list ──────────────────────────────────
        let filesToProcess = [];

        if (musicFiles?.length) {
          filesToProcess = musicFiles.filter((f) =>
            SUPPORTED_EXTS.some((ext) =>
              (f.webkitRelativePath || f.name).toLowerCase().endsWith(ext)
            )
          );
        } else if (musicListText) {
          filesToProcess = musicListText
            .split("\n")
            .map((l) => l.trim())
            .filter((l) =>
              SUPPORTED_EXTS.some((ext) => l.toLowerCase().endsWith(ext))
            );
        } else {
          throw new Error("Please select a music folder or upload a filename list.");
        }

        // ── 2. Build database ───────────────────────────────────
        const db = new MDatabase();
        log(`Indexing ${filesToProcess.length} music files…`);
        await db.ingest(filesToProcess, updateProgress);

        // ── 3. Parse playlist source ────────────────────────────
        const playlist = new Playlist();

        if (mode === "spotify") {
          if (!SpotifyPlaylistFetch.isAuthenticated()) {
            throw new Error("Please log in to Spotify first.");
          }
          log("Fetching Spotify playlist…");
          await playlist.parseSpotify(spotifyUrl);
        } else if (mode === "csv") {
          log("Parsing CSV…");
          await playlist.parseCSV(csvFile);
        } else if (mode === "dir") {
          log("Reading directory…");
          playlist.parseDirectory(playlistDirFiles?.length ? playlistDirFiles : musicFiles);
        }

        log(`Found ${playlist.tracksToFind.length} tracks to match.`);

        // ── 4. Match ────────────────────────────────────────────
        log("Matching tracks…");
        const matches = await playlist.matchAgainst(db, MatcherWorker, {
          onProgress: updateProgress,
        });

        // ── 5. Log results ──────────────────────────────────────
        matches.forEach((m, i) => {
          const name = playlist.tracksToFind[i];
          if (m) {
            const icon = m.level === "high" ? "✔" : "⚠";
            log(`${icon} ${name} → ${m.path} (${m.score.toFixed(2)})`);
          } else {
            log(`✘ No match: ${name}`);
          }
        });

        // ── 6. Generate & download ──────────────────────────────
        const result = playlist.generateM3U8();
        log(`\nDone! Matched ${result.count}/${result.total}. Downloading…`);
        playlist.download(result.content);
      } catch (err) {
        console.error(err);
        setError(err.message || "An unexpected error occurred.");
      } finally {
        setIsRunning(false);
        setProgress(null);
      }
    },
    []
  );

  return { logs, progress, isRunning, error, generate, clearError };
}
