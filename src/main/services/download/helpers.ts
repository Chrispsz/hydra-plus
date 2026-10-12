export const calculateETA = (
  totalLength: number,
  completedLength: number,
  speed: number
) => {
  const remainingBytes = totalLength - completedLength;

  if (remainingBytes >= 0 && speed > 0) {
    return (remainingBytes / speed) * 1000;
  }

  return -1;
};

// Single directory-size implementation lives in
// @main/events/helpers/get-directory-size; this alias keeps the download
// service call sites stable.
export { getDirectorySize as getDirSize } from "@main/events/helpers/get-directory-size";
