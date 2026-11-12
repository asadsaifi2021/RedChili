-- Initial SAR prices in halalas for dishes imported without pricing.
update public.menu_items as item
set price = pricing.price, available = true
from (values
  ('menu-1', 1600),
  ('menu-2', 1900),
  ('menu-3', 1500),
  ('menu-5', 1500),
  ('menu-9', 1500),
  ('menu-11', 1600),
  ('menu-14', 2400),
  ('menu-18', 3100),
  ('menu-19', 3100),
  ('menu-20', 3300),
  ('menu-21', 3300),
  ('menu-23', 2900),
  ('menu-26', 1400),
  ('menu-29', 3800),
  ('menu-30', 3700),
  ('menu-31', 4500),
  ('menu-32', 3600),
  ('menu-34', 1100),
  ('menu-35', 1200),
  ('menu-36', 1300),
  ('menu-37', 1200),
  ('menu-38', 1600),
  ('menu-39', 1500),
  ('menu-40', 1500),
  ('menu-41', 400),
  ('menu-42', 400),
  ('menu-45', 400)
) as pricing(id, price)
where item.id = pricing.id and item.published and item.price = 0;
