import { useEffect, useState } from "react";
import { companionSettings, type CompanionSettings } from "./companion-settings";

export function useCompanionSettings(): CompanionSettings {
  const [value, setValue] = useState<CompanionSettings>(companionSettings.get());
  useEffect(() => companionSettings.subscribe(setValue), []);
  return value;
}
