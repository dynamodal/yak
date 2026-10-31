import { useEffect, useRef, useState } from 'preact/hooks';
import { lazyComponent } from '../app/lazy';
import { QUICK_ADD_EVENT } from './quick-add-request';

const Dialog = lazyComponent<{ onClose(): void }>(() => import('./QuickAddDialog').then((m) => ({ default: m.QuickAddDialog })));

/** Mounted always; the dialog's code loads the first time it opens. Focus goes back to where it was. */
export function QuickAddHost() {
  const [open, setOpen] = useState(false);
  const from = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onOpen = (): void => {
      if (!open) from.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    window.addEventListener(QUICK_ADD_EVENT, onOpen);
    return () => window.removeEventListener(QUICK_ADD_EVENT, onOpen);
  }, [open]);
  if (!open) return null;
  return (
    <Dialog
      onClose={() => {
        setOpen(false);
        const el = from.current;
        // After the dialog has gone, so the browser's own restore cannot win.
        setTimeout(() => el?.isConnected && el.focus(), 0);
      }}
    />
  );
}
