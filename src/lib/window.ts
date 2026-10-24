import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { inTauri } from "./ipc";

/** "main" for the main window, "reader-…" for a pop-out email window. */
export const windowLabel = (): string => (inTauri() ? getCurrentWebviewWindow().label : "main");
export const isReaderWindow = () => windowLabel().startsWith("reader-");
