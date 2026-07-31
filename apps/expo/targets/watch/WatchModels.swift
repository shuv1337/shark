import Foundation

struct WatchSnapshot: Decodable, Sendable {
  let generatedAt: String
  let activities: [WatchActivity]
  let approvals: [WatchApproval]
}

struct WatchActivity: Decodable, Identifiable, Sendable {
  let id: String
  let title: String
  let status: String
  let detail: String?
  let progress: Double?
  let symbol: String
  let isPrivate: Bool
  let isStale: Bool
  let updatedAt: String

  var systemImage: String {
    switch symbol {
    case "code": "chevron.left.forwardslash.chevron.right"
    case "build": "hammer.fill"
    case "success": "checkmark.circle.fill"
    case "warning": "exclamationmark.triangle.fill"
    default: "terminal.fill"
    }
  }
}

struct WatchApproval: Decodable, Identifiable, Sendable {
  let id: String
  let title: String
  let prompt: String
  let kind: String
  let actionDigest: String
  let primaryLabel: String
  let secondaryLabel: String
  let expiresAt: String

  var primaryAction: String { kind == "approval" ? "approve" : "yes" }
  var secondaryAction: String { kind == "approval" ? "deny" : "no" }
}

struct WatchAuthResponse: Decodable, Sendable {
  let token: String
  let expiresAt: String
}

struct WatchActionResponse: Decodable, Sendable {
  let ok: Bool?
  let duplicate: Bool?
  let status: String?
  let error: String?
}

enum WatchLoadState {
  case idle
  case loading
  case loaded(WatchSnapshot)
  case stale(WatchSnapshot, String)
  case unavailable(String)
}

enum WatchActionFeedback: Equatable {
  case submitting
  case accepted(String)
  case duplicate(String)
  case handledElsewhere(String)
  case failed(String)
}

struct PendingWatchAction: Equatable {
  let interactionId: String
  let action: String
  let actionDigest: String
  let requestId: String
}

extension WatchSnapshot {
  static let preview = WatchSnapshot(
    generatedAt: "2026-07-30T12:00:00.000Z",
    activities: [
      WatchActivity(
        id: "activity-1",
        title: "Release build",
        status: "Running tests",
        detail: "184 of 220 checks",
        progress: 0.84,
        symbol: "build",
        isPrivate: false,
        isStale: false,
        updatedAt: "2026-07-30T12:00:00.000Z"
      )
    ],
    approvals: [
      WatchApproval(
        id: "approval-1",
        title: "Production deploy",
        prompt: "Ship the reviewed build to production?",
        kind: "approval",
        actionDigest: String(repeating: "a", count: 64),
        primaryLabel: "Approve",
        secondaryLabel: "Deny",
        expiresAt: "2026-07-30T12:15:00.000Z"
      )
    ]
  )
}
