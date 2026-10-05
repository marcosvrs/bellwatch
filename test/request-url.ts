export const requestUrl = (input: RequestInfo | URL): string =>
  input instanceof URL
    ? input.href
    : typeof input === "string"
      ? input
      : input.url;
