import path from "node:path";

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const isPortableVersion = () => {
  return !!process.env.PORTABLE_EXECUTABLE_FILE;
};

export const normalizePath = (str: string) =>
  path.posix.normalize(str).replaceAll("\\", "/");

export const addTrailingSlash = (str: string) =>
  str.endsWith("/") ? str : `${str}/`;

export * from "./reg-parser";
export * from "./launch-game";
export * from "./download-error-handler";
export * from "./download-game-helper";
export * from "./global-trackers";
