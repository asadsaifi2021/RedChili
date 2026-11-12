import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Guest } from './guest';
import type { Lang } from './data';
import './style.css';

const Staff = lazy(() => import('./staff').then(module => ({ default: module.Staff })));

function App() {
  const [lang, setLang] = useState<Lang>(localStorage.getItem('redchili-language') === 'en' ? 'en' : 'ar');
  const staff = /^\/(staff|admin)\/?$/.test(location.pathname);
  const landing = !staff && !new URLSearchParams(location.search).has('table');
  useEffect(() => {
    document.documentElement.lang = lang === 'ar' ? 'ar-SA' : 'en';
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('redchili-language', lang);
  }, [lang]);
  return <>
    <a className="skip-link" href={staff ? '#staff-main' : '#menu'}>{lang === 'ar' ? 'تخطّ إلى المحتوى' : 'Skip to content'}</a>
    <header className="site-head"><div className="shell head-inner">
      <a className="brand" href={staff ? '/' : location.pathname + location.search}><img src="/logo-kanz.png" alt={lang === 'ar' ? 'كنز' : 'Kanz'} width="96" height="48" /></a>
      <div className="head-actions">{landing && <a className="header-menu" href="#menu">{lang === 'ar' ? 'القائمة' : 'Our menu'}</a>}<a href={staff ? '/' : '/staff'}>{staff ? (lang === 'ar' ? 'القائمة' : 'Menu') : (lang === 'ar' ? 'الموظفون' : 'Staff')}</a>
        <button className="outline" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button></div>
    </div></header>
    {staff ? <div id="staff-main" tabIndex={-1}>
      <Suspense fallback={<p className="shell" role="status">{lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</p>}>
        <Staff lang={lang} />
      </Suspense>
    </div> : <Guest lang={lang} />}
  </>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
