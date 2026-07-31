import AuthenticationServices
import Foundation
import Observation

@MainActor
@Observable
final class WatchModel {
  var isSignedIn: Bool
  var isSigningIn = false
  var loadState: WatchLoadState = .idle
  var actionFeedback: WatchActionFeedback?

  private let api: WatchAPI
  private var token: String?
  private var started = false
  private var pendingAction: PendingWatchAction?

  init(api: WatchAPI = .production, preview: WatchSnapshot? = nil) {
    self.api = api
    if let preview {
      token = "preview"
      isSignedIn = true
      loadState = .loaded(preview)
      started = true
    } else {
      let existingToken = WatchCredentialStore.load()
      token = existingToken
      isSignedIn = existingToken != nil
    }
  }

  func start() async {
    guard !started else { return }
    started = true
    if isSignedIn { await refresh() }
  }

  func completeSignIn(_ result: Result<ASAuthorization, Error>) async {
    isSigningIn = true
    actionFeedback = nil
    defer { isSigningIn = false }
    do {
      let authorization = try result.get()
      guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
        let identityData = credential.identityToken,
        let codeData = credential.authorizationCode,
        let identityToken = String(data: identityData, encoding: .utf8),
        let authorizationCode = String(data: codeData, encoding: .utf8)
      else {
        throw WatchAPIError.invalidResponse
      }
      let response = try await api.authenticate(
        identityToken: identityToken,
        authorizationCode: authorizationCode
      )
      try WatchCredentialStore.save(response.token)
      token = response.token
      isSignedIn = true
      await refresh()
    } catch {
      loadState = .unavailable(message(for: error))
    }
  }

  func refresh() async {
    guard let token else {
      isSignedIn = false
      loadState = .idle
      return
    }
    let cached = currentSnapshot
    loadState = cached == nil ? .loading : loadState
    do {
      loadState = .loaded(try await api.snapshot(token: token))
    } catch WatchAPIError.unauthorized {
      WatchCredentialStore.clear()
      self.token = nil
      isSignedIn = false
      loadState = .unavailable("Sign in again to reconnect this Watch.")
    } catch {
      let text = message(for: error)
      loadState = cached.map { .stale($0, text) } ?? .unavailable(text)
    }
  }

  func respond(to approval: WatchApproval, action: String) async {
    guard let token, actionFeedback != .submitting else { return }
    let pending =
      pendingAction.flatMap {
        $0.interactionId == approval.id && $0.action == action ? $0 : nil
      }
      ?? PendingWatchAction(
        interactionId: approval.id,
        action: action,
        actionDigest: approval.actionDigest,
        requestId: UUID().uuidString
      )
    pendingAction = pending
    actionFeedback = .submitting
    do {
      let response = try await api.respond(token: token, pending: pending)
      pendingAction = nil
      if response.duplicate == true {
        actionFeedback = .duplicate(response.status ?? "handled")
      } else {
        actionFeedback = .accepted(response.status ?? action)
      }
      await refresh()
    } catch WatchAPIError.server(let status, let message) where status == 409 {
      pendingAction = nil
      actionFeedback = .handledElsewhere(message)
      await refresh()
    } catch {
      actionFeedback = .failed(message(for: error))
    }
  }

  func retryPendingAction() async {
    guard let pendingAction,
      let snapshot = currentSnapshot,
      let approval = snapshot.approvals.first(where: { $0.id == pendingAction.interactionId })
    else { return }
    await respond(to: approval, action: pendingAction.action)
  }

  func dismissFeedback() {
    if case .failed = actionFeedback { return }
    actionFeedback = nil
  }

  var currentSnapshot: WatchSnapshot? {
    switch loadState {
    case .loaded(let snapshot), .stale(let snapshot, _): snapshot
    default: nil
    }
  }

  private func message(for error: Error) -> String {
    (error as? LocalizedError)?.errorDescription ?? "SHark is unavailable. Try again."
  }
}
