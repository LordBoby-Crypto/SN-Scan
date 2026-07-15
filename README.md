# SN-Scan

SN-Scan is a mobile-first progressive web app for school device replacement work. It records a school, room number, old serial number, and new serial number. The phone camera captures each label and on-device OCR extracts likely S/N values for confirmation.

## Main workflow

1. Create or select a school.
2. Tap **Scan a replacement**.
3. Enter a room number such as `B103`.
4. Photograph the old device label and confirm the detected S/N.
5. Photograph the new device label and confirm the detected S/N.
6. Review and save.

## Privacy and storage

- OCR runs in the browser with Tesseract.js.
- Photos are processed temporarily and are not stored.
- Confirmed text records are stored in the browser using local storage.
- CSV and JSON export are available.

## Phone installation

Open the GitHub Pages site in Safari or Chrome, then use **Add to Home Screen**. The interface runs as a standalone PWA after installation.

## Local testing

```bash
npm test
npm run serve
```

Then open `http://localhost:4173`.

## GitHub Pages

This repository includes a Pages deployment workflow. In **Settings > Pages**, choose **GitHub Actions** as the source if it is not selected automatically.
