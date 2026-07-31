import { apiClient } from "./apiClient.js";
export async function listTrips() {
  const { data } = await apiClient.get("/trips");
  return data.items;
}
