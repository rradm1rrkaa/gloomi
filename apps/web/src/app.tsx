import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Bookmark, Clapperboard, Home, LogOut, MessageCircle, Plus, Search, Send, Sparkles, SquarePlus, UserRound } from 'lucide-react';
import { api, ApiError, getAccessToken, restoreSession, setAccessToken, setCsrfToken } from './api';
import { Brand } from './brand';
import { AuthPage } from './auth-page';
import { PasswordReset } from './password-reset';
import { Avatar, ErrorState, type User } from './ui';
import { CreatePost } from './create-post';
import { ExplorePage, FeedPage, PostPage, ReelsPage, SavedPage, Suggestions } from './feed-pages';
import { ProfilePage } from './profile-page';
import { ActivityPage } from './activity-page';
import { Messenger } from './messenger';
import { PhonePreview } from './phone-preview';

export default function App() {
  const [ready, setReady] = useState(false);
  const [, setRevision] = useState(0);
  const me = useQuery<User>({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/auth/me')).data,
    enabled: !!getAccessToken(),
    retry: false,
  });

  useEffect(() => {
    const changed = () => setRevision(value => value + 1);
    window.addEventListener('gloomi:auth-changed', changed);
    void restoreSession().finally(() => setReady(true));
    return () => window.removeEventListener('gloomi:auth-changed', changed);
  }, []);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      setAccessToken(null);
      setCsrfToken(null);
    }
  }, [me.error]);

  if (!ready) return <div className="loading"><Brand/><p>Ваши моменты уже рядом…</p></div>;
  if (!getAccessToken()) return <Routes><Route path="/password-reset" element={<PasswordReset/>}/><Route path="/verify" element={<AuthPage verify/>}/><Route path="*" element={<AuthPage/>}/></Routes>;
  if (me.isLoading || (!me.data && !me.error)) return <div className="loading"><Brand/><p>Возвращаемся в ваш мир…</p></div>;
  if (me.isError) return <ErrorState retry={() => void me.refetch()}/>;
  return <Shell user={me.data!}/>;
}

