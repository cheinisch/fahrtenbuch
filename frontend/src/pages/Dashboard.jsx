import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { getDashboard } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";

const tripTypeLabels = {
  business: "Dienstlich",
  private: "Privat",
  commute: "Arbeitsweg",
  unclassified: "Nicht zugeordnet",
};

const tripStatusLabels = {
  recording: "Wird aufgezeichnet",
  completed: "Abgeschlossen",
  cancelled: "Abgebrochen",
};

function formatDistance(meters) {
  const kilometers = Number(meters || 0) / 1000;

  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: kilometers < 100 ? 1 : 0,
    maximumFractionDigits: 1,
  }).format(kilometers);
}

function formatDate(value) {
  if (!value) {
    return "–";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function StatCard({
  label,
  value,
  suffix,
  hint,
}) {
  return (
    <div className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm">
      <div className="text-sm font-medium text-fb-muted">
        {label}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-tight">
          {value}
        </span>

        {suffix && (
          <span className="text-sm text-fb-muted">
            {suffix}
          </span>
        )}
      </div>

      {hint && (
        <div className="mt-2 text-xs text-fb-muted">
          {hint}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { accessToken, user } = useAuth();

  const [data, setData] = useState(null);
  const [status, setStatus] = useState({
    loading: true,
    error: "",
  });

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const result = await getDashboard(accessToken);

        if (!cancelled) {
          setData(result);
          setStatus({
            loading: false,
            error: "",
          });
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Das Dashboard konnte nicht geladen werden.",
          });
        }
      }
    }

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const maximumMonthlyDistance = useMemo(
    () =>
      Math.max(
        1,
        ...(data?.monthlyDistance || []).map(
          (item) => item.distanceMeters,
        ),
      ),
    [data],
  );

  if (status.loading) {
    return (
      <div className="rounded-xl border border-fb-border bg-fb-main p-8 text-fb-muted">
        Dashboard wird geladen …
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm font-semibold text-fb-accent">
          Übersicht
        </p>

        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Willkommen, {user?.displayName || user?.username}
        </h1>

        <p className="mt-2 text-fb-muted">
          Hier siehst du den aktuellen Stand deines
          Fahrtenbuchs.
        </p>
      </header>

      {status.error && (
        <div className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">
          {status.error}
        </div>
      )}

      {data && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Gesamtstrecke"
              value={formatDistance(
                data.stats.totalDistanceMeters,
              )}
              suffix="km"
              hint={`${data.stats.totalTrips} abgeschlossene Fahrten`}
            />

            <StatCard
              label="Dieser Monat"
              value={formatDistance(
                data.stats.monthDistanceMeters,
              )}
              suffix="km"
              hint={`${data.stats.monthTrips} Fahrten`}
            />

            <StatCard
              label="Nicht zugeordnet"
              value={data.stats.unclassifiedTrips}
              hint="Fahrten ohne Kategorie"
            />

            <StatCard
              label="Fahrzeuge"
              value={data.stats.vehicleCount}
              hint="Aktive Fahrzeuge"
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">
                    Letzte Fahrten
                  </h2>

                  <p className="mt-1 text-sm text-fb-muted">
                    Deine zuletzt erfassten Fahrten
                  </p>
                </div>
              </div>

              <div className="mt-5 divide-y divide-fb-border">
                {data.recentTrips.length === 0 ? (
                  <div className="py-10 text-center text-sm text-fb-muted">
                    Es wurden noch keine Fahrten erfasst.
                  </div>
                ) : (
                  data.recentTrips.map((trip) => (
                    <article
                      key={trip.id}
                      className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">
                            {tripTypeLabels[trip.type] ||
                              trip.type}
                          </span>

                          <span className="rounded-full bg-fb-accent-soft px-2 py-0.5 text-xs font-medium text-fb-accent">
                            {tripStatusLabels[trip.status] ||
                              trip.status}
                          </span>
                        </div>

                        <div className="mt-1 truncate text-sm text-fb-muted">
                          {trip.startAddress || "Unbekannter Start"}
                          {" → "}
                          {trip.endAddress || "Unbekanntes Ziel"}
                        </div>

                        <div className="mt-1 text-xs text-fb-muted">
                          {formatDate(trip.startedAt)}
                          {" · "}
                          {trip.vehicle.name}
                        </div>
                      </div>

                      <div className="text-left sm:text-right">
                        <div className="font-bold">
                          {formatDistance(
                            trip.distanceMeters,
                          )}{" "}
                          km
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-bold">
                Strecke pro Monat
              </h2>

              <p className="mt-1 text-sm text-fb-muted">
                Die vergangenen sechs Monate
              </p>

              <div className="mt-6 space-y-4">
                {data.monthlyDistance.map((item) => {
                  const width = Math.max(
                    3,
                    (item.distanceMeters /
                      maximumMonthlyDistance) *
                      100,
                  );

                  const label =
                    new Intl.DateTimeFormat("de-DE", {
                      month: "short",
                      year: "2-digit",
                    }).format(
                      new Date(`${item.month}-01T12:00:00`),
                    );

                  return (
                    <div key={item.month}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="font-medium">
                          {label}
                        </span>

                        <span className="text-fb-muted">
                          {formatDistance(
                            item.distanceMeters,
                          )}{" "}
                          km
                        </span>
                      </div>

                      <div className="h-2.5 overflow-hidden rounded-full bg-fb-surface">
                        <div
                          className="h-full rounded-full bg-fb-accent"
                          style={{
                            width: `${width}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
