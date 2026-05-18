import { setupDevPlatform } from '@cloudflare/next-on-pages/next-dev';

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },
};

// For local development with `next dev`, set up the Cloudflare dev platform
if (process.env.NODE_ENV === 'development') {
  await setupDevPlatform();
}

export default nextConfig;
