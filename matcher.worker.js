
importScripts("matcher.utils.js");


/**
 * Minimum similarity threshold required for a track to be
 * considered a valid fuzzy match.
 *
 * Values below this are treated as "no match" to avoid
 * accidental false positives in large libraries.
 *
 * @constant {number}
 */
const MIN_SIMILARITY = 0.60;

/**
 * Performs a fast length-based rejection check before
 * running expensive similarity algorithms.
 *
 * If two strings differ too much in length, they are
 * extremely unlikely to be the same track.
 *
 * This optimisation significantly improves performance
 * for large music libraries.
 *
 * @param {string} a Normalised query string
 * @param {string} b Normalised candidate string
 * @returns {boolean} True if comparison should be skipped
 */
function fastReject(a, b) {
    const r = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return r < 0.6;
}

/**
 * Computes a similarity score based on the
 * Longest Common Subsequence (LCS) algorithm.
 *
 * LCS measures how much ordered character overlap exists
 * between two strings, making it robust against minor edits,
 * missing words, or formatting differences.
 *
 * Score is normalised to the range [0, 1].
 *
 * @param {string} a Normalised query string
 * @param {string} b Normalised candidate string
 * @returns {number} Similarity score
 */
function similarity(a, b) {
    const dp = Array(a.length + 1)
        .fill(0)
        .map(() => Array(b.length + 1).fill(0));

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] =
                a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1] + 1
                    : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }

    const lcs = dp[a.length][b.length];
    return (2 * lcs) / (a.length + b.length);
}

/**
 * Computes token-level similarity between two strings.
 *
 * Measures the proportion of shared words between both
 * strings, ignoring order and duplicates.
 *
 * This complements LCS by capturing semantic similarity
 * when word ordering differs.
 *
 * @param {string} a Normalised query string
 * @param {string} b Normalised candidate string
 * @returns {number} Token overlap score
 */
function tokenScore(a, b) {
    const A = new Set(a.split(" "));
    const B = new Set(b.split(" "));
    const common = [...A].filter(x => B.has(x)).length;
    return common / Math.max(A.size, B.size);
}

/**
 * Attempts to find the best matching music file for a given
 * track name using fuzzy matching.
 *
 * Matching strategy:
 *  - Normalise the query
 *  - Search a limited set of alphabet buckets for performance
 *  - Apply fast length rejection
 *  - Compute a weighted similarity score:
 *      - 70% LCS similarity
 *      - 30% token overlap
 *
 * Returns confidence metadata to allow the UI to distinguish
 * between strong and weak matches.
 *
 * @param {string} trackName Track name from CSV
 * @param {Object} index Pre-built music index
 * @returns {{path: string, norm: string, score: number, level: string}|null}
 */
function findBestMatch(trackName, index) {

    const key = normalise(trackName);
    if (!key) return null;

    const buckets = new Set([
        key[0],
        String.fromCharCode(key.charCodeAt(0) - 1),
        String.fromCharCode(key.charCodeAt(0) + 1)
    ]);

    let best = null;
    let bestScore = 0;

    for (const b of buckets) {
        for (const item of index[b] || []) {
            if (fastReject(key, item.norm)) continue;

            const score =
                similarity(key, item.norm) * 0.7 +
                tokenScore(key, item.norm) * 0.3;

            if (score > bestScore) {
                bestScore = score;
                best = item;
            }
        }
    }

    if (bestScore >= 0.8) return { ...best, score: bestScore, level: "high" };
    if (bestScore >= MIN_SIMILARITY) return { ...best, score: bestScore, level: "medium" };
    return null;
}


/**
 * Web Worker entry point.
 *
 * Receives:
 *  - tracks: Array of track names from the CSV
 *  - index: Pre-built music file index
 *
 * Sends:
 *  - Periodic progress updates for UI feedback
 *  - Final match results once processing is complete
 *
 * Offloading this work to a Web Worker prevents UI freezing
 * when matching against large music libraries.
 */
self.onmessage = e => {
    const { tracks, index } = e.data;
    const results = [];

    for (let i = 0; i < tracks.length; i++) {
        results.push(findBestMatch(tracks[i], index));
        if (i % 5 === 0) {
            self.postMessage({ progress: i + 1 });
        }        
    }

    self.postMessage({ done: true, results });
};
