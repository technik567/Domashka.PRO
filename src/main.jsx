import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AccountRoot } from './components/FamilyAccounts';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AccountRoot><App /></AccountRoot>
  </React.StrictMode>
);
