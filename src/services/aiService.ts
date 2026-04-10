/**
 * Tally.app – AI receipt analysis via secure Supabase Edge Function proxy.
 * No provider API keys are used client-side.
 */

import { supabase } from './supabase';

const PROMPT_TEXT =
  'Analyze this receipt image. Return ONLY valid JSON, nothing else. Use this exact structure: ' +
  '{"total": number, "description": "merchant or store name", "items": [{"name": "string", "price": number}, ...]}. ' +
  'Extract every individual line item from the receipt (product or service name and its price). ' +
  'Ignore taxes and tips as separate items unless clearly marked on the receipt. ' +
  'Ensure the sum of all item prices roughly matches the total (small rounding differences are acceptable). ' +
  'If the image is blurry, empty, not a receipt, or you cannot clearly find a total amount, return EXACTLY: {"total": null, "description": null, "items": []}. ' +
  'NEVER invent data. NEVER use placeholder or example names (e.g. BestBuy, Walmart, or generic names).';

export interface ReceiptItem {
  name: string;
  price: number;
}

export interface AnalyzeReceiptResult {
  /** Merchant / store name (from description or legacy store). */
  store: string;
  total: number;
  /** Line items when AI extracted them; empty or undefined for fallback to standard mode. */
  items?: ReceiptItem[];
}

/** Error message used when API returns 429 (rate limit / daily quota). */
export const AI_ERROR_QUOTA = 'QUOTA_EXCEEDED';
/** Error message when AI could not extract store or total from the receipt. */
export const AI_ERROR_INVALID_RESULT = 'INVALID_RECEIPT_RESULT';

/**
 * Strip data URL prefix so only raw base64 is sent.
 * Handles "data:image/jpeg;base64,XXXX" -> "XXXX"
 */
function cleanBase64(uriOrBase64: string): string {
  const trimmed = (uriOrBase64 || '').trim();
  if (trimmed.includes(',')) {
    const afterComma = trimmed.split(',')[1];
    if (afterComma) return afterComma.trim();
  }
  return trimmed.replace(/^data:image\/\w+;base64,/, '').trim();
}

type AiProxyModel = 'gemini' | 'groq';

async function invokeAiProxy(model: AiProxyModel, base64: string): Promise<string> {
  const sessionRes = await supabase.auth.getSession();
  const session = sessionRes.data?.session ?? null;
  if (!session) throw new Error('Has d’iniciar sessió per utilitzar la IA');
  if (!session.access_token || typeof session.access_token !== 'string' || !session.access_token.trim()) {
    throw new Error('Has d’iniciar sessió per utilitzar la IA');
  }

  // Debug: helps confirm the client is sending the token to the Edge Function.
  // Avoid logging the raw token itself.
  // eslint-disable-next-line no-console
  console.log('Sessió actual:', { ...session, access_token: '[REDACTED]' });

  const payload = {
    model,
    message: PROMPT_TEXT,
    imageBase64: base64,
  };

  // IMPORTANT: send Authorization header explicitly using the session access token.
  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: payload,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    const status = (error as { context?: { status?: number } })?.context?.status;
    if (status === 429) throw new Error(AI_ERROR_QUOTA);
    if (status === 403 || status === 402) throw new Error('Necessites Premium per utilitzar la IA.');
    throw new Error(error.message || 'No s\'ha pogut contactar amb el proxy IA.');
  }

  const responsePayload = (data ?? {}) as { text?: string; error?: string; code?: string };
  if (responsePayload.code === AI_ERROR_QUOTA) throw new Error(AI_ERROR_QUOTA);
  if (responsePayload.error) throw new Error(responsePayload.error);
  if (!responsePayload.text?.trim()) {
    throw new Error('La IA no ha retornat cap dada. Torna a provar o introdueix la despesa manualment.');
  }
  return responsePayload.text.trim();
}

/**
 * Sends the receipt image (base64) to AI. Tries Gemini (all models); on any failure logs and does NOT throw.
 * Then always tries Groq. Only if Groq also fails do we throw (e.g. AI_ERROR_QUOTA or other) to the UI.
 * User sees "Límit assolit" only when BOTH providers are exhausted (e.g. both 429).
 */
export async function analyzeReceipt(base64Image: string): Promise<AnalyzeReceiptResult> {
  const base64 = cleanBase64(base64Image);

  // 1) Try Gemini through secure server-side proxy.
  try {
    const text = await invokeAiProxy('gemini', base64);
    return parseReceiptJson(text);
  } catch (geminiError) {
    if (geminiError instanceof Error && geminiError.message === AI_ERROR_QUOTA) {
      // fall through to secondary provider
    }
  }

  // 2) Fallback: Groq through secure server-side proxy.
  return await analyzeWithGroq(base64);
}

/** Shared parsing for Gemini and Groq: strip markdown, parse JSON, return store + total + optional items. */
function parseReceiptJson(text: string): AnalyzeReceiptResult {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  let parsed: {
    store?: string | null;
    description?: string | null;
    total?: number | null;
    items?: Array<{ name?: string; price?: number }> | null;
  };
  try {
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    throw new Error('La IA no ha retornat el format esperat. Introdueix la despesa manualment.');
  }
  const totalVal = parsed.total;
  if (totalVal === null || totalVal === undefined) {
    throw new Error(AI_ERROR_INVALID_RESULT);
  }
  const total = typeof totalVal === 'number' ? Number(Number(totalVal).toFixed(2)) : 0;
  const store =
    (typeof parsed.description === 'string' && parsed.description.trim()
      ? parsed.description.trim()
      : typeof parsed.store === 'string' && parsed.store.trim()
        ? parsed.store.trim()
        : '') as string;
  if (!store || !(typeof totalVal === 'number' && !Number.isNaN(totalVal) && totalVal > 0)) {
    throw new Error(AI_ERROR_INVALID_RESULT);
  }
  const items: ReceiptItem[] = [];
  if (Array.isArray(parsed.items) && parsed.items.length > 0) {
    for (const row of parsed.items) {
      const name = typeof row?.name === 'string' ? row.name.trim() : '';
      const price = typeof row?.price === 'number' && !Number.isNaN(row.price) ? Number(Number(row.price).toFixed(2)) : 0;
      if (name && price > 0) items.push({ name, price });
    }
  }
  return { store, total, items: items.length > 0 ? items : undefined };
}

/** Groq / Llama 3.2 Vision – fallback when Gemini fails. */
export async function analyzeWithGroq(base64Image: string): Promise<AnalyzeReceiptResult> {
  const base64 = cleanBase64(base64Image);
  const text = await invokeAiProxy('groq', base64);
  return parseReceiptJson(text);
}
