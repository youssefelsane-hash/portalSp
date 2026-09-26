'use client';

import Image from 'next/image';
import type { CSSProperties } from 'react';
import { useState } from 'react';

type ImageDimensions =
  | { fill: true; width?: never; height?: never }
  | { fill?: false; width: number; height: number };

type Props = ImageDimensions & {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  sizes: string;
  loading?: 'eager' | 'lazy';
  fetchPriority?: 'high' | 'low' | 'auto';
  onLoad?: () => void;
  onError?: () => void;
};

function canOptimize(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && url.hostname === 'i.ibb.co';
  } catch {
    return false;
  }
}

/** Serve appropriately sized images; fall back to the original if optimization is unavailable. */
export function OptimizedPublicImage({
  src,
  alt,
  className,
  style,
  sizes,
  loading = 'lazy',
  fetchPriority,
  onLoad,
  onError,
  fill,
  width,
  height,
}: Props) {
  const [failedOptimizationSrc, setFailedOptimizationSrc] = useState<string | null>(null);
  if (!canOptimize(src) || failedOptimizationSrc === src) {
    // eslint-disable-next-line @next/next/no-img-element -- unknown host or optimizer fallback
    return <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      width={width}
      height={height}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
      onLoad={onLoad}
      onError={onError}
    />;
  }

  return <Image
    src={src}
    alt={alt}
    className={className}
    style={style}
    sizes={sizes}
    fill={fill}
    width={width}
    height={height}
    loading={loading}
    fetchPriority={fetchPriority}
    onLoad={onLoad}
    onError={() => setFailedOptimizationSrc(src)}
  />;
}
