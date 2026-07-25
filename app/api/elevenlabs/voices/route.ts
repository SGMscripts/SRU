const ELEVENLABS_API_ORIGIN = "https://api.elevenlabs.io";
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 80;
const DEFAULT_TIMEOUT_MS = 8_000;
const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;
const ALLOWED_QUERY_PARAMETERS = new Set(["search", "page_size", "voice_ids"]);
const ALLOWED_CURRENT_VOICE_IDS = new Set([
  "cPoqAvGWCPfCfyPMwe4z",
  "si0svtk05vPEuvwAW93c",
]);

const PUBLIC_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=900";
const PRIVATE_CACHE_CONTROL = "private, max-age=60";
const NO_STORE_CACHE_CONTROL = "no-store";

type UnknownObject = Record<string, unknown>;

export type VoiceCatalogItem = {
  voiceId: string;
  name: string;
  category: string | null;
  description: string | null;
  labels: Record<string, string>;
  previewUrl: string | null;
};

type CatalogDependencies = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

class RequestValidationError extends Error {}
class UpstreamResponseError extends Error {}

function jsonResponse(body: unknown, status: number, cacheControl: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": cacheControl,
      "Content-Type": "application/json; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorResponse(status: number, code: string, message: string) {
  return jsonResponse({ error: message, code }, status, NO_STORE_CACHE_CONTROL);
}

function isObject(value: unknown): value is UnknownObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanPreviewUrl(value: unknown) {
  const candidate = cleanText(value, 2_048);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function cleanLabels(value: unknown) {
  if (!isObject(value)) return {};
  const labels: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 24)) {
    const key = cleanText(rawKey, 64);
    const label = cleanText(rawValue, 160);
    if (
      key
      && label
      && key !== "__proto__"
      && key !== "constructor"
      && key !== "prototype"
    ) {
      labels[key] = label;
    }
  }
  return labels;
}

function sanitizeVoice(value: unknown): VoiceCatalogItem | null {
  if (!isObject(value)) return null;
  const voiceId = cleanText(value.voice_id, 64);
  const name = cleanText(value.name, 160);
  if (!voiceId || !VOICE_ID_PATTERN.test(voiceId) || !name) return null;
  return {
    voiceId,
    name,
    category: cleanText(value.category, 64),
    description: cleanText(value.description, 600),
    labels: cleanLabels(value.labels),
    previewUrl: cleanPreviewUrl(value.preview_url),
  };
}

function readSingleQueryParameter(searchParams: URLSearchParams, name: string) {
  const values = searchParams.getAll(name);
  if (values.length > 1) {
    throw new RequestValidationError(`Use ${name} only once.`);
  }
  return values[0];
}

function parseRequest(request: Request) {
  const url = new URL(request.url);
  for (const name of url.searchParams.keys()) {
    if (!ALLOWED_QUERY_PARAMETERS.has(name)) {
      throw new RequestValidationError(`Unsupported query parameter: ${name}.`);
    }
  }

  const rawSearch = readSingleQueryParameter(url.searchParams, "search");
  const search = rawSearch?.trim() || "";
  if (search.length > MAX_SEARCH_LENGTH || /[\u0000-\u001f\u007f]/.test(search)) {
    throw new RequestValidationError(`Search must be ${MAX_SEARCH_LENGTH} characters or fewer.`);
  }

  const rawPageSize = readSingleQueryParameter(url.searchParams, "page_size");
  const pageSize = rawPageSize === undefined ? DEFAULT_PAGE_SIZE : Number(rawPageSize);
  if (
    !Number.isInteger(pageSize)
    || pageSize < 1
    || pageSize > MAX_PAGE_SIZE
    || (rawPageSize !== undefined && !/^[1-9]\d*$/.test(rawPageSize))
  ) {
    throw new RequestValidationError(`page_size must be an integer from 1 to ${MAX_PAGE_SIZE}.`);
  }

  const rawVoiceIds = readSingleQueryParameter(url.searchParams, "voice_ids");
  let currentVoiceIds: string[] = [];
  if (rawVoiceIds !== undefined) {
    if (!rawVoiceIds.trim() || rawVoiceIds.length > 256) {
      throw new RequestValidationError("voice_ids must contain one to three valid voice IDs.");
    }
    const ids = rawVoiceIds.split(",").map((value) => value.trim());
    if (
      ids.some((voiceId) => !VOICE_ID_PATTERN.test(voiceId))
      || ids.length > ALLOWED_CURRENT_VOICE_IDS.size
      || new Set(ids).size !== ids.length
      || ids.some((voiceId) => !ALLOWED_CURRENT_VOICE_IDS.has(voiceId))
    ) {
      throw new RequestValidationError("voice_ids contains an unavailable voice.");
    }
    currentVoiceIds = ids;
  }

  return { search, pageSize, currentVoiceIds };
}

