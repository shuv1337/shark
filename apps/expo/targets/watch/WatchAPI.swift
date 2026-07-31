import Foundation
import Security

enum WatchAPIError: LocalizedError {
  case invalidResponse
  case unauthorized
  case server(status: Int, message: String)

  var errorDescription: String? {
    switch self {
    case .invalidResponse:
      "SHark returned an unreadable response."
    case .unauthorized:
      "Sign in again to reconnect this Watch."
    case .server(_, let message):
      message
    }
  }
}

struct WatchAPI: Sendable {
  static let production = WatchAPI(baseURL: URL(string: "https://shark.shuv.dev")!)

  let baseURL: URL
  private let decoder = JSONDecoder()
  private let encoder = JSONEncoder()

  func authenticate(identityToken: String, authorizationCode: String) async throws -> WatchAuthResponse {
    try await request(
      path: "/api/watch/auth/apple",
      method: "POST",
      token: nil,
      body: [
        "identityToken": identityToken,
        "authorizationCode": authorizationCode,
        "deviceName": "Apple Watch",
      ]
    )
  }

  func snapshot(token: String) async throws -> WatchSnapshot {
    try await request(path: "/api/watch/snapshot", method: "GET", token: token, body: nil)
  }

  func respond(token: String, pending: PendingWatchAction) async throws -> WatchActionResponse {
    try await request(
      path: "/api/watch/interactions/\(pending.interactionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? pending.interactionId)/respond",
      method: "POST",
      token: token,
      body: [
        "action": pending.action,
        "actionDigest": pending.actionDigest,
        "requestId": pending.requestId,
      ]
    )
  }

  private func request<Response: Decodable>(
    path: String,
    method: String,
    token: String?,
    body: [String: String]?
  ) async throws -> Response {
    var request = URLRequest(url: baseURL.appending(path: path))
    request.httpMethod = method
    request.timeoutInterval = 15
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try encoder.encode(body)
    }

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw WatchAPIError.invalidResponse }
    if http.statusCode == 401 { throw WatchAPIError.unauthorized }
    guard (200..<300).contains(http.statusCode) else {
      let failure = try? decoder.decode(WatchActionResponse.self, from: data)
      throw WatchAPIError.server(
        status: http.statusCode,
        message: failure?.error ?? "SHark is unavailable (\(http.statusCode))."
      )
    }
    do {
      return try decoder.decode(Response.self, from: data)
    } catch {
      throw WatchAPIError.invalidResponse
    }
  }
}

enum WatchCredentialStore {
  private static let service = "dev.shuv.shark.watch"
  private static let account = "watch-api-token"

  static func load() -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func save(_ token: String) throws {
    let data = Data(token.utf8)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      var insert = query
      attributes.forEach { insert[$0.key] = $0.value }
      guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else {
        throw WatchAPIError.invalidResponse
      }
    } else if status != errSecSuccess {
      throw WatchAPIError.invalidResponse
    }
  }

  static func clear() {
    SecItemDelete([
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ] as CFDictionary)
  }
}
