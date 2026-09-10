import XCTest
@testable import SHarkMac

final class InboxItemTests: XCTestCase {
    func testBrowserLinkPreservesWebDestination() {
        for value in [
            "https://example.test/results?run=123#summary",
            "http://localhost:3000/report",
        ] {
            XCTAssertEqual(item(url: value).browserURL?.absoluteString, value)
        }
        XCTAssertEqual(
            item(url: "  https://example.test/report\n").browserURL?.absoluteString,
            "https://example.test/report"
        )
    }

    func testBrowserLinkRejectsMissingOrNonWebDestinations() {
        for value: String? in [
            nil, "", "/relative", "https://", "not a URL",
            "file:///tmp/report.html", "javascript:alert(1)", "shuv://run-command",
            "https://user:password@example.test/",
            "https://user@example.test/", "https://example.test@evil.com/",
        ] {
            XCTAssertNil(item(url: value).browserURL)
            XCTAssertNil(NotificationLink.browserURL(from: value))
        }
    }

    private func item(url: String?) -> InboxItem {
        InboxItem(
            id: "synthetic-notification", kind: "notification", sourceName: "Test agent",
            title: "Synthetic result", body: "Full notification body", url: url,
            status: "delivered", result: nil, needsAction: false, readAt: nil,
            occurredAt: Date(timeIntervalSince1970: 1_800_000_000),
            updatedAt: Date(timeIntervalSince1970: 1_800_000_000), action: nil
        )
    }
}
