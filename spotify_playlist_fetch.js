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

    let CLIENT_ID = null;
    let REDIRECT_URI = "https://can-bot.github.io/";
    let accessToken = null;

    /* -----------------------------
       PKCE Helpers
    ----------------------------- */

    function base64url(buffer) {
        return btoa(String.fromCharCode(...new Uint8Array(buffer)))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
    }

    async function generatePKCE() {
        const random = crypto.getRandomValues(new Uint8Array(32));
        const verifier = base64url(random);

        const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier)
        );

        const challenge = base64url(digest);

        return { verifier, challenge };
    }

    /* -----------------------------
       Public API
    ----------------------------- */

    async function init(clientId, redirectUri) {
        CLIENT_ID = clientId;
        REDIRECT_URI = redirectUri;

        // Handle redirect callback automatically
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        if (code) {
            await exchangeCodeForToken(code);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    async function loginIfNeeded() {
        if (accessToken) return;

        const { verifier, challenge } = await generatePKCE();
        localStorage.setItem("spotify_pkce_verifier", verifier);

        const authUrl = new URL("https://accounts.spotify.com/authorize");
        authUrl.search = new URLSearchParams({
            response_type: "code",
            client_id: CLIENT_ID,
            scope: "playlist-read-private playlist-read-collaborative",
            redirect_uri: REDIRECT_URI,
            code_challenge_method: "S256",
            code_challenge: challenge
        });

        window.location = authUrl.toString();
    }

    function isAuthenticated() {
        return !!accessToken;
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
    }

    function extractPlaylistId(url) {
        const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
        return match ? match[1] : null;
    }

    async function fetchFromUrl(playlistUrl) {
        if (!accessToken) {
            throw new Error("User not authenticated with Spotify.");
        }

        const playlistId = extractPlaylistId(playlistUrl);
        if (!playlistId) {
            throw new Error("Invalid Spotify playlist URL.");
        }

        let results = [];
        let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

        while (url) {
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            });

            if (!response.ok) {
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