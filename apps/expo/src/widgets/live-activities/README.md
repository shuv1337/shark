# Live Activity styles

Each production Live Activity style lives in one file in this directory and returns its complete
`LiveActivityLayout`. A style must explicitly choose every supported presentation slot, even when
that choice is inherited from `standard`:

- `banner`
- `bannerSmall`
- `compactLeading`
- `compactTrailing`
- `minimal`
- `expandedLeading`
- `expandedTrailing`
- `expandedBottom`

`HarkAgentActivity.tsx` is the registry. Expo's widget Babel plugin serializes each function marked
with the `"widget"` directive, and the registry composes those function sources into the single
layout registered with ActivityKit. This keeps the style files hot-reloadable through Metro without
a generated source file or native rebuild.

## Editing workflow

1. Edit the relevant production style file.
2. Run `pnpm --filter @hark/expo typecheck` and the widget test.
3. Open `hark://la-lab?style=<style>&ts=<unique-value>` in the simulator.
4. Run `/Users/vogel/dev/experiments/2026-07-30-la-captures/capture-la.sh <label>`.
5. Inspect the combined Lock Screen, compact Island, and expanded Island image.

Keep every value referenced by a marked style function inside that function or in its parameters.
Imported Expo UI components and modifiers are provided as globals by the widget runtime; arbitrary
module helpers and constants are not.
