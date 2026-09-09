'use client';

import { useEffect, useState } from 'react';
import { listAddresses } from './addresses';
import { useAuth } from './auth-context';

interface CatalogZoneState {
  isReady: boolean;
  zoneId: string | null;
  canLoadCatalog: boolean;
}

interface ResolvedCustomerZone {
  customerId: string;
  zoneId: string | null;
}

/** Resolves the signed-in customer's active catalog zone from their default address. */
export function useCatalogZone(): CatalogZoneState {
  const { isAuthenticated, isLoading, user, authedFetch } = useAuth();
  const [resolved, setResolved] = useState<ResolvedCustomerZone | null>(null);

  useEffect(() => {
    if (isLoading || !isAuthenticated || !user) return;

    let active = true;
    listAddresses(authedFetch)
      .then((addresses) => {
        if (!active) return;
        const address = addresses.find((item) => item.is_default) ?? addresses[0];
        const zoneId = address?.service_zone_id ?? null;
        setResolved({ customerId: user.id, zoneId });
      })
      .catch(() => {
        // Fail closed for signed-in customers: never leak a service blocked in their zone.
        if (active) setResolved({ customerId: user.id, zoneId: null });
      });

    return () => {
      active = false;
    };
  }, [authedFetch, isAuthenticated, isLoading, user]);

  if (isLoading) return { isReady: false, zoneId: null, canLoadCatalog: false };
  if (!isAuthenticated || !user) return { isReady: true, zoneId: null, canLoadCatalog: true };
  if (resolved?.customerId !== user.id) return { isReady: false, zoneId: null, canLoadCatalog: false };
  return {
    isReady: true,
    zoneId: resolved.zoneId,
    canLoadCatalog: resolved.zoneId !== null,
  };
}
