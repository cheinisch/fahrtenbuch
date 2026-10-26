import { useEffect, useState } from "react";

import { getAdminAiSettings, testAdminAiProvider, updateAdminAiSettings } from "../../api/app.js";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { useI18n } from "../../i18n/I18nProvider.jsx";

const fieldClass =
  "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft disabled:opacity-60";

const primaryButton =
  "min-h-11 rounded-lg bg-fb-accent px-4 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60";

const secondaryButton =
  "min-h-11 rounded-lg border border-fb-border px-4 text-sm font-semibold text-fb-text transition hover:border-fb-accent disabled:opacity-60";

const PROVIDERS = ["claude", "openai", "ollama"];

const EMPTY_FORM = { baseUrl: "", model: "", apiKey: "", clearApiKey: false };

function errorText(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function StatusLine({ status }) {
  if (!status) return null;

  const className = {
    ok: "border-fb-accent bg-fb-accent-soft text-fb-accent-strong",
    warn: "border-fb-warn bg-fb-warn-soft text-fb-warn",
    error: "border-fb-danger text-fb-danger",
  }[status.kind];

  return (
    <div role="status" className={`rounded-lg border px-3 py-2 text-sm ${className}`}>
      {status.text}
    </div>
  );
}

/** Spiegelt die Pflichtprüfung des Backends, damit nur Einsatzbereites aktivierbar ist. */
function isReady(provider, form, saved) {
  const hasKey = !form.clearApiKey && (Boolean(form.apiKey.trim()) || Boolean(saved?.apiKeySet));
  if (!form.model.trim()) return false;
  return provider === "ollama" ? Boolean(form.baseUrl.trim()) : hasKey;
}

function ProviderCard({ provider, form, saved, onChange, test, onTest }) {
  const { t } = useI18n();
  const listId = `ai-models-${provider}`;
  const keyStored = saved?.apiKeySet && !form.clearApiKey;

  return (
    <section className="rounded-xl border border-fb-border bg-fb-main p-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold">{t(`aiSettings.providers.${provider}`)}</h3>
          <p className="mt-1 text-sm text-fb-muted">{t(`aiSettings.providerHints.${provider}`)}</p>
        </div>
        <button type="button" onClick={onTest} disabled={test.busy} className={secondaryButton}>
          {test.busy ? t("aiSettings.testing") : t("aiSettings.test")}
        </button>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="block text-sm font-medium">
          {t("aiSettings.baseUrl")}
          <input
            type="url"
            value={form.baseUrl}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
            placeholder={
              provider === "ollama"
                ? t("aiSettings.baseUrlOllama")
                : t("aiSettings.baseUrlDefault", { url: saved?.defaultBaseUrl || "" })
            }
            className={fieldClass}
          />
        </label>

        <label className="block text-sm font-medium">
          {provider === "ollama" ? t("aiSettings.apiKeyOptional") : t("aiSettings.apiKey")}
          <input
            type="password"
            autoComplete="new-password"
            value={form.apiKey}
            onChange={(event) => onChange({ apiKey: event.target.value, clearApiKey: false })}
            placeholder={
              form.clearApiKey
                ? t("aiSettings.apiKeyWillRemove")
                : keyStored
                  ? t("aiSettings.apiKeyStored", { hint: saved.apiKeyHint })
                  : t("aiSettings.apiKeyNew")
            }
            className={fieldClass}
          />
          {keyStored && (
            <button
              type="button"
              onClick={() => onChange({ apiKey: "", clearApiKey: true })}
              className="mt-1.5 text-xs font-semibold text-fb-danger hover:underline"
            >
              {t("aiSettings.apiKeyRemove")}
            </button>
          )}
        </label>

        <label className="block text-sm font-medium md:col-span-2">
          {t("aiSettings.model")}
          <input
            type="text"
            list={listId}
            value={form.model}
            onChange={(event) => onChange({ model: event.target.value })}
            placeholder={t("aiSettings.modelPlaceholder")}
            className={fieldClass}
          />
          <datalist id={listId}>
            {test.models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          {test.models.length > 0 && (
            <span className="mt-1.5 block text-xs text-fb-muted">
              {t("aiSettings.modelsFound", { count: test.models.length })}
            </span>
          )}
        </label>
      </div>

      {test.status && (
        <div className="mt-4">
          <StatusLine status={test.status} />
        </div>
      )}
    </section>
  );
}

export default function AiSettings() {
  const { accessToken } = useAuth();
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saved, setSaved] = useState(null);
  const [activeProvider, setActiveProvider] = useState("disabled");
  const [timeoutSeconds, setTimeoutSeconds] = useState(60);
  const [forms, setForms] = useState(() => Object.fromEntries(PROVIDERS.map((p) => [p, { ...EMPTY_FORM }])));
  const [tests, setTests] = useState(() =>
    Object.fromEntries(PROVIDERS.map((p) => [p, { busy: false, status: null, models: [] }])),
  );
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  function applySaved(settings) {
    setSaved(settings);
    setActiveProvider(settings.activeProvider);
    setTimeoutSeconds(Math.round(Number(settings.timeoutMs || 60_000) / 1000));
    setForms(
      Object.fromEntries(
        PROVIDERS.map((provider) => {
          const entry = settings.providers?.[provider] || {};
          return [provider, { ...EMPTY_FORM, baseUrl: entry.baseUrl || "", model: entry.model || "" }];
        }),
      ),
    );
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const settings = await getAdminAiSettings(accessToken);
        if (!cancelled) applySaved(settings);
      } catch (error) {
        if (!cancelled) setLoadError(errorText(error, t("aiSettings.loadFailed")));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, t]);

  function updateForm(provider, patch) {
    setForms((current) => ({ ...current, [provider]: { ...current[provider], ...patch } }));
    setSaveStatus(null);
  }

  function providerPayload(form) {
    const payload = { baseUrl: form.baseUrl.trim(), model: form.model.trim() };
    if (form.clearApiKey) payload.clearApiKey = true;
    else if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();
    return payload;
  }

  async function runTest(provider) {
    setTests((current) => ({ ...current, [provider]: { ...current[provider], busy: true, status: null } }));

    try {
      const result = await testAdminAiProvider(accessToken, provider, providerPayload(forms[provider]));
      const modelMissing = result.success && result.modelAvailable === false;
      setTests((current) => ({
        ...current,
        [provider]: {
          busy: false,
          models: result.models || [],
          status: { kind: result.success ? (modelMissing ? "warn" : "ok") : "error", text: result.message },
        },
      }));
    } catch (error) {
      setTests((current) => ({
        ...current,
        [provider]: {
          ...current[provider],
          busy: false,
          status: { kind: "error", text: errorText(error, t("aiSettings.testFailed")) },
        },
      }));
    }
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setSaveStatus(null);

    try {
      const result = await updateAdminAiSettings(accessToken, {
        activeProvider,
        timeoutMs: Math.round(Number(timeoutSeconds) * 1000),
        providers: Object.fromEntries(PROVIDERS.map((p) => [p, providerPayload(forms[p])])),
      });
      applySaved(result);
      setSaveStatus({ kind: "ok", text: t("aiSettings.saved") });
    } catch (error) {
      setSaveStatus({ kind: "error", text: errorText(error, t("aiSettings.saveFailed")) });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="rounded-xl border border-fb-border bg-fb-main p-[22px] text-sm text-fb-muted">…</div>;
  }

  if (loadError) {
    return <StatusLine status={{ kind: "error", text: loadError }} />;
  }

  const activeOptions = [
    { value: "disabled", title: t("aiSettings.disabled"), hint: t("aiSettings.disabledHint"), ready: true },
    ...PROVIDERS.map((provider) => {
      const ready = isReady(provider, forms[provider], saved?.providers?.[provider]);
      return {
        value: provider,
        title: t(`aiSettings.providers.${provider}`),
        hint: ready ? t("aiSettings.ready") : t("aiSettings.notReady"),
        ready,
      };
    }),
  ];

  return (
    <form onSubmit={save} className="space-y-6">
      <section className="rounded-xl border border-fb-border bg-fb-main p-[22px]">
        <h2 className="text-lg font-bold">{t("aiSettings.title")}</h2>
        <p className="mt-1 text-sm text-fb-muted">{t("aiSettings.subtitle")}</p>

        <fieldset className="mt-5">
          <legend className="text-sm font-semibold">{t("aiSettings.activeTitle")}</legend>
          <p className="mt-1 text-xs text-fb-muted">{t("aiSettings.activeHint")}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {activeOptions.map((option) => {
              const selected = activeProvider === option.value;
              const disabled = !option.ready && !selected;

              return (
                <label
                  key={option.value}
                  className={[
                    "flex items-start gap-3 rounded-lg border px-3.5 py-3 transition",
                    selected ? "border-fb-accent bg-fb-accent-soft" : "border-fb-border",
                    disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-fb-accent",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="ai-active-provider"
                    value={option.value}
                    checked={selected}
                    disabled={disabled}
                    onChange={() => {
                      setActiveProvider(option.value);
                      setSaveStatus(null);
                    }}
                    className="mt-1 h-4 w-4 flex-none accent-fb-accent"
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">{option.title}</span>
                    <span className="block text-xs text-fb-muted">{option.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className="mt-5 block max-w-xs text-sm font-medium">
          {t("aiSettings.timeout")}
          <input
            type="number"
            min={5}
            max={600}
            step={1}
            value={timeoutSeconds}
            onChange={(event) => setTimeoutSeconds(event.target.value)}
            className={fieldClass}
          />
        </label>

        <p className="mt-5 text-xs text-fb-muted">{t("aiSettings.privacyHint")}</p>
      </section>

      {PROVIDERS.map((provider) => (
        <ProviderCard
          key={provider}
          provider={provider}
          form={forms[provider]}
          saved={saved?.providers?.[provider]}
          onChange={(patch) => updateForm(provider, patch)}
          test={tests[provider]}
          onTest={() => runTest(provider)}
        />
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className={primaryButton}>
          {t("aiSettings.save")}
        </button>
        <div className="flex-1">
          <StatusLine status={saveStatus} />
        </div>
      </div>
    </form>
  );
}
