# Validation

Checked on 2026-09-13 against the local Node server using Aside CLI, its actual browser, WebGL rendering, and PDF.js.

## Automated checks

`npm test`: **29 passing tests**. Coverage includes the PDF evidence/generation pipeline, structural validation, parent-child movement, deterministic seeking, removed tools, duplicated build rotation, camera floor limits, stream cancellation, concurrency, image format/dimension/decompression limits, EXIF/quarter-turn transforms, photo page order, saved query/PDF reuse after restart, grounded source filtering, public-source DNS/redirect restrictions, and the intake/library/player UI callbacks.

The library's paid provider search is tested with controlled Responses API results, including citations and rejected sources. No live product web search was run. The implementation's ability to find a particular real product has not been established by those tests.

## Browser walkthrough

| Flow | Observed result |
| --- | --- |
| PDF upload → Generate | Three-page authored MINI TABLE manual produced five parts and two steps through streamed server progress. |
| Working orientation | Tabletop turns upside down once; attached legs remain above the work surface. Step two rotates the completed table upright. |
| Guided camera | Joint view exposes the active leg mount. Orbit and wheel zoom switch to free view; Step view restores guidance at the same progress. Orientation-only steps retain whole-build framing. |
| Playback | Play advances the timeline; scrubbing pauses and moves deterministically. Previous/next, whole-build and exploded controls respond. |
| Source manual | Steps one/two link to pages two/three. Independent page navigation, relink and enlarged diagram work. |
| Review/export | Step review can be saved; the downloaded JSON contains the checked-step marker. Reopened guides relink the matching original PDF. |
| Photos | Three JPEG renderings of the authored manual were uploaded, reordered, rotated and restored, then prepared as a three-page image-only PDF. A live model conversion produced five parts and the same two assembly steps, with source diagrams alongside them. |
| Library UI | Opens an empty saved library, searches locally, and presents the explicit Search the web action after no match. No external search was triggered during browser QA. |
| Small viewport | Library dialog and intake controls rendered in a 390×844 same-origin iframe viewport. The document's content width equalled its 390 px viewport. This was not a physical-phone camera test. |
| Browser errors | No page errors were recorded during the walkthrough. |

The original browser automation connection could not complete its policy check. The user requested Aside CLI, whose normal authenticated browser controls completed this walkthrough. A temporary viewport test page was removed afterward.

## Bugs caught and corrected

- The first generated table applied a whole-build flip again as a root-part action. The generation prompt and correction checks now separate handling orientation from local part movement.
- A generated camera direction ended below the support plane after a flip. Guided cameras now stay above it.
- Step view cleared exploded geometry without clearing the UI toggle. Both now agree.
- Laptop playback could fall below the viewport; the workspace now keeps playback visible and scrolls long instructions.
- PDF replacement and loading hide previous source images and stale guide labels.

## Accuracy limits

The live STRANDMON extraction retained sixteen ordered steps on source pages 5–20. Its generated draft still contained mistaken hardware interpretations and pose assumptions. Structural checks do not establish physical accuracy; generated guides require comparison with the original manual. The prepared STRANDMON example remains separate.

Photos in the browser test were clean JPEG renderings, not handheld photographs. Blur, glare, perspective distortion, and native camera behavior still require real-device evaluation. The photo input supports JPEG/PNG and provides rotation/order controls; it does not implement deblurring or perspective correction.

This work is verified locally. The existing Sites connection could not find the saved Site; the server-backed engine and persistent library have not been hosted there.

## Rendered evidence

![Photo pages in reading order](docs/validation/photos.png)

![Guide generated from JPEG pages](docs/validation/photo-guide.png)

![Library search at phone width](docs/validation/library-phone.png)
