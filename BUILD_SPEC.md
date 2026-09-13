**Unfold — build specification**

Build a web app that turns assembly instructions into an interactive 3D guide. Users must be able to understand the working orientation, identify the active connection, and inspect each action beside its original manual diagram.

**User flow and initial scope**

Upload a manual → identify the supported guide → explore the parts → follow animated steps beside the original diagram → pause, rotate, zoom, and replay the confusing action.

The first release supports IKEA STRANDMON manual AA-2019535-7 through a prepared 3D model and 16 animated assembly steps, plus an overview. Recognize the product and manual edition before linking an uploaded PDF to the guide. An unfamiliar PDF opens as a clearly labeled PDF preview. Keep any prepared STRANDMON example visibly separate from that preview.

**Layout and controls**

- Desktop first, with usable phone controls and a collapsible manual panel.
- A light canvas, crisp controls, blue highlights, and a recognizable mustard STRANDMON chair.
- The chair takes most of the space. Step navigation sits to the left, the source manual to the right, playback below.
- Play/pause, replay, scrub, previous/next, orbit, zoom, and a button to restore the guided view.
- Playback speed selection; pause at the end of each step until the user advances.
- “Step view” focuses on the active connection. “Whole build” restores context. Exploded view explains the separate parts.
- The assembly itself turns onto its back or either side when the manual calls for it. Camera movement and build orientation are separate controls in the implementation.
- Visible labels for the active step, required parts/tools, and working orientation. Highlight active hardware with color and a label.
- Support keyboard operation, touch orbit/zoom, visible focus states, and reduced-motion preferences.

**Build orientation and camera behavior**

Animate the assembled parts together when changing the build's working orientation. Keep the assembly visually grounded on the support surface throughout the transition. Loose parts and tools retain their intended relationships to the active connection.

Start a step with enough context to locate the operation, then move closer to the active joint. Camera targets follow the build's transformed position. Avoid clipping through geometry or hiding the connector behind upholstery. Whole-build framing must fit the current assembly within the viewport.

Manual orbit or zoom suspends the guided camera. Restore guidance when the user selects “Step view” or changes steps. Camera changes must preserve playback progress.

**Step 3: secure the seat joint**

Show the frame in the correct working orientation, preserve a readable reference to the whole build, then move closer to the active joint. Animate washer placement, nut threading, and socket-tool engagement in separate beats. Highlight the connector while leaving enough surrounding structure to explain where it belongs. Keep the underside visible so upholstery cannot hide the connection.

Use about ten seconds for this sequence, with a pause at any point. Manual page 7 stays alongside it. The user can orbit freely without the camera immediately taking control again, then press “Step view” to return. Show that the connection is repeated on the other side.

Acceptance: someone unfamiliar with the chair can identify the working orientation, washer/nut order, and tool approach after watching.

**PDF behavior**

Provide file selection and an “Open STRANDMON example” action. Read uploaded PDFs in browser memory. Limit files to 20 MB and 100 pages. Show recoverable errors for invalid, password-protected, or oversized files.

Display the source page linked to the active step. Allow independent page navigation and diagram enlargement. Independent navigation suspends page linking until the user selects a relink action or changes assembly steps. Handle rapid page changes and replacement uploads without showing stale results.

**Architecture**

