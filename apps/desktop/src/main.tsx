import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StudioExperience } from "./components/StudioExperience";
import { initializeUiPreferences } from "./services/ui-preferences";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Elemento root non trovato");
initializeUiPreferences();
createRoot(root).render(<StrictMode><StudioExperience /></StrictMode>);
