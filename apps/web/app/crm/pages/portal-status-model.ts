import type { PortalLabel, PortalSettingsDoc } from "../api/portal";

export function nextPortalLabelCode(labels: PortalLabel[]): string {
  const codes = new Set(labels.map((label) => label.code));
  let index = 1;
  while (codes.has(`custom_${index}`)) index += 1;
  return `custom_${index}`;
}

export function isPortalLabelUsed(doc: PortalSettingsDoc, code: string): boolean {
  return (
    doc.default_label === code ||
    Object.values(doc.status_map).includes(code) ||
    Object.values(doc.stage_labels).includes(code)
  );
}
