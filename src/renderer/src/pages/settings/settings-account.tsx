import { Button, CheckboxField, SelectField } from "@renderer/components";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useDate, useToast, useUserDetails } from "@renderer/hooks";
import { useEffect } from "react";
import { CloudIcon, KeyIcon, MailIcon } from "@primer/octicons-react";
import { AuthPage } from "@shared";
import "./settings-account.scss";
import type { ProfileVisibility } from "@types";

interface FormValues {
  profileVisibility: ProfileVisibility;
  allowCloudGifts: boolean;
}

export function SettingsAccount() {
  const { t } = useTranslation("settings");

  const { showSuccessToast } = useToast();

  const { formatDate } = useDate();

  const {
    control,
    formState: { isSubmitting },
    setValue,
    handleSubmit,
  } = useForm<FormValues>({
    defaultValues: {
      profileVisibility: "PUBLIC",
    },
  });

  const {
    userDetails,
    hasActiveSubscription,
    patchUser,
    fetchUserDetails,
    updateUserDetails,
  } = useUserDetails();

  useEffect(() => {
    if (userDetails?.profileVisibility) {
      setValue("profileVisibility", userDetails.profileVisibility);
      setValue("allowCloudGifts", userDetails.allowCloudGifts);
    }
  }, [userDetails, setValue]);

  useEffect(() => {
    const unsubscribe = window.electron.onAccountUpdated(() => {
      fetchUserDetails().then((response) => {
        if (response) {
          updateUserDetails(response);
        }
      });
      showSuccessToast(t("account_data_updated_successfully"));
    });

    return () => {
      unsubscribe();
    };
  }, [fetchUserDetails, updateUserDetails, t, showSuccessToast]);

  // FRIENDS visibility is a legacy server-side value: profiles stored with it
  // stay reachable only to the owner from the UI, so it is no longer offered
  // for new selections.
  const profileVisibilityOptions = [
    { value: "PUBLIC", label: t("public") },
    { value: "PRIVATE", label: t("private") },
  ];

  const onSubmit = async (values: FormValues) => {
    await patchUser(values);
    showSuccessToast(t("changes_saved"));
  };

  const getHydraCloudSectionContent = () => {
    const hasSubscribedBefore = Boolean(userDetails?.subscription?.expiresAt);
    const isRenewalActive = userDetails?.subscription?.status === "active";

    if (!hasSubscribedBefore) {
      return {
        description: <small>{t("no_subscription")}</small>,
        callToAction: t("become_subscriber"),
      };
    }

    if (hasActiveSubscription) {
      return {
        description: isRenewalActive ? (
          <>
            <small>
              {t("subscription_renews_on", {
                date: formatDate(userDetails.subscription!.expiresAt!),
              })}
            </small>
            <small>{t("bill_sent_until")}</small>
          </>
        ) : (
          <>
            <small>{t("subscription_renew_cancelled")}</small>
            <small>
              {t("subscription_active_until", {
                date: formatDate(userDetails!.subscription!.expiresAt!),
              })}
            </small>
          </>
        ),
        callToAction: t("manage_subscription"),
      };
    }

    return {
      description: (
        <small>
          {t("subscription_expired_at", {
            date: formatDate(userDetails!.subscription!.expiresAt!),
          })}
        </small>
      ),
      callToAction: t("renew_subscription"),
    };
  };

  if (!userDetails) return null;

  return (
    <form className="settings-account__form" onSubmit={handleSubmit(onSubmit)}>
      <Controller
        control={control}
        name="profileVisibility"
        render={({ field }) => {
          const handleChange = (
            event: React.ChangeEvent<HTMLSelectElement>
          ) => {
            field.onChange(event);
            handleSubmit(onSubmit)();
          };

          return (
            <section className="settings-account__section">
              <SelectField
                label={t("profile_visibility")}
                value={field.value}
                onChange={handleChange}
                options={profileVisibilityOptions.map((visiblity) => ({
                  key: visiblity.value,
                  value: visiblity.value,
                  label: visiblity.label,
                }))}
                disabled={isSubmitting}
              />
            </section>
          );
        }}
      />

      <section className="settings-account__section">
        <h4>{t("current_username")}</h4>
        <p>{userDetails?.username}</p>

        <h4>{t("current_email")}</h4>
        <p>{userDetails?.email ?? t("no_email_account")}</p>

        <div className="settings-account__actions">
          <Button
            theme="outline"
            onClick={() => window.electron.openAuthWindow(AuthPage.UpdateEmail)}
          >
            <MailIcon />
            {t("update_email")}
          </Button>

          <Button
            theme="outline"
            onClick={() =>
              window.electron.openAuthWindow(AuthPage.UpdatePassword)
            }
          >
            <KeyIcon />
            {t("update_password")}
          </Button>
        </div>
      </section>

      <section className="settings-account__section">
        <h3>{t("hydra_cloud")}</h3>
        <div className="settings-account__subscription-info">
          {getHydraCloudSectionContent().description}
        </div>

        <Button
          className="settings-account__subscription-button"
          theme="outline"
          onClick={() => window.electron.openCheckout()}
        >
          <CloudIcon />
          {getHydraCloudSectionContent().callToAction}
        </Button>
      </section>

      <Controller
        control={control}
        name="allowCloudGifts"
        render={({ field }) => (
          <section className="settings-account__section">
            <h3>{t("cloud_gifts")}</h3>
            <CheckboxField
              checked={field.value ?? true}
              disabled={isSubmitting}
              label={t("allow_cloud_gifts")}
              onChange={(event) => {
                field.onChange(event.target.checked);
                void handleSubmit(onSubmit)();
              }}
            />
          </section>
        )}
      />
    </form>
  );
}
