import { is } from "@electron-toolkit/utils";
import { isStaging } from "@main/constants";
import { db, gamesSublevel, levelKeys } from "@main/level";
import icon from "@resources/icon.png?asset";
import trayIconDark from "@resources/tray-icon-dark.png?asset";
import trayIcon from "@resources/tray-icon.png?asset";
import {
  AUTH_WINDOW_CONTENT_HEIGHT,
  AUTH_WINDOW_CONTENT_WIDTH,
  AuthPage,
  CUSTOM_WINDOW_BORDER_WIDTH,
  CUSTOM_WINDOW_TITLE_BAR_HEIGHT,
} from "@shared";
import type { ScreenState, UserPreferences } from "@types";
import {
  BrowserWindow,
  Menu,
  MenuItem,
  MenuItemConstructorOptions,
  Tray,
  WebContentsView,
  app,
  nativeImage,
  nativeTheme,
  screen,
  shell,
} from "electron";
import { t } from "i18next";
import { orderBy } from "lodash-es";
import path from "node:path";
import UserAgent from "user-agents";
import { HydraApi } from "./hydra-api";
import { logger } from "./logger";
import {
  addSteamGridDbCacheControl,
  isSteamGridDbArtworkRequest,
} from "./steam-grid-db-cache";

const isLinuxWayland =
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE === "wayland" ||
    Boolean(process.env.WAYLAND_DISPLAY));

export class WindowManager {
  private static mainWindowInstance: Electron.BrowserWindow | null = null;
  private static gameLauncherWindowInstance: Electron.BrowserWindow | null =
    null;
  private static authWindow: Electron.BrowserWindow | null = null;

  private static isArtworkRendererRequest(
    webContentsId: number | undefined
  ): boolean {
    const window = this.mainWindow;

    return (
      window != null &&
      !window.isDestroyed() &&
      window.webContents.id === webContentsId
    );
  }

  public static get mainWindow(): Electron.BrowserWindow | null {
    return this.mainWindowInstance;
  }

  public static get gameLauncherWindow(): Electron.BrowserWindow | null {
    return this.gameLauncherWindowInstance;
  }

  public static clearMainWindow(): void {
    this.mainWindowInstance = null;
  }

  private static readonly DEFAULT_WINDOW_WIDTH = 1200;
  private static readonly DEFAULT_WINDOW_HEIGHT = 860;
  private static readonly MIN_WINDOW_WIDTH = 1024;
  private static readonly MIN_WINDOW_HEIGHT = 600;

  private static initialConfigInitializationMainWindow: Electron.BrowserWindowConstructorOptions =
    {
      width: WindowManager.DEFAULT_WINDOW_WIDTH,
      height: WindowManager.DEFAULT_WINDOW_HEIGHT,
      minWidth: WindowManager.MIN_WINDOW_WIDTH,
      minHeight: WindowManager.MIN_WINDOW_HEIGHT,
      icon,
      trafficLightPosition: { x: 16, y: 16 },
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
      show: false,
      ...(process.platform === "linux"
        ? {
            frame: false,
            ...(isLinuxWayland
              ? { transparent: true, backgroundColor: "#00000000" }
              : { backgroundColor: "#1c1c1c" }),
          }
        : {
            backgroundColor: "#1c1c1c",
            titleBarStyle: "hidden",
            titleBarOverlay: {
              symbolColor: "#DADBE1",
              color: "#00000000",
              height: 34,
            },
          }),
    };

  private static formatVersionNumber(version: string) {
    return version.replaceAll(".", "-");
  }

