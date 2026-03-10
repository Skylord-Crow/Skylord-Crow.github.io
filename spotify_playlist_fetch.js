/**
 * spotify_playlist_fetch.js
 *
 * Browser-only Spotify playlist fetcher using PKCE.
 * No backend required.
 *
 * Usage:
 *   await SpotifyPlaylistFetch.init(CLIENT_ID, REDIRECT_URI)
 *   await SpotifyPlaylistFetch.loginIfNeeded()
 *   const tracks = await SpotifyPlaylistFetch.fetchFromUrl(playlistUrl)
 */

const SpotifyPlaylistFetch = (() => {

    let CLIENT_ID = "e96819b4ea994c588fa3f09e9af3a496";
    let REDIRECT_URI = null;
    let accessToken = null;

    const SCOPES = [
        "playlist-read-private",
        "playlist-read-collaborative"
    ].join(" ");

    /* -----------------------------
       PKCE Helpers
    ----------------------------- */

    function base64url(buffer) {
        return btoa(String.fromCharCode(...new Uint8Array(buffer)))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
    }

    function generateRandomString(length = 64) {
        const possible =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

        const values = crypto.getRandomValues(new Uint8Array(length));

        return Array.from(values)
            .map(x => possible[x % possible.length])
            .join("");
    }

    async function generatePKCE() {

        const verifier = generateRandomString(64);

        const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier)
        );

        const challenge = base64url(digest);

        return { verifier, challenge };
    }

    function generateState() {
        return generateRandomString(16);
    }

    /* -----------------------------
       Public API
    ----------------------------- */

    async function init(clientId, redirectUri) {
        CLIENT_ID = clientId;
        REDIRECT_URI = redirectUri;

        // Try restoring token first
        const storedToken = localStorage.getItem("spotify_access_token");
        const expiry = localStorage.getItem("spotify_token_expiry");

        if (storedToken && expiry && Date.now() < expiry) {
            accessToken = storedToken;
        } else {
            accessToken = null;
            localStorage.removeItem("spotify_access_token");
        }

        // Handle redirect callback
        const params = new URLSearchParams(window.location.search);

        const code = params.get("code");
        const state = params.get("state");
        const storedState = localStorage.getItem("spotify_auth_state");

        if (code) {

            if (state !== storedState) {
                throw new Error("OAuth state mismatch.");
            }

            await exchangeCodeForToken(code);

            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    async function loginIfNeeded() {
        if (accessToken) return;

        const { verifier, challenge } = await generatePKCE();
        const state = generateState();

        localStorage.setItem("spotify_pkce_verifier", verifier);
        localStorage.setItem("spotify_auth_state", state);

        const authUrl = new URL("https://accounts.spotify.com/authorize");

        authUrl.search = new URLSearchParams({
            response_type: "code",
            client_id: CLIENT_ID,
            scope: SCOPES,
            //show_dialog: true,
            redirect_uri: REDIRECT_URI,
            code_challenge_method: "S256",
            code_challenge: challenge,
            state: state,
            show_dialog: true
        }).toString();

        window.location.href = authUrl.toString();
    }

    function isAuthenticated() {
        const expiry = localStorage.getItem("spotify_token_expiry");
        return accessToken && expiry && Date.now() < expiry;
    }

    async function refreshToken() {

        const refreshToken = localStorage.getItem("spotify_refresh_token");
        if (!refreshToken) return false;

        const response = await fetch(
            "https://accounts.spotify.com/api/token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    grant_type: "refresh_token",
                    refresh_token: refreshToken
                })
            }
        );

        const data = await response.json();

        if (data.access_token) {

            accessToken = data.access_token;

            localStorage.setItem("spotify_access_token", accessToken);
            localStorage.setItem(
                "spotify_token_expiry",
                Date.now() + data.expires_in * 1000
            );

            return true;
        }

        return false;
    }

    async function exchangeCodeForToken(code) {
        const verifier = localStorage.getItem("spotify_pkce_verifier");

        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                grant_type: "authorization_code",
                code,
                redirect_uri: REDIRECT_URI,
                code_verifier: verifier
            })
        });

        const data = await response.json();
        accessToken = data.access_token;

        localStorage.setItem("spotify_access_token", accessToken);
        localStorage.setItem(
            "spotify_token_expiry",
            Date.now() + data.expires_in * 1000
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

            if (!refreshed) {
                throw new Error("Spotify authentication expired.");
            }
        }

        const playlistId = extractPlaylistId(playlistUrl);
        if (!playlistId) {
            throw new Error("Invalid Spotify playlist URL.");
        }

        let results = [];
        let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;

        while (url) {
            console.log("Token:", accessToken);
            console.log(
                "Expires in:",
                Math.floor(
                    (localStorage.getItem("spotify_token_expiry") - Date.now()) / 1000
                ),
                "seconds"
            );
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    console.warn("Spotify token invalid, forcing re-auth");

                    accessToken = null;
                    localStorage.clear();

                    throw new Error("Spotify session invalid. Refresh to login again.");
                }
                throw new Error("Failed to fetch playlist.");
            }

            const data = await response.json();

            results.push(...data.items
                .filter(i => i.track)
                .map(item => ({
                    uri: item.track.uri,
                    name: item.track.name,
                    artists: item.track.artists.map(a => a.name).join(", ")
                }))
            );

            url = data.next;
        }

        return results;
    }

    return {
        init,
        loginIfNeeded,
        fetchFromUrl,
        isAuthenticated
    };

})();