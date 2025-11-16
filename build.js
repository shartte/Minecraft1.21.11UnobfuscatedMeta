import fs from 'fs';
import https from 'https';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, 'dist');
const VERSIONS_DIR = path.join(OUTPUT_DIR, 'versions');

// Read URLs from JSON file
function readUrlsConfig() {
    const urlsPath = path.join(__dirname, 'src', 'urls.json');
    const data = fs.readFileSync(urlsPath, 'utf8');
    return JSON.parse(data);
}

function escapeHTML(s) {
    return s.replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Download file from URL and get Last-Modified header
function downloadFile(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;

        protocol.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                downloadFile(response.headers.location).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }

            const lastModified = response.headers['last-modified'];
            const chunks = [];

            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({
                buffer: Buffer.concat(chunks),
                lastModified: lastModified ? new Date(lastModified).toISOString() : new Date().toISOString()
            }));
            response.on('error', reject);
        }).on('error', reject);
    });
}

// Extract JSON from ZIP
function extractJsonFromZip(zipBuffer) {
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();

    for (const entry of zipEntries) {
        if (entry.entryName.endsWith('.json') && !entry.isDirectory) {
            return JSON.parse(entry.getData().toString('utf8'));
        }
    }

    throw new Error('No JSON file found in ZIP');
}

// Extract version ID from JSON data
function extractVersionId(jsonData) {
    // Try common paths for version ID
    if (jsonData.id) return jsonData.id;
    if (jsonData.version) return jsonData.version;
    if (jsonData.name) return jsonData.name;

    // If nested
    if (jsonData.versionInfo?.id) return jsonData.versionInfo.id;
    if (jsonData.versionInfo?.version) return jsonData.versionInfo.version;

    throw new Error('Could not find version ID in JSON data');
}

// Determine version type
function determineVersionType(versionId) {
    const id = versionId.toLowerCase();

    if (id.includes('snapshot') || id.includes('pre') || id.includes('rc')) {
        return 'snapshot';
    }

    return 'release';
}

// Generate manifest in Minecraft Launcher format
function generateManifest(versions) {
    const releases = versions.filter(v => v.type === 'release');
    const snapshots = versions.filter(v => v.type === 'snapshot');

    return {
        latest: {
            release: releases.length > 0 ? releases[0].id : '',
            snapshot: snapshots.length > 0 ? snapshots[0].id : (releases.length > 0 ? releases[0].id : '')
        },
        versions: versions.map(v => ({
            id: v.id,
            type: v.type,
            url: `https://${process.env.GITHUB_REPOSITORY?.replace('/', '.github.io/') || 'yourusername.github.io/yourrepo'}/versions/${v.id}.json`,
            time: v.releaseTime,
            releaseTime: v.releaseTime
        }))
    };
}

// Generate index.html
function generateIndexHtml(versions) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Minecraft 1.21.11 Unobfsucated Launcher Manifest</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
        }
        h1 {
            color: #333;
        }
        .version-list {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .version-item {
            padding: 12px;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .version-item:last-child {
            border-bottom: none;
        }
        .version-info {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .version-id {
            font-weight: 600;
            color: #0066cc;
        }
        .version-date {
            font-size: 12px;
            color: #666;
        }
        a {
            color: #0066cc;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .manifest-link {
            margin-top: 20px;
            padding: 15px;
            background: #e8f4f8;
            border-radius: 8px;
        }
    </style>
</head>
<body>
    <h1>Minecraft Versions Manifest</h1>
    
    <div class="manifest-link">
        <strong>Main Manifest:</strong> 
        <a href="manifest.json">manifest.json</a>
    </div>
    
    <div class="version-list">
        <h2>Available Versions</h2>
        
        ${versions.map(v => `
        <div class="version-item">
            <div class="version-info">
                <span class="version-id">${escapeHTML(v.id)}</span>
                <span class="version-date">${new Date(v.releaseTime).toLocaleDateString()}</span>
            </div>
            <a href="${escapeHTML(v.assetIndexUrl)}" rel="noopener">Asset Index</a>
            <a href="${escapeHTML(v.clientUrl)}" rel="noopener">Client</a>
            <a href="${escapeHTML(v.serverUrl)}" rel="noopener">Server</a>
            <a href="versions/${encodeURIComponent(v.id)}.json">JSON</a>
        </div>
        `).join('')}
    </div>
</body>
</html>
`;
}

// Main build process
async function build() {
    console.log('Starting build process...');

    // Create directories
    if (fs.existsSync(OUTPUT_DIR)) {
        fs.rmSync(OUTPUT_DIR, { recursive: true });
    }
    fs.mkdirSync(OUTPUT_DIR);
    fs.mkdirSync(VERSIONS_DIR);

    // Read configuration
    const config = readUrlsConfig();
    console.log(`Found ${config.urls.length} URLs to process`);

    const processedVersions = [];

    // Process each URL
    for (const url of config.urls) {
        console.log(`Processing ${url}...`);

        try {
            // Download ZIP and get Last-Modified date
            console.log(`  Downloading...`);
            const { buffer: zipBuffer, lastModified } = await downloadFile(url);
            console.log(`  Last-Modified: ${lastModified}`);

            // Extract JSON
            console.log(`  Extracting JSON...`);
            const jsonData = extractJsonFromZip(zipBuffer);

            // Extract version ID from JSON
            const versionId = extractVersionId(jsonData);
            console.log(`  Detected version: ${versionId}`);

            // Determine version type
            const versionType = determineVersionType(versionId);
            console.log(`  Version type: ${versionType}`);

            // Save JSON to versions directory
            const outputPath = path.join(VERSIONS_DIR, `${versionId}.json`);
            fs.writeFileSync(outputPath, JSON.stringify(jsonData, null, 2));
            console.log(`  Saved to ${outputPath}`);

            processedVersions.push({
                id: versionId,
                type: versionType,
                releaseTime: lastModified,
                assetIndexUrl: jsonData.assetIndex.url,
                clientUrl: jsonData.downloads.client.url,
                serverUrl: jsonData.downloads.server.url,
            });
        } catch (error) {
            console.error(`  Error processing ${url}: ${error.message}`);
        }
    }

    // Sort versions by release time (newest first)
    processedVersions.sort((a, b) => new Date(b.releaseTime) - new Date(a.releaseTime));

    // Generate manifest
    console.log('Generating manifest...');
    const manifest = generateManifest(processedVersions);
    fs.writeFileSync(
        path.join(OUTPUT_DIR, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
    );

    // Generate index.html
    console.log('Generating index.html...');
    const indexHtml = generateIndexHtml(processedVersions);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), indexHtml);

    console.log('Build complete!');
    console.log(`Processed ${processedVersions.length} versions`);
}

build().catch(console.error);
