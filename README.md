# Parade Suite Web v0.121 — Windows-Matched + iOS

This build was compared directly against:
- Parade Suite Windows v0.104 Cleaned with PYW
- Parade Suite Web v0.120 iOS Beat-Time Drum Cue Fix

## Shared source files

The active web cue files are byte-for-byte copies of the Windows folder:
- `singlebeat.wav`
- `doublebeat.wav`
- `Ending Beat.wav`
- `knights_ending_beat.wav`

The Windows compatibility aliases are also bundled for reference/compatibility,
but the webapp does not actively use them for manual cues.

The webapp also uses byte-for-byte copies of:
- `legacy_timing_maps/`
- `category_corrections.json`
- `music_library.json`

## iOS playback

The webapp does not wait until cue time and then call `HTMLAudio.play()`.
When the user taps Single / Double / 2x Double:
1. the AudioContext is unlocked by that direct gesture;
2. the exact WAV is decoded;
3. the `.lib` target is calculated;
4. an `AudioBufferSourceNode` is scheduled immediately against the WebAudio clock
   for the future cue timestamp.

This is retained specifically for iPhone/iPad Safari compatibility.

## Manual cue timing

The Windows timing constants are preserved:
- phrase boundary minimum lead: 250 ms
- full-beat fallback minimum lead: 120 ms
- cue offset: -45 ms
- 2x Double: second `doublebeat.wav` at `2 * full_interval`
- music duck: 30% for 950 ms

## End / Next timing

- phrase boundary minimum lead: 500 ms
- full-beat fallback minimum lead: 250 ms
- Ending Beat starts 110 ms before target
- standard ending: `Ending Beat.wav`
- Knights ending: `knights_ending_beat.wav`

## Important cleanup

The active webapp no longer depends on:
- `single_700hz.wav`
- `double_700hz.wav`
- any web-generated/re-EQ'd drum cue
- generated composite 2x cue files

No Supabase migration is required.

## v0.122 — Knights of St John Ending Duck

- Standard End Song remains at 30% march volume during the Ending Beat.
- Knights of St John now ducks the march to 15% during `knights_ending_beat.wav`.
- The Knights ending WAV, timing-map logic, -110 ms ending offset, and iOS WebAudio
  scheduler are unchanged.
- No cue audio files were modified.
- No Supabase migration is required.


## v0.123 — 4-digit Passcode Access + Admin Users

- No username/email on login.
- Each person has one unique 4-digit passcode.
- The saved Name is only shown/managed by the app after login.
- Any invalid/disabled/rate-limited attempt shows exactly:
  `Please check with the admin`
- 8 failed attempts within 15 minutes are rate-limited with the same message.
- PINs are stored only as salted scrypt hashes.
- Login session uses an HttpOnly cookie lasting 12 hours.

Admin Panel:
- add user: Name + 4-digit PIN
- rename
- reset PIN
- disable / enable
- delete
- view last login
- duplicate PINs are rejected

