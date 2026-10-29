import './qr.css';
import { useMemo } from 'preact/hooks';
import { encodePairingPayload } from './payload';
import { makeQr, matrixPath, QUIET_ZONE } from './render';

/** The pairing QR code as SVG drawn by Preact (no innerHTML, no style attributes). */
export function QrCode({ secret, signalingUrl }: { secret: string; signalingUrl?: string }) {
  const { size, path } = useMemo(() => {
    const m = makeQr(encodePairingPayload(secret, signalingUrl));
    return { size: m.size, path: matrixPath(m) };
  }, [secret, signalingUrl]);
  const full = size + QUIET_ZONE * 2;
  return (
    <svg class="qr-code" viewBox={`0 0 ${full} ${full}`} role="img" aria-label="QR code carrying the one-time code" shape-rendering="crispEdges">
      <rect width={full} height={full} fill="#ffffff" />
      <path transform={`translate(${QUIET_ZONE} ${QUIET_ZONE})`} d={path} fill="#000000" />
    </svg>
  );
}

/** A QR code for any short text, such as a share link (#259). */
export function TextQrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const m = makeQr(text);
    return { size: m.size, path: matrixPath(m) };
  }, [text]);
  const full = size + QUIET_ZONE * 2;
  return (
    <svg class="qr-code" viewBox={`0 0 ${full} ${full}`} role="img" aria-label={label} shape-rendering="crispEdges">
      <rect width={full} height={full} fill="#ffffff" />
      <path transform={`translate(${QUIET_ZONE} ${QUIET_ZONE})`} d={path} fill="#000000" />
    </svg>
  );
}
