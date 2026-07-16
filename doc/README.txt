ROK LITE v219 / v5.5.133
- Movimiento asistido estricto: cada paso y destino deben estar libres; dos fichas ya no pueden terminar en la misma casilla.
- El HUD VS muestra cada Guardián una sola vez y apila debajo todas las invocaciones que tiene canalizadas o que lo están atacando. La unidad que ataca o recibe el rayo pasa al frente.
- Jinchi Tenkan mantiene costo 3, traslada el nexo y hace reaparecer a la invocación inmediatamente, sin estasis ni tiempo de restauración. Primero gana +2 de vida máxima y después recupera 2 de vida.
- Tokugawa puede usar Jinchi Tenkan como rescate automático de Takeda, Musashi, Nobunaga, Oda no Kage o Hideyoshi ante daño letal o estado crítico.
- Defensa 2 en los modales de Kaster usa un icono de escudo en lugar del texto DEF.
- Al llegar un Kaster a 0 de vida se reproduce su derrota y aparece Ganaste/Perdiste con opciones Jugar otra partida o Salir al menú.
- Las revanchas conservan WINS de Hattori y Tokugawa; salir del match reinicia el marcador.
- La IA deja de exigir la reserva simultánea de Takeda + Musashi antes de avanzar: cuando puede pagar a Takeda, prioriza ganar la línea delantera y kastearlo antes de gastar en Akari.

ROK LITE v218 / v5.5.132
- Akari cambia de combate de Rango a Distancia: dispara sin crear un vínculo de combate que inmovilice al objetivo.
- Colegas de guerra de Toyotomi Hideyoshi queda completo: solo un Nobunaga aliado activo habilita su ingreso instantáneo no negable; conserva +1 de ataque por cada Caudillo aliado activo.
- Apertura fija de Tokugawa: la primera Kaguya se prepara en D5 y la segunda en F5.
- Tras las dos Kaguyas, Tokugawa no llena la arena: reserva recursos hasta poder pagar a Takeda y conservar la mitad del costo de Musashi para El viejo amigo.
- Tokugawa permanece atrás hasta completar esa reserva; luego avanza a la línea delantera y busca colocar a Takeda en el lado rival.
- Secuencia estratégica principal: Takeda → Musashi → Nobunaga → Oda no Kage → Hideyoshi → Karunobu Taicho.
- Si el jugador rompe la defensa y presiona al Kaster o a sus Guardianes, Akari puede interrumpir la secuencia como respuesta de emergencia.
- Las Kaguyas conservan D5/F5 mientras se reúnen los recursos; después avanzan y priorizan enemigos cercanos a Takeda.
- La reacción de Bomba de humo incorpora una liberación final adicional para impedir que la acción de la IA quede esperando después de aplicar o cancelar el humo.
- Conserva la transparencia reducida del fondo del HUD rival.

ROK LITE v217 / v5.5.131
HUD rival corregido en una sola columna real, usando como base completa la v216.

ROK Lite v216 / v5.5.130
- Defender del Kaster usa Defensa 2 real: reduce hasta 2 puntos de daño de la fuente, salvo daño directo, y muestra un escudo visual breve con el color del dominio.
- El modal de Hattori y Tokugawa muestra Defensa 2 junto a Vida y abre una explicación propia.
- Las auras de Guardianes solo suprimen Oculto, humo, niebla, Invisibilidad e Intangibilidad de unidades y zonas rivales; nunca cancelan efectos del propietario.
- El contador permanente de Bombas de humo abre un modal con las cargas restantes; el contador amarillo abre otro modal con las fases restantes de la cortina.
- La finalización de Bomba de humo es idempotente y limpia en una sola ruta la acción pendiente, la ventana rápida y el bloqueo de ejecución para que la IA retome el flujo.
- El Counter especial listo usa el color del dominio del Kaster: Hattori morado, Tokugawa dorado de Luz y futuros Kasters su color correspondiente.

ROK Lite v215 / v5.5.129
- El HUD rival usa una sola carcasa visual: Tokugawa, elementos normales y cola de kasteo viven dentro del mismo contenedor continuo.
- Se elimina la clase histórica enemy-mini-hud del agrupador interno para impedir que herede otro fondo, borde, sombra, radio, padding o posición.
- Las filas de recursos y casteos quedan transparentes y separadas únicamente por líneas internas sutiles; funciona igual en modo Anclado y Overlay.

