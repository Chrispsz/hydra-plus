/**
 * electron-builder afterPack hook — slims the packaged Electron dist.
 *
 * The app ships its own i18n (pt-BR + en), so Chromium's 50+ locale paks
 * are dead weight (~46 MB raw): keep only en-US. The Chromium licenses
 * file must ship for compliance, but zipped (~1/8 the size) is enough —
 * it is only read by humans, not by Chromium.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const KEEP_LOCALES = new Set(["en-US.pak"]);

exports.default = async function afterPack(context) {
  const distLocales = path.join(context.appOutDir, "locales");
  if (fs.existsSync(distLocales)) {
    for (const entry of fs.readdirSync(distLocales)) {
      if (entry.endsWith(".pak") && !KEEP_LOCALES.has(entry)) {
        fs.unlinkSync(path.join(distLocales, entry));
      }
    }
    console.log(`[after-pack] kept only en-US locale pak in ${distLocales}`);
  }

  const licensesPath = path.join(context.appOutDir, "LICENSES.chromium.html");
  if (fs.existsSync(licensesPath)) {
    const zipPath = path.join(context.appOutDir, "LICENSES.chromium.html.zip");
    if (process.platform === "win32") {
      execFileSync("powershell", [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${licensesPath.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
      ]);
    } else {
      execFileSync("zip", ["-q", "-j", zipPath, licensesPath]);
    }
    fs.unlinkSync(licensesPath);
    console.log("[after-pack] LICENSES.chromium.html zipped");
  }
};
