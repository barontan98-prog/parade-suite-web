# Parade Suite Windows v0.57 — UI Cleanup

Built from Windows v0.56.

## Toolbar cleanup
Removed:
- Import legacy .lib
- Open Manager

Reason:
- Legacy timing maps are now imported from `+ Import LIB` inside Parade Editor.
- Parade Manager already has its own tab, so Open Manager was redundant.

New / Open / Save remain.

## Parade Sequence
Removed the Up / Down arrow buttons.

Rows can now be reordered by:
    click and hold a row -> drag -> release at the desired position

The underlying parade sequence is updated when the row is dropped.

## Drum Cues
Removed the Cue Source dropdown.

Parade Suite now uses the established original cue system automatically, while
retaining the existing Bass Boost / cue behavior and dedicated Knights ending.

## Parade Manager wording
Changed:
    No parade loaded
to:
    No Parade Music Loaded

## Larger controls
- larger transport buttons
- larger Drum Cue buttons
- larger End Song / Next Song buttons
- thicker progress / volume / bass sliders
- larger slider handles

## Existing behavior retained
- clean persistent Music Library
- separate Import Music / Import LIB
- v0.55 music ducking behavior
- Quick March repeat behavior
- dedicated Knights of St John Ending Beat
- End Song / Next Song timing logic


## v0.58 — Timing Map Status Icons

The Music Library no longer appends `• TIMING MAP` to track names.

Instead:
- ✅ = matching LIB timing map is loaded
- ❌ = no matching LIB timing map is currently loaded

The actual track name remains unchanged.

The tooltip also shows:
- Timing map: Loaded
- Timing map: Not loaded

All v0.57 UI cleanup and playback behavior are retained.


## v0.59 — Larger UI Fonts

Readability update:
- application text increased to 14 px
- Music Library text increased and given more vertical spacing
- Parade Sequence text and headers increased
- Parade Sequence rows increased to 40 px
- buttons enlarged
- tabs enlarged
- search/category controls enlarged
- toolbar text enlarged
- Now Playing main title enlarged

No playback, timing-map, library, cue, repeat or ending behavior was changed.


## v0.60 — Music Library Search Bar

The Music Library now has a dedicated search field directly above the Category
dropdown.

Search filters the visible Music Library as you type while still working
together with the selected category filter.

The previous top-wide search field has been removed to keep the layout cleaner.

No playback, timing-map, library persistence, cue, Repeat, End Song or Next Song
behavior has been changed.


## v0.61 — Sequence Actions + Interlude Mixer

### Repeat / End only
Continue has been removed from the operator workflow.

New and edited tracks use only:
- Repeat
- End

Older saved Continue actions are interpreted as End for compatibility.

### Natural End behavior
When an End track reaches its natural end:
- music stops
- Parade Manager selects the next playlist track
- the next track does NOT automatically play
- press Play when ready

The `Next Song` button remains different:
- performs the beat-synchronised ending
- then automatically starts the next parade track

### Action colors
- Repeat = green
- End = red

Colors are shown in Parade Sequence action controls and Parade Manager playlist.

### Interlude Music Mixer
A separate Interlude Music column now sits beside Drum Cues.

It has:
- Interlude track selector
- Music Playing display
- progress/music bar
- Play / Stop
- independent vertical Volume Mixer

The Interlude channel is a separate QMediaPlayer/QAudioOutput, so it can overlap
with parade music. Start the interlude at 0% and raise/lower its mixer to fade
it over the parade track.

Tracks categorized as `Interlude Music` (or titled `Interlude...`) populate this
mixer automatically.

All v0.60 library/UI features and v0.55 cue ducking behavior are retained.


## v0.62 — Parade Sequence Table Bug Fix

Fixed the broken Parade Sequence layout introduced in v0.61.

Changes:
- removed the duplicate Qt row-number header
- kept only Parade Suite's own `#` column
- `#` column fixed at 64 px
- Track column stretches to available space
- Action column fixed at 150 px
- Category column fixed at 190 px
- Repeat / End dropdown has a proper minimum width
- category text is always populated
- table cells cannot accidentally enter text-edit mode while dragging rows
- drag-and-drop row reordering remains enabled

Repeat remains green and End remains red.

All v0.61 playback and Interlude Mixer behavior is retained.


## v0.63 — Parade Sequence Action / Category Rendering Fix

The v0.61/v0.62 Parade Sequence could show blank Action and Category cells
after adding a track.

v0.63 rebuilds each sequence row explicitly and reapplies column/row sizing
after the rows exist.

