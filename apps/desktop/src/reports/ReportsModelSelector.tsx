import { useEffect, useState } from "react";
import { getLlmSettings, providerLabels, type LlmProvider, type LlmSettings } from "../services/studio-settings";
import type { UiLanguage } from "../services/ui-preferences";
import { loadReportsAiSettings, saveReportsAiSettings, type ReportsAiTask, type ReportsProvider } from "./reports-ai";

export function ReportsModelSelector({ task, language, disabled = false, value, onChange }: {
  task: ReportsAiTask; language: UiLanguage; disabled?: boolean;
  value?: ReportsProvider | ""; onChange?: (value: ReportsProvider | "") => void;
}) {
  const key = task === "formula" ? "formulaProvider" : "replicateProvider";
  const [selection, setSelection] = useState(() => { const saved = loadReportsAiSettings(); return saved[key] ?? saved.provider; });
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void getLlmSettings().then(settings => { if (active) setLlm(settings); }).catch(() => { if (active) setError(language === "en" ? "API settings unavailable. Local remains available." : "Impostazioni API non disponibili. Il modello locale resta selezionabile."); });
    const refresh = () => { const saved = loadReportsAiSettings(); setSelection(saved[key] ?? saved.provider); };
    window.addEventListener("mlsm:reports-ai-settings-changed", refresh);
    return () => { active = false; window.removeEventListener("mlsm:reports-ai-settings-changed", refresh); };
  }, [key, language]);
  const selected = value ?? selection;
  const configured = llm ? (Object.keys(llm.providers) as LlmProvider[]).filter(p => llm.providers[p].configured && llm.providers[p].enabled) : [];
  const missing = selected && selected !== "local" && !configured.includes(selected);
  return <label className="rpt-control" data-ui-copy>
    {language === "en" ? (task === "formula" ? "Calculated-field AI model" : "Report replication AI model") : (task === "formula" ? "Modello AI campi calcolati" : "Modello AI replica report")}
    <select disabled={disabled} value={selected} onChange={event => {
      const next = event.target.value as ReportsProvider | "";
      if (onChange) onChange(next);
      else { setSelection(next); saveReportsAiSettings({ ...loadReportsAiSettings(), [key]: next }); }
    }}>
      <option value="">{language === "en" ? "Use Studio selection" : "Usa selezione Studio"}</option>
      <option value="local">{language === "en" ? "Local" : "Locale"} · Qwen2.5 0.5B</option>
      {configured.map(p => <option key={p} value={p}>API · {providerLabels[p]} · {llm!.providers[p].model}</option>)}
      {missing && <option value={selected} disabled>{providerLabels[selected]} · {language === "en" ? "unavailable" : "non disponibile"}</option>}
    </select>
    {selected === "local" && <small>{language === "en" ? "Runs on this device. First use may download the model. Complex templates work best with a larger API model." : "Elaborazione sul dispositivo. Al primo uso può scaricare il modello. Per template complessi è consigliato un modello API più grande."}</small>}
    {error && <small role="status">{error}</small>}
  </label>;
}
