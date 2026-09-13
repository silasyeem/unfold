# Unfold

Create or open the KNARREVIK guide in `/engine.html`, then choose **Scan my parts** before assembly. The scanner opens over the guide: select a JPEG, PNG, or HEIC photo, review suggested matches and counts, and inspect parts in 3D. **Back to assembly guide** returns to the same step and linked manual. Phone photos are compressed automatically before upload. See [scanner behavior and validation](docs/KNARREVIK-SCAN.md).

Find a manual online or upload a PDF or photos to create a reviewable 3D draft: named parts, animated assembly steps, working orientations, guided cameras, and the original diagram beside each step. The prepared 16-step STRANDMON demo remains at `/`; the conversion workspace is `/engine.html`.

## Run locally

Requires Node.js 22.9 or later.

```sh
npm ci
npm run render-browser
cp .env.example .env.local
# Set your own OPENAI_API_KEY in .env.local, then:
npm run dev
```

Open [the conversion workspace](http://127.0.0.1:4173/engine.html). Each developer supplies their own server credential. `.env.local` is ignored; never put credentials in browser code, a guide file, or a commit. `OPENAI_MODEL` defaults to `gpt-6-astra`: parsing, evidence checks, and visual review use high reasoning; 3D geometry generation uses medium. `OPENAI_SEARCH_MODEL` independently controls web search and defaults to `gpt-5.4`. `OPENAI_SCAN_MODEL` selects parts recognition; `OPENAI_BACKEND_MODEL` selects the voice copilot’s delegated model. `UNFOLD_PORT` defaults to `4173`.

The render checker requires Chromium, installed by `npm run render-browser`, and a runtime that can launch it. It uses an isolated browser with access only to local renderer assets, never your personal browser profile. A missing browser produces an explicit error; the engine does not silently skip visual checks.

Start with **Search for your manual online** or **Upload your manual**. An upload accepts one unlocked PDF or multiple JPEG/PNG pages. Check the source preview, then select **Create animated guide**. Conversion supports up to **8 MB, 40 pages, and 32 assembly steps**. It can take several minutes. Progress and cancellation remain available while the manual is processed.

Choose **KNARREVIK demo** in the header or side panel to open the saved Astra-generated guide and its matching original PDF immediately, without an API call. Once it opens, **Scan my parts** is the next step. It contains four legs, two solid trays, sixteen screws and an Allen key across six steps. This is a demonstration draft: its final visual review was stopped, and final tightening animates six representative joints while the manual requires all sixteen screws to be tightened.

For a smaller authored example, open `examples/mini-table.unfold.json` using **Open a saved guide** in the **•••** menu, then choose **Change manual → Upload your manual** and upload `examples/mini-table.pdf` to relink the diagrams. This is an authored test manual with a generated schematic, not an IKEA product or a CAD model.

## Photos and saved manuals

**Upload your manual** accepts JPEG or PNG pages and opens a photo editor with an additional phone camera input. Reorder, rotate, or remove pages before preparing them. The browser reduces images to 2,000 pixels on the longest edge; the server independently checks image headers and dimensions, then creates a PDF for the same extraction engine and source viewer. Use **••• → Download manual PDF** to keep the prepared pages with an exported guide. Up to 20 photos are supported, with a 12 MB per-file input limit and an 8 MB resulting manual limit. HEIC needs to be saved as JPEG first. Perspective correction and deblurring are not implemented.

**Search for your manual online** accepts a product name or link and searches the saved library without a model request. When there is no match, **Search the web** explicitly searches for manufacturer instructions and saves grounded source metadata. Normalized repeated searches, including previous misses, reuse cached results. Results show the product name, photo when available, **Download manual**, and **Use this manual**. The first download or use caches the PDF; later loads reuse the saved bytes. Downloading a manual does not start conversion. Manufacturer pages are inspected for their real product name, photo, and labeled assembly PDF; those details are cached too. For IKEA PDFs with a known article number, the official article lookup supplies the matching product page and photo without changing the selected manual revision. Pages without a verified PDF remain source links. Product variants still need checking before conversion.

The local library lives in ignored `data/library/`: an atomically written JSON index plus cached PDFs. It survives server restarts. Downloads accept saved public HTTPS sources only, pin validated DNS, check redirects, and enforce PDF size/page limits. The local adapter serializes updates within one Node process; use a shared durable database/object store for multiple server processes. Provider search behavior is tested with controlled responses. Real IKEA LACK product pages and PDF downloads were also verified using the user’s saved search results, without another model search.

## What the engine does

1. Parses the actual PDF and checks its page count before making model requests.
2. Reads every page in small PDF batches, recording provisional inventory, assembly steps, source pages, and uncertainties.
3. Independently reads the complete manual, including cover and finished-product drawings, using high reasoning. This pass receives only page and step-number anchors from the extraction so earlier misread descriptions cannot bias its inventory. A separate skeptical check traces physical instances, cross-sections, attachments, screw counts, and working poses. The document label can corroborate product proportions and material, but the diagrams take precedence.
4. Generates compound primitive shapes and motion data with medium reasoning, mapping every physical instance to its source component. The saved guide remains schema version 1; component evidence and coverage accompany it in the export envelope.
5. Checks structure, parenting, action timing, handling rotations, component quantities, broad surface geometry, and final visibility. An open perimeter cannot stand in for a solid tabletop or shelf. Permanent parts must remain present and temporary tools must be removed.
6. Renders the actual Three.js player: completed-product overview, every completed assembly stage, and a representative active connection/tool view for each step with actions. A visual reviewer compares each screenshot with its matching original PDF page, checking visible shape, proportion, counts, attachments, working pose and tool placement. All required captures must be rendered and acknowledged.
7. A clear structural or visual mismatch triggers one bounded correction using the report and failed screenshots, followed by fresh rendering and comparison. Missing or extra components and incorrect working poses also trigger a fresh source-evidence check before regenerating geometry. A second failed draft returns an error instead of the mismatched guide. Source ambiguity remains in the review notes. Successful exports include a visual-review report without embedding the screenshots.
8. Plays the checked draft in Three.js. Attached hardware follows its parent part. Seeking computes state from the guide, so direct jumps and replay agree.

Every Engine guide uses the shared player, including fresh PDF/photo conversions and reopened saved guides. The default camera stays fixed while step changes smoothly turn the build around its centre to the required working orientation. Playback and scrubbing keep that orientation steady. New guides preserve the original drawing’s signed viewing direction and page-up axis, so the object turns into the manual’s illustrated view without reflection. **Step view** offers a connection close-up on request. Manual orbit works within a step; selecting another step returns to its manual view. These transitions also apply to voice navigation and respect reduced-motion preferences.

The UI supports play/pause, scrubbing, speed, step navigation, free orbit/zoom, guided joint views, whole-build framing, exploded parts, PDF enlargement, and source-page relinking. **Review this step** edits its title, instruction, source page, and working orientation. **Download guide** preserves the guide, provenance, extraction evidence, and your checked-step markers. Reopening a guide requires a matching PDF fingerprint before source diagrams are linked.

## Experimental screw STL generator

Open **Screw lab** from the home page or workspace header, or visit `/screws.html`. The generator runs entirely in the browser and needs no API key. Start with metric M3–M12 coarse-pitch presets, then enter measured diameter, pitch and length; select an external hex, hex socket or thumb-grip head. Head dimensions, hex key size, thread direction and diameter reduction are editable. Diameter reduction applies to the thread only, preserving pitch and length. Presets are examples, not inferred replacements for the selected kit; the KNARREVIK entry carries the manual part codes but deliberately supplies no claimed matching dimensions.

The preview and binary STL share one indexed boundary mesh with actual helical threads, a joined head, thread runout and a blunt lead-in. The socket head includes a recessed hex drive. Geometry uses millimetres with the head on the XY print bed; import at 100% scale. The truncated 60° profile is metric-inspired, not an ISO tolerance-class CAD model: crest flat P/8, root flat P/4, radial depth 5√3P/16. There are 96 angular segments and 24 axial samples per pitch. Supported custom bounds are 3–16 mm diameter, 0.5–3 mm pitch and 4–60 mm length. Export is disabled for invalid or pending dimensions, and remains available when WebGL cannot initialize.

This is a prototype/fit-test tool, not a reconstruction of proprietary, wood or self-tapping hardware. There is no tested strength, torque or fit rating. Printed threads are more plausible around M6 and larger; a furniture joint or other load-bearing connection should use the correct metal spare. See [Formlabs’ printed-thread guidance](https://formlabs.com/blog/adding-screw-threads-3d-printed-parts/) and [Bossard’s metric thread reference](https://www.bossard.com/-/media/bossard-group/website/documents/technical-resources/en/f-079-en.pdf). No physical print has been validated.

## Accuracy and scope

Generated geometry and connections are approximate. Structural and model-based visual checks can miss errors; a clean report does not establish physical accuracy. The visual check samples completed states and one active connection per step, not every frame of every motion. Keep the original manual authoritative and review every generated step before using it for assembly. Checking a step records a user's review; it does not certify dimensions, fastening strength, or CAD accuracy. Editing primitive geometry and action paths currently requires editing the guide JSON.

Live conversion recovered all 16 STRANDMON source-page entries, but also produced mistaken hardware interpretations and pose assumptions. The prepared STRANDMON example is a separate, manually authored guide. General conversion is an editable draft workflow, not reliable reconstruction of arbitrary products.

The server processes PDFs in memory and sends them to OpenAI for conversion with Responses API `store: false`. It also sends rendered stage screenshots with their matching source pages for visual comparison. Direct uploads, screenshots, and generated guides are not saved on the server. The manual library separately persists search metadata and PDFs explicitly loaded from search results. This setting is not a promise of zero provider retention. Export files are saved only when the user downloads them.

## Code map

The app is plain HTML/CSS/JavaScript. `dist/` contains editable frontend source and vendored browser dependencies; it is not generated build output.

| Module | Responsibility |
| --- | --- |
| `engine/extract.mjs` | PDF parsing, page batches, inventory and step evidence. |
| `engine/completeness.mjs` | Full-document component reconciliation, physical-instance coverage, solid-surface and final-presence checks. |
| `engine/render.mjs`, `dist/render-capture.js` | Isolated Chromium screenshots using the actual player, with a bounded stage plan. |
| `engine/visual-review.mjs` | Screenshots paired with original source pages, complete review coverage, actionable mismatch reports. |
| `engine/evidence-repair.mjs` | Rechecks source interpretation when rendered parts or poses conflict with the manual. |
| `engine/convert.mjs` | Model requests, guide generation, correction, provenance. |
| `engine/semantics.mjs` | Detect common double application of build orientation. |
| `dist/guide-schema.js` | Strict versioned JSON contract and semantic reference checks. |
| `dist/guide-state.js` | Deterministic step snapshots, parent visibility, motions, build poses. |
| `dist/generated-viewer.js` | Generic geometry, hierarchy, highlighting, camera and grounding. |
| `dist/engine-app.js` | Upload, streamed progress, playback, PDF linking, review and export. |
| `dist/photo-intake.js`, `server/photos.mjs` | Ordered photo pages, image bounds and PDF preparation. |
| `dist/manual-library.js`, `server/library.mjs` | Library-first lookup, explicit web search and cached PDF loading. |
| `server/library-store.mjs` | Atomic local persistence and restricted public-source downloading. |
| `server/library-enrich.mjs` | Manufacturer product names, photos, and verified assembly links. |
| `server/api.mjs` | Conversion endpoint, upload limits, cancellation and concurrency. |
| `server/local.mjs` | Local API and allowlisted static file server. |
| `server/worker.mjs` | Worker fetch entry for future server-backed hosting. |
| `dist/app.js`, `viewer.js`, `steps.js` | Prepared STRANDMON guide. |
| `tests/` | Contract, pipeline, concurrency, state, geometry and UI regressions. |

Guide part transforms are relative to `parentId` (empty for a root). Primitive transforms are local to their part. Root action transforms stay in the unrotated assembly frame; the player applies the working orientation to the whole build. An orientation-only step can have no part actions. `turns` is an integer number of decorative revolutions; lasting quarter/half turns belong in `toRotation`. Camera focus uses assembly coordinates. The schema rejects executable fields and unknown properties.

## API and command line

- `GET /api/health`: conversion availability, model and limits; never returns the credential.
- `POST /api/photos`: multipart `photos` files plus a matching `rotations` JSON array, with `X-Unfold-Convert: 1`; returns the prepared PDF.
- `GET /api/library?q=...`: saved records only.
- `POST /api/library/web-search`: JSON `{query}` with `X-Unfold-Library: 1`; searches only when the normalized query is uncached and the library has no match.
- `POST /api/library/:id/pdf`: `X-Unfold-Library: 1`; downloads/caches a saved record’s PDF.
- `POST /api/convert`: raw `application/pdf` body with `X-Unfold-Convert: 1`, `X-Pdf-Pages`, and a URL-encoded `X-Pdf-Name`. Returns server-sent `stage`, `result`, or `error` events.
- Requests with a supplied cross-origin `Origin` are rejected. Two conversions can run concurrently in each process; each has a thirty-minute timeout. This is a local/private deployment boundary, not public authentication or account rate limiting.

```sh
npm run convert -- examples/mini-table.pdf 3 /tmp/mini-table.unfold.json
npm test
```

The supplied page count is verified against the PDF. The CLI logs progress, output counts, and token usage without logging credentials.

## Validation

- Automated tests cover malformed guides, attached parts, deterministic seeking, tool removal/reinsertion, handling orientation, camera floor limits, real PDF page limits, evidence preservation, credential exclusion, concurrent uploads, cancellation, playback, PDF replacement, photo ordering/rotation, image bounds, query/PDF caching, persistence, and restricted source downloads.
- Live API conversions exercised a three-page table manual and the twenty-page STRANDMON manual. The table produces five parts and two steps from both its original PDF and an image-only PDF prepared from three JPEG pages. The revised STRANDMON pipeline retained sixteen ordered steps on pages 5–20; its semantics still require review.
- Browser walkthrough uses Aside CLI with the actual WebGL viewer and PDF renderer. It caught duplicated whole-build rotation and a camera below the floor; those cases now have regression coverage. See `VALIDATION.md` for the completed walkthrough.

## Optional GPT-Live voice copilot

The voice copilot is integrated into every Engine guide at `/` and `/engine.html`, whether generated locally, generated on Sites, or reopened from a saved guide. It is also available in the prepared STRANDMON demo at `/demo.html`. Open **Talk to guide**, choose **Start voice**, and allow microphone access. Try “explain this step,” “show the whole build,” or “replay that step.” The copilot reads the loaded guide’s steps, parts and review notes, and can navigate steps, browse linked manual pages, change views, and control playback. A saved guide can use voice without its original PDF; page browsing becomes available after relinking that PDF. Paid OpenAI API access starts only when you choose **Start voice**. Voice stays connected across these changes and when the panel is collapsed. Changing the manual or opening another intake flow ends the session to prevent stale instructions. Mute disables the microphone locally; End stops input and waits briefly for the server's final close event.

After the shared local setup above, run:

```sh
npm start
```

Open the printed localhost URL (default `http://127.0.0.1:4173`), open **Talk to guide**, use the configured server key, or open **Voice settings** and enter your OpenAI project key in the masked **OpenAI API key** field, then press **Start voice**. This is the easiest setup; no config file is required. The field clears immediately. The key is sent only in that attempt's creation request to the local server, which uses it to authenticate with OpenAI. It is never saved by the app to disk, cookies or browser storage, or included in model context, transcripts or logs. Re-enter it for every new start, including after failure or cancellation. A valid entered key takes precedence over a configured server key; an invalid entered key is rejected instead of silently using the server key. A static-only host cannot run voice; publish the hosted Worker build described below, or use the local runtime.

Optionally copy `.env.example` to `.env.local` and set `OPENAI_API_KEY` there for a persistent local server configuration, then leave the app field blank. This optional configuration is the only path that saves a key to a file, at your explicit choice. Voice is always `gpt-live-1`; `OPENAI_BACKEND_MODEL` optionally selects the Responses backend (default `gpt-5.6-terra`). `UNFOLD_PORT` changes the shared local port; legacy `PORT` is used when it is unset. Never put a key in `dist/`, source code or a URL. `.env.local` and legacy `.env` are ignored and only the server reads them; `.env.local` takes precedence. The example file contains no key.

This server binds only to `127.0.0.1`. It is for a trusted local user: do not expose it through a tunnel, public proxy or shared hosting. Host/origin checks, a 64 KiB body cap, one in-flight creation, four attempts per minute, a 20-second upstream timeout and no retries limit accidental session creation; these are not account authentication or a total spending cap. This restriction applies to the local Node server. The separate hosted Worker below supports deployment.

OpenAI bills voice duration and delegated backend work. WebRTC creation includes an initialization charge equivalent to 15 seconds, credited against running voice duration; creating then cancelling can still incur usage. See [GPT-Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live) and [voice cost documentation](https://developers.openai.com/api/docs/guides/voice-latency-cost?api=live). End voice when finished. Closing the page releases local media immediately, so final server usage confirmation may not arrive.

Microphone audio, spoken conversation, the current guide’s instructions, parts and review notes, and app state (step, page number, compatibility, view and playback) go to OpenAI. The copilot does not send PDF bytes, raw extracted text, images, filenames or meshes. Transcripts are bounded, rendered as text, kept only in browser memory and cleared at the next start. The local server does not log speech or upstream response bodies. There is no camera input. A PDF without a generated guide cannot supply assembly instructions; valid manual-page browsing still works. Human changes made during delegated work invalidate pending navigation so the guide cannot silently undo them.

Clear voice requests such as “go to step 3,” “next step,” and “go back a step” navigate directly without a confirmation or preliminary explanation. Relative commands resolve against the live assembly step and stop at guide boundaries. References such as “you mean like in step 3?”, “what happens next?”, and “explain step 5” request an answer while keeping the current selection. The voice and backend instructions both distinguish these intents; the app validates each requested action against the current guide.

Run offline checks with `npm test`; they use mocked OpenAI and microphone/WebRTC boundaries and do not require a key. Tests cover tool validation, direct/relative/stale/deduplicated navigation, delegation completion, lifecycle cleanup and the local HTTP boundary. Manual verification should include paired navigation and reference phrases above, direct jumps to both side panels, manual relinking, collapsed voice controls and a narrow mobile viewport. A real microphone/model session requires a configured key and a user-started session and is not covered by these mocks. Restart an existing voice session to use updated instructions.

## Hosting the voice copilot

The repository includes a combined Sites / Cloudflare Workers entry in `server/site.mjs`, using `server/hosted.mjs` for voice and preserving the existing scanner endpoints. It serves the same `/api/voice/readiness` and `/api/voice/session` endpoints as the local server. The browser uses the site's own origin, so no endpoint URL or CORS configuration is needed. After the complete build is deployed over HTTPS, open **Talk to guide** and choose **Start voice**. The configured server key needs access to GPT-Live. Audio connects directly between the browser and OpenAI after the backend creates the session.

Hosted voice uses the Site’s `OPENAI_API_KEY` by default. The key stays on the server; the browser receives only the session ID and SDP answer. Voice usage from this Site is billed to that configured key. **Voice settings** offers an optional session-only key override; a malformed override is rejected. The existing per-key attempt limit also applies to starts using the server key. `OPENAI_BACKEND_MODEL` may optionally select the delegated Responses model; the default remains `gpt-5.6-terra`. Keys pass through the site's backend only to authenticate the one OpenAI request and are never saved by Unfold. Keep request-body/header logging disabled in any additional proxy or hosting instrumentation.

Install the locked development tools and build:

```sh
npm ci
npm test
npm run build
```

The build bundles the combined voice/scanner Worker as `dist/server/index.js`, copies public assets including the saved KNARREVIK demo and manual to `dist/client`, and writes `dist/.openai/hosting.json`. It preserves the authored files in `dist`; previous generated output moves to ignored `.sites-runtime/build-backups`. `.openai/hosting.json` retains the existing Site ID and no longer declares a static-only deployment. Runtime code uses Web APIs, with no Node HTTP server or filesystem requirements.

The Site owner must publish the **Worker build and its assets together** through Sites using the existing project ID. Push the exact source to the Site's configured source repository, package the built output using the Sites hosting workflow, then save and deploy that version while preserving the current access policy. A GitHub merge does not itself publish Sites. Do not upload only `dist/index.html` or configure this version as a static site: that would omit the voice endpoints. Sites access is still required to publish; this adaptation does not change ownership or access.

For Cloudflare Workers outside Sites, the checked-in `wrangler.jsonc` specifies the bundled Worker, `ASSETS` binding to `dist/client`, and Worker-first routing. Production deployment still requires the chosen account's authorization. To verify the hosted runtime locally without publishing:

```sh
npm run preview:hosted
```

Open `http://127.0.0.1:4191`. `npm start` runs the shared local Node server after `npm ci`, including optional local key configuration. The hosted preview follows the visitor-key-only policy.

With that preview running, `node scripts/verify-hosted.mjs` checks the built Worker, public-file integrity, served manual/vendor assets, readiness, missing-key rejection, and origin/private-path protections without contacting OpenAI.

The hosted boundary requires matching request origins, HTTPS outside loopback development, JSON and a 64 KiB streamed body limit. It cancels timed-out/client-aborted creation requests, follows no provider redirects, performs no automatic retries, and returns fixed safe errors. Its limiter allows one creation in flight and four starts per minute per key per Worker isolate, keeping at most 512 expiring SHA-256 key digests in memory. This is best-effort throttling, not a distributed limit or spending cap; different isolates may each admit requests. OpenAI project billing limits remain relevant. Uploaded PDFs and filenames remain in the browser.

Tests cover the hosted boundary, including refusal to use a configured server key, key separation, upstream request shape, origin checks, streamed body limits, cancellation, throttling, sanitized provider failures, and asset routing. Build/runtime checks do not establish actual model access or microphone quality. A paid GPT-Live session and the final production deployment must still be verified with an authorized account and key.
## Collaboration and hosting

See [BUILD_SPEC.md](BUILD_SPEC.md) for product behavior and the prepared STRANDMON reference sequence. Work on feature branches and review changes through pull requests. Playback changes should be checked with direct step jumps, backward navigation, orientation changes and connector close-ups.

The hosted Site serves the prepared guide, Screw lab, and KNARREVIK scanner. `server/site.mjs` preserves scanner APIs alongside the voice copilot; `server/scan-worker.mjs` remains the scanner-only entry. Use `npm run build` for the combined deployment. Manual conversion and library search run on Sites through the combined Worker and R2 adapter.

## Sources and dependencies

- [OpenAI PDF inputs](https://developers.openai.com/api/docs/guides/file-inputs), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra).
- [pdf-lib PDFDocument](https://pdf-lib.js.org/docs/api/classes/pdfdocument), MIT.
- [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html), vendored Three.js 0.180.0, MIT.
- [PDF.js examples](https://mozilla.github.io/pdf.js/examples/), vendored PDF.js 5.4.149, Apache-2.0.
- LinkeDOM parses manufacturer pages and supports DOM tests, ISC.
- [IKEA STRANDMON manual AA-2019535-7](https://www.ikea.com/th/en/assembly_instructions/strandmon-wing-chair-kelinge-beige__AA-2019535-7-100.pdf). Manual and diagrams © Inter IKEA Systems B.V.; Unfold is not affiliated with IKEA.
- [IKEA KNARREVIK manual AA-2547698-1](https://www.ikea.com/kr/en/assembly_instructions/knarrevik-bedside-table-black__AA-2547698-1-100.pdf). The demo loads this original manual alongside its approximate generated guide.

## Live engine on Sites

The homepage opens the manual engine; the prepared STRANDMON guide remains at `/demo.html`, and `/engine.html` is a compatible entry point. The hosted workspace supports PDF/photo conversion. Sites runs extraction, generation, source reconciliation and visual review; the visitor’s WebGL browser renders the same overview, assembly and connection views used by the local Chromium checker. Keep the tab open during conversion. Missing renders, mismatches, cancellation and disconnects fail visibly instead of producing an unchecked success. Uploaded manuals remain in the conversion session. Browser render requests and captures use temporary R2 objects that are deleted when the check completes.

The hosted manual library uses R2 with conditional writes for its JSON index and cached PDFs. KNARREVIK’s verified manual is available immediately. Hosted manufacturer downloads are restricted to IKEA domains; upload PDFs from other manufacturers directly. The existing local library and Chromium pipeline remain supported. Voice and scanner routes are preserved. Run `npm run build` for the complete Sites Worker; the legacy scanner-only staging script does not publish the live engine.
