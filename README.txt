ROK LITE v478 — Sistema de amigos

NUEVO
- Perfil social persistente sobre Firebase Anonymous Authentication.
- Código de amigo único de 8 caracteres.
- Nombre visible editable.
- Envío de solicitudes por código, aceptar/rechazar y eliminar amigos.
- Lista de amigos y solicitudes actualizada en tiempo real.
- API `window.ROK_SOCIAL` preparada para que el siguiente paso de Versus Online pueda mostrar únicamente partidas creadas por amigos.

IMPORTANTE — FIREBASE RTDB
Esta versión amplía `firebase-rtdb-rules.json` con `socialProfiles`, `friendCodes`, `friendRequests`, `sentFriendRequests` y `friends`. Para que el sistema social funcione en la web publicada, copia/publica estas reglas en Firebase Realtime Database. Anonymous Authentication debe continuar habilitado.

ROK Lite v466 — Biblioteca v460 restaurada + Creador aislado
- La Biblioteca usa nuevamente la base visual exacta de v460.
- El Creador conserva recursos, lotes, cantidades editables y descomposición al 20% del PB.
- Los modales de hechizos del Creador fijan sus alturas sin alterar los modales de Biblioteca normal.

ROK LITE v463 — Creador: HUD unificado, cantidades manuales y reglas de recursos

- En modo Creador, el panel central de Cristal Puro desaparece y el panel superior derecho se amplía para reunir Cristal Puro, elementos, recursos de rareza y el contador del mezclador 0/50.
- El título/contador y la fila de recursos ya no se duplican dentro del panel del mezclador.
- Los contadores de Descomponer y Crear aceptan escritura directa con teclado, además de los botones − y +.
- Descomposición por copia: Cristal Puro = floor(PB/2), +1 recurso de la rareza exacta, y elementos = floor(costo elemental total/2), convertidos al elemento base de la carta.
- El redondeo de descomposición se realiza por copia antes de multiplicar por la cantidad del lote.
- Creación: el costo elemental usa el costo TOTAL de kasteo; cualquier porción aleatoria se convierte al elemento base de la carta.
- Se mantiene el costo de Cristal Puro de creación igual al PB de la carta y 1 recurso de su rareza por copia.

Archivos modificados:
- index.html
- style.css
- game.js
- README.txt


ROK LITE v401 — Ajuste de Kōu Ten: Guren Gan

- Costo total: 6 (4 Fuego + 2 elementos aleatorios).
- Tiempo de kasteo: 5 fases.
- No se modificó el patrón, daño, Quemadura 3, comportamiento contra estructuras ni animación bidireccional.

Archivos modificados:
- index.html
- game.js
- README.txt


ROK LITE v380 — Modal de estadísticas sin scroll

- Las cuatro bandas principales de estadísticas se distribuyen con la misma altura y permanecen visibles al mismo tiempo.
- Se elimina el desplazamiento vertical interno del panel de estadísticas.
- El bloque de enfriamientos pasa a ser la quinta banda y ocupa todo el ancho inferior del modal.
- Se elimina el contenedor negro exterior del bloque de enfriamientos.
- La bandeja interna conserva los chips de todos los enfriamientos activos y los distribuye horizontalmente.
- El panel Habilidad libre / Poder comparte la misma altura útil que las primeras cuatro bandas.

Archivos modificados:
- index.html
- style.css
- game.js
- README.txt


ROK LITE v367

- Gloria latente acepta ahora objetivos Guerrero, Caudillo, Caballero o Héroe, tanto en kasteo normal como en Kasteo rápido.
- Al aceptar con clic izquierdo o Enter una ventana de acción de una carta que está disponible en el Spellbook, el juego cambia automáticamente a la página donde se encuentra esa copia.
- La copia que dispara la oportunidad parpadea y recibe un borde luminoso; las demás cartas de esa página se atenúan para dirigir la atención.
- El enfoque es general para futuras cartas reactivas: usa la ubicación exacta del candidato y, si no existe, busca la primera copia coincidente en el Spellbook.
- El oscurecimiento normal de Gloria latente y Despliegue anticipado cuando no tienen objetivo válido es ahora más suave y permite distinguir bien la ilustración.

