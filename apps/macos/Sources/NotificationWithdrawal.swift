import Foundation

enum NotificationWithdrawal {
    static func eventId(fromRemoteNotification userInfo: [AnyHashable: Any]) -> String? {
        guard let payload = harkPayload(from: userInfo) else { return nil }
        guard isVersionOne(payload["v"]) else { return nil }
        guard payload["command"] as? String == "notification.withdraw" else { return nil }
        return deliveredEventId(from: userInfo)
    }

    /// Delivered banners store the event id only in the `hark` request metadata.
    static func deliveredEventId(from userInfo: [AnyHashable: Any]) -> String? {
        guard let eventId = harkPayload(from: userInfo)?["eventId"] as? String else { return nil }
        return eventId.isEmpty ? nil : eventId
    }

    static func identifiersToRemove(
        eventId: String,
        delivered: [(identifier: String, userInfo: [AnyHashable: Any])]
    ) -> [String] {
        delivered.compactMap { item in
            deliveredEventId(from: item.userInfo) == eventId ? item.identifier : nil
        }
    }

    private static func harkPayload(from userInfo: [AnyHashable: Any]) -> [String: Any]? {
        userInfo["hark"] as? [String: Any]
    }

    private static func isVersionOne(_ value: Any?) -> Bool {
        if let number = value as? NSNumber { return number.intValue == 1 }
        if let number = value as? Int { return number == 1 }
        return false
    }
}
