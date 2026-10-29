import { QrCode } from '../qr/QrCode';
import { Scanner } from '../qr/Scanner';
import type { PairingPayload } from '../qr/payload';

function grouped(secret: string): string {
  return secret.match(/.{1,4}/g)?.join('-') ?? secret;
}

/**
 * Devices page extras: the QR code of a one-time code, and a camera scanner that fills in the
 * one-time code (and the connection server, when the code names one) to join.
 */
export function PairingExtras(props: {
  secret: string | undefined;
  /** Connection server the new secret was made for; included in the QR code when not the default. */
  signaling?: string;
  /** Offer the camera scanner (only while this device is not paired). */
  scan?: boolean;
  onSecret(secret: string): void;
  onSignaling?(url: string): void;
  /** Join with the code now in the field; offered as a primary button once a scan succeeds. */
  onJoin?(): void;
  busy?: boolean;
}) {
  const onScanned = (p: PairingPayload): void => {
    props.onSecret(grouped(p.secret));
    if (p.signalingUrl) props.onSignaling?.(p.signalingUrl);
  };
  return (
    <>
      {props.secret && (
        <div class="qr-pair">
          <QrCode secret={props.secret} signalingUrl={props.signaling} />
          <p class="hint qr-note">
            Scan this with the new device instead of typing the one-time code. The QR code carries the code itself: do not
            photograph it or share it.
          </p>
        </div>
      )}
      {props.scan !== false && <Scanner onResult={onScanned} onJoin={props.onJoin} busy={props.busy} />}
    </>
  );
}
