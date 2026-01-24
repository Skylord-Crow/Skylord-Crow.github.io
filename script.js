const SUPPORTED_EXTS = [".mp3", ".flac", ".wav", ".m4a", ".ogg"];
const MIN_SIMILARITY = 0.45;
const supportsDirectoryUpload =
    "webkitdirectory" in document.createElement("input");

window.onload = () => {
    if (!supportsDirectoryUpload) {
        document.getElementById("musicDir").style.display = "none";
        document.getElementById("dirSupportWarning").style.display = "block";
    }
};

function log(msg) {
    document.getElementById("log").textContent += msg + "\n";
}

function getMusicFilesFromDirectory(fileList) {
    return Array.from(fileList)
        .map(f => f.webkitRelativePath || f.name)
        .filter(name =>
            SUPPORTED_EXTS.some(ext => name.toLowerCase().endsWith(ext))
        );
}
  

function normalise(text) {
    return text
        .toLowerCase()
        .replace(/\(.*?\)/g, "")
        .replace(/[^a-z0-9 ]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function similarity(a, b) {
    const matrix = Array(a.length + 1)
        .fill(null)
        .map(() => Array(b.length + 1).fill(0));

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            if (a[i - 1] === b[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1] + 1;
            } else {
                matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
            }
        }
    }

    const lcs = matrix[a.length][b.length];
    return (2 * lcs) / (a.length + b.length);
}
  

function buildMusicIndex(filePaths) {
    const index = {};

    for (const path of filePaths) {
        const filename = path.split("/").pop();
        const base = filename.replace(/\.[^.]+$/, "");
        const norm = normalise(base);
        const key = norm[0] || "_";

        if (!index[key]) index[key] = [];
        index[key].push({ path, norm });
    }
    console.log("Index sample:", Object.values(musicIndex)[0]?.slice(0, 3));
    return index;
}
  
function findBestMatch(track, index) {
    const key = normalise(track);
    const bucketKey = key[0] || "_";

    const candidates =
        index[bucketKey] ||
        Object.values(index).flat(); // fallback

    let bestScore = 0;
    let bestPath = null;

    for (const item of candidates) {
        const score = similarity(key, item.norm);
        if (score > bestScore) {
            bestScore = score;
            bestPath = item.path;
        }
    }

    return bestScore >= MIN_SIMILARITY ? bestPath : null;
}

function updateProgress(done, total) {
    const percent = Math.floor((done / total) * 100);
    document.getElementById("progress").textContent =
        `Processing… ${percent}% (${done}/${total})`;
}
  

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
        musicPaths = Array.from(dirFiles)
            .map(f => f.webkitRelativePath)
            .filter(p =>
                SUPPORTED_EXTS.some(ext => p.toLowerCase().endsWith(ext))
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

    log(`Indexing ${musicPaths.length} music files…`);
    const musicIndex = buildMusicIndex(musicPaths);

    const csvText = await csvFile.text();
    const parsed = Papa.parse(csvText, { header: true });

    let output = "#EXTM3U\n";
    let matched = 0;
    let processed = 0;

    for (const row of parsed.data) {
        const track = row["Track Name"];
        if (!track) continue;

        processed++;
        const match = findBestMatch(track, musicIndex);

        if (match) {
            output += `${rockboxRoot}/${match}\n`;
            matched++;
        } else {
            log(`No match: ${track}`);
        }

        if (processed % 5 === 0) {
            updateProgress(processed, parsed.data.length);
            await new Promise(r => setTimeout(r, 0)); // UI breathe
        }
    }

    updateProgress(parsed.data.length, parsed.data.length);
    log(`Matched ${matched}/${parsed.data.length}`);

    const blob = new Blob([output], { type: "audio/x-mpegurl" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "playlist.m3u8";
    a.click();
}
  
  
