import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://kroway.app/sitemap.xml",
    host: "https://kroway.app",
  };
}
