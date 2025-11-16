# Minecraft Manifest Generator

Automatically downloads ZIP files containing JSON files, extracts version information from the JSON, and generates a Minecraft Launcher Manifest V2 format.

## Setup

1. Clone this repository
2. Edit `src/urls.json` with your ZIP file URLs
3. Push to GitHub
4. Enable GitHub Pages in repository settings (Source: GitHub Actions)

## Configuration

Edit `src/urls.json` to add your ZIP file URLs:

```json
{
  "urls": [
    "https://example.com/version1.zip",
    "https://example.com/version2.zip",
    "https://example.com/version3.zip"
  ]
}
```

The build script will:
- Download each ZIP file
- Extract the JSON file from the ZIP
- Automatically detect the version ID from the JSON (looks for `id`, `version`, or `name` fields)
- Use the HTTP `Last-Modified` header as the release time
- Determine if it's a release or snapshot based on the version ID

## Local Development

```bash
npm install
npm run build
```

The output will be in the `dist/` directory.

## Output

- `manifest.json` - Minecraft Launcher Manifest V2 format
- `versions/*.json` - Individual version JSON files
- `index.html` - Web interface with links to all versions

## Version Detection

The script automatically detects:
- **Version ID**: Reads from `id`, `version`, or `name` field in the JSON
- **Release Type**: Determines "release" or "snapshot" based on version ID
- **Release Time**: Uses the `Last-Modified` HTTP header from the server

## License

MIT
