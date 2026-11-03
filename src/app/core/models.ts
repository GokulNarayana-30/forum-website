export interface Category {
  id: string;
  name: string;
}
export interface Item {
  id: string;
  name: string;
  kind: string;
  category_ids: string[];
  mrp_paise: number;
  offer_price_paise?: number | null;
  sample_type?: string | null;
  image_url?: string | null;
  fasting_required?: boolean | null;
  fasting_hours_min?: number | null;
  fasting_hours_max?: number | null;
  report_tat_hours?: number | null;
  parameter_count?: number | null;
  eligibility?: {
    gender?: string | null;
    min_age_years?: number | null;
    max_age_years?: number | null;
  } | null;
}
export interface Detail {
  item: Item;
  description: string | null;
  preparation: string[];
  parameters: { name: string }[];
  inclusions: { test_id?: string; item_id?: string; name: string; parameter_count?: number }[];
  faqs: { question: string; answer: string }[];
}
export interface Person {
  id: string;
  name?: string;
  relation: string;
  date_of_birth?: string;
  gender?: string;
}
export interface Address {
  id: string;
  type: string;
  house: string;
  street?: string;
  area: string;
  pincode: string;
  landmark?: string;
  access_notes?: string;
}
export interface Line {
  id: string;
  item_id: string;
  item_name: string;
  person_id: string;
  price_paise: number;
  mrp_paise: number;
  kind: string;
}
export interface Quote {
  quote_id: string;
  cart_id: string;
  item_total_paise: number;
  discount_paise: number;
  collection_fee_paise: number;
  taxes_paise: number;
  to_pay_paise: number;
  expires_at: string;
  applied_coupon?: { code: string; saving_paise: number } | null;
}
export interface Snapshot {
  cart: { id: string; lines: Line[] };
  people: Person[];
  quote?: { kind: string; quote?: Quote; current?: Quote };
  issues?: { kind: string; line_id: string; reason?: string; test_name?: string }[];
  preparation?: {
    fasting_required?: boolean;
    fasting_hours_min?: number;
    fasting_hours_max?: number;
    instructions?: string[];
    confirmation_pending?: boolean;
  };
}
export interface Slot {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity_left: number;
  best_for_fasting: boolean;
}
export interface SlotDay {
  day_key: string;
  slots: Slot[];
}
export interface Order {
  id: string;
  booking_ref: string;
  status: string;
  total_paise: number;
  slot_starts_at?: string;
  slot_ends_at?: string;
  patients: { id: string; first_name: string; relation: string }[];
  lines?: { test_name: string; amount_paise: number }[];
  payment_status?: string;
}
export interface Report {
  id: string;
  patient_first_name: string;
  test_name: string;
  status: string;
  version: number;
  released_at?: string;
}
export interface Config {
  mode: 'preview' | 'live';
  apiBaseUrl: string;
  supabaseUrl: string;
  publishableKey: string;
}
export function money(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(paise / 100);
}
export function instant(value?: string): string {
  return value
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(Date.parse(value)) + ' IST'
    : 'To be confirmed';
}
export function itemPrice(item: Item): number {
  return item.offer_price_paise ?? item.mrp_paise;
}
export function image(id: string): string {
  return `assets/${id}.webp`;
}
const KNOWN_IMAGES = new Set([
  'cat_diabetes',
  'cat_fever_infection',
  'cat_full_body',
  'cat_heart',
  'cat_liver_kidney',
  'cat_thyroid',
  'cat_vitamins',
  'cat_womens_health',
]);
// Picture for a test or package: the API image if given, a bundled picture for that item,
// else the picture of its first category, else the generic collection banner.
export function itemImage(item: Item): string {
  if (item.image_url) return item.image_url;
  const own = `assets/${item.id}.webp`;
  if (!item.id.startsWith('p-') && !item.id.startsWith('t-')) return own;
  const cat = (item.category_ids?.[0] ?? '').replace(/^cat-/, 'cat_').replace(/-/g, '_');
  return KNOWN_IMAGES.has(cat) ? `assets/${cat}.webp` : 'assets/banner_home_collection.webp';
}
export const steps = ['Patients', 'Address', 'Slot', 'Preparation', 'Coupon', 'Review'];
