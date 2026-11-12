update public.menu_items as item
set photo = artwork.path
from (values
  ('menu-1', '/images/illustrated-menu-1.webp'),
  ('menu-2', '/images/illustrated-menu-2.webp'),
  ('menu-3', '/images/illustrated-menu-3.webp'),
  ('menu-5', '/images/illustrated-menu-5.webp'),
  ('menu-9', '/images/illustrated-menu-9.webp'),
  ('menu-11', '/images/illustrated-menu-11.webp'),
  ('menu-14', '/images/illustrated-menu-14.webp'),
  ('menu-18', '/images/illustrated-menu-18.webp'),
  ('menu-19', '/images/illustrated-menu-19.webp'),
  ('menu-20', '/images/illustrated-menu-20.webp'),
  ('menu-21', '/images/illustrated-menu-21.webp'),
  ('menu-23', '/images/illustrated-menu-23.webp'),
  ('menu-26', '/images/illustrated-menu-26.webp'),
  ('menu-29', '/images/illustrated-menu-29.webp'),
  ('menu-30', '/images/illustrated-menu-30.webp'),
  ('menu-31', '/images/illustrated-menu-31.webp'),
  ('menu-32', '/images/illustrated-menu-32.webp'),
  ('menu-34', '/images/illustrated-menu-34.webp'),
  ('menu-35', '/images/illustrated-menu-35.webp'),
  ('menu-36', '/images/illustrated-menu-36.webp'),
  ('menu-37', '/images/illustrated-menu-37.webp'),
  ('menu-38', '/images/illustrated-menu-38.webp'),
  ('menu-39', '/images/illustrated-menu-39.webp'),
  ('menu-40', '/images/illustrated-menu-40.webp'),
  ('menu-41', '/images/illustrated-menu-41.webp'),
  ('menu-42', '/images/illustrated-menu-42.webp'),
  ('menu-45', '/images/illustrated-menu-45.webp')
) as artwork(id, path)
where item.id = artwork.id and item.photo = '';
