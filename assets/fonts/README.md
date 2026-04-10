# Fonts for PDF rendering

This project expects the following font files for best Cyrillic output:

- `assets/fonts/PTSans-Regular.ttf`
- `assets/fonts/PTSans-Bold.ttf`

Binary font files are not committed in this repository snapshot.

`src/pdf-utils.js` uses the following fallback chain:
1. Local `assets/fonts/PTSans-*.ttf`
2. System PT Sans paths (if installed)
3. DejaVu Sans system fonts

To force a custom font path at runtime, pass `options.fonts.regular` and `options.fonts.bold` to PDF builders.