Fixes:
- Action dropdown now always contains Repeat / End as permitted
- selected Action is always visible
- Repeat has a visible green border/background/text
- End has a visible red border/background/text
- Category is always written into its own table cell
- row height is fixed at 46 px
- sorting is disabled so Qt cannot detach cell widgets from sequence rows
- drag-and-drop reordering remains enabled

All v0.61 Interlude Mixer and playback behavior remains unchanged.


## v0.64 — Action / Category Runtime Fix

Root cause found:

`refresh_sequence()` uses `QColor` to render Repeat in green and End in red,
but QColor was not imported from PySide6.QtGui. This caused a runtime NameError
immediately after the Track cell was added.

That is why the Parade Sequence showed:
- # correctly
- Track correctly
- Action blank
- Category blank

Fixed:
- imported QColor correctly
- Repeat / End dropdown now renders
- Category now populates
- Track header is left-aligned
- # / Action / Category headers remain centered
- DEFAULT_ACTIONS updated to Repeat / End only

No playback, Interlude Mixer, Repeat, End Song, Next Song, or library behavior
was changed.


## v0.65 — Parade Sequence Drag-and-Drop Fix

Fixed the row-reordering bug where dragging a track could:
- move a different track
- appear to replace another track
- use the row currently under the pointer instead of the row originally dragged

Root cause:
The old code used `currentRow()` at DROP time. Qt can change the current row
while a drag moves across the table, so the wrong source row could be reported.

v0.65:
- remembers the exact row where the drag starts
- treats the sequence as whole rows, never individual cells
- does not call QTableWidget's native drop handler
- reorders the underlying sequence model with one remove + one insert
- supports dropping above/below a row and into the empty area at the bottom
- preserves Action / Category widgets after the table redraws

No track can be overwritten by the drag operation.


## v0.66 — Interlude Loop + Mixer Fader

### Interlude action
Interlude Music tracks now appear in Parade Sequence as:

    [Interlude]

instead of Repeat.

Color:
- Repeat = green
- End = red
- Interlude = blue

This keeps the playlist aligned with the parade programme while distinguishing
background/interlude audio from ceremonial march actions.

### Interlude playlist behavior
Selecting an Interlude row automatically loads that same track into the
Interlude Music panel.

Pressing the main parade Play button on an Interlude row does NOT route it
through the main parade-music player. It prepares the independent Interlude
channel instead.

### Continuous loop
Interlude Play / Loop repeats continuously until the operator presses Stop.

The loop is independent of the parade playlist.

### Mixer-style fader
The Interlude volume control is now styled as a mixer fader:
- vertical 0–100 scale
- visible tick marks
- large rectangular fader handle
- live percentage readout
- independent Interlude audio channel

This is intended for fading background music in/out during transitions.

All v0.65 safe Parade Sequence drag-and-drop behavior is retained.


## v0.67 — Automatic Interlude Fade-Out on Stop

The Interlude Music Stop button now performs a smooth automatic fade-out.

Behavior:
- Press Stop while Interlude Music is playing
- Parade Suite fades the current Interlude volume smoothly to 0
- default fade duration: approximately 2.5 seconds
- the mixer fader visibly moves down during the fade
- after the fade reaches 0, the interlude stops and resets to 0:00
- Play / Loop and Stop are temporarily disabled during the fade
- pressing Play again after completion starts normally
- Interlude looping is prevented from restarting at EOF while a fade is active

The interlude remains a separate looped audio channel.

All v0.66 playlist, mixer, drag-and-drop and playback behavior is retained.


## v0.68 — 4-Second Interlude Fade-Out

Interlude Music automatic Stop fade-out changed from approximately 2.5 seconds
to approximately 4.0 seconds.

All other v0.67 behavior is unchanged.

## v0.69 — Startup diagnostics
Retains the v0.68 4-second Interlude fade. Adds a startup error log and
Start_Parade_Suite_Diagnostic.bat for Windows-specific startup failures.


## v0.70 — QFrame Startup Fix

Fixed the startup error:

    NameError: name 'QFrame' is not defined

Cause:
The Interlude mixer UI introduced a QFrame container, but QFrame was missing
from the PySide6.QtWidgets imports.

v0.70 imports QFrame correctly.

The requested 4-second Interlude Stop fade remains unchanged.
Startup diagnostics from v0.69 are retained.


## v0.71 — Full-Height Interlude Mixer

Rebuilt from v0.70.

Manager layout:
- Playlist, Actions and Drum Cues remain in the upper-left section.
- Now Playing is shortened and sits only below those sections.
- Interlude Music occupies a dedicated right-hand column spanning both rows.
- Interlude mixer/fader minimum height increased to 300 px.
- Main playback controls and volume controls remain full-width underneath.

