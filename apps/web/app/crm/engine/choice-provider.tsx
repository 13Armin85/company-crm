import type { ReactNode } from "react";
import { ChoiceLabelsContext } from "../choice-label-context";
import { useEngineCatalog } from "./api";
const emptyChoices = { priority: [], task_status: [] };

export function BusinessChoicesProvider({ children }: { children: ReactNode }) {
  const { data } = useEngineCatalog();
  return (
    <ChoiceLabelsContext.Provider value={data?.choice_labels || emptyChoices}>{children}</ChoiceLabelsContext.Provider>
  );
}
