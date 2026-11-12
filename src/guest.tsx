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
const menuCartKey = 'redchili-cart:menu';
const cartKey = token === null ? menuCartKey : `redchili-cart:${token}`;
const pendingKey = `redchili-pending:${token ?? 'menu'}`;
const receiptKey = `redchili-receipt:${token ?? 'menu'}`;
const signatureIds = ['dish-3', 'dish-7', 'dish-12'];
const galleryIds = ['dish-14', 'dish-23', 'dish-21', 'dish-37'];
type TableOption = { id: string; label: string };
type Pending = { key: string; lines: Pick<Line, 'id' | 'price' | 'quantity' | 'note'>[]; selectedTable?: TableOption };
type Receipt = { key: string; number: number; selectedTable?: TableOption };
type ReceiptDetails = { number: number; table_label: string; items: Line[]; total: number; status: 'received' | 'kitchen' | 'paid' | 'cancelled' };
const maxCartItems = 45;
function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
}

export function Guest({ lang }: { lang: Lang }) {
  const t = (ar: string, en: string) => lang === 'ar' ? ar : en;
  const [menu, setMenu] = useState<Item[]>(db ? [] : initialMenu);
  const [table, setTable] = useState<string | null>(null);
  const [checkingTable, setCheckingTable] = useState(Boolean(db && token));
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
  const [tables, setTables] = useState<TableOption[]>([]);
  const [tableListState, setTableListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tableListRetry, setTableListRetry] = useState(0);
  const [selectedTable, setSelectedTable] = useState<TableOption | undefined>(() => read<Pending | null>(pendingKey, null)?.selectedTable);
  const checkoutTable = table ?? pending?.selectedTable?.label ??
    (tableListState === 'ready' ? tables.find(option => option.id === selectedTable?.id)?.label : undefined);
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
      void Promise.resolve(db.rpc('resolve_table', { p_token: token })).then(({ data }) => { if (alive) setTable(data); })
        .finally(() => { if (alive) setCheckingTable(false); });
    } else {
      setCheckingTable(false);
    }
    return () => { alive = false; };
  }, []);
  useEffect(() => { localStorage.setItem(cartKey, JSON.stringify(cart)); }, [cart]);
  useEffect(() => {
    if (!db || !cartOpen || token !== null) return;
    let active = true;
    setTableListState('loading');
    void db.rpc('list_order_tables').then(({ data, error: failure }) => {
      if (!active) return;
      setTables(failure ? [] : data as TableOption[]);
      setTableListState(failure ? 'error' : 'ready');
    });
    return () => { active = false; };
  }, [cartOpen, tableListRetry]);
  useEffect(() => {
    if (!table || read<Line[]>(cartKey, []).length || read<Pending | null>(pendingKey, null)) return;
    const draft = read<Line[]>(menuCartKey, []);
    if (!draft.length) return;
    localStorage.setItem(cartKey, JSON.stringify(draft));
    localStorage.removeItem(menuCartKey);
    setCart(draft);
  }, [table]);
  useEffect(() => {
    const client = db;
    if (!client || !receipt || !receiptOpen || (!token && !receipt.selectedTable)) return;
    const { key, selectedTable: receiptTable } = receipt;
    let active = true;
    const refresh = async () => {
      const { data, error: failure } = receiptTable
        ? await client.rpc('selected_order_receipt', { p_table_id: receiptTable.id, p_key: key })
        : await client.rpc('guest_receipt', { p_token: token, p_key: key });
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
  const cartIsFull = cart.length >= maxCartItems && !cart.some(line => line.id === detail?.id);
  const canAdd = Boolean((table || token === null) && detail?.available && !pending && !cartIsFull);
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

  function bringMenuCart() {
    const merged = new Map(cart.map(line => [line.id, line]));
    const remaining: Line[] = [];
    for (const line of read<Line[]>(menuCartKey, [])) {
      if (merged.has(line.id) || merged.size < maxCartItems) merged.set(line.id, line);
      else remaining.push(line);
    }
    const next = [...merged.values()];
    localStorage.setItem(cartKey, JSON.stringify(next));
    if (remaining.length) localStorage.setItem(menuCartKey, JSON.stringify(remaining));
    else localStorage.removeItem(menuCartKey);
    setConfirmed(false);
    setCart(next);
  }

  async function submit() {
    if (!db || !checkoutTable || busy || (!pending && (!cart.length || !confirmed))) return;
    const attempt = pending ?? {
      key: crypto.randomUUID(),
      lines: cart.map(({ id, quantity, note, price }) => ({ id, quantity, note, price })),
      selectedTable: token === null ? selectedTable : undefined,
    };
    localStorage.setItem(pendingKey, JSON.stringify(attempt));
    setPending(attempt);
    setBusy(true);
    setError('');
    try {
      const { data, error: failure } = attempt.selectedTable
        ? await db.rpc('submit_selected_order', { p_table_id: attempt.selectedTable.id, p_key: attempt.key, p_lines: attempt.lines })
        : await db.rpc('submit_order', { p_token: token, p_key: attempt.key, p_lines: attempt.lines });
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
        if (failure.message === 'invalid_table' && attempt.selectedTable) {
          setSelectedTable(undefined);
          setConfirmed(false);
          setTableListRetry(value => value + 1);
        }
        setError(failure.message);
        return;
      }
      const savedReceipt = { number: Number(data), key: attempt.key, selectedTable: attempt.selectedTable };
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
      <div className="shell hero-inner">
        <div className="hero-copy">
          {token === null && <p className="theme-eyebrow">{t('نكهة عربية على الفحم', 'ARABIC SOUL. CHARCOAL FIRE.')}</p>}
          <h1>{table ? t(`طاولة ${table}`, `Table ${table}`) : token !== null ? t('قائمة كنز', 'Kanz menu') :
            <>{t('أكل طيب.', 'Good food.')}<br /><em>{t('وصحبة أجمل.', 'Great company.')}</em></>}</h1>
          <p>{table ? t('اختر أطباقك وأرسل طلبك إلى الكاشير.', 'Choose your dishes and send your order to the cashier.')
            : token !== null ? t('للطلب، امسح رمز QR الموجود على طاولتك.', 'To order, scan the QR code on your table.')
              : t('تذوق مشوياتنا على الفحم ومقبلاتنا العربية الطازجة.', 'Explore our charcoal grills, fresh appetizers, and something for everyone.')}</p>
          {token === null && <a className="hero-link" href="#menu">{t('تصفّح القائمة', 'Explore the menu')} <span aria-hidden="true">↓</span></a>}
        </div>
        {token === null && heroPhoto && <figure className="theme-hero-photo">
          <img src={heroPhoto} fetchPriority="high" alt={heroDish ? name(heroDish, lang) : ''} />
          <figcaption>{heroDish && name(heroDish, lang)}</figcaption>
        </figure>}
      </div>
    </section>
    <div className="shell menu-shell ordering-layout" id="menu" tabIndex={-1}>
      <div className="menu-content">
      {token === null && <div className="theme-menu-heading"><h2 className="menu-title">{t('اعثر على طبقك المفضل.', 'Find your next favorite.')}</h2>{loaded && !loadFailed && <span>{t(`${menu.length} طبقًا`, `${menu.length} dishes`)}</span>}</div>}
      {token !== null && !table && <p role="status" className="notice">{checkingTable
        ? t('جارٍ التحقق من الطاولة…', 'Checking your table…')
        : t('امسح رمز الطاولة مرة أخرى أو افتح القائمة.', 'Scan your table QR code again or open the regular menu.')}
        {!checkingTable && <> <a href="/menu">{t('القائمة', 'Menu')}</a></>}
      </p>}
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
              <div className="dish-meta"><strong>{item.price > 0 ? money(item.price, lang) : t('السعر قريبًا', 'Price pending')}</strong>{!item.available && item.price > 0 && <span className="sold-out">{t('غير متاح', 'Sold out')}</span>}<span className="dish-arrow" aria-hidden="true">{lang === 'ar' ? '↖' : '↗'}</span></div>
            </div>
          </button>)}</div></section>;
      })}
      </div>
      {(table || token === null) && <aside className="order-sidebar" aria-label={t('سلتك', 'Your cart')}>
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
    {token === null && <section className="shell signatures" id="signatures">
      {signatures.length > 0 && <>
        <h2>{t('أطباقنا المميزة', 'Signature dishes')}</h2>
        <div className="signature-grid">{signatures.map(item => <button className="signature-card" key={item.id} onClick={() => openDish(item)}>
          <img src={photo(item.photo)} loading="lazy" alt="" />
          <span><strong>{name(item, lang)}</strong><small>{money(item.price, lang)}</small></span>
        </button>)}</div>
      </>}
    </section>}
    {token === null && <section className="gallery" id="gallery">
      {gallery.length > 0 && <div className="shell">
        <h2>{t('من مطبخ كنز', 'From the Kanz kitchen')}</h2>
        <div className="gallery-grid">{gallery.map(item => <button className="gallery-card" key={item.id} onClick={() => openDish(item)}>
          <img src={photo(item.photo)} loading="lazy" alt="" /><span>{name(item, lang)}</span>
        </button>)}</div>
      </div>}
    </section>}
    {(table || token === null) && (count > 0 || pending || receipt) && <aside className="cart-dock">
      {(count > 0 || pending) && <button className="primary" onClick={() => setCartOpen(true)}>
        {t('عرض السلة', 'View cart')} · {count} <span>{money(total(cart), lang)}</span></button>}
      {receipt && <button className="outline" onClick={() => setReceiptOpen(true)}>{t('آخر طلب', 'Last order')} #{receipt.number}</button>}
    </aside>}
    {detail && <Dialog label={t('إغلاق تفاصيل الطبق', 'Close dish details')} close={() => setDetail(null)}>
      {photo(detail.photo) && <img className="detail-image" src={photo(detail.photo)} alt={name(detail, lang)} />}
      <h2>{name(detail, lang)}</h2><p>{detail[`description_${lang}`]}</p>
      <p><strong>{detail.price > 0 ? money(detail.price, lang) : t('السعر قريبًا', 'Price pending')}</strong>{detail.calories !== null && ` · ${detail.calories} ${t('سعرة حرارية', 'kcal')}`}</p>
      {detail.prep_minutes !== null && <p>{t('وقت التحضير', 'Preparation time')} · {detail.prep_minutes} {t('دقيقة', 'min')}</p>}
      {detail[`allergens_${lang}`] && <p><strong>{t('مسببات الحساسية', 'Allergens')}</strong> · {detail[`allergens_${lang}`]}</p>}
      {cartIsFull && <p role="status">{t('أزل طبقًا من السلة لإضافة طبق آخر.', 'Remove a dish from your cart to add another.')}</p>}
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
        {!cart.length && !pending && <p>{t('سلتك فارغة.', 'Your cart is empty.')}</p>}
        {table && !pending && cart.length > 0 && read<Line[]>(menuCartKey, []).length > 0 && <div className="notice">
          <p>{t('لديك أصناف محفوظة في القائمة العامة. عند دمج السلتين، تُستخدم الكمية والملاحظات من سلة القائمة للأصناف المكررة.', 'You have dishes saved from the regular menu. Combining carts uses the regular menu quantity and notes for duplicate dishes.')}</p>
          <button className="outline" onClick={bringMenuCart}>{t('دمج السلتين', 'Combine carts')}</button>
        </div>}
        {token === null && cart.length > 0 && !pending && (db ? <>
          <label>{t('اختر طاولتك', 'Select your table')}
            <select value={selectedTable?.id ?? ''} disabled={tableListState !== 'ready' || !tables.length} onChange={event => {
              setSelectedTable(tables.find(option => option.id === event.target.value));
              setConfirmed(false);
              setError('');
            }}>
              <option value="">{t('اختر رقم الطاولة', 'Choose a table')}</option>
              {tables.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          {tableListState === 'loading' && <p role="status">{t('جارٍ تحميل الطاولات…', 'Loading tables…')}</p>}
          {tableListState === 'error' && <button className="outline" onClick={() => setTableListRetry(value => value + 1)}>{t('أعد تحميل الطاولات', 'Retry loading tables')}</button>}
          {tableListState === 'ready' && !tables.length && <p role="status">{t('لا توجد طاولات متاحة.', 'No tables are available.')}</p>}
        </> : <p role="status">{t('الطلب غير متاح في معاينة القائمة.', 'Ordering is unavailable in this menu preview.')}</p>)}
        {checkoutTable && !pending && <label className="checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
          {t(`أؤكد أنني في طاولة ${checkoutTable}`, `I confirm I am at table ${checkoutTable}`)}</label>}
        {error && <p className="notice" role="alert">{orderError(error, lang)}</p>}
        {db && <button className="primary full" disabled={busy || !checkoutTable || (!pending && (!confirmed || !cart.length))} onClick={() => void submit()}>
          {busy ? t('جارٍ الإرسال…', 'Sending…') : pending ? t('تحقق من الطلب وأعد المحاولة', 'Check and retry order') : t('أرسل الطلب · الدفع عند الكاشير', 'Place order · Pay at cashier')}</button>}
    </Dialog>}
    {receiptOpen && receipt && <Dialog label={t('إغلاق تفاصيل الطلب', 'Close order receipt')} close={() => setReceiptOpen(false)}>
      <div className="success"><h2>{t('طلبك', 'Your order')}</h2><strong dir="ltr">#{receipt.number}</strong>
        <p>{t('طاولة', 'Table')} {receiptDetails?.table_label ?? receipt.selectedTable?.label ?? table}</p>
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
