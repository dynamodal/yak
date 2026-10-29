import { useState } from 'preact/hooks';
import { groupSecret, parseJoinInput } from '../qr';

/**
 * The one-time code field of a device that joins (option A+, #22). Typing a code works as before; pasting a join link or
 * the text of the QR code fills in the code (and the connection server, when the link names one). The code is shown in groups of four.
 */
export function JoinCodeInput(props: { value: string; onCode(code: string): void; onSignaling?(url: string): void; onEnter?(): void }) {
  const [note, setNote] = useState('');
  const change = (text: string, input?: HTMLInputElement): void => {
    setNote('');
    try {
      const p = parseJoinInput(text);
      if (p) {
        const code = groupSecret(p.secret);
        // The field shows the code even when it already held the same one (a controlled field keeps what was typed otherwise).
        if (input) input.value = code;
        props.onCode(code);
        if (p.signalingUrl) props.onSignaling?.(p.signalingUrl);
        setNote('Code taken from the link.');
        return;
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
    props.onCode(text);
  };
  return (
    <>
      <input
        aria-label="One-time code"
        placeholder="One-time code or link from your other device"
        value={props.value}
        size={36}
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        autocomplete="off"
        onInput={(e) => change((e.target as HTMLInputElement).value, e.target as HTMLInputElement)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && props.value.trim()) props.onEnter?.();
        }}
      />
      {note ? (
        <span class="hint" role="status">
          {note}
        </span>
      ) : null}
    </>
  );
}
