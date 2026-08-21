import type { MetadataRoute } from "next";

const baseUrl = process.env.APP_BASE_URL ?? "https://drainly.net";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${baseUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/contractors`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/service-area/johnston-county-nc`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/service-area/harnett-county-nc`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${baseUrl}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
