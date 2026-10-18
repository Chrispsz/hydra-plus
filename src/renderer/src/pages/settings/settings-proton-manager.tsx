import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SyncIcon } from "@primer/octicons-react";

import { formatBytes } from "@shared";

import { Button, ConfirmationModal, SelectField } from "@renderer/components";
import { useDate } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import type {
  ProtonInstallProgress,
  ProtonInstallTarget,
  ProtonProvider,
  ProtonRelease,
  ProtonVersion,
} from "@types";

import {
  getProtonErrorI18nKey,
  getProtonInstallPercent,
  isTerminalProtonInstallPhase,
  isRemovableProtonVersion,
  toProtonErrorCode,
} from "./settings-proton-manager-utils";
import "./settings-proton-manager.scss";

/**
 * Proton build manager (settings → compatibility): browses GitHub release
 * providers (GE-Proton, CachyOS), installs builds with pushed progress
 * events and removes installed ones.
 *
 * Everything is event-driven: install progress arrives on
 * `onProtonInstallProgress` (push), so there is no polling here — the
 * installed list is refreshed on mount and whenever an install reaches a
 * terminal phase.
 */
export function SettingsProtonManager() {
  const { t } = useTranslation("proton_manager");
  const { formatDate } = useDate();

  const isLinux = window.electron.platform === "linux";

  const [providers, setProviders] = useState<ProtonProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [releases, setReleases] = useState<ProtonRelease[]>([]);
  const [releasesPage, setReleasesPage] = useState(1);
  const [hasMoreReleases, setHasMoreReleases] = useState(false);
  const [isLoadingReleases, setIsLoadingReleases] = useState(true);
  const [isLoadingMoreReleases, setIsLoadingMoreReleases] = useState(false);
  const [releasesErrorKey, setReleasesErrorKey] = useState<string | null>(null);

  const [installedVersions, setInstalledVersions] = useState<ProtonVersion[]>(
    []
  );
  const [installTarget, setInstallTarget] =
    useState<ProtonInstallTarget | null>(null);

  const [installProgress, setInstallProgress] =
    useState<ProtonInstallProgress | null>(null);
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null);

  const [removingVersion, setRemovingVersion] = useState<ProtonVersion | null>(
    null
  );
  const [isRemoving, setIsRemoving] = useState(false);

  const refreshInstalledVersions = useCallback(async () => {
    try {
      setInstalledVersions(await window.electron.getInstalledProtonVersions());
    } catch (error) {
      logger.error("Failed to list installed Proton versions", error);
    }
  }, []);

  useEffect(() => {
    if (!isLinux) return;

    const unsubscribe = window.electron.onProtonInstallProgress((progress) => {
      if (isTerminalProtonInstallPhase(progress.phase)) {
        if (progress.phase === "error") {
          // Cancellations resolve to null — they are not failures.
          setActionErrorKey(
            getProtonErrorI18nKey(progress.error ?? "proton_install_failed")
          );
        }
        setInstallProgress(null);
        // A terminal phase may have changed the installed list either way.
        void refreshInstalledVersions();
        return;
      }

      setInstallProgress(progress);
    });

    return () => {
      unsubscribe();
    };
  }, [isLinux, refreshInstalledVersions]);

  useEffect(() => {
    if (!isLinux) return;

    window.electron
      .getProtonProviders()
      .then((availableProviders) => {
        setProviders(availableProviders);
        setSelectedProviderId(
          (current) => current || availableProviders[0]?.id || ""
        );
      })
      .catch((error: unknown) => {
        logger.error("Failed to list Proton providers", error);
        setProviders([]);
      });

    void refreshInstalledVersions();

    window.electron
      .getProtonInstallTargets()
      .then((targets) => {
        setInstallTarget(targets.find((target) => target.isDefault) ?? null);
      })
      .catch((error: unknown) => {
        logger.error("Failed to resolve the Proton install target", error);
      });
  }, [isLinux, refreshInstalledVersions]);

  useEffect(() => {
    if (!isLinux || !selectedProviderId) return;

    let isRequestCancelled = false;

    setIsLoadingReleases(true);
    setReleasesErrorKey(null);
    setReleases([]);
    setReleasesPage(1);
    setHasMoreReleases(false);

    window.electron
      .getProtonReleases(selectedProviderId, 1)
      .then((result) => {
        if (isRequestCancelled) return;
        setReleases(result.releases);
        setHasMoreReleases(result.hasMore);
      })
      .catch((error: unknown) => {
        if (isRequestCancelled) return;
        setReleasesErrorKey(getProtonErrorI18nKey(toProtonErrorCode(error)));
      })
      .finally(() => {
        if (!isRequestCancelled) setIsLoadingReleases(false);
      });

    return () => {
      isRequestCancelled = true;
    };
  }, [isLinux, selectedProviderId]);

  const activeInstall =
    installProgress && !isTerminalProtonInstallPhase(installProgress.phase)
      ? installProgress
      : null;

  const providerOptions = useMemo(
    () =>
      providers.map((provider) => ({
        key: provider.id,
        value: provider.id,
        label: provider.name,
      })),
    [providers]
  );

  const installPercent = getProtonInstallPercent(
    activeInstall?.receivedBytes,
    activeInstall?.totalBytes
  );

  const handleLoadMoreReleases = async () => {
    if (!selectedProviderId || isLoadingMoreReleases) return;

    const nextPage = releasesPage + 1;

    setIsLoadingMoreReleases(true);
    try {
      const result = await window.electron.getProtonReleases(
        selectedProviderId,
        nextPage
      );
      setReleases((current) => {
        // Pages can shift while new releases are published — dedupe by tag.
        const seenTags = new Set(current.map((release) => release.tag));
        return [
          ...current,
          ...result.releases.filter((release) => !seenTags.has(release.tag)),
        ];
      });
      setReleasesPage(nextPage);
      setHasMoreReleases(result.hasMore);
    } catch (error: unknown) {
      setReleasesErrorKey(getProtonErrorI18nKey(toProtonErrorCode(error)));
    } finally {
      setIsLoadingMoreReleases(false);
    }
  };

  const handleInstallRelease = async (release: ProtonRelease) => {
    if (!selectedProviderId || activeInstall) return;

    setActionErrorKey(null);
    // Optimistic state: the job is accepted immediately and the first
    // throttled progress event lands shortly after.
    setInstallProgress({
      providerId: selectedProviderId,
      tag: release.tag,
      phase: "downloading",
    });

    const result = await window.electron.installProtonRelease(
      selectedProviderId,
      release.tag
    );

    if (!result.ok) {
      setInstallProgress(null);
      setActionErrorKey(
        getProtonErrorI18nKey(result.error ?? "proton_install_failed")
      );
    }
  };

  const handleCancelInstall = async () => {
    if (!activeInstall) return;

    const wasCancelled = await window.electron.cancelProtonInstall(
      activeInstall.providerId,
      activeInstall.tag
    );

    if (wasCancelled) {
      // A terminal "error" event follows on its own; clear the row now.
      setInstallProgress(null);
    }
  };

  const handleRemoveVersion = async () => {
    if (!removingVersion) return;

    setIsRemoving(true);
    try {
      const result = await window.electron.removeInstalledProton(
        removingVersion.path
      );

      if (result.ok) {
        setRemovingVersion(null);
        await refreshInstalledVersions();
      } else {
        setActionErrorKey(
          getProtonErrorI18nKey(result.error ?? "proton_remove_failed")
        );
      }
    } catch (error) {
      logger.error("Failed to remove installed Proton build", error);
      setActionErrorKey("phase_error");
    } finally {
      setIsRemoving(false);
    }
  };

  if (!isLinux) {
    return (
      <div className="settings-context-panel__group settings-proton-manager">
        <h3 className="settings-proton-manager__title">{t("title")}</h3>
        <p className="settings-proton-manager__description">
          {t("not_supported_on_windows")}
        </p>
      </div>
    );
  }

  const releasesErrorMessage = releasesErrorKey ? t(releasesErrorKey) : null;
  const actionErrorMessage = actionErrorKey ? t(actionErrorKey) : null;

  return (
    <div className="settings-context-panel__group settings-proton-manager">
      <ConfirmationModal
        visible={removingVersion !== null}
        title={t("remove")}
        descriptionText={t("confirm_remove")}
        cancelButtonLabel={t("cancel")}
        confirmButtonLabel={t("remove")}
        confirmButtonTheme="danger"
        clickOutsideToClose={false}
        buttonsIsDisabled={isRemoving}
        onClose={() => setRemovingVersion(null)}
        onCancel={() => setRemovingVersion(null)}
        onConfirm={() => void handleRemoveVersion()}
      />

      <h3 className="settings-proton-manager__title">{t("title")}</h3>
      <p className="settings-proton-manager__description">{t("description")}</p>

      {installTarget && (
        <p className="settings-proton-manager__target">
          <span>{t("target")}</span>
          <small title={installTarget.path}>{installTarget.path}</small>
        </p>
      )}

      <div className="settings-proton-manager__releases">
        <div className="settings-proton-manager__subheader">
          <h4 className="settings-proton-manager__subtitle">
            {t("releases_title")}
          </h4>
          <SelectField
            label={t("provider")}
            value={selectedProviderId}
            options={providerOptions}
            disabled={activeInstall !== null || providers.length === 0}
            onChange={(event) => {
              if (event.target.value !== selectedProviderId) {
                setActionErrorKey(null);
                setSelectedProviderId(event.target.value);
              }
            }}
          />
        </div>

        {releasesErrorMessage && (
          <p className="settings-proton-manager__error" role="alert">
            {releasesErrorMessage}
          </p>
        )}

        {isLoadingReleases ? (
          <SyncIcon
            className="settings-proton-manager__loading-spinner"
            size={12}
          />
        ) : releases.length === 0 ? (
          !releasesErrorMessage && (
            <p className="settings-proton-manager__empty">{t("no_releases")}</p>
          )
        ) : (
          <ul className="settings-proton-manager__list">
            {releases.map((release) => {
              const isInstallingThisRelease =
                activeInstall?.tag === release.tag &&
                activeInstall.providerId === selectedProviderId;

              return (
                <li key={release.tag} className="settings-proton-manager__item">
                  <div className="settings-proton-manager__item-info">
                    <span className="settings-proton-manager__item-name">
                      {release.tag}
                    </span>
                    <span className="settings-proton-manager__item-meta">
                      {formatDate(release.publishedAt)}
                      {" · "}
                      {formatBytes(release.sizeBytes)}
                    </span>
                  </div>

                  {isInstallingThisRelease ? (
                    <Button
                      type="button"
                      theme="outline"
                      onClick={() => void handleCancelInstall()}
                    >
                      {t("cancel")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      theme="outline"
                      disabled={activeInstall !== null}
                      onClick={() => void handleInstallRelease(release)}
                    >
                      {t("install")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {hasMoreReleases && !isLoadingReleases && (
          <Button
            type="button"
            theme="outline"
            className="settings-proton-manager__load-more"
            disabled={isLoadingMoreReleases || activeInstall !== null}
            onClick={() => void handleLoadMoreReleases()}
          >
            {t("load_more")}
          </Button>
        )}
      </div>

      {activeInstall && (
        <div className="settings-proton-manager__progress">
          <div className="settings-proton-manager__progress-header">
            <span className="settings-proton-manager__progress-title">
              {t("installing")} · {activeInstall.tag}
            </span>
            <span className="settings-proton-manager__progress-status">
              {t(`phase_${activeInstall.phase}`)}
              {typeof activeInstall.receivedBytes === "number" &&
              typeof activeInstall.totalBytes === "number"
                ? ` · ${formatBytes(activeInstall.receivedBytes)} / ${formatBytes(
                    activeInstall.totalBytes
                  )}`
                : ""}
            </span>
          </div>
          <div
            className={`settings-proton-manager__progress-bar ${
              installPercent === null
                ? "settings-proton-manager__progress-bar--indeterminate"
                : ""
            }`}
            role="progressbar"
            aria-label={t("installing")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={installPercent ?? undefined}
          >
            <div
              className="settings-proton-manager__progress-fill"
              style={{ width: `${installPercent ?? 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="settings-proton-manager__installed">
        <div className="settings-proton-manager__subheader">
          <h4 className="settings-proton-manager__subtitle">
            {t("installed_title")}
          </h4>
          <Button
            type="button"
            theme="outline"
            disabled={isRemoving}
            onClick={() => void refreshInstalledVersions()}
          >
            {t("refresh")}
          </Button>
        </div>

        {actionErrorMessage && (
          <p className="settings-proton-manager__error" role="alert">
            {actionErrorMessage}
          </p>
        )}

        {installedVersions.length === 0 ? (
          <p className="settings-proton-manager__empty">{t("no_installed")}</p>
        ) : (
          <ul className="settings-proton-manager__list">
            {installedVersions.map((version) => (
              <li key={version.path} className="settings-proton-manager__item">
                <span
                  className="settings-proton-manager__item-name"
                  title={version.path}
                >
                  {version.name}
                </span>
                {isRemovableProtonVersion(version) && (
                  <Button
                    type="button"
                    theme="danger"
                    disabled={isRemoving}
                    onClick={() => setRemovingVersion(version)}
                  >
                    {t("remove")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
