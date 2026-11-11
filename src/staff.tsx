import { useCallback, useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { date, db, fetchMenu, groups, money, name, orderError, photo, total, type DiningTable, type Item, type Lang, type Line, type Order } from './data';
import { Dialog } from './guest';

type Role = 'admin' | 'cashier';
type Translate = (ar: string, en: string) => string;

export function Staff({ lang }: { lang: Lang }) {
  const t: Translate = (ar, en) => lang === 'ar' ? ar : en;
  const [stage, setStage] = useState('loading');
  const [role, setRole] = useState<Role | null>(null);
  const [factor, setFactor] = useState('');
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [screen, setScreen] = useState(location.pathname.startsWith('/admin') ? 'menu' : 'orders');

  const inspect = useCallback(async () => {
    if (!db) return;
    const { data: { session } } = await db.auth.getSession();
    if (!session) { setRole(null); setFactor(''); setSetup(null); setStage('login'); return; }
    const { data, error } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) { setStage('unavailable'); return; }
    if (data.currentLevel === 'aal2') {
      const { data: granted, error: roleError } = await db.rpc('staff_role');
      setRole(granted === 'admin' || granted === 'cashier' ? granted : null);
      setStage(roleError ? 'unavailable' : granted ? 'ready' : 'denied');
      return;
    }
    setRole(null);
    const { data: factors, error: factorError } = await db.auth.mfa.listFactors();
    if (factorError) { setStage('unavailable'); return; }
    const verified = factors.totp[0];
    setFactor(verified?.id ?? '');
    setSetup(null);
    setStage(verified ? 'verify' : 'enroll');
  }, []);

  useEffect(() => {
    if (!db) return;
    let timer: ReturnType<typeof setTimeout>;
    const { data: { subscription } } = db.auth.onAuthStateChange(event => {
      if (['INITIAL_SESSION', 'SIGNED_OUT', 'SIGNED_IN', 'TOKEN_REFRESHED'].includes(event)) {
        clearTimeout(timer);
        timer = setTimeout(() => void inspect(), 0);
      }
    });
    return () => { clearTimeout(timer); subscription.unsubscribe(); };
  }, [inspect]);

  async function action(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!db || busy) return;
    const fields = event ? new FormData(event.currentTarget) : null;
    setBusy(true); setMessage('');
    try {
      if (stage === 'login') {
        const { error } = await db.auth.signInWithPassword({ email: String(fields?.get('email')).trim(), password: String(fields?.get('password')) });
        if (error) throw error;
        await inspect();
      } else if (stage === 'enroll') {
        const { data: factors, error: listError } = await db.auth.mfa.listFactors();
        if (listError) throw listError;
        for (const existing of factors.all.filter(item => item.factor_type === 'totp' && item.status === 'unverified')) {
          const { error } = await db.auth.mfa.unenroll({ factorId: existing.id });
          if (error) throw error;
        }
        const { data, error } = await db.auth.mfa.enroll({ factorType: 'totp', issuer: 'RedChili' });
        if (error) throw error;
        setFactor(data.id); setSetup({ qr: data.totp.qr_code, secret: data.totp.secret }); setStage('verify');
      } else if (stage === 'verify') {
        const { error } = await db.auth.mfa.challengeAndVerify({ factorId: factor, code: String(fields?.get('code')) });
        if (error) throw error;
        await inspect();
      }
    } catch { setMessage(t('تعذر تسجيل الدخول أو التحقق. حاول مجدداً.', 'Sign-in or verification failed. Try again.')); }
    finally { setBusy(false); }
  }

  if (!db) return <main className="shell staff-shell"><h1>{t('دخول الموظفين', 'Staff sign-in')}</h1><p className="notice">{t('لا تتوفر لوحة الموظفين في معاينة القائمة.', 'Staff access is unavailable in the menu preview.')}</p></main>;
  if (stage === 'ready' && role) return <main className="shell staff-shell">
    <div className="staff-nav"><nav className="chips">
      <button className={screen === 'orders' || role === 'cashier' ? 'active' : ''} onClick={() => setScreen('orders')}>{t('الطلبات', 'Orders')}</button>
      {role === 'admin' && <><button className={screen === 'menu' ? 'active' : ''} onClick={() => setScreen('menu')}>{t('إدارة القائمة', 'Menu admin')}</button>
        <button className={screen === 'tables' ? 'active' : ''} onClick={() => setScreen('tables')}>{t('الطاولات ورموز QR', 'Tables and QR codes')}</button></>}
    </nav><button className="outline" onClick={() => void db?.auth.signOut()}>{t('تسجيل الخروج', 'Sign out')}</button></div>
    {role === 'admin' && screen === 'menu' ? <MenuAdmin lang={lang} t={t} />
      : role === 'admin' && screen === 'tables' ? <TableAdmin t={t} /> : <Orders lang={lang} t={t} />}
  </main>;

  return <main className="shell staff-shell"><section className="panel signin">
    <h1>{t('دخول الموظفين', 'Staff sign-in')}</h1>
    {stage === 'loading' && <p>{t('جارٍ التحميل…', 'Loading…')}</p>}
    {stage === 'unavailable' && <button onClick={() => void inspect()}>{t('إعادة المحاولة', 'Retry')}</button>}
    {stage === 'denied' && <p role="alert">{t('هذا الحساب لا يملك صلاحية الموظفين.', 'This account has no staff access.')}</p>}
    {stage === 'login' && <form onSubmit={action}>
      <label>{t('البريد الإلكتروني', 'Email')}<input name="email" type="email" required autoComplete="username" dir="ltr" /></label>
      <label>{t('كلمة المرور', 'Password')}<input name="password" type="password" required autoComplete="current-password" dir="ltr" /></label>
      <button className="primary full" disabled={busy}>{t('تسجيل الدخول', 'Sign in')}</button>
    </form>}
    {stage === 'enroll' && <><p>{t('اربط تطبيق المصادقة بحسابك.', 'Set up an authenticator app for your account.')}</p>
      <button className="primary" disabled={busy} onClick={() => void action()}>{t('إعداد المصادقة', 'Set up authenticator')}</button></>}
    {stage === 'verify' && <form onSubmit={action}>
      {setup && <><p>{t('امسح الرمز بتطبيق المصادقة أو أدخل المفتاح.', 'Scan with your authenticator app or enter the key.')}</p>
        <img className="qr" src={setup.qr.startsWith('data:') ? setup.qr : 'data:image/svg+xml,' + encodeURIComponent(setup.qr)} alt={t('رمز المصادقة', 'Authenticator QR')} />
        <code className="secret" dir="ltr">{setup.secret}</code></>}
      <label>{t('رمز المصادقة', 'Authenticator code')}<input name="code" pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required dir="ltr" /></label>
      <button className="primary full" disabled={busy}>{t('تحقق', 'Verify')}</button>
    </form>}
    {message && <p role="alert" className="notice">{message}</p>}
    {!['loading', 'login'].includes(stage) && <button className="plain" onClick={() => void db?.auth.signOut()}>{t('تسجيل الخروج', 'Sign out')}</button>}
  </section></main>;
}

