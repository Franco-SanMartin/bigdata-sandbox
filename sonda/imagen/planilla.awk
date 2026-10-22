# Planilla y veredicto de la sonda. Entrada: bloques "@@ nombre" seguidos de
# lineas clave=valor (ver planilla.sh). Variables: profe, csv, resumen, fecha.

function campo(linea,   i) {
    i = index(linea, "=")
    if (i == 0) return
    v[n, substr(linea, 1, i - 1)] = substr(linea, i + 1)
}
function g(k, r) { return ((r, k) in v) ? v[r, k] : "" }
function csvq(s) {
    if (s ~ /[;"\n]/) { gsub(/"/, "\"\"", s); s = "\"" s "\"" }
    return s
}
# Ordena a[1..m] (numerico) y devuelve la mediana
function mediana(a, m,   i, j, t) {
    if (m == 0) return ""
    for (i = 2; i <= m; i++) { t = a[i]; for (j = i - 1; j >= 1 && a[j] > t; j--) a[j + 1] = a[j]; a[j + 1] = t }
    return (m % 2) ? a[(m + 1) / 2] : int((a[m / 2] + a[m / 2 + 1]) / 2 + 0.5)
}
# "valor (cantidad), valor (cantidad)" de la clave k entre las filas con resultado
function conteo(k,   r, x, c, lista, s, sep, m, i, orden) {
    split("", c); lista = ""
    for (r = 1; r <= n; r++) {
        if (g("con_resultado", r) != "si") continue
        x = g(k, r); if (x == "") x = "?"
        if (!(x in c)) lista = lista SUBSEP x
        c[x]++
    }
    s = ""; sep = ""
    m = split(substr(lista, 2), orden, SUBSEP)
    for (i = 1; i <= m; i++) { s = s sep orden[i] " (" c[orden[i]] ")"; sep = ", " }
    return s
}
function pct(x, t) { return t ? int(x * 100 / t) : 0 }
function nombres_si(cond_k, patron, negar,   r, s, x) {
    s = ""
    for (r = 1; r <= n; r++) {
        if (g("con_resultado", r) != "si") continue
        x = g(cond_k, r)
        if ((x ~ patron) != negar) s = s " " nom[r]
    }
    return s
}
function linea(s) { print s > resumen }

/^@@ / { n++; nom[n] = substr($0, 4); next }
{ campo($0) }

