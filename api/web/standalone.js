// Arranque SIN Nest (solo para desarrollo/pruebas del módulo web): node api/web/standalone.js
// Requiere DATABASE_URL, JWT_SECRET (>=32) y la base ya migrada. En producción se monta desde src/main.ts.
require('dotenv').config?.();
const express = require('express');
const app = express();
require('./index').montar(app);
const puerto = Number(process.env.PORT) || 3000;
app.listen(puerto, () => console.log(`[web] escuchando en http://localhost:${puerto}`));
