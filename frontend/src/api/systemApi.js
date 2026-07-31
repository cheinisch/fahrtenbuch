import { apiClient } from "./apiClient.js";
export async function getVersion() {
  const { data } = await apiClient.get("/system/version");
  return data;
}
