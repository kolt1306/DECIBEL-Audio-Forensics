# Frontend visual polish

The existing DECIBEL instrument, analysis flow, and typography are retained. Graphite surfaces replace the olive cast; idle signals use steel, with green, amber, and red reserved for results. A separate window-level risk plot exposes probability, time ranges, a peak marker, and a restrained heat band without obscuring the recording waveform. Overlapping windows and skipped predictions remain explicitly identified.

## Motion and accessibility

- The cursor core follows the pointer with a delayed, velocity-responsive signal echo. Important controls attract by at most three pixels and settle with frame-rate-independent interpolation. Text fields and sliders retain native pointers.
- Pointer animation uses transforms and closure-held samples, never React updates per move. Its RAF stops when settled, on blur, on tab hiding, and on teardown. Pointer capability and reduced-motion changes are handled live.
- Short entrances, in-view result reveals, one animated primary score, a moving risk marker, waveform hover timestamps, and height-animated diagnostics share motion constants. Processing sweeps are decorative; progress numbers and segment counts come exclusively from job responses.
- SVG frequency contours supply restrained background depth; motion pauses in hidden tabs. Loaded waveforms do not continuously redraw, and their playback marker uses a transform transition independent of the canvas. Canvas pixel density is capped at 2.
- Reduced motion removes decorative background/cursor motion, magnetic attraction, CSS transitions, score counting, and risk-marker movement. Essential live microphone amplitude remains available. Focus indicators, segment keyboard focus, accessible disclosure, status announcements, and native playback seeking remain available.

## Verification

- `npm test`: 21 tests passed across 7 files, including existing API integrity, cancellation, recorder, and canvas checks plus cursor lifecycle/capability changes, timeline seeking, recording controls, report payload preservation, and diagnostics/copy controls.
- `npm run typecheck` and `npm run build`: passed.
- Browser layouts inspected at 1440, 1280, 768, 390, and 320 pixels; inspected views had no page overflow. Mobile controls and results reflow; technical tables have their own horizontal scroll region.
- Browser states inspected: idle/API unavailable, uploaded waveform, processing with real fixture segment counts, low/medium/high risk, standard/phone comparison, segment seeking, copy acknowledgement, cancellation, inference failure, and model warmup. Result/failure responses used an isolated local synthetic API fixture, not the live inference server. No fixture code or mock API configuration is shipped in the application.
- Physical microphone permission remained pending in the in-app browser, so real capture was not confirmed. Recording, initialization, stopping, and failure behavior are covered by tests. The browser download notification could not be observed; the exported Blob, complete report payload, filename, and export action are verified by a component test. OS-level reduced-motion switching was not available through the browser controls; static canvas and cursor policy behavior are tested, and the CSS/Motion reduced-motion paths were reviewed.

## Scope and Git safety

Only frontend files changed. API clients/contracts, audio decoding, the recorder hook, backend files, model loading, analysis mathematics, and dependency lockfiles are unchanged. Upload, recording, playback, region loops, asynchronous submission/progress/cancellation, channel comparison, batch controls, readiness/errors, diagnostics, copy, and JSON export remain available.

Work is isolated on `feature/frontend-visual-polish`. The original repository remains on `main`; its pre-existing `backend/app/model.py` modification was preserved. The live backend was not stopped, restarted, or given model-download/inference work for QA.
