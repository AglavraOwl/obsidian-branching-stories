// Minimal stand-in for the parts of Obsidian the plugin's rendering code touches.
export class ItemView {
  contentEl: HTMLElement = document.createElement("div");
  app: any = {
    vault: { getMarkdownFiles: () => [] },
    workspace: {
      getActiveFile: () => null,
      on: () => ({}),
      rightSplit: { collapse: () => undefined },
    },
  };
  constructor(public leaf: unknown) {}
  register(): void {}
  registerEvent(): void {}
}
export class TFile {}
export class Notice {
  constructor(public message: string) {}
}
export const Platform = { isPhone: false, isMobile: false };
export const setIcon = (el: HTMLElement, name: string): void => {
  el.setAttribute("data-icon", name);
};
export const normalizePath = (p: string): string => p;
export class Modal {
  contentEl: HTMLElement = document.createElement("div");
  modalEl: HTMLElement = document.createElement("div");
  constructor(public app: unknown) {}
  open(): void {}
  close(): void {}
  setTitle(): void {}
}
export class FuzzySuggestModal<T> extends Modal {
  setPlaceholder(): void {}
  getItems(): T[] {
    return [];
  }
}
export class Setting {
  constructor(public el: HTMLElement) {}
}
export class Plugin {}
export class PluginSettingTab {}
export class MarkdownView {}
export class SecretComponent {}
export const apiVersion = "test";
export const requestUrl = async (): Promise<never> => {
  throw new Error("not available in tests");
};
export const parseYaml = (): unknown => ({});
export const editorInfoField = {};
