# Viaje · Presupuesto

App web (PWA) para gestionar el presupuesto de un viaje entre 3 personas. Pensada para el teléfono: se instala en la pantalla de inicio y funciona sin conexión.

## Pestañas

- **Presupuesto**
  - *Cuentas*: monto disponible por cuenta/tarjeta y su comisión (% y/o fija, solo en EUR o siempre).
  - *Reparto*: presupuesto personal de cada persona; el **general** = total de cuentas − personales; el general se reparte por categorías (con subcategorías editables).
  - *Lugares*: ciudades con fechas (el registro elige el lugar según la fecha).
  - *Ajustes*: nombre y fechas del viaje, respaldo (exportar/importar JSON), datos de ejemplo.
- **Registro**: monto en EUR o USD (si es EUR busca la tasa EUR→USD del BCE para la fecha del gasto; se puede editar a mano), cuenta, persona o general, categoría, subcategoría, establecimiento, fecha, lugar y nota. Calcula la comisión y el total cargado. *Historial* con búsqueda; tocar un gasto lo edita.
- **Dashboard**: gastado vs presupuesto (total, general o por persona), promedio diario con y sin alojamiento/pasajes, disponible por cuenta, por persona, por categoría, por día (tocar un día muestra sus gastos), por lugar y top establecimientos. Filtros por persona, lugar y periodo.

Todo se lleva en **USD**; los gastos en EUR guardan el monto original y la tasa usada.

## Correr en local

```bash
python -m http.server 5173
```

Abrir http://localhost:5173. En localhost el service worker está apagado (para ver cambios al instante); se activa con `?sw=1`.

## Compartir entre los teléfonos

1. Una persona configura el viaje (cuentas, reparto, lugares) y en **Presupuesto → Ajustes** toca **Crear viaje compartido**.
2. **Compartir enlace** y mandarlo a los demás. Al abrirlo, su teléfono se une al viaje.
3. Cada uno instala la app desde ese mismo navegador (Agregar a inicio / Instalar app).

La app sigue funcionando sin conexión; los gastos se suben solos al volver la señal. El punto del encabezado indica el estado: verde = sincronizado, ámbar = pendiente, gris = sin conexión.

### Cómo funciona

- Supabase, proyecto `scrapping-pricing`, tablas `travel_trips` (configuración del viaje, un documento JSON) y `travel_expenses` (un gasto por fila).
- El id del viaje (uuid) es el secreto: va en el header `x-trip-id` y las políticas RLS solo dejan leer o escribir ese viaje. No hay `DELETE`; los gastos se borran de forma lógica.
- Gastos: gana la versión más reciente de cada gasto. Configuración: gana la última escritura.

## Publicar una versión nueva

Sube `VERSION` en `sw.js`, haz commit y `git push`: GitHub Pages publica solo. Los teléfonos toman la versión nueva la segunda vez que abren la app.

## Estructura

```
index.html, manifest.webmanifest, sw.js   PWA
css/app.css                               estilos (claro/oscuro)
js/store.js   estado + localStorage       js/calc.js    cálculos
js/sync.js    sincronización Supabase     js/config.js  URL y clave publicable
js/fx.js      tasa EUR→USD                js/ui.js      formato, hojas, animaciones
js/views/     budget.js, register.js, dashboard.js
```
