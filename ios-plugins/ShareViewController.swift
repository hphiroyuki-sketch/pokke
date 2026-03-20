// ShareViewController.swift
// iOS Share Extension for Pokke
// Receives shared URLs from other apps (Safari, Instagram, etc.)
// and forwards them to the main Pokke app.
//
// SETUP INSTRUCTIONS:
// 1. In Xcode: File > New > Target > Share Extension
// 2. Name it "PokkeShare"
// 3. Replace the generated ShareViewController.swift with this file
// 4. Set App Group: group.com.pokke.app (in both main app and extension)
// 5. Set Info.plist NSExtensionActivationRule to allow URLs

import UIKit
import Social
import MobileCoreServices
import UniformTypeIdentifiers

class ShareViewController: UIViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        handleSharedContent()
    }

    private func handleSharedContent() {
        guard let extensionItems = extensionContext?.inputItems as? [NSExtensionItem] else {
            close()
            return
        }

        for item in extensionItems {
            guard let attachments = item.attachments else { continue }

            for attachment in attachments {
                // Handle URLs
                if attachment.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    attachment.loadItem(forTypeIdentifier: UTType.url.identifier) { [weak self] item, _ in
                        if let url = item as? URL {
                            self?.openMainApp(with: url.absoluteString)
                        }
                    }
                    return
                }

                // Handle plain text (might contain URL)
                if attachment.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    attachment.loadItem(forTypeIdentifier: UTType.plainText.identifier) { [weak self] item, _ in
                        if let text = item as? String {
                            // Extract URL from text
                            if let urlRange = text.range(of: "https?://[^\\s]+", options: .regularExpression) {
                                let url = String(text[urlRange])
                                self?.openMainApp(with: url)
                            } else {
                                self?.openMainApp(with: text)
                            }
                        }
                    }
                    return
                }
            }
        }

        close()
    }

    private func openMainApp(with urlString: String) {
        // Save to UserDefaults shared via App Group
        let defaults = UserDefaults(suiteName: "group.com.pokke.app")
        defaults?.set(urlString, forKey: "sharedURL")
        defaults?.synchronize()

        // Open main app via custom URL scheme
        let encodedUrl = urlString.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? urlString
        if let appURL = URL(string: "pokke://share?url=\(encodedUrl)") {
            // Use openURL via responder chain (Share Extension can't use UIApplication.shared)
            var responder: UIResponder? = self
            while let r = responder {
                if let application = r as? UIApplication {
                    application.open(appURL, options: [:], completionHandler: nil)
                    break
                }
                responder = r.next
            }
        }

        // Give time for the URL scheme to process, then close
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.close()
        }
    }

    private func close() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
