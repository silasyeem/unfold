# Unfold

Turn an assembly manual into an interactive 3D guide. Find a manual or upload its pages, see how the parts fit, and follow each step with a voice copilot.

**[Open the live app](https://unfold-assembly.silas-yke.chatgpt.site/)**

The homepage is the manual Engine. It supports PDF and photo conversion, a saved manual library, animated assembly guides, and voice control. The KNARREVIK demo opens from its matching PDF preview without generating a new guide; the prepared STRANDMON demo is available separately.

## Try it

1. Choose **Search for your manual online** or **Upload your manual**. To try the demo, search for KNARREVIK, choose **Use this manual**, then select **KNARREVIK demo** beside **Create animated guide** on its PDF preview. Other manuals offer guide creation.
2. For the supported KNARREVIK manual, choose **Scan my parts** to identify loose parts from a photo and review their counts.
3. Select an assembly step. **Step view** automatically zooms into the active operation and returns to the whole build when its final action finishes.
4. Play, pause, scrub, change speed, or drag to inspect the model. Use **Talk to guide → Start voice** for spoken explanations and controls.

| Entry point | What it opens |
| --- | --- |
| `/` | Manual Engine: search, upload, saved guides, and PDF previews. |
| `/engine.html` | Alternate entry to the same Engine. |
| `/demo.html` | Prepared STRANDMON guide with 16 assembly steps. |
| `/screws.html` | Experimental screw modeler and STL export. |
| `/scan.html` | Standalone KNARREVIK parts scanner. |

## Run locally

Requires **Node.js 22.9+** and npm.

```sh
npm ci
npm run dev
```

Open [localhost:4173](http://127.0.0.1:4173/). Saved guides, the prepared demos, and Screw lab work without an API key.

To enable conversion, web search, and parts recognition, stop the server and create a local configuration:

```sh
cp .env.example .env.local
# Set OPENAI_API_KEY in .env.local.
npm run render-browser
npm run dev
```

`npm run render-browser` installs Chromium for the local conversion checker. It uses an isolated browser with local renderer assets, not your personal browser profile. New local conversions require this checker; missing Chromium produces an error rather than skipping visual review. Hosted conversion uses the visitor's WebGL browser instead.

The local server binds to `127.0.0.1`. Use the Worker build for hosted deployment.

### Configuration

These are the repository's configured defaults:

| Variable | Purpose | Default |
| --- | --- | --- |
| `OPENAI_API_KEY` | Your OpenAI credential for local development. | Unset |
| `OPENAI_MODEL` | Manual extraction, geometry generation, and review. | `gpt-6-astra` |
| `OPENAI_SEARCH_MODEL` | Explicit web searches for manuals. | `gpt-5.4` |
| `OPENAI_SCAN_MODEL` | Parts recognition. | `gpt-5.4` in `.env.example` |
| `OPENAI_BACKEND_MODEL` | Voice copilot's delegated Responses model. | `gpt-5.6-terra` |
| `UNFOLD_PORT` | Local server port. | `4173` |

Extraction, evidence reconciliation, and visual review use high reasoning; geometry generation uses medium. Guides with more than 80 physical parts use the Astra orchestration path described below, independently of `OPENAI_MODEL`. Voice uses `gpt-live-1`. If `OPENAI_SCAN_MODEL` is omitted, scanning falls back to `OPENAI_MODEL`, then `gpt-5.4`. Legacy `PORT` is used when `UNFOLD_PORT` is unset.

The Node server reads `.env.local` and legacy `.env`, with `.env.local` taking precedence. Both are ignored by Git. Keep credentials out of frontend files, guide exports, and commits. For your own deployment, supply credentials through runtime secrets.

## Guide behavior

Every Engine guide uses the same player, whether created locally, generated on Sites, or reopened from a saved file.

- **Manual orientation:** the object turns smoothly between working poses. The reference viewing direction and page-up axis control how the furniture is presented, preserving handedness without reflecting the geometry. Playback and scrubbing keep that working pose steady.
- **Automatic close-ups:** each step starts in Step view, focuses on the active joint, and pulls back after its last action. Replaying restores the close-up. Active tightening screws are kept in frame, with surrounding parts faded to reveal the connection.
- **Inspection controls:** Whole build, Exploded view, free orbit, zoom, playback speed, and scrubbing remain available. An explicitly chosen whole or free view is preserved during playback; selecting another step restores guidance. Transitions respect reduced-motion preferences.
- **Fastening direction:** KNARREVIK's tightening animations turn clockwise when viewed from the screw-head side. Engine instructions define signed local rotation axes so tightening does not reverse when the furniture turns.
- **Linked sources and exports:** the source diagram appears beside each step and can be enlarged or browsed independently. **Review this step** edits its title, instruction, source page, and working orientation. The **•••** menu opens saved guides and downloads guides or manual PDFs. A reopened guide links diagrams only when the PDF fingerprint matches.

### Voice copilot

Voice is integrated into every Engine guide and the prepared STRANDMON demo. Open **Talk to guide**, choose **Start voice**, and allow microphone access. Use **Voice settings** to supply your own OpenAI API key for a session. The field clears after submission, and the app does not persist the entered key.

| Say | Intended behavior |
| --- | --- |
| “Next step” / “Go back a step” | Navigate immediately, stopping at the guide boundary. |
| “Go to step 3” | Jump directly to that assembly step. |
| “You mean like in step 3?” / “Explain step 5” | Answer without changing the selected step. |
| “Replay that step” / “Pause” | Control playback. |
| “Show the whole build” | Change the view. |

The copilot reads the current guide's instructions, parts, review notes, and app state. Saved guides support voice without a PDF; manual-page browsing becomes available after the matching PDF is linked. Human changes invalidate pending navigation so a delayed response cannot undo them. Changing the manual or entering another intake flow ends the voice session. Collapsing the panel keeps it connected; **Mute** disables the microphone and **End** closes the session.

Voice and delegated model work incur OpenAI API usage after the user starts a session. Automated tests mock the microphone, WebRTC, and model boundaries; they do not establish live speech-recognition accuracy or model access.

## Manuals, photos, and parts

### Manual intake and library

Conversion accepts one unlocked PDF up to **8 MB and 40 pages**, with up to **32 assembly steps**. Guides support **512 physical parts**, counting each screw and supplied tool, and up to **2,048 actions per step**. Saved guides can be up to **16 MB**. These are application resource budgets; 80 parts is a generation routing threshold. Photo intake accepts up to **20 JPEG/PNG pages**, each up to **12 MB**. Reorder, rotate, and remove pages before preparing the PDF. Images are reduced to 2,000 pixels on the longest edge; the resulting manual must fit the 8 MB limit. Manual-page HEIC input, perspective correction, and deblurring are not supported.

Search checks the saved library first. **Search the web** makes an explicit model search when needed; repeated queries, including misses, reuse cached results. **Download manual** saves the PDF without starting conversion; **Use this manual** opens its preview. Product variants and manual revisions remain distinct. Hosted manufacturer downloads currently support IKEA domains; other manufacturers' PDFs can be uploaded directly.

The local library persists in ignored `data/library/`. The hosted library uses R2 for its index and cached PDFs, with conditional index writes. The verified KNARREVIK manual appears first in the library and matching searches, with its official IKEA product photo.

### KNARREVIK parts scan

The scanner is offered only for the matching KNARREVIK manual. It recognizes loose parts against a fixed inventory of **four legs, two solid trays, sixteen screws, and one Allen key**. It is not a general parts scanner for arbitrary Engine guides.

Select a JPEG, PNG, or HEIC photo, then choose **Identify parts**. Phone photos are decoded and compressed before upload. Review suggested matches, boxes, and counts; edit mistakes before returning to the same assembly step. Selecting a photo alone does not make a model request. See [scanner details and validation](docs/KNARREVIK-SCAN.md) for image limits, recognition behavior, and export format; its earlier deployment notes are historical.

### Demo limits

The saved KNARREVIK guide has six steps and corrected manual poses, corner assignments, camera behavior, and tightening directions. Its original final model-based visual review was not completed. Step 6 animates six representative screws, while its instructions require tightening all sixteen. The displayed turns illustrate motion rather than a specified torque or turn count.

STRANDMON is a separate, manually authored reference guide. For a small conversion fixture, use [MINI TABLE](examples/mini-table.pdf) and its [saved guide](examples/mini-table.unfold.json). It is an authored test manual, not an IKEA product or CAD model.

## How the Engine works

1. **Extract evidence.** Parse the PDF, check page counts, and read every page in small batches to identify inventory, numbered steps, source pages, and uncertainty.
2. **Reconcile the manual.** Independently review the whole document, including cover and completed views. Check distinct physical parts, quantities, broad surfaces, connection topology, and working poses.
3. **Generate the guide.** Build compound primitives and timed actions, mapping each physical instance to its source component. Validate references, parent relationships, action timing, geometry, final visibility, and handling rotations.
4. **Compare rendered stages.** Render the actual player: completed-product overview, every assembled stage, and a representative active connection per step. Compare each capture with its source PDF page. Local runs use isolated Chromium; hosted runs use the visitor's browser with a temporary R2 relay. Keep the hosted tab open until conversion completes.
5. **Correct or return.** A clear mismatch triggers one correction and fresh rendering/review. Missing or extra components and incorrect poses can trigger a new source-evidence check. Persistent mismatches or incomplete checks return an error. Successful exports include provenance, component coverage, review notes, and the visual-review report.

### Larger guides

Inventories of **81–512 physical parts** use `gpt-6-astra` with **high reasoning** to coordinate part generation. The coordinator sets a shared scale, geometry recipes, immutable instance IDs, parent relationships, final transforms, connection timing and manual viewing axes. Astra workers with **medium reasoning** then generate geometry and actions in groups of at most **16 parts**, with **two groups running concurrently**. Workers can read the full plan but can only generate and animate their assigned parts.

Both coordinator and workers request [Fast mode](https://developers.openai.com/api/docs/guides/priority-processing) with `service_tier: "priority"`; the final visual review also requests Astra high Fast. Fast availability and pricing depend on the API project and model, and Astra Fast is unavailable with EU data residency. Unsupported requests return an error rather than silently changing the requested processing mode. Export provenance records the requested tier and any provider-reported generation tiers.

The Engine validates the plan before dispatch, retries an invalid plan or part group once, and cancels sibling work if a group cannot finish. It merges groups in a deterministic order, checks complete physical coverage and final transforms, then runs the same whole-guide source and rendered-stage checks used by smaller guides. A visual correction replans and regenerates the complete guide. No partial guide is returned. Usage includes the coordinator, workers, corrections and review. Guides with 80 or fewer parts retain the existing single-generation-call path.

Generated geometry remains approximate. Structural and model-based visual checks can miss errors, and sampled screenshots cannot prove every motion or connection. Step review records a user's edits and checks; it does not establish CAD accuracy, physical fit, or fastening strength. Primitive geometry and action paths are currently edited in guide JSON.

### Guide contract

The shared [schema](dist/guide-schema.js) uses `schemaVersion: "1"` and rejects unknown or executable fields. Parts and actions use transforms relative to `parentId`; root actions remain in the unrotated assembly frame. Primitive transforms are local to their part. The player applies the whole-build pose separately, so an orientation-only step can have no actions.

`action.axis` is part-local. `turns` is a signed integer under the right-hand rule: for an axis pointing outward toward the screw head, negative turns tighten an ordinary right-hand thread. Persistent quarter/half turns belong in `toRotation`. Camera focus, `cameraDirection`, and `cameraUp` use assembly coordinates; the viewing axes represent the original drawing. Older saved guides without `cameraUp` retain their canonical pose fallback.

## Development

The frontend is plain HTML, CSS, and JavaScript using vendored Three.js and PDF.js. **`dist/` contains editable source. Do not delete it as a build cleanup step.**

| Area | Main files |
| --- | --- |
| Engine UI and playback | `dist/engine-app.js`, `dist/generated-viewer.js`, `dist/guide-state.js` |
| Manual processing and checks | `engine/extract.mjs`, `completeness.mjs`, `convert.mjs`, `semantics.mjs` |
| Rendering and visual review | `engine/render.mjs`, `visual-review.mjs`, `evidence-repair.mjs`, `dist/render-capture.js` |
| Hosted conversion relay | `dist/hosted-convert.js`, `server/render-relay.mjs` |
| Voice UI, tools, and sessions | `dist/copilot-ui.js`, `dist/engine-copilot.js`, `dist/copilot-tools.js`, `dist/live-session.js`, `server/voice-config.mjs` |
| Local and hosted voice endpoints | `server/voice.mjs`, `server/hosted.mjs` |
| Photo intake, manual library, scanning | `dist/photo-intake.js`, `manual-library.js`, `scan.js`; corresponding modules in `server/` |
| Local server / combined Worker | `server/local.mjs` / `server/site.mjs` |
| Prepared STRANDMON demo | `dist/app.js`, `dist/viewer.js`, `dist/steps.js` |
| Tests | `test/` and `tests/` |

```sh
npm test
npm run build
# Optional local PDF conversion with an explicit, verified page count:
npm run convert -- examples/mini-table.pdf 3 /tmp/mini-table.unfold.json
```

Code verification on **2026-09-13** passed **197 tests**. Coverage includes the 80/81-part routing boundary, shared-plan validation, bounded worker concurrency, cancellation and correction, conversion and visual-review contracts, camera framing through object turns, clockwise tightening, deterministic playback, photo preparation, library persistence, voice navigation and stale-action protection, request limits, undated saved-manual sorting, and hosted routing. Tests use controlled provider responses and need no API key. The larger-guide orchestration has not yet been validated against a live model conversion of a large manual. See [VALIDATION.md](VALIDATION.md) for earlier dated walkthroughs and their limitations, rather than current deployment status.

### API entry points

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Conversion availability and limits. |
| `POST /api/convert` | PDF conversion with streamed progress/result/error events. |
| `POST /api/photos` | Prepare ordered JPEG/PNG pages as a PDF. |
| `GET /api/library`, `POST /api/library/web-search` | Saved lookup and explicit web search. |
| `POST /api/library/:id/pdf` | Fetch/cache a saved manual's PDF. |
| `GET /api/scan-health`, `POST /api/parts-scan` | Scanner availability and recognition. |
| `GET /api/voice/readiness`, `POST /api/voice/session` | Voice readiness and WebRTC session creation. |
| `GET /api/conversion-render/:id`, `POST /api/render/:id` | Hosted progress/render relay used by the browser. |

Use the frontend clients as examples of request headers and payloads. Conversion admits two concurrent requests per process/isolate; voice creation has a per-key limiter. These are operational limits, not distributed account quotas or spending caps.

## Hosting

The live Site uses the combined Worker in `server/site.mjs`, serving conversion, library, scanning, voice, and static assets. `npm run build` produces:

- `dist/server/index.js`: bundled Worker.
- `dist/client/`: public assets copied from the authored frontend.
- `dist/.openai/hosting.json`: deployment metadata.

Generated output is ignored by Git. Prior build output moves to ignored `.sites-runtime/build-backups`; authored files remain intact. Hosted conversion and the manual library require the `BUCKET` R2 binding.

Publish the Worker and assets together through Sites using the existing project in [.openai/hosting.json](.openai/hosting.json). Push the exact source to the Site's configured repository, package the build output, then save and deploy that version while preserving its access policy. **Pushing or merging to GitHub does not deploy Sites.** The scanner-only entry and a static-only upload do not provide the complete app.

For local Worker verification:

```sh
npm run preview:hosted
```

Open [localhost:4191](http://127.0.0.1:4191/). [wrangler.jsonc](wrangler.jsonc) configures the Worker, assets, and local R2 binding. With that preview running **without API credentials**, `node scripts/verify-hosted.mjs` checks asset integrity, readiness, missing-key rejection, and request boundaries without calling OpenAI.

## Data handling

Manual conversion sends PDF contents and rendered stage screenshots to OpenAI using Responses requests with `store: false`. Direct uploads are processed for the conversion session rather than added to the saved library. Hosted progress, guide-render jobs, and captures pass through temporary R2 objects; normal completion and cancellation paths clean them up. Search metadata and PDFs explicitly loaded from library results are persisted separately.

Parts recognition sends the prepared photo and reference diagrams to OpenAI; the server does not persist scene photos or recognition results. Voice sends microphone audio, the conversation, selected guide context, and app state. It does not send PDF bytes, images, filenames, or meshes. Voice transcripts stay in browser memory and clear on the next start. Provider retention policies still apply; `store: false` is not a zero-retention guarantee.

## Screw lab

Screw lab generates a preview and binary STL entirely in the browser. It offers metric M3–M12 coarse-pitch presets, custom dimensions, external hex/hex socket/thumb-grip heads, and thread handedness. Geometry uses millimetres, with the head on the XY print bed. The KNARREVIK entry includes its manual part codes but no claimed matching dimensions.

This is an experimental geometry and fit-test tool. No physical print, load capacity, torque rating, or replacement-hardware fit has been validated.

## References

- [BUILD_SPEC.md](BUILD_SPEC.md): original product brief and prepared STRANDMON sequence.
- Three.js 0.180.0 (MIT), PDF.js 5.4.149 (Apache-2.0), pdf-lib (MIT), and LinkeDOM (ISC). Browser libraries and their license files are vendored under `dist/vendor/`.
- [STRANDMON manual AA-2019535-7](https://www.ikea.com/th/en/assembly_instructions/strandmon-wing-chair-kelinge-beige__AA-2019535-7-100.pdf).
- [KNARREVIK manual AA-2547698-1](https://www.ikea.com/kr/en/assembly_instructions/knarrevik-bedside-table-black__AA-2547698-1-100.pdf).

IKEA manuals and diagrams © Inter IKEA Systems B.V. Unfold is not affiliated with IKEA.
