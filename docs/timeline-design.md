# Timeline workstation

Desktop lyric editing, React 19 and Canvas. Visual direction uses the existing dark/light tokens, lime lead track, lavender backing track, system typography and a shared axis. UI UX Pro Max style guidance: minimal workstation; its marketing hero page pattern was rejected as unrelated. Verified dragging-movements guidance: navigation has buttons, native range controls and keyboard alternatives.

## Layout

1. View and navigation toolbar: waveform/spectrum, song/selection/cursor, explicit follow state and logarithmic zoom.
2. Persistent whole-song overview. Manual panning and zoom switch follow off; Cursor resumes it.
3. Adaptive ruler aligned to the canvas, independent of track heights.
4. Fixed track headers: lead, backing, audio source, phrase bounds. All existing canvas actions remain available.
5. Scroll range and current span. Current-phrase word chips can still be reduced or hidden.

## Interaction contract

Ctrl/Cmd+wheel zooms at the pointer with normalized pixel/line/page units. Changes coalesce into the central animation frame, including while paused. Bounds stop at the song extent including outlying words. Manual navigation is local viewport state, never a project edit. Zoom labels adapt to the visible duration. Spectral reduction happens in a worker; canvas tiles use a bounded LRU cache. Tiny word blocks retain hit targets but omit unreadable labels.

Text edits in the preview commit before a timeline, player, row list, inspector or navigation pointer, wheel, click or keyboard action. Empty text or a conflicting external update keeps the edit open with its error and blocks that action. Cancel remains explicit; normal text input is untouched. Text edits and subsequent timing edits retain separate undo steps.

## Validation

Unit coverage for pointer anchoring, zoom bounds, wheel units, fitting, ruler density and spectral attack preservation. Browser coverage for paused zoom, 1000-event burst, unchanged timing and saving before the first drag/wheel interaction. Existing editor tests cover overlap, backing tracks, splitting and playback. Dark/light screenshots use isolated demo data.

## Measured checks on the development PC

142 unit tests passed. 44 editor browser tests plus a dedicated ten-minute real-audio spectrum test passed. A 1000-event wheel burst coalesced to two canvas clears (17–25 ms in the measured runs). Fitting the ten-minute spectrum took 97 ms including browser interaction and used one new tile; the worker supplied steps 4/16/64. These measurements are observations on this PC, not a hardware-independent latency guarantee.

## Montage layout (1.5)

The selected design is Montage. The main lyric preview remains full width above the bottom timeline. Exact timing is closed by default for new preferences; opening it places the existing inspector beside the lower canvas, preserving the preview width. Saved explicit inspector preferences remain supported. All prior commands, both vocal lanes, audio views, sync/undo, export fitting and automatic preview text saving remain available.

Word blocks use quiet rounded fills, clear selected edges and smaller join indicators; the hit boxes and timing model are unchanged. Larger default lead/back lane heights remain resizable. A selected-word strip exposes timing, previous/next word, listen and exact-time controls. Dock resizing supports keyboard arrows/Home as well as dragging. Canvas resize observation repaints when the inspector or window changes size.
