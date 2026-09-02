import Foundation

/// Gmail deep links for activity rows.
///
/// Every form was tested live against the real mailbox in a multi-account
/// Chrome profile:
/// - `?authuser=<email>#all/<id>` — BROKEN: Gmail redirects `/mail/?authuser=…`
///   to `/mail/u/0/`, dropping the fragment (threadId lost) and ignoring the
///   account hint.
/// - `/mail/u/<email>/#all/<id>` — BROKEN: 404s even with a live session for
///   that exact account.
/// - `/mail/u/<index>/#all/<hexThreadId>` — works (Gmail resolves the API's
///   hex thread id and rewrites it to its own token), but the session index
///   is unknowable to the app.
/// - `accounts.google.com/AccountChooser?Email=<email>&continue=<encoded
///   mail URL, fragment included>` — WORKS: resolves the account by email,
///   continues into the right `/u/<n>/`, fragment survives, conversation
///   opens. This is the form used below.
public enum GmailLinks {
    /// Strict set so `#` (fragment), `+` (common in Message-IDs, read as a
    /// space by query parsers), `@`, `/`, and `:` are all percent-encoded
    /// inside the `continue` value.
    private static let strictAllowed = CharacterSet.alphanumerics
        .union(CharacterSet(charactersIn: "-._~"))

    private static func viaAccountChooser(
        _ gmailURL: String, selfEmail: String
    ) -> URL? {
        guard !selfEmail.isEmpty else { return URL(string: gmailURL) }
        guard
            let email = selfEmail.addingPercentEncoding(
                withAllowedCharacters: strictAllowed),
            let target = gmailURL.addingPercentEncoding(
                withAllowedCharacters: strictAllowed)
        else { return nil }
        return URL(
            string:
                "https://accounts.google.com/AccountChooser?Email=\(email)&continue=\(target)"
        )
    }

    public static func inbox(selfEmail: String) -> URL? {
        viaAccountChooser("https://mail.google.com/mail/", selfEmail: selfEmail)
    }

    public static func thread(threadId: String, selfEmail: String) -> URL? {
        viaAccountChooser(
            "https://mail.google.com/mail/#all/\(threadId)",
            selfEmail: selfEmail)
    }

    public static func search(messageId: String, selfEmail: String) -> URL? {
        let bare = messageId.trimmingCharacters(in: CharacterSet(charactersIn: "<>"))
        return viaAccountChooser(
            "https://mail.google.com/mail/#search/rfc822msgid:\(bare)",
            selfEmail: selfEmail)
    }

    /// Preferred link for one feed row: thread first, message-id search as
    /// the fallback, nil for rows with neither (docs, reauth).
    public static func best(item: StatusFile.ActivityItem, selfEmail: String) -> URL? {
        if let t = item.threadId, !t.isEmpty {
            return thread(threadId: t, selfEmail: selfEmail)
        }
        if let m = item.messageId, !m.isEmpty {
            return search(messageId: m, selfEmail: selfEmail)
        }
        return nil
    }
}
