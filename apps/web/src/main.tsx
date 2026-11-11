import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './app';
import './styles.css';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/feed.css';
import './styles/create.css';
import './styles/profile.css';
import './styles/pages.css';
import './styles/figma-make.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } });
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><App /></BrowserRouter></QueryClientProvider></React.StrictMode>);