Implement the initial release as a client-side web app using Three.js for the scene and PDF.js for the manual. Three.js OrbitControls supplies orbit, zoom, and pan ([official documentation](https://threejs.org/docs/pages/OrbitControls.html)); PDF.js provides browser PDF page rendering ([official examples](https://mozilla.github.io/pdf.js/examples/)). Pin dependency versions. The initial release requires no account, database, or server upload.

| Module | Responsibility |
| --- | --- |
| Manual viewer | Read the PDF, render pages, enlarge a diagram, and restore page-to-step linking. |
| Guide data | Product/manual identity, part IDs, source pages, ordered actions, build poses, and camera keyframes. |
| Assembly scene | Named meshes, connector anchors, assembled/exploded transforms, highlights, and build orientation. |
| Player | One selected step and normalized progress value; playback, seeking, and camera mode. |

Each guide contains product identity, manual edition, page count, model reference, a part registry, an overview, and ordered assembly steps. Each step contains `id`, `title`, `instructions`, `sourcePage`, `duration`, `partIds`, `buildPose`, `actions`, and `cameraKeyframes`. An action identifies a part or tool, its motion, and its time interval. Keep geometry in the scene module and instructions in guide data.

Expose a small scene interface: set step/progress, set view mode, toggle exploded view, and dispose. Keep playback state in one place so the controls, manual viewer, and scene remain synchronized.

Compute assembly state from the selected step and time, so jumping straight to step 13 produces the same scene as playing there. Previously assembled parts persist; future parts stay hidden until needed. Store connector anchors in part-local coordinates and transform camera targets with the build. Manual orbit suspends guided camera movement until explicitly restored or a new step is selected.

**STRANDMON source and assembly sequence**

Use this exact [IKEA STRANDMON manual](https://www.ikea.com/th/en/assembly_instructions/strandmon-wing-chair-kelinge-beige__AA-2019535-7-100.pdf). For this edition, assembly steps 1–16 map to PDF pages 5–20; step 3 is page 7. Validate against the actual diagrams while implementing. Keep the source attribution visible.

| Step | Action | PDF page |
| --- | --- | --- |
| 1 | Fit the two connecting studs. | 5 |
| 2 | Join the seat frame and backrest. | 6 |
| 3 | Secure the seat joint with washers and nuts. | 7 |
| 4 | Attach the shorter rear legs. | 8 |
| 5 | Attach the longer front legs. | 9 |
| 6 | Fit brackets to both detached side panels. | 10 |
| 7 | Align the first side panel. | 11 |
| 8 | Press the first panel down to engage its hook. | 12 |
| 9 | Insert the first side's bolts and washers. | 13 |
| 10 | Tighten the first side's bolts. | 14 |
| 11 | Align the second side panel. | 15 |
| 12 | Press the second panel down to engage its hook. | 16 |
| 13 | Insert the second side's bolts and washers. | 17 |
| 14 | Tighten the second side's bolts. | 18 |
| 15 | Add protective pads to the four feet. | 19 |
| 16 | Turn upright and fit the seat cushion. | 20 |

- Step 3: washer 100837, then nut 100712, with tool 120202; two connections.
- Step 4: shorter rear legs. Step 5: longer front legs. Both use the large leg washers.
- Side-panel hooks must engage before their underside bolts are tightened. Show the appropriate side of the build for each panel.
- Step 15: protective pads belong on the feet. Step 16: turn upright and fit the cushion.
- Do not invent measurements, torque values, or unseen fastening details. The manual remains the source of truth.

**Extension to additional manuals**

Design the guide format to accept future conversion output: PDF page images/text → extracted parts and actions with source-page references → editable draft guide → mapping to known 3D parts and actions → the same player. Automatic conversion is outside the initial release.

Reading a diagram does not by itself provide reliable geometry, hidden connectors, or motion constraints. A future converter must map to supported assets and actions, identify missing geometry, and flag uncertain relationships for review. Keep any model credentials on a server when conversion is implemented.

Validate generated guide structure, part references, and action timing before playback. Keep prepared guides and generated drafts visibly distinguishable.

**Acceptance criteria**

- The supported manual opens the matching guide; another PDF opens an honest preview state; invalid files produce a recoverable error.
- All 16 assembly steps display the matching original diagram and correct parts.
- Playback, scrubbing, backward navigation, and direct jumps produce consistent assembly states.
- Build reorientation stays visually grounded; the active joint remains visible; manual orbit and guided view work together.
- Step 3 visibly separates washer, nut, and tool. Side-panel steps show tool access from the correct side.
- The target laptop runs the full guide smoothly. A phone can navigate steps and operate the primary controls without overlapping or inaccessible buttons.
- The deployed app loads its model, manual, and dependencies successfully in an authorized user's browser session.

Use focused state/navigation checks plus an actual rendered walkthrough. A geometry-only test cannot establish whether the camera shows the joint clearly. If browser automation is unavailable, perform the visual walkthrough manually and record what was checked.
