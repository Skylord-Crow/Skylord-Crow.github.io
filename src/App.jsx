import { useState, useEffect } from "react";
import { PlaylistSource } from "./components/PlaylistSource.jsx";
import { MusicLibrary } from "./components/MusicLibrary.jsx";
import { GenerateSection } from "./components/GenerateSection.jsx";
import { ErrorBanner } from "./components/ErrorBanner.jsx";
import { SpotifyPlaylistFetch } from "./lib/SpotifyPlaylistFetch.js";
import { useGenerator } from "./hooks/useGenerator.js";

export default function App() {
  const [mode, setMode] = useState("spotify");
  const [spotifyConnected, setSpotifyConnected] = useState(
    // Init already ran before mount — read auth state synchronously
    SpotifyPlaylistFetch.isAuthenticated()
  );
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [csvFile, setCsvFile] = useState(null);
  const [playlistDirFiles, setPlaylistDirFiles] = useState([]);
  const [musicFiles, setMusicFiles] = useState([]);

  const { logs, progress, isRunning, error, generate, clearError } =
    useGenerator();

  function validateAndGenerate() {
    clearError();
    if (mode === "csv" && !csvFile)
      return alert("Please upload a CSV playlist.");
    if (mode === "spotify" && !spotifyUrl.trim())
      return alert("Please enter a Spotify playlist URL.");
    if (!musicFiles.length)
      return alert("Please select a music folder.");

    generate({ mode, csvFile, spotifyUrl: spotifyUrl.trim(), musicFiles, playlistDirFiles });
  }

  return (
    <div className="container">
      <header>
        <h1>
          <a href="https://github.com/Can-Bot/can-bot.github.io" title="View on GitHub">
            M3U8 Maker
          </a>
        </h1>
        <small>v1.0.0-beta · .m3u8 Generator</small>
      </header>

      <ErrorBanner message={error} onDismiss={clearError} />

      <PlaylistSource
        mode={mode}
        onModeChange={setMode}
        spotifyConnected={spotifyConnected}
        spotifyUrl={spotifyUrl}
        onSpotifyUrlChange={setSpotifyUrl}
        onSpotifyLogin={() => SpotifyPlaylistFetch.loginIfNeeded()}
        csvFile={csvFile}
        onCsvChange={setCsvFile}
        dirFiles={playlistDirFiles}
        onDirChange={setPlaylistDirFiles}
      />

      <MusicLibrary
        musicFiles={musicFiles}
        onMusicFilesChange={setMusicFiles}
        progress={isRunning ? progress : null}
      />

      <GenerateSection
        onGenerate={validateAndGenerate}
        isRunning={isRunning}
        logs={logs}
      />

      <footer>
        <span>🔒</span> All processing happens locally — no data leaves your machine.
      </footer>
    </div>
  );
}