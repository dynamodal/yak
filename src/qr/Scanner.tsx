import './qr.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '../app/ui';
import type { PairingPayload } from './payload';
import { cameraSupported, ScanError, startScan, type ScanHandle } from './scanner';

/** "Scan a QR code" button and camera preview. Calls onResult once, then closes the camera. */
export function Scanner({ onResult, onJoin, busy }: { onResult(p: PairingPayload): void; onJoin?(): void; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState(false);
  const joinButton = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const handle = useRef<ScanHandle | undefined>(undefined);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMessage('Starting the camera…');
    const el = video.current;
    if (!el) return;
    startScan(el, {
      onPayload: (p) => {
        setOpen(false);
        setFound(true);
        setMessage('');
        onResultRef.current(p);
      },
      onIgnored: (m) => setMessage(m),
    }).then(
      (h) => {
        if (cancelled) h.stop();
        else {
          handle.current = h;
          setMessage('Point the camera at the QR code on the other device.');
        }
      },
      (e: unknown) => {
        if (cancelled) return;
        setOpen(false);
        setMessage(e instanceof ScanError ? e.message : 'Could not start the camera.');
      },
    );
    return () => {
      cancelled = true;
      handle.current?.stop();
      handle.current = undefined;
    };
  }, [open]);

  // Bring the join button to where the person is looking: the scanner closed and the code field may be off screen.
  useEffect(() => {
    if (!found) return;
    joinButton.current?.scrollIntoView?.({ block: 'center' });
    joinButton.current?.focus();
  }, [found]);

  if (!cameraSupported()) return <p class="hint">This browser cannot scan QR codes here; type the one-time code instead.</p>;
  return (
    <div class="qr-scan">
      {found && !open && onJoin ? (
        <div class="row qr-found">
          <p class="hint" role="status">
            Code found
          </p>
          <Button variant="primary" buttonRef={joinButton} disabled={busy} onClick={onJoin}>
            Join this account
          </Button>
          <Button
            onClick={() => {
              setFound(false);
              setOpen(true);
            }}
          >
            Scan again
          </Button>
        </div>
      ) : (
        <div class="row">
          <Button
            onClick={() => {
              setFound(false);
              setOpen(!open);
            }}
          >
            {open ? 'Cancel scanning' : 'Scan a QR code'}
          </Button>
        </div>
      )}
      {open && <video ref={video} class="qr-video" playsInline muted aria-label="Camera preview" />}
      {message ? (
        <p class="hint" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
