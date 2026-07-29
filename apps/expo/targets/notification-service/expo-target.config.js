/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "notification-service",
  name: "SHarkNotificationService",
  bundleIdentifier: "dev.shuv.shark.notification-service",
  deploymentTarget: "16.4",
  frameworks: ["UserNotifications", "Intents"],
};
