// this file is used only for the standalone simulation (npm start) and not part of the end build
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

window.adapterName = 'snmp';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <App socket={{ port: 8081 }} />
        </React.StrictMode>,
    );
}
