/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "watch",
  name: "SHarkWatch",
  displayName: "SHark",
  bundleIdentifier: "dev.shuv.shark.watchkitapp",
  deploymentTarget: "9.4",
  entitlements: {
    "com.apple.security.application-groups": ["group.dev.shuv.shark"],
  },
};
