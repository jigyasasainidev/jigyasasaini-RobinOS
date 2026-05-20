import { Helmet } from "react-helmet-async";

type PageSeoProps = {
  title: string;
  description: string;
  canonicalPath: string;
  ogType?: "website" | "article";
  keywords?: string;
  noindex?: boolean;
  structuredData?: Record<string, unknown> | Array<Record<string, unknown>>;
};

export function PageSeo({ title, description, canonicalPath, ogType = "website", keywords, noindex = false, structuredData }: PageSeoProps) {
  const schemas = Array.isArray(structuredData) ? structuredData : structuredData ? [structuredData] : [];

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      {keywords ? <meta name="keywords" content={keywords} /> : null}
      {noindex ? <meta name="robots" content="noindex, nofollow" /> : null}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={canonicalPath} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <link rel="canonical" href={canonicalPath} />
      {schemas.map((schema, index) => (
        <script key={`${canonicalPath}-schema-${index}`} type="application/ld+json">
          {JSON.stringify(schema)}
        </script>
      ))}
    </Helmet>
  );
}