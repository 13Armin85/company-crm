import { createContext } from "react";

export interface BusinessChoice {
  id: string;
  title: string;
  color: string;
  disabled: boolean;
}
export interface BusinessChoices {
  priority: BusinessChoice[];
  task_status: BusinessChoice[];
}
export const ChoiceLabelsContext = createContext<BusinessChoices>({ priority: [], task_status: [] });
