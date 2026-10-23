import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import './styles/widgets.css';
import './styles/base.css';
import { loadFonts } from './lib/fonts';
import { connect } from './api';
import { startStore } from './state/store';
import { App } from './App';

const el = document.getElementById('root')!;
el.innerHTML = '<div class="boot-screen">Conectando con el cluster…</div>';
loadFonts();

connect()
  .then(startStore)
  .then(() => { el.innerHTML = ''; createRoot(el).render(<StrictMode><App /></StrictMode>); })
  .catch(e => { el.innerHTML = `<div class="boot-screen">No se pudo iniciar la interfaz: ${String(e)}</div>`; });
