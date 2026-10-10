import { Button, SelectField } from "@renderer/components";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useEffect } from "react";
import { KeyIcon, MailIcon } from "@primer/octicons-react";
import { AuthPage } from "@shared";
import "./settings-account.scss";
import type { ProfileVisibility } from "@types";

interface FormValues {
  profileVisibility: ProfileVisibility;
}

export function SettingsAccount() {
  const { t } = useTranslation("settings");

  const { showSuccessToast } = useToast();
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

  const { userDetails, patchUser, fetchUserDetails, updateUserDetails } =
    useUserDetails();

  useEffect(() => {
    if (userDetails?.profileVisibility) {
      setValue("profileVisibility", userDetails.profileVisibility);
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
    </form>
  );
}
