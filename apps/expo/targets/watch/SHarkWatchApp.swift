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
  struct Message: Codable, Identifiable {
    let id: String
    let source: String
    let title: String
    let body: String
    let occurredAt: Date
  }
  let generatedAt: Date
  let activeWork: Work?
  // Optional so a cached snapshot from an earlier build still decodes.
  let work: [Work]?
  let pendingInteraction: Interaction?
  let recentMessages: [Message]?

  var openWork: [Work] { work ?? activeWork.map { [$0] } ?? [] }
}

// Draft bodies are deliberately memory-only, never added to SnapshotCache.
private struct MessageDraft: Decodable, Identifiable {
  struct Recipient: Decodable {
    let id: String
    let label: String
    let address: String
    let verificationSource: String
  }
  let id: String
  let recipient: Recipient
  let text: String
  let revision: Int
  let actionDigest: String
  let expiresAt: Date
  let status: String
}
private struct DraftResponse: Decodable { let draft: MessageDraft? }

private struct AuthorizationStart: Decodable {
  let deviceCode: String
  let userCode: String
  let verificationUri: String
  let expiresIn: Int
  let interval: Int

  var displayVerificationUri: String {
    verificationUri
      .replacingOccurrences(of: "https://", with: "")
      .replacingOccurrences(of: "http://", with: "")
  }
}

private struct AuthorizationToken: Decodable { let accessToken: String }

private struct APIError: Error {
  let statusCode: Int
}

@MainActor
private final class WatchModel: ObservableObject {
  enum State { case loading, ready(Snapshot), stale(Snapshot), unavailable(String), reconnect(String), authorizing(AuthorizationStart) }
  @Published var state: State = .loading
  @Published var isSubmitting = false
  @Published var draft: MessageDraft?
  @Published var draftNotice: String?
  @Published var draftLoading = false
  @Published var hideDetails = UserDefaults.standard.bool(forKey: "shark.watch.hide-details")
  private var token: String? = Keychain.read(tokenKey)
  private var lastSubmittedDraftID: String?
  private var draftGeneration = 0
  private var privateDraftsActive = true
  private var lastSnapshot: Snapshot?
  private var authorizationAttempt: UUID?
  private var isRefreshing = false

  init() {
    lastSnapshot = SnapshotCache.read()
    state = lastSnapshot.map(State.stale) ?? .loading
    Task { await refresh() }
  }

  func refresh() async {
    guard authorizationAttempt == nil, !isRefreshing else { return }
    guard let token else { await beginAuthorization(); return }
    isRefreshing = true
    defer { isRefreshing = false }
    state = .loading
    do {
      let snapshot: Snapshot = try await request("/api/watch/snapshot", token: token)
      lastSnapshot = snapshot
      SnapshotCache.write(snapshot)
      state = .ready(snapshot)
      await refreshDraft()
    } catch let error as APIError where error.statusCode == 401 {
      draft = nil
      state = .reconnect("SHark rejected this Watch’s sign-in. Reconnect to refresh.")
    } catch {
      draft = nil
      state = lastSnapshot.map(State.stale) ?? .unavailable("SHark is unavailable. Try again when your Watch is connected.")
    }
  }

  func beginAuthorization() async {
    guard authorizationAttempt == nil else { return }
    let attempt = UUID()
    authorizationAttempt = attempt
    state = .loading
    do {
      let start: AuthorizationStart = try await request(
        "/api/device-authorization/start",
        method: "POST",
        body: ["clientName": "SHark Apple Watch", "scopes": ["watch:read", "watch:respond"], "expiresInSeconds": 7776000]
      )
      guard authorizationAttempt == attempt else { return }
      state = .authorizing(start)
      await pollAuthorization(start, attempt: attempt)
    } catch let error as APIError where error.statusCode == 400 {
      endAuthorization(attempt, message: "Watch setup is not enabled on this SHark server yet.")
    } catch {
      endAuthorization(attempt, message: "Couldn’t reach SHark to reconnect. Try again when connected.")
    }
  }

  func cancelAuthorization() {
    guard let attempt = authorizationAttempt else { return }
    endAuthorization(attempt, message: "Sign-in canceled. Reconnect to refresh.")
  }