The 4-second automatic Interlude Stop fade from the previous update is retained.


## v0.72 — Playlist-Controlled Interlude + Visible Mixer Handle

Interlude Music changes:
- removed the user-selectable Interlude dropdown
- Interlude track now comes only from the selected [Interlude] row in the
  Parade Manager playlist
- the Interlude panel shows the playlist-loaded track as a read-only display
- Play / Loop plays only that loaded playlist Interlude
- 4-second Stop fade remains unchanged
- continuous looping remains unchanged

Mixer fader fix:
- larger 72 px fader widget width
- bright white rectangular handle with blue border
- explicit add-page / sub-page styling
- handle is now visually distinct from the blue level bar

All v0.71 full-height Interlude layout and v0.65 safe drag/drop behavior are
retained.


## v0.73 — Full Mixer Handle Visibility

Fixed the Interlude mixer handle being partially hidden behind the percentage
readout when the fader was near 0%.

Changes:
- added 20 px clearance above and below the physical fader
- percentage readout now has its own minimum-height area
- added spacing between the handle area and percentage text
- retained the large high-contrast white/blue rectangular handle
- handle remains fully visible at both 0% and 100%

Playlist-controlled Interlude selection, looping, and the 4-second automatic
Stop fade are unchanged.


## v0.74 — Interlude Fader Layout / Fill Direction

Changes:
- Interlude instructions moved ABOVE the Volume Mixer
- fader has a dedicated 96 px wide holder
- 28 px safety clearance at the top and bottom prevents endpoint handle clipping
- handle enlarged to a bright white 54 px rectangular fader with blue border
- percentage readout remains separate below the fader
- blue volume level now fills from 0% upward to the current fader position
- area from the handle to 100% remains dark

Playlist-controlled Interlude selection, continuous looping and 4-second Stop
fade remain unchanged.


## v0.75 — Interlude Note Above Panel

The Interlude explanatory text has been moved outside the bordered Interlude
Music panel and placed above it in the right-hand column.

This uses the previously empty space above the Interlude Music box, keeping the
mixer controls and fader area cleaner.

All v0.74 fader behavior, playlist-controlled Interlude loading, continuous
looping and 4-second Stop fade are unchanged.


## v0.76 — Custom Always-Visible Mixer Fader

The Interlude mixer no longer relies on Qt's native slider handle geometry.

A custom mixer fader now:
- draws the handle completely inside the widget at all times
- remains visible at 0%, 100%, full-screen and windowed sizes
- uses a shorter handle height (14 px)
- keeps the same wide mixer-style handle width (54 px)
- fills blue from 0% upward to the current volume
- keeps the unfilled section dark
- supports click-and-drag directly on the custom fader

This addresses the endpoint clipping that could still occur with stylesheet-only
QSlider handles.

All v0.75 Interlude playlist behavior, looping and 4-second fade-out remain
unchanged.


## v0.77 — Short Wide Fader Handle / Fixed-Height Mixer

To keep the Interlude mixer handle visible in both windowed and full-screen use:

- shortened handle height from 14 px to 10 px
- retained the wide mixer-handle look
- increased endpoint padding inside the custom fader
- changed the fader widget to a fixed 220 px height
- increased outer top/bottom layout margins around the fader
- increased spacing before the percentage readout

This is intended to prevent the handle from disappearing at 0% when the window
layout changes at larger sizes.


## v0.78 — Interlude Column Expansion / Full-Screen Stability

This update targets the Interlude mixer disappearing when the Manager is
maximized or full-screen.

Layout changes:
- widened the Interlude column (manager grid stretch 4:2 instead of 5:1)
- increased Interlude panel minimum width to 380 px
- increased Interlude panel minimum height to 560 px
- enlarged the dedicated mixer area and fader holder

Mixer changes:
- custom fader now has a fixed 240 px height
- fader width increased
- handle widened to 60 px while staying short
- value changes trigger immediate repaint
- resizeEvent now forces repaint when the window is resized/maximized

Goal: keep the Interlude column from becoming visually compressed and keep the
fader handle visible in both normal and maximized/full-screen usage.


## v0.79 — End Song Next-Selection + Stronger Bass Drum Presence

### End Song selection fix
When End Song completes:
- current march stops
- Parade Manager selects the NEXT playlist item
- this works whether the next item is Repeat, End or Interlude
- the next item does NOT automatically play

Next Song remains different:
- current march ends musically
- next playlist item starts automatically

### Stronger Bass Drum presence
The actual bass-drum WAVs and timing are unchanged.

