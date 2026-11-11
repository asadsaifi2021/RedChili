import { useEffect, useRef, useState, type ReactNode } from 'react';
import { db, fetchMenu, groups, initialMenu, money, name, orderError, photo, total, type Item, type Lang, type Line } from './data';

export function Dialog({ children, close, label }: { children: ReactNode; close: () => void; label: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-label={label} onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="dialog-body"><button className="close outline" aria-label={label} onClick={close}>×</button>{children}</div>
  </dialog>;
}

function Quantity({ value, change, lang }: { value: number; change: (value: number) => void; lang: Lang }) {
  return <div className="stepper">
    <button aria-label={lang === 'ar' ? 'إنقاص الكمية' : 'Decrease quantity'} disabled={value <= 1} onClick={() => change(value - 1)}>−</button>
    <output>{value}</output>
    <button aria-label={lang === 'ar' ? 'زيادة الكمية' : 'Increase quantity'} disabled={value >= 25} onClick={() => change(value + 1)}>+</button>
  </div>;
}

const token = new URLSearchParams(location.search).get('table');
const cartKey = `redchili-cart:${token ?? 'menu'}`;
const pendingKey = `redchili-pending:${token ?? 'menu'}`;
const receiptKey = `redchili-receipt:${token ?? 'menu'}`;
const signatureIds = ['dish-3', 'dish-7', 'dish-12'];
const galleryIds = ['dish-14', 'dish-23', 'dish-21', 'dish-37'];
type Pending = { key: string; lines: Pick<Line, 'id' | 'price' | 'quantity' | 'note'>[] };
type Receipt = { key: string; number: number };
type ReceiptDetails = { number: number; table_label: string; items: Line[]; total: number; status: 'received' | 'kitchen' | 'paid' | 'cancelled' };
function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
}

