import { useCallback, useEffect, useState } from "react";
import { fetchTracks } from "../api/client.js";
import { pageSize } from "../utils.js";

const emptyPagination = {
  page: 1,
  pageSize,
  totalItems: 0,
  totalPages: 1,
};

const emptyFacets = {
  genres: [],
  sources: [],
  totalTracks: 0,
};

export function useCatalogPage({ user, page, setPage, search, genre, source, setAuthStatus }) {
  // Tiene isolato il catalogo paginato: App.jsx non deve conoscere i dettagli della chiamata API.
  const [catalogTracks, setCatalogTracks] = useState([]);
  const [catalogPagination, setCatalogPagination] = useState(emptyPagination);
  const [catalogFacets, setCatalogFacets] = useState(emptyFacets);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const applyCatalogPayload = useCallback(
    (payload) => {
      setCatalogTracks(payload.tracks || []);
      setCatalogPagination(
        payload.pagination || {
          ...emptyPagination,
          page,
          totalItems: payload.tracks?.length || 0,
        }
      );
      setCatalogFacets(payload.facets || emptyFacets);

      if (payload.pagination?.page && payload.pagination.page !== page) {
        setPage(payload.pagination.page);
      }
    },
    [page, setPage]
  );

  const resetCatalogPage = useCallback(() => {
    setCatalogTracks([]);
    setCatalogPagination(emptyPagination);
    setCatalogFacets(emptyFacets);
    setCatalogLoading(false);
  }, []);

  const refreshCatalogPage = useCallback(async () => {
    if (!user) {
      resetCatalogPage();
      return null;
    }

    const payload = await fetchTracks({
      page,
      limit: pageSize,
      q: search,
      genre,
      source,
    });
    applyCatalogPayload(payload);
    return payload;
  }, [applyCatalogPayload, genre, page, resetCatalogPage, search, source, user]);

  useEffect(() => {
    if (!user) {
      resetCatalogPage();
      return undefined;
    }

    let cancelled = false;
    async function loadCatalogPage() {
      setCatalogLoading(true);
      try {
        const payload = await fetchTracks({
          page,
          limit: pageSize,
          q: search,
          genre,
          source,
        });
        if (!cancelled) {
          applyCatalogPayload(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setCatalogTracks([]);
          setAuthStatus(error.message || "Catalogo non disponibile.");
        }
      } finally {
        if (!cancelled) {
          setCatalogLoading(false);
        }
      }
    }

    void loadCatalogPage();
    return () => {
      cancelled = true;
    };
  }, [applyCatalogPayload, genre, page, resetCatalogPage, search, setAuthStatus, source, user]);

  return {
    catalogTracks,
    catalogPagination,
    catalogFacets,
    catalogLoading,
    refreshCatalogPage,
    resetCatalogPage,
  };
}
