/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "watch",
  name: "SHarkWatch",
  displayName: "SHark",
  bundleIdentifier: "dev.shuv.shark.watchkitapp",
  deploymentTarget: "10.0",
  icon: "../../assets/icon.png",
  frameworks: ["SwiftUI", "AuthenticationServices", "Security", "WatchKit"],
  entitlements: {
    "com.apple.developer.applesignin": ["Default"],
  },
};
