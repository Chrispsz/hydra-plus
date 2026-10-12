import { useTranslation } from "react-i18next";
import {
  SettingsContextConsumer,
  SettingsContextProvider,
} from "@renderer/context";
import { useMemo } from "react";
import "./settings.scss";
import {
  BellIcon,
  CloudIcon,
  DownloadIcon,
  GearIcon,
  LinkIcon,
  PlayIcon,
  PlugIcon,
} from "@primer/octicons-react";
import { Wrench } from "lucide-react";
import { SettingsContextGeneral } from "./settings-context-general";
import { SettingsContextCloud } from "./settings-context-cloud";
import { SettingsContextDownloads } from "./settings-context-downloads";
import { SettingsContextDownloadSources } from "./settings-context-download-sources";
import { SettingsContextNotifications } from "./settings-context-notifications";
import { SettingsContextContentGameplay } from "./settings-context-content-gameplay";
import { SettingsContextIntegrations } from "./settings-context-integrations";
import { SettingsContextCompatibility } from "./settings-context-compatibility";

export default function Settings() {
  const { t } = useTranslation("settings");

  const categories = useMemo(
    () => [
      {
        id: "general" as const,
        label: t("general"),
        icon: <GearIcon size={16} />,
      },
      {
        id: "downloads" as const,
        label: t("downloads"),
        icon: <DownloadIcon size={16} />,
      },
      {
        id: "cloud" as const,
        label: t("cloud"),
        icon: <CloudIcon size={16} />,
      },
      {
        id: "download_sources" as const,
        label: t("download_sources"),
        icon: <LinkIcon size={16} />,
      },
      {
        id: "notifications" as const,
        label: t("notifications"),
        icon: <BellIcon size={16} />,
      },
      {
        id: "content_gameplay" as const,
        label: t("content_gameplay"),
        icon: <PlayIcon size={16} />,
      },
      {
        id: "integrations" as const,
        label: t("integrations"),
        icon: <PlugIcon size={16} />,
      },
      {
        id: "compatibility" as const,
        label: t("compatibility"),
        icon: <Wrench size={16} />,
      },
    ],
    [t]
  );

  return (
    <SettingsContextProvider>
      <SettingsContextConsumer>
        {({ currentCategoryId, setCurrentCategoryId }) => {
          const currentCategory =
            categories.find((category) => category.id === currentCategoryId) ??
            categories[0];
          const selectedCategoryId = currentCategory.id;

          const renderCategory = () => {
            if (selectedCategoryId === "general") {
              return <SettingsContextGeneral />;
            }

            if (selectedCategoryId === "downloads") {
              return <SettingsContextDownloads />;
            }

            if (selectedCategoryId === "download_sources") {
              return <SettingsContextDownloadSources />;
            }

            if (selectedCategoryId === "notifications") {
              return <SettingsContextNotifications />;
            }

            if (selectedCategoryId === "content_gameplay") {
              return <SettingsContextContentGameplay />;
            }

            if (selectedCategoryId === "cloud") {
              return <SettingsContextCloud />;
            }

            if (selectedCategoryId === "integrations") {
              return <SettingsContextIntegrations />;
            }

            return <SettingsContextCompatibility />;
          };

          return (
            <section className="settings__container">
              <div className="settings__content">
                <aside className="settings__sidebar">
                  {categories.map((category) => {
                    const isActive = currentCategory.id === category.id;

                    return (
                      <button
                        key={category.id}
                        type="button"
                        className={`settings__sidebar-button ${
                          isActive ? "settings__sidebar-button--active" : ""
                        }`}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setCurrentCategoryId(category.id)}
                      >
                        <span className="settings__sidebar-button-icon">
                          {category.icon}
                        </span>
                        <span className="settings__sidebar-button-label">
                          {category.label}
                        </span>
                      </button>
                    );
                  })}
                </aside>

                <div className="settings__panel">
                  <h2 className="settings__panel-title">
                    {currentCategory.label}
                  </h2>
                  {renderCategory()}
                </div>
              </div>
            </section>
          );
        }}
      </SettingsContextConsumer>
    </SettingsContextProvider>
  );
}
