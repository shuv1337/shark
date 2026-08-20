import AppKit
import Foundation
import UserNotifications

@MainActor
final class CompanionStore: ObservableObject {
    enum State: Equatable {
        case signedOut
        case authorizing(AuthorizationStart)
        case loading
        case ready(MacSnapshot)
        case stale(MacSnapshot, String)
        case failed(String)
    }

    @Published private(set) var state: State
    @Published private(set) var isSubmitting = false
    @Published private(set) var registrationError: String?
    @Published var notice: String?
    @Published var hidePreviews: Bool {
        didSet {
            defaults.set(hidePreviews, forKey: Keys.hidePreviews)
            Task { await reregisterCurrentDevice() }
        }
    }

    private let client: APIClient
    private let vault: TokenVault
    private let defaults: UserDefaults
    private var accessToken: String?
    private var lastSnapshot: MacSnapshot?
    private var authorizationTask: Task<Void, Never>?
    private var lastAPNsToken: String?
    private var lastAPNsEnvironment: String?

    private enum Keys {
        static let snapshot = "shark.macos.last-snapshot"
        static let deviceID = "shark.macos.device-id"
        static let hidePreviews = "shark.macos.hide-previews"
    }

    init(
        client: APIClient,
        vault: TokenVault,
        defaults: UserDefaults = .standard
    ) {
        self.client = client
        self.vault = vault
        self.defaults = defaults
        accessToken = vault.read()
        hidePreviews = defaults.bool(forKey: Keys.hidePreviews)
        if let data = defaults.data(forKey: Keys.snapshot),
           let snapshot = try? ISO8601Coding.decoder().decode(MacSnapshot.self, from: data) {
            lastSnapshot = snapshot
        }
        state = accessToken == nil ? .signedOut : (lastSnapshot.map { .stale($0, "Last known state") } ?? .loading)
    }

    static func live() -> CompanionStore {
        CompanionStore(client: .live(), vault: .live)
    }

    var snapshot: MacSnapshot? {
        switch state {
        case .ready(let snapshot), .stale(let snapshot, _): snapshot
        default: lastSnapshot
        }
    }

    var isSignedIn: Bool { accessToken != nil }

    func start() async {
        guard accessToken != nil else {
            state = .signedOut
            return
        }
        await refresh()
    }

    func beginSignIn() async {
        authorizationTask?.cancel()
        state = .loading
        do {
            let authorization = try await client.beginAuthorization()
            state = .authorizing(authorization)
            NSWorkspace.shared.open(authorization.verificationUriComplete)
            authorizationTask = Task { [weak self] in
                await self?.poll(authorization)
            }
        } catch {
            state = .failed(message(for: error))
        }
    }

    func cancelSignIn() {
        authorizationTask?.cancel()
        authorizationTask = nil
        state = .signedOut
    }

    private func poll(_ authorization: AuthorizationStart) async {
        let deadline = Date().addingTimeInterval(TimeInterval(authorization.expiresIn))
        var interval = authorization.interval
        while !Task.isCancelled, Date() < deadline {
            try? await Task.sleep(for: .seconds(interval))
            if Task.isCancelled { return }
            do {
                let response = try await client.pollAuthorization(authorization.deviceCode)
                accessToken = response.accessToken
                vault.write(response.accessToken)
                authorizationTask = nil
                await refresh()
                await ensureRemoteNotificationsRegistered()
                return
            } catch let error as APIError where error.code == "authorization_pending" {
                continue
            } catch let error as APIError where error.code == "slow_down" {
                interval = error.retryInterval ?? min(interval + 5, 30)
                continue
            } catch let error as APIError where ["access_denied", "expired_token", "invalid_grant"].contains(error.code) {
                state = .failed(message(for: error))
                return
            } catch {
                continue
            }
        }
        if !Task.isCancelled { state = .failed("Setup expired. Start again.") }
    }

    func refresh() async {
        guard let accessToken else {
            state = .signedOut
            return
        }
        if lastSnapshot == nil { state = .loading }
        do {
            let snapshot = try await client.fetchSnapshot(accessToken)
            save(snapshot)
            state = .ready(snapshot)
        } catch let error as APIError where error.statusCode == 401 {
            clearLocalCredentials()
            state = .signedOut
        } catch {
            state = lastSnapshot.map { .stale($0, message(for: error)) } ?? .failed(message(for: error))
        }
    }

    func respond(to item: InboxItem, with action: CompanionAction) async {
        guard let metadata = item.action else { return }
        await respond(
            interactionID: metadata.interactionId,
            actionDigest: metadata.actionDigest,
            with: action
        )
    }

    func respond(
        interactionID: String,
        actionDigest: String,
        with action: CompanionAction
    ) async {
        guard let accessToken, !isSubmitting else { return }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let response = try await client.respond(
                accessToken,
                interactionID,
                action,
                actionDigest
            )
            save(response.snapshot)
            state = .ready(response.snapshot)
            notice = "Response sent."
        } catch let error as APIError where error.statusCode == 409 {
            notice = "Already handled on another device."
            await refresh()
        } catch {
            notice = message(for: error)
        }
    }

    func markRead(_ item: InboxItem) async {
        guard let accessToken else { return }
        try? await client.markRead(accessToken, item.id)
        await refresh()
    }

    func registerDevice(apnsToken: String, environment: String) async {
        lastAPNsToken = apnsToken
        lastAPNsEnvironment = environment
        guard let accessToken else { return }
        do {
            let response = try await client.registerDevice(
                accessToken,
                apnsToken,
                environment,
                Host.current().localizedName ?? "Mac",
                hidePreviews ? "private" : "standard"
            )
            defaults.set(response.device.id, forKey: Keys.deviceID)
            registrationError = nil
        } catch {
            registrationError = message(for: error)
        }
    }

    func registrationFailed(_ message: String) {
        registrationError = message
    }

    private func reregisterCurrentDevice() async {
        guard let lastAPNsToken, let lastAPNsEnvironment else { return }
        await registerDevice(apnsToken: lastAPNsToken, environment: lastAPNsEnvironment)
    }

    func ensureRemoteNotificationsRegistered() async {
        guard accessToken != nil else { return }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional {
            NSApplication.shared.registerForRemoteNotifications()
        }
    }

    func signOut() async {
        authorizationTask?.cancel()
        if let accessToken {
            if let deviceID = defaults.string(forKey: Keys.deviceID) {
                try? await client.unregisterDevice(accessToken, deviceID)
            }
            try? await client.revokeToken(accessToken)
        }
        NSApplication.shared.unregisterForRemoteNotifications()
        clearLocalCredentials()
        state = .signedOut
    }

    private func save(_ snapshot: MacSnapshot) {
        lastSnapshot = snapshot
        if let data = try? ISO8601Coding.encoder().encode(snapshot) {
            defaults.set(data, forKey: Keys.snapshot)
        }
    }

    private func clearLocalCredentials() {
        vault.delete()
        accessToken = nil
        lastSnapshot = nil
        lastAPNsToken = nil
        lastAPNsEnvironment = nil
        defaults.removeObject(forKey: Keys.snapshot)
        defaults.removeObject(forKey: Keys.deviceID)
    }

    private func message(for error: Error) -> String {
        if let localized = error as? LocalizedError, let description = localized.errorDescription {
            return description
        }
        return "SHark is unavailable. Check your connection and try again."
    }
}
