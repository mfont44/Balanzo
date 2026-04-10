/**
 * Travel/trip expense categorization from free-text description (ca / es / en keywords).
 * Optional DB field `category` overrides when present (with legacy key mapping).
 */

import type { ExpenseWithPayer } from '@/services/expenses';

export type StatsCategoryKey =
  | 'restauracio'
  | 'supermercat'
  | 'transport'
  | 'activitats'
  | 'allotjament'
  | 'compres'
  | 'altres';

export const STATS_CATEGORY_LABEL: Record<StatsCategoryKey, string> = {
  restauracio: 'Restauració',
  supermercat: 'Supermercat',
  transport: 'Transport',
  activitats: 'Activitats',
  allotjament: 'Allotjament',
  compres: 'Compres',
  altres: 'Altres',
};

/** Cohesive travel palette: food, groceries, mobility, experiences, stay, retail, neutral. */
export const STATS_CATEGORY_COLOR: Record<StatsCategoryKey, string> = {
  restauracio: '#F59E0B',
  supermercat: '#10B981',
  transport: '#3B82F6',
  activitats: '#A855F7',
  allotjament: '#6366F1',
  compres: '#14B8A6',
  altres: '#64748B',
};

/** Donut / legend order (fixed). */
export const STATS_CATEGORY_SORT: StatsCategoryKey[] = [
  'restauracio',
  'supermercat',
  'transport',
  'activitats',
  'allotjament',
  'compres',
  'altres',
];

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Short tokens use word-boundary style matching to reduce false positives. */
function matchesKeyword(normalizedDescription: string, rawKeyword: string): boolean {
  const kw = normalizeForMatch(rawKeyword).trim();
  if (!kw.length) return false;
  if (kw.length <= 4) {
    const padded = ` ${normalizedDescription.replace(/[^a-z0-9]+/gi, ' ')} `;
    return padded.includes(` ${kw} `);
  }
  return normalizedDescription.includes(kw);
}

/**
 * First matching rule wins. Compres is checked before supermercat so phrases like
 * "compra ropa" match retail, while "mercadona" / "supermercat" still hit groceries.
 */
const CATEGORY_RULES: [StatsCategoryKey, string[]][] = [
  [
    'restauracio',
    [
      'restaurant',
      'restauracio',
      'restauración',
      'bar ',
      ' bar',
      'bar-',
      'sopar',
      'cena',
      'dinar',
      'dinner',
      'lunch',
      'esmorzar',
      'desayuno',
      'breakfast',
      'brunch',
      'cafe',
      'cafè',
      'café',
      'cafeteria',
      'coffee',
      'cerve',
      'cervesa',
      'cerveza',
      'beer',
      'copa',
      'wine',
      'vi ',
      'vino ',
      'pizza',
      'burger',
      'hamburguesa',
      'hamburger',
      'tapas',
      'tapes',
      'menjar',
      'comida',
      'food',
      'takeaway',
      'take away',
    ],
  ],
  [
    'transport',
    [
      'vol',
      'vuelo',
      'flight',
      'avio',
      'avión',
      'avion',
      'aeroport',
      'aeropuerto',
      'tren',
      'train',
      'renfe',
      'ave',
      'ouigo',
      'iryo',
      'bus',
      'autocar',
      'autobus',
      'autobús',
      'taxi',
      'uber',
      'cabify',
      'bolt',
      'metro',
      'subway',
      'gasolina',
      'gasoil',
      'benzina',
      'diesel',
      'gas',
      'fuel',
      'parking',
      'aparcament',
      'aparcamiento',
      'peatge',
      'peaje',
      'toll',
      'autopista',
      'autovia',
      'cotxe',
      'coche',
      'car ',
      ' car',
      'blablacar',
      'ferry',
      'transbordador',
      'bitllet',
      'billete',
    ],
  ],
  [
    'activitats',
    [
      'entrada',
      'entradas',
      'ticket',
      'tickets',
      'museo',
      'museu',
      'museum',
      'tour',
      'visita guiada',
      'guia',
      'guide',
      'audioguia',
      'festa',
      'party',
      'club',
      'discoteca',
      'barco',
      'boat',
      'catamaran',
      'crucero',
      'crucer',
      'parc',
      'parque',
      'park ',
      ' park',
      'atraccions',
      'atracciones',
      'festival',
      'concert',
      'concierto',
      'teatre',
      'teatro',
      'cinema',
      'cine',
    ],
  ],
  [
    'allotjament',
    [
      'hotel',
      'hostal',
      'hostel',
      'airbnb',
      'booking',
      'apartamento',
      'apartament',
      'apartment',
      'resort',
      'camping',
      'glamping',
      'bungalow',
      'taxa',
      'tasa',
      'city tax',
      'tourist tax',
      'taxa turistica',
      'tasa turistica',
      'allotjament',
      'alojamiento',
      'accommodation',
      'habitacio',
      'habitación',
      'noches',
      'nits',
    ],
  ],
  [
    'compres',
    [
      'regal',
      'regalo',
      'gift',
      'souvenir',
      'record',
      'ropa',
      'roba',
      'clothes',
      'clothing',
      'shopping',
      'mall',
      'centre comercial',
      'centro comercial',
      'boutique',
      'moda',
      'zara',
      'amazon',
      'souvenirs',
    ],
  ],
  [
    'supermercat',
    [
      'mercadona',
      'supermercat',
      'supermercado',
      'supermarket',
      'water',
      'aigua',
      'agua',
      'snack',
      'pica',
      'picapica',
      'compra',
      'compras',
      'groceries',
      'grocery',
      'lidl',
      'aldi',
      'carrefour',
      'consum',
      'caprabo',
      'bonpreu',
      'eroski',
      'dia ',
      'froiz',
    ],
  ],
  [
    'altres',
    [
      'farmacia',
      'farmàcia',
      'farmacias',
      'pharmacy',
      'comissio',
      'comisión',
      'comision',
      'fee',
      'fees',
      'comission',
      'altres',
      'otros',
      'others',
      'misc',
      'varis',
    ],
  ],
];

export function inferStatsCategory(description: string): StatsCategoryKey {
  const d = normalizeForMatch(description);
  for (const [key, keys] of CATEGORY_RULES) {
    for (const k of keys) {
      if (matchesKeyword(d, k)) return key;
    }
  }
  return 'altres';
}

function mapLegacyCategory(raw: string): StatsCategoryKey | null {
  const r = raw.trim().toLowerCase();
  if (!r) return null;
  if (r === 'restauracio' || r === 'menjar' || r === 'food' || r.includes('menjar')) return 'restauracio';
  if (r === 'supermercat' || r.includes('supermercat')) return 'supermercat';
  if (r === 'transport' || r.includes('transport')) return 'transport';
  if (r === 'activitats' || r === 'oci' || r === 'entertainment' || r.includes('oci')) return 'activitats';
  if (r === 'allotjament' || r === 'accommodation' || r.includes('hotel')) return 'allotjament';
  if (r === 'compres' || r === 'shopping' || r.includes('compres')) return 'compres';
  if (r === 'altres' || r === 'others') return 'altres';
  return null;
}

export function resolveExpenseCategory(e: ExpenseWithPayer): StatsCategoryKey {
  const raw = (e as { category?: string | null }).category?.trim();
  if (raw) {
    const mapped = mapLegacyCategory(raw);
    if (mapped) return mapped;
  }
  return inferStatsCategory(e.description ?? '');
}
