# Contributing a Live Activity template

This guide is written so it can be handed directly to a coding agent. A template contribution adds
a genuinely new SHark Live Activity layout that users select through the public `style` field. It is
not a color preset or an alias for one of the existing layouts.

You can implement and semantically test a template without Xcode, an Apple account, an iOS
simulator, or a physical device. Browser and unit tests cannot reproduce SwiftUI pixel layout, so a
SHark maintainer performs the final on-device visual check before release.

## Before editing

Read these files:

- `packages/contracts/src/index.ts` — public style IDs and Live Activity payload limits.
- `apps/expo/src/widgets/HarkAgentActivity.tsx` — the native widget layout and all presentation
  slots.
- `apps/expo/src/widgets/HarkAgentActivity.test.ts` — the local widget-runtime test harness.
- `packages/sharkctl/src/cli.mjs` — CLI style validation and help text.
- `apps/website/src/shared/docs/content.ts` — API documentation and style metadata.
- `apps/website/src/client/pages/docs/primitives.tsx` — small documentation previews.
- `apps/expo/app/la-lab.tsx` — optional simulator/device test screen.

Choose a short, permanent, lower-case style ID such as `orbit` or `scoreboard`. A merged ID becomes
part of SHark's public API and must not be renamed later.

## Critical widget constraint

`HarkAgentActivityLayout` is not a normal React component. Expo serializes the entire function to a
string, evaluates it with JavaScriptCore inside the widget extension, and converts the resulting
nodes to SwiftUI.

Inside `HarkAgentActivityLayout`:

- Do not call imported helper functions or components you created elsewhere.
- Do not close over module constants, arrays, or objects.
- Keep all template-specific constants and JSX inside the function.
- Use the existing proven-safe subset: local `const` values, conditionals, ternaries, template
  literals, `Math` calls, and the imported `@expo/ui/swift-ui` components and modifiers.
- Avoid loops, `Array.map`, `String.repeat`, network calls, timers, state, hooks, event handlers, and
  arbitrary JavaScript execution.
- Do not add remote images, custom fonts, or user-provided URLs to the widget.
- Preserve the standard-layout fallback for a style unknown to an older app build.

The generated `apps/expo/ios/` directory remains untouched. A new template does not require a new
Apple target, entitlement, ActivityKit schema version, or Swift file.

## 1. Register the public style ID

Add the ID to `LIVE_ACTIVITY_STYLES` in `packages/contracts/src/index.ts`:

```ts
export const LIVE_ACTIVITY_STYLES = [
  "standard",
  "ring",
  "hero",
  "terminal",
  "steps",
  "orbit",
] as const;
```

Do not bump `LIVE_ACTIVITY_SCHEMA_VERSION` when the payload fields are unchanged. Old app builds
will receive the new ID but render `standard`, while updated builds render the new template.

The agent and webhook routes already validate and propagate `style`; they need no template-specific
branch.

## 2. Build the native layout

Work only inside `HarkAgentActivityLayout` in
`apps/expo/src/widgets/HarkAgentActivity.tsx`.

Use the existing privacy-safe derived values rather than raw payload fields:

- `title`
- `status`
- `detail`
- `percentage`
- `symbol`
- `accent`
- `a11ySummary`

Create local node trees for whichever presentations are genuinely different:

```tsx
const orbitBanner = (
  <HStack
    spacing={12}
    modifiers={[
      padding({ horizontal: 16, vertical: 14 }),
      activityBackgroundTint("#0B1512"),
      accessibilityElement("combine"),
      accessibilityLabel(a11ySummary),
    ]}
  >
    {/* New layout, built from the existing safe values. */}
  </HStack>
);
```

Every style must resolve all eight presentation slots:

1. `banner`
2. `bannerSmall`
3. `compactLeading`
4. `compactTrailing`
5. `minimal`
6. `expandedLeading`
7. `expandedTrailing`
8. `expandedBottom`

Reuse a standard slot when the new design does not need a custom version. Add the new style to the
final slot-selection object while keeping `standard` as the last fallback, for example:

```tsx
banner:
  style === "orbit"
    ? orbitBanner
    : style === "ring"
      ? ringBanner
      : standardBanner,
```

Design requirements:

