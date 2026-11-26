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
  let pendingInteractions: [Interaction]?
  let recentMessages: [Message]?

  var openWork: [Work] { work ?? activeWork.map { [$0] } ?? [] }
  var openInteractions: [Interaction] { pendingInteractions ?? pendingInteraction.map { [$0] } ?? [] }
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
  enum State { case loading, ready(Snapshot), stale(Snapshot), unavailable(String), authorizing(AuthorizationStart) }
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
      await refreshDraft()
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
    } catch let error as APIError where error.statusCode == 400 {
      state = .unavailable("Watch setup is not enabled on this SHark server yet.")
    } catch {
      state = .unavailable("Unable to reach SHark. Check your connection and try again.")
    }
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

private struct PendingConfirmation {
  let interaction: Snapshot.Interaction
  let action: String
}

private struct PendingDraftConfirmation {
  let draft: MessageDraft
  let action: String
}

private struct ReadyDraftIdentity: Equatable {
  let id: String
  let revision: Int
  let actionDigest: String
  let status: String
}

private struct WatchRoot: View {
  @ObservedObject var model: WatchModel
  @State private var pendingConfirmation: PendingConfirmation?
  @Environment(\.scenePhase) private var scenePhase
  @State private var editingDraft: MessageDraft?
  @State private var draftText = ""
  @State private var pendingDraftConfirmation: PendingDraftConfirmation?
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
    .onChange(of: scenePhase) { phase in
      if phase == .active { model.activatePrivateDrafts(); Task { await model.refresh() } }
      else {
        model.clearPrivateDraft()
        editingDraft = nil
        pendingDraftConfirmation = nil
        draftText = ""
        pendingConfirmation = nil
      }
    }
    // Leaving .ready yields nil; an answered or expired request drops its id.
    .onChange(of: readySnapshot?.openInteractions.map(\.id)) { ids in
      if let pending = pendingConfirmation, ids?.contains(pending.interaction.id) != true {
        pendingConfirmation = nil
      }
    }
    .onChange(of: readyDraftIdentity) { identity in
      if let pending = pendingDraftConfirmation,
         identity != ReadyDraftIdentity(
           id: pending.draft.id,
           revision: pending.draft.revision,
           actionDigest: pending.draft.actionDigest,
           status: pending.draft.status
         ) {
        pendingDraftConfirmation = nil
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
    // Actions answer only the presented payload, so a refresh or reorder cannot retarget them.
    .confirmationDialog(
      "Confirm response",
      isPresented: Binding(
        get: { pendingConfirmation != nil && readySnapshot != nil && !model.isSubmitting },
        set: { if !$0 { pendingConfirmation = nil } }
      ),
      titleVisibility: .visible,
      presenting: pendingConfirmation
    ) { pending in
      Button("Confirm", role: pending.action == "deny" || pending.action == "no" ? .destructive : nil) {
        guard readySnapshot != nil, !model.isSubmitting, pending.interaction.expiresAt > Date() else { return }
        Task { await model.respond(pending.action, to: pending.interaction) }
      }
      Button("Cancel", role: .cancel) {}
    } message: { pending in
      Text(model.hideDetails ? "An approval is waiting" : pending.interaction.title)
    }
    .confirmationDialog(
      "Confirm exact draft",
      isPresented: Binding(
        get: { pendingDraftConfirmation != nil && readySnapshot != nil && !model.hideDetails && !model.isSubmitting && !model.draftLoading },
        set: { if !$0 { pendingDraftConfirmation = nil } }
      ),
      titleVisibility: .visible,
      presenting: pendingDraftConfirmation
    ) { pending in
      Button(pending.action == "send" ? "Send this revision" : "Deny draft", role: pending.action == "deny" ? .destructive : nil) {
        guard readySnapshot != nil, !model.hideDetails, !model.isSubmitting, !model.draftLoading, pending.draft.status == "pending", pending.draft.expiresAt > Date() else { return }
        Task { await model.respondToDraft(pending.action, item: pending.draft) }
      }
      Button("Cancel", role: .cancel) {}
    } message: { pending in
      Text("To \(pending.draft.recipient.label) · Revision \(pending.draft.revision)")
    }
  }

  private var readySnapshot: Snapshot? {
    if case .ready(let snapshot) = model.state { return snapshot }
    return nil
  }

  private var readyDraftIdentity: ReadyDraftIdentity? {
    guard readySnapshot != nil, !model.hideDetails, let draft = model.draft, draft.status == "pending" else { return nil }
    return ReadyDraftIdentity(
      id: draft.id,
      revision: draft.revision,
      actionDigest: draft.actionDigest,
      status: draft.status
    )
  }

  private func content(_ snapshot: Snapshot, stale: Bool) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 10) {
        Text("SHark").font(.headline).foregroundStyle(.orange)
        if stale { Text("Last known state — refresh before responding.").font(.caption2).foregroundStyle(.yellow) }
        if !snapshot.openInteractions.isEmpty {
          VStack(alignment: .leading, spacing: 10) {
            Text("Needs your answer").font(.caption).foregroundStyle(.orange)
            ForEach(snapshot.openInteractions) { item in
              VStack(alignment: .leading, spacing: 4) {
                Text(model.hideDetails ? "An approval is waiting" : item.title).font(.headline)
                if !model.hideDetails { Text(item.prompt).font(.caption).lineLimit(3) }
                HStack {
                  Button((model.hideDetails ? nil : item.primaryLabel) ?? (item.kind == "approval" ? "Approve" : "Yes")) {
                    pendingConfirmation = PendingConfirmation(interaction: item, action: item.kind == "approval" ? "approve" : "yes")
                  }.tint(.green)
                  Button((model.hideDetails ? nil : item.secondaryLabel) ?? (item.kind == "approval" ? "Deny" : "No")) {
                    pendingConfirmation = PendingConfirmation(interaction: item, action: item.kind == "approval" ? "deny" : "no")
                  }.tint(.red)
                }
                .disabled(model.isSubmitting || stale || item.expiresAt <= Date())
              }
            }
            if model.isSubmitting { ProgressView("Sending…") }
          }
        }
        if let notice = model.draftNotice { Text(notice).font(.caption2) }
        if model.draftLoading { ProgressView("Checking drafts…") }
        if let item = model.draft {
          draftPreview(item, stale: stale)
        }
        if snapshot.openInteractions.isEmpty, model.draft == nil, !model.draftLoading {
          Text("Nothing needs your answer").foregroundStyle(.secondary)
        }
        if !snapshot.openWork.isEmpty {
          Divider(); Text("Active work").font(.caption).foregroundStyle(.orange)
          ForEach(snapshot.openWork) { work in
            VStack(alignment: .leading, spacing: 2) {
              Text(model.hideDetails || work.private ? "Agent task" : work.title).font(.headline)
              Text(model.hideDetails || work.private ? "In progress" : work.status).font(.caption).foregroundStyle(.secondary)
              if !model.hideDetails, !work.private, let detail = work.detail { Text(detail).font(.caption2).lineLimit(2) }
              if let progress = work.progress { ProgressView(value: progress) }
            }
          }
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
        Button("Send") { pendingDraftConfirmation = PendingDraftConfirmation(draft: item, action: "send") }.tint(.green)
        Button("Edit") { draftText = item.text; editingDraft = item }
        Button("Deny", role: .destructive) { pendingDraftConfirmation = PendingDraftConfirmation(draft: item, action: "deny") }
      }
    }
    .privacySensitive()
    .disabled(stale || model.isSubmitting || model.draftLoading || item.status != "pending" || item.expiresAt <= Date())
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