function upstreamHeaders(apiKey: string) {
  return {
    Accept: "application/json",
    "xi-api-key": apiKey,
  };
}

async function parseUpstreamJson(response: Response) {
  try {
    return await response.json() as unknown;
  } catch {
    throw new UpstreamResponseError("ElevenLabs returned an unreadable response.");
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export async function handleVoiceCatalogRequest(
  request: Request,
  dependencies: CatalogDependencies = {},
) {
  const apiKey = dependencies.apiKey?.trim();
  if (!apiKey) {
    return errorResponse(
      503,
      "ELEVENLABS_NOT_CONFIGURED",
      "The ElevenLabs voice catalog is not configured.",
    );
  }

  let query: ReturnType<typeof parseRequest>;
  try {
    query = parseRequest(request);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return errorResponse(400, "INVALID_QUERY", error.message);
    }
    return errorResponse(400, "INVALID_QUERY", "The voice catalog request is invalid.");
  }

  const fetchImpl = dependencies.fetchImpl || fetch;
  const timeoutMs = Math.max(100, Math.min(dependencies.timeoutMs || DEFAULT_TIMEOUT_MS, 15_000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const listUrl = new URL("/v2/voices", ELEVENLABS_API_ORIGIN);
    listUrl.searchParams.set("voice_type", "default");
    listUrl.searchParams.set("page_size", String(query.pageSize));
    listUrl.searchParams.set("sort", "name");
    listUrl.searchParams.set("sort_direction", "asc");
    listUrl.searchParams.set("include_total_count", "false");
    if (query.search) listUrl.searchParams.set("search", query.search);

    const listResponse = await fetchImpl(listUrl, {
      method: "GET",
      headers: upstreamHeaders(apiKey),
      signal: controller.signal,
    });
    if (!listResponse.ok) {
      throw new UpstreamResponseError(`ElevenLabs voice list failed with status ${listResponse.status}.`);
    }

    const listBody = await parseUpstreamJson(listResponse);
    if (!isObject(listBody) || !Array.isArray(listBody.voices)) {
      throw new UpstreamResponseError("ElevenLabs returned an invalid voice list.");
    }

    const voicesById = new Map<string, VoiceCatalogItem>();
    for (const value of listBody.voices) {
      const voice = sanitizeVoice(value);
      if (voice && !voicesById.has(voice.voiceId) && voicesById.size < query.pageSize) {
        voicesById.set(voice.voiceId, voice);
      }
    }

    const missingCurrentVoiceIds = query.currentVoiceIds.filter((voiceId) => !voicesById.has(voiceId));
    const currentVoiceResults = await Promise.allSettled(
      missingCurrentVoiceIds.map(async (voiceId) => {
        const detailUrl = new URL(`/v1/voices/${encodeURIComponent(voiceId)}`, ELEVENLABS_API_ORIGIN);
        const response = await fetchImpl(detailUrl, {
          method: "GET",
          headers: upstreamHeaders(apiKey),
          signal: controller.signal,
        });
        if (!response.ok) return null;
        return sanitizeVoice(await parseUpstreamJson(response));
      }),
    );
    currentVoiceResults.forEach((result) => {
      if (result.status === "fulfilled" && result.value) {
        voicesById.set(result.value.voiceId, result.value);
      }
    });

    const voices = [...voicesById.values()].sort((left, right) => (
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
      || left.voiceId.localeCompare(right.voiceId)
    ));
    return jsonResponse(
      { voices, source: "elevenlabs" },
      200,
      query.currentVoiceIds.length ? PRIVATE_CACHE_CONTROL : PUBLIC_CACHE_CONTROL,
    );
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      return errorResponse(
        504,
        "ELEVENLABS_TIMEOUT",
        "The ElevenLabs voice catalog took too long to respond.",
      );
    }
    return errorResponse(
      502,
      "ELEVENLABS_UNAVAILABLE",
      "The ElevenLabs voice catalog is temporarily unavailable.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  return handleVoiceCatalogRequest(request, {
    apiKey: process.env.ELEVENLABS_API_KEY,
  });
}
