R.O.K LITE — v8.42 / game v5.7.325 — Spellbooks base permanentes restaurados

- Restaura dos presets incluidos con el juego: Deck básico Hattori (27/30) y Deck básico Tokugawa (30/30).
- Los presets aparecen aunque localStorage esté vacío y se fusionan con los Spellbooks creados por el usuario sin sobrescribirlos.
- Los Spellbooks base son de solo lectura para que no puedan perderse accidentalmente; “Duplicar para editar” crea una copia normal editable.
- Los presets están disponibles en Mis Spellbooks, Player vs Bot y Versus Online y no exigen poseer las cartas en la colección del usuario, porque son mazos de prueba incluidos por el juego.
- El almacenamiento local persiste únicamente los Spellbooks creados por el usuario; los presets se reconstruyen desde la definición canónica al cargar.
- Se recupera la composición base de Hattori 27/30 y la composición final de Tokugawa 30/30, incluyendo 4 Bushi iniciado y los pares de Carga Real, Shirahadori, Despliegue anticipado, Kouuten, Guren Gan, Tentorou y Gloria latente.

R.O.K LITE — v8.41 / game v5.7.324 — Estasis PB + auditoría PvP Online para repo

- Segunda prueba de Estasis/PB: 5 fases=-800, 4=-640, 3=-480, 2=-320, 1=-160, 0=0. La duración base por Costo no cambia.
- PvP Online: se detectó y corrigió que `farolPortals` existía en el estado persistente del juego pero no estaba incluido en `SNAPSHOT_KEYS`/`SNAPSHOT_ARRAY_KEYS`; ahora los portales de Farolera viajan en el estado autoritativo entre ambos navegadores.
- `firebase-rtdb-rules.json` mantiene schemaVersion 5 / hashVersion 2, coherente con `firebase-online.js`; no fue necesario cambiar reglas por el agregado de `farolPortals`, porque el snapshot autoritativo permite contenido adicional dentro de `snapshot` y valida sus claves mínimas obligatorias.
- `index.html` renueva los query strings de style/game/firebase/layout para evitar que un hosting estático o CDN reutilice versiones antiguas al subir el paquete al repo.
- Se agrega `ONLINE_DEPLOY_CHECKLIST.txt` con los pasos concretos para probar Versus Online y desplegar las reglas RTDB si el proyecto Firebase todavía no tiene esta versión.

R.O.K LITE — v8.32 · Etapa 4 · Factores semánticos

Cambios de esta etapa:
- Normaliza Arma/Ataque como base global reutilizable. Espada pasa a Arma → Base → Cuerpo a cuerpo; los ataques nativos usan Ataque → Nativo → modo de combate.
- Las armas base no consumibles dejan de mostrar explicaciones de Consumo innecesarias.
- Modo de combate conserva solo su tag canónico (p. ej. Cuerpo a cuerpo).
- Alcance y Precisión usan Estadística ofensiva → Alcance/Precisión; Precisión explica su relación con el PDA.
- Tipo y aplicación de daño usan cadenas semánticas compactas.
- Vida usa Estadística defensiva → Vida máxima, elimina la repetición de Vida máxima base y aclara que la curación no supera el máximo salvo que ese máximo sea aumentado.
- No se modifica todavía la lógica de tags generales, casteo, desplazamiento, Factores ni Poderes.

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

ROK v8.11 · Etapa Kaster
- Player vs Bot y PvP Online normalizan temporalmente los Kasters a nivel 10 sin modificar su progreso persistente.
- Aventura conserva el nivel real del Kaster.
- Kiara, Primera Aprendiz de Nigma, queda registrada en Biblioteca como Kaster de Agua con ataque básico Magia y sus cualidades compatibles canónicas.


ROK v8.12 · Revancha + niveles de Aventura
- El match se congela y cancela sus runtimes en el instante en que un Kaster llega a 0 de vida.
- Player vs Bot conserva el Spellbook/modo elegido, reconstruye el estado completo y vuelve a Piedra/Papel/Tijera antes de repartir elementos o comenzar Extracción.
- PvP Online usa la misma compuerta: el host publica un estado pre-iniciativa sin recursos/fase jugable; solo después de resolver Piedra/Papel/Tijera se preparan los elementos y comienza la fase.
- La entrega remota de fase queda bloqueada mientras la iniciativa o la introducción inicial sigan pendientes.
- Aventura muestra NIVEL del rival tanto en la lista de dungeon como en la ficha seleccionada y Preparar combate. Primera campaña: Kiara/Kaelor/Sahrkel/Ilyan nivel 1; Aurek nivel 4.

