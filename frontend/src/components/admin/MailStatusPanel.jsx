import { CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";

import { getAdminMailStatus, sendAdminTestMail } from "../../api/app.js";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { StatusRow, WizardNotice, wizardSecondaryButtonClass } from "../wizard/WizardFrame.jsx";

// SMTP-Status aus der Docker-Umgebung (SMTP_*) mit Test-Mail – im Einrichtungsassistenten
// und unter Administration › E-Mail. Gespeichert wird hier bewusst nichts.
export default function MailStatusPanel({ initialStatus = null }) {
  const { accessToken, user } = useAuth();
  const { t } = useI18n();
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getAdminMailStatus(accessToken)
      .then((result) => { if (active) setStatus(result); })
      .catch((loadError) => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [accessToken]);

  async function sendTest() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await sendAdminTestMail(accessToken);
      setMessage(t("mailSettings.testSent", { email: result.to }));
    } catch (testError) {
      setError(testError.message);
    } finally {
      setBusy(false);
    }
  }

  if (!status && !error) {
    return <div className="text-sm text-fb-muted">{t("common.loading")}</div>;
  }

  const missing = t("mailSettings.notSet");

  return (
    <div className="space-y-5">
      {status && (
        <div className="divide-y divide-fb-border rounded-xl border border-fb-border">
          <StatusRow label={t("mailSettings.host")} hint="SMTP_HOST · SMTP_PORT" value={status.host ? `${status.host}:${status.port}` : missing} ok={status.host ? true : undefined} />
          <StatusRow label={t("mailSettings.security")} hint="SMTP_SECURE" value={status.security === "tls" ? "SSL/TLS" : status.security ? "STARTTLS" : missing} />
          <StatusRow label={t("mailSettings.username")} hint="SMTP_USER · SMTP_PASSWORD" value={status.username ? `${status.username}${status.passwordSet ? " · ••••••" : ""}` : missing} />
          <StatusRow
            label={t("mailSettings.fromAddress")}
            hint="SMTP_FROM · SMTP_FROM_NAME"
            value={status.fromAddress ? (status.fromName ? `${status.fromName} <${status.fromAddress}>` : status.fromAddress) : missing}
            ok={status.host ? Boolean(status.fromAddress) : undefined}
          />
        </div>
      )}

      {status?.configured ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={sendTest} disabled={busy} className={wizardSecondaryButtonClass}>
            {busy ? t("mailSettings.testSending") : t("mailSettings.test")}
          </button>
          <span className="text-xs text-fb-muted">{t("mailSettings.testHint", { email: user?.email || "" })}</span>
        </div>
      ) : (
        <WizardNotice tone="warn" icon={ExclamationTriangleIcon}>
          {status?.host ? t("mailSettings.fromMissing") : t("mailSettings.withoutSmtp")}
        </WizardNotice>
      )}

      {message && <WizardNotice tone="success" icon={CheckCircleIcon}>{message}</WizardNotice>}
      {error && <div role="alert" className="rounded-lg border border-fb-danger px-4 py-3 text-sm text-fb-danger">{error}</div>}

      <WizardNotice icon={InformationCircleIcon}>{t("mailSettings.envHint")}</WizardNotice>
    </div>
  );
}
