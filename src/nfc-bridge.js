// Native NFC Bridge for Capacitor (iOS CoreNFC)
// Provides a unified API that works both in Web NFC mode (Android Chrome)
// and native CoreNFC mode (iOS via Capacitor plugin).

import { Capacitor, registerPlugin } from '@capacitor/core';

// Register native NFC plugin (will be implemented in Swift)
const NativeNFC = registerPlugin('NativeNFC');

/**
 * Check if we're running as a native iOS app
 */
export function isNative() {
  return Capacitor.isNativePlatform();
}

/**
 * Check if NFC is available
 * - Native iOS: CoreNFC (iPhone 7+)
 * - Web: NDEFReader API (Android Chrome 89+)
 */
export async function isNFCAvailable() {
  if (isNative()) {
    try {
      const result = await NativeNFC.isAvailable();
      return result.available;
    } catch {
      return false;
    }
  }
  return 'NDEFReader' in window;
}

/**
 * Start NFC scan
 * @param {Object} options
 * @param {Function} options.onRead - Callback with { url: string } when tag is read
 * @param {Function} options.onError - Callback with { message: string } on error
 * @returns {Function} cancel - Call to stop scanning
 */
export function startNFCScan({ onRead, onError }) {
  if (isNative()) {
    return startNativeNFCScan({ onRead, onError });
  }
  return startWebNFCScan({ onRead, onError });
}

// ---- Native iOS NFC (CoreNFC) ----
function startNativeNFCScan({ onRead, onError }) {
  let cancelled = false;

  (async () => {
    try {
      const result = await NativeNFC.scan({
        message: 'NFCカードをかざしてください',
      });
      if (!cancelled && result.url) {
        onRead({ url: result.url });
      } else if (!cancelled && result.text) {
        // Try to extract URL from text
        const m = result.text.match(/https?:\/\/[^\s]+/);
        if (m) {
          onRead({ url: m[0] });
        } else {
          onError({ message: 'URLが見つかりませんでした' });
        }
      }
    } catch (e) {
      if (!cancelled) {
        onError({ message: e.message || 'NFC読み取りエラー' });
      }
    }
  })();

  return () => { cancelled = true; };
}

// ---- Web NFC (Android Chrome) ----

const NDEF_URI_PREFIXES = [
  '', 'http://www.', 'https://www.', 'http://', 'https://',
  'tel:', 'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.',
  'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://',
  'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:',
  'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://',
  'tcpobex://', 'irdaobex://', 'file://', 'urn:epc:id:', 'urn:epc:tag:',
  'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:',
];

function extractNFCUrl(record) {
  if (record.recordType === 'url') {
    return new TextDecoder().decode(record.data);
  }
  if (record.recordType === 'uri' || record.recordType === 'U') {
    const bytes = new Uint8Array(record.data.buffer || record.data);
    const prefixIndex = bytes[0];
    const rest = new TextDecoder().decode(bytes.slice(1));
    return (NDEF_URI_PREFIXES[prefixIndex] || '') + rest;
  }
  if (record.recordType === 'smart-poster' || record.recordType === 'text') {
    const text = new TextDecoder().decode(record.data);
    const m = text.match(/https?:\/\/[^\s]+/);
    if (m) return m[0];
  }
  try {
    const text = new TextDecoder().decode(record.data);
    if (text.startsWith('http')) return text;
    const m = text.match(/https?:\/\/[^\s]+/);
    if (m) return m[0];
  } catch {}
  return null;
}

function startWebNFCScan({ onRead, onError }) {
  const abort = new AbortController();

  (async () => {
    try {
      const ndef = new window.NDEFReader();
      await ndef.scan({ signal: abort.signal });

      ndef.addEventListener('reading', ({ message }) => {
        for (const record of message.records) {
          const url = extractNFCUrl(record);
          if (url && url.startsWith('http')) {
            abort.abort();
            onRead({ url });
            return;
          }
        }
        if (message.records.length > 0) {
          try {
            const t = new TextDecoder().decode(message.records[0].data);
            if (t) { onRead({ url: t }); return; }
          } catch {}
        }
        onError({ message: 'URLが見つかりませんでした。もう一度タッチしてください。' });
      });

      ndef.addEventListener('readingerror', () => {
        onError({ message: '読み取りエラー。もう一度タッチしてください。' });
      });
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        onError({ message: 'NFC許可が必要です。ブラウザ設定を確認してください。' });
      } else {
        onError({ message: 'NFCエラー: ' + e.message });
      }
    }
  })();

  return () => { abort.abort(); };
}
