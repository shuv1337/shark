import Foundation

struct APIClient {
    var beginAuthorization: @Sendable () async throws -> AuthorizationStart
    var pollAuthorization: @Sendable (_ deviceCode: String) async throws -> AuthorizationToken
    var registerDevice: @Sendable (
        _ token: String,
        _ apnsToken: String,
        _ environment: String,
        _ deviceName: String,
        _ privacyMode: String
    ) async throws -> DeviceRegistrationResponse
    var fetchSnapshot: @Sendable (_ token: String) async throws -> MacSnapshot
    var respond: @Sendable (
        _ token: String,
        _ interactionId: String,
        _ action: CompanionAction,
        _ actionDigest: String
    ) async throws -> InteractionResponse
    var markRead: @Sendable (_ token: String, _ itemId: String) async throws -> Void
    var unregisterDevice: @Sendable (_ token: String, _ deviceId: String) async throws -> Void
    var revokeToken: @Sendable (_ token: String) async throws -> Void
}

extension APIClient {
    static func live(origin: URL = URL(string: "https://shark.shuv.dev")!) -> APIClient {
        let transport = HTTPTransport(origin: origin)
        return APIClient(
            beginAuthorization: {
                try await transport.request(
                    "/api/device-authorization/start",
                    method: "POST",
                    body: [
                        "clientName": "SHark for Mac",
                        "scopes": ["macos:read", "macos:respond", "macos:register"],
                        "expiresInSeconds": 7_776_000,
                    ]
                )
            },
            pollAuthorization: { deviceCode in
                try await transport.request(
                    "/api/device-authorization/token",
                    method: "POST",
                    body: ["deviceCode": deviceCode]
                )
            },
            registerDevice: { token, apnsToken, environment, deviceName, privacyMode in
                try await transport.request(
                    "/api/macos/devices",
                    method: "POST",
                    token: token,
                    body: [
                        "apnsToken": apnsToken,
                        "environment": environment,
                        "deviceName": deviceName,
                        "privacyMode": privacyMode,
                    ]
                )
            },
            fetchSnapshot: { token in
                try await transport.request("/api/macos/snapshot", token: token)
            },
            respond: { token, interactionId, action, actionDigest in
                var body = ["action": action.apiValue, "actionDigest": actionDigest]
                if let response = action.responseText { body["response"] = response }
                return try await transport.request(
                    "/api/macos/interactions/\(interactionId)/respond",
                    method: "POST",
                    token: token,
                    body: body
                )
            },
            markRead: { token, itemId in
                let _: EmptyResponse = try await transport.request(
                    "/api/macos/inbox/\(itemId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? itemId)/read",
                    method: "POST",
                    token: token
                )
            },
            unregisterDevice: { token, deviceId in
                let _: EmptyResponse = try await transport.request(
                    "/api/macos/devices/\(deviceId)",
                    method: "DELETE",
                    token: token
                )
            },
            revokeToken: { token in
                let _: EmptyResponse = try await transport.request(
                    "/api/agent/auth/revoke",
                    method: "POST",
                    token: token
                )
            }
        )
    }
}

private struct EmptyResponse: Decodable {
    let ok: Bool
}

private struct HTTPTransport: Sendable {
    let origin: URL
    let session: URLSession

    init(origin: URL, session: URLSession = .shared) {
        self.origin = origin
        self.session = session
    }

    func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        token: String? = nil,
        body: [String: Any]? = nil
    ) async throws -> T {
        guard let url = URL(string: path, relativeTo: origin) else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            let serverError = try? JSONDecoder().decode(ServerErrorBody.self, from: data)
            throw APIError(
                statusCode: http.statusCode,
                code: serverError?.error ?? "SHark returned HTTP \(http.statusCode).",
                retryInterval: serverError?.interval
            )
        }
        return try ISO8601Coding.decoder().decode(T.self, from: data)
    }
}