  public static async loadWindowURL(window: BrowserWindow, hash: string = "") {
    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}#/${hash}`);
    } else if (import.meta.env.MAIN_VITE_LAUNCHER_SUBDOMAIN) {
      // Try to load from remote URL in production
      try {
        await window.loadURL(
          `https://release-v${this.formatVersionNumber(app.getVersion())}.${import.meta.env.MAIN_VITE_LAUNCHER_SUBDOMAIN}#/${hash}`
        );
      } catch (error) {
        // Fall back to local file if remote URL fails
        logger.error(
          "Failed to load from MAIN_VITE_LAUNCHER_SUBDOMAIN, falling back to local file:",
          error
        );
        window.loadFile(path.join(__dirname, "../renderer/index.html"), {
          hash,
        });
      }
    } else {
      window.loadFile(path.join(__dirname, "../renderer/index.html"), {
        hash,
      });
    }
  }

  private static async loadMainWindowURL(hash: string = "") {
    if (this.mainWindow) {
      await this.loadWindowURL(this.mainWindow, hash);
    }
  }

  public static sendToAppWindows(channel: string, ...args: unknown[]) {
    const windows = [this.mainWindow];

    for (const window of windows) {
      if (!window || window.isDestroyed()) continue;
      window.webContents.send(channel, ...args);
    }
  }

  public static sendDownloadsUpdated() {
    this.sendToAppWindows("on-downloads-updated");
  }

  private static async saveScreenConfig(configScreenWhenClosed: ScreenState) {
    await db.put(levelKeys.screenState, configScreenWhenClosed, {
      valueEncoding: "json",
    });
  }

  private static async loadScreenConfig() {
    const data = await db.get<string, ScreenState | undefined>(
      levelKeys.screenState,
      {
        valueEncoding: "json",
      }
    );
    return (
      data ?? {
        isMaximized: false,
        height: this.DEFAULT_WINDOW_HEIGHT,
        width: this.DEFAULT_WINDOW_WIDTH,
      }
    );
  }

  private static fitToWorkArea<
    T extends { x?: number; y?: number; width?: number; height?: number },
  >(bounds: T) {
    const savedWidth = bounds.width ?? this.DEFAULT_WINDOW_WIDTH;
    const savedHeight = bounds.height ?? this.DEFAULT_WINDOW_HEIGHT;
    const savedX = bounds.x;
    const savedY = bounds.y;
    const hasSavedPosition = savedX !== undefined && savedY !== undefined;

    const { workArea } = hasSavedPosition
      ? screen.getDisplayMatching({
          x: savedX,
          y: savedY,
          width: savedWidth,
          height: savedHeight,
        })
      : screen.getPrimaryDisplay();

    const minWidth = Math.min(this.MIN_WINDOW_WIDTH, workArea.width);
    const minHeight = Math.min(this.MIN_WINDOW_HEIGHT, workArea.height);

    const width = Math.max(minWidth, Math.min(savedWidth, workArea.width));
    const height = Math.max(minHeight, Math.min(savedHeight, workArea.height));

    if (!hasSavedPosition) {
      return { ...bounds, minWidth, minHeight, width, height };
    }

    const maxX = Math.max(workArea.x, workArea.x + workArea.width - width);
    const maxY = Math.max(workArea.y, workArea.y + workArea.height - height);

    return {
      ...bounds,
      minWidth,
      minHeight,
      width,
      height,
      x: Math.min(Math.max(savedX, workArea.x), maxX),
      y: Math.min(Math.max(savedY, workArea.y), maxY),
    };
  }

  private static updateInitialConfig(
    newConfig: Partial<Electron.BrowserWindowConstructorOptions>
  ) {
    this.initialConfigInitializationMainWindow = {
      ...this.initialConfigInitializationMainWindow,
      ...newConfig,
    };
  }

  public static async createMainWindow() {
    if (this.mainWindow) return;

    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    const { isMaximized = false, ...configWithoutMaximized } =
      await this.loadScreenConfig();

    this.updateInitialConfig(this.fitToWorkArea(configWithoutMaximized));

    const mainWindow = new BrowserWindow(
      this.initialConfigInitializationMainWindow
    );
    this.mainWindowInstance = mainWindow;

    const emitMaximizeState = () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          "on-window-maximize-change",
          mainWindow.isMaximized()
        );
      }
    };
    mainWindow.on("maximize", emitMaximizeState);
    mainWindow.on("unmaximize", emitMaximizeState);

    if (isMaximized) {
      mainWindow.maximize();
    }

    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      (details, callback) => {
        if (!this.isArtworkRendererRequest(details.webContentsId)) {
          return callback(details);
        }

        const userAgent = new UserAgent();

        callback({
          requestHeaders: {
            ...details.requestHeaders,
            "user-agent": userAgent.toString(),
          },
        });
      }
    );

    mainWindow.webContents.session.webRequest.onHeadersReceived(
      (details, callback) => {
        const isArtworkRendererRequest = this.isArtworkRendererRequest(
          details.webContentsId
        );
        const responseHeaders =
          isArtworkRendererRequest && isSteamGridDbArtworkRequest(details)
            ? addSteamGridDbCacheControl(details.responseHeaders)
            : details.responseHeaders;

        if (!isArtworkRendererRequest) {
          return callback({ ...details, responseHeaders });
        }

        const headers = {
          "access-control-allow-origin": ["*"],
          "access-control-allow-methods": ["GET, POST, PUT, DELETE, OPTIONS"],
          "access-control-expose-headers": ["ETag"],
          "access-control-allow-headers": [
            "Content-Type, Authorization, X-Requested-With, If-None-Match",
          ],
        };
        if (details.method === "OPTIONS") {
          return callback({
            cancel: false,
            responseHeaders: {
              ...responseHeaders,
              ...headers,
            },
            statusLine: "HTTP/1.1 200 OK",
          });
        }

        return callback({
          responseHeaders: {
            ...responseHeaders,
            ...headers,
          },
        });
      }
    );

    const initialHash = userPreferences?.launchToLibraryPage ? "library" : "";

    this.loadMainWindowURL(initialHash);
    mainWindow.removeMenu();

    mainWindow.on("ready-to-show", () => {
      if (!app.isPackaged || isStaging)
        WindowManager.mainWindow?.webContents.openDevTools();
      WindowManager.mainWindow?.show();
    });

    mainWindow.on("close", async () => {
      this.mainWindowInstance = null;

      const userPreferences = await db.get<string, UserPreferences>(
        levelKeys.userPreferences,
        {
          valueEncoding: "json",
        }
      );

      mainWindow.setProgressBar(-1);

      const lastBounds = mainWindow.getBounds();
      const isMaximized = mainWindow.isMaximized() ?? false;
      const screenConfig = isMaximized
        ? {
            x: undefined,
            y: undefined,
            height:
              this.initialConfigInitializationMainWindow.height ??
              this.DEFAULT_WINDOW_HEIGHT,
            width:
              this.initialConfigInitializationMainWindow.width ??
              this.DEFAULT_WINDOW_WIDTH,
            isMaximized: true,
          }
        : { ...lastBounds, isMaximized };

      await this.saveScreenConfig(screenConfig);

      if (userPreferences?.preferQuitInsteadOfHiding) {
        app.quit();
      }
    });

    mainWindow.webContents.setWindowOpenHandler((handler) => {
      shell.openExternal(handler.url);
      return { action: "deny" };
    });
  }

  public static minimizeMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.minimize();
    }
  }

  public static toggleMaximizeMainWindow() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    if (this.mainWindow.isMaximized()) {
      this.mainWindow.unmaximize();
    } else {
      this.mainWindow.maximize();
    }
  }

  public static closeMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.close();
    }
  }

  public static isMainWindowMaximized() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return false;
    return this.mainWindow.isMaximized();
  }

  private static focusMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.show();
      this.mainWindow.focus();
    } else {
      this.createMainWindow();
    }
  }

  public static focusMainWindowAndNavigate(path: string) {
    this.focusMainWindow();
    this.mainWindow?.webContents.send("on-navigate", path);
  }

  private static bindAuthNavigation(
    contents: Electron.WebContents,
    closeWindow: () => void
  ) {
    contents.on("will-navigate", (_event, url) => {
      if (url.startsWith("hydralauncher://auth")) {
        closeWindow();

        HydraApi.handleExternalAuth(url);
        return;
      }

      if (url.startsWith("hydralauncher://update-account")) {
        closeWindow();

        WindowManager.sendToAppWindows("on-account-updated");
      }
    });
  }

  public static openAuthWindow(page: AuthPage, searchParams: URLSearchParams) {
    const parentWindow = this.mainWindow;

    if (!parentWindow || parentWindow.isDestroyed()) return;

    const authUrl = `${import.meta.env.MAIN_VITE_AUTH_URL}${page}?${searchParams.toString()}`;

    if (process.platform === "linux") {
      this.openLinuxAuthWindow(parentWindow, authUrl);
      return;
    }

    const authWindow = new BrowserWindow({
      width: AUTH_WINDOW_CONTENT_WIDTH,
      height: AUTH_WINDOW_CONTENT_HEIGHT,
      backgroundColor: "#1c1c1c",
      parent: parentWindow,
      modal: true,
      show: false,
      maximizable: false,
      resizable: false,
      minimizable: false,
      webPreferences: {
        sandbox: false,
        nodeIntegrationInSubFrames: true,
      },
    });

    authWindow.removeMenu();

    if (!app.isPackaged) authWindow.webContents.openDevTools();

    authWindow.loadURL(authUrl);

    authWindow.once("ready-to-show", () => {
      authWindow.show();
    });

    authWindow.once("closed", () => {
      if (!parentWindow.isDestroyed()) {
        parentWindow.focus();
      }
    });

    this.bindAuthNavigation(authWindow.webContents, () => authWindow.close());
  }

  private static openLinuxAuthWindow(
    parentWindow: Electron.BrowserWindow,
    authUrl: string
  ) {
    const authWindow = new BrowserWindow({
      width: AUTH_WINDOW_CONTENT_WIDTH + CUSTOM_WINDOW_BORDER_WIDTH * 2,
      height:
        AUTH_WINDOW_CONTENT_HEIGHT +
        CUSTOM_WINDOW_TITLE_BAR_HEIGHT +
        CUSTOM_WINDOW_BORDER_WIDTH * 2,
      parent: parentWindow,
      modal: true,
      show: false,
      maximizable: false,
      resizable: false,
      frame: false,
      icon,
      backgroundColor: "#1c1c1c",
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
    });

    this.authWindow = authWindow;

    authWindow.removeMenu();

    const authView = new WebContentsView({
      webPreferences: {
        sandbox: false,
        nodeIntegrationInSubFrames: true,
      },
    });

    authWindow.contentView.addChildView(authView);
    authView.setBounds({
      x: CUSTOM_WINDOW_BORDER_WIDTH,
      y: CUSTOM_WINDOW_BORDER_WIDTH + CUSTOM_WINDOW_TITLE_BAR_HEIGHT,
      width: AUTH_WINDOW_CONTENT_WIDTH,
      height: AUTH_WINDOW_CONTENT_HEIGHT,
    });

    this.loadWindowURL(authWindow, "auth-window");
    authView.webContents.loadURL(authUrl);

    if (!app.isPackaged) authView.webContents.openDevTools();

    authWindow.once("ready-to-show", () => {
      authWindow.show();
    });

    authWindow.once("closed", () => {
      this.authWindow = null;
      if (!parentWindow.isDestroyed()) {
        parentWindow.focus();
      }
    });

    this.bindAuthNavigation(authView.webContents, () => {
      if (!authWindow.isDestroyed()) authWindow.close();
    });
  }

  public static minimizeAuthWindow() {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.minimize();
    }
  }

  public static closeAuthWindow() {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.close();
    }
  }

  private static readonly GAME_LAUNCHER_WINDOW_WIDTH = 550;
  private static readonly GAME_LAUNCHER_WINDOW_HEIGHT = 320;

  public static async createGameLauncherWindow(shop: string, objectId: string) {
    if (this.gameLauncherWindow) {
      this.gameLauncherWindow.close();
      this.gameLauncherWindowInstance = null;
    }

    const display = screen.getPrimaryDisplay();
    const { width: displayWidth, height: displayHeight } = display.bounds;

    const x = Math.round((displayWidth - this.GAME_LAUNCHER_WINDOW_WIDTH) / 2);
    const y = Math.round(
      (displayHeight - this.GAME_LAUNCHER_WINDOW_HEIGHT) / 2
    );

    const gameLauncherWindow = new BrowserWindow({
      width: this.GAME_LAUNCHER_WINDOW_WIDTH,
      height: this.GAME_LAUNCHER_WINDOW_HEIGHT,
      x,
      y,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      frame: false,
      backgroundColor: "#1c1c1c",
      icon,
      skipTaskbar: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
      show: false,
    });
    this.gameLauncherWindowInstance = gameLauncherWindow;

    gameLauncherWindow.removeMenu();

    this.loadWindowURL(
      gameLauncherWindow,
      `game-launcher?shop=${shop}&objectId=${objectId}`
    );

    gameLauncherWindow.on("closed", () => {
      this.gameLauncherWindowInstance = null;
    });

    if (!app.isPackaged || isStaging) {
      gameLauncherWindow.webContents.openDevTools();
    }
  }

  public static showGameLauncherWindow() {
    if (this.gameLauncherWindow && !this.gameLauncherWindow.isDestroyed()) {
      this.gameLauncherWindow.show();
    }
  }

  public static closeGameLauncherWindow() {
    if (this.gameLauncherWindow) {
      this.gameLauncherWindow.close();
      this.gameLauncherWindowInstance = null;
    }
  }

  public static openMainWindow() {
    if (this.mainWindow) {
      this.mainWindow.show();
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.focus();
    } else {
      this.createMainWindow();
    }
  }

  public static redirect(hash: string) {
    if (!this.mainWindow) this.createMainWindow();
    this.loadMainWindowURL(hash);

    if (this.mainWindow?.isMinimized()) this.mainWindow.restore();
    this.mainWindow?.focus();
  }

  public static redirectToMainWindow(hash: string) {
    this.redirect(hash);

    this.openMainWindow();
  }

  public static redirectToGameWindow(hash: string) {
    this.redirectToMainWindow(hash);
  }

  public static async createSystemTray(language: string) {
    let tray: Tray;

    if (process.platform === "darwin") {
      const macIcon = nativeImage
        .createFromPath(trayIcon)
        .resize({ width: 24, height: 24 });
      tray = new Tray(macIcon);
    } else if (process.platform === "win32") {
      const getWindowsTrayIcon = () =>
        nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
          ? trayIcon
          : trayIconDark;

      tray = new Tray(getWindowsTrayIcon());

      nativeTheme.on("updated", () => {
        tray.setImage(getWindowsTrayIcon());
      });
    } else {
      tray = new Tray(trayIcon);
    }

    const updateSystemTray = async () => {
      const games = await gamesSublevel
        .values()
        .all()
        .then((games) => {
          const filteredGames = games.filter(
            (game) =>
              !game.isDeleted && game.executablePath && game.lastTimePlayed
          );

          const sortedGames = orderBy(filteredGames, "lastTimePlayed", "desc");

          return sortedGames.slice(0, 6);
        });

      const recentlyPlayedGames: Array<MenuItemConstructorOptions | MenuItem> =
        games.map(({ title, executablePath }) => ({
          label: title.length > 18 ? `${title.slice(0, 18)}…` : title,
          type: "normal",
          click: async () => {
            if (!executablePath) return;

            shell.openPath(executablePath);
          },
        }));

      const contextMenu = Menu.buildFromTemplate([
        {
          label: t("open", {
            ns: "system_tray",
            lng: language,
          }),
          type: "normal",
          click: () => {
            if (this.mainWindow) {
              this.mainWindow.show();
            } else {
              this.createMainWindow();
            }
          },
        },
        {
          type: "separator",
        },
        ...recentlyPlayedGames,
        {
          type: "separator",
        },
        {
          label: t("quit", {
            ns: "system_tray",
            lng: language,
          }),
          type: "normal",
          click: () => app.quit(),
        },
      ]);

      if (process.platform === "linux") {
        tray.setContextMenu(contextMenu);
      }

      return contextMenu;
    };

    const showContextMenu = async () => {
      const contextMenu = await updateSystemTray();
      tray.popUpContextMenu(contextMenu);
    };

    tray.setToolTip("Hydra Launcher");

    if (process.platform === "win32") {
      await updateSystemTray();

      tray.addListener("double-click", () => {
        if (this.mainWindow) {
          this.mainWindow.show();
        } else {
          this.createMainWindow();
        }
      });

      tray.addListener("right-click", showContextMenu);
    } else if (process.platform === "linux") {
      await updateSystemTray();

      tray.addListener("click", () => {
        if (this.mainWindow) {
          this.mainWindow.show();
        } else {
          this.createMainWindow();
        }
      });

      tray.addListener("right-click", showContextMenu);
    } else {
      tray.addListener("click", showContextMenu);
      tray.addListener("right-click", showContextMenu);
    }
  }
}
