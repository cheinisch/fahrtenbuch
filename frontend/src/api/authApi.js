import { apiClient } from "./apiClient.js";
export async function login(credentials) {
  const { data } = await apiClient.post("/auth/login", credentials);
  return data;
}
