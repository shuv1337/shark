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
