# Unfold

A quick STRANDMON assembly MVP: interactive 3D, sixteen animated steps, playback and scrubbing, exploded/underside views, and the source manual alongside each step.

## Agreed design

- Prepared STRANDMON example plus a real PDF intake flow; general conversion is future work.
- Minimal light working surface, blue controls, recognizable mustard chair.
- Desktop first, usable on phones.
- Original manual visible beside the 3D model and linked to each assembly step.
- Rotate, zoom, pause, replay, and move between steps.

## Scope and limitations

The 3D model is procedural and simplified. The prepared guide follows IKEA STRANDMON manual AA-2019535-7, pages 5–20. The build turns onto its back or either side to follow the handling sequence. Step-specific camera shots zoom into joints and return to wider views. Step 3 separates washer placement, nut threading, and socket-tool tightening in a ten-second sequence. Hardware placement remains illustrative, not CAD-verified.

PDF files stay in browser memory. The upload flow recognises the 20-page STRANDMON AA-2019535-7 document from its text and links it to this prepared animation. Other PDFs can be previewed without claiming an automatic conversion. No model API, secret, account database, or server upload is used.

## Running locally

From the repository root, run:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:4173. No build step or package installation is required; Python 3 is needed for this example server. Three.js and PDF.js are vendored. DM Sans loads from Google Fonts with a system font fallback.

## Working on the app

The current app is hand-written HTML, CSS, and JavaScript. Files under `dist` are the editable source, not generated build output.

| File | Responsibility |
| --- | --- |
| `dist/index.html` | Page layout and controls. |
| `dist/style.css` | Styling and responsive layout. |
| `dist/app.js` | Playback, navigation, PDF intake, and manual display. |
| `dist/viewer.js` | Procedural chair, assembly motions, build poses, and guided cameras. |
| `dist/steps.js` | Step instructions, part references, and source-page mapping. |
| `dist/assets/` | Original manual PDF and rendered manual pages. |
| `dist/vendor/` | Pinned Three.js and PDF.js dependencies and their licenses. |

See [BUILD_SPEC.md](BUILD_SPEC.md) for the target product behavior and architecture. The specification includes requirements for further development; this README describes the existing MVP.

Create a feature branch for each change and merge through pull requests. Changes to playback or geometry should be checked at step 3 and both side-panel sequences, including scrubbing and direct step jumps. Keep secrets out of the repository; `.env` files are ignored.

The `.openai/hosting.json` file identifies the existing Sites deployment. Local development works independently of that deployment; publishing to it requires access to the existing Site.

## Sources and dependencies

- IKEA STRANDMON manual: https://www.ikea.com/th/en/assembly_instructions/strandmon-wing-chair-kelinge-beige__AA-2019535-7-100.pdf
- Manual and diagrams © Inter IKEA Systems B.V.; linked and displayed as the source for this demonstration. Unfold is not affiliated with IKEA.
- Three.js 0.180.0, MIT: https://github.com/mrdoob/three.js
- PDF.js 5.4.149, Apache-2.0: https://github.com/mozilla/pdf.js

## Validation

- Assembly steps, part references, and source page mapping independently checked against the manual.
- Navigation, playback, scrubbing, PDF intake states, and manual relinking checked with a mocked DOM.
- Three.js geometry constructed with the real math/geometry library; finite geometry/transforms checked for all seventeen guide states at three progress points.
- Local asset references and JavaScript syntax checked.
- Visual/GPU rendering and interaction checks performed using the user-requested Aside CLI: step-3 nut and socket close-ups, side-build orientation, original-page linking, and camera controls. WebMCP validation remains unit-level, not browser integration validation.

The static Site is published with owner-only access by default.

## Optional GPT-Live voice copilot

The static app above remains available. The optional voice feature adds a local Node server and paid OpenAI API access; the earlier statement about no model API describes static use. Nothing calls OpenAI on startup or until you choose **Start voice**. Open **Talk to guide**, then start and allow microphone access. Say, for example, “the round bit before the nut” or “show me the other side.” The copilot uses the prepared catalog and current app state to select a step, manual page or view, asking for clarification when needed. Voice stays connected across these changes and when the panel is collapsed. Mute disables the microphone locally; End stops input and waits briefly for the server's final close event.

Requires Node 22.9 or newer. No package installation or build is needed:

```sh
npm start
```

Open the printed localhost URL (default `http://127.0.0.1:4173`), open **Talk to guide**, enter your OpenAI project key in the masked **OpenAI API key** field, then press **Start voice**. This is the easiest setup; no config file is required. The field clears immediately. The key is sent only in that attempt's creation request to the local server, which uses it to authenticate with OpenAI. It is never saved by the app to disk, cookies or browser storage, or included in model context, transcripts or logs. Re-enter it for every new start, including after failure or cancellation. A valid entered key takes precedence over a configured server key; an invalid entered key is rejected instead of silently using the server key. A static-only host still needs the local runtime.

Optionally copy `.env.example` to `.env` and set `OPENAI_API_KEY` there for a persistent local server configuration, then leave the app field blank. This optional configuration is the only path that saves a key to a file, at your explicit choice. Voice is always `gpt-live-1`; `OPENAI_BACKEND_MODEL` optionally selects the Responses backend (default `gpt-5.6-terra`). `PORT` changes the local port. Never put a key in `dist/`, source code or a URL. `.env` is ignored and only the server reads it. The example file contains no key.

This server binds only to `127.0.0.1`. It is for a trusted local user: do not expose it through a tunnel, public proxy or shared hosting. Host/origin checks, a 64 KiB body cap, one in-flight creation, four attempts per minute, a 20-second upstream timeout and no retries limit accidental session creation; these are not account authentication or a total spending cap. A static deployment explains that voice requires this local runtime.

OpenAI bills voice duration and delegated backend work. WebRTC creation includes an initialization charge equivalent to 15 seconds, credited against running voice duration; creating then cancelling can still incur usage. See [GPT-Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live) and [voice cost documentation](https://developers.openai.com/api/docs/guides/voice-latency-cost?api=live). End voice when finished. Closing the page releases local media immediately, so final server usage confirmation may not arrive.

Microphone audio, spoken conversation, the prepared STRANDMON catalog, and app state (step, page number, compatibility, view and playback) go to OpenAI. Uploaded PDF bytes, extracted text, images and filenames are never sent by the copilot. Transcripts are bounded, rendered as text, kept only in browser memory and cleared at the next start. The local server does not log speech or upstream response bodies. There is no camera input. An unrelated PDF remains in preview mode and blocks guide/view/playback actions until the user restores the example using the app. Manual page browsing still works. Human changes made during delegated work invalidate pending navigation so the guide cannot silently undo them.

Run offline checks with `npm test`; they use mocked OpenAI and microphone/WebRTC boundaries and do not require a key. Tests cover tool validation, stale/deduplicated navigation, delegation completion, lifecycle cleanup and the local HTTP boundary. Manual verification should include step 3, direct jumps to both side panels, manual relinking, collapsed voice controls and a narrow mobile viewport. A real microphone/model session requires a configured key and a user-started session and is not covered by these mocks.
