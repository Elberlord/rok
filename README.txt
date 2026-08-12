R.O.K LITE — paquete limpio v534

Archivos de ejecución:
- index.html
- style.css
- game.js
- firebase-online.js
- rok-layout-scale.js
- assets/
- firebase-rtdb-rules.json

Cambios v534:
- Restaura la composición original de la zona de kasteo tomando como referencia la calibración anterior al redimensionamiento interno.
- El carril de kasteo vuelve a 150 px lógicos; #rokAppStage es quien escala el conjunto completo.
- Slots 100x138; token 58x74; hechizos 54x54; reloj/badge 34x34 y SVG de tempo según la calibración original.
- ACTIVO y COLA se renderizan por encima de la miniatura para que el token no vuelva a ocultarlos.
- Elimina el scrollbar interno de la cola de kasteo y evita que clamp()/porcentajes vuelvan a deformar sus hijos.
- No cambia reglas de kasteo ni lógica de cartas; es un ajuste de layout y escalado visual.

Cambios v533:
- Unifica las rutas visuales heredadas con la geometría lógica del tablero (1600x900) antes de aplicar la escala universal y el zoom/pan de arena.
- Minokage: Shippū Ugachi, salto/regreso de la pasiva y Evasión ya no calculan desplazamientos con píxeles físicos del viewport.
- Ataques a distancia y Disparo energizado: los proyectiles usan deltas lógicos dentro de boardContent.
- Shirahadori: la trayectoria de devolución usa el mismo sistema lógico del tablero.
- Junkai butai #2: cadena persistente y aro de Parálisis conservan longitud/tamaño correctos al redimensionar.
- Desarmar/recuperar armas y recompensas del Guardián: la conversión board-local → viewport incorpora la escala real y el zoom del tablero.
- Extracción elemental: fuente, centro, carta y salida de orbes trabajan en coordenadas lógicas coherentes.
- Yasugana Hattori: los cuervos convierten directamente viewport → boardContent lógico, incluyendo zoom/pan además de la escala universal.
- Se conserva la lógica de juego de cartas, poderes y combate; el parche se limita a geometría/FX y conversiones de coordenadas.
