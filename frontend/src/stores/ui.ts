import { create } from 'zustand';

/** Client-only UI state. Server data lives in TanStack Query, never here. */
interface UiState {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
}));
