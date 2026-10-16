export const canonicalMyHomePath = (path: string): string | undefined => {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("?") ||
    path.includes("#")
  ) {
    return undefined;
  }
  const canonical = path.replace(/\/+$/, "");
  if (
    !(canonical.startsWith("/residential/") || canonical.startsWith("/rentals/")) ||
    canonical.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return undefined;
  }
  return canonical;
};

interface MyHomePathParts {
  readonly basePath: string;
  readonly canonicalPath: string;
}

export const myHomePathParts = (pathname: string): MyHomePathParts | undefined => {
  let parts: MyHomePathParts | undefined;
  for (const match of pathname.matchAll(/\/(?:residential|rentals)\//g)) {
    const canonicalPath = canonicalMyHomePath(pathname.slice(match.index));
    if (canonicalPath !== undefined) {
      parts = {
        basePath: pathname.slice(0, match.index).replace(/\/+$/, ""),
        canonicalPath,
      };
    }
  }
  return parts;
};

export const sourceIdFromUrl = (url: URL): string => {
  const path = myHomePathParts(url.pathname)?.canonicalPath;
  const segments = path?.split("/").filter(Boolean);
  const sourceId = segments?.at(-1);
  const nonListingRoute = segments?.slice(1, -1).some((segment) =>
    /^(?:agent|agents|estate-agent|estate-agents)$/i.test(segment),
  ) === true;
  if (
    path === undefined ||
    segments === undefined ||
    segments.length < 3 ||
    sourceId === undefined ||
    !/^\d+$/.test(sourceId) ||
    nonListingRoute
  ) {
    throw new Error(`MyHome detail URL must identify a listing: ${url.pathname}`);
  }
  return sourceId;
};

/** Builds canonical residential or rental URLs with optional query parameters and pagination. */
export const buildMyHomeUrl = (
  baseUrl: string,
  canonicalPath: string,
  page = 1,
  searchParams?: URLSearchParams,
): string => {
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`MyHome page must be a positive integer: ${page}`);
  }
  const base = new URL(baseUrl);
  if (base.username !== "" || base.password !== "") {
    throw new Error("MyHome base URL must not contain credentials");
  }
  const url = new URL(canonicalPath, base.origin);
  if (url.origin !== base.origin) {
    throw new Error("MyHome URLs must remain on the configured origin");
  }
  const normalizedPath = canonicalMyHomePath(url.pathname);
  if (normalizedPath === undefined || url.search !== "" || url.hash !== "") {
    throw new Error("MyHome URLs must be canonical /residential or /rentals paths without a query or fragment");
  }
  url.pathname = `${base.pathname.replace(/\/+$/, "")}${normalizedPath}`;
  const query = new URLSearchParams(searchParams);
  if (page > 1) {
    query.set("page", String(page));
  } else {
    query.delete("page");
  }
  url.search = query.toString();
  return url.toString();
};
