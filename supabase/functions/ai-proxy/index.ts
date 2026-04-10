// Supabase Edge runtime provides `Deno` at execution time; Cursor TS may not type it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Deno: any;

// @ts-ignore - ESM remote import provided by the Supabase Edge runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ProxyBody = {
  model?: 'groq' | 'gemini';
  message?: string;
  imageBase64?: string;
};

const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash-8b'];
const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function cleanBase64(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes(',')) {
    const afterComma = trimmed.split(',')[1];
    if (afterComma) return afterComma.trim();
  }
  return trimmed.replace(/^data:image\/\w+;base64,/, '').trim();
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1]?.trim();
  return token || null;
}

async function callGemini(apiKey: string, message: string, imageBase64: string): Promise<string> {
  const body = {
    contents: [
      {
        parts: [
          { text: message },
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
        ],
      },
    ],
  };

  let lastError: string | null = null;
  for (const model of GEMINI_MODELS) {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();

    if (res.status === 429) {
      throw new Error('QUOTA_EXCEEDED');
    }
    if (!res.ok) {
      lastError = text || `Gemini error ${res.status}`;
      continue;
    }

    let parsed: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new Error('Gemini response is not valid JSON.');
    }
    const out = parsed.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (out) return out;
    throw new Error('Gemini did not return text output.');
  }

  throw new Error(lastError ?? 'Gemini request failed.');
}

async function callGroq(apiKey: string, message: string, imageBase64: string): Promise<string> {
  const imageUrl = `data:image/jpeg;base64,${imageBase64}`;
  const body = {
    model: GROQ_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: message },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    max_tokens: 256,
  };

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();

  if (res.status === 429) throw new Error('QUOTA_EXCEEDED');
  if (!res.ok) throw new Error(text || `Groq error ${res.status}`);

  let parsed: { choices?: Array<{ message?: { content?: string } }> };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error('Groq response is not valid JSON.');
  }

  const out = parsed.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('Groq did not return text output.');
  return out;
}

Deno.serve(async (req: Request) => {
  // Debug: log headers received from the client.
  // Note: do not log raw Authorization token itself.
  console.log('ai-proxy: Incoming request method:', req.method);
  console.log('ai-proxy: Headers rebudes:', Object.fromEntries(req.headers.entries()));

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const rawAuthHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const jwt = getBearerToken(req);
  console.log('ai-proxy: Authorization header present:', Boolean(rawAuthHeader));
  console.log('ai-proxy: Authorization startsWith Bearer (case-insensitive):', Boolean(rawAuthHeader && /^Bearer\s+/i.test(rawAuthHeader)));
  console.log('ai-proxy: Extracted token present:', Boolean(jwt));
  if (jwt) console.log('ai-proxy: Extracted token length:', jwt.length);
  if (!jwt) {
    return jsonResponse({ error: 'Missing bearer token' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: 'Server auth config missing' }, 500);
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  console.log('ai-proxy: Verifying JWT with Supabase auth.getUser() ...');
  const { data: userData, error: userError } = await authClient.auth.getUser(jwt);
  if (userError) console.log('ai-proxy: JWT verification error:', userError);
  if (userData?.user) console.log('ai-proxy: JWT ok. user id:', userData.user.id);
  if (userError || !userData.user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // Premium gating: require users.is_premium = true before spending AI quota.
  const uid = userData.user.id;
  const { data: premiumRow, error: premiumError } = await authClient
    .from('users')
    .select('is_premium')
    .eq('id', uid)
    .maybeSingle();

  if (premiumError) {
    console.log('ai-proxy: premiumRow select error:', premiumError);
    return jsonResponse({ error: 'Premium status unavailable' }, 500);
  }

  const isPremium = Boolean(premiumRow?.is_premium);
  console.log('ai-proxy: is_premium:', isPremium);
  if (!isPremium) {
    return jsonResponse({ error: 'PREMIUM_REQUIRED', code: 'PREMIUM_REQUIRED' }, 402);
  }

  let payload: ProxyBody;
  try {
    payload = (await req.json()) as ProxyBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const model = payload.model;
  const message = (payload.message ?? '').trim();
  const imageBase64 = cleanBase64(payload.imageBase64 ?? '');

  if (model !== 'groq' && model !== 'gemini') {
    return jsonResponse({ error: 'model must be "groq" or "gemini"' }, 400);
  }
  if (!message) {
    return jsonResponse({ error: 'message is required' }, 400);
  }
  if (!imageBase64) {
    return jsonResponse({ error: 'imageBase64 is required' }, 400);
  }

  try {
    if (model === 'gemini') {
      const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
      if (!geminiApiKey) return jsonResponse({ error: 'GEMINI_API_KEY not configured' }, 500);
      const text = await callGemini(geminiApiKey, message, imageBase64);
      return jsonResponse({ text }, 200);
    }

    const groqApiKey = Deno.env.get('GROQ_API_KEY');
    if (!groqApiKey) return jsonResponse({ error: 'GROQ_API_KEY not configured' }, 500);
    const text = await callGroq(groqApiKey, message, imageBase64);
    return jsonResponse({ text }, 200);
  } catch (error) {
    const messageOut = error instanceof Error ? error.message : 'Proxy error';
    if (messageOut === 'QUOTA_EXCEEDED') {
      return jsonResponse({ error: 'Quota exceeded', code: 'QUOTA_EXCEEDED' }, 429);
    }
    return jsonResponse({ error: messageOut }, 500);
  }
});

