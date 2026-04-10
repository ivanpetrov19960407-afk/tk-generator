# Fonts for PDF rendering (no binary files in repo)

This repository does **not** store binary font files.

To get deterministic Cyrillic PDF output, provide these files locally:

- `assets/fonts/DejaVuSans.ttf`
- `assets/fonts/DejaVuSans-Bold.ttf`

## Fast setup

Run:

```bash
npm run fonts:setup
```

The script tries to:
1. Copy DejaVu fonts from common Linux system paths.
2. Copy from custom paths via environment variables:
   - `TKG_FONT_REGULAR=/path/to/font.ttf`
   - `TKG_FONT_BOLD=/path/to/font-bold.ttf`

If fonts are still missing, PDF generation will fail fast with a clear error.

## Standalone build

`scripts/build-binary.js` copies `assets/`, so once fonts are present in `assets/fonts`, they are shipped with the standalone binary.
