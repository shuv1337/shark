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

    @MainActor
    func testMarkReadRefreshCannotOverwriteSuccessfulResponse() async throws {
        let pending = Fixtures.snapshot(needsAction: true)
        let terminal = Fixtures.snapshot(needsAction: false)
        let delayedSnapshot = Deferred<MacSnapshot>()
        let fetches = FetchPlan([.snapshot(pending), .delayed(delayedSnapshot)])
        let defaults = ephemeralDefaults()
        let store = makeStore(client: .stub(
            fetch: { _ in try await fetches.next() },
            respond: { _, _, _, _ in InteractionResponse(ok: true, status: "approved", snapshot: terminal) },
            markRead: { token, id in
                XCTAssertEqual(token, "hark_test")
                XCTAssertEqual(id, pending.items[0].id)
            }
        ), defaults: defaults)
        await store.refresh()

        let opening = Task { await store.markRead(pending.items[0]) }
        await delayedSnapshot.waitUntilRequested()
        XCTAssertTrue(store.canRespond(to: pending.items[0]))
        await store.respond(to: pending.items[0], with: .approve)
        await delayedSnapshot.resolve(.success(pending))
        await opening.value

        XCTAssertEqual(store.state, .ready(terminal))
        XCTAssertFalse(store.canRespond(to: pending.items[0]))
        let cached = try ISO8601Coding.decoder().decode(
            MacSnapshot.self, from: XCTUnwrap(defaults.data(forKey: "shark.macos.last-snapshot"))
        )
        XCTAssertEqual(cached, terminal)
    }

    @MainActor
    func testRefreshStartedDuringResponseCannotRestorePendingActions() async {
        let pending = Fixtures.snapshot(needsAction: true)
        let terminal = Fixtures.snapshot(needsAction: false)
        let delayedSnapshot = Deferred<MacSnapshot>()
        let delayedResponse = Deferred<InteractionResponse>()
        let fetches = FetchPlan([.snapshot(pending), .delayed(delayedSnapshot)])
        let store = makeStore(client: .stub(
            fetch: { _ in try await fetches.next() },
            respond: { _, _, _, _ in try await delayedResponse.value() }
        ))
        await store.refresh()

        let responding = Task { await store.respond(to: pending.items[0], with: .approve) }
        await delayedResponse.waitUntilRequested()
        XCTAssertFalse(store.canRespond(to: pending.items[0]))
        let refreshing = Task { await store.refresh() }
        await delayedSnapshot.waitUntilRequested()
        await delayedResponse.resolve(.success(InteractionResponse(ok: true, status: "approved", snapshot: terminal)))
        await responding.value
        await delayedSnapshot.resolve(.success(pending))
        await refreshing.value

        XCTAssertEqual(store.state, .ready(terminal))
        XCTAssertFalse(store.canRespond(to: pending.items[0]))
    }

    @MainActor
    func testReadRefreshFailurePreservesReadyButExplicitRefreshFailureDisablesResponses() async {
        let pending = Fixtures.snapshot(needsAction: true)
        let fetches = FetchPlan([
            .snapshot(pending), .failure, .failure, .snapshot(pending),
        ])
        let store = makeStore(client: .stub(fetch: { _ in try await fetches.next() }))
        await store.refresh()

        await store.markRead(pending.items[0])
        XCTAssertEqual(store.state, .ready(pending))
        XCTAssertTrue(store.canRespond(to: pending.items[0]))

        await store.refresh()
        guard case .stale = store.state else { return XCTFail("Expected cached offline state") }
        XCTAssertEqual(store.snapshot, pending)
        XCTAssertFalse(store.canRespond(to: pending.items[0]))

        await store.refresh()
        XCTAssertEqual(store.state, .ready(pending))
        XCTAssertTrue(store.canRespond(to: pending.items[0]))
    }

    @MainActor
    func testFailedReadAcknowledgementDoesNotRefreshOrDisableResponses() async {
        let pending = Fixtures.snapshot(needsAction: true)
        let fetches = FetchPlan([.snapshot(pending)])
        let store = makeStore(client: .stub(
            fetch: { _ in try await fetches.next() },
            markRead: { _, _ in throw URLError(.notConnectedToInternet) }
        ))
        await store.refresh()

        await store.markRead(pending.items[0])

        XCTAssertEqual(store.state, .ready(pending))
        XCTAssertTrue(store.canRespond(to: pending.items[0]))
        let count = await fetches.count
        XCTAssertEqual(count, 1)
    }

    @MainActor
    func testReadRefreshUpdatesReadStateAndAlreadyReadItemsSkipNetwork() async {
        let pending = Fixtures.snapshot(needsAction: true)
        let read = Fixtures.snapshot(needsAction: true, readAt: Date(timeIntervalSince1970: 1_800_000_010))
        let fetches = FetchPlan([.snapshot(pending), .snapshot(read)])
        let store = makeStore(client: .stub(fetch: { _ in try await fetches.next() }))
        await store.refresh()

        await store.markRead(pending.items[0])
        XCTAssertEqual(store.state, .ready(read))
        await store.markRead(read.items[0])

        let count = await fetches.count
        XCTAssertEqual(count, 2)
        XCTAssertTrue(store.canRespond(to: pending.items[0]))
    }

    @MainActor
    func testUnauthorizedReadTrackingStillSignsOut() async {
        let pending = Fixtures.snapshot(needsAction: true)
        let unauthorized = APIError(statusCode: 401, code: "Unauthorized", retryInterval: nil)
        for failAcknowledgement in [true, false] {
            let fetches = FetchPlan([.snapshot(pending)])
            let store = makeStore(client: .stub(
                fetch: { _ in
                    if await fetches.count == 0 { return try await fetches.next() }
                    throw unauthorized
                },
                markRead: { _, _ in if failAcknowledgement { throw unauthorized } }
            ))
            await store.refresh()

            await store.markRead(pending.items[0])

            XCTAssertEqual(store.state, .signedOut)
            XCTAssertNil(store.snapshot)
            XCTAssertFalse(store.isSignedIn)
            XCTAssertFalse(store.canRespond(to: pending.items[0]))
        }
    }

    @MainActor
    func testOlderRefreshFailureCannotReplaceNewerSuccessfulSnapshot() async {
        let pending = Fixtures.snapshot(needsAction: true)
        let terminal = Fixtures.snapshot(needsAction: false)
        let delayedSnapshot = Deferred<MacSnapshot>()
        let fetches = FetchPlan([.snapshot(pending), .delayed(delayedSnapshot), .snapshot(terminal)])
        let store = makeStore(client: .stub(fetch: { _ in try await fetches.next() }))
        await store.refresh()
        let oldRefresh = Task { await store.refresh() }
        await delayedSnapshot.waitUntilRequested()
        await store.refresh()
        await delayedSnapshot.resolve(.failure(URLError(.notConnectedToInternet)))
        await oldRefresh.value

        XCTAssertEqual(store.state, .ready(terminal))
    }

    @MainActor
    private func makeStore(client: APIClient, defaults: UserDefaults? = nil) -> CompanionStore {
        CompanionStore(
            client: client,
            vault: TokenVault(read: { "hark_test" }, write: { _ in }, delete: {}),
            defaults: defaults ?? ephemeralDefaults()
        )
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
    static func snapshot(needsAction: Bool, readAt: Date? = nil) -> MacSnapshot {
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
                    readAt: readAt,
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
        },
        markRead: @escaping @Sendable (String, String) async throws -> Void = { _, _ in }
    ) -> APIClient {
        APIClient(
            beginAuthorization: { fatalError("Unexpected authorization") },
            pollAuthorization: { _ in fatalError("Unexpected poll") },
            registerDevice: { _, _, _, _, _ in fatalError("Unexpected registration") },
            fetchSnapshot: fetch,
            respond: respond,
            markRead: markRead,
            unregisterDevice: { _, _ in },
            revokeToken: { _ in }
        )
    }
}

