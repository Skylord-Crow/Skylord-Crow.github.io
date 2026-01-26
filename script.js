/**
 * Supported audio file extensions for playlist generation.
 *
 * Files outside this list are ignored during indexing to
 * reduce unnecessary processing and memory usage.
 *
 * @constant {string[]}
 */
const SUPPORTED_EXTS = [".mp3", ".flac", ".wav", ".m4a", ".ogg"];

/**
 * Detects whether the browser supports directory uploads
 * via the non-standard `webkitdirectory` attribute.
 *
 * If unsupported, users must provide a text-based file list.
 *
 * @constant {boolean}
 */
const supportsDirectoryUpload =
    "webkitdirectory" in document.createElement("input");

/**
 * On page load, conditionally hides the directory upload UI
 * for unsupported browsers and displays a fallback warning.
 *
 * This ensures graceful degradation on older or mobile browsers.
 */
window.onload = () => {
    if (!supportsDirectoryUpload) {
        document.getElementById("musicDir").style.display = "none";
        document.getElementById("dirSupportWarning").style.display = "block";
    }
};

document.getElementById("musicDir").addEventListener("change", e => {
    const inferred = inferRockboxRootFromFiles(e.target.files);
    if (inferred) {
        document.getElementById("rockboxRoot").value = inferred;
    }
});

document.getElementById("musicList").addEventListener("change", async e => {
    const text = await e.target.files[0].text();
    const paths = text.split("\n").map(l => l.trim()).filter(Boolean);
    const inferred = inferRockboxRootFromFiles(paths);
    if (inferred) {
        document.getElementById("rockboxRoot").value = inferred;
    }
});


/**
 * Appends a log message to the on-page log output.
 *
 * Used to provide real-time feedback on matching success,
 * failures, and confidence levels.
 *
 * @param {string} msg Message to append
 */
function log(msg) {
    document.getElementById("log").textContent += msg + "\n";
}


/**
 * Builds a bucketed index of music files for fast fuzzy matching.
 *
 * Indexing strategy:
 *  - Extracts a relative file path suitable for playlist output
 *  - Normalises the filename (without extension)
 *  - Buckets entries by the first character of the normalised name
 *
 * Bucketing drastically reduces the search space during matching,
 * enabling acceptable performance even with large libraries.
 *
 * UI updates are throttled to avoid blocking the main thread.
 *
 * @param {File[]} files Uploaded music files
 * @returns {Promise<Object>} Music index keyed by initial character
 */
async function buildMusicIndex(files) {
    const index = {};
    let done = 0;

    for (const file of files) {
        const relPath = file.webkitRelativePath || file.name;

        const parts = relPath.split("/");
        const strippedPath =
            parts.length > 1 ? parts.slice(1).join("/") : parts[0];

        const filename = strippedPath.split("/").pop();
        const baseName = filename.replace(/\.[^.]+$/, "");
        const norm = normalise(baseName);

        if (!norm) continue;

        const bucket = norm[0];
        if (!index[bucket]) index[bucket] = [];

        index[bucket].push({ norm, path: strippedPath });

        done++;

        if (done % 250 === 0) {
            updateProgress(done, files.length);
            await new Promise(r => setTimeout(r, 0)); // UI breathe
        }
    }

    updateProgress(files.length, files.length);
    return index;
}

function inferRockboxRootFromFiles(files) {
    if (!files || files.length === 0) return null;

    // Directory upload case
    if (files[0] instanceof File && files[0].webkitRelativePath) {
        const firstPath = files[0].webkitRelativePath;
        const topLevel = firstPath.split("/")[0];
        return "/" + topLevel;
    }

    // TXT list case (array of strings)
    if (typeof files[0] === "string") {
        const splitPaths = files.map(p => p.split("/").filter(Boolean));
        if (!splitPaths.length) return null;

        let common = splitPaths[0][0];
        for (const parts of splitPaths) {
            if (parts[0] !== common) {
                return "/Music";
            }
        }
        return "/" + common;
    }

    return null;
}


/**
 * Updates the progress display with a percentage and counter.
 *
 * Used during both indexing and worker-based matching
 * to provide continuous feedback for long-running operations.
 *
 * @param {number} done Items processed
 * @param {number} total Total items
 */
function updateProgress(done, total) {
    const percent = Math.floor((done / total) * 100);
    document.getElementById("progress").textContent =
        `Processing… ${percent}% (${done}/${total})`;
}
  
/**
 * Main application entry point.
 *
 * Responsibilities:
 *  - Validate user input
 *  - Load music files (directory or text fallback)
 *  - Build the music index
 *  - Parse the CSV playlist
 *  - Delegate matching to a Web Worker
 *  - Generate and download an M3U8 playlist
 *
 * Heavy matching work is offloaded to a Web Worker to
 * keep the UI responsive.
 */
async function generate() {
    const csvFile = document.getElementById("csvFile").files[0];
    const dirFiles = document.getElementById("musicDir").files;
    const txtFile = document.getElementById("musicList").files[0];
    const rockboxRoot = document.getElementById("rockboxRoot").value;

    if (!csvFile) {
        alert("Please upload a CSV playlist.");
        return;
    }

    let musicPaths = [];

    if (supportsDirectoryUpload && dirFiles.length) {
        musicPaths = Array.from(dirFiles).filter(f =>
            SUPPORTED_EXTS.some(ext => f.name.toLowerCase().endsWith(ext))
        );

    } else if (txtFile) {
        const text = await txtFile.text();
        musicPaths = text
            .split("\n")
            .map(l => l.trim())
            .filter(l =>
                SUPPORTED_EXTS.some(ext => l.toLowerCase().endsWith(ext))
            );
    } else {
        alert("Please select a music folder or upload a filename list.");
        return;
    }

    const inferredRoot = inferRockboxRootFromFiles(musicPaths);
    const rootInput = document.getElementById("rockboxRoot");

    if (inferredRoot && !rootInput.value) {
        rootInput.value = inferredRoot;
    }

    log(`Indexing ${musicPaths.length} music files…`);
    const musicIndex = await buildMusicIndex(musicPaths);

    const csvText = await csvFile.text();
    const parsed = Papa.parse(csvText, { header: true });

    const validRows = parsed.data.filter(r => r["Track Name"]);
    const trackNames = validRows.map(r => r["Track Name"]);

    //log("Starting worker...")
    const worker = new Worker("matcher.worker.js");

    worker.postMessage({
        tracks: trackNames,
        index: musicIndex
    });

    worker.onmessage = e => {
        if (e.data.progress !== undefined) {
            updateProgress(e.data.progress, trackNames.length);
            return;
        }

        if (e.data.done) {
            const matches = e.data.results;
            let output = "#EXTM3U\n";
            let matched = 0;

            matches.forEach((match, i) => {
                const track = trackNames[i];
                //log(`Finding track ${track}`)

                if (match) {
                    output += `${rockboxRoot}/${match.path}\n`;
                    matched++;

                    log(
                        match.level === "high"
                            ? `✔ ${track} (${match.score.toFixed(2)})`
                            : `⚠ ${track} (${match.score.toFixed(2)})`
                    );
                } else {
                    log(`✘ No match: ${track}`);
                }
            });

            updateProgress(trackNames.length, trackNames.length);
            log(`Matched ${matched}/${trackNames.length}.`);

            const blob = new Blob([output], { type: "audio/x-mpegurl" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = csvFile.name.replace(/\.[^.]+$/, "") + ".m3u8";
            a.click();

            worker.terminate();
        }
    };
}
  
  