ROK LITE v366

- Gloria latente ya no se activa automáticamente ante daño letal.
- La condición letal abre la ventana de acción y permite elegir Activar o No activar.
- La activación rápida comprueba Kaster compatible, objetivo Guerrero/Caballero/Héroe, costo y copia disponible.
- Si se rechaza o vence la ventana, el daño pendiente continúa normalmente.
- Gloria latente mantiene acumulación libre sobre el mismo objetivo.
- Todos los hechizos son consumibles. Gloria latente y Despliegue anticipado no regresan al Spellbook al terminar ni cuando su vínculo falla después de haber sido kasteados.

ROK Lite v364 — Vida máxima efectiva con bono separado

- La burbuja de Vida muestra vida actual / vida máxima efectiva, por ejemplo 5 / 7.
- El aumento de vida máxima no cura automáticamente la vida actual.
- El bono aparece fuera de la burbuja principal como una cápsula independiente +2, igual que los bonos de ataque.
- La cápsula +2 abre un desglose de las fuentes activas del aumento de vida máxima.
- La burbuja principal ahora se expande horizontalmente según el texto.
- Al terminar un bono temporal, solo se pierde la vida que exceda el nuevo máximo.
- Gloria latente recalcula su +2 desde la vida máxima base y conserva correctamente otros posibles bonos.

Archivos modificados:
- game.js
- style.css
- index.html
- README.txt


ROK Lite v361 — Miniatura persistente con apilado idéntico al Versus

- Las cartas de hechizo vinculadas ya no salen hacia la izquierda ni usan una composición distinta.
- La invocación permanece al frente y el conjunto vinculado usa exactamente su mismo origen visual.
- Cada hechizo vinculado queda detrás, desplazado 5 px hacia la derecha y 5 px hacia abajo.
- Versus y persistentes comparten las mismas variables: paso X/Y de 5 px, reducción de escala de 3,5% y reducción de opacidad de 12% por nivel.
- Se conserva la carta completa, con borde y brillo según el elemento del hechizo.
- Se reservó espacio inferior y derecho en la columna persistente para evitar que el apilado quede recortado.

Archivos modificados:
- game.js
- style.css
- index.html
- README.txt


ROK Lite v356 — Selección visible de Caudillo para Despliegue anticipado

- Al pulsar Kastear en Despliegue anticipado, la carta todavía no paga costo ni entra en la cola.
- Primero se abre el modo de selección previa del Caudillo.
- Todos los Caudillos aliados válidos muestran foil, halo y punto amarillo de acción disponible.
- Aparece el texto discreto «Selecciona un Caudillo en arena» debajo de la fila frontal del campo aliado.
- Al tocar directamente una ficha iluminada se confirma el objetivo; entonces se paga el costo y comienza el kasteo de 3 fases.
- Se limpian selecciones de combate anteriores para impedir que otras capas oculten el foil o intercepten el clic.
- Si todos los Caudillos dejan la arena durante la selección, el proceso se cancela sin pagar recursos.

ROK Lite v355 — Jerarquía de Usuario y Objetivo en Kage no Michi

- Kage no Michi ahora usa la misma lectura visual jerárquica de Despliegue anticipado.
- Usuario: Kaster → Oscuridad / Asesino.
- Objetivo: Invocación → Oscuridad / Asesino / Bandido / Acechador.
- El icono de Kaster o Invocación aparece primero; después de la flecha se agrupan el dominio y las cualidades correspondientes.
- Los chips conservan el color dinámico del modal.
- No se modificó la lógica funcional, costo, kasteo ni duración de Kage no Michi.

ROK Lite v354 — Despliegue anticipado reconstruido