  private func endAuthorization(_ attempt: UUID, message: String) {
    guard authorizationAttempt == attempt else { return }
    authorizationAttempt = nil
    state = .reconnect(message)
  }

  private func pollAuthorization(_ start: AuthorizationStart, attempt: UUID) async {
    let deadline = Date().addingTimeInterval(TimeInterval(start.expiresIn))
    while Date() < deadline && authorizationAttempt == attempt {
      do { try await Task.sleep(nanoseconds: UInt64(max(1, start.interval)) * 1_000_000_000) }
      catch {
        endAuthorization(attempt, message: "Sign-in interrupted. Reconnect to refresh.")
        return
      }
      guard authorizationAttempt == attempt, Date() < deadline else { break }
      let candidate: AuthorizationToken
      do {
        candidate = try await request("/api/device-authorization/token", method: "POST", body: ["deviceCode": start.deviceCode])
      } catch { continue } // Pending approval or transient error; never alter the previous token.
      guard authorizationAttempt == attempt else { return }
      do {
        // Verify account access before replacing the previous token or its cached state.
        let snapshot: Snapshot = try await request("/api/watch/snapshot", token: candidate.accessToken)
        guard authorizationAttempt == attempt else { return }
        guard Keychain.write(candidate.accessToken, key: tokenKey) else {
          endAuthorization(attempt, message: "Couldn’t save the new Watch sign-in. Reconnect to try again.")
          return
        }
        token = candidate.accessToken
        authorizationAttempt = nil
        lastSnapshot = snapshot
        SnapshotCache.write(snapshot)
        state = .ready(snapshot)
        await refreshDraft()
      } catch {
        endAuthorization(attempt, message: "Couldn’t verify the new Watch sign-in. Reconnect to try again.")
      }
      return
    }
    endAuthorization(attempt, message: "Watch setup expired. Reconnect to try again.")
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

  func clearPrivateDraft() {
    privateDraftsActive = false
    draftGeneration += 1
    draft = nil
    draftNotice = nil
  }

  func activatePrivateDrafts() { privateDraftsActive = true }

  func refreshDraft() async {
    draft = nil
    guard let token, privateDraftsActive else { return }
    draftGeneration += 1
    let generation = draftGeneration
    draftLoading = true
    defer { draftLoading = false }
    do {
      let result: DraftResponse = try await request("/api/watch/message-drafts/next", token: token)
      guard privateDraftsActive, generation == draftGeneration else { return }
      draft = result.draft
      if let submittedID = lastSubmittedDraftID {
        let receipt: DraftResponse = try await request("/api/watch/message-drafts/\(submittedID)", token: token)
        guard privateDraftsActive, generation == draftGeneration else { return }
        switch receipt.draft?.status {
        case "delivered": draftNotice = "Delivery confirmed."
        case "failed": draftNotice = "Delivery failed. No automatic retry."
        case "unknown": draftNotice = "Delivery unknown. Check the conversation before trying again."
        case "expired": draftNotice = "Draft expired before delivery was claimed. Nothing was sent."
        case "approved", "claimed": draftNotice = "Send authorized. Delivery is not yet confirmed."
        case "pending": draftNotice = "Draft still needs a confirmed Send."
        case "denied": draftNotice = "Draft denied. Nothing will be sent."
        default: draftNotice = "Delivery status unavailable."
        }
      }
    } catch {
      guard privateDraftsActive, generation == draftGeneration else { return }
      // An older server must keep legacy approvals usable, without enabling draft Send.
      draftNotice = "Message drafts unavailable. Refresh to try again."
    }
  }

  func editDraft(_ item: MessageDraft, text: String) async -> Bool {
    guard let token, privateDraftsActive, !isSubmitting, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
    let generation = draftGeneration
    isSubmitting = true
    defer { isSubmitting = false }
    do {
      let result: DraftResponse = try await request(
        "/api/watch/message-drafts/\(item.id)/edit", method: "POST", token: token,
        body: ["expectedRevision": item.revision, "actionDigest": item.actionDigest, "text": text]
      )
      guard privateDraftsActive, generation == draftGeneration else { return false }
      draft = result.draft
      draftNotice = "Saved. Review the revised message before Send."
      return true
    } catch {
      guard privateDraftsActive, generation == draftGeneration else { return false }
      let recoveryGeneration = draftGeneration + 1
      await refreshDraft()
      guard privateDraftsActive, recoveryGeneration == draftGeneration else { return false }
      draftNotice = "Edit was not confirmed. Review the current draft before trying again."
      return false
    }
  }

  func respondToDraft(_ action: String, item: MessageDraft) async {
    guard let token, privateDraftsActive, !isSubmitting else { return }
    if action == "send" { lastSubmittedDraftID = item.id }
    let generation = draftGeneration
    isSubmitting = true
    defer { isSubmitting = false }
    do {
      let _: DraftResponse = try await request(
        "/api/watch/message-drafts/\(item.id)/respond", method: "POST", token: token,
        body: ["expectedRevision": item.revision, "actionDigest": item.actionDigest, "action": action]
      )
      guard privateDraftsActive, generation == draftGeneration else { return }
      draft = nil
      if action == "send" { lastSubmittedDraftID = item.id }
      draftNotice = action == "send" ? "Send authorized. Delivery is not yet confirmed." : "Draft denied. Nothing will be sent."
    } catch {
      guard privateDraftsActive, generation == draftGeneration else { return }
      let recoveryGeneration = draftGeneration + 1
      await refreshDraft()
      guard privateDraftsActive, recoveryGeneration == draftGeneration else { return }
      // Never retry a send automatically or describe an uncertain response as delivered.
      draftNotice = "Response not confirmed. Refresh or check delivery status before retrying."
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
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    guard (200..<300).contains(http.statusCode) else { throw APIError(statusCode: http.statusCode) }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
      let value = try decoder.singleValueContainer().decode(String.self)
      let fractional = ISO8601DateFormatter()
      fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      if let date = fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value) { return date }
      throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid date"))
    }
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
  @Environment(\.scenePhase) private var scenePhase
  @State private var editingDraft: MessageDraft?
  @State private var draftText = ""
  @State private var draftConfirmation: String?
  @State private var confirmingDraft: MessageDraft?
  var body: some View {
    Group {
      switch model.state {
      case .loading: ProgressView("Updating SHark…")
      case .unavailable(let message): unavailable(message)
      case .authorizing(let authorization): setup(authorization)
      case .reconnect(let message):
        VStack(spacing: 8) {
          Text(message).multilineTextAlignment(.center)
          Button("Reconnect") { Task { await model.beginAuthorization() } }
          Button("Retry refresh") { Task { await model.refresh() } }
        }.padding()
      case .ready(let snapshot): content(snapshot, stale: false)
      case .stale(let snapshot): content(snapshot, stale: true)
      }
    }
    .task { await model.refresh() }
    .onChange(of: scenePhase) { phase in
      if phase == .active { model.activatePrivateDrafts(); Task { await model.refresh() } }
      else {
        model.clearPrivateDraft()
        editingDraft = nil
        confirmingDraft = nil
        draftText = ""
      }
    }
    .sheet(item: $editingDraft) { item in
      ScrollView {
        VStack(alignment: .leading, spacing: 10) {
          Text("Edit message").font(.headline)
          // Native text entry preserves the OS-selected keyboard/dictation method.
          TextField("Message", text: $draftText)
            .privacySensitive()
          Text("Save returns to preview. It does not send.").font(.caption2)
          Button("Save") {
            Task {
              if await model.editDraft(item, text: draftText) {
                editingDraft = nil
                draftText = ""
              }
            }
          }.disabled(model.isSubmitting || draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          Button("Cancel") { editingDraft = nil; draftText = "" }.disabled(model.isSubmitting)
          if let notice = model.draftNotice { Text(notice).font(.caption2) }
        }.padding()
      }.privacySensitive()
    }
  }

  private func content(_ snapshot: Snapshot, stale: Bool) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 10) {
        Text("SHark").font(.headline).foregroundStyle(.orange)
        if stale { Text("Last known state — refresh before responding.").font(.caption2).foregroundStyle(.yellow) }
        if snapshot.openWork.isEmpty { Text("No active work").foregroundStyle(.secondary) }
        ForEach(snapshot.openWork) { work in
          VStack(alignment: .leading, spacing: 2) {
            Text(model.hideDetails || work.private ? "Agent task" : work.title).font(.headline)
            Text(model.hideDetails || work.private ? "In progress" : work.status).font(.caption).foregroundStyle(.secondary)
            if !model.hideDetails, !work.private, let detail = work.detail { Text(detail).font(.caption2).lineLimit(2) }
            if let progress = work.progress { ProgressView(value: progress) }
          }
        }
        if let notice = model.draftNotice { Text(notice).font(.caption2) }
        if model.draftLoading { ProgressView("Checking drafts…") }
        if let item = model.draft {
          draftPreview(item, stale: stale)
        }
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
        if let messages = snapshot.recentMessages, !messages.isEmpty {
          Divider(); Text("Recent").font(.caption).foregroundStyle(.orange)
          ForEach(messages) { message in
            VStack(alignment: .leading, spacing: 2) {
              if model.hideDetails {
                Text("Message").font(.caption)
              } else {
                Text(message.source).font(.caption2).foregroundStyle(.secondary)
                Text(message.title).font(.caption).lineLimit(2)
                if !message.body.isEmpty { Text(message.body).font(.caption2).lineLimit(2) }
              }
            }
          }
        }
        Toggle("Hide details", isOn: Binding(get: { model.hideDetails }, set: model.setPrivacy))
        Button("Refresh") { Task { await model.refresh() } }
      }.padding()
    }
  }

  private func draftPreview(_ item: MessageDraft, stale: Bool) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Divider()
      Text("Message draft").font(.headline)
      if model.hideDetails {
        Text("Reveal details to review and send this private draft.").font(.caption)
      } else {
        Text("To: \(item.recipient.label)").font(.headline)
        Text(item.recipient.address).font(.caption)
        Text("Verified via \(item.recipient.verificationSource)").font(.caption2)
        // No line limit or collapsed summary: Send sits below the complete exact body.
        Text(item.text).font(.body).fixedSize(horizontal: false, vertical: true)
        Text("Revision \(item.revision)").font(.caption2)
        Button("Send") { confirmingDraft = item; draftConfirmation = "send" }.tint(.green)
        Button("Edit") { draftText = item.text; editingDraft = item }
        Button("Deny", role: .destructive) { confirmingDraft = item; draftConfirmation = "deny" }
      }
    }
    .privacySensitive()
    .disabled(stale || model.isSubmitting || model.draftLoading || item.status != "pending" || item.expiresAt <= Date())
    .confirmationDialog("Confirm exact draft", isPresented: Binding(
      get: { draftConfirmation != nil },
      set: { if !$0 { draftConfirmation = nil; confirmingDraft = nil } }
    )) {
      Button(draftConfirmation == "send" ? "Send this revision" : "Deny draft") {
        if let selected = confirmingDraft, let action = draftConfirmation {
          Task { await model.respondToDraft(action, item: selected) }
        }
        draftConfirmation = nil
        confirmingDraft = nil
      }
      Button("Cancel", role: .cancel) { draftConfirmation = nil; confirmingDraft = nil }
    }
  }

  private func setup(_ authorization: AuthorizationStart) -> some View {
    VStack(spacing: 8) {
      Text("Set up SHark").font(.headline)
      Text("In Safari on iPhone:").font(.caption)
      Text(authorization.displayVerificationUri)
        .font(.caption2.monospaced())
        .multilineTextAlignment(.center)
        .lineLimit(3)
        .minimumScaleFactor(0.75)
        .fixedSize(horizontal: false, vertical: true)
      Text(authorization.userCode).font(.title3.monospaced()).bold()
      Text("Waiting for approval…").font(.caption).foregroundStyle(.secondary)
      Button("Cancel") { model.cancelAuthorization() }
    }.padding()
  }

  private func unavailable(_ message: String) -> some View {
    VStack(spacing: 10) { Image(systemName: "wifi.exclamationmark").font(.title2); Text(message).multilineTextAlignment(.center); Button("Try again") { Task { await model.refresh() } } }.padding()
  }
}

private enum Keychain {
  static func read(_ key: String) -> String? {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key, kSecReturnData as String: true]
    var item: CFTypeRef?; guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }
  static func write(_ value: String, key: String) -> Bool {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key]
    let update: [String: Any] = [kSecValueData as String: Data(value.utf8)]
    let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
    if status == errSecSuccess { return true }
    guard status == errSecItemNotFound else { return false }
    var item = query
    item[kSecValueData as String] = Data(value.utf8)
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
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
