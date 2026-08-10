import Foundation
import Security
import SwiftUI

private let apiOrigin = URL(string: "https://shark.shuv.dev")!
private let tokenKey = "dev.shuv.shark.watch.access-token"

private struct Snapshot: Codable {
  struct Work: Codable, Identifiable {
    let id: String
    let title: String
    let status: String
    let detail: String?
    let progress: Double?
    let updatedAt: Date
    let `private`: Bool
  }
  struct Interaction: Codable, Identifiable {
    let id: String
    let title: String
    let prompt: String
    let kind: String
    let actionDigest: String
    let expiresAt: Date
    let primaryLabel: String?
    let secondaryLabel: String?
  }
  let generatedAt: Date
  let activeWork: Work?
  let pendingInteraction: Interaction?
}

private struct AuthorizationStart: Decodable {
  let deviceCode: String
  let userCode: String
  let verificationUri: String
  let expiresIn: Int
  let interval: Int
}

private struct AuthorizationToken: Decodable { let accessToken: String }

@MainActor
private final class WatchModel: ObservableObject {
  enum State { case loading, ready(Snapshot), stale(Snapshot), unavailable(String), authorizing(AuthorizationStart) }
  @Published var state: State = .loading
  @Published var isSubmitting = false
  @Published var hideDetails = UserDefaults.standard.bool(forKey: "shark.watch.hide-details")
  private var token: String? = Keychain.read(tokenKey)
  private var lastSnapshot: Snapshot?

  init() {
    lastSnapshot = SnapshotCache.read()
    state = lastSnapshot.map(State.stale) ?? .loading
    Task { await refresh() }
  }

  func refresh() async {
    guard let token else { await beginAuthorization(); return }
    state = .loading
    do {
      let snapshot: Snapshot = try await request("/api/watch/snapshot", token: token)
      lastSnapshot = snapshot
      SnapshotCache.write(snapshot)
      state = .ready(snapshot)
    } catch {
      state = lastSnapshot.map(State.stale) ?? .unavailable("SHark is unavailable. Try again when your Watch is connected.")
    }
  }

  func beginAuthorization() async {
    do {
      let start: AuthorizationStart = try await request(
        "/api/device-authorization/start",
        method: "POST",
        body: ["clientName": "SHark Apple Watch", "scopes": ["watch:read", "watch:respond"], "expiresInSeconds": 7776000]
      )
      state = .authorizing(start)
      Task { await pollAuthorization(start) }
    } catch { state = .unavailable("Unable to start Watch setup.") }
  }

  private func pollAuthorization(_ start: AuthorizationStart) async {
    let deadline = Date().addingTimeInterval(TimeInterval(start.expiresIn))
    while Date() < deadline {
      try? await Task.sleep(nanoseconds: UInt64(start.interval) * 1_000_000_000)
      do {
        let value: AuthorizationToken = try await request("/api/device-authorization/token", method: "POST", body: ["deviceCode": start.deviceCode])
        token = value.accessToken
        Keychain.write(value.accessToken, key: tokenKey)
        await refresh()
        return
      } catch { continue } // Pending authorization is intentionally indistinguishable from a transient error.
    }
    state = .unavailable("Watch setup expired. Start again on this Watch.")
  }

  func respond(_ action: String, to item: Snapshot.Interaction) async {
    guard let token, !isSubmitting else { return }
    isSubmitting = true
    defer { isSubmitting = false }
    do {
      let response: Response = try await request(
        "/api/watch/interactions/\(item.id)/respond",
        method: "POST",
        token: token,
        body: ["action": action, "actionDigest": item.actionDigest]
      )
      lastSnapshot = response.snapshot
      SnapshotCache.write(response.snapshot)
      state = .ready(response.snapshot)
    } catch {
      // A simultaneous iPhone response receives a 409; a refresh makes the source of truth visible.
      await refresh()
    }
  }

  func setPrivacy(_ value: Bool) {
    hideDetails = value
    UserDefaults.standard.set(value, forKey: "shark.watch.hide-details")
  }
}

private struct Response: Decodable { let snapshot: Snapshot }

private extension WatchModel {
  func request<T: Decodable>(_ path: String, method: String = "GET", token: String? = nil, body: [String: Any]? = nil) async throws -> T {
    var request = URLRequest(url: apiOrigin.appendingPathComponent(path))
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
    let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
    return try decoder.decode(T.self, from: data)
  }
}

