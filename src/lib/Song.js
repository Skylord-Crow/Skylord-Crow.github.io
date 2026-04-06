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

    this.normalizedName = normalise(this.meta.title);
  }

  /**
   * Reads ID3 tags using jsmediatags (browser only).
   * Falls back silently to filename-based defaults on error.
   *
   * @returns {Promise<boolean>}
   */
  async loadMetadata() {
    if (!this.isFileObject) return false;

    const tagsLoaded = await new Promise((resolve) => {
      window.jsmediatags.read(this.rawSource, {
        onSuccess: (tag) => {
          if (tag.tags.title) this.meta.title = tag.tags.title;
          if (tag.tags.artist) this.meta.artist = tag.tags.artist;
          this.normalizedName = normalise(`${this.meta.artist} ${this.meta.title}`);
          resolve(true);
        },
        onError: () => {
          console.warn("ID3 read failed:", this.filename);
          resolve(false);
        },
      });
    });

    // Load duration via Audio element (reads only the stream header, not the full file)
    await new Promise((resolve) => {
      // Skip duration loading for formats the browser likely can't decode
      const ext = this.filename.split(".").pop().toLowerCase();
      const decodable = ["mp3", "wav", "ogg", "m4a", "aac"];
      if (!decodable.includes(ext)) {
        resolve();
        return;
      }

      const url = URL.createObjectURL(this.rawSource);
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        this.duration = isFinite(audio.duration) ? Math.round(audio.duration) : -1;
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.src = url;
    });

    return tagsLoaded;
  }

  getBucketChar() {
    return this.normalizedName ? this.normalizedName[0] : null;
  }
}
