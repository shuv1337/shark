import Intents
import UserNotifications

/// Rewrites incoming SHark pushes into iOS communication notifications.
///
/// The server sends (via the Expo Push Service) a payload whose `data` object
/// carries `sourceName`, `avatarUrl`, `conversationId`, etc. On iOS, Expo
/// nests that object under `userInfo["body"]`; this extension also accepts the
/// same keys at the top level of `userInfo` for forwards compatibility.
final class NotificationService: UNNotificationServiceExtension {

  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttemptContent: UNMutableNotificationContent?

  private let completionLock = NSLock()
  private var didComplete = false

  /// Our own deadline, comfortably inside the ~30s system limit.
  private static let selfImposedTimeout: TimeInterval = 25

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    let content =
      (request.content.mutableCopy() as? UNMutableNotificationContent)
      ?? UNMutableNotificationContent()
    self.bestAttemptContent = content

    // Timeout fallback: never hold the notification past our own deadline.
    DispatchQueue.global().asyncAfter(deadline: .now() + Self.selfImposedTimeout) { [weak self] in
      guard let self else { return }
      self.completeOnce(with: self.bestAttemptContent ?? content)
    }

    guard
      let data = Self.extractHarkData(from: request.content.userInfo),
      let sourceName = data["sourceName"] as? String,
      !sourceName.isEmpty
    else {
      // Not a SHark communication payload — deliver unchanged.
      completeOnce(with: content)
      return
    }

    let conversationId =
      (data["conversationId"] as? String)
      ?? (data["serviceId"] as? String)
      ?? "hark"
    let avatarUrl = (data["avatarUrl"] as? String).flatMap(URL.init(string:))

    downloadAvatar(avatarUrl) { [weak self] avatar in
      guard let self else { return }
      self.applyCommunicationStyle(
        to: content,
        sourceName: sourceName,
        conversationId: conversationId,
        avatar: avatar
      )
    }
  }

  override func serviceExtensionTimeWillExpire() {
    completeOnce(with: bestAttemptContent ?? UNMutableNotificationContent())
  }

  // MARK: - Payload parsing

  /// Expo delivers the push message's `data` dictionary at `userInfo["body"]`.
  /// Accepts that envelope first, a JSON string variant, then top-level keys.
  static func extractHarkData(from userInfo: [AnyHashable: Any]) -> [String: Any]? {
    if let body = userInfo["body"] as? [String: Any], body["sourceName"] != nil {
      return body
    }
    if let bodyString = userInfo["body"] as? String,
      let object = try? JSONSerialization.jsonObject(with: Data(bodyString.utf8)),
      let parsed = object as? [String: Any],
      parsed["sourceName"] != nil
    {
      return parsed
    }
    if userInfo["sourceName"] != nil {
      var result: [String: Any] = [:]
      for (key, value) in userInfo {
        if let key = key as? String {
          result[key] = value
        }
      }
      return result
    }
    return nil
  }

  // MARK: - Avatar

  private func downloadAvatar(_ url: URL?, completion: @escaping (INImage?) -> Void) {
    guard let url else {
      completion(nil)
      return
    }
    let task = URLSession.shared.dataTask(with: url) { data, response, _ in
      guard
        let data,
        let http = response as? HTTPURLResponse,
        (200..<300).contains(http.statusCode)
      else {
        completion(nil)
        return
      }
      completion(INImage(imageData: data))
    }
    task.resume()
  }

  // MARK: - Communication notification

  private func applyCommunicationStyle(
    to content: UNMutableNotificationContent,
    sourceName: String,
    conversationId: String,
    avatar: INImage?
  ) {
    let handle = INPersonHandle(value: "hark:\(conversationId)", type: .unknown)
    let sender = INPerson(
      personHandle: handle,
      nameComponents: nil,
      displayName: sourceName,
      image: avatar,
      contactIdentifier: nil,
      customIdentifier: "hark:\(conversationId)"
    )

    let intent = INSendMessageIntent(
      recipients: nil,
      outgoingMessageType: .outgoingMessageText,
      content: content.body,
      speakableGroupName: nil,
      conversationIdentifier: conversationId,
      serviceName: "SHark",
      sender: sender,
      attachments: nil
    )

    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .incoming
    interaction.donate { [weak self] error in
      guard let self else { return }
      if error != nil {
        self.completeOnce(with: content)
        return
      }
      do {
        let updated = try content.updating(from: intent)
        // Intent styling can replace the category, which would remove SHark's actions.
        let actionable =
          (updated.mutableCopy() as? UNMutableNotificationContent)
          ?? content
        actionable.categoryIdentifier = content.categoryIdentifier
        self.completeOnce(with: actionable)
      } catch {
        self.completeOnce(with: content)
      }
    }
  }

  // MARK: - Completion

  /// Completes exactly once, no matter which path (success, error, timeout,
  /// or system expiration) gets here first.
  private func completeOnce(with content: UNNotificationContent) {
    completionLock.lock()
    guard !didComplete, let handler = contentHandler else {
      completionLock.unlock()
      return
    }
    didComplete = true
    completionLock.unlock()
    handler(content)
  }
}
