import { createClient } from '@supabase/supabase-js';
import catalog from '../catalog.json';

export type Lang = 'ar' | 'en';
export type Item = {
  id: string; category: string; name_ar: string; name_en: string;
  description_ar: string; description_en: string; photo: string;
  price: number; calories: number | null; prep_minutes: number | null; allergens_ar: string; allergens_en: string;
  available: boolean; published: boolean; position: number;
};
export type Line = Pick<Item, 'id' | 'name_ar' | 'name_en' | 'price'> & { quantity: number; note: string };
export type Order = {
  id: string; number: number; table_id: string; table_label: string; items: Line[];
  total: number; created_at: string; revision: number; printed_revision: number;
  paid_at: string | null; cancelled_at: string | null;
};
export type DiningTable = { id: string; label: string; token: string; active: boolean };
export const groups = catalog.map(({ id, name }) => ({ id, name }));
export const initialMenu: Item[] = catalog.flatMap(group => group.items.map((item, position) => ({
  id: item.id, category: group.id, name_ar: item.name.ar, name_en: item.name.en,
  description_ar: item.description?.ar ?? '', description_en: item.description?.en ?? '',
  photo: item.image, price: item.priceHalalas, calories: item.calories ?? null,
  prep_minutes: null, allergens_ar: '', allergens_en: '', available: true, published: true, position,
})));
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const db = url && key ? createClient(url, key) : null;

export const name = (item: Pick<Item, 'name_ar' | 'name_en'>, lang: Lang) => item[`name_${lang}`];
export const money = (price: number, lang: Lang) => new Intl.NumberFormat(lang === 'ar' ? 'ar-SA' : 'en-SA', {
  style: 'currency', currency: 'SAR',
}).format(price / 100);
export const total = (lines: Line[]) => lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
export const date = (value: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-SA', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Riyadh',
}).format(new Date(value));
export const photo = (path: string) => path && (/^\/images\/[\w.-]+$/.test(path) ? path : db?.storage.from('menu-photos').getPublicUrl(path).data.publicUrl || '');
export function orderError(error: string, lang: Lang) {
  const messages: Record<string, [string, string]> = {
    price_changed: ['تغيّر السعر. راجع السلة قبل التأكيد.', 'A price changed. Review the cart before confirming.'],
    item_unavailable: ['أحد الأصناف غير متاح. راجع السلة.', 'An item is unavailable. Review the cart.'],
    invalid_table: ['رمز الطاولة غير صالح. امسح الرمز الموجود على طاولتك.', 'This table link is inactive. Scan the code on your table.'],
    order_changed: ['تم تحديث الطلب. افتح آخر نسخة وحاول مجدداً.', 'This order changed. Open the latest version and try again.'],
    bill_changed: ['تغيّرت طلبات الطاولة. راجع المجموع الجديد.', 'The table bill changed. Review the updated total.'],
    too_many_orders: ['يرجى الانتظار قليلاً قبل إرسال طلب آخر.', 'Wait a moment before placing another order.'],
  };
  return (messages[error] ?? ['تعذر إكمال العملية. حاول مجدداً.', 'Could not complete the request. Try again.'])[lang === 'ar' ? 0 : 1];
}
export async function fetchMenu(admin = false) {
  if (!db) return initialMenu;
  const query = db.from('menu_items').select('*').order('position').order('id');
  const { data, error } = await (admin ? query : query.eq('published', true));
  if (error) throw error;
  return data as Item[];
}
