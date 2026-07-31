import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

import { config } from "../config.js";
import { hashToken } from "./tokens.js";

export async function createRegistrationOptions(user, passkeys) {
  return generateRegistrationOptions({
    rpName: config.webauthn.rpName,
    rpID: config.webauthn.rpId,
    userName: user.email,
    userDisplayName: user.display_name || user.username || user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    timeout: 60_000,
    excludeCredentials: passkeys.map((passkey) => ({
      id: passkey.credential_id,
      transports: passkey.transports || [],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    supportedAlgorithmIDs: [-7, -257],
  });
}

export async function createAuthenticationOptions() {
  return generateAuthenticationOptions({
    rpID: config.webauthn.rpId,
    timeout: 60_000,
    allowCredentials: [],
    userVerification: "preferred",
  });
}

export async function verifyPasskeyRegistration(response, matchesChallenge) {
  return verifyRegistrationResponse({
    response,
    expectedChallenge: async (challenge) =>
      matchesChallenge(hashToken(challenge)),
    expectedOrigin: config.webauthn.origin,
    expectedRPID: config.webauthn.rpId,
    requireUserVerification: false,
  });
}

export async function verifyPasskeyAuthentication(
  response,
  passkey,
  matchesChallenge,
) {
  return verifyAuthenticationResponse({
    response,
    expectedChallenge: async (challenge) =>
      matchesChallenge(hashToken(challenge)),
    expectedOrigin: config.webauthn.origin,
    expectedRPID: config.webauthn.rpId,
    credential: {
      id: passkey.credential_id,
      publicKey: new Uint8Array(passkey.public_key),
      counter: Number(passkey.counter),
      transports: passkey.transports || [],
    },
    requireUserVerification: false,
  });
}
