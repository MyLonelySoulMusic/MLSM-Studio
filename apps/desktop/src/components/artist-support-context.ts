import { createContext, useContext } from "react";

export interface ArtistSupportContextValue {
  attention: boolean;
  open: boolean;
  show: () => void;
  close: () => void;
  acknowledge: () => void;
}

const fallbackSupport: ArtistSupportContextValue = {
  attention: false,
  open: false,
  show: () => undefined,
  close: () => undefined,
  acknowledge: () => undefined
};

export const ArtistSupportContext = createContext<ArtistSupportContextValue>(fallbackSupport);
export function useArtistSupport() { return useContext(ArtistSupportContext); }
