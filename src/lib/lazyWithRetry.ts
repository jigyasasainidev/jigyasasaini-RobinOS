type Importer<T> = () => Promise<{ default: T }>;

const isChunkLoadError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("loading chunk")
  );
};

export const lazyWithRetry = <T>(importer: Importer<T>, key: string): Importer<T> => {
  return async () => {
    const retryKey = `lazy-retry:${key}`;

    try {
      const mod = await importer();
      sessionStorage.removeItem(retryKey);
      return mod;
    } catch (error) {
      const alreadyRetried = sessionStorage.getItem(retryKey) === "1";

      if (isChunkLoadError(error) && !alreadyRetried) {
        sessionStorage.setItem(retryKey, "1");
        window.location.reload();
        return new Promise(() => {
          // Intentionally unresolved while browser refreshes.
        });
      }

      sessionStorage.removeItem(retryKey);
      throw error;
    }
  };
};