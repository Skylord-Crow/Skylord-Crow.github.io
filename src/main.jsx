import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import App from "./App.jsx";
import { SpotifyPlaylistFetch } from "./lib/SpotifyPlaylistFetch.js";

const SPOTIFY_CLIENT_ID = "e96819b4ea994c588fa3f09e9af3a496";

// Derive the correct redirect URI for both local dev and GitHub Pages.
// On GitHub Pages the app lives at https://user.github.io/repo-name/
// so we use the full href minus any query/hash, not just origin.
const redirectUri = window.location.href
  .split("?")[0]
  .split("#")[0]
  .replace(/\/$/, "");

// Run synchronously before React mounts so the ?code= param is
// always caught on the first pass, regardless of React lifecycle.
const spotifyReady = SpotifyPlaylistFetch.init(SPOTIFY_CLIENT_ID, redirectUri);

spotifyReady.then(() => {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});