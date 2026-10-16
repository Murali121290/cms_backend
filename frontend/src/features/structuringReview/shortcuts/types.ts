export type ShortcutType = "paragraph" | "character";

export interface StyleShortcutItem {
  action: string;
  style: string | null;
  shortcut: string;
  label: string;
  type: ShortcutType;
  badgeColor?: string;
  cssClass?: string;
}

export interface ClientShortcutsMap {
  client_label: string;
  tagset: string;
  paragraph_shortcuts: StyleShortcutItem[];
  character_shortcuts: StyleShortcutItem[];
}

export interface AllClientsShortcutsConfig {
  [clientKey: string]: ClientShortcutsMap;
}
