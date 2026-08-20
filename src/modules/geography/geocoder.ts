import "server-only";

import { getServerEnv } from "@/lib/env";

export interface AddressInput {
  addressLine1: string;
  city: string;
  stateCode: string;
  postalCode: string;
}

export interface NormalizedAddress extends AddressInput {
  addressLine2: string | null;
  countyName: string;
  normalizedAddress: string;
  latitude: number;
  longitude: number;
  regionKey: string | null;
}

export interface Geocoder { normalize(input: AddressInput): Promise<NormalizedAddress> }

const countyRegions: Record<string, string> = {
  "Johnston County": "US-NC-JOHNSTON",
  "Harnett County": "US-NC-HARNETT",
};

export class FakeGeocoder implements Geocoder {
  async normalize(input: AddressInput): Promise<NormalizedAddress> {
    const stateCode = input.stateCode.trim().toUpperCase();
    const city = input.city.trim();
    const postalCode = input.postalCode.trim();
    let countyName = "Unsupported County";
    if (["27577", "27520", "27524", "27527", "27529", "27542", "27569", "27576", "27591", "27593", "27597"].includes(postalCode)) countyName = "Johnston County";
    if (["27501", "27504", "27505", "27506", "27521", "27526", "27543", "27546", "27552", "27592", "28323", "28334", "28339", "28368"].includes(postalCode)) countyName = "Harnett County";
    return {
      addressLine1: input.addressLine1.trim(),
      addressLine2: null,
      city,
      stateCode,
      postalCode,
      countyName,
      normalizedAddress: `${input.addressLine1.trim()}, ${city}, ${stateCode} ${postalCode}`,
      latitude: countyName === "Johnston County" ? 35.5085 : countyName === "Harnett County" ? 35.3993 : 35.7796,
      longitude: countyName === "Johnston County" ? -78.3394 : countyName === "Harnett County" ? -78.8159 : -78.6382,
      regionKey: countyRegions[countyName] ?? null,
    };
  }
}

export class GoogleGeocoder implements Geocoder {
  constructor(private readonly apiKey: string) {}

  async normalize(input: AddressInput): Promise<NormalizedAddress> {
    const address = `${input.addressLine1}, ${input.city}, ${input.stateCode} ${input.postalCode}`;
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", address);
    url.searchParams.set("components", "country:US");
    url.searchParams.set("key", this.apiKey);
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error("GEOCODING_PROVIDER_FAILED");
    const payload = await response.json() as {
      status: string;
      results: Array<{
        formatted_address: string;
        address_components: Array<{ long_name: string; short_name: string; types: string[] }>;
        geometry: { location: { lat: number; lng: number } };
      }>;
    };
    const result = payload.results[0];
    if (payload.status !== "OK" || !result) throw new Error("ADDRESS_NOT_FOUND");
    const component = (type: string) => result.address_components.find((item) => item.types.includes(type));
    const countyName = component("administrative_area_level_2")?.long_name ?? "";
    const stateCode = component("administrative_area_level_1")?.short_name ?? "";
    const postalCode = component("postal_code")?.short_name ?? input.postalCode;
    const country = component("country")?.short_name;
    if (country !== "US" || stateCode !== "NC") throw new Error("ADDRESS_OUTSIDE_NORTH_CAROLINA");
    return {
      addressLine1: input.addressLine1.trim(),
      addressLine2: null,
      city: component("locality")?.long_name ?? component("postal_town")?.long_name ?? input.city.trim(),
      stateCode,
      postalCode,
      countyName,
      normalizedAddress: result.formatted_address,
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
      regionKey: countyRegions[countyName] ?? null,
    };
  }
}

export function getGeocoder(): Geocoder {
  const env = getServerEnv();
  return env.PROVIDER_MODE === "real" ? new GoogleGeocoder(env.GOOGLE_MAPS_SERVER_KEY!) : new FakeGeocoder();
}
