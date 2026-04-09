import { normalise, MIN_SIMILARITY, MIN_KEY_LENGTH } from "../lib/matcherUtils.js";

/* ─── Algorithms ───────────────────────────────────────────── */

function fastReject(a, b) {
  const r = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return r < 0.6;
}

function similarity(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return (2 * dp[a.length][b.length]) / (a.length + b.length);
}

function tokenScore(a, b) {
  const A = new Set(a.split(" "));
  const B = new Set(b.split(" "));
  const common = [...A].filter((x) => B.has(x)).length;
  return common / Math.max(A.size, B.size);
}

function findBestMatch(trackName, index) {
  const key = normalise(trackName);
  if (!key) return null;

  // Reject keys that are too short — prevents short titles like "Dog"
  // or "Key" from producing false positive matches above MIN_SIMILARITY.
  if (key.length < MIN_KEY_LENGTH) return null;

  const buckets = new Set([
    key[0],
    String.fromCharCode(key.charCodeAt(0) - 1),
    String.fromCharCode(key.charCodeAt(0) + 1),
  ]);

  let best = null;
  let bestScore = 0;

  for (const b of buckets) {
    for (const item of index[b] || []) {
      if (fastReject(key, item.norm)) continue;

      const score =
        similarity(key, item.norm) * 0.7 + tokenScore(key, item.norm) * 0.3;

      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
  }

  if (bestScore >= 0.8) return { ...best, score: bestScore, level: "high" };
  if (bestScore >= MIN_SIMILARITY)
    return { ...best, score: bestScore, level: "medium" };
  return null;
}

/* ─── Worker entry point ───────────────────────────────────── */

self.onmessage = (e) => {
  const { tracks, index } = e.data;
  const results = [];

  // Batch log updates — posting a message on every iteration causes
  // React to re-render the log panel for each track, which is slow for
  // large playlists. Post every 10 results instead.
  const PROGRESS_INTERVAL = 10;

  for (let i = 0; i < tracks.length; i++) {
    results.push(findBestMatch(tracks[i], index));

    if (i % PROGRESS_INTERVAL === 0) {
      self.postMessage({ progress: i + 1 });
    }
  }

  self.postMessage({ done: true, results });
};