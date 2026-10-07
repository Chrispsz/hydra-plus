import { useContext, useEffect, useState } from "react";
import {
  TextField,
  Button,
  CheckboxField,
  SelectField,
} from "@renderer/components";
import type { DownloadDirectoryPreference } from "@types";
import { useTranslation } from "react-i18next";
import { useAppSelector } from "@renderer/hooks";
import { changeLanguage } from "i18next";
import languageResources from "@locales";
import { orderBy } from "lodash-es";
import { settingsContext } from "@renderer/context";
import "./settings-general.scss";
import { DesktopDownloadIcon } from "@primer/octicons-react";
import { logger } from "@renderer/logger";
import {
  prepareDefaultDownloadPathSync,
  replaceSavedDownloadDirectoryAndSetDefault,
} from "@shared";
import { DownloadDirectoryReplacementModal } from "./download-directory-replacement-modal";

interface LanguageOption {
  option: string;
  nativeName: string;
}

interface DownloadDirectoryReplacementState {
  nextPath: string;
  replaceableDirectories: DownloadDirectoryPreference[];
  selectedReplacementPath: string;
}

export function SettingsGeneral() {
  const { t } = useTranslation("settings");

  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [canInstallCommonRedist, setCanInstallCommonRedist] = useState(false);
  const [installingCommonRedist, setInstallingCommonRedist] = useState(false);

  const [form, setForm] = useState({
    downloadsPath: "",
    downloadNotificationsEnabled: false,
    repackUpdatesNotificationsEnabled: false,
    language: "",
    customStyles: window.localStorage.getItem("customStyles") || "",
  });

  const [languageOptions, setLanguageOptions] = useState<LanguageOption[]>([]);

  const [defaultDownloadsPath, setDefaultDownloadsPath] = useState("");
  const [downloadDirectoryReplacement, setDownloadDirectoryReplacement] =
    useState<DownloadDirectoryReplacementState | null>(null);

  useEffect(() => {
    window.electron.getDefaultDownloadsPath().then((path) => {
      setDefaultDownloadsPath(path);
    });

    window.electron.canInstallCommonRedist().then((canInstall) => {
      setCanInstallCommonRedist(canInstall);
    });

    const redistInterval = setInterval(() => {
      window.electron.canInstallCommonRedist().then((canInstall) => {
        setCanInstallCommonRedist(canInstall);
      });
    }, 1000 * 5);

    setLanguageOptions(
      orderBy(
        Object.entries(languageResources).map(([language, value]) => {
          return {
            nativeName: value.language_name,
            option: language,
          };
        }),
        ["nativeName"],
        "asc"
      )
    );

    return () => {
      clearInterval(redistInterval);
    };
  }, []);

  useEffect(() => {
    if (userPreferences) {
      const languageKeys = Object.keys(languageResources);
      const language =
        languageKeys.find(
          (language) => language === userPreferences.language
        ) ??
        languageKeys.find((language) => {
          return language.startsWith(
            userPreferences.language?.split("-")[0] ?? "en"
          );
        });

      setForm((prev) => ({
        ...prev,
        downloadsPath: userPreferences.downloadsPath ?? defaultDownloadsPath,
        downloadNotificationsEnabled:
          userPreferences.downloadNotificationsEnabled ?? false,
        repackUpdatesNotificationsEnabled:
          userPreferences.repackUpdatesNotificationsEnabled ?? false,
        language: language ?? "en",
      }));
    }
  }, [userPreferences, defaultDownloadsPath]);

  const handleLanguageChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value = event.target.value;

    handleChange({ language: value });
    changeLanguage(value);
  };

  const handleChange = async (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    await updateUserPreferences(values);
  };

  const handleChooseDownloadsPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: form.downloadsPath,
      properties: ["openDirectory"],
    });

    const path = filePaths?.[0];

    if (!path || !defaultDownloadsPath) {
      return;
    }

    const nextAction = prepareDefaultDownloadPathSync(
      userPreferences,
      path,
      defaultDownloadsPath
    );

    if (nextAction.type === "noop") {
      return;
    }

    if (
      nextAction.type === "set-existing" ||
      nextAction.type === "add-and-set"
    ) {
      setForm((prev) => ({
        ...prev,
        downloadsPath: nextAction.nextDefaultPath,
      }));
      await updateUserPreferences(nextAction.nextPreferences);
      return;
    }

    setDownloadDirectoryReplacement({
      nextPath: nextAction.nextPath,
      replaceableDirectories: nextAction.replaceableDirectories,
      selectedReplacementPath: nextAction.recommendedReplacementPath,
    });
  };

  const handleConfirmDownloadDirectoryReplacement = async () => {
    if (!downloadDirectoryReplacement || !defaultDownloadsPath) {
      return;
    }

    const replacement = replaceSavedDownloadDirectoryAndSetDefault(
      userPreferences,
      downloadDirectoryReplacement.nextPath,
      downloadDirectoryReplacement.selectedReplacementPath,
      defaultDownloadsPath
    );

    setForm((prev) => ({
      ...prev,
      downloadsPath: replacement.nextDefaultPath,
    }));
    setDownloadDirectoryReplacement(null);
    await updateUserPreferences(replacement.nextPreferences);
  };

  useEffect(() => {
    const unlisten = window.electron.onCommonRedistProgress(
      ({ log, complete }) => {
        if (log === "Installation timed out" || complete) {
          setInstallingCommonRedist(false);
        }
      }
    );

    return () => unlisten();
  }, []);

  const handleInstallCommonRedist = async () => {
    setInstallingCommonRedist(true);
    try {
      await window.electron.installCommonRedist();
    } catch (err) {
      logger.error(err);
      setInstallingCommonRedist(false);
    }
  };

  return (
    <div className="settings-general">
      <TextField
        label={t("downloads_path")}
        value={form.downloadsPath}
        readOnly
        disabled
        rightContent={
          <Button theme="outline" onClick={handleChooseDownloadsPath}>
            {t("change")}
          </Button>
        }
      />

      <SelectField
        label={t("language")}
        value={form.language}
        onChange={handleLanguageChange}
        options={languageOptions.map((language) => ({
          key: language.option,
          value: language.option,
          label: language.nativeName,
        }))}
      />

      <h2 className="settings-general__section-title">{t("downloads")}</h2>

      <h2 className="settings-general__section-title">{t("notifications")}</h2>

      <CheckboxField
        label={t("enable_download_notifications")}
        checked={form.downloadNotificationsEnabled}
        onChange={() =>
          handleChange({
            downloadNotificationsEnabled: !form.downloadNotificationsEnabled,
          })
        }
      />

      <CheckboxField
        label={t("enable_repack_list_notifications")}
        checked={form.repackUpdatesNotificationsEnabled}
        onChange={() =>
          handleChange({
            repackUpdatesNotificationsEnabled:
              !form.repackUpdatesNotificationsEnabled,
          })
        }
      />

      <h2 className="settings-general__section-title">{t("common_redist")}</h2>

      <p className="settings-general__common-redist-description">
        {t("common_redist_description")}
      </p>

      <Button
        onClick={handleInstallCommonRedist}
        className="settings-general__common-redist-button"
        disabled={!canInstallCommonRedist || installingCommonRedist}
      >
        <DesktopDownloadIcon />
        {installingCommonRedist
          ? t("installing_common_redist")
          : t("install_common_redist")}
      </Button>

      <DownloadDirectoryReplacementModal
        visible={downloadDirectoryReplacement !== null}
        nextPath={downloadDirectoryReplacement?.nextPath ?? ""}
        directories={downloadDirectoryReplacement?.replaceableDirectories ?? []}
        selectedReplacementPath={
          downloadDirectoryReplacement?.selectedReplacementPath ?? ""
        }
        onSelectedReplacementPathChange={(path) => {
          setDownloadDirectoryReplacement((current) =>
            current
              ? {
                  ...current,
                  selectedReplacementPath: path,
                }
              : current
          );
        }}
        onClose={() => setDownloadDirectoryReplacement(null)}
        onConfirm={handleConfirmDownloadDirectoryReplacement}
      />
    </div>
  );
}
