import XCTest
@testable import SHarkMac

final class CompanionStoreTests: XCTestCase {
    @MainActor
    func testRefreshLoadsServerSnapshotAndPreservesScopedToken() async {
        let snapshot = Fixtures.snapshot(needsAction: true)
        let box = Box()
        box.token = "hark_test"
        let store = CompanionStore(
            client: .stub(fetch: { token in
                XCTAssertEqual(token, "hark_test")
                return snapshot
            }),
            vault: TokenVault(
                read: { box.token },
                write: { box.token = $0 },
                delete: { box.token = nil }
            ),
            defaults: ephemeralDefaults()
        )

        await store.refresh()

        XCTAssertEqual(store.state, .ready(snapshot))
        XCTAssertTrue(store.isSignedIn)
    }

    @MainActor
    func testDuplicateActionRefreshesToTheServerTerminalState() async {
        let pending = Fixtures.snapshot(needsAction: true)
        let terminal = Fixtures.snapshot(needsAction: false)
        let box = Box()
        box.token = "hark_test"
        box.snapshot = pending
        let store = CompanionStore(
            client: .stub(
                fetch: { _ in box.snapshot },
                respond: { _, _, _, _ in
                    box.snapshot = terminal
                    throw APIError(
                        statusCode: 409,
                        code: "Interaction is already terminal",
                        retryInterval: nil
                    )
                }
            ),
            vault: TokenVault(
                read: { box.token },
                write: { box.token = $0 },
                delete: { box.token = nil }
            ),
            defaults: ephemeralDefaults()
        )
        await store.refresh()
        guard let item = store.snapshot?.items.first else { return XCTFail("Missing item") }

        await store.respond(to: item, with: .approve)

        XCTAssertEqual(store.notice, "Already handled on another device.")
        XCTAssertEqual(store.state, .ready(terminal))
    }

    @MainActor
    func testNotificationActionCanResolveWithoutACachedInboxItem() async {
        let terminal = Fixtures.snapshot(needsAction: false)
        let box = Box()
        box.token = "hark_test"
        let store = CompanionStore(
            client: .stub(
                fetch: { _ in terminal },
                respond: { token, interactionID, action, digest in
                    XCTAssertEqual(token, "hark_test")
                    XCTAssertEqual(interactionID, "int_push")
                    XCTAssertEqual(action, .yes)
                    XCTAssertEqual(digest, String(repeating: "b", count: 64))
                    return InteractionResponse(ok: true, status: "yes", snapshot: terminal)
                }
            ),
            vault: TokenVault(
                read: { box.token },
                write: { box.token = $0 },
                delete: { box.token = nil }
            ),
            defaults: ephemeralDefaults()
        )

        await store.respond(
            interactionID: "int_push",
            actionDigest: String(repeating: "b", count: 64),
            with: .yes
        )

        XCTAssertEqual(store.state, .ready(terminal))
        XCTAssertEqual(store.notice, "Response sent.")
    }

    private func ephemeralDefaults() -> UserDefaults {
        let suite = "SHarkMacTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }
}

private final class Box: @unchecked Sendable {
    var token: String?
    var snapshot = Fixtures.snapshot(needsAction: true)
}

private enum Fixtures {
    static func snapshot(needsAction: Bool) -> MacSnapshot {
        let action = InboxAction(
            interactionId: "int_1",
            kind: "approval",
            choices: ["approve", "deny"],
            actionDigest: String(repeating: "a", count: 64),
            primaryLabel: nil,
            secondaryLabel: nil,
            expiresAt: Date(timeIntervalSince1970: 2_000_000_000)
        )
        return MacSnapshot(
            generatedAt: Date(timeIntervalSince1970: 1_800_000_000),
            items: [
                InboxItem(
                    id: "ibox:interaction:int_1",
                    kind: "interaction",
                    sourceName: "Agent",
                    title: "Deploy",
                    body: "Ship it?",
                    url: nil,
                    status: needsAction ? "pending" : "approved",
                    result: needsAction ? nil : "Approved",
                    needsAction: needsAction,
                    readAt: nil,
                    occurredAt: Date(timeIntervalSince1970: 1_800_000_000),
                    updatedAt: Date(timeIntervalSince1970: 1_800_000_000),
                    action: needsAction ? action : nil
                ),
            ],
            unresolvedCount: needsAction ? 1 : 0
        )
    }
}

private extension APIClient {
    static func stub(
        fetch: @escaping @Sendable (String) async throws -> MacSnapshot,
        respond: @escaping @Sendable (
            String,
            String,
            CompanionAction,
            String
        ) async throws -> InteractionResponse = { _, _, _, _ in
            fatalError("Unexpected response")
        }
    ) -> APIClient {
        APIClient(
            beginAuthorization: { fatalError("Unexpected authorization") },
            pollAuthorization: { _ in fatalError("Unexpected poll") },
            registerDevice: { _, _, _, _, _ in fatalError("Unexpected registration") },
            fetchSnapshot: fetch,
            respond: respond,
            markRead: { _, _ in },
            unregisterDevice: { _, _ in },
            revokeToken: { _ in }
        )
    }
}
