import countries from "world-countries";
import type { AggregatePoint } from "./aggregation";

export interface GeoLocation {
  latitude: number;
  longitude: number;
  canonicalName: string;
  kind: "country" | "city" | "coordinates";
}

export interface GeoPoint extends GeoLocation {
  label: string;
  value: number;
}

export interface GeoPointResult {
  points: GeoPoint[];
  unresolved: string[];
}

type City = readonly [latitude: number, longitude: number, canonicalName: string, ...aliases: string[]];

const CITIES: City[] = [
  [41.9028, 12.4964, "Roma", "Rome"], [45.4642, 9.1900, "Milano", "Milan"], [45.0703, 7.6869, "Torino", "Turin"],
  [40.8518, 14.2681, "Napoli", "Naples"], [43.7696, 11.2558, "Firenze", "Florence"], [44.4949, 11.3426, "Bologna"],
  [48.8566, 2.3522, "Parigi", "Paris"], [51.5074, -0.1278, "Londra", "London"], [52.5200, 13.4050, "Berlino", "Berlin"],
  [40.4168, -3.7038, "Madrid"], [41.3874, 2.1686, "Barcellona", "Barcelona"], [38.7223, -9.1393, "Lisbona", "Lisbon", "Lisboa"],
  [48.2082, 16.3738, "Vienna"], [47.3769, 8.5417, "Zurigo", "Zurich"], [46.2044, 6.1432, "Ginevra", "Geneva"],
  [52.3676, 4.9041, "Amsterdam"], [50.8503, 4.3517, "Bruxelles", "Brussels"], [50.0755, 14.4378, "Praga", "Prague"],
  [52.2297, 21.0122, "Varsavia", "Warsaw"], [37.9838, 23.7275, "Atene", "Athens"], [41.0082, 28.9784, "Istanbul"],
  [55.7558, 37.6173, "Mosca", "Moscow"], [50.4501, 30.5234, "Kyiv", "Kiev"], [59.3293, 18.0686, "Stoccolma", "Stockholm"],
  [59.9139, 10.7522, "Oslo"], [55.6761, 12.5683, "Copenaghen", "Copenhagen"], [60.1699, 24.9384, "Helsinki"], [53.3498, -6.2603, "Dublino", "Dublin"],
  [40.7128, -74.0060, "New York", "NYC", "New York City"], [34.0522, -118.2437, "Los Angeles", "LA"],
  [37.7749, -122.4194, "San Francisco", "SF"], [41.8781, -87.6298, "Chicago"], [25.7617, -80.1918, "Miami"],
  [43.6532, -79.3832, "Toronto"], [49.2827, -123.1207, "Vancouver"], [19.4326, -99.1332, "Città del Messico", "Mexico City", "Ciudad de Mexico"],
  [-23.5505, -46.6333, "San Paolo", "Sao Paulo", "São Paulo"], [-22.9068, -43.1729, "Rio de Janeiro", "Rio"],
  [-34.6037, -58.3816, "Buenos Aires"], [-33.4489, -70.6693, "Santiago"], [4.7110, -74.0721, "Bogotá", "Bogota"], [-12.0464, -77.0428, "Lima"],
  [35.6762, 139.6503, "Tokyo", "Tokio"], [34.6937, 135.5023, "Osaka"], [37.5665, 126.9780, "Seul", "Seoul"],
  [39.9042, 116.4074, "Pechino", "Beijing"], [31.2304, 121.4737, "Shanghai"], [22.3193, 114.1694, "Hong Kong"],
  [1.3521, 103.8198, "Singapore", "Singapore City"], [13.7563, 100.5018, "Bangkok"], [28.6139, 77.2090, "Nuova Delhi", "New Delhi", "Delhi"],
  [19.0760, 72.8777, "Mumbai", "Bombay"], [25.2048, 55.2708, "Dubai"], [24.4539, 54.3773, "Abu Dhabi"], [25.2854, 51.5310, "Doha"],
  [30.0444, 31.2357, "Il Cairo", "Cairo"], [-33.9249, 18.4241, "Città del Capo", "Cape Town"], [-26.2041, 28.0473, "Johannesburg"],
  [6.5244, 3.3792, "Lagos"], [-1.2921, 36.8219, "Nairobi"], [-33.8688, 151.2093, "Sydney"], [-37.8136, 144.9631, "Melbourne"],
  [-36.8509, 174.7645, "Auckland"], [33.5731, -7.5898, "Casablanca"], [31.6295, -7.9811, "Marrakech"],
];

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

const cityIndex = new Map<string, GeoLocation>();
for (const [latitude, longitude, canonicalName, ...aliases] of CITIES) {
  const location: GeoLocation = { latitude, longitude, canonicalName, kind: "city" };
  for (const alias of [canonicalName, ...aliases]) cityIndex.set(normalize(alias), location);
}

const countryIndex = new Map<string, GeoLocation>();
for (const country of countries) {
  const [latitude, longitude] = country.latlng;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
  const location: GeoLocation = { latitude, longitude, canonicalName: country.translations.ita?.common || country.name.common, kind: "country" };
  const translated = Object.values(country.translations).flatMap(name => [name.common, name.official]);
  const aliases = [country.cca2, country.cca3, country.ccn3, country.cioc, country.name.common, country.name.official, ...country.altSpellings, ...translated];
  for (const alias of aliases) if (alias) countryIndex.set(normalize(alias), location);
}

export function resolveGeoLocation(value: unknown): GeoLocation | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const coordinates = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (coordinates) {
    const latitude = Number(coordinates[1]);
    const longitude = Number(coordinates[2]);
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude, canonicalName: text, kind: "coordinates" };
  }
  const key = normalize(text);
  const exact = cityIndex.get(key) ?? countryIndex.get(key);
  if (exact) return exact;
  const parts = text.split(/[,/|]/).map(normalize).filter(Boolean);
  for (const part of parts) {
    const city = cityIndex.get(part);
    if (city) return city;
  }
  for (const part of parts.reverse()) {
    const country = countryIndex.get(part);
    if (country) return country;
  }
  return null;
}

export function buildGeoPoints(source: AggregatePoint[]): GeoPointResult {
  const unresolved: string[] = [];
  const grouped = new Map<string, GeoPoint>();
  for (const point of source) {
    const location = resolveGeoLocation(point.label);
    if (!location) { unresolved.push(point.label); continue; }
    const key = `${location.latitude.toFixed(4)}:${location.longitude.toFixed(4)}`;
    const current = grouped.get(key);
    if (current) current.value += point.value;
    else grouped.set(key, { ...location, label: point.label, value: point.value });
  }
  return { points: [...grouped.values()], unresolved };
}
