import AppKit
import SwiftUI
import UserNotifications

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    weak static var store: CompanionStore?
    private var companionWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories(Self.categories)
        Task {
            await Self.store?.start()
            await Self.store?.ensureRemoteNotificationsRegistered()
        }
        if ProcessInfo.processInfo.arguments.contains("--show-inbox") {
            showCompanionWindow()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showCompanionWindow()
        return true
    }

    private func showCompanionWindow() {
        guard let store = Self.store else { return }
        if companionWindow == nil {
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 410, height: 560),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered,
                defer: false
            )
            window.title = "SHark"
            window.contentMinSize = NSSize(width: 360, height: 440)
            window.contentViewController = NSHostingController(rootView: MenuBarRoot(store: store))
            window.isReleasedWhenClosed = false
            window.center()
            companionWindow = window
        }
        companionWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    func application(
        _ application: NSApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        Task { await Self.store?.registerDevice(apnsToken: token, environment: environment) }
    }

    func application(
        _ application: NSApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Self.store?.registrationFailed(error.localizedDescription)
    }

    func application(
        _ application: NSApplication,
        didReceiveRemoteNotification userInfo: [String: Any]
    ) {
        Task {
            if let eventId = NotificationWithdrawal.eventId(fromRemoteNotification: userInfo) {
                await Self.removeDeliveredNotifications(for: eventId)
            }
            await Self.store?.refresh()
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        let userInfo = notification.request.content.userInfo
        if NotificationWithdrawal.eventId(fromRemoteNotification: userInfo) != nil {
            Task { @MainActor in
                if let eventId = NotificationWithdrawal.eventId(fromRemoteNotification: userInfo) {
                    await Self.removeDeliveredNotifications(for: eventId)
                }
                await Self.store?.refresh()
            }
            return []
        }
        Task { @MainActor in await Self.store?.refresh() }
        return [.banner, .sound, .badge]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let content = response.notification.request.content
        let metadata = content.userInfo["hark"] as? [String: Any]
        let interactionID = metadata?["interactionId"] as? String
        let actionDigest = metadata?["actionDigest"] as? String
        let urlValue = metadata?["url"] as? String
        let actionIdentifier = response.actionIdentifier
        let responseText = (response as? UNTextInputNotificationResponse)?.userText
        await Self.handleNotificationAction(
            interactionID: interactionID,
            actionDigest: actionDigest,
            urlValue: urlValue,
            actionIdentifier: actionIdentifier,
            responseText: responseText
        )
    }

    private static func removeDeliveredNotifications(for eventId: String) async {
        let center = UNUserNotificationCenter.current()
        let delivered = await center.deliveredNotifications()
        let identifiers = NotificationWithdrawal.identifiersToRemove(
            eventId: eventId,
            delivered: delivered.map { notification in
                (notification.request.identifier, notification.request.content.userInfo)
            }
        )
        guard !identifiers.isEmpty else { return }
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }

    private static func handleNotificationAction(
        interactionID: String?,
        actionDigest: String?,
        urlValue: String?,
        actionIdentifier: String,
        responseText: String?
    ) async {
        guard
            let interactionID,
            let actionDigest
        else {
            await Self.store?.refresh()
            if let urlValue, let url = URL(string: urlValue) {
                NSWorkspace.shared.open(url)
            }
            return
        }
        let item = Self.store?.snapshot?.items.first {
            $0.action?.interactionId == interactionID && $0.action?.actionDigest == actionDigest
        }
        let action: CompanionAction?
        switch actionIdentifier {
        case Constants.approve: action = .approve
        case Constants.deny: action = .deny
        case Constants.yes: action = .yes
        case Constants.no: action = .no
        case Constants.reply:
            action = responseText.map(CompanionAction.reply)
        default:
            action = nil
            if let item { await Self.store?.markRead(item) } else { await Self.store?.refresh() }
        }
        if let action {
            await Self.store?.respond(
                interactionID: interactionID,
                actionDigest: actionDigest,
                with: action
            )
        }
    }

    private enum Constants {
        static let approval = "HARK_APPROVAL_V1"
        static let yesNo = "HARK_YES_NO_V1"
        static let replyCategory = "HARK_REPLY_V1"
        static let approve = "HARK_APPROVE"
        static let deny = "HARK_DENY"
        static let yes = "HARK_YES"
        static let no = "HARK_NO"
        static let reply = "HARK_REPLY"
    }

    private static let categories: Set<UNNotificationCategory> = [
        UNNotificationCategory(
            identifier: Constants.approval,
            actions: [
                UNNotificationAction(
                    identifier: Constants.approve,
                    title: "Approve",
                    options: [.authenticationRequired]
                ),
                UNNotificationAction(
                    identifier: Constants.deny,
                    title: "Deny",
                    options: [.authenticationRequired, .destructive]
                ),
            ],
            intentIdentifiers: []
        ),
        UNNotificationCategory(
            identifier: Constants.yesNo,
            actions: [
                UNNotificationAction(
                    identifier: Constants.yes,
                    title: "Yes",
                    options: [.authenticationRequired]
                ),
                UNNotificationAction(
                    identifier: Constants.no,
                    title: "No",
                    options: [.authenticationRequired, .destructive]
                ),
            ],
            intentIdentifiers: []
        ),
        UNNotificationCategory(
            identifier: Constants.replyCategory,
            actions: [
                UNTextInputNotificationAction(
                    identifier: Constants.reply,
                    title: "Reply",
                    options: [.authenticationRequired],
                    textInputButtonTitle: "Send",
                    textInputPlaceholder: "Reply to SHark"
                ),
            ],
            intentIdentifiers: []
        ),
    ]
}
