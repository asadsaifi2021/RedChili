import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Guest } from './guest';
import { Staff } from './staff';
import type { Lang } from './data';
import './style.css';

function App() {
  const [lang, setLang] = useState<Lang>(localStorage.getItem('redchili-language') === 'en' ? 'en' : 'ar');
  const staff = /^\/(staff|admin)\/?$/.test(location.pathname);
  useEffect(() => {
    document.documentElement.lang = lang === 'ar' ? 'ar-SA' : 'en';
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('redchili-language', lang);
  }, [lang]);
  return <>
    <header className="site-head"><div className="shell head-inner">
      <a className="brand" href={staff ? '/' : location.pathname + location.search}><img src="/logo.jpg" alt="" /><span>RedChili<small lang="ar">رد تشيلي</small></span></a>
      <div className="head-actions"><a href={staff ? '/' : '/staff'}>{staff ? (lang === 'ar' ? 'القائمة' : 'Menu') : (lang === 'ar' ? 'الموظفون' : 'Staff')}</a>
        <button className="outline" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button></div>
    </div></header>
    {staff ? <Staff lang={lang} /> : <Guest lang={lang} />}
  </>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
