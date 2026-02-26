# Tool Pack Manifest Draft (v1)

Each tool pack manifest is a JSON file with this shape:

```json
{
  "schemaVersion": 1,
  "name": "filesystem",
  "description": "Core local file navigation and edits",
  "tools": ["read_file", "list_files", "edit_file"],
  "riskProfile": "standard",
  "tags": ["core", "local"]
}
```

## Fields

- `schemaVersion` (number, required): currently `1`
- `name` (string, required): unique pack identifier
- `description` (string, required): human-readable purpose
- `tools` (string[], required): tool names exposed by this pack
- `riskProfile` (required): one of:
  - `read-only`
  - `standard`
  - `privileged`
- `tags` (string[], optional): search/grouping labels

## Current draft packs

- `filesystem.json`
- `screenshot.json`
- `vision-analysis.json`