ROK Lite v214 / v5.5.128
- Ansatsu no Kokuin usa la ventana breve de acción compartida: dura 1 segundo, continúa sola si no se pulsa Enter y solo abre el selector grande después de elegir AK en la miniatura de Hattori.
- La canalización de Disparo energizado de Kaguya aumenta de 3 a 5 fases.
- Los Kasters pueden seleccionarse y atacarse entre sí cuando están dentro de alcance, usando la respuesta defensiva normal.
- Los botones de acciones rápidas se montan fuera del recorte de la miniatura para no quedar cortados.
- El HUD rival reúne en una sola tarjeta al Kaster, sus elementos normales y su cola de kasteos, tanto en modo Anclado como Overlay.
- La selección de Bomba de humo queda habilitada durante una reacción rival y puede cancelarse sin dejar bloqueada la secuencia de la IA.
- Las bombas restantes de Sutoka aparecen como contador permanente a la izquierda, con color del dominio; la duración de una bomba activa conserva su contador amarillo independiente.
- El Counter especial usa estado neutro, progreso con color del dominio y estado listo dorado.
- El Elemento puro se genera cada tercera fase propia de Kasteo, no en cada Extracción. Las gotas aparecen 20% más seguidas, caen 20% más rápido, flotan 25% más tiempo y mantienen intacto el viaje final al medidor.

ROK Lite v213 / v5.5.127
- Agrega la invocación «Ninja» Oda no Kage al dominio Fuego y al Spellbook rival.
- Primera raza Demonio, usando el icono entregado por el usuario.
- Cusarigama principal: daño físico 3, alcance 3, precisión 6 y Oscilación parcial; espada extra: daño físico 3, cuerpo a cuerpo, alcance 1 y precisión 6.
- Estadísticas: Vida 2, Velocidad 2, kasteo 2, restauración 2 y costo total 3 (2 Fuego + 1 aleatorio).
- Pasiva: después de causar daño real, tira 2 PDA para ejecutar invocaciones cuyo ataque sea igual o menor que el suyo.
- Activa una vez por restauración: se vincula a Oda Nobunaga, sacrifica movilidad, ocupa la casilla que Nobunaga deja al moverse y lo sustituye como objetivo mediante intercambio de posiciones.
- La IA prioriza a Oda no Kage después de Nobunaga y activa automáticamente el vínculo cuando la casilla posterior está disponible.
- El límite básico de invocaciones pasa a 6 para permitir completar la formación rival.

ROK Lite v212 / v5.5.126
- Alinea el bloque ATAQUE con VIDA, CAST y COUNTER en el HUD inferior de Hattori.
- Elimina únicamente el margen superior heredado del primer contenedor de estadísticas; no cambia tamaños ni contenido.

ROK Lite v211 / v5.5.125
- El HUD compacto de Tokugawa funciona tanto en modo Overlay como en modo Anclado.
- Al alternar el modo HUD, la tarjeta rival se monta en la capa correcta sin duplicarse ni quedar fuera del marco.

ROK Lite v210 / v5.5.124
- HUD rival: sin ataque; reserva pura completa, vida y Counter.
- Elemento puro: caída, pausa flotante y viaje al medidor con solapamiento suave.

ROK Lite v209 / v5.5.123
- El HUD superior de Tokugawa se convierte en una franja compacta: elimina retrato, nombre, etiquetas y Cast; conserva únicamente icono de Kaster, Elemento puro, ataque, vida y Counter especial.
- La franja rival ocupa solo el ancho real de su contenido, con un máximo del 60% del ancho anterior y una altura reducida de 72 px a 42 px.
- El fondo del HUD rival usa la misma transparencia del HUD de elementos enemigo. Fuera del turno de Tokugawa, su contenido queda al 40% y vuelve al 100% al pasar el cursor o durante su turno.
- El HUD de elementos/casteos rival sube para quedar inmediatamente debajo de la nueva franja compacta.
- Ansatsu no Kokuin cuesta 3 Elementos puros por cada invocación seleccionada; la cantidad máxima seleccionable se calcula según el recurso disponible.
- Jinchi Tenkan cuesta 3 Elementos puros por activación.
- Ambas habilidades muestran tres gotas de Elemento puro junto a su nombre en el chip, el panel de habilidad y la ventana de activación.

ROK Lite v205 / v5.5.119
- El modal del Guardián queda reducido a cuatro chips únicos, centrados y sin datos secundarios sueltos: Daño canalizado, Resistencia 5, Núcleo elemental y Aura y contención.
- Resistencia reutiliza el mismo escudo cuadriculado del token del Guardián y muestra el valor dentro del mismo chip.
- El panel derecho de Poder se extiende y contiene la explicación completa de aura, canalización, asedio sostenido y núcleo elemental.
- Los modales secundarios del Guardián adaptan bordes, títulos, iconos, tags y acentos al color del dominio del Guardián.
- Núcleo elemental cambia de recompensa fija al destruirse a dos comprobaciones por cada punto de daño real recibido: 40% para un primer elemento y 32% para un segundo.
- Los elementos liberados pertenecen al dominio principal del Guardián y viajan al stock del jugador que causó el daño.
- La extracción básica de cada fase baja de tres cartas de elemento a dos.