// These gates control completion order without timing assumptions or sleeps.
private actor Deferred<Value: Sendable> {
    private var continuation: CheckedContinuation<Value, Error>?
    private var requested = false
    private var observers: [CheckedContinuation<Void, Never>] = []

    func value() async throws -> Value {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            requested = true
            for observer in observers { observer.resume() }
            observers.removeAll()
        }
    }

    func waitUntilRequested() async {
        if requested { return }
        await withCheckedContinuation { observers.append($0) }
    }

    func resolve(_ result: Result<Value, Error>) {
        continuation?.resume(with: result)
        continuation = nil
    }
}

private actor FetchPlan {
    enum Step: Sendable {
        case snapshot(MacSnapshot)
        case delayed(Deferred<MacSnapshot>)
        case failure
    }
    private var steps: [Step]
    private(set) var count = 0

    init(_ steps: [Step]) { self.steps = steps }

    func next() async throws -> MacSnapshot {
        count += 1
        guard !steps.isEmpty else {
            XCTFail("Unexpected snapshot fetch")
            throw URLError(.badServerResponse)
        }
        switch steps.removeFirst() {
        case .snapshot(let snapshot): return snapshot
        case .delayed(let deferred): return try await deferred.value()
        case .failure: throw URLError(.notConnectedToInternet)
        }
    }
}
