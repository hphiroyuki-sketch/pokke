// NativeNFCPlugin.swift
// Capacitor plugin for CoreNFC on iOS
// Place this file in ios/App/App/ after running `npx cap add ios`

import Foundation
import Capacitor
import CoreNFC

@objc(NativeNFCPlugin)
public class NativeNFCPlugin: CAPPlugin, NFCNDEFReaderSessionDelegate, CAPBridgedPlugin {
    public let identifier = "NativeNFCPlugin"
    public let jsName = "NativeNFC"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
    ]

    private var session: NFCNDEFReaderSession?
    private var savedCall: CAPPluginCall?

    // MARK: - Plugin Methods

    @objc func isAvailable(_ call: CAPPluginCall) {
        let available = NFCNDEFReaderSession.readingAvailable
        call.resolve(["available": available])
    }

    @objc func scan(_ call: CAPPluginCall) {
        guard NFCNDEFReaderSession.readingAvailable else {
            call.reject("NFC is not available on this device")
            return
        }

        savedCall = call
        let message = call.getString("message") ?? "NFCカードをかざしてください"

        DispatchQueue.main.async {
            self.session = NFCNDEFReaderSession(
                delegate: self,
                queue: nil,
                invalidateAfterFirstRead: true
            )
            self.session?.alertMessage = message
            self.session?.begin()
        }
    }

    // MARK: - NFCNDEFReaderSessionDelegate

    public func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        for message in messages {
            for record in message.records {
                if let url = extractURL(from: record) {
                    savedCall?.resolve([
                        "url": url,
                        "text": url,
                    ])
                    savedCall = nil
                    return
                }
            }
            // If no URL found, try raw text
            if let firstRecord = message.records.first {
                let text = String(data: firstRecord.payload, encoding: .utf8) ?? ""
                savedCall?.resolve([
                    "url": "",
                    "text": text,
                ])
                savedCall = nil
                return
            }
        }
        savedCall?.reject("No data found on NFC tag")
        savedCall = nil
    }

    public func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        if let nfcError = error as? NFCReaderError,
           nfcError.code == .readerSessionInvalidationErrorUserCanceled {
            savedCall?.reject("User cancelled NFC scan")
        } else {
            savedCall?.reject("NFC error: \(error.localizedDescription)")
        }
        savedCall = nil
    }

    // MARK: - URL Extraction

    private func extractURL(from record: NFCNDEFPayload) -> String? {
        // Try well-known URI record
        if record.typeNameFormat == .nfcWellKnown {
            if let type = String(data: record.type, encoding: .utf8) {
                if type == "U" {
                    // URI record: first byte is prefix index
                    let prefixes = [
                        "", "http://www.", "https://www.", "http://", "https://",
                        "tel:", "mailto:", "ftp://anonymous:anonymous@", "ftp://ftp.",
                        "ftps://", "sftp://", "smb://", "nfs://", "ftp://", "dav://",
                        "news:", "telnet://", "imap:", "rtsp://", "urn:", "pop:",
                        "sip:", "sips:", "tftp:", "btspp://", "btl2cap://", "btgoep://",
                        "tcpobex://", "irdaobex://", "file://", "urn:epc:id:", "urn:epc:tag:",
                        "urn:epc:pat:", "urn:epc:raw:", "urn:epc:", "urn:nfc:"
                    ]

                    let payload = record.payload
                    guard payload.count > 0 else { return nil }
                    let prefixIndex = Int(payload[0])
                    let rest = String(data: payload.dropFirst(), encoding: .utf8) ?? ""
                    let prefix = prefixIndex < prefixes.count ? prefixes[prefixIndex] : ""
                    let url = prefix + rest
                    if url.hasPrefix("http") { return url }
                }
            }
        }

        // Try absolute URI
        if record.typeNameFormat == .absoluteURI {
            if let url = String(data: record.type, encoding: .utf8), url.hasPrefix("http") {
                return url
            }
        }

        // Try to find URL in payload text
        if let text = String(data: record.payload, encoding: .utf8) {
            if let range = text.range(of: "https?://[^\\s]+", options: .regularExpression) {
                return String(text[range])
            }
        }

        return nil
    }
}
