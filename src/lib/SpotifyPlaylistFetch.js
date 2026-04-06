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

/* ─── Module state ─────────────────────────────────────────── */

let CLIENT_ID = "";
let REDIRECT_URI = "";
let accessToken = null;

/* ─── Public API ───────────────────────────────────────────── */

async function init(clientId, redirectUri) {
  CLIENT_ID = clientId;
  REDIRECT_URI = redirectUri;

  // Restore persisted token
  const stored = localStorage.getItem("spotify_access_token");
  const expiry = Number(localStorage.getItem("spotify_token_expiry"));

  if (stored && expiry && Date.now() < expiry) {
    accessToken = stored;
  } else {
    accessToken = null;
    localStorage.removeItem("spotify_access_token");
  }

  // Handle redirect-back with auth code
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");

  if (code) {
    if (state !== localStorage.getItem("spotify_auth_state")) {
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

  localStorage.setItem("spotify_pkce_verifier", verifier);
  localStorage.setItem("spotify_auth_state", state);

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
  const expiry = Number(localStorage.getItem("spotify_token_expiry"));
  return !!(accessToken && expiry && Date.now() < expiry);
}

async function refreshToken() {
  const refresh = localStorage.getItem("spotify_refresh_token");
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

  accessToken = data.access_token;
  localStorage.setItem("spotify_access_token", accessToken);
  localStorage.setItem(
    "spotify_token_expiry",
    String(Date.now() + data.expires_in * 1000)
  );
  return true;
}

async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem("spotify_pkce_verifier");

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
  accessToken = data.access_token;

  localStorage.setItem("spotify_access_token", accessToken);
  localStorage.setItem(
    "spotify_token_expiry",
    String(Date.now() + data.expires_in * 1000)
  );

  if (data.refresh_token) {
    localStorage.setItem("spotify_refresh_token", data.refresh_token);
  }
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
  const metaRes = await fetch(`https://api.spotify.com/v1/playlists/${id}?fields=name`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

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
  let url = `https://api.spotify.com/v1/playlists/${id}/items`

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      if (res.status === 401) {
        // Token expired or revoked — force re-auth
        accessToken = null;
        localStorage.clear();
        throw new Error("Spotify session expired. Please log in again.");
      }

      if (res.status === 403) {
        // Valid token but access denied — do NOT wipe auth
        throw new Error(
          "Access denied by Spotify (403). If your app is in Development Mode, " +
          "add your account under 'Users and Access' in the Spotify Developer Dashboard. " +
          "If the playlist is private, make sure you own it or have been granted access."
        );
      }

      throw new Error(`Spotify API error: ${res.status}`);
    }

    const data = await res.json();
    if (results.length === 0 && data.items?.length > 0) {
      console.log("Spotify raw item sample:", JSON.stringify(data.items[0], null, 2));
    }

    results.push(
      ...data.items
        .map((i) => i.track ?? i.item ?? null)   // handle both field names
        .filter((t) => t && t.type === "track")  // keep only tracks, not episodes
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
  localStorage.removeItem("spotify_access_token");
  localStorage.removeItem("spotify_token_expiry");
  localStorage.removeItem("spotify_refresh_token");
  localStorage.removeItem("spotify_pkce_verifier");
  localStorage.removeItem("spotify_auth_state");
}

export const SpotifyPlaylistFetch = {
  init,
  loginIfNeeded,
  fetchFromUrl,
  isAuthenticated,
  disconnect,
};
