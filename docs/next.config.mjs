import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  basePath: '/dbx',
  output: 'export',
  images: { unoptimized: true },
};

export default withMDX(config);
