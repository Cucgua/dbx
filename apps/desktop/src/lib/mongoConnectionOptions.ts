export function mongoUrlParam(urlParams: string | undefined, key: string): string {
  const params = parseMongoUrlParams(urlParams);
  return params.get(key) || "";
}

export function setMongoUrlParam(urlParams: string | undefined, key: string, value: string): string {
  const params = parseMongoUrlParams(urlParams);
  const normalized = value.trim();
  if (normalized) {
    params.set(key, normalized);
  } else {
    params.delete(key);
  }
  return params.toString();
}

export function mongodbAuthFailureHint(message: string): string {
  if (message.includes("Current authentication database:")) return message;

  const source = message.match(/source='([^']+)'/)?.[1];
  if (!source || !message.includes("Exception authenticating MongoCredential")) return message;

  return `${message}\n\nCurrent authentication database: ${source}. If this user was created in admin, set Authentication database to admin or add authSource=admin to URL params.`;
}

function parseMongoUrlParams(urlParams: string | undefined): URLSearchParams {
  return new URLSearchParams((urlParams || "").trim().replace(/^\?/, ""));
}
