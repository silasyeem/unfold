# Unfold

A quick STRANDMON assembly MVP: interactive 3D, sixteen animated steps, playback and scrubbing, exploded/underside views, and the source manual alongside each step.

## Agreed design

- Prepared STRANDMON example plus a real PDF intake flow; general conversion is future work.
- Minimal light working surface, blue controls, recognizable mustard chair.
- Desktop first, usable on phones.
- Original manual visible beside the 3D model and linked to each assembly step.
- Rotate, zoom, pause, replay, and move between steps.

## Scope and limitations

The 3D model is procedural and simplified. The prepared guide follows IKEA STRANDMON manual AA-2019535-7, pages 5–20. It retains an upright inspection pose; follow the source diagrams for how to support and turn the actual chair. Hardware placement is illustrative, not CAD-verified.

PDF files stay in browser memory. The upload flow recognises the 20-page STRANDMON AA-2019535-7 document from its text and links it to this prepared animation. Other PDFs can be previewed without claiming an automatic conversion. No model API, secret, account database, or server upload is used.

## Running locally

Serve `dist` with a local HTTP server, for example `python3 -m http.server 4173 --directory dist`. No build step is required. Three.js and PDF.js are vendored. DM Sans loads from Google Fonts with a system font fallback.

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
- Automated browser visual/GPU rendering verification could not run because browser access failed its administrator policy check. WebMCP validation is unit-level only, not browser integration validation.

The static Site is published with owner-only access by default.
