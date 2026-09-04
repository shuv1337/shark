import XCTest
@testable import SHarkMac

final class NotificationWithdrawalTests: XCTestCase {
    func testParsesOnlyVersionedWithdrawalCommands() {
        XCTAssertEqual(
            NotificationWithdrawal.eventId(fromRemoteNotification: [
                "hark": [
                    "v": 1,
                    "command": "notification.withdraw",
                    "eventId": "evt_1",
                ],
            ]),
            "evt_1"
        )
        XCTAssertNil(
            NotificationWithdrawal.eventId(fromRemoteNotification: [
                "hark": [
                    "command": "notification.withdraw",
                    "eventId": "evt_unversioned",
                ],
            ])
        )
        XCTAssertNil(
            NotificationWithdrawal.eventId(fromRemoteNotification: [
                "aps": ["alert": ["title": "CI", "body": "Done"]],
                "hark": ["eventId": "evt_visible"],
            ])
        )
    }

    func testRemovesDeliveredNotificationsByEventIdOnly() {
        let identifiers = NotificationWithdrawal.identifiersToRemove(
            eventId: "evt_1",
            delivered: [
                (
                    identifier: "keep-title-collision",
                    userInfo: [
                        "aps": ["alert": ["title": "CI"], "thread-id": "service-svc_1"],
                        "hark": ["eventId": "evt_other"],
                    ]
                ),
                (
                    identifier: "match-metadata",
                    userInfo: ["hark": ["eventId": "evt_1", "url": "https://example.com"]]
                ),
                (
                    identifier: "empty-event",
                    userInfo: ["hark": ["eventId": ""]]
                ),
            ]
        )
        XCTAssertEqual(identifiers, ["match-metadata"])
    }
}