v8.13 / v560
- Kiara: se integra Farolera del Umbral usando los assets originales entregados por el usuario (art, token y lámpara).
- Stats: Daño 2, Resistencia 2, Velocidad 2, movilidad básica, Magia a distancia, Alcance 3, Precisión 4, Costo 0, 1 slot de habilidad.
- Farol Enlazado: poder activo en dos etapas. El círculo se crea en la casilla de la Farolera; la lámpara se lanza hasta radio 4. Solo las invocaciones Hechicero que entren al círculo pueden teletransportarse a la lámpara.


ROK v8.20 · Farolera / persistente único + regla global post-ataque
- Farol Enlazado conserva una sola miniatura persistente/ventana de acción; el mismo botón cambia entre Etapa 1 y Etapa 2.
- El targeting de ambas etapas mantiene capturada la ventana hasta confirmar o cancelar, sin crear una miniatura nueva por etapa.
- Se deduplican candidatos persistentes por unidad.
- Regla global: una invocación que ya atacó en la Resolución no puede recuperar movimiento mediante restauración inmediata/Restauración 0.
- El bloqueo se aplica al cálculo de movimiento, opciones de movimiento y comprobación de movimiento obligatorio.

v8.21 · Ajustar Tokens corregido
- La herramienta ahora incluye piezas visibles de ambos jugadores en la arena.
- Se eliminó la transformación independiente de imagen/hitbox; escala y offset se aplican a la .unit completa, evitando que al cambiar de selección el tamaño se transfiera o multiplique sobre otra ficha.
- Guardar CSS exporta la nueva regla estable por clave visual de Kaster/invocación/Guardián.

v8.22 · Editor VS universal en vivo
- Los ajustes universales separados de Kaster e Invocación ahora se combinan visualmente en tiempo real con el ajuste individual de la pieza seleccionada, incluso antes de guardar.
- La invocación destacada del Spellbook termina su entrada a opacidad 100%.
- El Kaster recibe una sombra paralela con color derivado de su Dominion para separar ambas siluetas sin transparentar la invocación.


v8.23 · Hotfix Ajustar Tokens
- Corrige TypeError: owners.join is not a function al detectar la misma pieza visual en ambos jugadores.
- El listado Tuyo / Rival vuelve a refrescar sin interrumpir renderAll ni deformar/romper la arena.

v8.24 · Ajustar Tokens · sprite real + pausa de juego
- El editor deja de escalar/mover el contenedor .unit completo: ahora modifica únicamente el sprite visible y el hitbox interactivo con las mismas variables; los badges/estadísticas no cambian de tamaño.
- La pieza seleccionada ya no cambia de geometría por estar seleccionada. Se identifica con foil y una burbuja azul exclusiva del editor.
- El máximo de escala sube de x3 a x6.
- Al abrir AJUSTAR TOKENS se activa una pausa global: se bloquea input de arena, autoavance/inactividad y se congelan las animaciones visuales; al cerrar se reanuda la partida.
- Se inicia almacenamiento temporal v2 para no reutilizar escalas guardadas con la arquitectura anterior.


v8.25 · Ajustar Tokens · selección sin contenedor
- Se elimina por completo el foil/clon visual y la clase de selección que se aplicaban al token mientras se editaba.
- Seleccionar o deseleccionar una pieza ya no modifica su render, tamaño, filtro ni geometría aparente.
- El único indicador de la pieza activa es una pequeña burbuja azul superpuesta sobre la .unit existente, sin crear wrappers ni contenedores adicionales.
- Tamaño/X/Y siguen afectando exclusivamente al sprite real y su hitbox compartida.

v8.26 · Jerarquía lógica de rarezas
- Nuevo orden canónico: 1 Ordinaria, 2 Poco ordinaria, 3 Infrecuente, 4 Inhabitual, 5 Extraordinaria, 6 Extraña, 7 Singular, 8 Legendaria, 9 Mítica.
- Se conservan los nueve sprites en su secuencia visual histórica; cada escalón visual pasa a representar la rareza que ocupa ese nivel en la nueva jerarquía.
- Los rangos de puntuación base y bonos PB existentes se conservan por escalón y se reasignan al nuevo nombre de rareza.
- Booster, ordenación de Biblioteca y recursos de rareza usan la nueva jerarquía lógica.
- El icono de rareza de la ficha de carta abre la consulta informativa existente con nivel, grupo, descripción, rango PB y jerarquía completa; no se añade numeración visible sobre el icono.