function Orders({ lang, t }: { lang: Lang; t: Translate }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [menu, setMenu] = useState<Item[]>([]);
  const [mode, setMode] = useState<'open' | 'history'>('open');
  const [editing, setEditing] = useState<Order | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [selected, setSelected] = useState('');
  const [ticket, setTicket] = useState<Order | null>(null);
  const [payment, setPayment] = useState<{ table: string; label: string; orders: Order[] } | null>(null);
  const [method, setMethod] = useState('cash');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [queueError, setQueueError] = useState(false);
  const reload = useCallback(async () => {
    if (!db) return;
    const [open, history] = await Promise.all([
      db.from('orders').select('*').is('paid_at', null).is('cancelled_at', null).order('created_at'),
      db.from('orders').select('*').or('paid_at.not.is.null,cancelled_at.not.is.null').order('created_at', { ascending: false }).limit(150),
    ]);
    if (open.error || history.error) setQueueError(true);
    else { setOrders([...(open.data as Order[]), ...(history.data as Order[])]); setQueueError(false); }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!db) return;
    void reload();
    void fetchMenu().then(setMenu).catch(() => setMessage('network'));
    const channel = db.channel('order-queue').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => void reload())
      .subscribe(status => { if (status === 'SUBSCRIBED') void reload(); });
    const poll = setInterval(() => void reload(), 15000);
    return () => { clearInterval(poll); void db?.removeChannel(channel); };
  }, [reload]);

  const open = orders.filter(order => !order.paid_at && !order.cancelled_at);
  const history = orders.filter(order => order.paid_at || order.cancelled_at);
  const tables = Array.from(new Set(open.map(order => order.table_id)));

  async function change(order: Order, operation: 'print' | 'cancel' | 'edit') {
    if (!db || busy) return;
    setBusy(true); setMessage('');
    try {
      const { error } = await db.rpc('change_order', { p_id: order.id, p_revision: order.revision, p_action: operation, p_lines: operation === 'edit' ? lines : null });
      if (error) setMessage(error.message);
      else {
        setEditing(null);
        if (operation === 'print') setTicket(order);
      }
      await reload();
    } catch { setMessage('network'); } finally { setBusy(false); }
  }

  async function pay() {
    if (!db || !payment || busy) return;
    setBusy(true); setMessage('');
    try {
      const { error } = await db.rpc('pay_table', {
        p_table: payment.table, p_method: method,
        p_expected: Object.fromEntries(payment.orders.map(order => [order.id, order.revision])),
      });
      if (error) setMessage(error.message);
      setPayment(null);
      await reload();
    } catch { setMessage('network'); } finally { setBusy(false); }
  }

  function card(order: Order) {
    return <article className="order-card" key={order.id}>
      <div className="section-title"><h3 dir="ltr">#{order.number}</h3><small>{date(order.created_at, lang)}</small></div>
      <p>{t('طاولة', 'Table')} {order.table_label} · {order.cancelled_at ? t('ملغى', 'Cancelled') : order.paid_at ? t('مدفوع', 'Paid') : order.printed_revision === order.revision ? t('تم تجهيز التذكرة', 'Ticket prepared') : order.revision > 1 ? t('محدّث', 'Updated') : t('جديد', 'New')}</p>
      <ul>{order.items.map(line => <li key={line.id}>{line.quantity} × {name(line, lang)} {line.note && <small> · {line.note}</small>}</li>)}</ul>
      <div className="actions"><strong>{money(order.total, lang)}</strong>
        <button className="outline" disabled={busy} onClick={() => void change(order, 'print')}>{t('تذكرة المطبخ', 'Kitchen ticket')}</button>
        {!order.paid_at && !order.cancelled_at && <button className="outline" onClick={() => {
          setMessage(''); setEditing(order); setLines(order.items); setSelected('');
          void fetchMenu().then(setMenu).catch(() => setMessage('network'));
        }}>{t('تعديل', 'Edit')}</button>}
      </div>
    </article>;
  }

  return <><div className="section-title"><h1>{t('طلبات الطاولات', 'Table orders')}</h1>
    <button className="outline" onClick={() => void reload()}>{t('تحديث', 'Refresh')}</button></div>
    <nav className="chips"><button className={mode === 'open' ? 'active' : ''} onClick={() => setMode('open')}>{t('مفتوحة', 'Open')} · {open.length}</button>
      <button className={mode === 'history' ? 'active' : ''} onClick={() => setMode('history')}>{t('السجل', 'History')}</button></nav>
    {queueError && <p className="notice" role="alert">{t('تعذر تحديث الطلبات.', 'Could not refresh orders.')}</p>}
    {!loaded && <p role="status">{t('جارٍ تحميل الطلبات…', 'Loading orders…')}</p>}
    {message && !editing && !payment && <p className="notice" role="alert">{orderError(message, lang)}</p>}
    {loaded && !queueError && !(mode === 'open' ? open.length : history.length) && <p className="panel">{t('لا توجد طلبات.', 'No orders yet.')}</p>}
    {mode === 'history' && <div className="order-grid">{history.map(card)}</div>}
    {mode === 'open' && tables.map(table => {
      const group = open.filter(order => order.table_id === table);
      const label = group[0].table_label;
      return <section className="panel table-group" key={table}><div className="section-title"><h2>{t('طاولة', 'Table')} {label}</h2>
        <button className="primary" disabled={queueError} onClick={() => { setMessage(''); setMethod('cash'); setPayment({ table, label, orders: group }); }}>
          {t('تسجيل الدفع', 'Record payment')} · {money(group.reduce((sum, order) => sum + order.total, 0), lang)}</button>
      </div><div className="order-grid">{group.map(card)}</div></section>;
    })}
    {editing && <Dialog label={t('إغلاق تعديل الطلب', 'Close order editor')} close={() => { if (!busy) setEditing(null); }}>
      <h2>{t('تعديل الطلب', 'Edit order')} #{editing.number}</h2>
      {lines.map(line => <div key={line.id} className="edit-line"><strong>{name(line, lang)} · {money(line.price, lang)}</strong>
        <div className="actions"><label>{t('الكمية', 'Quantity')}<input className="short" type="number" min="1" max="25" value={line.quantity}
          onChange={event => setLines(lines.map(row => row.id === line.id ? { ...row, quantity: Number(event.target.value) } : row))} /></label>
          <button className="plain" onClick={() => setLines(lines.filter(row => row.id !== line.id))}>{t('حذف', 'Remove')}</button></div>
        <label>{t('ملاحظات', 'Notes')}<input maxLength={240} value={line.note} onChange={event => setLines(lines.map(row => row.id === line.id ? { ...row, note: event.target.value } : row))} /></label></div>)}
      <div className="actions"><select aria-label={t('اختر طبقاً', 'Choose a dish')} value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">{t('اختر طبقاً', 'Choose a dish')}</option>{menu.filter(item => item.available && !lines.some(line => line.id === item.id))
          .map(item => <option key={item.id} value={item.id}>{name(item, lang)}</option>)}</select>
        <button disabled={!selected} onClick={() => {
          const item = menu.find(row => row.id === selected);
          if (item) setLines([...lines, { id: item.id, name_ar: item.name_ar, name_en: item.name_en, price: item.price, quantity: 1, note: '' }]);
          setSelected('');
        }}>{t('أضف', 'Add')}</button></div>
      <p className="bill">{t('الإجمالي', 'Total')} <strong>{money(total(lines), lang)}</strong></p>
      {message && <p role="alert" className="notice">{orderError(message, lang)}</p>}
      <div className="actions"><button className="primary" disabled={busy || !lines.length || lines.some(line => !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 25)} onClick={() => void change(editing, 'edit')}>{t('حفظ التعديلات', 'Save changes')}</button>
        <button className="outline" disabled={busy} onClick={() => { if (window.confirm(t('إلغاء هذا الطلب؟', 'Cancel this order?'))) void change(editing, 'cancel'); }}>{t('إلغاء الطلب', 'Cancel order')}</button></div>
    </Dialog>}
    {payment && <Dialog label={t('إغلاق الدفع', 'Close payment')} close={() => { if (!busy) setPayment(null); }}>
      <h2>{t('حساب الطاولة', 'Table bill')} {payment.label}</h2>
      {payment.orders.map(order => <div className="bill" key={order.id}><span>#{order.number}</span><strong>{money(order.total, lang)}</strong></div>)}
      <div className="bill"><strong>{t('الإجمالي', 'Total')}</strong><strong>{money(payment.orders.reduce((sum, order) => sum + order.total, 0), lang)}</strong></div>
      <label>{t('طريقة الدفع', 'Payment method')}<select value={method} onChange={event => setMethod(event.target.value)}>
        <option value="cash">{t('نقداً', 'Cash')}</option><option value="card">{t('بطاقة', 'Card')}</option><option value="other">{t('أخرى', 'Other')}</option></select></label>
      {message && <p role="alert" className="notice">{orderError(message, lang)}</p>}
      <button className="primary full" disabled={busy} onClick={() => void pay()}>{t('تم استلام المبلغ', 'Confirm payment received')}</button>
    </Dialog>}
    {ticket && <Dialog label={t('إغلاق التذكرة', 'Close ticket')} close={() => setTicket(null)}>
      <div className="print-target ticket" dir="rtl"><h2>RedChili</h2><h3>تذكرة المطبخ / Kitchen ticket</h3>
        <p>طاولة {ticket.table_label} · #{ticket.number} · {date(ticket.created_at, 'ar')}</p>
        <p>{ticket.cancelled_at ? 'طلب ملغى / Cancelled order' : ticket.revision > 1 ? 'طلب محدّث / Updated order' : 'طلب / Order'} · {ticket.revision}</p>
        {ticket.items.map(line => <div className="ticket-line" key={line.id}><strong>{line.quantity} × {line.name_ar}</strong>
          <small dir="ltr">{line.name_en}</small>{line.note && <p dir="auto">{line.note}</p>}</div>)}</div>
      <button className="primary full" onClick={() => window.print()}>{t('طباعة', 'Print')}</button>
    </Dialog>}
  </>;
}

const newItem: Omit<Item, 'id'> = { category: 'grills', name_ar: '', name_en: '', description_ar: '', description_en: '',
  price: 0, calories: null, prep_minutes: null, allergens_ar: '', allergens_en: '', photo: '', available: true, published: true, position: 0 };

function MenuAdmin({ lang, t }: { lang: Lang; t: Translate }) {
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState<Item | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setItems(await fetchMenu(true)); } catch { setMessage('network'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  function field<K extends keyof Item>(key: K, value: Item[K]) { setDraft(item => item && ({ ...item, [key]: value })); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db || !draft || busy) return;
    setBusy(true); setMessage('');
    try {
      const { id, ...changes } = draft;
      if (file) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3000000) throw Error('photo');
        const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
        const { data, error } = await db.storage.from('menu-photos').upload(`${crypto.randomUUID()}.${ext}`, file);
        if (error) throw error;
        changes.photo = data.path;
        field('photo', data.path);
        setFile(null);
      }
      const result = await (id ? db.from('menu_items').update(changes).eq('id', id) : db.from('menu_items').insert(changes)).select('id').single();
      if (result.error) throw result.error;
      setDraft(null);
      await load();
    } catch (error) { setMessage(error instanceof Error && error.message === 'photo' ? 'photo' : 'network'); }
    finally { setBusy(false); }
  }

  return <><div className="section-title"><h1>{t('إدارة القائمة', 'Menu admin')}</h1>
    <button className="primary" onClick={() => { setMessage(''); setFile(null); setDraft({ id: '', ...newItem }); }}>{t('إضافة طبق', 'Add dish')}</button></div>
    <input type="search" aria-label={t('بحث', 'Search')} placeholder={t('ابحث عن طبق', 'Search dishes')} value={query} onChange={event => setQuery(event.target.value)} />
    {message && !draft && <p role="alert" className="notice">{orderError(message, lang)}</p>}
    <div className="admin-list">{items.filter(item => [item.name_ar, item.name_en].some(value => value.toLowerCase().includes(query.toLowerCase()))).map(item =>
      <article className="admin-row" key={item.id}>{photo(item.photo) && <img src={photo(item.photo)} alt="" loading="lazy" />}
        <div><strong>{name(item, lang)}</strong><small>{money(item.price, lang)} · {!item.published ? t('مخفي', 'Hidden') : item.available ? t('متاح', 'Available') : t('غير متاح', 'Sold out')}</small></div>
        <button className="outline" onClick={() => { setMessage(''); setFile(null); setDraft(item); }}>{t('تعديل', 'Edit')}</button></article>)}</div>
    {draft && <Dialog label={t('إغلاق محرر القائمة', 'Close menu editor')} close={() => { if (!busy) setDraft(null); }}>
      <h2>{draft.id ? t('تعديل الطبق', 'Edit dish') : t('إضافة طبق', 'Add dish')}</h2>
      <form onSubmit={save}>
        <div className="form-grid">
          <label>{t('الاسم بالعربية', 'Arabic name')}<input value={draft.name_ar} maxLength={100} required dir="rtl" onChange={event => field('name_ar', event.target.value)} /></label>
          <label>{t('الاسم بالإنجليزية', 'English name')}<input value={draft.name_en} maxLength={100} required dir="ltr" onChange={event => field('name_en', event.target.value)} /></label>
          <label>{t('الوصف بالعربية', 'Arabic description')}<textarea value={draft.description_ar} dir="rtl" onChange={event => field('description_ar', event.target.value)} /></label>
          <label>{t('الوصف بالإنجليزية', 'English description')}<textarea value={draft.description_en} dir="ltr" onChange={event => field('description_en', event.target.value)} /></label>
          <label>{t('القسم', 'Category')}<select value={draft.category} onChange={event => field('category', event.target.value)}>{groups.map(group => <option key={group.id} value={group.id}>{group.name[lang]}</option>)}</select></label>
          <label>{t('السعر بالريال', 'Price in SAR')}<input key={draft.id} type="number" step="0.01" min="0.01" max="10000" required defaultValue={draft.price ? draft.price / 100 : ''} onChange={event => field('price', Math.round(Number(event.target.value) * 100))} /></label>
          <label>{t('السعرات الحرارية', 'Calories')}<input type="number" min="0" max="10000" value={draft.calories ?? ''} onChange={event => field('calories', event.target.value === '' ? null : Number(event.target.value))} /></label>
          <label>{t('وقت التحضير بالدقائق', 'Preparation time in minutes')}<input type="number" min="1" max="1440" value={draft.prep_minutes ?? ''} onChange={event => field('prep_minutes', event.target.value === '' ? null : Number(event.target.value))} /></label>
          <label>{t('مسببات الحساسية بالعربية', 'Allergens in Arabic')}<input value={draft.allergens_ar} dir="rtl" onChange={event => field('allergens_ar', event.target.value)} /></label>
          <label>{t('مسببات الحساسية بالإنجليزية', 'Allergens in English')}<input value={draft.allergens_en} dir="ltr" onChange={event => field('allergens_en', event.target.value)} /></label>
          <label>{t('ترتيب العرض', 'Sort position')}<input type="number" value={draft.position} required onChange={event => field('position', Number(event.target.value))} /></label>
        </div>
        <label>{t('صورة الطبق', 'Dish photo')}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
        {photo(draft.photo) && <div className="actions"><img className="thumb" src={photo(draft.photo)} alt="" /><button type="button" className="plain" onClick={() => field('photo', '')}>{t('إزالة الصورة', 'Remove photo')}</button></div>}
        <label className="checkbox"><input type="checkbox" checked={draft.available} onChange={event => field('available', event.target.checked)} />{t('متاح للطلب', 'Available to order')}</label>
        <label className="checkbox"><input type="checkbox" checked={draft.published} onChange={event => field('published', event.target.checked)} />{t('ظاهر في القائمة', 'Visible on the menu')}</label>
        {message && <p role="alert" className="notice">{message === 'photo' ? t('اختر صورة JPG أو PNG أو WebP بحجم أقل من ٣ ميجابايت.', 'Choose a JPG, PNG or WebP under 3 MB.') : orderError(message, lang)}</p>}
        <button className="primary full" disabled={busy}>{t('حفظ الطبق', 'Save dish')}</button>
      </form>
    </Dialog>}
  </>;
}

