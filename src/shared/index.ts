import { isArchiveOrgFileUri } from "./archive-org";
import { charMap } from "./char-map";
import { Downloader } from "./constants";
import { GameRepack } from "@types";

export * from "./archive-org";
export * from "./constants";
export * from "./steam-session";
export * from "./window-layout";
export {
  getDisplayedPlayTimeInMilliseconds,
  getPlayTimeHoursAndMinutes,
  mergeLocalAndRemotePlayTime,
} from "./playtime";
export * from "./cloud-save-access";
export * from "./cloud-save-v2-eligibility";
export * from "./controller-support";
export * from "./artwork-resolver";
export * from "./download-directories";
export * from "./tracker-list";

const FORMAT = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || isNaN(bytes) || bytes <= 0) {
    return `0 ${FORMAT[0]}`;
  }

  const byteKBase = 1024;

  const base = Math.floor(Math.log(bytes) / Math.log(byteKBase));

  const formatedByte = bytes / byteKBase ** base;

  return `${Math.trunc(formatedByte * 10) / 10} ${FORMAT[base]}`;
};

export const parseBytes = (sizeString: string | null): number | null => {
  if (!sizeString) return null;

  const regex = /^([\d.,]+)\s*([A-Za-z]+)$/;
  const match = regex.exec(sizeString.trim());
  if (!match) return null;

  const value = Number.parseFloat(match[1].replaceAll(",", "."));
  const unit = match[2].toUpperCase();

  if (Number.isNaN(value)) return null;

  const unitIndex = FORMAT.indexOf(unit);
  if (unitIndex === -1) return null;

  const byteKBase = 1024;
  return Math.round(value * Math.pow(byteKBase, unitIndex));
};

export const formatBytesToMbps = (bytesPerSecond: number): string => {
  const bitsPerSecond = bytesPerSecond * 8;
  const mbps = bitsPerSecond / 1e6;
  return `${Math.trunc(mbps * 10) / 10} Mbps`;
};

export const pipe =
  <T>(...fns: ((arg: T) => any)[]) =>
  (arg: T) =>
    fns.reduce((prev, fn) => fn(prev), arg);

export const removeReleaseYearFromName = (name: string) =>
  name.replace(/\(\d{4}\)/g, "");

export const removeSymbolsFromName = (name: string) =>
  name.replace(/[^A-Za-z 0-9]/g, "");

export const removeSpecialEditionFromName = (name: string) =>
  name.replace(
    /(The |Digital )?(GOTY|Deluxe|Standard|Ultimate|Definitive|Enhanced|Collector's|Premium|Digital|Limited|Game of the Year|Reloaded|[0-9]{4}) Edition/gi,
    ""
  );

export const removeDuplicateSpaces = (name: string) =>
  name.replace(/\s{2,}/g, " ");

export const replaceDotsWithSpace = (name: string) => name.replace(/\./g, " ");

export const replaceNbspWithSpace = (name: string) =>
  name.replace(new RegExp(String.fromCharCode(160), "g"), " ");

export const replaceUnderscoreWithSpace = (name: string) =>
  name.replace(/_/g, " ");

const charMapPattern = new RegExp(Object.keys(charMap).join("|"), "g");

const COMBINING_MARKS = /[\u0300-\u036f]/g;

export const removeDiacritics = (value: string) =>
  value
    .normalize("NFC")
    .replace(charMapPattern, (match) => charMap[match])
    .normalize("NFD")
    .replace(COMBINING_MARKS, "");

export const formatName = pipe<string>(
  (str) => str.replace(charMapPattern, (match) => charMap[match]),
  (str) => str.toLowerCase(),
  removeReleaseYearFromName,
  removeSpecialEditionFromName,
  replaceUnderscoreWithSpace,
  replaceDotsWithSpace,
  replaceNbspWithSpace,
  (str) => str.replace(/DIRECTOR'S CUT/gi, ""),
  (str) => str.replace(/Friend's Pass/gi, ""),
  removeSymbolsFromName,
  removeDuplicateSpaces,
  (str) => str.trim()
);

const realDebridHosts = ["https://1fichier.com", "https://mediafire.com"];

export const getDownloadersForUri = (uri: string) => {
  if (uri.startsWith("https://gofile.io")) return [Downloader.Gofile];

  if (uri.startsWith("https://pixeldrain.com")) return [Downloader.PixelDrain];
  if (uri.startsWith("https://datanodes.to")) return [Downloader.Datanodes];
  if (uri.startsWith("https://www.mediafire.com"))
    return [Downloader.Mediafire];
  if (uri.startsWith("https://fuckingfast.co")) {
    return [Downloader.FuckingFast];
  }
  if (uri.startsWith("https://www.rootz.so")) {
    return [Downloader.Rootz];
  }
  if (isArchiveOrgFileUri(uri)) {
    return [Downloader.ArchiveOrg];
  }

  if (realDebridHosts.some((host) => uri.startsWith(host)))
    return [Downloader.RealDebrid];

  if (uri.startsWith("magnet:")) {
    return [
      Downloader.Torrent,
      Downloader.Hydra,
      Downloader.TorBox,
      Downloader.RealDebrid,
      Downloader.Premiumize,
      Downloader.AllDebrid,
    ];
  }

  return [];
};

export const getDownloadersForUris = (uris: string[]) => {
  const downloadersSet = uris.reduce<Set<Downloader>>((prev, next) => {
    const downloaders = getDownloadersForUri(next);
    downloaders.forEach((downloader) => prev.add(downloader));

    return prev;
  }, new Set());

  return Array.from(downloadersSet);
};

export const filterDownloadableRepacks = <T extends Pick<GameRepack, "uris">>(
  repacks: T[]
) =>
  repacks.filter(
    (repack) =>
      Array.isArray(repack.uris) &&
      getDownloadersForUris(repack.uris).length > 0
  );
