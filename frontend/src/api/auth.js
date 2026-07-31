export async function login({ email, password, totp }) {
  const response = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      totp: totp || undefined,
      deviceName: "Webbrowser",
    }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.message || "Anmeldung fehlgeschlagen.");
  }

  return body;
}