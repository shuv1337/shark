import Foundation
import Security

struct TokenVault {
    var read: @Sendable () -> String?
    var write: @Sendable (_ value: String) -> Void
    var delete: @Sendable () -> Void
}

extension TokenVault {
    static let live = TokenVault(
        read: { KeychainVault.read() },
        write: { KeychainVault.write($0) },
        delete: { KeychainVault.delete() }
    )
}

private enum KeychainVault {
    static let service = "dev.shuv.shark.macos"
    static let account = "access-token"

    static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard
            SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
            let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String) {
        delete()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    static func delete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
