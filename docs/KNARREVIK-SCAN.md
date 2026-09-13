# KNARREVIK photo scan

The scanner is offered after a guide is ready, only when its source PDF fingerprint matches the verified demo manual. It opens over the workspace, preserving the guide, linked PDF, reviewed steps, playback position, and scan edits when closed and reopened. Selecting another manual clears the scan. Scan a photo explicitly, review the counts, then choose **Back to assembly guide** to continue. The legacy `/scan.html` address remains available as a standalone tool. On the hosted demo, the manual search dialog explains that live search/conversion is unavailable and offers **Open KNARREVIK demo** to continue with the saved guide.

In `/engine.html`, create a guide from the KNARREVIK manual or open **KNARREVIK demo**, then choose **Scan my parts** to compare a single overhead photo of loose parts with IKEA KNARREVIK black, 37 × 28 × 45 cm, Singapore article **805.763.19**. The manifest was checked visually against [IKEA manual AA-2547698-1](https://www.ikea.com/sg/en/assembly_instructions/knarrevik-bedside-table-black__AA-2547698-1-100.pdf), pages 6–12: two solid trays, four individual angle legs, 16 screws total, and one hex key. The screw codes printed together are alternatives, not separate quantities.

Choose a JPEG, PNG, or HEIC, or take a phone photo. The browser decodes it locally, normalizes orientation, resizes its longest edge to 2,000 pixels, and encodes a JPEG at 90% quality without source metadata. The input limit is 20 MB and 50 megapixels; the prepared upload remains bounded to 8 MB. HEIC decoding loads a vendored, CSP-compatible `heic-to` 1.5.2 module only when native decoding fails. Its license is in `dist/vendor/heic-to.LICENSE.txt`.

Selecting a photo makes no model request. **Identify parts** sends the prepared image, the fixed manifest, and three clearly marked manual reference diagrams to the OpenAI Responses API with `store: false`. The server does not persist scene images or results. Provider retention policies still apply. Existing site access controls are preserved. The local endpoint remains a private, loopback-only development service.

Matches and normalized bounding boxes are provisional. The user can change each match's type/count, remove false detections, and edit/check the per-type totals. Changing detections resets the reviewed totals. New photos replace the previous scan; counts are never added across views. Unknown objects, approximate counts, and absent observations remain visible. User-checked totals matching the manual are not a certification of kit completeness. JSON export preserves original observations separately from edited detections and reviewed counts; it contains no photo.

The schematic 3D reference highlights one example of a chosen part type and links to the relevant manual page. It is an identification aid, not CAD or a new generated assembly sequence.

## Runtime

- `GET /api/scan-health`: recognition availability and upload limit; no credential values.
- `POST /api/parts-scan`: raw JPEG/PNG body and `X-Unfold-Scan: 1`. Supplied cross-origin requests are rejected. Streaming uploads are bounded; two scans may run concurrently per process/isolate, with a 90-second timeout and cancellation propagated upstream.
- `OPENAI_SCAN_MODEL` overrides `OPENAI_MODEL`; the scanner defaults to `gpt-5.4`.
- `server/api.mjs` integrates scanning into the full local Node app.
- `server/scan-worker.mjs` adds recognition to the previously static hosted Site. Manual conversion and library search remain local features; the hosted health endpoint reports conversion unavailable.

Build the scanner Worker with esbuild (`server/scan-worker.mjs`, bundled ESM, browser platform, ES2022 target, output `.build/scan-worker.js`), then run `node scripts/stage-scanner.mjs`. The latter assembles `.build/hosting/dist/server/index.js` and `.build/hosting/dist/client`, with the existing Site's hosting metadata. Package `.build/hosting` using the Sites packaging helper. Keep the API key in the Site's runtime secret store, never in the bundle.

## Validation on 13 September 2026

- Tests cover malformed detections, impossible boxes, unknown categories, preserved excess counts, unchecked/uncertain observations, original-versus-edited result separation, photo replacement, origin/type/size checks, concurrency, cancellation, and timeouts.
- A 24-megapixel source is reduced to 2,000 × 1,500 before JPEG upload in the compression test.
- A real API request with a manual diagram as the scene returned no detections and requested an actual photo.
- The user's real laid-out-parts photo returned two trays, four legs, one hex key, and approximately 16 screws. The scan noted the booklet obscuring a tray and requested clearer hardware counting. This is one successful example, not an accuracy benchmark.
- The original 24-megapixel iPhone HEIC was selected through the browser, decoded successfully and displayed as a 1,500 × 2,000 image. The user's photo is not included in source, public assets, or this documentation.
