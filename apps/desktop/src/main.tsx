import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { WelcomeSplash } from "./components/WelcomeSplash";
import { initializeUiPreferences } from "./services/ui-preferences";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Elemento root non trovato");
initializeUiPreferences();
createRoot(root).render(<StrictMode><App /><WelcomeSplash /></StrictMode>);