ROK Lite v203 / v5.5.117
- El modal del Guardián vuelve a usar la misma composición base de los demás conjuros: carta arriba, estadísticas en las filas normales y capacidades en el panel derecho.
- Se eliminan las cinco cajas especiales del Guardián.
- La Resistencia usa el mismo escudo cuadriculado visible junto al 5 en el token, ocupando el lugar equivalente a Vida.
- Se integran los iconos entregados para Aura y contención, Daño canalizado y Núcleo elemental; cada uno abre su explicación detallada.
- Se preservan todos los ajustes de v202: aura 25%/50% solo por rivales, escalas de círculos y mitigación sin -0.

ROK Lite v202 / v5.5.116
- El aura del Guardián queda al 25% cuando está inactiva y sube al 50% solo por hover o cuando una invocación rival entra en su radio; las invocaciones aliadas ya no activan el aumento visual.
- El círculo persistente del Kaster mientras kastea se reduce 40% respecto al tamaño de v201.
- El círculo mágico de entrada de invocaciones se reduce 15% respecto al tamaño de v201, sin cambiar duración, rotación ni secuencia.
- El chip de Armadura muestra la reducción real de cada impacto: -1, -2, -4, etc.; si la reducción es 0 no se crea ningún indicador y nunca aparece -0.

ROK Lite v201 / v5.5.115
- El aura del Guardián queda al 10% de intensidad cuando está inactiva y al 50% cuando el cursor está sobre el Guardián o hay una invocación dentro.
- La canalización automática del Guardián aumenta de 3 a 9 fases y mantiene 1 de daño por impacto.
- Las invocaciones de alcance que atacan a un Guardián quedan ancladas y continúan atacándolo en Resoluciones posteriores, igual que las cuerpo a cuerpo; se restauran cuando el Guardián es destruido.
- El Kaster muestra un círculo mágico persistente y giratorio sobre su token mientras el kasteo activo sea una invocación de 1 o más fases. Los kasteos instantáneos no muestran el indicador.
- Mientras el Kaster tiene un kasteo activo, continúa sin poder Defender ni Contraatacar; el daño se resuelve directamente.

ROK Lite v200 / v5.5.114
- Guardianes con aura circular propia de radio 3 (37 casillas contando el centro), colorada según su dominio.
- El aura elimina y bloquea humo, niebla, Oculto, Invisibilidad, Intangibilidad y factores equivalentes dentro de la zona.
- Las invocaciones rivales dentro del aura tienen Velocidad 1; al entrar durante un movimiento pierden el resto de pasos de esa fase.
- Cada Guardián canaliza durante 3 fases contra cada invocación rival dentro del aura y después causa 1 de daño elemental; reinicia si el objetivo permanece.
- Destruir un Guardián entrega 2 elementos de su dominio principal al jugador que lo destruyó, con caída y viaje visual al stock.
- El modal del Guardián documenta aura, ralentización, canalización y recompensa.
- El círculo mágico previo a la entrada de una invocación reduce su expansión máxima visual en 35%.

ROK Lite v5.5.112
- El modal de confirmación de una acción rival permanece abierto hasta que el jugador pulse OK o Enter.
- Se elimina el cierre automático por tiempo.
- Hacer clic en el fondo o contenido del modal no confirma la acción.
- La tecla Espacio ya no cierra el modal ni reanuda la secuencia.

ROK Lite v5.5.111
- El Kaster puede atacar activamente durante su propia Resolución sin agregar un botón Atacar a la miniatura.
- Al seleccionar el Kaster, los objetivos rivales válidos aparecen en el panel izquierdo y también se pueden escoger directamente en la arena.
- El ataque solo está disponible si el Kaster no está kasteando; si la invocación rival sobrevive al daño, se restaura.
- El Kaster consume su ataque y movimiento restante al atacar, evitando ataques repetidos en la misma Resolución.

ROK Lite v5.5.110
- El menú Defender/Contraatacar vuelve a aceptar clics durante acciones rivales.
- Los ataques a distancia contra el Kaster muestran solo Defender y bloquean lógicamente el contraataque.

ROK Lite v97
- Corrige debug ribbon inline: ahora no rompe por strings multilínea y sí puede mostrar detalle real/última acción.
- Corrige crash de HUD VS al entrar en combate: agrega unitHasBurnFactor() para icono de Quemadura VS.
- Bloquea panel Elegir/ataque cuando no es Resolución del jugador local.
ROK Lite v199 / v5.5.113
- Las condiciones y factores activos de las miniaturas inferiores derechas muestran únicamente su icono.
- Se eliminó la burbuja numérica amarilla de esos factores sin alterar sus niveles, duración ni modal informativo.



ROK v5.5.120 / v206: compacta y alinea a la izquierda los cuatro bloques del Guardián, ajusta el texto del poder, reduce 25% el círculo persistente del Kaster y conserva su fase de giro entre renders.
