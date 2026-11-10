"use client";

import { useEffect, useRef, type ReactNode } from "react";

export default function ProposalDrawer({ open, onClose, children }: {
  open: boolean; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  return (
    <dialog ref={ref} aria-modal="true" aria-labelledby="proposal-drawer-title"
      className="proposal-drawer fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-[calc(100%-1rem)] max-w-3xl overflow-y-auto overscroll-contain border-0 bg-neutral-50 p-0 text-neutral-900 shadow-2xl backdrop:bg-neutral-950/40"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClose={onClose}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}>
      <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
        <h2 id="proposal-drawer-title" className="font-bold">代替案の取得・比較・採用</h2>
        <button type="button" onClick={onClose} autoFocus className="min-h-11 rounded-lg border border-neutral-300 px-3 text-sm font-semibold">ボードへ戻る</button>
      </div>
      {open && children}
    </dialog>
  );
}
