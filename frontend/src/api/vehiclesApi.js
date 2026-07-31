import { apiClient } from "./apiClient.js";
export async function listVehicles() {
  const { data } = await apiClient.get("/vehicles");
  return data.items;
}
