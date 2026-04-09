import { normalise } from "./matcherUtils.js";

/**
 * Represents a single audio file in the user's library.
 */
export class Song {
  constructor(fileOrPath) {
    this.isFileObject = fileOrPath instanceof File;
    this.rawSource = fileOrPath;

    this.relativePath = this.isFileObject
      ? fileOrPath.webkitRelativePath || fileOrPath.name
      : fileOrPath;

    const parts = this.relativePath.split("/");
    this.filename = parts.pop();

    this.meta = {
      title: this.filename.replace(/\.[^.]+$/, ""),
      artist: "",
    };

    // Initialise duration here so it's always defined, even if
    // loadMetadata() is never called or the file can't be decoded.
    this.duration = -1;

    this.normalizedName = normalise(this.meta.title);
  }

  /**
   * Reads ID3 tags and audio duration in parallel.
   * Falls back silently to filename-based defaults on error.
   *
   * @returns {Promise<boolean>} true if ID3 tags were read successfully
   */
  async loadMetadata() {
    if (!this.isFileObject) return false;

    // Run ID3 tag reading and duration probing concurrently
    const [tagsLoaded] = await Promise.all([
      this._loadTags(),
      this._loadDuration(),
    ]);

    return tagsLoaded;
  }

  /** @private */
  _loadTags() {
    return new Promise((resolve) => {
      window.jsmediatags.read(this.rawSource, {
        onSuccess: (tag) => {
          if (tag.tags.title) this.meta.title = tag.tags.title;
          if (tag.tags.artist) this.meta.artist = tag.tags.artist;
          this.normalizedName = normalise(
            `${this.meta.artist} ${this.meta.title}`
          );
          resolve(true);
        },
        onError: () => {
          console.warn("ID3 read failed:", this.filename);
          resolve(false);
        },
      });
    });
  }

  /** @private */
  _loadDuration() {
    return new Promise((resolve) => {
      // Skip formats the browser can't decode — avoids console errors
      const ext = this.filename.split(".").pop().toLowerCase();
      const decodable = ["mp3", "wav", "ogg", "m4a", "aac"];
      if (!decodable.includes(ext)) {
        resolve();
        return;
      }

      const url = URL.createObjectURL(this.rawSource);
      const audio = new Audio();
      audio.preload = "metadata";

      const cleanup = () => {
        // Remove event listeners and revoke the object URL to prevent leaks,
        // especially important when processing large libraries mid-session.
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.src = "";
        URL.revokeObjectURL(url);
        resolve();
      };

      audio.onloadedmetadata = () => {
        this.duration = isFinite(audio.duration)
          ? Math.round(audio.duration)
          : -1;
        cleanup();
      };

      audio.onerror = () => cleanup();
      audio.src = url;
    });
  }

  getBucketChar() {
    return this.normalizedName ? this.normalizedName[0] : null;
  }
}