@main
struct SHarkWatchApp: App {
  @StateObject private var model = WatchModel()
  var body: some Scene { WindowGroup { WatchRoot(model: model) } }
}

private struct WatchRoot: View {
  @ObservedObject var model: WatchModel
  @State private var requestedAction: String?
  var body: some View {
    Group {
      switch model.state {
      case .loading: ProgressView("Updating SHark…")
      case .unavailable(let message): unavailable(message)
      case .authorizing(let authorization): setup(authorization)
      case .ready(let snapshot): content(snapshot, stale: false)
      case .stale(let snapshot): content(snapshot, stale: true)
      }
    }
    .task { await model.refresh() }
  }

  private func content(_ snapshot: Snapshot, stale: Bool) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 10) {
        Text("SHark").font(.headline).foregroundStyle(.orange)
        if stale { Text("Last known state — refresh before responding.").font(.caption2).foregroundStyle(.yellow) }
        if let work = snapshot.activeWork {
          Text(model.hideDetails || work.private ? "Agent task" : work.title).font(.headline)
          Text(model.hideDetails || work.private ? "In progress" : work.status).font(.caption).foregroundStyle(.secondary)
          if !model.hideDetails, !work.private, let detail = work.detail { Text(detail).font(.caption2).lineLimit(2) }
          if let progress = work.progress { ProgressView(value: progress) }
        } else { Text("No active work").foregroundStyle(.secondary) }
        if let item = snapshot.pendingInteraction {
          Divider(); Text("Needs your answer").font(.caption).foregroundStyle(.orange)
          Text(model.hideDetails ? "An approval is waiting" : item.title).font(.headline)
          if !model.hideDetails { Text(item.prompt).font(.caption).lineLimit(3) }
          HStack {
            Button(item.primaryLabel ?? (item.kind == "approval" ? "Approve" : "Yes")) { requestedAction = item.kind == "approval" ? "approve" : "yes" }.tint(.green)
            Button(item.secondaryLabel ?? (item.kind == "approval" ? "Deny" : "No")) { requestedAction = item.kind == "approval" ? "deny" : "no" }.tint(.red)
          }
          .disabled(model.isSubmitting || stale)
          .confirmationDialog("Confirm response", isPresented: Binding(get: { requestedAction != nil }, set: { if !$0 { requestedAction = nil } })) {
            Button("Confirm", role: requestedAction == "deny" || requestedAction == "no" ? .destructive : nil) { if let action = requestedAction { Task { await model.respond(action, to: item) }; requestedAction = nil } }
            Button("Cancel", role: .cancel) { requestedAction = nil }
          }
          if model.isSubmitting { ProgressView("Sending…") }
        }
        Toggle("Hide details", isOn: Binding(get: { model.hideDetails }, set: model.setPrivacy))
        Button("Refresh") { Task { await model.refresh() } }
      }.padding()
    }
  }

  private func setup(_ authorization: AuthorizationStart) -> some View {
    VStack(spacing: 8) {
      Text("Set up SHark").font(.headline)
      Text("On your iPhone, open:").font(.caption)
      Text(authorization.verificationUri).font(.caption2).multilineTextAlignment(.center)
      Text(authorization.userCode).font(.title3.monospaced()).bold()
      Text("Waiting for approval…").font(.caption).foregroundStyle(.secondary)
    }.padding()
  }

  private func unavailable(_ message: String) -> some View {
    VStack(spacing: 10) { Image(systemName: "wifi.exclamationmark").font(.title2); Text(message).multilineTextAlignment(.center); Button("Try again") { Task { await model.refresh() } } }.padding()
  }
}

private enum Keychain {
  static func read(_ key: String) -> String? {
    var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key, kSecReturnData as String: true]
    var item: CFTypeRef?; guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }
  static func write(_ value: String, key: String) {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key]
    SecItemDelete(query as CFDictionary)
    var item = query; item[kSecValueData as String] = Data(value.utf8); item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(item as CFDictionary, nil)
  }
}

private enum SnapshotCache {
  private static let key = "shark.watch.last-snapshot"
  static func read() -> Snapshot? {
    guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
    let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
    return try? decoder.decode(Snapshot.self, from: data)
  }
  static func write(_ snapshot: Snapshot) {
    let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
    UserDefaults.standard.set(try? encoder.encode(snapshot), forKey: key)
  }
}