function Shell({ user }: { user: User }) {
  const current = useLocation().pathname;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [create, setCreate] = useState<'post' | 'story' | null>(null);
  const [error, setError] = useState('');
  const notifications = useQuery<any[]>({ queryKey: ['notifications'], queryFn: async () => (await api.get('/notifications')).data, refetchInterval: 30000 });
  const unread = notifications.data?.filter(item => !item.readAt).length || 0;
  const destinations = [
    ['/', Home, 'Главная'], ['/explore', Search, 'Поиск'], ['/reels', Clapperboard, 'Reels'],
    ['/messages', MessageCircle, 'Сообщения'], ['/notifications', Bell, 'Уведомления'],
    ['/profile', UserRound, 'Профиль'], ['/saved', Bookmark, 'Сохранённое'],
  ] as const;
  const mobile = [destinations[0], destinations[1], ['/create', SquarePlus, 'Создать'] as const, destinations[4], destinations[5]] as const;

  useEffect(() => {
    if (current === '/create' || current === '/picker') {
      setCreate('post');
      navigate('/', { replace: true });
    }
  }, [current, navigate]);

  async function logout() {
    setError('');
    try {
      await api.post('/auth/logout');
      setAccessToken(null); setCsrfToken(null); qc.clear(); navigate('/login');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAccessToken(null); setCsrfToken(null); qc.clear(); navigate('/login');
      } else setError('Не удалось завершить сеанс на сервере. Проверьте соединение и повторите выход.');
    }
  }

  const active = (path: string) => path === '/profile' ? current.startsWith('/profile') : current === path;
  return <>
    <header className="mobile-header"><Link to="/" className="brand" aria-label="GLOOMI"><Brand/></Link><div><Link className="icon-control" to="/reels" aria-label="Reels"><Clapperboard/></Link><Link className="icon-control" to="/messages" aria-label="Сообщения"><Send/></Link></div></header>
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="brand" aria-label="GLOOMI"><Brand/></Link>
        <nav aria-label="Основная навигация">{destinations.map(([path, Icon, label]) => <Link key={path} to={path} title={label} className={active(path) ? 'active' : ''} aria-current={active(path) ? 'page' : undefined}><Icon/><span>{label}</span>{path === '/notifications' && unread > 0 && <span className="nav-badge">{unread}</span>}</Link>)}<button className="nav-create" onClick={() => setCreate('post')} title="Создать публикацию"><SquarePlus/><span>Создать публикацию</span></button></nav>
        <Link className="profile-link" to="/profile"><Avatar name={user.username} src={user.profile?.avatarUrl} size={34}/><span>@{user.username}</span></Link>
        <button className="logout" onClick={() => void logout()}><LogOut size={17}/>Выйти</button>
        <div className="sidebar-bottom-note">Маленькие моменты.<br/>Большие чувства.</div>
      </aside>
      <main className="main-content"><Routes>
        <Route path="/" element={<FeedPage user={user} onCreate={setCreate}/>}/>
        <Route path="/explore" element={<ExplorePage/>}/><Route path="/search" element={<ExplorePage/>}/>
        <Route path="/saved" element={<SavedPage user={user}/>}/><Route path="/post/:id" element={<PostPage/>}/>
        <Route path="/profile" element={<ProfilePage user={user} onCreate={() => setCreate('post')} onLogout={() => void logout()}/>}/>
        <Route path="/profile/:username" element={<ProfilePage user={user} onCreate={() => setCreate('post')} onLogout={() => void logout()}/>}/>
        <Route path="/messages" element={<Messenger user={user}/>}/><Route path="/direct" element={<Navigate to="/messages" replace/>}/>
        <Route path="/conversation/:id" element={<ConversationRedirect/>}/><Route path="/story/:id" element={<StoryRedirect/>}/>
        <Route path="/notifications" element={<ActivityPage/>}/><Route path="/reels" element={<ReelsPage/>}/>
        <Route path="/phone-preview" element={<PhonePreview/>}/><Route path="/create" element={null}/><Route path="/picker" element={null}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes></main>
      <aside className="right-rail">
        <div className="rail-user"><Link to="/profile"><Avatar name={user.username} src={user.profile?.avatarUrl} size={45}/></Link><div><strong>{user.profile?.displayName || user.username}</strong><small>@{user.username}</small></div><Link to="/profile">Профиль</Link></div>
        <div className="rail-card"><div className="rail-heading">Люди в вашем ритме<Link to="/explore">Найти ещё</Link></div><Suggestions compact/></div>
        <div className="rail-card rail-note"><Sparkles/><h3>Ваш день заслуживает<br/>маленькой истории.</h3><p>Фото, мысль или короткое видео — важные моменты всегда рядом.</p><button className="text-button primary-link" onClick={() => setCreate('story')}>Поделиться моментом <Plus size={13}/></button></div>
        <div className="rail-foot">GLOOMI · Социальная сеть для ваших моментов<br/>© {new Date().getFullYear()} gloomi</div>
      </aside>
      <nav className="mobile-nav" aria-label="Основная навигация">{mobile.map(([path, Icon, label]) => <button key={path} title={label} aria-current={active(path) ? 'page' : undefined} className={active(path) ? 'active' : ''} onClick={() => path === '/create' ? setCreate('post') : navigate(path)}><Icon size={22}/><span>{label}</span></button>)}</nav>
      {create && <CreatePost key={create} kind={create} user={user} onClose={() => setCreate(null)}/>}
    </div>
    {error && <button className="shell-error" onClick={() => setError('')} role="alert">{error}</button>}
  </>;
}

function ConversationRedirect() {
  const { id } = useParams();
  return <Navigate to={`/messages?conversation=${encodeURIComponent(id || '')}`} replace/>;
}

function StoryRedirect() {
  const { id } = useParams();
  return <Navigate to={`/?story=${encodeURIComponent(id || '')}`} replace/>;
}
