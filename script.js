// --- Constants ---
const SUPPORTED_EXTS = [".mp3", ".flac", ".wav", ".m4a", ".ogg"];

// --- UI Globals ---
const ui = {
    csv: document.getElementById("csvFile"),
    dir: document.getElementById("musicDir"),
    txt: document.getElementById("musicList"),
    root: document.getElementById("rockboxRoot"),
    log: document.getElementById("log"),
    progress: document.getElementById("progress"),
    errorBanner: document.getElementById("errorBanner"),
    errorMsg: document.getElementById("errorMessage"),
    btn: document.querySelector("button")
};

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

    // 1. Validation
    if (!ui.csv.files[0]) return showError("Please upload a CSV playlist.");
    
    // 2. Prepare File List
    let filesToProcess = [];
    if (ui.dir.files.length) {
        filesToProcess = Array.from(ui.dir.files).filter(f => 
            SUPPORTED_EXTS.some(ext => f.name.toLowerCase().endsWith(ext))
        );
    } else if (ui.txt.files[0]) {
        const text = await ui.txt.files[0].text();
        filesToProcess = text.split("\n")
            .map(l => l.trim())
            .filter(l => SUPPORTED_EXTS.some(ext => l.toLowerCase().endsWith(ext)));
    } else {
        return showError("Please select a music folder or upload a filename list.");
    }

    try {
        ui.btn.disabled = true;

        // 3. Initialize Objects
        const db = new MDatabase();
        const playlist = new Playlist();

        // 4. Build Database (Ingest Music)
        log(`Indexing ${filesToProcess.length} music files...`);
        
        // If the user hasn't manually typed a root, use the inferred one from the DB
        // We pass a callback to update the UI progress bar
        await db.ingest(filesToProcess, updateProgress);
        
        // Update UI with inferred root if empty
        if (!ui.root.value && db.rootPath) {
            ui.root.value = db.rootPath;
        }

        // 5. Parse Playlist
        log(`Parsing CSV...`);
        await playlist.parseCSV(ui.csv.files[0]);

        // 6. Run Matching (Worker)
        log(`Matching tracks...`);
        const matches = await playlist.matchAgainst(db, "matcher.worker.js", {
            onProgress: updateProgress
        });

        // 7. Feedback Logging
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
        const result = playlist.generateM3U8(ui.root.value);
        log(`\nDone! Matched ${result.count}/${result.total}. Downloading...`);
        
        playlist.download(result.content);

    } catch (err) {
        console.error(err);
        showError(err.message || "An unexpected error occurred.");
    } finally {
        ui.btn.disabled = false;
    }
}

// Browser capability check
window.onload = () => {
    if (!("webkitdirectory" in document.createElement("input"))) {
        ui.dir.style.display = "none";
        document.getElementById("dirSupportWarning").style.display = "block";
    }
};