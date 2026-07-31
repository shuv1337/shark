import AuthenticationServices
import SwiftUI

private extension Color {
  static let sharkAccent = Color(red: 0.827, green: 0.361, blue: 0.275)
}

struct WatchRootView: View {
  @Environment(\.scenePhase) private var scenePhase
  let model: WatchModel
  var forcePrivacy = false

  var body: some View {
    Group {
      if forcePrivacy || scenePhase != .active {
        PrivacyShieldView()
      } else if !model.isSignedIn {
        SignInView(model: model)
      } else {
        dashboard
      }
    }
    .containerBackground(for: .navigation) {
      LinearGradient(
        colors: [Color(red: 0.047, green: 0.067, blue: 0.098), .black],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
    }
    .task { await model.start() }
  }

  @ViewBuilder
  private var dashboard: some View {
    switch model.loadState {
    case .idle, .loading:
      LoadingView()
    case .loaded(let snapshot):
      SnapshotView(snapshot: snapshot, model: model, staleMessage: nil)
    case .stale(let snapshot, let message):
      SnapshotView(snapshot: snapshot, model: model, staleMessage: message)
    case .unavailable(let message):
      UnavailableView(message: message) { await model.refresh() }
    }
  }
}

private struct BrandHeader: View {
  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: "wave.3.right")
        .font(.caption.weight(.bold))
        .foregroundStyle(Color.sharkAccent)
      Text("SHark")
        .font(.caption.weight(.semibold))
      Spacer()
    }
    .textCase(nil)
  }
}

private struct LoadingView: View {
  var body: some View {
    VStack(spacing: 10) {
      BrandHeader()
      Spacer()
      ProgressView()
        .tint(.sharkAccent)
      Text("Checking active work")
        .font(.caption2)
        .foregroundStyle(.secondary)
      Spacer()
    }
    .padding(.horizontal, 10)
  }
}

private struct SignInView: View {
  let model: WatchModel

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        BrandHeader()
        Image(systemName: "checkmark.shield.fill")
          .font(.title2)
          .foregroundStyle(Color.sharkAccent)
        Text("Status and urgent approvals.")
          .font(.headline)
        Text("Sign in with the same Apple ID as SHark on iPhone.")
          .font(.caption2)
          .foregroundStyle(.secondary)
        SignInWithAppleButton(.continue) { request in
          request.requestedScopes = []
        } onCompletion: { result in
          Task { await model.completeSignIn(result) }
        }
        .signInWithAppleButtonStyle(.white)
        .frame(height: 34)
        .disabled(model.isSigningIn)
        if model.isSigningIn {
          ProgressView().frame(maxWidth: .infinity)
        }
        if case .unavailable(let message) = model.loadState {
          Text(message)
            .font(.caption2)
            .foregroundStyle(.red)
        }
      }
      .padding(.horizontal, 10)
    }
  }
}

private struct SnapshotView: View {
  let snapshot: WatchSnapshot
  let model: WatchModel
  let staleMessage: String?

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 10) {
        BrandHeader()
        if let staleMessage {
          StatusBanner(
            icon: "wifi.slash",
            title: "Last known status",
            detail: staleMessage,
            color: .orange
          )
        }
        if let feedback = model.actionFeedback {
          ActionFeedbackView(feedback: feedback, model: model)
        }
        if let approval = snapshot.approvals.first {
          ApprovalCard(
            approval: approval,
            waitingCount: snapshot.approvals.count,
            model: model
          )
        }
        if let activity = snapshot.activities.first {
          ActivityCard(activity: activity)
        } else if snapshot.approvals.isEmpty {
          EmptyStateView()
        }
        Button {
          Task { await model.refresh() }
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
            .font(.caption2)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
        .padding(.top, 2)
      }
      .padding(.horizontal, 8)
      .privacySensitive()
    }
    .refreshable { await model.refresh() }
  }
}

private struct ApprovalCard: View {
  let approval: WatchApproval
  let waitingCount: Int
  let model: WatchModel

  var isSubmitting: Bool { model.actionFeedback == .submitting }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Label("URGENT", systemImage: "exclamationmark.circle.fill")
          .font(.caption2.weight(.bold))
          .foregroundStyle(Color.sharkAccent)
        Spacer()
        if waitingCount > 1 {
          Text("+\(waitingCount - 1)")
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.secondary)
        }
      }
      Text(approval.title)
        .font(.headline)
        .lineLimit(2)
      Text(approval.prompt)
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(4)
      HStack(spacing: 6) {
        Button(approval.secondaryLabel) {
          Task { await model.respond(to: approval, action: approval.secondaryAction) }
        }
        .tint(.gray.opacity(0.55))
        Button(approval.primaryLabel) {
          Task { await model.respond(to: approval, action: approval.primaryAction) }
        }
        .tint(Color.sharkAccent)
      }
      .font(.caption2.weight(.semibold))
      .disabled(isSubmitting)
      if isSubmitting {
        HStack(spacing: 5) {
          ProgressView().controlSize(.mini)
          Text("Sending response…")
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
      }
    }
    .padding(10)
    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
    .overlay {
      RoundedRectangle(cornerRadius: 14)
        .stroke(Color.sharkAccent.opacity(0.45), lineWidth: 1)
    }
  }
}

