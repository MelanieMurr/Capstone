import type { NextConfig } from "next";

const config: NextConfig = {
  // OAuth authorization codes and returning account hints must not enter dev logs.
  logging: { incomingRequests: { ignore: [/\/auth\/callback(?:\?|$)/] } },
  outputFileTracingExcludes: { "/*": ["./.local/**/*", "./.env*"] },
};
export default config;