To make cues cut through the band more strongly:
- Single / Double / 2x Double: parade music ducks to about 40%
- End Song / Next Song ending drums: parade music ducks to about 35%

This increases drum-to-music contrast without re-EQing or changing the drum
timbre, which avoids the artificial/muffled sound seen in older experiments.

All v0.78 Interlude layout and mixer behavior is retained.


## v0.80 — Stable Fixed Mixer Fader

The Interlude mixer was becoming worse in full-screen because the right-hand
panel and slider holder were being stretched by the Manager grid.

v0.80 changes the mixer architecture:
- MixerFader is now a pure custom QWidget, not QSlider
- fader is fixed at 90 x 240 px
- handle is always drawn inside its own widget
- handle is 58 px wide x 12 px high
- blue level fills from 0% upward
- mixer holder is fixed-size and does not stretch in full-screen
- Interlude column returns to a more balanced width

The v0.79 End Song next-selection fix and stronger bass-drum ducking remain.


## v0.81 — Truly Fixed Interlude Mixer Geometry

The v0.80 fader widget itself was fixed-size, but its surrounding layouts were
still allowed to stretch and redistribute space when Parade Suite was resized
or maximized.

v0.81 fixes the entire mixer block:
- Interlude column fixed at 380 px wide
- fader frame fixed at 180 x 300 px
- scale fixed at 45 x 260 px
- fader holder fixed at 110 x 260 px
- custom fader fixed at 90 x 240 px
- percentage readout fixed-height
- fixed mixer block is centered and top-aligned

This should keep the mixer visually identical in normal, maximized and
full-screen window sizes.


## v0.82 — Self-Contained Mixer Panel

The previous mixer still relied on several nested Qt layouts. Even though the
fader itself was fixed-size, full-screen resizing could stretch the surrounding
scale/holder/percentage layouts and make the mixer look broken.

v0.82 replaces that entire structure with ONE fixed custom widget.

The new mixer:
- is one 190 x 300 px canvas
- draws 100 / 75 / 50 / 25 / 0 itself
- draws the groove itself
- draws the blue 0%-to-current-value fill itself
- draws the white mixer handle itself
- draws the percentage inside the same canvas
- has no nested fader/scale/percentage layouts to stretch apart

This should make the mixer render identically in normal, maximized and
full-screen modes.

All v0.79 End Song selection and stronger bass-drum presence behavior remains.


## v0.83 — Bass Drum Presence Fixed at 600 Hz

- Bass Drum Presence is fixed at 600 Hz.
- Removed the adjustable 100–500 Hz slider.
- Added dedicated single_600hz.wav and double_600hz.wav cue profiles.
- The original drum sound is retained, with a modest 600 Hz presence layer.
- Single / Double / 2x Double always use the 600 Hz profiles.
- Existing music ducking remains active.
- End Song / Next Song timing and ending WAVs are unchanged.


## v0.85 — Isolated Fixed Interlude Sidebar

The Interlude panel is now completely removed from the stretchable grid used by
Playlist / Actions / Drum Cues / Now Playing.

New Manager structure:
- left side = flexible manager content
- right side = separate fixed-width Interlude sidebar
- sidebar width = 390 px
- Interlude box = fixed 380 x 520 px
- self-contained mixer remains fixed
- sidebar is top-aligned and does not participate in left-side grid stretching

This architecture is designed so maximizing or full-screen resizing cannot
stretch the Interlude mixer block.

Fixed 600 Hz Bass Drum Presence and End Song next-selection behavior are retained.


## v0.86 — Horizontal Interlude Mixer / No Pause / 700 Hz Bass Drum Presence

Changes:
- Interlude mixer changed from vertical fader to a compact horizontal self-contained mixer.
- Pause button removed from the main transport row.
- Bass Drum Presence increased from fixed 600 Hz to fixed 700 Hz.
- Added dedicated single_700hz.wav and double_700hz.wav cue profiles.


## v0.87 — 10% Drum-Cue Ducking / Bass Presence Row Removed

Changes:
- Parade music ducks to 10% whenever Single Beat, Double Beat or 2x Double Beat cues play.
- End Song / Next Song ending drum cues also duck the parade music to 10%.
- Fixed 700 Hz drum cue processing remains active internally.
- The bottom "Bass Drum Presence / 700 Hz (Fixed)" display row has been removed from the Manager UI.


## v0.88 — Horizontal Slider Mixer

Changes:
- Replaced the custom interlude mixer/fader with a standard horizontal Qt slider.
- This should render reliably instead of disappearing/stretching.
- Mixer orientation now follows a left-to-right 0 → 100 layout.
- 10% parade-music ducking for drum cues is retained.
- 700 Hz bass-drum processing is retained internally.