ROK v8.27 · PB UNIVERSAL v1
- Base visual: style.css suministrado por el usuario (se conserva íntegro; solo se añade la clase semántica .pb-logic-token al final).
- Daño + Vida se puntúan como una sola suma combinada; la curva continúa hasta 70.
- Precisión se amplía hasta 15 y Velocidad hasta 10 con las curvas acordadas.
- Costo, Kasteo y Restauración siguen separados; Estasis de Spellbook deriva del costo (0→5, 1→4, 2→3, 3→2, 4→1, 5+→0 fases) y descuenta PB con la misma curva de Costo en sentido inverso (-200, -160, -120, -85, -55, 0).
- Factores dejan de tener una tabla PB por nombre: ahora declaran semántica y pasan por evaluatePbUniversalEffect().
- pbEffects es el esquema universal para Poderes, Habilidades y efectos de Hechizos. Las cartas aún no revisadas usan fallback LEGADO visible en DEBUG PB para no introducir puntuaciones silenciosas.
- Curva de objetivos: crecimiento controlado 1–5, pico 6–8, aporte marginal decreciente 9–12 y 0 adicional en 13.
- Efectos sobre aliado/rival se suman/restan algebraicamente según su polaridad.
- Rareza normal sale exclusivamente de PB calculado; forceRarityId solo se respeta en muestras/debug explícitos.
- API de prueba en consola: ROK_PB_ENGINE.calculateCard(id), ROK_PB_ENGINE.evaluateEffect(obj), ROK_PB_ENGINE.targetMultiplier(n).


ROK v8.28 · Hotfix Estasis/PB
- Corrige la Estasis base por costo y su descuento PB espejo. Una invocación de costo 1 tiene Estasis 4 y -160 PB.

ROK v8.29 · Etapa 1 · Modales generales de identidad
- Base: v8.28. Se conserva el CSS del usuario y solo se agregan reglas al final para los nuevos tags semánticos.
- Tipo de carta deja de abrir información de arma por error. Invocación, Hechizo, Habilidad, Kaster y Estructura usan definiciones generales del ruling de R.O.K.
- Se introduce una cadena semántica reutilizable para modales: raíz → identidad → enfoques.
- Familia usa Familia → nombre → enfoques. Ninja queda Familia → Ninja → Sigilo / Precisión / Ejecución.
- Raza usa Raza → nombre → enfoques, elimina Clasificación redundante y deja de superponer el icono de género sobre el icono de raza.
- Cualidad usa Cualidad → nombre → enfoques, elimina Clasificación redundante y conserva por separado “Esta cualidad habilita en esta carta”.
- Asesino deja de definirse como necesariamente físico/táctico y deja de contener texto específico de Junkai Butai; su descripción es global y reutilizable.
- Kurayami cambia su raza de Humano a Demonio.
- Esta etapa no modifica todavía ofensiva/defensiva/casteo/desplazamiento ni Factores/Poderes: quedan para las siguientes etapas comprobables.

ROK v8.31 · Etapa 3 · Casteo + Desplazamiento
- Costo usa Estadística de casteo → Costo y explica el consumo de elementos desde el stock sin repetir la distribución.
- Tiempo de casteo usa Estadística de casteo → Tiempo de casteo; mantiene la cola secuencial y aclara que el Kaster no puede atacar ni defenderse mientras ejecuta el casteo.
- Restauración usa Estadística de casteo → Restauración y queda separada conceptualmente de Estasis de Spellbook: tras combate efectivo o ataque al Kaster la invocación vuelve a su Nexo, cumple su contador y luego vuelve a quedar activa.
- Movilidad, Velocidad y Biotipo usan una única familia: Estadística de desplazamiento.
- Movilidad usa Estadística de desplazamiento → Movilidad; Velocidad usa → Velocidad; Biotipo usa → Biotipo.
- Biotipo Terrestre describe únicamente la adaptación a tierra firme y deja las penalizaciones de otros biomas fuera de este modal.