END {
    # Lo del profe
    while ((getline l < profe) > 0) { i = index(l, "="); if (i) p[substr(l, 1, i - 1)] = substr(l, i + 1) }
    umbral = (p["umbral"] != "") ? p["umbral"] + 0 : 80

    # --- planilla.csv (separador ";" y BOM para que Excel en castellano la abra bien) ---
    ncol = split("nombre ip_pc perfil_red windows docker_desktop docker_ram_mb docker_cpus docker_kernel ram_gb cpu nucleos gpu " \
        "imagen_cargada_antes carga_seg docker dev_net_tun udp_profe inscripcion wg_kernel wg_go tunel " \
        "tunel_modo tunel_motivo ping_profe_ms iperf_profe_mbps iperf_par iperf_par_mbps tcp_entrante " \
        "tcp_companeros notas fecha_prueba dia2_fecha dia2_imagen_cargada_antes dia2_carpeta_resultados", col, " ")
    printf "\357\273\277" > csv
    for (c = 1; c <= ncol; c++) printf "%s%s", col[c], (c < ncol ? ";" : "\n") > csv
    for (r = 1; r <= n; r++) {
        if (g("nombre", r) == "") v[r, "nombre"] = nom[r]
        if (g("inscripto", r) == "si" && g("con_resultado", r) != "si" && g("notas", r) == "")
            v[r, "notas"] = "se inscribio pero todavia no mando resultados"
        for (c = 1; c <= ncol; c++) printf "%s%s", csvq(g(col[c], r)), (c < ncol ? ";" : "\n") > csv
    }
    close(csv)

    # --- cuentas sobre las PCs con resultado del dia 1 ---
    N = 0; sinres = ""
    for (r = 1; r <= n; r++) {
        if (g("con_resultado", r) != "si") { if (g("inscripto", r) == "si") sinres = sinres " " nom[r]; continue }
        N++
        if (g("docker", r) ~ /^no/) dno++
        if (g("udp_profe", r) == "si") udp++
        if (g("inscripcion", r) == "si") ins++
        if (g("wg_kernel", r) == "si") wk++
        if (g("wg_go", r) == "si") wgo++
        if (g("tunel", r) == "si") { tun++; if (g("tunel_modo", r) == "kernel") tk++; else tg++ }
        else if (g("tunel_motivo", r) != "") { mot = g("tunel_motivo", r); if (!(mot in motc)) motl = motl SUBSEP mot; motc[mot]++; motn[mot] = motn[mot] " " nom[r] }
        if (g("tcp_entrante", r) ~ /^si/) tcp++
        else if (g("tcp_entrante", r) ~ /^no/) tcpno = tcpno " " nom[r] " " substr(g("tcp_entrante", r), 4)
        x = g("iperf_profe_mbps", r); if (x != "") ip_a[++ip_n] = x + 0
        x = g("iperf_par_mbps", r);   if (x != "") pp_a[++pp_n] = x + 0
        x = g("ping_profe_ms", r);    if (x != "") pg_a[++pg_n] = x + 0
        x = g("ram_gb", r);           if (x != "") { x += 0; if (rmin == "" || x < rmin) rmin = x; if (x > rmax) rmax = x }
        x = g("docker_ram_mb", r);    if (x != "") { x += 0; if (dmin == "" || x < dmin) dmin = x; if (x > dmax) dmax = x }
        if (g("imagen_cargada_antes", r) == "si") yacargada++
        m = split(g("tcp_companeros", r), tc, " ")
        for (i = 1; i <= m; i++) { tct++; if (tc[i] ~ /:si$/) tcs++ }
    }
    med_ip = mediana(ip_a, ip_n); med_pp = mediana(pp_a, pp_n); med_pg = mediana(pg_a, pg_n)

    # --- dia 2 ---
    d2 = 0
    for (r = 1; r <= n; r++) if (g("dia2_fecha", r) != "") {
        d2++
        if (g("dia2_imagen_cargada_antes", r) == "si") d2i++; else d2no = d2no " " nom[r]
        if (g("dia2_carpeta_resultados", r) == "si") d2c++
    }
    # --- veredicto ---
    if (N == 0 && d2) {
        ver = "SIN DATOS DE RED (hoy solo se registro el dia siguiente)"
        porque[++np] = "Hoy no hubo pruebas de red: solo se anotó si la imagen seguía cargada (ver abajo)."
    } else if (N == 0) {
        ver = "SIN DATOS"
        porque[++np] = "Ninguna PC de alumno mando resultados todavia."
        if (sinres != "") porque[++np] = "Se inscribieron:" sinres " (esperar a que terminen)."
        else porque[++np] = "Si los alumnos ya corrieron la sonda, no llegan a la PC del profe por TCP 8099: el firewall de Windows del profe bloquea lo entrante (hay que pedir la regla a sistemas, pregunta 1) o la IP que se les paso no es la correcta. Sus resultados quedaron en la carpeta sonda-resultados de cada PC."
    } else if (pct(tun, N) >= umbral) {
        ver = "A (red del aula con tunel WireGuard y hub en la PC del profe)"
        porque[++np] = "El túnel WireGuard levantó en " tun " de " N " PCs (" pct(tun, N) "%, umbral " umbral "%): " tk + 0 " con el módulo del kernel y " tg + 0 " con wireguard-go."
        porque[++np] = "Los alumnos solo hacen conexiones salientes hacia el profe: no hace falta abrir el firewall de sus PCs."
        if (med_ip != "") porque[++np] = "Ancho de banda por el túnel alumno → profe: mediana " med_ip " Mbit/s" (med_ip < 50 ? " (BAJO: ojo con datasets grandes)" : "") "."
        if (med_pp != "") porque[++np] = "Alumno → alumno pasando por el hub: mediana " med_pp " Mbit/s."
        if (tun < N) porque[++np] = "Las PCs sin túnel (" N - tun ") quedan fuera del cluster o en modo simulado; ver los motivos abajo."
        if (pct(tcp, N) >= umbral) porque[++np] = "Además el profe entra a los puertos publicados de " tcp " de " N " PCs: la opción B también sería posible."
    } else if (pct(tcp, N) >= umbral) {
        ver = "B (red directa con puertos fijos publicados)"
        porque[++np] = "El túnel WireGuard levantó solo en " tun " de " N " PCs (" pct(tun, N) "%, hace falta " umbral "%)."
        porque[++np] = "Pero el profe entra a los puertos publicados de " tcp " de " N " PCs (" pct(tcp, N) "%): el firewall deja pasar lo entrante."
        if (tct) porque[++np] = "Entre alumnos, directo por TCP: " tcs " de " tct " pruebas anduvieron."
    } else {
        ver = "SIMULADO (cada PC con su cluster simulado; no hay cluster del aula)"
        porque[++np] = "El túnel WireGuard levantó solo en " tun " de " N " PCs (" pct(tun, N) "%) y el profe entra a los puertos publicados de " tcp " de " N " (" pct(tcp, N) "%); hace falta " umbral "% en alguno de los dos."
    }
    if (N > 0 && tun < N && motl != "") {
        m = split(substr(motl, 2), mo, SUBSEP)
        for (i = 1; i <= m; i++) porque[++np] = "Sin túnel por \"" mo[i] "\": " motc[mo[i]] " PC(s):" motn[mo[i]] "."
    }
    if (p["hub"] == "no") porque[++np] = "El hub WireGuard del profe no levantó (sin módulo ni /dev/net/tun en su Docker): el túnel no se pudo probar."
    if (dno) porque[++np] = "En " dno " PC(s) Docker no anduvo:" nombres_si("docker", "^no", 0) "."

    # --- resumen.txt ---
    linea("SONDA DEL LABORATORIO - resumen (actualizado " fecha ")")
    linea("")
    linea("PC del profe: " p["nombre"] " (" p["ip_pc"] "), hub WireGuard: " p["hub"] ", imagen ya cargada antes: " p["imagen_cargada_antes"])
    linea("PCs de alumnos con resultados: " N (p["esperados"] != "" ? " de " p["esperados"] " esperadas" : ""))
    if (sinres != "") linea("Inscriptas que todavía no mandaron resultados:" sinres)
    linea("")
    linea("VEREDICTO: " ver)
    linea("Por qué:")
    for (i = 1; i <= np; i++) linea("  - " porque[i])
    if (N > 0) {
        linea("")
        linea("Red:")
        linea("  - UDP al profe (eco 51821): " udp + 0 " de " N)
        linea("  - Inscripción (TCP 8099): " ins + 0 " de " N)
        linea("  - WireGuard disponible: módulo del kernel en " wk + 0 " de " N ", wireguard-go en " wgo + 0 " de " N)
        linea("  - Túnel arriba: " tun + 0 " de " N " (kernel " tk + 0 ", wireguard-go " tg + 0 ")")
        linea("  - El profe entra al puerto publicado del alumno: " tcp + 0 " de " N (tcpno != "" ? "; no:" tcpno : ""))
        if (tct) linea("  - TCP directo alumno → alumno: " tcs + 0 " de " tct " pruebas")
        if (ip_n) linea("  - iperf3 alumno → profe por el túnel: mediana " med_ip " Mbit/s (" ip_n " mediciones, de " ip_a[1] " a " ip_a[ip_n] ")")
        if (pp_n) linea("  - iperf3 alumno → alumno por el hub: mediana " med_pp " Mbit/s (" pp_n " mediciones, de " pp_a[1] " a " pp_a[pp_n] ")")
        if (pg_n) linea("  - Ping al profe por el túnel: mediana " med_pg " ms")
        linea("")
        linea("PCs:")
        linea("  - Windows: " conteo("windows"))
        linea("  - Docker Desktop: " conteo("docker_desktop"))
        if (rmin != "") linea("  - RAM de la PC: de " rmin " a " rmax " GB")
        if (dmin != "") linea("  - RAM que tiene Docker: de " dmin " a " dmax " MB")
        linea("  - CPU: " conteo("cpu"))
        linea("  - GPU: " conteo("gpu"))
        linea("  - Imagen de la sonda ya cargada antes de la clase: " yacargada + 0 " de " N)
    }
    if (d2) {
        linea("")
        linea("Día siguiente (" d2 " PCs):")
        linea("  - La imagen seguía cargada en " d2i + 0 " de " d2 (d2no != "" ? "; borrada en:" d2no : ""))
        linea("  - La carpeta sonda-resultados del usuario seguía en " d2c + 0 " de " d2)
        if (d2i == 0) linea("  -> El reset borra las imágenes: hay que repartir el .tar.gz por Veyon en cada clase.")
        else if (d2i == d2) linea("  -> El reset NO borra las imágenes: alcanza con cargarla una vez.")
        else linea("  -> Depende de la PC: conviene repartir el .tar.gz igual en cada clase.")
        if (p["imagen_cargada_antes"] != "") linea("  - PC del profe, imagen ya cargada al arrancar hoy: " p["imagen_cargada_antes"])
    }
    linea("")
    linea("Detalle por PC: planilla.csv (se abre con Excel; separador \";\").")
    close(resumen)
}
