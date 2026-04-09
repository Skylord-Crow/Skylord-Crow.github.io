/**
 * Common non-essential words frequently found in music filenames
 * or streaming metadata that do not meaningfully distinguish tracks.
 *
 * @constant {string[]}
 */
export const STOPWORDS = [
  "official", "video", "audio",
  "remaster", "remastered",
  "mix", "mono", "stereo",
  "version", "edit", "live",
  "feat", "ft",
];

/**
 * Normalises a track title or filename for fuzzy matching.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalise(text) {
  if (!text) return "";

  text = text
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const w of STOPWORDS) {
    // Use word boundaries only when the word is 3+ characters to avoid
    // mangling short tokens adjacent to numbers or special characters
    const pattern =
      w.length >= 3
        ? new RegExp(`\\b${w}\\b`, "g")
        : new RegExp(`(^|\\s)${w}(\\s|$)`, "g");
    text = text.replace(pattern, " ");
  }

  return text.replace(/\s+/g, " ").trim();
}

/**
 * Minimum similarity threshold for a valid fuzzy match.
 * @constant {number}
 */
export const MIN_SIMILARITY = 0.6;

/**
 * Minimum length (characters) a normalised key must have before a match
 * is accepted. Prevents short titles like "Dog" or "Key" scoring false
 * positives against unrelated tracks.
 *
 * @constant {number}
 */
export const MIN_KEY_LENGTH = 4;