import { Song } from "./Song.js";

/** How many files to read ID3 tags for in parallel. */
const BATCH_SIZE = 50;

/**
 * Manages the collection of Songs and the index used for fuzzy matching.
 */
export class MDatabase {
  constructor() {
    this.songs = [];
    this.index = {};
  }

  /**
   * Ingests an array of File objects (or path strings), reads ID3 tags
   * in parallel batches, then builds the bucket index.
   *
   * @param {File[]|string[]} files
   * @param {(done: number, total: number) => void} [onProgress]
   */
  async ingest(files, onProgress) {
    this.songs = [];
    this.index = {};

    const allSongs = files.map((f) => new Song(f));
    let processed = 0;

    for (let i = 0; i < allSongs.length; i += BATCH_SIZE) {
      const batch = allSongs.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((s) => s.loadMetadata()));

      processed += batch.length;

      // Clamp to total to avoid emitting > 100% if batches overlap
      onProgress?.(Math.min(processed, allSongs.length), allSongs.length);

      // Yield to keep the UI paint loop alive
      await new Promise((r) => setTimeout(r, 0));
    }

    // Deduplicate by relativePath so the same file added twice (e.g. from
    // overlapping folder selections) doesn't produce duplicate M3U8 entries.
    const seen = new Set();

    for (const song of allSongs) {
      if (!song.normalizedName) continue;
      if (seen.has(song.relativePath)) continue;
      seen.add(song.relativePath);

      this.songs.push(song);

      const bucket = song.getBucketChar();
      if (!this.index[bucket]) this.index[bucket] = [];

      this.index[bucket].push({
        norm: song.normalizedName,
        path: song.relativePath,
        artist: song.meta.artist,
        title: song.meta.title,
        duration: song.duration,
      });
    }

    // Final progress tick — only emit if we haven't already hit 100%
    // (avoids the redundant double-fire at exactly BATCH_SIZE files)
    if (processed < allSongs.length || allSongs.length === 0) {
      onProgress?.(allSongs.length, allSongs.length);
    }
  }

  /** Returns the raw index object suitable for postMessage to the worker. */
  getIndexForWorker() {
    return this.index;
  }
}