private struct ActivityCard: View {
  let activity: WatchActivity

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      HStack {
        Image(systemName: activity.systemImage)
          .foregroundStyle(activity.isStale ? Color.orange : Color.sharkAccent)
        Text(activity.title)
          .font(.headline)
          .lineLimit(1)
        Spacer()
        if activity.isPrivate {
          Image(systemName: "eye.slash.fill")
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      }
      Text(activity.status)
        .font(.caption)
      if let detail = activity.detail {
        Text(detail)
          .font(.caption2)
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }
      if let progress = activity.progress {
        ProgressView(value: progress)
          .tint(activity.isStale ? .orange : .sharkAccent)
      }
      if activity.isStale {
        Label("Update is stale", systemImage: "clock.badge.exclamationmark")
          .font(.caption2)
          .foregroundStyle(.orange)
      }
    }
    .padding(10)
    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
  }
}

private struct ActionFeedbackView: View {
  let feedback: WatchActionFeedback
  let model: WatchModel

  var body: some View {
    switch feedback {
    case .submitting:
      EmptyView()
    case .accepted:
      StatusBanner(
        icon: "checkmark.circle.fill",
        title: "Response recorded",
        detail: "SHark confirmed the action.",
        color: .green
      )
      .onTapGesture { model.dismissFeedback() }
    case .duplicate:
      StatusBanner(
        icon: "arrow.triangle.2.circlepath.circle.fill",
        title: "Already recorded",
        detail: "This Watch retry was safely deduplicated.",
        color: .blue
      )
      .onTapGesture { model.dismissFeedback() }
    case .handledElsewhere(let detail):
      StatusBanner(
        icon: "person.2.fill",
        title: "Handled elsewhere",
        detail: detail,
        color: .orange
      )
      .onTapGesture { model.dismissFeedback() }
    case .failed(let detail):
      VStack(alignment: .leading, spacing: 6) {
        StatusBanner(icon: "exclamationmark.triangle.fill", title: "Not sent", detail: detail, color: .red)
        Button("Retry same action") {
          Task { await model.retryPendingAction() }
        }
        .font(.caption2.weight(.semibold))
        .tint(Color.sharkAccent)
      }
    }
  }
}

private struct StatusBanner: View {
  let icon: String
  let title: String
  let detail: String
  let color: Color

  var body: some View {
    HStack(alignment: .top, spacing: 7) {
      Image(systemName: icon).foregroundStyle(color)
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.caption.weight(.semibold))
        Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
      }
    }
    .padding(8)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
  }
}

private struct EmptyStateView: View {
  var body: some View {
    VStack(spacing: 8) {
      Image(systemName: "checkmark.circle")
        .font(.title2)
        .foregroundStyle(.green)
      Text("All clear")
        .font(.headline)
      Text("No active work or approvals.")
        .font(.caption2)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 14)
  }
}

private struct UnavailableView: View {
  let message: String
  let retry: () async -> Void

  var body: some View {
    VStack(spacing: 9) {
      BrandHeader()
      Spacer()
      Image(systemName: "wifi.exclamationmark")
        .font(.title2)
        .foregroundStyle(.orange)
      Text("Status unavailable").font(.headline)
      Text(message)
        .font(.caption2)
        .multilineTextAlignment(.center)
        .foregroundStyle(.secondary)
      Button("Retry") { Task { await retry() } }
        .tint(Color.sharkAccent)
      Spacer()
    }
    .padding(.horizontal, 10)
  }
}

private struct PrivacyShieldView: View {
  var body: some View {
    VStack(spacing: 8) {
      Image(systemName: "eye.slash.fill")
        .font(.title2)
        .foregroundStyle(Color.sharkAccent)
      Text("SHark")
        .font(.headline)
      Text("Raise your wrist to view status.")
        .font(.caption2)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
    .padding()
  }
}

#Preview("Loaded") {
  WatchRootView(model: WatchModel(preview: .preview))
}

#Preview("Private") {
  WatchRootView(model: WatchModel(preview: .preview), forcePrivacy: true)
}

#Preview("Unavailable") {
  let model = WatchModel(preview: .preview)
  model.loadState = .unavailable("The server could not be reached.")
  return WatchRootView(model: model)
}
