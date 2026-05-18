import { useEffect, useState } from "react";
import { fetchDiscoveryProviders } from "../api/client.js";

export function useDiscoveryProviders(user) {
  const [discoveryProviders, setDiscoveryProviders] = useState([]);

  useEffect(() => {
    if (!user) {
      setDiscoveryProviders([]);
      return undefined;
    }

    let cancelled = false;

    async function loadProviders() {
      try {
        const payload = await fetchDiscoveryProviders();
        if (!cancelled) {
          setDiscoveryProviders(payload.providers || []);
        }
      } catch {
        if (!cancelled) {
          setDiscoveryProviders([]);
        }
      }
    }

    void loadProviders();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return discoveryProviders;
}
