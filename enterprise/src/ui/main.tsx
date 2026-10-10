import './enterprise.css';

import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App.js';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Zhiyuan enterprise UI root is missing.');
rootElement.classList.add('zhiyuan-enterprise-ui');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
