import type { MetadataRoute } from "next";

const baseUrl = process.env.APP_BASE_URL ?? "https://drainly.net";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: ["/", "/contractors", "/service-area/"],
      disallow: ["/admin/", "/api/", "/auth/", "/book", "/contractor/", "/customer", "/r/"],
    }],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