- La carta queda oscura en el Spellbook si no existe un Caudillo aliado activo o si ya hay dos instancias activas/en kasteo.
- Cuando existe un objetivo válido, muestra foil y punto de acción disponible.
- El Caudillo se selecciona antes de pagar recursos y antes de iniciar el kasteo de 3 fases.
- El objetivo seleccionado se conserva durante el kasteo; al resolver, se crea el vínculo.
- Las dos copias pueden vincularse al mismo Caudillo.
- Dos vínculos aplican correctamente reducción total de costo 2 y bloqueo de uso 4.
- La selección usa directamente la ficha iluminada; se eliminó el cuadro/glifo sobre la casilla.
- Las cartas vinculadas ya no aparecen sobre el token físico de arena: se apilan debajo de la miniatura persistente del Caudillo en la esquina inferior derecha.
- La miniatura clicable de efectos activos usa la composición completa de la carta.
- Si el Caudillo deja la arena durante el kasteo, el hechizo falla y regresa al Spellbook.

ROK Lite v352

- Los iconos de Usuario, Objetivo, Kaster, Invocación, dominio y cualidades heredan el color dinámico del modal.
- En Biblioteca usan el color elemental de la carta seleccionada.
- En partida usan el color del Kaster controlador.
- Se corrige un bloqueo al iniciar el turno rival: las animaciones Web Animations ahora tienen un watchdog y no pueden dejar extractionAnimating activo indefinidamente si animation.finished no responde.
- Conserva Despliegue anticipado acumulable de v351.

ROK Lite v349 — Minokage: canalización limpia y salto real

- Canalización reducida al 50%: solo anillo exterior, anillo interior y dos cortes giratorios.
- Eliminados núcleo pulsante y mancha oscura/gris.
- Haz de objetivo más transparente y persistente.
- Giro previo una fase antes al 50% de tamaño y opacidad.
- Al ejecutar el poder se ocultan temporalmente ataque, vida e indicadores de la ficha.
- Ascenso a 135%, breve carga aérea y embestida continua aproximadamente tres veces más rápida.
- Descenso progresivo de 135% a tamaño normal durante el trayecto, sin pausas intermedias.
- El giro queda un segundo tras el aterrizaje.
- Conserva cancelación si muere el objetivo, ventana de acción y mecánicas activo/pasivo.

ROK Lite v348 — Canalización original de Minokage restaurada de verdad

Cambios:
- Se reemplazó el montaje de ki activo por el primer efecto de canalización usado en v340.
- Vuelven los dos anillos negros/blancos, el núcleo pulsante y los cortes giratorios originales.
- El efecto se mantiene en la capa persistente actual, por lo que conserva su progreso y no se reinicia al realizar acciones o volver a renderizar la arena.
- Se conserva el rayo tenue de fijación que sigue a la invocación objetivo.
- Se conserva la cancelación inmediata de Shippū Ugachi si el objetivo muere, se restaura o sale de la arena.
- No se modificaron daño, alcance, canalización, trayectoria, fase activa/pasiva ni ventana de acción.

Archivos modificados: game.js, style.css, index.html y README.txt.

ROK Lite v347 — Minokage: canalización restaurada y cancelación por objetivo perdido

Cambios de Shippū Ugachi:
- Se restaura el efecto de canalización de ki que tenía antes de v346.
- El haz de fijación permanece, pero ahora es mucho más tenue, transparente y menos invasivo.
- La animación conserva el reloj original de la canalización; si el DOM debe recrearla, recupera el punto exacto en vez de comenzar otra vez.
- Si la invocación objetivo muere, se restaura o deja de estar activa, Shippū Ugachi se cancela inmediatamente.
- Al cancelarse por pérdida del objetivo, desaparecen el haz y la canalización, y Minokage recupera la posibilidad de activar el poder otra vez.
- El poder ya no sigue apuntando a la última casilla de una invocación inexistente.

Archivos modificados: game.js, style.css, index.html y README.txt.

ROK Lite v346 — Shippū Ugachi activo y pasivo

