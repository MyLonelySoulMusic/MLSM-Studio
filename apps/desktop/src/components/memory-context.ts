import { createContext, useContext } from "react";

export interface MemoryStudioContextValue { open: boolean; show: () => void; close: () => void }
export const MemoryStudioContext = createContext<MemoryStudioContextValue>({ open: false, show: () => undefined, close: () => undefined });
export function useMemoryStudio() { return useContext(MemoryStudioContext); }
