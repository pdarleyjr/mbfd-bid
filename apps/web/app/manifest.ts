import type { MetadataRoute } from 'next';

/** Uses the supplied MBFD master artwork for installable-app identity. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MBFD Annual Bid Control Center',
    short_name: 'MBFD Bid',
    description: 'Miami Beach Fire Department Annual Bid Control Center',
    start_url: '/',
    display: 'standalone',
    background_color: '#fafaf9',
    theme_color: '#1e293b',
    icons: [
      {
        src: '/icon.png',
        sizes: '1254x1254',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
