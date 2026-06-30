/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
    serverComponentsExternalPackages: ["ffmpeg-static", "fluent-ffmpeg"],
  },
};
export default nextConfig;