ROK v8.32 · Etapa 4 · Factores semánticos
- Todos los modales de Factor pasan a la estructura global Factor → activación → categoría → orientación → enfoque.
- Factor, activación y categoría son consultables desde la propia cadena semántica; sus definiciones son globales y reutilizables.
- El modal de Factor elimina la línea Clasificación y el listado legado de tags, evitando repetir la misma información en varias zonas.
- El contenedor de Factor usa la lógica de color del Dominion de la carta y oscurece progresivamente los tags según su profundidad.
- Golpe crítico usa Factor → PDA → Físico → Ofensivo → Daño. Golpe crítico 5 explica 6 PDA y multiplicador ×6 dentro de su descripción, sin repetir Probabilidad de acierto.
- La semántica PB de Golpe crítico incorpora multiplicador y probabilidad; la cantidad de objetivos seguirá perteneciendo al pbEffects del Poder que distribuya el Factor.
- Se deja un mapa semántico explícito para todos los Factores actuales, preparado para perfiles generales, filtros y el motor universal de PB.

ROK v8.33 / GAME v5.7.316 · Etapa 5: Poderes semánticos de Kurayami, dos Poderes reales y PB Universal por Poder.

ROK v8.34 · Etapa 6 — Tag general automático
- El tag general de cada carta deja de usar el ranking heurístico anterior (Resistencia/Movilidad/Precisión/Tempo por puntuaciones internas).
- Daño/Vida aportan perfil solo bajo reglas explícitas: diferencia de 5 puntos, o ambos valores en franja fuerte (>=5).
- Velocidad aporta el enfoque Velocidad únicamente desde 6.
- Los Factores aportan automáticamente su último tag semántico (Enfoque).
- Los Poderes ya migrados con semanticBranches aportan automáticamente sus Enfoques; Poderes legados no se reinterpretan desde texto/tags viejos.
- Las Habilidades quedan preparadas para incorporarse sin reescribir el sistema cuando reciban semanticBranches.
- No se fuerza un mínimo de tres tags ni se inventan fallbacks. Los duplicados se colapsan.
- Kurayami deriva Daño · Velocidad · Precisión por Golpe crítico 5 y sus dos Poderes; Ataque 1 / Vida 2 no generan Resistencia/Daño por estadísticas.
- La búsqueda de Biblioteca incorpora la taxonomía semántica de Factores/Poderes para búsquedas como Ofensivo/Ofensiva, Físico, Daño, Velocidad o Precisión.


ROK v8.35 / game v5.7.318
- Estasis de Spellbook tiene modal propio, chip clicable incluso con valor 0 en Invocaciones y explicación de Estasis base/modificadores.
- Costo, Tiempo de casteo, Restauración y Estasis quedan alineados en una sola fila de estadísticas de casteo.

ROK v8.36 / game v5.7.319 — Ichikawa Goemon semántico + Kurayami pasiva nombrada
- El segundo Poder de Kurayami deja de figurar como nombre pendiente y pasa a llamarse Shinobi no Kōshin.
- Densetsu no Sennyū usa Poder → Disparador → Virtual → Táctico → Movilidad. Su modal elimina conteos técnicos, estelas y sinergias: describe únicamente el disparador de 1–3 movimientos y el acercamiento automático hasta distancia de ataque.
- Botín valioso usa Habilidad → Pasiva → Virtual → Táctica → Saqueo. Su descripción se limita a: al causar al menos 1 de daño real al Kaster rival, 3 PDA; al acertar roba 1 elemento aleatorio del stock rival.
- La taxonomía semántica incorpora raíz Habilidad, orientación Táctico y enfoques Movilidad/Saqueo. La búsqueda y el tag general pueden reutilizar esas capas.
- Densetsu no Sennyū y Botín valioso usan pbEffects del motor universal; Goemon ya no recibe fallback legado de Poder/Habilidad.

ROK v8.37 / game v5.7.320 — Junkai butai #1 + slots de Habilidad + Penetración
- Junkai butai #1 pasa a Ataque 3 / Vida 3, Costo 0, Kasteo 0 y Restauración 0. Conserva Golpe 1 cuando pierde su Espada, Golpe crítico 1 y Penetración de armadura 1.
- El icono de Penetración de armadura se reemplaza por el sprite correcto aportado por el usuario; deja de reutilizar Armadura.
- El PB Universal suma +35 PB por cada Slot de Habilidad disponible en cualquier carta. El +35 provisional de una Habilidad legada deja de duplicarse: su efecto queda en 0/LEGADO hasta recibir pbEffects, mientras la capacidad del slot ya está valorada.
- Golpe crítico mantiene su PDA/multiplicador por nivel, pero no multiplica daño a través de una Armadura Física efectiva que siga reduciendo el impacto después de Penetración. Shizukesa no Shi-in conserva su excepción al ignorar Factores Físicos Defensivos.
- Las descripciones globales de Golpe crítico se normalizan a la regla Factores Físicos Defensivos / estructuras.


