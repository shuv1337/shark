import Foundation

struct AuthorizationStart: Codable, Equatable {
    let deviceCode: String
    let userCode: String
    let verificationUri: URL
    let verificationUriComplete: URL
    let expiresIn: Int
    let interval: Int
}

struct AuthorizationToken: Codable, Equatable {
    let accessToken: String
}

struct MacDevice: Codable, Equatable {
    let id: String
    let platform: String
    let deviceName: String?
    let active: Bool
}

struct DeviceRegistrationResponse: Codable, Equatable {
    let device: MacDevice
}

struct InboxAction: Codable, Equatable {
    let interactionId: String
    let kind: String
    let choices: [String]
    let actionDigest: String
    let primaryLabel: String?
    let secondaryLabel: String?
    let expiresAt: Date
}

struct InboxItem: Codable, Equatable, Identifiable {
    let id: String
    let kind: String
    let sourceName: String
    let title: String
    let body: String
    let url: String?
    let status: String
    let result: String?
    let needsAction: Bool
    let readAt: Date?
    let occurredAt: Date
    let updatedAt: Date
    let action: InboxAction?
}

struct MacSnapshot: Codable, Equatable {
    let generatedAt: Date
    let items: [InboxItem]
    let unresolvedCount: Int
}

struct InteractionResponse: Codable, Equatable {
    let ok: Bool
    let status: String
    let snapshot: MacSnapshot
}

struct ServerErrorBody: Decodable {
    let error: String
    let interval: Int?
}

struct APIError: LocalizedError, Equatable {
    let statusCode: Int
    let code: String
    let retryInterval: Int?

    var errorDescription: String? {
        switch code {
        case "authorization_pending": "Waiting for approval."
        case "slow_down": "SHark asked this Mac to poll less often."
        case "access_denied": "Sign-in was denied."
        case "expired_token": "The setup code expired. Start again."
        case "Interaction is already terminal": "This request was already handled."
        default: code
        }
    }
}

enum CompanionAction: Equatable {
    case approve
    case deny
    case yes
    case no
    case reply(String)

    var apiValue: String {
        switch self {
        case .approve: "approve"
        case .deny: "deny"
        case .yes: "yes"
        case .no: "no"
        case .reply: "reply"
        }
    }

    var responseText: String? {
        if case .reply(let text) = self { text } else { nil }
    }
}

enum ISO8601Coding {
    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let standard = ISO8601DateFormatter()
            if let date = fractional.date(from: value) ?? standard.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO-8601 date"
            )
        }
        return decoder
    }

    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