## v0.89 — Auto-Select First Parade Track

When the operator enters the Parade Manager:
- if a parade playlist exists
- and nothing is currently selected/playing

Parade Suite automatically selects the FIRST playlist track.

It does NOT start playback automatically.
The operator must still press Play to begin the parade track.

If the first playlist item is an Interlude, it is prepared in the Interlude
panel but still does not auto-play.


## v0.90 — Fade + End Song

Added a new `Fade` button directly below `End Song` in Parade Manager Actions.

Behavior:
- press Fade while parade music is playing
- music fades smoothly over 5 seconds
- fade destination is 10%, matching the existing drum-cue duck level
- after the 5-second fade, Parade Suite invokes the normal beat-synchronised End Song
- after the ending finishes, normal Music Volume is restored for the next track
- Fade does not auto-play the next selected track

If the current track has no timing map, Fade + End Song is not started.


## v0.91 — Fade to Stop (No End Song Bass Drums)

Changed the `Fade` button behavior:

- Fade now goes to 0% over 5 seconds
- After the 5-second fade, Parade Suite stops the music completely
- No End Song bass-drum sequence is played
- Normal Music Volume is restored for the next manual Play command


## v0.92 — Interlude Starts at 60%

Interlude Play / Loop behavior:
- pressing Play / Loop sets Interlude Music volume to 60%
- playback starts at 60%
- the horizontal Interlude mixer remains fully editable while music is playing
- moving the mixer immediately changes the Interlude Music volume
- pressing Play / Loop again resets the Interlude volume to 60% before playback


## v0.93 — Editable Interlude Start Volume

- Interlude start volume defaults to 60%.
- The operator can move the Interlude Start Volume slider before playback.
- Play / Loop uses the currently selected percentage.
- Play / Loop no longer resets the slider back to 60%.
- The slider remains editable during playback as before.


## v0.94 — Editable Interlude Percentage Box

The percentage shown below the Interlude Start Volume slider is now an editable
numeric field.

- Click the percentage value and type any number from 0 to 100.
- The slider immediately moves to match the typed value.
- Moving the slider updates the percentage box.
- Default Interlude start volume remains 60%.
- Play / Loop uses the currently displayed percentage.


## v0.96 — End as Default, Repeat Still Available

Parade Editor behavior for:
- Salutes
- Bugle Calls
- Fanfares

When one of these tracks is first added to the Parade Sequence, its action
defaults to `End`.

`Repeat` is still available in the Action dropdown and can be selected manually.
Existing saved Repeat selections are preserved.


## v0.97 — Dressing Roll Default End

Parade Editor:
- `Dressing Roll` now defaults to `End` when added to the Parade Sequence.
- `Repeat` remains available in the Action dropdown and can still be selected manually.



## v0.98 — Live Parade Sequence Drag Refresh

Fixed Parade Editor row drag-and-drop refresh.

Previously, the sequence model changed during the QTableWidget drop event, but
Qt could repaint the old cell widgets during drag cleanup. The moved row then
appeared only after another operation (for example adding a new track).

v0.98 queues the reorder until the drop event has fully returned, then rebuilds
and repaints the Parade Sequence immediately. The new order should now appear
as soon as the dragged row is released.


## v0.99 — Larger Now Playing Text

Parade Manager > Now Playing:
- Current track title: 40 pt
- Current action/status text: 40 pt
- Next track text: 30 pt


## v0.102 — Clean Build

- Current track title: 40 pt
- Status/action text: 20 pt
- Next track: 20 pt
- Widget-specific styling prevents the global stylesheet from shrinking these labels.
- `enhanced_assets` is not included in this package.


## v0.103 — Font and Drum Cue Ducking Tweak

Parade Manager > Now Playing:
- Current track title: 40 pt
- Status/action text: 10 pt
- Next track: 15 pt

Audio:
- Parade music now ducks to 30% while drum cues / ending drum cues play.
- Cue volume itself is unchanged.


## v0.104 — Interlude Default Volume + 5s Stop Fade

Interlude Music changes:
- The percentage below the Interlude volume slider is display-only again.
- A separate editable `Default %` numeric box is shown below Play / Loop / Stop.
- Default % starts at 60% and can be changed from 0–100%.
- Every Play / Loop starts at the configured Default %.
- Stop fades the Interlude from its current audible level to 0% over 5 seconds.
- When the fade completes, Interlude stops.
- The Parade Manager selects the next item in the Parade Sequence without auto-playing it.
- The Interlude live volume resets to the configured Default % ready for the next use.