Initial admin:
1. Run `supabase/migration_v0.123_access_codes.sql`.
2. Add these Vercel Environment Variables:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PARADE_SESSION_SECRET`
   - `PARADE_ADMIN_INITIAL_PIN`
   - `PARADE_ADMIN_NAME`
3. When no admin exists yet, the first successful login using
   `PARADE_ADMIN_INITIAL_PIN` creates the first admin.

The passcode gate protects the Parade Suite UI and Admin Panel. The existing
track/music Supabase policies remain the earlier public/demo configuration.

A new Supabase migration IS required:
`supabase/migration_v0.123_access_codes.sql`


## v0.124 — Built-in LIB Library Only

The browser **Import LIB** option has been removed.

Timing maps now come only from:

`public/legacy_timing_maps/`

To change a timing map:
1. Edit the `.lib` file in `public/legacy_timing_maps/`.
2. If adding or renaming a `.lib`, update `public/legacy_timing_maps/index.json`.
3. Commit to GitHub.
4. Vercel redeploys.

After login, each track is checked against the built-in LIB library and these
Supabase timing fields are synchronized from the built-in file:

- `has_lib`
- `has_timing_map`
- `timing_map`
- `repeat_start_ms`
- `repeat_end_ms`
- `repeat_mode`
- `lib_name`

If no built-in LIB matches, those timing values are cleared and the track shows ❌.

Previously browser-imported LIB timing can therefore no longer override the
GitHub/Vercel timing-map library.

Import Music remains available.

No new Supabase schema migration is required.


## v0.125 — Reliable Large Music Uploads

Music import now continues through the whole selected batch even when an
individual file fails.

Changes:
- files above 6 MB use resumable TUS uploads to Supabase Storage
- suitable for large WAV files such as 50+ MB parade tracks
- automatic retry delays for interrupted resumable uploads
- per-file percentage progress
- overall `x / total` progress
- successful-file list
- failed-file list with the actual browser/Supabase error message
- one failed file no longer prevents later files from being attempted
- the same file can be selected again immediately after a failed attempt

Files at or below 6 MB continue to use the normal Supabase Storage upload.

This build retains:
- v0.124 built-in-only LIB timing-map workflow
- v0.123 passcode/admin-user system
- existing iOS cue/audio behavior

No new Supabase SQL migration is required.

Vercel will install the new JavaScript dependency `tus-js-client` during build.


## v0.126 — Signed Resumable Large-File Uploads

Fixes the v0.125 error:

`Invalid Compact JWS`

Cause:
v0.125 incorrectly placed the Supabase publishable API key in an
`Authorization: Bearer ...` header for TUS uploads. New `sb_publishable_...`
keys are API keys, not JWTs.

v0.126 changes the large-file upload flow:

1. The signed-in Parade Suite browser requests a short-lived upload token from
   `/api/storage/signed-upload`.
2. The Next.js server route verifies the Parade Suite passcode session.
3. The server uses `SUPABASE_SERVICE_ROLE_KEY` privately to create a signed
   upload URL/token for the `music` bucket.
4. The browser uploads the large WAV directly to Supabase Storage using TUS and
   the `x-signature` header.
5. The service-role key is never exposed to the browser and the file does not
   pass through Vercel's request-body limits.

Large files still retain:
- resumable 6 MB chunks
- retries
- upload percentage
- batch continuation after failures
- success/failure results

Small files (6 MB or less) continue using the normal Supabase browser upload.

No new Supabase SQL migration is required.

Required Vercel variable already used by the passcode build:
`SUPABASE_SERVICE_ROLE_KEY`


## v0.127 — Automatic Built-in LIB Detection

Built-in `.lib` files are now indexed automatically at every Vercel build.

You no longer need to manually maintain `public/legacy_timing_maps/index.json`
for files whose music filename matches the LIB filename.

Example:

- Music: `Bobs Own Slow March.wav`
- LIB: `public/legacy_timing_maps/Bobs Own Slow March.lib`

Vercel's `prebuild` step automatically creates:

`"bobs own slow march": "Bobs Own Slow March.lib"`

The generator:
- scans every `.lib` in `public/legacy_timing_maps/`
- creates an exact normalized mapping for every filename
- preserves valid older alias mappings
- removes aliases that point to files that no longer exist

The webapp also requests the manifest and LIB files with cache disabled/version
busting, preventing an older `index.json` from remaining stuck in Safari/PWA or
Vercel/browser cache.

Therefore, to add or rename a built-in timing file:
1. Put/rename the `.lib` in `public/legacy_timing_maps/`.
2. Make its filename match the music track name when possible.
3. Commit to GitHub.
4. Vercel automatically regenerates `index.json` during deployment.

No Supabase SQL migration is required.


## v0.128 — Vercel LIB Path Fix

Fixes the Vercel build error:

`ENOENT: no such file or directory, scandir '/vercel/path0/public/legacy_timing_maps'`

The automatic LIB-index generator no longer assumes that the Next.js app is
always located directly at `/vercel/path0`.

It now:
- checks the current app root first
- searches a few directory levels down for `public/legacy_timing_maps`
- ignores `node_modules`, `.git`, and `.next`
- logs the timing-map folder it actually found
- skips index generation gracefully instead of crashing the entire Vercel build
  if the folder is missing

No Supabase SQL migration is required.


## v0.129 — Root-Level `legacy_timing_maps` Source Folder

Built-in LIB files are now sourced from a folder at the **GitHub repository root**:

`legacy_timing_maps/`

This matches the repository layout where the LIB folder is separate from
`public/`.

During every Vercel build, the prebuild script:

1. Reads every `.lib` from `legacy_timing_maps/`
2. Copies them into `public/generated_timing_maps/`
3. Generates `public/generated_timing_maps/index.json`
4. The browser reads only from `/generated_timing_maps/...`

So the source/editing workflow is:

`legacy_timing_maps/*.lib` → Vercel prebuild → `public/generated_timing_maps/*`

You should edit/add/rename LIB files only in:

`legacy_timing_maps/`

You do not need to manually edit the generated `index.json`.

No Supabase SQL migration is required.


## v0.130 — Signed Large Upload Fix

Fixes the remaining `Invalid Compact JWS` error.

Large files no longer use the TUS/x-signature route. Instead:
1. the signed-in browser requests a short-lived upload token from
   `/api/storage/signed-upload`;
2. the Next.js server creates that token using the server-only
   `SUPABASE_SERVICE_ROLE_KEY`;
3. the browser sends the file directly to Supabase Storage with
   `uploadToSignedUrl`.

The service-role key never reaches the browser and the file does not pass
through Vercel's request body.

Important:
- Supabase Free projects have a maximum upload size of 50 MB.
- A file larger than 50 MB will still fail on the Free plan even when the
  authentication issue is fixed.
- Paid plans can use larger limits when Storage Settings and the bucket limit
  permit them.

The root-level `legacy_timing_maps/` workflow from v0.129 is retained.

No Supabase SQL migration is required.


## v0.131 — User-Supplied Built-in LIB Set

The entire root-level `legacy_timing_maps/` folder has been replaced with the
user-supplied `legacy_timing_maps.zip`.

The Vercel prebuild process remains:

`legacy_timing_maps/*.lib`
→ `public/generated_timing_maps/*.lib`
→ generated `index.json`
→ Parade Suite runtime

This means the uploaded LIB filenames are now the authoritative built-in timing
maps used by the webapp.

No Supabase SQL migration is required.


## v0.132 — iPad Manager Controls, Interlude Fix, Editor Preview

### Parade Editor music preview
Every Music Library row now has a `▶ Preview` button. Preview uses a separate
audio player so it does not modify the Parade Manager's main playback state.
The same button becomes `■ Stop` for the previewed track.

### Interlude
The Interlude panel now identifies Interlude music by the selected track's
category/title instead of requiring the sequence Action dropdown to literally be
`Interlude`.

This fixes playlists where an Interlude track is configured as `Repeat`, as in
the iPad layout example.

- Play / Loop starts the selected Interlude directly from the user tap, which is
  compatible with iPad/iPhone Safari media restrictions.
- Interlude loops continuously.
- Stop performs the Windows-style 5-second smooth fade.
- After the fade, Interlude resets to its configured default volume and the next
  playlist item becomes selected without automatically playing.

### iPad Parade Manager layout
The following controls are moved from below the playlist into the right-side
control column under Interlude:

- Actions
- Drum Cues
- Now Playing
- Previous / Play / Stop / Immediate Skip
- Music Volume
- Cue Volume

The right control column is sticky and independently scrollable on desktop/iPad
landscape so a long parade playlist no longer pushes operational controls below
the screen.

No Supabase migration is required.


## v0.133 — Shared Interlude Transport + 10% Fade

Interlude now uses the same main Parade Manager transport controls as normal music:

- Main `Play` on an Interlude track starts it looping.
- Main `Stop` on an Interlude track performs the 5-second fade-to-stop and selects the next track.
- The dedicated Interlude Play/Stop buttons have been removed.
- Main `Fade` on an Interlude track fades the Interlude to **10%** over 5 seconds without stopping it.
- A `Restore Interlude to <Default>%` action appears only when an Interlude track is selected and returns the live Interlude level to its configured Default %.
- Main `Fade` on normal parade music remains the existing 5-second fade-to-stop.

No Supabase migration is required.


## v0.134 — Sequence-Only Parade Files

`Save Parade` now exports only the Parade Sequence. It does not embed music,
timing maps, drum cues, Supabase records, or any other library content.

Cross-platform file format:

```json
{
  "type": "parade-suite-sequence",
  "version": 2,
  "sequence": [
    {
      "track": "Advance Call.wav",
      "action": "End"
    },
    {
      "track": "Marching With Pride.wav",
      "action": "Repeat"
    }
  ]
}
```

`Open Parade` matches each saved filename against music already present in the
web Music Library and rebuilds the Supabase Parade Sequence. The Music Library
itself is never replaced.

Missing tracks do not prevent the rest of the parade from loading. They are
reported in the Parade Manager status.

This v2 format is shared with the Windows v0.107 build.

The web UI now displays the actual music filename (`source_name`) rather than
metadata/display titles throughout the Music Library, Parade Sequence, Parade
Manager playlist, Now Playing, Next Track and Interlude selection.

No Supabase migration is required.


## v0.135 — 5-Second Interlude Restore Fade

When an Interlude has been faded to 10%, `Restore Interlude` now fades smoothly
back to the configured Default % over **5 seconds**.

The restore uses the same smoothstep fade curve as the Interlude fade-down.

Example:
- Interlude Default = 60%
- Fade → 10% over 5 seconds
- Restore Interlude → 60% over 5 seconds

No Supabase migration is required.
