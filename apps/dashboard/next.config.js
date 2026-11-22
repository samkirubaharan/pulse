/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @duckdb/node-api is a native addon and must not be bundled on the server.
  // Mark it as an external so Next's server bundler leaves `require('@duckdb/node-api')`
  // in place to be resolved from node_modules at runtime.
  experimental: {
    serverComponentsExternalPackages: ['@duckdb/node-api'],
    // Required so instrumentation.ts runs on dev/prod boot and starts the cron.
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
