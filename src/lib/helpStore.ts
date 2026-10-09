import { create } from 'zustand';

// Open state of the per-page help modal. Shared so a page can open the same
// dialog the header's help button does (e.g. the Tasks page's shortcut strip).
interface HelpState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useHelp = create<HelpState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