Cambios de Minokage:
- El Yari queda en alcance real 1 y Oscilación completa de radio 1.
- Shippū Ugachi se divide en fase activa y pasiva.
- Activa: canalización de 5 transiciones, objetivo móvil a radio 6 y embestida de hasta 8 casillas.
- La trayectoria activa atraviesa invocaciones y estructuras; solo termina por distancia o por el borde de la arena.
- El impacto activo cubre un corredor de radio 1 y puede alcanzar invocaciones, Guardianes y Kaster enemigos.
- El giro de preparación comienza cuando queda una fase de canalización.
- Pasiva: los ataques básicos pueden seleccionar exclusivamente invocaciones dentro de un aura de radio 3.
- Minokage salta hasta alcance 1, ejecuta Oscilación completa, regresa a su casilla y después continúa su restauración normal.
- Durante la ida y el regreso, el giro es lento y semitransparente; durante el ataque es rápido y opaco.
- El haz blanco y negro se hizo más visible y sigue al objetivo.
- La fase visual de canalización se sincroniza con la hora inicial para no reiniciarse cuando se vuelve a renderizar la arena.

Archivos modificados: game.js, style.css, index.html y README.txt.

ROK Lite v345 — Minokage: ventana de acción corregida

Base: v344.

Corrección de Shippū Ugachi:
- Minokage vuelve a aparecer en la ventana de acción cuando su poder está realmente disponible.
- Al pulsar Poder, la miniatura/modal de la ventana se retira antes de mostrar los objetivos.
- La selección de la invocación rival pertenece a la misma oportunidad; no se crea una segunda activación ni una miniatura persistente duplicada.
- La transición de fase permanece pausada hasta confirmar un objetivo o cancelar.
- Al confirmar, inicia la canalización y la ventana se libera una sola vez.
- Al cancelar, la oportunidad se cierra limpiamente sin dejar el juego bloqueado.
- Se conservan íntegros la animación, el seguimiento del objetivo, el daño, el crítico y los controles CSS de v343/v344.

Archivos modificados:
- game.js
- index.html
- README.txt

ROK Lite v344 — Shippū Ugachi fuera de la ventana de acción

Base: v342.

Minokage / Shippū Ugachi:
- La canalización usa una capa persistente independiente de renderUnits, por lo que ya no se reinicia al seleccionar cartas, abrir paneles o ejecutar otras acciones.
- Un haz blanco y negro semitransparente fija la invocación objetivo y actualiza su extremo cuando esa invocación se mueve.
- Al completarse la quinta transición, la trayectoria se calcula usando la posición actual del objetivo.
- La trayectoria permite una única corrección al tocar un borde durante un desplazamiento diagonal y luego continúa recta dentro de la arena.
- El vuelo se ejecuta como una sola animación lineal continua, sin pausas entre casillas.
- La elevación máxima del token se redujo 35% respecto al aumento anterior y desciende progresivamente hasta tamaño normal al aterrizar.
- El token y el slash giratorio avanzan juntos.
- El giro permanece visible aproximadamente un segundo después de alcanzar la casilla final.

Controles al principio de style.css:
- Minokage no Kurai: tamaño, X y Y.
- Bushi iniciado: tamaño, X y Y.
- O-sensei Ueshiba: tamaño, X y Y.
- Regente Kishimoto: tamaño, X y Y.
- Ichikawa Goemon: tamaño, X y Y.
- Los controles son exclusivamente visuales y no alteran hitbox, casilla, alcance ni lógica.

Archivos modificados:
- game.js
- style.css
- index.html
- README.txt

ROK Lite v342 — Minokage: fase exacta, daño y animación sincronizada

Base: v341.

Cambios:
- Yari de Minokage baja de daño físico 8 a daño físico 2; alcance 2 y Oscilación completa se conservan.
- Shippū Ugachi solo permite fijar directamente una invocación rival dentro de 6 casillas.
- El Kaster y los Guardianes no son seleccionables, pero siguen recibiendo daño colateral si quedan dentro de la trayectoria.
- Cada impacto usa Golpe crítico 3 con su PDA. Para este poder, un crítico multiplica x3 el daño base 2 y aplica 6 de daño.
- Las cinco fases se descuentan en cada transición global real. Al llegar a cero, el poder se resuelve en esa misma transición sin esperar otra fase de Resolución.
- La canalización tecnológica fue sustituida por una carga de ki negra y blanca, orgánica y ligera.
- Durante la embestida, una copia visual del token viaja junto con el slash giratorio durante 980 ms; los impactos se coordinan con su avance.
- Minokage continúa consumiendo su ataque básico al activar el poder y no se restaura al finalizar la embestida.

