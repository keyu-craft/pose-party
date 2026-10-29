# Pose Party

**Match the pose. Beat the clock.**

A webcam party game where you copy a character's pose and see how many you can complete in 60 seconds. Developed as a DT2140 course project exploring body movement as game input.

[中文介绍](README.zh-CN.md) · [Run locally](#run-locally) · [Publish your own game](GITHUB-PUBLISHING.md) · [Development notes](docs/DEVELOPMENT.zh-CN.md)

![Pose Party interface with the music controls open](docs/images/pose-party.jpg)

*Interface preview with Chinese selected and the camera disabled.*

## How to play

1. Open the game in a desktop browser and enable the camera.
2. Adjust your position so your head, shoulders, elbows, and wrists have room to move. Follow the framing hint if you need to step back or move to the center.
3. Face the screen for one second to start the challenge.
4. Copy the figure and hold the matching pose for one second of valid tracking. Each completed pose earns one point.
5. Keep going until the 60-second timer ends, then compare scores with your friends.

The game uses a mirrored camera view: follow the figure's screen direction. The clock keeps running during pose changes and tracking interruptions.

## Features

- **20 randomized upper-body poses**, including six head-tilt combinations. Consecutive targets do not repeat.
- **Standing-position guidance** before the round starts, with brief edge-loss tolerance during play.
- **English and Chinese UI**, full-screen mode, and optional game sound effects.
- **Three bundled instrumental tracks**, plus a playlist of audio files selected from your own device.
- **Background pose inference** using a Web Worker where supported, with a main-thread fallback.
- **Local performance reports** with timing, frame-rate, and tracking-reason summaries that can be exported as JSON.

## Run locally

Use Node.js **24 LTS**, or a supported Node.js version **22.18+**, and a desktop browser with a webcam.

After downloading or cloning the repository, open a terminal in the project folder:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite and allow camera access. Desktop Chrome or Edge is recommended for the first playtest.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm test` | Run the automated checks |
| `npm run build` | Generate the website in `dist/` |
| `npm run preview` | Preview the production build locally |

The development and build commands prepare the pinned MediaPipe runtime automatically. Do not open `index.html` directly from the file manager; use the local server.

## Publish with GitHub Pages

The repository includes [a GitHub Actions workflow](.github/workflows/deploy-pages.yml) that tests, builds, and deploys the game from `main`. It detects the GitHub Pages base path so the worker, WASM runtime, music, and credits can load under a project URL.

Follow the [step-by-step publishing guide](GITHUB-PUBLISHING.md). Once your site is deployed, add its actual URL to the repository's **About → Website** field so visitors can find the game.

## Music

Use the **♫** button to play, pause, switch tracks, and adjust the music volume. Closing the controls keeps the music playing. The game fades out the music at the end of a round.

You can add up to 20 audio files from your device. Files stay in the current browser session and need to be selected again after a reload. Supported formats depend on the browser's audio decoder.

Bundled recordings:

| Track | Artist | Style |
| --- | --- | --- |
| Disco Medusae | Kevin MacLeod | Disco |
| Cipher | Kevin MacLeod | Electronic |
| Cold Funk | Kevin MacLeod | Funk groove |

These recordings are provided under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Full attribution, original sources, and file checksums are in [Music credits](public/music/CREDITS.md).

## Technology

| Part | Tools |
| --- | --- |
| Application | TypeScript and Vite |
| Body and head tracking | MediaPipe Pose Landmarker and Face Landmarker |
| Visuals | Canvas 2D |
| Inference scheduling | Web Worker, OffscreenCanvas, and ImageBitmap |
| Audio | HTML audio playback and Web Audio feedback |
| Hosting | Static files with GitHub Pages |

The game runs in the browser without an application backend or database. Implementation details, matching thresholds, and diagnostic guidance are in the [development notes](docs/DEVELOPMENT.zh-CN.md).

## Privacy and limitations

- The application processes camera frames in the browser and does not record or upload them. Its selected local audio files are not uploaded either.
- Performance reports stay on the device unless you export and share them. They contain browser/hardware information and technical measurements, not camera frames or landmark coordinates.
- Initial model loading requires access to Google-hosted MediaPipe model files. The complete game is not guaranteed to work offline. See the [network and SDK notes](docs/DEVELOPMENT.zh-CN.md#网络与隐私).
- Tracking quality depends on lighting, camera placement, and visibility. Hands outside the camera view cannot be matched reliably.
- Readiness uses an estimate of head orientation, rather than eye-gaze tracking. Facial-expression matching is not implemented.

## Project status and licensing

This is a playable course prototype under active iteration. See the [changelog](CHANGELOG.md) for the current scope.

A project-wide software license has not yet been selected. Bundled music and third-party components retain their respective licenses; the music attribution above must be preserved.
