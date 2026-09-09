# SHark for macOS

Native macOS 14+ menu-bar companion for SHark. It uses device-code sign-in,
stores its scoped bearer token in Keychain, registers directly with APNs, and
refreshes the durable SHark inbox after every notification or action.

Generate and build the project:

```sh
cd apps/macos
xcodegen generate
xcodebuild -project SHarkMac.xcodeproj -scheme SHarkMac -configuration Debug build
```

From the repository root, `pnpm macos:generate` regenerates the checked-in Xcode project and
`pnpm macos:test` runs the native unit tests without requiring a signing identity.

Push delivery requires the `dev.shuv.shark.macos` App ID with Push
Notifications enabled and a provisioning profile containing the macOS APS
entitlement. Unsigned builds can verify compilation but cannot register with
APNs.

At runtime, choose **Connect to SHark**, finish the device-code flow in the browser, and allow
notifications. The scoped bearer token is stored in Keychain. The server remains authoritative for
inbox and interaction state; pushes trigger a refresh, and repeated action attempts are shown as
already handled instead of being submitted twice.

Click a notification's title or preview to open its full detail. Opening an unread item marks it
read. The detail keeps the complete selectable message, current reply/approval controls, and an
explicit **Open in Browser** button for an included HTTP(S) link; clicking the row never opens the
link automatically. Cached details remain readable while offline, with response controls disabled
until the inbox refreshes successfully.

Read tracking is best effort: a transient failure while marking an item read does not disable an
otherwise ready inbox. Older refreshes cannot overwrite a successfully submitted response.
