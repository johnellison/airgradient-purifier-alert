const API_ROOT = "https://api.airgradient.com/public/api/v1";

const numberOrNull = (value) => value === null || value === undefined || value === "" ? null : Number(value);
const prefer = (object, corrected, raw) => numberOrNull(object[corrected] ?? object[raw]);

export function normalizeReading(payload, expectedLocationId) {
  const item = Array.isArray(payload) ? payload.find((row) => String(row.locationId) === String(expectedLocationId)) : payload;
  if (!item || String(item.locationId) !== String(expectedLocationId)) throw new Error("Configured AirGradient location was not returned");
  if (!item.timestamp) throw new Error("AirGradient response has no timestamp");
  return {
    locationId: String(item.locationId), timestamp: new Date(item.timestamp).toISOString(),
    pm25: prefer(item, "pm02_corrected", "pm02"), co2: prefer(item, "rco2_corrected", "rco2"),
    temperature: prefer(item, "atmp_corrected", "atmp"), humidity: prefer(item, "rhum_corrected", "rhum"),
    tvoc: numberOrNull(item.tvoc ?? item.tvocIndex), nox: numberOrNull(item.noxIndex)
  };
}

export async function fetchCurrent({ token, locationId, fetchImpl = fetch }) {
  if (!token || !locationId) throw new Error("AirGradient API is not configured");
  const url = new URL(`${API_ROOT}/locations/${encodeURIComponent(locationId)}/measures/current`);
  url.searchParams.set("token", token);
  let response;
  try { response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error("AirGradient request failed"); }
  if (!response.ok) throw new Error(`AirGradient returned HTTP ${response.status}`);
  return normalizeReading(await response.json(), locationId);
}
