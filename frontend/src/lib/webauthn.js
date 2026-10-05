function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function creationOptions(options) {
  if (window.PublicKeyCredential?.parseCreationOptionsFromJSON) {
    return PublicKeyCredential.parseCreationOptionsFromJSON(options);
  }

  return {
    ...options,
    challenge: decodeBase64Url(options.challenge),
    user: { ...options.user, id: decodeBase64Url(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((item) => ({
      ...item,
      id: decodeBase64Url(item.id),
    })),
  };
}

function requestOptions(options) {
  if (window.PublicKeyCredential?.parseRequestOptionsFromJSON) {
    return PublicKeyCredential.parseRequestOptionsFromJSON(options);
  }

  return {
    ...options,
    challenge: decodeBase64Url(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((item) => ({
      ...item,
      id: decodeBase64Url(item.id),
    })),
  };
}

function commonCredential(credential) {
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
  };
}

export async function createPasskey(options) {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    throw new Error("Dieser Browser unterstützt keine Passkeys.");
  }

  const credential = await navigator.credentials.create({
    publicKey: creationOptions(options),
  });

  if (!credential) throw new Error("Die Passkey-Erstellung wurde abgebrochen.");

  return {
    ...commonCredential(credential),
    response: {
      clientDataJSON: encodeBase64Url(credential.response.clientDataJSON),
      attestationObject: encodeBase64Url(credential.response.attestationObject),
      transports: credential.response.getTransports?.() || [],
      publicKeyAlgorithm: credential.response.getPublicKeyAlgorithm?.(),
      publicKey: credential.response.getPublicKey
        ? encodeBase64Url(credential.response.getPublicKey())
        : undefined,
      authenticatorData: credential.response.getAuthenticatorData
        ? encodeBase64Url(credential.response.getAuthenticatorData())
        : undefined,
    },
  };
}

export async function authenticateWithPasskey(options) {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    throw new Error("Dieser Browser unterstützt keine Passkeys.");
  }

  const credential = await navigator.credentials.get({
    publicKey: requestOptions(options),
  });

  if (!credential) throw new Error("Die Passkey-Anmeldung wurde abgebrochen.");

  return {
    ...commonCredential(credential),
    response: {
      clientDataJSON: encodeBase64Url(credential.response.clientDataJSON),
      authenticatorData: encodeBase64Url(credential.response.authenticatorData),
      signature: encodeBase64Url(credential.response.signature),
      userHandle: credential.response.userHandle
        ? encodeBase64Url(credential.response.userHandle)
        : undefined,
    },
  };
}