Archivos modificados:
- game.js
- style.css
- index.html
- README.txt

ROK Lite v341 — selector de copias en modal de Biblioteca

Base: v340.

Constructor de Spellbook:
- El modal de las cartas de Biblioteca siempre puede abrirse, incluso al alcanzar el máximo de copias.
- La acción Agregar al Spellbook ahora incluye un control integrado con menos, contador cuadrado y más.
- El contador comienza en 0 y permite seleccionar varias copias antes de confirmar.
- El máximo disponible considera simultáneamente las copias existentes, el límite específico de la carta y los espacios libres del Spellbook.
- Las cartas normales conservan el máximo de 2 copias.
- Las cartas con Límites forzados permiten hasta 4 copias.
- Al intentar superar el máximo de la carta aparece: “Alcanzaste el límite máximo de copias permitido para esta carta”.
- Al no quedar espacios aparece: “Límite del Spellbook alcanzado”.
- Al confirmar, todas las copias seleccionadas se agregan en una sola acción.
- El modal no se cierra después de agregar. Muestra “Carta agregada al Spellbook” o “Cartas agregadas al Spellbook” y permanece abierto hasta pulsar Salir.
- La navegación anterior/siguiente del modal sigue disponible y reinicia el selector en 0 para cada carta.

Archivos modificados:
- game.js
- style.css
- index.html
- README.txt

ROK Lite v340 — Minokage no Kurai / Yari: Shippū Ugachi

Base: v339.

Carta integrada:
- “Ninja” Minokage no Kurai.
- Invocación Humano masculino, Catalizador, cualidad Asesino y familia Ninja.
- Costo 5, Kasteo 3, Vida 1, Velocidad 5 y Restauración/estasis 10.
- Yari físico de daño 8, cuerpo a cuerpo, alcance 2, precisión 6 y Oscilación completa.
- Puño físico de daño 2.
- Evasión 4.
- Puede aprender 3 habilidades.

Yari: Shippū Ugachi:
- Poder Activo, Físico, Ofensivo, Mortal y Estándar.
- Una vez por turno.
- Su activación consume el ataque básico de Minokage durante ese turno.
- Selecciona un objetivo rival dentro de 6 casillas.
- Canaliza durante 5 transiciones de fase.
- Al completarse, Minokage salta y recorre una línea de hasta 8 casillas.
- Atraviesa e impacta a todos los enemigos de la trayectoria.
- Cada impacto resuelve Golpe crítico 3 de forma independiente mediante el sistema actual de PDA.
- El poder no restaura a Minokage; queda expuesto en la casilla final.
- Durante la canalización no puede moverse ni realizar ataques normales.

Combate y efectos:
- Oscilación completa calcula primero todos los objetivos dentro del radio 2, ejecuta un slash circular rápido y luego aplica los resultados.
- El ataque normal restaura a Minokage y aplica sus 10 fases de estasis.
- Cuando un ataque falla por Evasión 4, Minokage intenta reposicionarse en una casilla libre dentro de radio 2, priorizando rotar alrededor del atacante concreto.
- Se añadieron efectos negros y blancos para canalización, salto, embestida, impactos, oscilación completa y reposicionamiento por Evasión.

Archivos modificados:
- game.js
- style.css
- index.html
- README.txt

Recursos añadidos:
- assets/minokage-no-kurai-card.png
- assets/minokage-no-kurai-token.png
- assets/damage-applications/damage-application-oscillation-complete.png

Cambio v344
- Yari: Shippū Ugachi ya no aparece ni se ofrece en la ventana de acción contextual.
- El poder sigue disponible como acción manual desde los controles de Minokage.
- No se modificaron sus estadísticas, canalización, trayectoria, daño, crítico ni animaciones.


