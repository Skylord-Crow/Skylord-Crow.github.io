/**
 * Represents a single audio file in the user's library.
 */
class Song {
    constructor(fileOrPath) {
        this.isFileObject = fileOrPath instanceof File;
        this.rawSource = fileOrPath;
        
        // Relative path for the M3U8 output
        this.relativePath = this.isFileObject 
            ? (fileOrPath.webkitRelativePath || fileOrPath.name)
            : fileOrPath;

        const parts = this.relativePath.split("/");
        this.filename = parts.pop();
        
        // Default to filename-based matching initially
        this.meta = {
            title: this.filename.replace(/\.[^.]+$/, ""),
            artist: ""
        };

        // We will update this after ID3 parsing
        this.normalizedName = this._normalize(this.meta.title);
    }

    /**
     * Asynchronously reads ID3 tags using jsmediatags
     */
    async loadMetadata() {
        // We can only read tags if we have the actual File object (not just a text path)
        if (!this.isFileObject) return;

        return new Promise((resolve) => {
            window.jsmediatags.read(this.rawSource, {
                onSuccess: (tag) => {
                    // Update meta if tags exist
                    if (tag.tags.title) this.meta.title = tag.tags.title;
                    if (tag.tags.artist) this.meta.artist = tag.tags.artist;

                    // Re-generate the normalized string using Artist + Title
                    // This creates a much stronger search key than filename alone
                    const combined = `${this.meta.artist} ${this.meta.title}`;
                    this.normalizedName = this._normalize(combined);
                    resolve(true);
                },
                onError: (error) => {
                    // If parsing fails, we silently keep the filename-based defaults
                    console.warn("ID3 read failed:", this.filename);
                    resolve(false);
                }
            });
        });
    }

    _normalize(text) {
        if (!text) return "";
        const STOPWORDS = [
            "official", "video", "audio", "remaster", "remastered",
            "mix", "mono", "stereo", "version", "edit", "live", "feat", "ft",
            "the", "and" // Added "the" and "and" for better artist matching
        ];

        text = text.toLowerCase()
            .replace(/\(.*?\)/g, "") // Remove (...)
            .replace(/\[.*?\]/g, "") // Remove [...]
            .replace(/[^a-z0-9 ]/g, " ") // Remove punctuation
            .replace(/\s+/g, " ")
            .trim();

        for (const w of STOPWORDS) {
            text = text.replace(new RegExp(`\\b${w}\\b`, "g"), "");
        }
        return text.replace(/\s+/g, " ").trim();
    }

    getBucketChar() {
        return this.normalizedName ? this.normalizedName[0] : null;
    }
}

/**
 * Manages the collection of Songs and the Index used for matching.
 */
class MDatabase {
    constructor() {
        this.songs = [];
        this.index = {};
        this.rootPath = "/Music";
    }

    /**
     * Ingests files, reads ID3 tags in batches, and builds the index.
     */
    async ingest(files, onProgress) {
        this.songs = [];
        this.index = {};
        
        this.rootPath = this._inferRoot(files) || this.rootPath;

        // Configuration: How many files to read in parallel.
        // Reading headers is disk-intensive. 50 is a safe balance for browsers.
        const BATCH_SIZE = 50; 
        
        let processedCount = 0;

        // 1. Create Song objects (Synchronous)
        const allSongs = files.map(f => new Song(f));

        // 2. Process Metadata (Asynchronous Batches)
        for (let i = 0; i < allSongs.length; i += BATCH_SIZE) {
            const batch = allSongs.slice(i, i + BATCH_SIZE);
            
            // Trigger ID3 reads for this batch
            await Promise.all(batch.map(song => song.loadMetadata()));

            processedCount += batch.length;
            if (onProgress) onProgress(processedCount, allSongs.length);
            
            // Tiny breathe to keep UI responsive
            await new Promise(r => setTimeout(r, 0));
        }

        // 3. Build Index (Synchronous)
        // Now that all ID3 tags are loaded, we put them in buckets
        for (const song of allSongs) {
            if (!song.normalizedName) continue;
            
            this.songs.push(song);

            const bucket = song.getBucketChar();
            if (!this.index[bucket]) this.index[bucket] = [];
            
            this.index[bucket].push({ 
                norm: song.normalizedName, 
                path: song.relativePath 
            });
        }
        
        if (onProgress) onProgress(files.length, files.length);
    }

    _inferRoot(files) {
        if (!files || files.length === 0) return null;
        if (files[0] instanceof File && files[0].webkitRelativePath) {
            return "/" + files[0].webkitRelativePath.split("/")[0];
        }
        if (typeof files[0] === "string") {
            const parts = files[0].split("/").filter(Boolean);
            return parts.length > 1 ? "/" + parts[0] : "/Music";
        }
        return null;
    }

    getIndexForWorker() {
        return this.index;
    }
}

class Playlist {
    constructor(name) {
        this.name = name || "New Playlist";
        this.tracksToFind = [];
        this.matchedTracks = [];
    }

    async parseCSV(file) {
        this.name = file.name.replace(/\.[^.]+$/, "");
        const text = await file.text();
        
        return new Promise((resolve, reject) => {
            Papa.parse(text, {
                header: true,
                complete: (results) => {
                    // Update: Combine Artist and Track Name for better matching
                    this.tracksToFind = results.data
                        .filter(r => r["Track Name"])
                        .map(r => {
                            const artist = r["Artist Name"] || "";
                            const track = r["Track Name"];
                            return `${artist} ${track}`; // "Michael Jackson Billie Jean"
                        });
                    resolve(this.tracksToFind.length);
                },
                error: (err) => reject(err)
            });
        });
    }

    matchAgainst(database, workerPath, callbacks) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(workerPath);

            worker.postMessage({
                tracks: this.tracksToFind,
                index: database.getIndexForWorker()
            });

            worker.onmessage = (e) => {
                if (e.data.progress && callbacks.onProgress) {
                    callbacks.onProgress(e.data.progress, this.tracksToFind.length);
                } else if (e.data.done) {
                    this.matchedTracks = e.data.results;
                    worker.terminate();
                    resolve(this.matchedTracks);
                }
            };

            worker.onerror = (e) => {
                worker.terminate();
                reject(e);
            };
        });
    }

    generateM3U8(rootPath) {
        let output = "#EXTM3U\n";
        let count = 0;

        this.matchedTracks.forEach((match, index) => {
            if (match) {
                const cleanRoot = rootPath.replace(/\/$/, "");
                const cleanPath = match.path.replace(/^\//, "");
                output += `${cleanRoot}/${cleanPath}\n`;
                count++;
            }
        });

        return { content: output, count: count, total: this.tracksToFind.length };
    }

    download(content) {
        const blob = new Blob([content], { type: "audio/x-mpegurl" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${this.name}.m3u8`;
        a.click();
    }
}