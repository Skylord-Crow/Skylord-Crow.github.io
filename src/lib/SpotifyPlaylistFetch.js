/**
 * Browser-only Spotify playlist fetcher using PKCE (no backend required).
 *
 * Usage:
 *   await SpotifyPlaylistFetch.init(CLIENT_ID, REDIRECT_URI)
 *   await SpotifyPlaylistFetch.loginIfNeeded()
 *   const tracks = await SpotifyPlaylistFetch.fetchFromUrl(playlistUrl)
 */

const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

/* ─── PKCE helpers ─────────────────────────────────────────── */

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateRandomString(length = 64) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values)
    .map((x) => chars[x % chars.length])
    .join("");
}

async function generatePKCE() {
  const verifier = generateRandomString(64);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return { verifier, challenge: base64url(digest) };
}

/* ─── Spotify key helpers ──────────────────────────────────── */

// Centralised key names so they're never mistyped across functions
const KEYS = {
  accessToken: "spotify_access_token",
  tokenExpiry: "spotify_token_expiry",
  refreshToken: "spotify_refresh_token",
  pkceVerifier: "spotify_pkce_verifier",
  authState: "spotify_auth_state",
};

function clearSpotifyStorage() {
  // Only removes Spotify-specific keys — does NOT wipe the entire
  // localStorage origin, which would affect unrelated app state.
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
}

function persistToken(data) {
  accessToken = data.access_token;
  localStorage.setItem(KEYS.accessToken, accessToken);
  localStorage.setItem(
    KEYS.tokenExpiry,
    String(Date.now() + data.expires_in * 1000)
  );
  // Persist rotated refresh token if Spotify issues a new one
  if (data.refresh_token) {
    localStorage.setItem(KEYS.refreshToken, data.refresh_token);
  }
}

/* ─── Module state ─────────────────────────────────────────── */

let CLIENT_ID = "";
let REDIRECT_URI = "";
let accessToken = null;

/* ─── Public API ───────────────────────────────────────────── */

async function init(clientId, redirectUri) {
  CLIENT_ID = clientId;
  REDIRECT_URI = redirectUri;

  // Restore persisted token
  const stored = localStorage.getItem(KEYS.accessToken);
  const expiry = Number(localStorage.getItem(KEYS.tokenExpiry));

  if (stored && expiry && Date.now() < expiry) {
    accessToken = stored;
  } else {
    accessToken = null;
    localStorage.removeItem(KEYS.accessToken);

    // Attempt silent refresh on startup so a returning user with an
    // expired access token but valid refresh token stays connected.
    await refreshToken();
  }

  // Handle redirect-back with auth code
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");

  if (code) {
    if (state !== localStorage.getItem(KEYS.authState)) {
      throw new Error("OAuth state mismatch.");
    }
    await exchangeCodeForToken(code);
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

async function loginIfNeeded() {
  if (accessToken) return;

  const { verifier, challenge } = await generatePKCE();
  const state = generateRandomString(16);

  localStorage.setItem(KEYS.pkceVerifier, verifier);
  localStorage.setItem(KEYS.authState, state);

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    show_dialog: "true",
  }).toString();

  window.location.href = authUrl.toString();
}

function isAuthenticated() {
  const expiry = Number(localStorage.getItem(KEYS.tokenExpiry));
  return !!(accessToken && expiry && Date.now() < expiry);
}

async function refreshToken() {
  const refresh = localStorage.getItem(KEYS.refreshToken);
  if (!refresh) return false;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refresh,
    }),
  });

  const data = await res.json();
  if (!data.access_token) return false;

  // persistToken handles rotated refresh tokens automatically
  persistToken(data);
  return true;
}

async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem(KEYS.pkceVerifier);

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  const data = await res.json();
  persistToken(data);

  // Clean up one-time PKCE/state keys — they're no longer needed
  localStorage.removeItem(KEYS.pkceVerifier);
  localStorage.removeItem(KEYS.authState);
}

function extractPlaylistId(url) {
  const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

async function fetchFromUrl(playlistUrl) {
  if (!isAuthenticated()) {
    const refreshed = await refreshToken();
    if (!refreshed) throw new Error("Spotify authentication expired.");
  }

  const id = extractPlaylistId(playlistUrl);
  if (!id) throw new Error("Invalid Spotify playlist URL.");

  // Fetch playlist metadata (name) separately
  const metaRes = await fetch(
    `https://api.spotify.com/v1/playlists/${id}?fields=name`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!metaRes.ok) {
    if (metaRes.status === 403) {
      throw new Error(
        "Access denied by Spotify (403). Check Development Mode user allowlist or playlist privacy."
      );
    }
    throw new Error(`Failed to fetch playlist metadata: ${metaRes.status}`);
  }

  const meta = await metaRes.json();
  const results = [];
  let url = `https://api.spotify.com/v1/playlists/${id}/items`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      if (res.status === 401) {
        // Token expired or revoked — clear only Spotify keys, not all localStorage
        clearSpotifyStorage();
        accessToken = null;
        throw new Error("Spotify session expired. Please log in again.");
      }
      if (res.status === 403) {
        throw new Error(
          "Access denied by Spotify (403). If your app is in Development Mode, " +
          "add your account under 'Users and Access' in the Spotify Developer Dashboard. " +
          "If the playlist is private, make sure you own it or have been granted access."
        );
      }
      throw new Error(`Spotify API error: ${res.status}`);
    }

    const data = await res.json();

    // Debug: log first raw item to confirm field structure
    if (results.length === 0 && data.items?.length > 0) {
      console.log("Spotify raw item sample:", JSON.stringify(data.items[0], null, 2));
    }

    results.push(
      ...data.items
        .map((i) => i.track ?? i.item ?? null)  // handle both field names
        .filter((t) => t && t.type === "track") // drop episodes and nulls
        .map((track) => ({
          uri: track.uri,
          name: track.name,
          artists: track.artists.map((a) => a.name).join(", "),
        }))
    );

    url = data.next;
  }

  return { name: meta.name, tracks: results };
}

function disconnect() {
  accessToken = null;
  clearSpotifyStorage();
}

export const SpotifyPlaylistFetch = {
  init,
  loginIfNeeded,
  fetchFromUrl,
  isAuthenticated,
  disconnect,
};