ROK v8.38 / game v5.7.321 — Kurokage + Buki Utsushi semántico
- Kurokagi butai #3 pasa a mostrarse como Kurokage.
- Buki Utsushi migra a Poder → Disparador / Activa → Físico → Táctico → Desarmar y se describe como un solo Poder de tres etapas.
- Desarmar 3 de Kurokage usa 3 PDA, ya no exige Kusarigama conjuntamente y continúa habilitado por Asesino.
- El modal global de Desarmar deja de indicar recuperación por Restauración y elimina la línea redundante de Probabilidad; el efecto termina al recuperar el arma.
- PB Universal valora la probabilidad real de Desarmar, su duración hasta recuperar el arma, su escalado multiobjetivo y la captura/alternancia de armas de Buki Utsushi.

ROK v8.38 / game v5.7.321 — Kurokage + Buki Utsushi semántico
- Kurokagi butai #3 pasa a mostrarse como Kurokage.
- Buki Utsushi migra a Poder → Disparador / Activa → Físico → Táctico → Desarmar y se describe como un solo Poder de tres etapas.
- Desarmar 3 de Kurokage usa 3 PDA, ya no exige Kusarigama conjuntamente y continúa habilitado por Asesino.
- El modal global de Desarmar deja de indicar recuperación por Restauración y elimina la línea redundante de Probabilidad; el efecto termina al recuperar el arma.
- PB Universal valora la probabilidad real de Desarmar, su duración hasta recuperar el arma, su escalado multiobjetivo y la captura/alternancia de armas de Buki Utsushi.


ROK v8.39 / game v5.7.322 — Junkai butai #2 · Atadura
- Junkai butai #2 sustituye Parálisis 2 por Atadura 2 y usa el icono aportado por el usuario.
- Atadura 2 dura 5 fases. En cada cambio de fase resuelve dos comprobaciones separadas de 3 PDA: Movimiento y Ataque.
- Si Atadura acierta Movimiento, la unidad no puede moverse durante esa fase; si acierta Ataque, no puede atacar durante esa fase.
- Atadura no aplica el bloqueo total de Parálisis ni silencia acciones que no dependan directamente de moverse o atacar.
- Oscilación parcial se detiene al fijar Atadura sobre el primer objetivo válido; Junkai restaura normalmente después del ataque y el objetivo no queda forzado a un combate enlazado.
- Velocidad de ataque usa descripción global limpia y Factor → Pasiva → Físico → Ofensivo → Iniciativa.
- Atadura usa Factor → PDA → Físico → Ofensivo → Control y PB Universal valora por separado sus restricciones de Movimiento y Ataque.


ROK v8.40 / game v5.7.323 — Calibración de Estasis/PB
- La duración base de Estasis por Costo no cambia: Costo 0→5 fases, 1→4, 2→3, 3→2, 4→1 y 5+→0.
- Se prueba una curva de descuento PB más fuerte: Estasis 5=-450 PB, 4=-350, 3=-250, 2=-150, 1=-50 y 0=0.
- Costo, Tiempo de Kasteo y Restauración conservan sus curvas positivas actuales.
- Objetivo del ajuste: impedir que las Invocaciones iniciales/baratas escalen a rarezas demasiado altas únicamente por tener tempo bajo; la curva queda sujeta a calibración durante la revisión carta por carta.


ROK v8.43 / game v5.7.326 — PvP Online · lobby → VS → RPS → inicio real
- Al quedar ambos jugadores LISTO, la presentación VS pasa a primer plano y el lobby se oculta durante la cinemática; si el inicio se cancela, el lobby vuelve a mostrarse.
- El cliente invitado detecta la iniciativa mediante openingElementsDealt=false, sin depender de actionExecutionLock (que es runtime local y no viaja en el snapshot).
- La compuerta que evita duplicar RPS usa sala + matchSerial, por lo que entrar a otra sala con serial 1 vuelve a ejecutar Piedra/Papel/Tijera correctamente.
- Piedra/Papel/Tijera adquiere una pausa local explícita del gameplay online. La inactividad no corre mientras faltan los elementos iniciales, durante awaiting-initiative, RPS ni opening-intro.
- Tras resolver RPS, el Host publica jugador inicial + elementos; el invitado espera ese estado autoritativo y entra localmente en opening-intro. Ambos desbloquean la partida solo al terminar la animación de elementos.
- Corrige el caso en el que la ventana de inactividad podía aparecer debajo de RPS y quedar imposible de clicar.
