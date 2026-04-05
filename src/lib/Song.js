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

    return new Promise((resolve) => {
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
  }

  getBucketChar() {
    return this.normalizedName ? this.normalizedName[0] : null;
  }
}