export function Guest({ lang }: { lang: Lang }) {
  const t = (ar: string, en: string) => lang === 'ar' ? ar : en;
  const [menu, setMenu] = useState<Item[]>(db ? [] : initialMenu);
  const [table, setTable] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!db);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [detail, setDetail] = useState<Item | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [cart, setCart] = useState<Line[]>(() => read(cartKey, []));
  const [pending, setPending] = useState<Pending | null>(() => read(pendingKey, null));
  const [cartOpen, setCartOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(() => read(receiptKey, null));
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptDetails, setReceiptDetails] = useState<ReceiptDetails | null>(null);
  const [receiptUnavailable, setReceiptUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchMenu().then(items => { if (alive) setMenu(items); }).catch(() => { if (alive) setLoadFailed(true); })
      .finally(() => { if (alive) setLoaded(true); });
    if (db && token && /^[\da-f-]{36}$/i.test(token)) {
      void db.rpc('resolve_table', { p_token: token }).then(({ data }) => { if (alive) setTable(data); });
    }
    return () => { alive = false; };
  }, []);
  useEffect(() => { localStorage.setItem(cartKey, JSON.stringify(cart)); }, [cart]);
  useEffect(() => {
    const client = db;
    if (!client || !token || !receipt || !receiptOpen) return;
    const params = { p_token: token, p_key: receipt.key };
    let active = true;
    const refresh = async () => {
      const { data, error: failure } = await client.rpc('guest_receipt', params);
      if (!active) return;
      setReceiptUnavailable(Boolean(failure || !data));
      if (data) setReceiptDetails(data as ReceiptDetails);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [receipt, receiptOpen]);

  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const matching = menu.filter(item => (!category || category === item.category) &&
    [item.name_ar, item.name_en, item.description_ar, item.description_en].some(value => value.toLowerCase().includes(query.trim().toLowerCase())));
  const canAdd = Boolean(table && detail?.available && !pending);
  const signatures = signatureIds.flatMap(id => menu.filter(item => item.id === id && photo(item.photo)));
  const gallery = galleryIds.flatMap(id => menu.filter(item => item.id === id && photo(item.photo)));
  const heroDish = menu.find(item => item.id === 'dish-3');
  const heroPhoto = heroDish && photo(heroDish.photo);

  function openDish(item: Item) {
    const line = cart.find(row => row.id === item.id);
    setQuantity(line?.quantity ?? 1);
    setNote(line?.note ?? '');
    setDetail(item);
  }
  const add = () => {
    if (!detail || !canAdd) return;
    const existing = cart.find(line => line.id === detail.id);
    const line = { id: detail.id, price: detail.price, name_ar: detail.name_ar, name_en: detail.name_en, quantity, note };
    setCart(existing ? cart.map(row => row.id === detail.id ? line : row) : [...cart, line]);
    setDetail(null);
  };

  async function submit() {
    if (!db || !token || !table || busy || (!pending && (!cart.length || !confirmed))) return;
    const attempt = pending ?? { key: crypto.randomUUID(), lines: cart.map(({ id, quantity, note, price }) => ({ id, quantity, note, price })) };
    localStorage.setItem(pendingKey, JSON.stringify(attempt));
    setPending(attempt);
    setBusy(true);
    setError('');
    try {
      const { data, error: failure } = await db.rpc('submit_order', { p_token: token, p_key: attempt.key, p_lines: attempt.lines });
      if (failure) {
        // Keep the key after ambiguous transport errors so retries cannot create another order.
        if (failure.code === 'P0001' || failure.code === '22P02') {
          localStorage.removeItem(pendingKey);
          setPending(null);
        }
        if (['price_changed', 'item_unavailable'].includes(failure.message)) {
          const latest = await fetchMenu();
          setMenu(latest);
          setCart(cart.flatMap(line => {
            const item = latest.find(row => row.id === line.id && row.available);
            return item ? [{ ...line, price: item.price }] : [];
          }));
          setConfirmed(false);
        }
        setError(failure.message);
        return;
      }
      const savedReceipt = { number: Number(data), key: attempt.key };
      localStorage.setItem(receiptKey, JSON.stringify(savedReceipt));
      setReceiptDetails(null);
      setReceiptUnavailable(false);
      setReceipt(savedReceipt);
      setCartOpen(false);
      setReceiptOpen(true);
      setConfirmed(false);
      setCart([]);
      localStorage.removeItem(pendingKey);
      setPending(null);
    } catch {
      setError('network');
    } finally { setBusy(false); }
  }

  return <main className="guest-menu">
    <section className={token !== null ? 'hero compact' : 'hero'}>
      {token === null && heroPhoto && <img className="hero-image" src={heroPhoto} fetchPriority="high" alt="" />}
      <div className="shell hero-inner">
        <div className="hero-copy">
          <h1>{table ? t(`طاولة ${table}`, `Table ${table}`) : token !== null ? t('قائمة رد تشيلي', 'Red Chili menu') : t('رد تشيلي', 'Red Chili')}</h1>
          <p>{table ? t('اختر أطباقك وأرسل طلبك إلى الكاشير.', 'Choose your dishes and send your order to the cashier.')
            : token !== null ? t('للطلب، امسح رمز QR الموجود على طاولتك.', 'To order, scan the QR code on your table.')
              : t('مشويات على الفحم ومقبلات عربية', 'Charcoal grills & Arabic mezze')}</p>
          {token === null && <a className="hero-link" href="#menu">{t('تصفّح القائمة', 'Explore the menu')} <span aria-hidden="true">↓</span></a>}
        </div>
      </div>
    </section>
    {token === null && <section className="shell signatures" id="signatures">
      {signatures.length > 0 && <>
        <h2>{t('أطباقنا المميزة', 'Signature dishes')}</h2>
        <div className="signature-grid">{signatures.map(item => <button className="signature-card" key={item.id} onClick={() => openDish(item)}>
          <img src={photo(item.photo)} loading="lazy" alt="" />
          <span><strong>{name(item, lang)}</strong><small>{money(item.price, lang)}</small></span>
        </button>)}</div>
      </>}
    </section>}
    <div className={table ? 'shell menu-shell ordering-layout' : 'shell menu-shell'} id="menu" tabIndex={-1}>
      <div className="menu-content">
      {token === null && <h2 className="menu-title">{t('القائمة', 'The menu')}</h2>}
      {token && !table && loaded && <p role="status" className="notice">{db ? t('إذا لم تظهر طاولتك، امسح رمزها مجدداً.', 'If your table does not appear, scan its QR code again.') : t('الطلب غير متاح في معاينة القائمة.', 'Ordering is unavailable in this menu preview.')}</p>}
      <div className="menu-tools">
        <div className="menu-search"><span aria-hidden="true" /><input type="search" aria-label={t('ابحث في القائمة', 'Search menu')} placeholder={t('ابحث عن طبق', 'Search dishes')} value={query} onChange={event => setQuery(event.target.value)} /></div>
        <nav aria-label={t('الأقسام', 'Categories')} className="chips">{[{ id: '', name: { ar: 'كل القائمة', en: 'Full menu' } }, ...groups].map(group =>
          <button className={category === group.id ? 'active' : ''} key={group.id} aria-pressed={category === group.id} onClick={() => setCategory(group.id)}>{group.name[lang]}</button>)}</nav>
      </div>
      {loadFailed && <p role="alert">{t('تعذر تحميل القائمة.', 'Could not load the menu.')} <button onClick={() => location.reload()}>{t('إعادة المحاولة', 'Retry')}</button></p>}
      {!loaded && <p role="status">{t('جارٍ التحميل…', 'Loading menu…')}</p>}
      {loaded && !loadFailed && !matching.length && <p>{t('لا توجد نتائج.', 'No dishes found.')}</p>}
      {groups.map(group => {
        const items = matching.filter(item => item.category === group.id);
        return items.length > 0 && <section key={group.id} className="menu-group"><h2>{group.name[lang]}</h2>
          <div className="dish-grid">{items.map(item => <button key={item.id} className="dish" onClick={() => openDish(item)}>
            <div className="dish-media">{photo(item.photo) ? <img loading="lazy" src={photo(item.photo)} alt="" /> : <div className="dish-placeholder" />}</div>
            <div className="dish-copy"><h3>{name(item, lang)}</h3>{item[`description_${lang}`] && <p>{item[`description_${lang}`]}</p>}
              <div className="dish-meta"><strong>{money(item.price, lang)}</strong>{!item.available && <span className="sold-out">{t('غير متاح', 'Sold out')}</span>}<span className="dish-arrow" aria-hidden="true">{lang === 'ar' ? '↖' : '↗'}</span></div>
            </div>
          </button>)}</div></section>;
      })}
      </div>
      {table && <aside className="order-sidebar" aria-label={t('سلتك', 'Your cart')}>
        <h2>{t('سلتك', 'Your cart')}</h2>
        {!cart.length && !pending && <p>{t('اختر طبقًا لإضافته إلى سلتك.', 'Choose a dish to add it to your cart.')}</p>}
        {cart.length > 0 && <ul>{cart.map(line => <li key={line.id}><span>{line.quantity} × {name(line, lang)}</span><strong>{money(line.quantity * line.price, lang)}</strong></li>)}</ul>}
        {(count > 0 || pending) && <>
          <div className="bill"><strong>{t('الإجمالي', 'Total')}</strong><strong>{money(total(cart), lang)}</strong></div>
          <button className="primary full" onClick={() => setCartOpen(true)}>{t('راجع السلة', 'Review cart')}</button>
        </>}
        {receipt && <button className="outline full" onClick={() => setReceiptOpen(true)}>{t('آخر طلب', 'Last order')} #{receipt.number}</button>}
      </aside>}
    </div>
    {token === null && <section className="gallery" id="gallery">
      {gallery.length > 0 && <div className="shell">
        <h2>{t('من مطبخ رد تشيلي', 'From the Red Chili kitchen')}</h2>
        <div className="gallery-grid">{gallery.map(item => <button className="gallery-card" key={item.id} onClick={() => openDish(item)}>
          <img src={photo(item.photo)} loading="lazy" alt="" /><span>{name(item, lang)}</span>
        </button>)}</div>
      </div>}
    </section>}
    {table && (count > 0 || pending || receipt) && <aside className="cart-dock">
      {(count > 0 || pending) && <button className="primary" onClick={() => setCartOpen(true)}>
        {t('عرض السلة', 'View cart')} · {count} <span>{money(total(cart), lang)}</span></button>}
      {receipt && <button className="outline" onClick={() => setReceiptOpen(true)}>{t('آخر طلب', 'Last order')} #{receipt.number}</button>}
    </aside>}
    {detail && <Dialog label={t('إغلاق تفاصيل الطبق', 'Close dish details')} close={() => setDetail(null)}>
      {photo(detail.photo) && <img className="detail-image" src={photo(detail.photo)} alt={name(detail, lang)} />}
      <h2>{name(detail, lang)}</h2><p>{detail[`description_${lang}`]}</p>
      <p><strong>{money(detail.price, lang)}</strong>{detail.calories !== null && ` · ${detail.calories} ${t('سعرة حرارية', 'kcal')}`}</p>
      {detail.prep_minutes !== null && <p>{t('وقت التحضير', 'Preparation time')} · {detail.prep_minutes} {t('دقيقة', 'min')}</p>}
      {detail[`allergens_${lang}`] && <p><strong>{t('مسببات الحساسية', 'Allergens')}</strong> · {detail[`allergens_${lang}`]}</p>}
      {canAdd && <><label>{t('ملاحظات للمطبخ', 'Kitchen notes')}<textarea value={note} maxLength={240} onChange={event => setNote(event.target.value)} /></label>
        <div className="actions"><Quantity value={quantity} change={setQuantity} lang={lang} />
          <button className="primary" onClick={add}>{cart.some(line => line.id === detail.id) ? t('تحديث السلة', 'Update cart') : t('أضف للسلة', 'Add to cart')} · {money(quantity * detail.price, lang)}</button></div></>}
    </Dialog>}
    {cartOpen && <Dialog label={t('إغلاق السلة', 'Close cart')} close={() => { if (!busy) setCartOpen(false); }}>
        <h2>{t('سلتك', 'Your cart')}</h2>
        {cart.map(line => <div className="cart-line" key={line.id}><div><strong>{name(line, lang)}</strong><small>{money(line.quantity * line.price, lang)}</small></div>
          {!pending && <><Quantity value={line.quantity} lang={lang} change={value => setCart(cart.map(row => row.id === line.id ? { ...row, quantity: value } : row))} />
            <button className="plain" onClick={() => setCart(cart.filter(row => row.id !== line.id))}>{t('حذف', 'Remove')}</button>
            <label className="cart-note">{t('ملاحظات للمطبخ', 'Kitchen notes')} · {name(line, lang)}
              <input maxLength={240} value={line.note} onChange={event => setCart(cart.map(row => row.id === line.id ? { ...row, note: event.target.value } : row))} />
            </label></>}
          {pending && line.note && <small>{line.note}</small>}
        </div>)}
        <div className="bill"><strong>{t('الإجمالي', 'Total')}</strong><strong>{money(total(cart), lang)}</strong></div>
        {!pending && <label className="checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
          {t(`أؤكد أنني في طاولة ${table}`, `I confirm I am at table ${table}`)}</label>}
        {error && <p className="notice" role="alert">{orderError(error, lang)}</p>}
        <button className="primary full" disabled={busy || (!pending && (!confirmed || !cart.length))} onClick={() => void submit()}>
          {busy ? t('جارٍ الإرسال…', 'Sending…') : pending ? t('تحقق من الطلب وأعد المحاولة', 'Check and retry order') : t('أرسل الطلب · الدفع عند الكاشير', 'Place order · Pay at cashier')}</button>
    </Dialog>}
    {receiptOpen && receipt && <Dialog label={t('إغلاق تفاصيل الطلب', 'Close order receipt')} close={() => setReceiptOpen(false)}>
      <div className="success"><h2>{t('طلبك', 'Your order')}</h2><strong dir="ltr">#{receipt.number}</strong>
        <p>{t('طاولة', 'Table')} {receiptDetails?.table_label ?? table}</p>
        <p role="status">{receiptUnavailable ? t('تعذر تحديث حالة الطلب الآن.', 'Order status is temporarily unavailable.') :
          receiptDetails?.status === 'paid' ? t('تم الدفع', 'Paid') :
          receiptDetails?.status === 'cancelled' ? t('تم إلغاء الطلب', 'Order cancelled') :
          receiptDetails?.status === 'kitchen' ? t('تذكرة المطبخ جاهزة · الدفع عند الكاشير', 'Kitchen ticket prepared · Pay at the cashier') :
          t('تم استلام الطلب · الدفع عند الكاشير', 'Order received · Pay at the cashier')}</p>
      </div>
      {receiptDetails && <>
        <ul className="receipt-lines">{receiptDetails.items.map(line => <li key={line.id}>{line.quantity} × {name(line, lang)}</li>)}</ul>
        <div className="bill"><strong>{t('الإجمالي', 'Total')}</strong><strong>{money(receiptDetails.total, lang)}</strong></div>
      </>}
      <button className="primary full" onClick={() => setReceiptOpen(false)}>{t('العودة للقائمة', 'Back to menu')}</button>
    </Dialog>}
  </main>;
}
