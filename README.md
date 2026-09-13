# Unfold

Find a manual online or upload a PDF or photos to create a reviewable 3D draft: named parts, animated assembly steps, working orientations, guided cameras, and the original diagram beside each step. The prepared 16-step STRANDMON demo remains at `/`; the conversion workspace is `/engine.html`.

## Run locally

Requires Node.js 22 or later.

```sh
npm ci
npm run render-browser
cp .env.example .env.local
# Set your own OPENAI_API_KEY in .env.local, then:
npm run dev
```

Open [the conversion workspace](http://127.0.0.1:4173/engine.html). Each developer supplies their own server credential. `.env.local` is ignored; never put credentials in browser code, a guide file, or a commit. `OPENAI_MODEL` defaults to `gpt-6-astra`: parsing, evidence checks, and visual review use high reasoning; 3D geometry generation uses medium. `OPENAI_SEARCH_MODEL` independently controls web search and defaults to `gpt-5.4`. `UNFOLD_PORT` defaults to `4173`.

The render checker requires Chromium, installed by `npm run render-browser`, and a runtime that can launch it. It uses an isolated browser with access only to local renderer assets, never your personal browser profile. A missing browser produces an explicit error; the engine does not silently skip visual checks.

Start with **Search for your manual online** or **Upload your manual**. An upload accepts one unlocked PDF or multiple JPEG/PNG pages. Check the source preview, then select **Create animated guide**. Conversion supports up to **8 MB, 40 pages, and 32 assembly steps**. It can take several minutes. Progress and cancellation remain available while the manual is processed.

Choose **KNARREVIK demo** in the header or side panel to open the saved Astra-generated guide and its matching original PDF immediately, without an API call. It contains four legs, two solid trays, sixteen screws and an Allen key across six steps. This is a demonstration draft: its final visual review was stopped, and final tightening animates six representative joints while the manual requires all sixteen screws to be tightened.

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

## Collaboration and hosting

See [BUILD_SPEC.md](BUILD_SPEC.md) for product behavior and the prepared STRANDMON reference sequence. Work on feature branches and review changes through pull requests. Playback changes should be checked with direct step jumps, backward navigation, orientation changes and connector close-ups.

The existing `.openai/hosting.json` refers to a static Sites deployment. Static hosting alone cannot run conversion. The current hosting connection cannot find that Site, so this engine has not been deployed there. `server/worker.mjs` is a source entry, not a packaged deployment: it still needs bundling, Node compatibility for the current library modules, a durable library adapter, an `ASSETS` binding, a server secret, and access control before publishing. The local Node server is the supported engine runtime in this version.

## Sources and dependencies

- [OpenAI PDF inputs](https://developers.openai.com/api/docs/guides/file-inputs), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra).
- [pdf-lib PDFDocument](https://pdf-lib.js.org/docs/api/classes/pdfdocument), MIT.
- [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html), vendored Three.js 0.180.0, MIT.
- [PDF.js examples](https://mozilla.github.io/pdf.js/examples/), vendored PDF.js 5.4.149, Apache-2.0.
- LinkeDOM parses manufacturer pages and supports DOM tests, ISC.
- [IKEA STRANDMON manual AA-2019535-7](https://www.ikea.com/th/en/assembly_instructions/strandmon-wing-chair-kelinge-beige__AA-2019535-7-100.pdf). Manual and diagrams © Inter IKEA Systems B.V.; Unfold is not affiliated with IKEA.
- [IKEA KNARREVIK manual AA-2547698-1](https://www.ikea.com/kr/en/assembly_instructions/knarrevik-bedside-table-black__AA-2547698-1-100.pdf). The demo loads this original manual alongside its approximate generated guide.
