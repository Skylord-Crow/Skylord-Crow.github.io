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
  "feat", "ft", "the", "and",
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
    text = text.replace(new RegExp(`\\b${w}\\b`, "g"), "");
  }

  return text.replace(/\s+/g, " ").trim();
}

/**
 * Minimum similarity threshold for a valid fuzzy match.
 * @constant {number}
 */
export const MIN_SIMILARITY = 0.6;