ROK Lite v350 — Despliegue anticipado
- Añade el hechizo de Fuego Despliegue anticipado (costo 4, kasteo 3).
- Añade la cualidad Caballero y su icono.
- Vincula el hechizo a un Caudillo activo; reduce en 2 el costo de Guerreros del Spellbook.
- Los Guerreros que regresan reciben 3 fases de bloqueo de uso.
- Añade persistentes vinculados, miniatura activa clicable y unifica PB/Agregar/Salir.


ROK Lite v351 — Despliegue anticipado acumulable y modales dinámicos
- Despliegue anticipado baja a costo 2 y mantiene kasteo 3.
- Cada instancia activa reduce en 1 el costo de Guerreros y añade 2 fases de bloqueo al regresar.
- Dos instancias pueden vincularse a dos Caudillos diferentes: reducción total 2 y bloqueo 4.
- Un Caudillo no puede recibir dos copias simultáneas del mismo hechizo.
- El usuario se representa como Usuario → Kaster → Guerrero/Caudillo/Héroe/Caballero.
- El objetivo se representa como Objetivo → Invocación → Caudillo.
- En Biblioteca, modales y botones toman el color elemental de la carta seleccionada.
- Durante la partida, el outline, brillo y acentos del modal usan el color del Kaster controlador.


ROK Lite v353 — combate con estructuras, kasteo de hechizos y enfriamientos
- Cuerpo a cuerpo y Rango quedan anclados a una estructura viva hasta destruirla, restaurarse o ser atacados por una invocación rival.
- Distancia no queda anclada a estructuras, pero el ataque consume la acción ofensiva de la Resolución.
- Una invocación no puede atacar una estructura y luego atacar otro objetivo durante la misma Resolución.
- Los hechizos activan el círculo persistente de kasteo del Kaster igual que las invocaciones.
- Kastear compromete la acción del Kaster: no puede atacar, defender ni contraatacar durante ese turno.
- Poderes, habilidades y factores con enfriamiento activo muestran un reloj de arena pequeño con el contador restante en el modal.

v357 · Fuerza de unión y límite de invocaciones
- El aviso de Fuerza de unión se resuelve antes del aviso de límite.
- El aviso visual muestra invocaciones físicas / capacidad física actual. Ejemplo: una reducción de 1 espacio permite mostrar 6/6 en vez de 5/5.
- El límite funcional sigue validándose por espacios efectivos.
- No se anuncia límite alcanzado si todavía hay en el Spellbook una copia que puede ingresar sin consumir espacio efectivo al completar Fuerza de unión.


v384 · Costos corregidos
- Carga Real: 2 Fuego + 1 aleatorio (total 3).
- Despliegue anticipado: 2 Fuego + 1 aleatorio (total 3).
- Oda Nobunaga: costo total 4 mediante el control maestro (3 Fuego + 1 aleatorio).
- Takeda Shingen: costo total 4 mediante el control maestro (3 Fuego + 1 aleatorio).


ROK Lite v465 — Restauración de Biblioteca + descomposición al 20% PB
- Se restaura íntegramente el CSS y la geometría de Biblioteca/modales de v463.
- Se retira el bloque de CSS experimental de v464 que alteró la presentación.
- Único cambio funcional conservado: al descomponer, Cristal Puro = floor(PB total × 20%) por copia.
- La devolución elemental y de rareza permanece sin cambios respecto de v463.

ROK Lite v467: restaura la estructura de Biblioteca de v460 y aísla el panel del mezclador para que solo se monte en modo Creador.

v482 · Versus Online entre amigos
- Versus Online abre Crear partida / Unirse.
- Crear publica un lobby únicamente visible para amigos.
- Unirse muestra una bandeja en vivo de partidas abiertas de amigos.
- Dentro del lobby cada jugador selecciona su Spellbook; el Host selecciona la arena.
- Ambos jugadores deben marcar LISTO. Cuando los dos están conectados/listos comienza 3-2-1 y arranca el combate.
- IMPORTANTE: publicar firebase-rtdb-rules.json de esta versión en Firebase Realtime Database antes de probar el nuevo lobby.
