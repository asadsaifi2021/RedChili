import { readFileSync, writeFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url)));
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const rows = catalog.flatMap(group => group.items.map((item, position) => [
  item.id, group.id, item.name.ar, item.name.en, item.description?.ar ?? '', item.description?.en ?? '',
  item.priceHalalas, item.calories ?? null, item.image, item.priceHalalas > 0, position,
].map(value => value === null ? 'null' : typeof value === 'string' ? quote(value) : value).join(', ')));
const sql = `insert into public.menu_items
  (id,category,name_ar,name_en,description_ar,description_en,price,calories,photo,available,position)
values
  (${rows.join('),\n  (')})
on conflict (id) do nothing;
`;
writeFileSync(new URL('../supabase/seed.sql', import.meta.url), sql);
