export function documentPathToRoute(documentPath: string) {
  const pathWithoutExtension = documentPath.replace(/\.json$/i, "");
  const segments = pathWithoutExtension.split("/").filter(Boolean).map(encodeURIComponent);
  return `/documents/${segments.join("/")}`;
}

export function routeToDocumentPath(pathname: string) {
  const prefix = "/documents/";

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const routePath = pathname.slice(prefix.length);
  if (!routePath) {
    return null;
  }

  const decodedPath = routePath.split("/").filter(Boolean).map(decodeURIComponent).join("/");
  return decodedPath.toLowerCase().endsWith(".json") ? decodedPath : `${decodedPath}.json`;
}

export function documentTitle(documentPath: string) {
  return (documentPath.split("/").at(-1) ?? documentPath).replace(/\.json$/i, "");
}

export function filePathWithExtension(filePath: string) {
  return filePath.toLowerCase().endsWith(".json") ? filePath : `${filePath}.json`;
}
