/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // reactCompiler: true,
    // ^ Disabled at scaffold time: Next.js 15.0.3 does not auto-install
    // `babel-plugin-react-compiler`. Re-enable in a later task after adding
    // the plugin as a devDependency.
    typedRoutes: true,
  },
  // OpenNext on Cloudflare requires this; lazy server bundling.
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // Edge-runtime by default for our routes; pages-level opt-in per file.
  // Image optimization off (Cloudflare Images handles it later if needed).
  images: { unoptimized: true },
};

export default nextConfig;