- Handle `progress` being absent, `0`, partially complete, and `1`.
- Handle `detail` being absent.
- Keep title and status within their existing line limits.
- Do not reveal the original title or detail in `private` mode, including accessibility labels.
- Provide an accessibility summary for meaningful grouped content.
- Do not communicate essential state through color alone.
- Preserve contrast with caller-provided accent colors.
- Keep compact and minimal presentations glanceable; do not shrink full banner content into them.

## 3. Update `sharkctl`

Add the new ID to `ACTIVITY_STYLES` in `packages/sharkctl/src/cli.mjs`. Update both `activity start`
and `activity update` help strings in the same file.

Add or update a CLI test so `--style orbit` is accepted and an unknown value remains a usage error.
Do not publish a new npm version from a contributor PR; maintainers release `sharkctl` after merge.

## 4. Add local no-simulator tests

Extend `apps/expo/src/widgets/HarkAgentActivity.test.ts`.

At minimum:

- Add the ID to the test that verifies all eight slots for every style.
- Assert the structural feature that makes the layout unique, such as a `Gauge`, `ZStack`, font
  treatment, progress placement, or ordering.
- Test the no-progress fallback.
- Test `progress: 0` and `progress: 1` if the layout visualizes progress.
- Include the style in privacy-mode assertions.
- Assert user strings have appropriate `lineLimit` modifiers.
- Keep the missing-style test proving that no style still equals `standard`.

Run the test without Apple tooling:

```bash
pnpm --filter @hark/expo test
```

This executes the layout with mocked Expo widget globals and inspects the resulting node tree. It
validates serialization-safe structure and behavior, not native pixels.

## 5. Document the template

Update `apps/website/src/shared/docs/content.ts` in both places:

- Add the ID to the `style` field's enum description.
- Add its name and one-sentence visual description to the style gallery.

Add a matching miniature preview branch in
`apps/website/src/client/pages/docs/primitives.tsx`. The docs preview is an explanatory thumbnail,
not a second authoritative implementation; keep it small and representative.

Run the docs parity tests:

```bash
pnpm --filter @hark/website exec vitest run src/shared/docs/docs.test.ts
```

## 6. Optional native verification

Contributors do not need this step. Maintainers use it before release.

With the operator-owned `EAS_PROJECT_ID` and `APPLE_TEAM_ID` available in the environment,
temporarily set `style: "orbit"` in the props returned by `apps/expo/app/la-lab.tsx`, then run:

```bash
pnpm --filter @hark/expo exec expo prebuild --platform ios --clean
(cd apps/expo/ios && pod install)
sqim upload --simulator apps/expo/ios --build --workspace SHark.xcworkspace --scheme SHark
xcrun simctl openurl booted "shark://la-lab"
```

Open the final `sqim://` URI printed by the successful upload, then start the activity and inspect
the Lock Screen plus compact, minimal, and expanded Dynamic Island presentations. Test long text,
private mode, no progress, 0%, 100%, and several accents. Remove any temporary hardcoded lab
selection before committing unless the PR intentionally adds a reusable style picker. Sqim must
produce every test binary; do not substitute Expo or Xcode build commands.

## 7. Run the complete verification

From the repository root:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm --filter @hark/website build
git diff --check
```

Do not update generated iOS files, provisioning profiles, credentials, or deployment configuration.

## Pull request checklist

Include this checklist in the PR description:

- [ ] The style ID is short, permanent, and added to contracts and `sharkctl`.
- [ ] The contribution contains a genuinely new layout rather than a renamed existing style.
- [ ] All eight presentation slots resolve to valid nodes.
- [ ] Missing detail and absent/zero/partial/complete progress are handled.
- [ ] Private mode leaks no original title, status, or detail.
- [ ] Accessibility labels and line limits are present.
- [ ] Unknown or missing styles still fall back to `standard`.
- [ ] Expo widget tests cover the template's unique structure and edge cases.
- [ ] API docs, CLI help, and the docs thumbnail include the new style.
- [ ] Browser screenshots of the docs preview are attached.
- [ ] Native testing status is stated: not tested, simulator tested, or device tested.
- [ ] No credentials, generated native projects, remote assets, or unrelated changes are included.

## Review expectations

SHark maintainers may adjust spacing, typography, naming, or slot reuse before accepting a template.
Acceptance also depends on clarity at a glance, accessibility, privacy, bundle complexity, and
whether the design adds a meaningfully different presentation. Passing unit tests does not
guarantee that Apple will render every size exactly like a browser or mocked node tree.