function TableAdmin({ t }: { t: Translate }) {
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [label, setLabel] = useState('');
  const [qr, setQr] = useState<{ label: string; image: string; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const result = await db?.from('dining_tables').select('*').order('label');
    if (result?.error) setFailed(true);
    else if (result?.data) setTables(result.data as DiningTable[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function change(values: Partial<DiningTable>, id?: string) {
    if (!db || busy) return;
    setBusy(true); setFailed(false);
    try {
      const { error } = await (id ? db.from('dining_tables').update(values).eq('id', id) : db.from('dining_tables').insert(values)).select('id').single();
      if (error) setFailed(true);
      else { if (!id) setLabel(''); await load(); }
    } catch { setFailed(true); } finally { setBusy(false); }
  }
  async function showQr(table: DiningTable) {
    const url = new URL('/menu', location.origin);
    url.searchParams.set('table', table.token);
    try { setQr({ label: table.label, image: await QRCode.toDataURL(url.href, { width: 360, margin: 3 }), url: url.href }); }
    catch { setFailed(true); }
  }
  return <><h1>{t('الطاولات ورموز QR', 'Tables and QR codes')}</h1>
    <form className="actions" onSubmit={event => { event.preventDefault(); if (label.trim()) void change({ label: label.trim() }); }}>
      <input aria-label={t('رقم الطاولة', 'Table label')} placeholder={t('رقم الطاولة', 'Table label')} value={label} maxLength={30} required onChange={event => setLabel(event.target.value)} />
      <button className="primary" disabled={busy}>{t('إضافة طاولة', 'Add table')}</button>
    </form>
    {failed && <p role="alert" className="notice">{t('تعذر حفظ الطاولة أو تحميلها. تحقق من أن الرقم فريد.', 'Could not save or load the table. Check that its label is unique.')}</p>}
    <div className="admin-list">{tables.map(table => <article className="admin-row" key={table.id}><strong>{t('طاولة', 'Table')} {table.label}</strong>
      <div className="actions"><button className="outline" onClick={() => void showQr(table)} disabled={!table.active}>{t('عرض الرمز', 'Show QR')}</button>
        <button className="outline" disabled={busy} onClick={() => void change({ active: !table.active }, table.id)}>{table.active ? t('إيقاف الطلب', 'Disable ordering') : t('تفعيل الطلب', 'Enable ordering')}</button>
        <button className="plain" disabled={busy} onClick={() => {
          if (window.confirm(t('سيصبح الرمز القديم غير صالح. هل تريد استبداله؟', 'Replace this QR code? The old code will stop working.'))) void change({ token: crypto.randomUUID() }, table.id);
        }}>{t('استبدال الرمز', 'Replace QR')}</button></div></article>)}</div>
    {qr && <Dialog label={t('إغلاق الرمز', 'Close QR')} close={() => setQr(null)}>
      <div className="print-target qr-card"><img className="qr-logo" src="/logo.jpg" alt="RedChili" /><h2>{t('طاولة', 'Table')} {qr.label}</h2>
        <img className="qr" src={qr.image} alt={t('رمز طلب الطاولة', 'Table ordering QR')} /><p>امسح الرمز للطلب · Scan to order</p></div>
      <div className="actions"><button className="primary" onClick={() => window.print()}>{t('طباعة الرمز', 'Print QR')}</button>
        <a href={qr.url} target="_blank" rel="noreferrer">{t('فتح رابط الطاولة', 'Open table link')}</a></div>
    </Dialog>}
  </>;
}
