// Web build: a plain text field (the end-to-end test types into it).

import { useApp } from "../lib/context";
import { Field } from "./kit";

export function DateField({ value, onChange, testID }: { value: string; onChange: (date: string) => void; testID?: string }) {
  const { t } = useApp();
  return <Field testID={testID} label={t("taskDueDate")} value={value} onChangeText={onChange} keyboardType="numbers-and-punctuation" placeholder="DD/MM/AAAA" />;
}
