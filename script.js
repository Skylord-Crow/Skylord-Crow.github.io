// --- Constants ---
const SUPPORTED_EXTS = [".mp3", ".flac", ".wav", ".m4a", ".ogg"];

// --- UI Globals ---
const ui = {
    csv: document.getElementById("csvFile"),
    dir: document.getElementById("musicDir"),
    txt: document.getElementById("musicList"),
    log: document.getElementById("log"),
    progress: document.getElementById("progress"),
    errorBanner: document.getElementById("errorBanner"),
    errorMsg: document.getElementById("errorMessage"),
    btn: document.querySelector("button"),
    plInput: document.getElementById("spotifyPlaylistInput"),
    spotifyUrl: document.getElementById("spotifyUrl"),
    spotifyLogin: document.getElementById("spotifyLoginBtn"),
    modeRadios: document.querySelectorAll("input[name='mode']")
};

function getSelectedMode() {
    return document.querySelector("input[name='mode']:checked")?.value;
}

ui.modeRadios.forEach(radio => {
    radio.addEventListener("change", () => {
        document.getElementById("spotifyMode").style.display =
            radio.value === "spotify" ? "block" : "none";

        document.getElementById("csvMode").style.display =
            radio.value === "csv" ? "block" : "none";

        document.getElementById("dirMode").style.display =
            radio.value === "dir" ? "block" : "none";
    });
});

// --- Helper Functions ---
const log = (msg) => ui.log.textContent += msg + "\n";

const updateProgress = (done, total) => {
    const percent = Math.floor((done / total) * 100);
    ui.progress.textContent = `Processing… ${percent}% (${done}/${total})`;
};

const showError = (msg) => {
    ui.errorMsg.textContent = msg;
    ui.errorBanner.classList.remove("hidden");
    ui.errorBanner.scrollIntoView({ behavior: "smooth" });
};

document.getElementById("errorClose").onclick = () => ui.errorBanner.classList.add("hidden");

// --- Main Generation Logic ---
async function generate() {

    ui.errorBanner.classList.add("hidden");
    ui.log.textContent = "";

    const mode = getSelectedMode();

    // 1. Validate playlist source
    if (mode === "csv" && !ui.csv.files[0]) {
        return showError("Please upload a CSV playlist.");
    }

    if (mode === "spotify" && !ui.spotifyUrl.value.trim()) {
        return showError("Please enter a Spotify playlist URL.");
    }

    // 2. Prepare File List (music database input)
    let filesToProcess = [];

    if (ui.dir.files.length) {
        filesToProcess = Array.from(ui.dir.files).filter(f =>
            SUPPORTED_EXTS.some(ext =>
                f.webkitRelativePath.toLowerCase().endsWith(ext)
            )
        );
    }
    else if (ui.txt.files[0]) {
        const text = await ui.txt.files[0].text();

        filesToProcess = text.split("\n")
            .map(l => l.trim())
            .filter(l =>
                SUPPORTED_EXTS.some(ext =>
                    l.toLowerCase().endsWith(ext)
                )
            );
    }
    else {
        return showError("Please select a music folder or upload a filename list.");
    }

    try {
        ui.btn.disabled = true;

        // 3. Initialize Objects
        const db = new MDatabase();
        const playlist = new Playlist();

        // 4. Build Database
        log(`Indexing ${filesToProcess.length} music files...`);
        await db.ingest(filesToProcess, updateProgress);

        // 5. Parse Playlist Source
        if (mode === "spotify") {
            if (!SpotifyPlaylistFetch.isAuthenticated()) {
                throw new Error("Please login to Spotify first.");
            }

            await playlist.parseSpotify(ui.spotifyUrl.value.trim());
        }
        
        else if (mode === "csv") {
            log("Parsing CSV...");
            await playlist.parseCSV(ui.csv.files[0]);
        }

        // 6. Run Matching
        log("Matching tracks...");
        const matches = await playlist.matchAgainst(
            db,
            "matcher.worker.js",
            { onProgress: updateProgress }
        );

        // 7. Logging Results
        matches.forEach((m, i) => {
            const name = playlist.tracksToFind[i];

            if (m) {
                const icon = m.level === "high" ? "✔" : "⚠";
                log(`${icon} ${name} -> ${m.path} (${m.score.toFixed(2)})`);
            } else {
                log(`✘ No match: ${name}`);
            }
        });

        // 8. Generate & Download
        const result = playlist.generateM3U8(db.rootPath);

        log(`\nDone! Matched ${result.count}/${result.total}. Downloading...`);

        playlist.download(result.content);

    }
    catch (err) {
        console.error(err);
        showError(err.message || "An unexpected error occurred.");
    }
    finally {
        ui.btn.disabled = false;
    }
}

// Browser capability check
window.onload = async () => {
    if (!("webkitdirectory" in document.createElement("input"))) {
        ui.dir.style.display = "none";
        document.getElementById("dirSupportWarning").style.display = "block";
    }
    // --- Spotify Init ---
    console.log(window.location.origin);
    await SpotifyPlaylistFetch.init(
        "e96819b4ea994c588fa3f09e9af3a496",
        window.location.origin
    );

    ui.spotifyLogin?.addEventListener("click", () => {
        SpotifyPlaylistFetch.loginIfNeeded();
    });

    //If token exists, update UI
    if (SpotifyPlaylistFetch.isAuthenticated?.()) {
        ui.spotifyLogin.textContent = "Connected to Spotify";
        ui.spotifyLogin.style.backgroundColor = "#191414";
        ui.spotifyLogin.style.color = "#2fff78";
        ui.spotifyLogin.disabled = true;
        ui.plInput.style.display = "block";
    }
};