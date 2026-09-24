export type ViewMode = "edit" | "split" | "preview";

export type ThemeOption = "light" | "dark" | "system" | "tokyo-night" | "everforest";

export interface AppearanceTokens {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  border: string;
  borderWidth: number;
  codeBackground: string;
  selection: string;
  fontFamily: string;
  codeFontFamily: string;
  fontSize: number;
  lineHeight: number;
  padding: number;
  radius: number;
  shadow: string;
  opacity: number;
  backgroundImagePath?: string;
  imageBlur?: number;
}

export interface AppearanceConfig {
  version: 1;
  nativeMaterial?: boolean;
  global?: Partial<AppearanceTokens>;
  notes?: Record<string, Partial<AppearanceTokens>>;
}

export type TileColorMode = "system" | "custom";
export type BackgroundFit = "cover" | "contain" | "repeat";

export interface AppConfig {
  locale: string;
  dataDir: string;
  globalShortcut: string;
  mainShortcut: string;
  closeToTray: boolean;
  autostart: boolean;
  defaultViewMode: string;
  noteAutoSave: boolean;
  noteSurfaceAutoSave: boolean;
  tileColor: string;
  tileColorMode: TileColorMode;
  theme: ThemeOption;
  appearance?: AppearanceConfig;
  fontSize: number;
  surfaceFontSize: number;
  tabIndentSize: number;
  externalFileAutoSave: boolean;
  rememberSurfaceSize: boolean;
  tileCtrlClose: boolean;
  tileDoubleClickToEdit: boolean;
  tileSaveReturnsToPin: boolean;
  tileRenderMarkdown: boolean;
  renderHtmlMarkdown: boolean;
  allowRemoteImages: boolean;
  splitScrollSync: boolean;
  surfaceWidth?: number;
  surfaceHeight?: number;
  toggleVisibilityShortcut: string;
  openAtCursor: boolean;
  backgroundImagePath?: string;
  backgroundFit?: BackgroundFit;
  backgroundDim?: number;
  backgroundBlur?: number;
  backgroundScale?: number;
  backgroundPositionX?: number;
  backgroundPositionY?: number;
}
